import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createShop,safe} from '../lib/shop.mjs';
import {hashPassword,issueSession,sessionUser} from '../lib/auth.mjs';

// Contract adapter for Blobs, including atomic ETag compare-and-swap. No live data.
class MemoryStore {
  map=new Map(); version=0; conflicts=0;
  async get(key,{type}={}) {const o=this.map.get(key);return !o?null:type==='json'?structuredClone(o.json):o.bytes||JSON.stringify(o.json);}
  async setJSON(key,json,options={}) {
    if(options.onlyIfNew&&this.map.has(key))return {modified:false};
    if(options.onlyIfMatch&&(this.map.get(key)?.etag!==options.onlyIfMatch||this.conflicts-->0))return {modified:false};
    const etag=String(++this.version);this.map.set(key,{json:structuredClone(json),etag});return {modified:true,etag};
  }
  async set(key,bytes,options={}) {if(options.onlyIfNew&&this.map.has(key))return {modified:false};this.map.set(key,{bytes:bytes.slice(0),metadata:options.metadata,etag:String(++this.version)});return {modified:true};}
  async getWithMetadata(key,{type}={}) {const v=this.map.get(key);return v?{data:type==='json'?structuredClone(v.json):v.bytes,metadata:v.metadata,etag:v.etag}:null;}
  async list({prefix}) {return {blobs:[...this.map.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key}))};}
  async delete(key) {this.map.delete(key);}
}
const password='test-only-long-password',config={ADMIN_USER:'elizabet',ADMIN_PASSWORD_HASH:await hashPassword(password),SESSION_SECRET:randomBytes(48).toString('hex')};
function fixture(records=new MemoryStore()) {
  const photos=new MemoryStore(),shop=createShop({records,photos,config});
  const cookie='__Host-elizabet_admin='+issueSession(config);
  async function req(path,method='GET',body,{auth=true,origin}={}) {
    const headers={...(auth?{cookie}:{}),...(origin?{origin}:{})};
    if(body)headers['content-type']=body instanceof Uint8Array?'image/jpeg':'application/json';
    const request=new Request('https://tienda.test'+path,{method,headers,body:body?(body instanceof Uint8Array?body:JSON.stringify(body)):undefined});
    const handler=path.startsWith('/api/auth/')?shop.auth:path.startsWith('/api/admin/')?shop.admin:path==='/api/orders'?shop.order:path.startsWith('/media/')?shop.media:shop.catalog;
    const r=await safe(()=>handler(request));const data=r.headers.get('content-type')?.includes('json')?await r.json():new Uint8Array(await r.arrayBuffer());return {r,data};
  }
  const catalog=async()=> (await req('/api/catalog')).data.products;
  const find=async id=>(await catalog()).find(p=>p.id===id);
  const add=async(stock=3,extra={})=>(await req('/api/admin/products','POST',{name:'Remera',price:18000,category:'Remeras',photos:['/assets/shirt.jpg'],variants:[{size:'M',stock}],active:true,sample:false,...extra})).data.product;
  const place=async items=>{await req('/api/admin/settings','PUT',{acceptOrders:true});const id=randomUUID();const result=await req('/api/orders','POST',{key:id,customer:'Compradora',phone:'5491112345678',delivery:'Retiro',items,total:1},{auth:false});assert.equal(result.r.status,201);return id;};
  const status=async(id,status,previousStatus='Nuevo')=>req('/api/admin/orders/'+id,'PUT',{status,previousStatus});
  return {req,find,add,place,status,records,catalog};
}

test('Acceso, cookies, vencimiento, firma y CSRF',async()=>{
  const {req}=fixture();assert.equal((await req('/api/admin/bootstrap','GET',undefined,{auth:false})).r.status,401);
  assert.equal((await req('/api/auth/login','POST',{user:'elizabet',password:'wrong'})).r.status,401);
  assert.equal((await req('/api/auth/login','POST',{user:'elizabet',password},{origin:'https://otra.test'})).r.status,403);
  const login=await req('/api/auth/login','POST',{user:'elizabet',password});assert.equal(login.r.status,200);assert.match(login.r.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);
  assert.equal(sessionUser(new Request('https://tienda.test',{headers:{cookie:'__Host-elizabet_admin='+issueSession(config,0)}}),config),null);
  assert.equal(sessionUser(new Request('https://tienda.test',{headers:{cookie:'__Host-elizabet_admin='+issueSession(config)+'bad'}}),config),null);
  assert.equal((await req('/api/auth/logout','GET')).r.status,405);
});
test('Fotos, CRUD y validación de productos con revisión',async()=>{
  const {req,add,find}=fixture();const img=new Uint8Array(readFileSync('public/assets/shirt.jpg'));
  const upload=await req('/api/admin/upload','POST',img);assert.equal(upload.r.status,201);assert.equal((await req(upload.data.url)).data.length,img.length);
  assert.equal((await req('/api/admin/upload','POST',new Uint8Array(20))).r.status,400);
  const p=await add(2,{photos:[upload.data.url]});assert.equal(p.stock,2);
  assert.equal((await req('/api/admin/products/'+p.id,'PUT',{...p,price:19000})).r.status,200);const latest=await find(p.id);assert.equal(latest.price,19000);
  assert.equal((await req('/api/admin/products/'+p.id,'PUT',{...latest,price:-2})).r.status,400);
  assert.equal((await req('/api/admin/products/'+p.id,'PUT',{...latest,variants:[{size:'S',stock:1},{size:'s',stock:1}]})).r.status,400);
  assert.equal((await req('/api/admin/products/'+p.id,'DELETE',{revision:latest.revision})).r.status,200);assert.equal(await find(p.id),undefined);
});
test('Confirmar descuenta por talle una sola vez; cancelar repone una sola vez',async()=>{
  const {req,add,place,status,find}=fixture();const p=await add(5,{variants:[{size:'M',stock:5},{size:'L',stock:8}]});
  const id=await place([{id:p.id,size:'M',qty:2}]);assert.equal((await find(p.id)).stock,13);
  const orders=(await req('/api/admin/bootstrap')).data.orders;assert.equal(orders[0].total,36000);
  assert.equal((await status(id,'En preparación')).r.status,200);assert.deepEqual((await find(p.id)).variants,[{size:'M',stock:3},{size:'L',stock:8}]);
  assert.equal((await status(id,'En preparación')).r.status,200);assert.equal((await find(p.id)).stock,11);
  assert.equal((await status(id,'Entregado','En preparación')).r.status,200);assert.equal((await find(p.id)).stock,11);
  assert.equal((await status(id,'Cancelado','Entregado')).r.status,200);assert.equal((await find(p.id)).stock,13);
  assert.equal((await status(id,'Cancelado','Entregado')).r.status,200);assert.equal((await find(p.id)).stock,13);
  assert.equal((await status(id,'En preparación','Cancelado')).r.status,400);
});
test('Dos confirmaciones simultáneas de la última unidad: solo una vende',async()=>{
  const f=fixture(),p=await f.add(1),a=await f.place([{id:p.id,size:'M',qty:1}]),b=await f.place([{id:p.id,size:'M',qty:1}]);
  const other=fixture(f.records);const result=await Promise.all([f.status(a,'En preparación'),other.status(b,'En preparación')]);
  assert.deepEqual(result.map(x=>x.r.status).sort(),[200,409]);assert.equal((await f.find(p.id)).stock,0);
  const orders=(await f.req('/api/admin/bootstrap')).data.orders;assert.equal(orders.filter(o=>o.stockDeducted).length,1);
});
test('Confirmación simultánea del mismo pedido y reintentos no duplican movimientos',async()=>{
  const f=fixture(),p=await f.add(4),id=await f.place([{id:p.id,size:'M',qty:2}]);f.records.conflicts=2;
  const results=await Promise.all([f.status(id,'En preparación'),fixture(f.records).status(id,'En preparación')]);assert.ok(results.every(r=>r.r.status===200));assert.equal((await f.find(p.id)).stock,2);
  const cancelled=await Promise.all([f.status(id,'Cancelado','En preparación'),fixture(f.records).status(id,'Cancelado','En preparación')]);assert.ok(cancelled.every(r=>r.r.status===200));assert.equal((await f.find(p.id)).stock,4);
});
test('Carrito completo atómico, edición vieja rechazada y venta agotada bloqueada',async()=>{
  const f=fixture(),a=await f.add(3),b=await f.add(1),id=await f.place([{id:a.id,size:'M',qty:2},{id:b.id,size:'M',qty:1}]);
  const competing=await f.place([{id:b.id,size:'M',qty:1}]);await f.status(competing,'Entregado');
  assert.equal((await f.status(id,'En preparación')).r.status,409);assert.equal((await f.find(a.id)).stock,3);assert.equal((await f.find(b.id)).stock,0);
  assert.equal((await f.req('/api/admin/products/'+b.id,'PUT',{...b,price:20000})).r.status,409);
  assert.equal((await f.req('/api/orders','POST',{key:randomUUID(),customer:'Compradora',phone:'5491112345678',delivery:'Retiro',items:[{id:b.id,size:'M',qty:1}]},{auth:false})).r.status,400);
  const live=await f.find(b.id);assert.equal((await f.req('/api/admin/products/'+b.id,'DELETE',{revision:live.revision})).r.status,400);
});
test('Migración preserva stock y pedidos anteriores confirmados no se descuentan otra vez',async()=>{
  const records=new MemoryStore();const p={id:randomUUID(),name:'Propia',price:12000,category:'Remeras',photos:['/assets/shirt.jpg'],variants:[{size:'M',stock:7}],active:true,sample:false};
  await records.setJSON('products/'+p.id,p);await records.setJSON('settings/initialized',true);
  const id=randomUUID();await records.setJSON('orders/'+id,{id,status:'En preparación',created_at:new Date().toISOString(),items:[{id:p.id,name:p.name,size:'M',qty:2}]});
  const f=fixture(records);assert.equal((await f.find(p.id)).stock,7);assert.equal((await f.catalog()).length,1);
  await f.status(id,'Entregado','En preparación');assert.equal((await f.find(p.id)).stock,7);
  await f.status(id,'Cancelado','Entregado');assert.equal((await f.find(p.id)).stock,7);
  assert.equal((await f.req('/api/admin/bootstrap')).data.orders[0].legacyStock,true);
});
test('Doble envío de carrito conserva pedido y pendientes no reservan stock',async()=>{
  const f=fixture(),p=await f.add(2);await f.req('/api/admin/settings','PUT',{acceptOrders:true});
  const body={key:randomUUID(),customer:'Compradora',phone:'5491112345678',delivery:'Retiro',items:[{id:p.id,size:'M',qty:1}]};
  const placed=await f.req('/api/orders','POST',body,{auth:false}),again=await f.req('/api/orders','POST',body,{auth:false});assert.equal(placed.data.order.code,again.data.order.code);
  assert.equal((await f.req('/api/admin/bootstrap')).data.orders.length,1);assert.equal((await f.find(p.id)).stock,2);
});
