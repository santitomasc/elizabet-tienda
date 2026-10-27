import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {createShop,safe} from '../lib/shop.mjs';
import {issueSession} from '../lib/auth.mjs';
import {createPaymentPractice} from '../lib/payment-practice.mjs';

class MemoryStore {
  map = new Map(); version = 0;
  async get(key,{type}={}) {const value=this.map.get(key);return value ? type==='json'?structuredClone(value.data):JSON.stringify(value.data) : null;}
  async getWithMetadata(key) {const value=this.map.get(key);return value?{data:structuredClone(value.data),etag:value.etag,metadata:{}}:null;}
  async setJSON(key,data,options={}) {
    if (options.onlyIfNew&&this.map.has(key) || options.onlyIfMatch&&this.map.get(key)?.etag!==options.onlyIfMatch) return {modified:false};
    this.map.set(key,{data:structuredClone(data),etag:String(++this.version)});return {modified:true};
  }
  async list({prefix}) {return {blobs:[...this.map.keys()].filter(key=>key.startsWith(prefix)).map(key=>({key}))};}
}
const baseConfig = {ADMIN_USER:'practice-admin',ADMIN_PASSWORD_HASH:'pbkdf2$600000$'+'a'.repeat(32)+'$'+'b'.repeat(64),SESSION_SECRET:randomBytes(48).toString('hex'),MERCADOPAGO_ACCESS_TOKEN:'APP_USR-fake-test-fixture-only'};
async function fixture(extra={}) {
  const records=new MemoryStore(), config={...baseConfig,...extra}, calls=[], state={test:true,site:'MLA',payment:{},invalidUrl:false,fail:false};
  const product={id:randomUUID(),name:'Remera de prueba',active:true,sample:true,price:18000,category:'Remeras',photos:['/assets/shirt.jpg'],variants:[{size:'M',stock:5}]};
  await records.setJSON('products/'+product.id,product);await records.setJSON('settings/initialized',true);
  const shop=createShop({records,photos:new MemoryStore(),config});
  const products=async()=> (await (await shop.catalog()).json()).products;
  const fetcher=async(url,options)=> {
    calls.push({url,options}); if(state.fail) return Response.json({message:config.MERCADOPAGO_ACCESS_TOKEN},{status:401});
    if(url.endsWith('/users/me'))return Response.json({id:123,site_id:state.site,tags:state.test?['test_user']:['normal']});
    if(url.endsWith('/checkout/preferences'))return Response.json({id:'pref-practice',collector_id:123,init_point:state.invalidUrl?'https://evil.test/checkout':'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-practice',sandbox_init_point:'https://sandbox.mercadopago.com/fake'});
    if(url.includes('/v1/payments/'))return Response.json(state.payment);
    throw Error('Unexpected API route');
  };
  const service=createPaymentPractice({records,config,listProducts:products,fetcher});
  const cookie='__Host-elizabet_admin='+issueSession(config);
  async function req(path,body,options={}) {
    const headers={...(options.auth===false?{}:{cookie}),...options.headers};
    if(body)headers['content-type']='application/json';
    const request=new Request('https://shop.test'+path,{method:options.method||(body?'POST':'GET'),headers,body:body?JSON.stringify(body):undefined});
    const response=await safe(()=>service.handle(request));return {status:response.status,data:await response.json()};
  }
  const startBody=(extra={})=>({key:randomUUID(),items:[{id:product.id,size:'M',qty:2}],...extra});
  const start=body=>req('/api/practice/checkout',body||startBody());
  const verify=(key,paymentId='789')=>req('/api/practice/verify',{key,paymentId,status:'approved'});
  const setPayment=(key,extra={})=>state.payment={id:789,status:'approved',live_mode:false,collector_id:123,external_reference:'ELZ-PRACTICA-'+key,currency_id:'ARS',transaction_amount:36000,...extra};
  return {records,config,calls,state,product,products,req,startBody,start,verify,setPayment};
}
test('La práctica requiere sesión de administrador; rechaza CSRF antes de llamar a Mercado Pago',async()=>{
  const f=await fixture();const body=f.startBody();
  assert.equal((await f.req('/api/practice/checkout',body,{auth:false})).status,401);
  assert.equal((await f.req('/api/practice/checkout',body,{headers:{origin:'https://evil.test'}})).status,403);
  assert.equal((await f.req('/api/practice/verify',{key:body.key,paymentId:'789'},{auth:false})).status,401);
  assert.equal(f.calls.length,0);
  const status=await f.req('/api/practice/status',undefined,{auth:false});assert.deepEqual(status.data,{practice:true,admin:false,configured:true});assert.ok(!JSON.stringify(status).includes(f.config.MERCADOPAGO_ACCESS_TOKEN));
});
test('Falta de token, vendedor real o país incorrecto bloquean preferencias',async()=>{
  const missing=await fixture({MERCADOPAGO_ACCESS_TOKEN:''});assert.equal((await missing.start()).status,503);assert.equal(missing.calls.length,0);
  const f=await fixture();f.state.test=false;assert.equal((await f.start()).status,409);f.state.test=true;f.state.site='MLB';assert.equal((await f.start()).status,409);
  assert.equal(f.calls.filter(c=>c.url.endsWith('/checkout/preferences')).length,0);
});
test('Precio y total salen del catálogo; admite muestras solo en práctica y conserva stock/pedidos',async()=>{
  const f=await fixture(),before=await f.products();const body=f.startBody({price:1,total:1});body.items.push({...body.items[0],qty:1,price:1});
  const result=await f.start(body);assert.equal(result.status,201);assert.equal(result.data.total,54000);
  const sent=JSON.parse(f.calls.find(c=>c.url.endsWith('/checkout/preferences')).options.body);
  assert.equal(sent.items.length,1);assert.equal(sent.items[0].quantity,3);assert.equal(sent.items[0].unit_price,18000);assert.equal(sent.items[0].currency_id,'ARS');
  assert.match(sent.back_urls.success,/^https:\/\/shop.test\/practica.html\?ensayo=/);assert.equal(sent.external_reference,'ELZ-PRACTICA-'+body.key);
  assert.match(result.data.url,/www.mercadopago.com.ar/);assert.ok(!result.data.url.includes('sandbox'));
  assert.deepEqual(await f.products(),before);assert.equal((await f.records.list({prefix:'orders/'})).blobs.length,0);
});
test('Reenvío del mismo carrito reutiliza el enlace y rechaza cambios con la misma clave',async()=>{
  const f=await fixture(),body=f.startBody();const a=await f.start(body),b=await f.start(body);assert.equal(a.data.url,b.data.url);assert.equal(b.status,200);
  body.items[0].qty=1;assert.equal((await f.start(body)).status,409);assert.equal(f.calls.filter(c=>c.url.endsWith('/checkout/preferences')).length,1);
});
test('Doble solicitud simultánea crea como máximo una preferencia',async()=>{
  const f=await fixture(),body=f.startBody();const results=await Promise.all([f.start(body),f.start(body)]);
  assert.ok(results.some(r=>r.status===201));assert.ok(results.every(r=>[200,201,409].includes(r.status)));
  assert.equal(f.calls.filter(c=>c.url.endsWith('/checkout/preferences')).length,1);
});
test('Cantidades, stock y productos se validan antes de preparar el pago',async()=>{
  const f=await fixture();for(const items of [[],[null],[{id:f.product.id,size:'M',qty:0}],[{id:f.product.id,size:'M',qty:6}],[{id:f.product.id,size:'Z',qty:1}],[{id:'missing',size:'M',qty:1}]]) {
    assert.ok((await f.start(f.startBody({items}))).status>=400);
  }
  assert.equal(f.calls.length,0);
});
test('Verificación consulta la API; no confía en el estado aprobado recibido del navegador',async()=>{
  const f=await fixture(),body=f.startBody();await f.start(body);f.setPayment(body.key,{status:'rejected'});
  const result=await f.verify(body.key);assert.equal(result.status,200);assert.equal(result.data.status,'rejected');
  assert.ok(f.calls.some(c=>c.url.endsWith('/v1/payments/789')));
});
test('Verificación rechaza pagos reales, de otro vendedor, otra referencia, moneda o importe',async()=>{
  const f=await fixture(),body=f.startBody();await f.start(body);
  for(const changes of [{live_mode:true},{live_mode:null},{collector_id:456},{external_reference:'otra'},{currency_id:'USD'},{transaction_amount:1},{id:999}]) {
    f.setPayment(body.key,changes);assert.equal((await f.verify(body.key)).status,409);
  }
  assert.equal((await f.records.list({prefix:'payment-practice-results/'})).blobs.length,0);
});
test('Pago de prueba aprobado y verificación repetida no descuentan prendas ni crean pedidos',async()=>{
  const f=await fixture(),before=await f.products(),body=f.startBody();await f.start(body);f.setPayment(body.key);
  assert.equal((await f.verify(body.key)).data.status,'approved');assert.equal((await f.verify(body.key)).status,200);
  assert.deepEqual(await f.products(),before);assert.equal((await f.records.list({prefix:'orders/'})).blobs.length,0);
  assert.equal((await f.records.list({prefix:'payment-practice-results/'})).blobs.length,1);
});
test('Errores de proveedor no revelan el token y enlaces externos son rechazados',async()=>{
  const f=await fixture();f.state.fail=true;const failed=await f.start();assert.equal(failed.status,503);assert.ok(!JSON.stringify(failed).includes(f.config.MERCADOPAGO_ACCESS_TOKEN));
  f.state.fail=false;f.state.invalidUrl=true;assert.equal((await f.start()).status,502);
});
