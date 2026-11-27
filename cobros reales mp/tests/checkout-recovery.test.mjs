import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {fixture} from './support/live-fixture.mjs';
import {liveOrderProjection} from '../lib/live-payments.mjs';

const source = name => readFileSync(new URL('../public/' + name, import.meta.url), 'utf8');
class Storage {
  values = new Map();
  getItem(key) {return this.values.get(key) ?? null;}
  setItem(key, value) {this.values.set(key, String(value));}
  removeItem(key) {this.values.delete(key);}
}
function browser(f, sessionStorage = new Storage()) {
  const nodes = new Map(), navigations = [], calls = [];
  const node = key => {
    if (!nodes.has(key)) nodes.set(key, {innerHTML:'',textContent:'',hidden:false,value:'featured',dataset:{},style:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},removeAttribute(){},addEventListener(){},close(){},showModal(){},focus(){},scrollIntoView(){}});
    return nodes.get(key);
  };
  const sandbox = {
    URL, URLSearchParams, Intl, crypto:webcrypto, console,
    sessionStorage, localStorage:new Storage(),
    location:{origin:'https://shop.test',search:'',assign:value=>navigations.push(value)},
    document:{getElementById:id=>node('#'+id),querySelector:node,querySelectorAll:()=>[],addEventListener(){}},
    setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,clearInterval(){},
    FormData:class {constructor(form){return Object.entries(form.data);}},
    async fetch(path, options={}) {
      calls.push({path,method:options.method || 'GET'});
      if (path === '/api/catalog') return f.shop.catalog();
      const response = await f.call(path, options.method || 'GET', options.body ? JSON.parse(options.body) : undefined);
      return Response.json(response.data, {status:response.status});
    }
  };
  sandbox.window=sandbox;
  const context=vm.createContext(sandbox);
  vm.runInContext(source('checkout-recovery.js'),context);
  return {context, node, nodes, navigations, calls, sessionStorage, recovery:context.AzulCheckoutRecovery, run:code=>vm.runInContext(code,context)};
}
const form = (b, button) => ({data:{customer:b.customer,email:b.email,phone:b.phone,delivery:b.delivery,address:'',note:''},querySelector:()=>button});

test('Expired provider notifications restore the last unit once and report expiry instead of cancellation', async()=>{
  const f=await fixture({stock:1}),a=(await f.create()).data;
  f.advance(33*60000);
  const p=await f.update(a,'canceled','expired');
  assert.equal((await f.notify(p)).status,200);
  assert.equal(await f.stockLeft(),1);
  assert.equal((await f.stored(a.id)).paymentStatus,'expired');
  await f.notify(p);
  await f.service.reconcile(a.id);
  assert.equal(await f.stockLeft(),1);
  const state=(await f.call('/api/checkout/status?'+new URLSearchParams({key:a.id,proof:a.proof}))).data;
  assert.equal(state.label,'Enlace vencido');
  assert.equal(state.retryAllowed,true);
  assert.equal(state.reserved,false);
  assert.equal(state.url,null);
  assert.equal(liveOrderProjection(await f.stored(a.id),{}).paymentLabel,'Enlace vencido');
});

test('Historical canceled/expired records display correctly without rewriting stock or orders', async()=>{
  const f=await fixture(),a=(await f.create()).data;
  await f.update(a,'canceled','expired');
  await f.service.reconcile(a.id);
  await f.shop.inventory.change(d=>{d.checkouts[a.id].paymentStatus='cancelled';});
  const stored=await f.stored(a.id),projection=liveOrderProjection(stored,{});
  assert.equal(projection.paymentStatus,'expired');
  assert.equal(projection.paymentLabel,'Enlace vencido');
  assert.equal((await f.stored(a.id)).paymentStatus,'cancelled');
  assert.equal(await f.stockLeft(),3);
  const ordinary={...stored,provider_status_detail:'canceled_transaction'};
  assert.equal(liveOrderProjection(ordinary,{}).paymentLabel,'Pago cancelado');
});

test('An expired record still holding stock is included in the scheduled recovery', async()=>{
  const f=await fixture({stock:1}),a=(await f.create()).data;
  await f.update(a,'canceled','expired');
  await f.shop.inventory.change(d=>{d.checkouts[a.id].paymentStatus='expired';});
  assert.equal((await f.service.sweep()).checked,1);
  assert.equal(await f.stockLeft(),1);
  assert.equal((await f.service.sweep()).checked,0);
});

test('The same buyer resumes the last unit without a false stock warning or a second order', async()=>{
  const f=await fixture({stock:1}),b=f.body(),a=(await f.create(b)).data,u=browser(f);
  u.recovery.remember(a,b.items);
  u.sessionStorage.setItem('azul-checkout-request',JSON.stringify({key:a.id,signature:'original'}));
  await u.run(source('app.js'));
  await u.run('loadCatalog()');
  u.run('cart='+JSON.stringify(b.items)+';updateCart();');
  assert.match(u.node('#products').innerHTML,/RESERVADO PARA VOS/);
  assert.match(u.node('#cartItems').innerHTML,/Reservada para tu compra/);
  assert.doesNotMatch(u.node('#cartItems').innerHTML,/cambió el stock/);
  assert.equal(u.node('#checkoutRecovery').hidden,false);
  u.run('openProduct('+JSON.stringify(b.items[0].id)+')');
  assert.match(u.node('#productDetail').innerHTML,/Reservada para vos/);
  assert.doesNotMatch(u.node('#productDetail').innerHTML,/>Agotado/);
  await u.run('checkout()');
  assert.match(u.navigations.at(-1),new RegExp('pedido='+a.id));
  assert.equal(f.created,1);
  assert.equal(await f.stockLeft(),0);
  // Direct form resubmission also resumes the existing receipt, even after
  // editing buyer details, instead of competing with its own reservation.
  u.context.orderForm=form({...b,customer:'Otra escritura'},u.node('submit'));
  await u.run('sendOrder(orderForm)');
  assert.equal(f.created,1);
  assert.equal(u.calls.filter(c=>c.path==='/api/checkout/create').length,0);
});

test('After verified expiry the same cart can start a fresh order without reusing its expired key', async()=>{
  const f=await fixture({stock:1}),b=f.body(),a=(await f.create(b)).data,u=browser(f);
  u.recovery.remember(a,b.items);
  u.sessionStorage.setItem('azul-checkout-request',JSON.stringify({key:a.id,signature:'original'}));
  await f.notify(await f.update(a,'canceled','expired'));
  await u.run(source('app.js'));
  await u.run('loadCatalog()');
  u.run('cart='+JSON.stringify(b.items)+';updateCart();');
  assert.equal(u.recovery.get(),null);
  assert.equal(u.sessionStorage.getItem('azul-checkout-request'),null);
  u.context.orderForm=form(b,u.node('submit'));
  await u.run('sendOrder(orderForm)');
  assert.equal(f.created,2);
  assert.equal(await f.stockLeft(),0);
  assert.notEqual(u.recovery.get().key,a.id);
  assert.match(u.navigations.at(-1),/^https:\/\/www\.mercadopago\.com\.ar\//);
});

test('A different browser cannot claim another buyers last-unit reservation', async()=>{
  const f=await fixture({stock:1}),b=f.body(),a=(await f.create(b)).data,u=browser(f);
  await u.run(source('app.js'));
  await u.run('loadCatalog()');
  assert.equal(u.recovery.get(),null);
  assert.match(u.node('#products').innerHTML,/AGOTADO/);
  assert.doesNotMatch(u.node('#products').innerHTML,/RESERVADO PARA VOS/);
  assert.equal((await f.create()).status,409);
  assert.equal(f.created,1);
  assert.equal((await f.stored(a.id)).stockHeld,true);
});

test('Failed status queries preserve the receipt and do not initiate a duplicate checkout', async()=>{
  const f=await fixture({stock:1}),b=f.body(),a=(await f.create(b)).data,u=browser(f);
  u.recovery.remember(a,b.items);
  u.context.fetch=async()=>{throw new Error('offline');};
  await u.recovery.refresh();
  assert.equal(u.recovery.get().key,a.id);
  assert.equal(u.recovery.reservedQty(b.items[0]),0);
  assert.equal(f.created,1);
});

test('Invalid stored receipt links are ignored without contacting or navigating to outside sites', async()=>{
  const f=await fixture(),b=f.body(),u=browser(f);
  for(const back of ['https://attacker.test/pago.html?pedido='+b.key+'&comprobante='+'a'.repeat(64),'/pago.html?pedido='+b.key+'&comprobante=bad','javascript:alert(1)']){
    u.sessionStorage.setItem('azul-last-checkout',JSON.stringify({back,items:b.items}));
    assert.equal(await u.recovery.refresh(),null);
  }
  assert.equal(u.calls.length,0);
  assert.equal(u.navigations.length,0);
});

test('An older receipt cannot erase a newer reservation or its idempotency key',async()=>{
  const f=await fixture(),u=browser(f),a=(await f.create()).data,b=(await f.create()).data;
  u.recovery.remember(b,[{id:f.product.id,size:'XL',qty:1}]);
  u.sessionStorage.setItem('azul-checkout-request',JSON.stringify({key:b.id,signature:'newer'}));
  u.recovery.retire(a.id);
  assert.equal(u.recovery.get().key,b.id);
  assert.equal(JSON.parse(u.sessionStorage.getItem('azul-checkout-request')).key,b.id);
});

test('Blocked browser storage does not prevent opening the payment receipt after creation', async()=>{
  const f=await fixture({stock:1}),b=f.body(),blocked={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}},u=browser(f,blocked);
  await u.run(source('app.js'));
  await u.run('loadCatalog()');
  u.run('cart='+JSON.stringify(b.items));
  u.context.orderForm=form(b,u.node('submit'));
  await u.run('sendOrder(orderForm)');
  assert.equal(f.created,1);
  assert.match(u.navigations.at(-1),/^https:\/\/www\.mercadopago\.com\.ar\//);
  assert.equal(u.recovery.get().items[0].id,f.product.id);
});

test('Expired receipts show a retry action only once their reservation was safely released', async()=>{
  const f=await fixture({stock:1}),b=f.body(),a=(await f.create(b)).data,u=browser(f);
  u.recovery.remember(a,b.items);
  await f.notify(await f.update(a,'canceled','expired'));
  u.context.location.search='?'+new URLSearchParams({pedido:a.id,comprobante:a.proof});
  await u.run(source('payment-result.js'));
  assert.equal(u.node('#paymentTitle').textContent,'El enlace de pago venció.');
  assert.equal(u.node('#retryPurchase').hidden,false);
  assert.equal(u.node('#resumePayment').hidden,true);
  assert.equal(u.recovery.get(),null);
  assert.equal(f.created,1);
});
