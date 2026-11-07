import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createBackup} from '../lib/backup.mjs';
import {FORMAT, digest, manifestHash, validateBackup, restoreToStores} from '../lib/backup-format.mjs';
import {issueSession, sessionUser} from '../lib/auth.mjs';
import {safe} from '../lib/shop.mjs';

class Store {
  map = new Map(); counter = 0;
  async list() {return {blobs:[...this.map].map(([key,v])=>({key,etag:v.etag}))};}
  async set(key, data, options={}) {
    if (options.onlyIfNew && this.map.has(key)) return {modified:false};
    const etag = String(++this.counter);
    this.map.set(key,{data:Buffer.from(data),metadata:structuredClone(options.metadata || {}),etag});
    return {modified:true,etag};
  }
  async getWithMetadata(key) {const v=this.map.get(key);return v ? {...v,data:Buffer.from(v.data)} : null;}
}
const config = {ADMIN_USER:'eli',ADMIN_PASSWORD_HASH:'pbkdf2$600000$'+'1'.repeat(32)+'$'+'2'.repeat(64),SESSION_SECRET:'a'.repeat(64)};
async function fixture() {
  const records=new Store(), photos=new Store();
  await records.set('inventory/catalog-v2',JSON.stringify({version:2,products:[{id:'p1',variants:[{size:'XXL',stock:3}]}],orders:{},checkouts:{}}));
  await records.set('settings/brand',JSON.stringify({brand:'AZUL bendito'}));
  await photos.set('photo-1',Buffer.from([82,73,70,70,0,1,2,3,87,69,66,80]),{metadata:{contentType:'image/webp'}});
  const handler=createBackup({records,photos,config,environment:'production'});
  const call=(path,headers={},method='GET')=>safe(()=>handler(new Request('https://shop.test/api/backup/'+path,{method,headers:{cookie:'__Host-elizabet_admin='+issueSession(config),...headers}})));
  const start=await (await call('manifest')).json();
  const entries=[];
  for(const e of start.entries) entries.push(await (await call('item?'+new URLSearchParams(e))).json());
  return {records,photos,call,backup:{...start,entries}};
}
test('Exporta registros, stock, fotos y metadatos; recupera y relee en destinos aislados',async()=>{
  const f=await fixture(); assert.equal(f.backup.format,FORMAT);
  assert.equal(validateBackup(f.backup).entries,3);
  const stores={records:new Store(),photos:new Store()};
  await restoreToStores(f.backup,stores,{records:'azul-restauracion-prueba-registros',photos:'azul-restauracion-prueba-fotos'});
  const restored=JSON.parse((await stores.records.getWithMetadata('inventory/catalog-v2')).data.toString());
  assert.equal(restored.products[0].variants[0].stock,3);
  assert.deepEqual((await stores.photos.getWithMetadata('photo-1')).data,(await f.photos.getWithMetadata('photo-1')).data);
  assert.equal((await stores.photos.getWithMetadata('photo-1')).metadata.contentType,'image/webp');
});
test('Rechaza sin sesión, origen ajeno, sesión vencida y métodos que escriben',async()=>{
  const f=await fixture();
  assert.equal((await f.call('manifest',{cookie:''})).status,401);
  assert.equal((await f.call('manifest',{origin:'https://evil.test'})).status,403);
  assert.equal((await f.call('manifest',{'sec-fetch-site':'cross-site'})).status,403);
  assert.equal((await f.call('manifest',{cookie:'__Host-elizabet_admin='+issueSession(config,Date.now()-9*3600000)})).status,401);
  assert.equal((await f.call('manifest',{},'POST')).status,405);
});
test('Cambio concurrente interrumpe el archivo y cambia la huella del manifiesto',async()=>{
  const f=await fixture(),entry=f.backup.entries[0];
  await f[entry.store].set(entry.key,'{}');
  assert.equal((await f.call('item?'+new URLSearchParams({store:entry.store,key:entry.key,etag:entry.etag}))).status,409);
  const next=await(await f.call('manifest')).json();assert.notEqual(next.manifestHash,f.backup.manifestHash);
});
test('Detecta daño, duplicados, inventario ausente y una lista alterada',async()=>{
  const {backup}=await fixture();
  const bad=structuredClone(backup);bad.entries[0].base64=Buffer.from('roto').toString('base64');assert.throws(()=>validateBackup(bad));
  const metadata=structuredClone(backup);metadata.entries[0].metadata.changed=true;assert.throws(()=>validateBackup(metadata),/metadatos/);
  const duplicate=structuredClone(backup);duplicate.entries.push(duplicate.entries[0]);assert.throws(()=>validateBackup(duplicate),/repetidas/);
  const missing=structuredClone(backup);missing.entries=missing.entries.filter(e=>e.key!=='inventory/catalog-v2');missing.manifestHash=manifestHash(missing.entries);assert.throws(()=>validateBackup(missing),/inventario/);
  const edited=structuredClone(backup);edited.manifestHash='0'.repeat(64);assert.throws(()=>validateBackup(edited),/huella/);
});
test('No admite restaurar en almacenes reales ni en destinos ocupados',async()=>{
  const {backup}=await fixture();const stores={records:new Store(),photos:new Store()};
  await assert.rejects(restoreToStores(backup,stores,{records:'elizabet-registros-v1',photos:'elizabet-fotos-v1'}),/separado/);
  assert.equal(stores.records.map.size,0);
  await stores.records.set('existing','{}');
  await assert.rejects(restoreToStores(backup,stores,{records:'azul-restauracion-r',photos:'azul-restauracion-f'}),/vacío/);
  assert.equal(stores.records.map.size,1);
});
test('Las sesiones se invalidan con otra contraseña o secreto y rechazan sufijos',()=>{
  const token=issueSession(config),request=token=>new Request('https://shop.test',{headers:{cookie:'__Host-elizabet_admin='+token}});
  assert.ok(sessionUser(request(token),config));
  assert.equal(sessionUser(request(token),{...config,ADMIN_PASSWORD_HASH:config.ADMIN_PASSWORD_HASH.replace(/2/g,'3')}),null);
  assert.equal(sessionUser(request(token),{...config,SESSION_SECRET:'b'.repeat(64)}),null);
  assert.equal(sessionUser(request(token+'.extra'),config),null);
});

test('Pantalla: descarga una copia verificable y valida un archivo local sin subirlo',async()=>{
  const {readFile}=await import('node:fs/promises');
  const {runInNewContext}=await import('node:vm');
  const {webcrypto}=await import('node:crypto');
  const f=await fixture(), elements=new Map();let downloaded;
  for(const id of ['download','cancel','status','file','validation']) elements.set(id,{hidden:false,disabled:false,textContent:'',files:[]});
  const document={getElementById:id=>elements.get(id),body:{appendChild(){}},createElement:()=>({click(){},remove(){}})};
  const source=await readFile(new URL('../public/backup.js',import.meta.url),'utf8');
  runInNewContext(source,{
    document,crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,Blob,AbortController,URLSearchParams,
    atob,URL:{createObjectURL(blob){downloaded=blob;return 'blob:test'},revokeObjectURL(){}},setTimeout(){},
    fetch:async url=>f.call(url.replace('/api/backup/',''))
  });
  await elements.get('download').onclick();
  assert.ok(downloaded,elements.get('status').textContent);
  assert.equal(validateBackup(JSON.parse(await downloaded.text())).entries,3);
  elements.get('file').files=[downloaded];
  await elements.get('file').onchange();
  assert.match(elements.get('validation').textContent,/Integridad comprobada/);
  assert.equal(elements.get('file').disabled,false);
});
test('Pantalla: no descarga una copia si cambió el inventario durante la exportación',async()=>{
  const {readFile}=await import('node:fs/promises');const {runInNewContext}=await import('node:vm');const {webcrypto}=await import('node:crypto');
  const f=await fixture(), elements=new Map();let manifests=0,downloaded=false;
  for(const id of ['download','cancel','status','file','validation'])elements.set(id,{});
  runInNewContext(await readFile(new URL('../public/backup.js',import.meta.url),'utf8'),{
    document:{getElementById:id=>elements.get(id)},crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,Blob,AbortController,URLSearchParams,atob,
    URL:{createObjectURL(){downloaded=true}},setTimeout(){},
    fetch:async url=>{
      if(url.endsWith('/manifest')&&++manifests===2)await f.records.set('inventory/catalog-v2','{}');
      return f.call(url.replace('/api/backup/',''));
    }
  });
  await elements.get('download').onclick();
  assert.equal(downloaded,false);assert.match(elements.get('status').textContent,/cambió/);
});
