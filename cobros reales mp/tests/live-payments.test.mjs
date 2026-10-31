import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {safe} from '../lib/shop.mjs';
import {fixture} from './support/live-fixture.mjs';

test('Orders checkout uses server prices, decimal strings, one idempotency key and an atomic basket reservation',async()=>{
 const f=await fixture(),b=f.body(undefined,{total:1});const all=await Promise.all([f.create(b),f.create(b)]);assert.ok(all.every(r=>r.data.id===b.key));assert.equal(f.created,1);assert.equal(await f.stockLeft(),2);
 const saved=await f.create(b);assert.equal(saved.data.total,18000);assert.ok(saved.data.url.includes('order_id=ORD'));assert.equal(f.created,1);
 assert.equal((await f.create({...b,email:'another@example.test'})).status,409);
 const request=f.seen.find(x=>x.path==='/v1/orders'&&x.options.method==='POST'),posted=JSON.parse(request.options.body);
 assert.equal(request.options.headers['X-Idempotency-Key'],b.key);assert.equal(posted.total_amount,'18000.00');assert.equal(posted.items[0].unit_price,'18000.00');assert.equal(posted.processing_mode,'manual');assert.equal(posted.capture_mode,'automatic');assert.equal(posted.expiration_time,'PT30M');assert.ok(posted.config.online.success_url.includes(saved.data.proof));assert.equal(posted.back_urls,undefined);
 assert.equal(f.seen.some(x=>x.path.startsWith('/checkout/preferences')),false);
});
test('Concurrent buyers cannot both reserve the last unit',async()=>{
 const f=await fixture({stock:1}),r=await Promise.all([f.create(),f.create()]);assert.deepEqual(r.map(x=>x.status).sort(),[201,409]);assert.equal(await f.stockLeft(),0);assert.equal(f.created,1);
});
test('Production gate blocks previews, disabled payments, test sellers, CSRF and illustrative products',async()=>{
 for(const options of [{extraConfig:{MERCADOPAGO_LIVE_ENABLED:'false'}},{environment:'deploy-preview'},{testSeller:true}]){const f=await fixture(options);assert.ok((await f.create()).status>=400);assert.equal(f.created,0);assert.equal(await f.stockLeft(),3);}
 const f=await fixture();assert.equal((await f.call('/api/checkout/create','POST',f.body(),{origin:'https://evil.test'})).status,403);await f.shop.inventory.change(d=>d.products[0].sample=true);assert.equal((await f.create()).status,409);
});
test('API lookup detects a paid order but fulfillment waits for an authentic order notification',async()=>{
 const f=await fixture(),a=(await f.create()).data,p=await f.update(a);await f.service.reconcile(a.id);let o=await f.stored(a.id);assert.equal(o.paymentStatus,'confirming');assert.equal(o.everPaid,true);
 await assert.rejects(f.shop.inventory.transition({id:a.id},'En preparación','Nuevo'),/todavía no está aprobado/);
 assert.equal((await f.notify(p)).status,200);o=await f.stored(a.id);assert.equal(o.paymentStatus,'approved');assert.equal(o.payment_notified,true);assert.equal(await f.stockLeft(),2);
});
test('Repeated notifications do not re-deduct stock and a stale approval cannot overwrite a refund',async()=>{
 const f=await fixture(),a=(await f.create()).data,p=await f.update(a),old=structuredClone(p);await f.notify(p);await f.notify(p);assert.equal(await f.stockLeft(),2);
 f.advance(20000);const refund=await f.update(a,'refunded','refunded',{total_paid_amount:'0.00',transactions:{payments:[],refunds:[{id:'REF1',amount:'18000.00',status:'processed'}]}});await f.notify(refund);await f.service.applyOrder(old,{fromWebhook:true});assert.equal((await f.stored(a.id)).paymentStatus,'refunded');assert.equal(await f.stockLeft(),2);
});
test('Invalid signatures, expired signatures and false test notifications never approve a real order',async()=>{
 const f=await fixture(),a=(await f.create()).data,p=await f.update(a);
 for(const options of [{signature:'ts=1793458800000,v1='+'0'.repeat(64)},{ts:'1000000000'},{live_mode:false},{user_id:'999'},{topic:'payment'}])assert.ok((await f.notify(p,options)).status>=400);
 assert.notEqual((await f.stored(a.id)).paymentStatus,'approved');assert.equal(await f.stockLeft(),2);
 // SDK contract: the HMAC uses the raw data.id without case transformations.
 assert.equal((await f.notify(p,{rawId:p.id.toLowerCase(),ts:String(Math.floor(Date.parse('2026-10-31T15:00:00Z')/1000))})).status,200);
});
test('Order binding checks seller, reference, currency, amount, processing mode and test identifiers',async()=>{
 const f=await fixture(),a=(await f.create()).data,p=await f.update(a);
 for(const extra of [{user_id:'999'},{external_reference:'AZUL-'+randomUUID()},{currency:'USD'},{country_code:'BRA'},{total_amount:'1.00'},{total_amount:18000},{processing_mode:'automatic'},{live_mode:false},{id:p.id.replace('ORD','ORDTST')}]){
  await assert.rejects(f.service.applyOrder({...p,...extra},{expectedId:a.id,fromWebhook:true}),/no coincide|otra compra/);
 }
 assert.notEqual((await f.stored(a.id)).paymentStatus,'approved');
});
test('A terminal rejection frees its reservation once and allows starting a new purchase',async()=>{
 const f=await fixture(),a=(await f.create()).data,p=await f.update(a,'failed','rejected_by_issuer');await f.notify(p);await f.service.reconcile(a.id);await f.service.reconcile(a.id);assert.equal(await f.stockLeft(),3);
 const r=await f.call('/api/checkout/status?'+new URLSearchParams({key:a.id,proof:a.proof}));assert.equal(r.data.retryAllowed,true);assert.equal(r.data.url,null);
});
test('Expired created orders are canceled with a separate stable key, then read back before stock is released',async()=>{
 const f=await fixture(),a=(await f.create()).data;f.advance(46*60000);await f.service.reconcile(a.id);await f.service.reconcile(a.id);assert.equal(await f.stockLeft(),3);
 const cancel=f.seen.find(x=>x.path.endsWith('/cancel'));assert.ok(cancel.options.headers['X-Idempotency-Key']);assert.notEqual(cancel.options.headers['X-Idempotency-Key'],a.id);const providerId=(await f.stored(a.id)).mp_order_id;assert.ok(f.seen.slice(f.seen.indexOf(cancel)+1).some(x=>x.path.endsWith(providerId)));
});
test('A failed cancellation or processing payment keeps stock reserved',async()=>{
 const f=await fixture({failCancel:true}),a=(await f.create()).data;f.advance(46*60000);await assert.rejects(f.service.reconcile(a.id));assert.equal(await f.stockLeft(),2);
 const g=await fixture(),b=(await g.create()).data;await g.update(b,'processing','in_process');g.advance(46*60000);await g.service.reconcile(b.id);assert.equal(await g.stockLeft(),2);assert.equal(g.seen.some(x=>x.path.endsWith('/cancel')),false);
});
test('A timeout after creation is recovered through Orders search without another POST',async()=>{
 const f=await fixture({failCreate:true}),a=await f.create();assert.equal(a.status,202);assert.equal(a.data.url,null);await f.service.reconcile(a.data.id);assert.equal(f.created,1);assert.equal(f.seen.filter(x=>x.path==='/v1/orders'&&x.options.method==='POST').length,1);
 const o=await f.stored(a.data.id);assert.ok(o.mp_order_id);assert.ok(o.url.includes('order_id='));assert.equal(await f.stockLeft(),2);
 const query=new URLSearchParams(f.seen.find(x=>x.path==='/v1/orders'&&!x.options.method).query);assert.ok(query.get('begin_date'));assert.ok(query.get('end_date'));assert.equal(query.get('external_reference'),'AZUL-'+a.data.id);
});
test('Uncertain requests with no searchable order keep stock, while an explicit provider rejection frees it',async()=>{
 const f=await fixture({failCreate:true}),a=(await f.create()).data;f.orders.clear();f.advance(46*60000);await f.service.reconcile(a.id);assert.equal(await f.stockLeft(),2);assert.equal((await f.stored(a.id)).paymentStatus,'uncertain');
 const g=await fixture({denyCreate:true}),b=await g.create();assert.equal(b.status,202);assert.equal(await g.stockLeft(),3);assert.equal(g.created,0);
});
test('Partial refunds, chargebacks and mismatched paid amounts block delivery without returning stock automatically',async()=>{
 for(const [status,detail,extra] of [['processed','partially_refunded',{}],['processed','accredited',{transactions:{payments:[],chargebacks:[{id:'CBK1'}]}}],['processed','accredited',{total_paid_amount:'17999.00'}]]){
  const f=await fixture(),a=(await f.create()).data,p=await f.update(a,status,detail,extra);await f.notify(p);const o=await f.stored(a.id);assert.ok(['review','charged_back'].includes(o.paymentStatus));assert.equal(await f.stockLeft(),2);await assert.rejects(f.shop.inventory.transition({id:a.id},'En preparación','Nuevo'));
 }
});
test('The authenticated panel can prepare and deliver paid Orders records without legacy orders blobs or a second stock deduction',async()=>{
 const f=await fixture(),a=(await f.create()).data;await f.notify(await f.update(a));
 const req=(status,previousStatus)=>new Request('https://shop.test/api/admin/orders/'+a.id,{method:'PUT',headers:{cookie:f.cookie,'content-type':'application/json'},body:JSON.stringify({status,previousStatus})});
 for(const [status,previous] of [['En preparación','Nuevo'],['Entregado','En preparación']]){const response=await safe(()=>f.shop.admin(req(status,previous)));assert.equal(response.status,200,await response.clone().text());}
 assert.equal(await f.stockLeft(),2);assert.equal((await safe(()=>f.shop.admin(req('Cancelado','Entregado')))).status,400);
});
test('Receipts need their private proof, ignore URL status and numeric payment IDs, and do not expose customer information',async()=>{
 const f=await fixture(),a=(await f.create()).data;assert.equal((await f.call('/api/checkout/status?key='+a.id+'&proof=wrong&status=approved')).status,404);
 const r=await f.call('/api/checkout/verify','POST',{key:a.id,proof:a.proof,paymentId:'100',status:'approved'});assert.equal(r.data.paid,false);assert.equal(r.data.customer,undefined);assert.equal(r.data.email,undefined);assert.equal(r.data.payments,undefined);
 assert.equal((await f.call('/api/checkout/admin/status')).status,401);const status=await f.call('/api/checkout/admin/status','GET',undefined,{cookie:f.cookie});assert.equal(status.status,200);assert.equal(status.data.integration,'orders');
});
test('A late approval cannot oversell a reservation already given to another buyer',async()=>{
 const f=await fixture({stock:1}),a=(await f.create()).data;f.advance(46*60000);await f.service.reconcile(a.id);await f.create();await f.notify(await f.update(a));const o=await f.stored(a.id);assert.equal(o.stockHeld,false);assert.match(o.review,/ya no hay stock/);assert.equal(await f.stockLeft(),0);
});
