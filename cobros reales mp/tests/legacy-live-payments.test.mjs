import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHmac} from 'node:crypto';
import {createLivePayments as createLegacyPayments} from '../lib/legacy-live-payments.mjs';
import {createLivePayments} from '../lib/live-payments.mjs';
import {safe} from '../lib/shop.mjs';
import {fixture} from './support/live-fixture.mjs';
async function legacyFixture(){
 const f=await fixture(),id=randomUUID(),o={id,code:'AZUL-ANTERIOR',items:[{id:f.product.id,size:'XL',qty:1,name:'Remera',price:18000}],total:18000,customer:'Compradora anterior',phone:'1112345678',fingerprint:'old-fingerprint',seller:'456',created_at:'2026-10-30T15:00:00Z',expires_at:'2026-11-01T15:00:00Z',preference_id:'old-pref',url:'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=old',paymentStatus:'awaiting',stockHeld:true,payments:{}};
 await f.shop.inventory.change(d=>{d.checkouts={[id]:o};d.products[0].variants[0].stock=2;d.orders[id]={status:'Nuevo',deducted:true,legacy:false,items:o.items,paymentManaged:true};});
 const payment={id:'100',external_reference:'AZUL-'+id,collector_id:456,live_mode:true,currency_id:'ARS',transaction_amount:18000,status:'approved',date_last_updated:'2026-10-31T15:00:00Z'};
 const fetcher=async(url,options)=>{if(url.endsWith('/v1/payments/100'))return Response.json(payment);return f.fetcher(url,options);};
 const service=createLivePayments({records:f.records,inventory:f.shop.inventory,settings:f.shop.settings,config:f.config,fetcher,now:()=>Date.parse('2026-10-31T15:00:00Z')});
 const proof=createHmac('sha256',f.config.SESSION_SECRET).update('azul-checkout:'+id+':'+o.fingerprint).digest('hex');return {...f,id,o,payment,fetcher,service,proof};
}
test('Historical receipts stay private and readable after the Orders migration',async()=>{
 const f=await legacyFixture();const r=await f.service.handle(new Request('https://shop.test/api/checkout/status?'+new URLSearchParams({key:f.id,proof:f.proof})));const data=await r.json();assert.equal(r.status,200);assert.equal(data.code,'AZUL-ANTERIOR');assert.equal(data.customer,undefined);assert.equal(await f.stockLeft(),2);
});
test('Historical payment notifications still confirm existing preference purchases once',async()=>{
 const f=await legacyFixture(),ts='1793458800000',rid='old-notification',sig=createHmac('sha256',f.config.MERCADOPAGO_WEBHOOK_SECRET).update(`id:100;request-id:${rid};ts:${ts};`).digest('hex');
 const req=()=>new Request('https://shop.test/api/checkout/webhook?data.id=100',{method:'POST',headers:{'x-signature':`ts=${ts},v1=${sig}`,'x-request-id':rid},body:JSON.stringify({type:'payment',data:{id:'100'}})});
 assert.equal((await f.service.handle(req())).status,200);assert.equal((await f.service.handle(req())).status,200);assert.equal((await f.stored(f.id)).paymentStatus,'approved');assert.equal(await f.stockLeft(),2);
});
test('The legacy adapter cannot create new preference purchases or approve an Orders checkout using a numeric payment',async()=>{
 const f=await fixture(),a=(await f.create()).data;
 const legacy=createLegacyPayments({records:f.records,inventory:f.shop.inventory,settings:f.shop.settings,config:f.config,fetcher:f.fetcher});
 const r=await safe(()=>legacy.handle(new Request('https://shop.test/api/checkout/create',{method:'POST',body:JSON.stringify(f.body())})));assert.equal(r.status,404);
 await legacy.applyPayment({id:'100',external_reference:'AZUL-'+a.id,collector_id:456,live_mode:true,currency_id:'ARS',transaction_amount:18000,status:'approved',date_last_updated:new Date().toISOString()});assert.equal((await f.stored(a.id)).paymentStatus,'awaiting');assert.equal(await f.stockLeft(),2);
});
