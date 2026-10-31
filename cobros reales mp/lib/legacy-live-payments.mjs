import {createHash, createHmac, timingSafeEqual} from 'node:crypto';
import {ShopError, json, originCheck} from './shop.mjs';
import {sessionUser} from './auth.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const digits = v => /^\d{1,30}$/.test(String(v || ''));
const text = (v, n) => typeof v === 'string' ? v.trim().slice(0, n) : '';
const waiting = new Set(['pending', 'in_process', 'authorized', 'in_mediation']);
const same = (a, b) => {const x=Buffer.from(String(a)), y=Buffer.from(String(b)); return x.length===y.length && timingSafeEqual(x,y);};
const reference = id => 'AZUL-' + id;
const labels = {creating:'Preparando pago',awaiting:'Esperando pago',approved:'Pago aprobado',pending:'Pago pendiente',in_process:'Pago en revisión',authorized:'Pago sin capturar',in_mediation:'Pago en mediación',rejected:'Pago rechazado',cancelled:'Pago cancelado',expired:'Enlace vencido',refunded:'Pago devuelto',charged_back:'Contracargo',review:'Requiere revisión',uncertain:'Verificar enlace'};
export function paymentLabel(status) {return labels[status] || 'Verificar pago';}
export function liveOrderProjection(order, movement) {
  const {fingerprint, url, payments, seller, preference_id, ...visible} = order;
  return {...visible, status:movement?.status || 'Nuevo', stockDeducted:!!movement?.deducted,
    paymentManaged:true, paymentLabel:paymentLabel(order.paymentStatus), paymentIds:Object.keys(payments||{}),
    canFulfill:order.paymentStatus==='approved' && order.stockHeld && !order.review,
    paymentNote:order.review || (order.everPaid && order.paymentStatus!=='approved' ? 'Revisá el cobro en Mercado Pago. No se repone stock automáticamente por una devolución o contracargo.' : '')};
}
export function createLivePayments({records, inventory, settings, config, environment='production', fetcher=fetch, now=()=>Date.now()}) {
  const token=config.MERCADOPAGO_LIVE_ACCESS_TOKEN?.trim(), secret=config.MERCADOPAGO_WEBHOOK_SECRET?.trim();
  let deadline=Infinity;
  let base=''; try {const u=new URL(config.STORE_URL); if(u.protocol==='https:' && !u.username && !u.password && u.pathname==='/' && !u.search && !u.hash)base=u.origin;}catch{}
  const available=()=>environment==='production' && !!token && !!secret && digits(config.MERCADOPAGO_COLLECTOR_ID) && !!base && config.SESSION_SECRET?.length>=64;
  const enabled=()=>available() && config.MERCADOPAGO_LIVE_ENABLED==='true';
  const proof=o=>createHmac('sha256',config.SESSION_SECRET).update('azul-checkout:'+o.id+':'+o.fingerprint).digest('hex');
  const getOrder=async id=>(await inventory.snapshot()).data.checkouts?.[id];
  function ready() {if(!available())throw new ShopError('Falta completar la configuración de Mercado Pago de la tienda.',503);}
  function administrator(r) {originCheck(r); if(!sessionUser(r,config))throw new ShopError('Ingresá al panel de la tienda.',401);}
  async function body(r) {const s=await r.text();if(s.length>20000)throw new ShopError('El carrito supera el tamaño permitido.',413);try{const b=JSON.parse(s);if(b && typeof b==='object' && !Array.isArray(b))return b;}catch{}throw new ShopError('Revisá los datos enviados.');}
  async function mp(path, options={}) {
    if(deadline-Date.now()<100)throw new ShopError('La verificación continúa en la próxima consulta. Conservamos la reserva.',503);
    let response;try{response=await fetcher('https://api.mercadopago.com'+path,{...options,redirect:'error',signal:AbortSignal.timeout(Math.max(1,Math.min(8000,Math.floor(deadline-Date.now())))),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}});}catch{throw new ShopError('No pudimos conectar con Mercado Pago. Conservamos tu selección. Volvé a consultar el estado en unos momentos.',502);}
    if(!response.ok)throw new ShopError([401,403].includes(response.status)?'Mercado Pago no aceptó la credencial de cobro. La tienda debe revisar la configuración.':'Mercado Pago no pudo completar la consulta. Volvé a intentar.',[401,403].includes(response.status)?503:502);
    try{return await response.json();}catch{throw new ShopError('Mercado Pago devolvió una respuesta incompleta.',502);}
  }
  async function seller() {
    const u=await mp('/users/me');
    if(String(u.id)!==String(config.MERCADOPAGO_COLLECTOR_ID) || u.site_id!=='MLA' || !Array.isArray(u.tags) || u.tags.includes('test_user'))throw new ShopError('La cuenta de cobro debe ser la cuenta real de Argentina indicada por la tienda; no una cuenta de prueba.',409);
    return String(u.id);
  }
  function checkoutUrl(value) {
    try{const u=new URL(value);if(u.protocol==='https:'&&!u.username&&!u.password&&['www.mercadopago.com.ar','www.mercadopago.com','mercadopago.com.ar'].includes(u.hostname))return u.href;}catch{}
    throw new ShopError('No pudimos validar el enlace de Mercado Pago.',502);
  }
  async function limit(r) {
    const identity=r.headers.get('x-nf-client-connection-ip')||'unknown';
    const key='checkout-rate/'+createHash('sha256').update(identity).digest('hex').slice(0,32);
    for(let i=0;i<8;i++){
      const old=await records.getWithMetadata(key,{type:'json'}), window=Math.floor(now()/60000);
      const count=old?.data.window===window?old.data.count:0;
      if(count>=6)throw new ShopError('Esperá un minuto antes de preparar otro pago.',429);
      const result=await records.setJSON(key,{window,count:count+1},old?{onlyIfMatch:old.etag}:{onlyIfNew:true});
      if(result.modified)return;
    }throw new ShopError('Esperá unos segundos y volvé a intentar.',429);
  }
  function input(b,s) {
    if(!UUID.test(b.key||''))throw new ShopError('Volvé a abrir el carrito.');
    const customer=text(b.customer,100),phone=text(b.phone,25).replace(/\D/g,''),email=text(b.email,160).toLowerCase(),delivery=text(b.delivery,20),address=text(b.address,300),note=text(b.note,1000);
    if(customer.length<2||!/^\d{8,15}$/.test(phone)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new ShopError('Completá nombre, correo electrónico y teléfono.');
    if(!['Retiro','Envío'].includes(delivery)||delivery==='Retiro'&&!s.pickup||delivery==='Envío'&&!s.delivery||delivery==='Envío'&&address.length<5)throw new ShopError('Revisá la forma de entrega y la dirección.');
    if(!Array.isArray(b.items)||!b.items.length||b.items.length>30)throw new ShopError('Revisá las prendas del carrito.');
    const merged=new Map();
    for(const i of b.items){if(!UUID.test(i.id||'')||typeof i.size!=='string'||!i.size.trim()||i.size.length>15||!Number.isInteger(i.qty)||i.qty<1||i.qty>20)throw new ShopError('Revisá los talles y cantidades del carrito.');const key=i.id+'|'+i.size;merged.set(key,{id:i.id,size:i.size,qty:(merged.get(key)?.qty||0)+i.qty});}
    const items=[...merged.values()].sort((a,b)=>(a.id+a.size).localeCompare(b.id+b.size));
    if(items.some(i=>i.qty>20))throw new ShopError('Podés comprar hasta 20 unidades por talle.');
    return {customer,phone,email,delivery,address,note,items};
  }
  function result(o) {return {id:o.id,code:o.code,total:o.total,url:!o.everPaid&&!o.review&&now()<Date.parse(o.expires_at)?o.url||null:null,proof:proof(o),paymentStatus:o.paymentStatus,expires_at:o.expires_at};}
  function validatePayment(p,o) {
    if(!digits(p.id)||p.external_reference!==reference(o.id)||String(p.collector_id)!==o.seller||o.seller!==String(config.MERCADOPAGO_COLLECTOR_ID)||p.live_mode!==true||p.currency_id!=='ARS'||Number(p.transaction_amount)!==o.total||!Number.isFinite(Date.parse(p.date_last_updated)))throw new ShopError('El pago no coincide con el pedido, el importe o la cuenta de la tienda.',409);
  }
  async function applyPayment(p) {
    const id=String(p.external_reference||'').replace(/^AZUL-/,'');
    if(!UUID.test(id))return false;
    const o=await getOrder(id);if(!o||o.api==='orders')return false;validatePayment(p,o);
    await inventory.change(data=>{
      const current=data.checkouts[id], old=current.payments[String(p.id)];
      if(old && Date.parse(old.updated_at)>Date.parse(p.date_last_updated))return;
      const refunded=Number(p.transaction_amount_refunded||0);
      current.payments[String(p.id)]={status:p.status,refunded,updated_at:p.date_last_updated};
      current.last_checked=now();
      const payments=Object.values(current.payments), approved=payments.filter(x=>x.status==='approved'&&x.refunded===0);
      const partial=payments.some(x=>x.status==='approved'&&x.refunded>0);
      if(approved.length){
        current.everPaid=true;current.paymentStatus='approved';
        if(approved.length>1)current.review='Se detectó más de un pago aprobado para este pedido. Revisá los cobros y devolvé el duplicado desde Mercado Pago.';
        if(partial)current.review='Hay una devolución parcial. Revisá los movimientos de Mercado Pago antes de entregar.';
        if(!current.stockHeld){
          const enough=current.items.every(i=>{const p=data.products.find(p=>p.id===i.id),v=p?.variants.find(v=>v.size===i.size);return p?.active&&!p.sample&&v?.stock>=i.qty;});
          if(enough){for(const i of current.items){const p=data.products.find(p=>p.id===i.id);p.variants.find(v=>v.size===i.size).stock-=i.qty;p.revision=(p.revision||0)+1;}current.stockHeld=true;data.orders[id].deducted=true;data.orders[id].status='Nuevo';}
          else current.review='El pago se aprobó después de vencer la reserva y ya no hay stock. No entregues el pedido: contactá a la compradora y gestioná una devolución en Mercado Pago.';
        }
      }else if(partial){current.everPaid=true;current.paymentStatus='review';current.review='Devolución parcial: verificá el importe y la entrega en Mercado Pago.';}
      else if(payments.some(x=>x.status==='charged_back')){current.everPaid=true;current.paymentStatus='charged_back';}
      else if(payments.some(x=>x.status==='refunded')){current.everPaid=true;current.paymentStatus='refunded';}
      else if(current.everPaid){current.paymentStatus='review';current.review='Cambió el estado de un pago previamente aprobado. Revisá Mercado Pago antes de entregar.';}
      else {const active=payments.find(x=>waiting.has(x.status));current.paymentStatus=active?.status||(['expired'].includes(current.paymentStatus)?'expired':p.status);}
    });return true;
  }
  async function searchPayments(o) {
    const found=await mp('/v1/payments/search?external_reference='+encodeURIComponent(reference(o.id))+'&sort=date_created&criteria=desc&limit=100');
    if(!Array.isArray(found.results)||!Number.isInteger(found.paging?.total)||found.paging.total>10||found.paging.total!==found.results.length)throw new ShopError('Este pedido necesita revisar sus movimientos en Mercado Pago.',409);
    await Promise.all(found.results.map(async p=>{if(!digits(p.id))throw new ShopError('Respuesta de pago incompleta.',502);const actual=await mp('/v1/payments/'+p.id);if(String(actual.id)!==String(p.id))throw new ShopError('El pago consultado no coincide.',409);await applyPayment(actual);}));
  }
  async function reconcile(id) {
    ready();let o=await getOrder(id);if(!o)throw new ShopError('No encontramos el pedido.',404);
    await inventory.change(data=>{data.checkouts[id].last_checked=now();});
    if(!o.preference_id){
      const found=await mp('/checkout/preferences/search?external_reference='+encodeURIComponent(reference(id))+'&limit=10');
      if(!Array.isArray(found.elements)||!Number.isInteger(found.total)||found.total>10||found.total!==found.elements.length)throw new ShopError('No pudimos verificar el enlace. Consultá nuevamente.',502);
      // Search returns a summary, without external_reference or init_point.
      const details=await Promise.all(found.elements.map(p=>mp('/checkout/preferences/'+encodeURIComponent(p.id))));
      const matches=details.filter(p=>p.external_reference===reference(id)&&String(p.collector_id)===o.seller);
      if(matches.length!==found.total)throw new ShopError('La búsqueda de enlaces no coincide con el pedido. Conservamos la reserva.',409);
      if(matches.length>1)throw new ShopError('Hay más de un enlace para el pedido. Revisá Mercado Pago.',409);
      if(matches.length===1){const p=matches[0];if(p.external_reference!==reference(id)||String(p.collector_id)!==o.seller||p.expires!==true||Date.parse(p.expiration_date_to)!==Date.parse(o.expires_at))throw new ShopError('El enlace recuperado no coincide con el pedido.',409);const url=checkoutUrl(p.init_point);await inventory.change(data=>{const current=data.checkouts[id];current.preference_id=String(p.id);current.url=url;if(['creating','uncertain'].includes(current.paymentStatus))current.paymentStatus='awaiting';});}
    }
    o=await getOrder(id);await searchPayments(o);o=await getOrder(id);
    if(now()>Date.parse(o.expires_at)+15*60000&&!o.everPaid&&!Object.values(o.payments).some(p=>waiting.has(p.status))){
      if(o.preference_id){const p=await mp('/checkout/preferences/'+encodeURIComponent(o.preference_id));if(p.external_reference!==reference(id)||String(p.collector_id)!==o.seller||p.expires!==true||!Number.isFinite(Date.parse(p.expiration_date_to))||Date.parse(p.expiration_date_to)>now())throw new ShopError('El enlace de pago aún está vigente. Conservamos la reserva.',409);}
      await inventory.change(data=>{
        const current=data.checkouts[id];if(current.everPaid||Object.values(current.payments).some(p=>waiting.has(p.status)))return;
        if(current.stockHeld){for(const i of current.items){const p=data.products.find(p=>p.id===i.id),v=p?.variants.find(v=>v.size===i.size);if(!v||v.stock+i.qty>10000)throw new ShopError('Revisá el stock antes de liberar esta reserva.',409);}
          for(const i of current.items){const p=data.products.find(p=>p.id===i.id);p.variants.find(v=>v.size===i.size).stock+=i.qty;p.revision=(p.revision||0)+1;}current.stockHeld=false;data.orders[id].deducted=false;}
        current.paymentStatus='expired';data.orders[id].status='Cancelado';
      });
    }
    return getOrder(id);
  }
  async function ownership(b) {ready();if(!UUID.test(b.key||''))throw new ShopError('No encontramos el pedido.',404);const o=await getOrder(b.key);if(!o||!same(b.proof||'',proof(o)))throw new ShopError('No encontramos el comprobante del pedido.',404);return o;}
  function publicStatus(o) {return {...result(o),url:now()<Date.parse(o.expires_at)&&!o.everPaid?o.url:null,label:paymentLabel(o.paymentStatus),paid:o.paymentStatus==='approved'&&o.stockHeld&&!o.review,review:!!o.review,delivery:o.delivery,shippingIncluded:false};}
  async function webhook(r) {
    ready();const u=new URL(r.url),id=u.searchParams.get('data.id'),requestId=r.headers.get('x-request-id'),signature=r.headers.get('x-signature')||'';
    const parts=signature.split(',').map(x=>x.trim().split('=')),ts=parts.find(([k])=>k==='ts')?.[1],v1=parts.find(([k])=>k==='v1')?.[1];
    if(!digits(id)||!requestId||requestId.length>200||!/^\d{10,16}$/.test(ts||'')||!/^[a-f0-9]{64}$/.test(v1||''))throw new ShopError('Firma no válida.',401);
    const expected=createHmac('sha256',secret).update(`id:${id};request-id:${requestId};ts:${ts};`).digest('hex');
    if(!same(v1,expected))throw new ShopError('Firma no válida.',401);
    // Signed retries can arrive days later. Idempotency and provider timestamps,
    // rather than a short replay window, make them safe to process repeatedly.
    const b=await body(r);if(b.type!=='payment'||String(b.data?.id)!==id)throw new ShopError('Notificación no válida.',400);
    const payment=await mp('/v1/payments/'+id);if(String(payment.id)!==id)throw new ShopError('Pago no válido.',409);
    await applyPayment(payment);return json({received:true});
  }
  async function sweep() {
    if(!available())return {checked:0};
    deadline=Date.now()+22000;
    const orders=Object.values((await inventory.snapshot()).data.checkouts||{}).filter(o=>o.paymentStatus!=='expired').sort((a,b)=>(a.last_checked||0)-(b.last_checked||0)).slice(0,3);
    const results=await Promise.allSettled(orders.map(o=>reconcile(o.id)));return {checked:orders.length,failed:results.filter(r=>r.status==='rejected').length};
  }
  async function handle(r) {
    const u=new URL(r.url),path=u.pathname;
    if(path==='/api/checkout/config'&&r.method==='GET')return json({enabled:enabled()});

    if(path==='/api/checkout/webhook'&&r.method==='POST')return webhook(r);
    if(path==='/api/checkout/status'&&r.method==='GET'){const o=await ownership({key:u.searchParams.get('key'),proof:u.searchParams.get('proof')});return json(publicStatus(o));}
    if(path==='/api/checkout/verify'&&r.method==='POST'){
      originCheck(r);const b=await body(r),o=await ownership(b);
      if(now()-(o.last_public_check||0)<10000)return json(publicStatus(o));
      await inventory.change(data=>{if(now()-(data.checkouts[o.id].last_public_check||0)<10000)throw new ShopError('Esperá unos segundos antes de actualizar.',429);data.checkouts[o.id].last_public_check=now();});
      if(b.paymentId){if(!digits(b.paymentId))throw new ShopError('Número de pago no válido.');const p=await mp('/v1/payments/'+b.paymentId);if(String(p.id)!==String(b.paymentId))throw new ShopError('Pago no válido.',409);validatePayment(p,o);await applyPayment(p);}
      else await reconcile(o.id);
      return json(publicStatus(await getOrder(o.id)));
    }
    if(path==='/api/checkout/admin/status'&&r.method==='GET'){administrator(r);let merchant=null,error='';if(available()){try{merchant=await seller();}catch(e){error=e.message;}}return json({configured:available(),enabled:enabled(),merchant,error,production:environment==='production',url:base});}
    if(path==='/api/checkout/admin/reconcile'&&r.method==='POST'){administrator(r);const b=await body(r);if(!UUID.test(b.key||''))throw new ShopError('Pedido no válido.');const o=await reconcile(b.key);return json({ok:true,label:paymentLabel(o.paymentStatus)});}
    throw new ShopError('Ruta no encontrada.',404);
  }
  return {handle,sweep,reconcile,applyPayment};
}
