import {createLivePayments as createLegacyPayments} from './legacy-live-payments.mjs';
import {createHash, createHmac, timingSafeEqual, randomUUID} from 'node:crypto';
import {ShopError, json, originCheck} from './shop.mjs';
import {sessionUser} from './auth.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const digits = v => /^\d{1,30}$/.test(String(v || ''));
const text = (v, n) => typeof v === 'string' ? v.trim().slice(0, n) : '';
const ORDER_ID=/^ORD[0-9A-HJKMNP-TV-Z]{26}$/;
const ANY_ORDER_ID=/^ORD(?:TST)?[0-9A-HJKMNP-TV-Z]{26}$/i;
const confirming='confirming';
const same = (a, b) => {const x=Buffer.from(String(a)), y=Buffer.from(String(b)); return x.length===y.length && timingSafeEqual(x,y);};
const reference = id => 'AZUL-' + id;
const labels = {confirming:'Pago detectado · esperando notificación',creating:'Preparando pago',awaiting:'Esperando pago',approved:'Pago aprobado',pending:'Pago pendiente',in_process:'Pago en revisión',authorized:'Pago sin capturar',in_mediation:'Pago en mediación',rejected:'Pago rechazado',cancelled:'Pago cancelado',expired:'Enlace vencido',refunded:'Pago devuelto',charged_back:'Contracargo',review:'Requiere revisión',uncertain:'Verificar enlace'};
export function paymentLabel(status) {return labels[status] || 'Verificar pago';}
export function liveOrderProjection(order, movement) {
  const {fingerprint, url, payments, seller, preference_id, cancel_key, create_payload, ...visible} = order;
  return {...visible, status:movement?.status || 'Nuevo', stockDeducted:!!movement?.deducted,
    paymentManaged:true, paymentLabel:paymentLabel(order.paymentStatus), paymentIds:Object.keys(payments||{}),
    canFulfill:order.paymentStatus==='approved' && order.stockHeld && !order.review,
    paymentNote:order.review || (order.paymentStatus==='confirming'?'El cobro fue detectado por la API. Falta recibir la notificación auténtica de Mercado Pago antes de preparar o entregar.':'') || (order.everPaid && order.paymentStatus!=='approved' ? 'Revisá el cobro en Mercado Pago. No se repone stock automáticamente por una devolución o contracargo.' : '')};
}
export function createLivePayments({records, inventory, settings, config, environment='production', fetcher=fetch, now=()=>Date.now()}) {
  const token=config.MERCADOPAGO_LIVE_ACCESS_TOKEN?.trim(), secret=config.MERCADOPAGO_WEBHOOK_SECRET?.trim();
  const legacy=createLegacyPayments({records,inventory,settings,config,environment,fetcher,now});
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
    let response;try{response=await fetcher('https://api.mercadopago.com'+path,{...options,redirect:'error',signal:AbortSignal.timeout(Math.max(1,Math.min(8000,Math.floor(deadline-Date.now())))),headers:{...options.headers,Authorization:'Bearer '+token,'Content-Type':'application/json'}});}catch{throw new ShopError('No pudimos conectar con Mercado Pago. Conservamos tu selección. Volvé a consultar el estado en unos momentos.',502);}
    if(!response.ok){
      const e=new ShopError([401,403].includes(response.status)?'Mercado Pago no aceptó la credencial de cobro. La tienda debe revisar la configuración.':'Mercado Pago no pudo completar la consulta. Volvé a intentar.',[401,403].includes(response.status)?503:502);
      let detail = {};
try { detail = await response.json(); } catch {}

const clean = value => String(value ?? '')
  .replaceAll(token || '__NO_TOKEN__', '[redacted]')
  .replaceAll(secret || '__NO_SECRET__', '[redacted]')
  .replace(/Bearer\s+\S+/gi, '[redacted]')
  .replace(/[\w.+-]+@[\w.-]+/g, '[email]')
  .replace(/[\r\n]/g, ' ')
  .slice(0, 240);

console.error('Mercado Pago API error', JSON.stringify({
  method: options.method || 'GET',
  endpoint: path.split('?')[0],
  status: response.status,
  code: clean(detail.error || detail.code),
  message: clean(detail.message),
  codes: Array.isArray(detail.errors)
    ? detail.errors.slice(0, 5).map(x => clean(x?.code))
    : []
}));

e.providerStatus = response.status;
throw e;
    }
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
  function result(o) {return {id:o.id,code:o.code,total:o.total,url:!o.everPaid&&!o.review&&!['rejected','expired','cancelled'].includes(o.paymentStatus)&&now()<Date.parse(o.expires_at)?o.url||null:null,proof:proof(o),paymentStatus:o.paymentStatus,expires_at:o.expires_at};}
  async function create(r) {
    originCheck(r);ready();
    if(!enabled())throw new ShopError('Los pagos online todavía no están habilitados.',409);
    if(new URL(r.url).origin!==base)throw new ShopError('Abrí la tienda desde su dirección oficial para pagar.',403);
    const s=await settings();if(!s.acceptOrders)throw new ShopError('La tienda todavía no habilitó las compras.',409);
    const b=await body(r), v=input(b,s), fingerprint=createHash('sha256').update(JSON.stringify(v)).digest('hex');
    let existing=await getOrder(b.key);
    if(existing){if(existing.fingerprint!==fingerprint)throw new ShopError('Esta selección cambió. Volvé a abrir el carrito.',409);return json(result(existing));}
    await limit(r);const collector=await seller(), stamp=now();
    const claimed=await inventory.change(data=>{
      data.checkouts||={};existing=data.checkouts[b.key];
      if(existing){if(existing.fingerprint!==fingerprint)throw new ShopError('La selección cambió.',409);return {created:false,order:existing};}
      if(Object.keys(data.checkouts).length>=1500)throw new ShopError('La tienda necesita archivar sus pedidos. Consultá por WhatsApp.',503);
      const items=v.items.map(i=>{const p=data.products.find(p=>p.id===i.id),variant=p?.variants.find(x=>x.size===i.size);if(!p?.active||p.sample||!variant||variant.stock<i.qty)throw new ShopError('No hay stock suficiente para una de las prendas. Actualizá el carrito.',409);return {...i,name:p.name,price:p.price,photo:p.photos[0]};});
      const total=items.reduce((sum,i)=>sum+i.price*i.qty,0);if(!Number.isSafeInteger(total)||total<1||total>100000000)throw new ShopError('Revisá el total de la selección.');
      const o={id:b.key,code:'AZUL-'+b.key.slice(0,8).toUpperCase(),...v,items,total,fingerprint,seller:collector,created_at:new Date(stamp).toISOString(),expires_at:new Date(stamp+30*60000).toISOString(),api:'orders',cancel_key:randomUUID(),paymentStatus:'creating',stockHeld:true,payments:{},last_checked:stamp};
      for(const i of items){const p=data.products.find(p=>p.id===i.id);p.variants.find(v=>v.size===i.size).stock-=i.qty;p.revision=(p.revision||0)+1;p.updated_at=new Date(stamp).toISOString();}
      data.checkouts[o.id]=o;data.orders[o.id]={status:'Nuevo',deducted:true,legacy:false,items,paymentManaged:true};return {created:true,order:o};
    });
    if(!claimed.created)return json(result(claimed.order));
    try {
      const saved=await openProviderOrder(claimed.order);
      return json(result(saved),201);
    } catch(e) {
      const rejected=[400,401,403].includes(e.providerStatus);
      await inventory.change(data=>{const current=data.checkouts[claimed.order.id];if(current.paymentStatus==='creating'){current.paymentStatus=rejected?'rejected':'uncertain';if(rejected)current.provider_status='failed';}});
      if(rejected)await release(await getOrder(claimed.order.id));
      return json({...result(await getOrder(claimed.order.id)),message:rejected?'Mercado Pago no pudo preparar el cobro. La tienda debe revisar su configuración.':'La orden está verificándose. Consultá el estado; no hace falta iniciar otra compra.'},202);
    }
  }
  function amount(value) {
    if(typeof value!=='string'||!/^\d{1,12}(?:\.\d{1,2})?$/.test(value))return NaN;
    const [whole,cents='']=value.split('.');return Number(whole)*100+Number(cents.padEnd(2,'0'));
  }
  function validateOrder(p,o) {
    if(!ORDER_ID.test(p.id||'') || p.external_reference!==reference(o.id) ||
       String(p.user_id)!==o.seller || o.seller!==String(config.MERCADOPAGO_COLLECTOR_ID) ||
       p.live_mode===false || p.type!=='online' || p.processing_mode!=='manual' || p.currency!=='ARS' ||
       p.country_code!=='ARG' || amount(p.total_amount)!==o.total*100 ||
       !Number.isFinite(Date.parse(p.last_updated_date)) || !Number.isFinite(Date.parse(p.created_date)) ||
       o.mp_order_id && p.id!==o.mp_order_id)throw new ShopError('La orden no coincide con el pedido, el importe o la cuenta real de la tienda.',409);
  }
  function payload(o) {
    const back=base+'/pago.html?pedido='+o.id+'&comprobante='+proof(o);
    return {
      type:'online',processing_mode:'manual',capture_mode:'automatic',
      total_amount:o.total.toFixed(2),external_reference:reference(o.id),expiration_time:'PT30M',
      payer:{email:o.email},
      items:o.items.map(i=>({external_code:i.id+':'+i.size,title:(i.name+' · Talle '+i.size).slice(0,120),quantity:i.qty,unit_price:i.price.toFixed(2)})),
      config:{online:{success_url:back,failure_url:back,pending_url:back,auto_return:'approved'},
        payment_method:{not_allowed_types:['ticket','atm','bank_transfer']}}
    };
  }
  async function openProviderOrder(o) {
    // One persisted UUID identifies the POST across client retries and timeouts.
    // No new idempotency key is generated to recover an uncertain attempt.
    const p=await mp('/v1/orders',{method:'POST',headers:{'X-Idempotency-Key':o.id},body:JSON.stringify(payload(o))});
    validateOrder(p,o);const url=checkoutUrl(p.checkout_url);
    await applyOrder(p,{expectedId:o.id});
    return inventory.change(data=>{const current=data.checkouts[o.id];current.url=url;return current;});
  }
  function classify(p) {
    const payments=p.transactions?.payments||[],refunds=p.transactions?.refunds||[],chargebacks=p.transactions?.chargebacks||[];
    if(!Array.isArray(payments)||!Array.isArray(refunds)||!Array.isArray(chargebacks))throw new ShopError('La orden contiene movimientos incompletos.',502);
    const paid=amount(p.total_paid_amount??'0');
    if(!Number.isFinite(paid))throw new ShopError('Mercado Pago no informó el importe acreditado.',502);
    if(chargebacks.length)return {status:'charged_back',paidBefore:true};
    if(p.status==='refunded')return {status:'refunded',paidBefore:true};
    if(p.status==='processed'&&p.status_detail==='partially_refunded')return {status:'review',paidBefore:true,review:'La compra tiene una devolución parcial. Revisá el importe y la entrega en Mercado Pago.'};
    if(refunds.some(r=>!['failed','rejected','canceled','cancelled'].includes(r.status)))return {status:'review',paidBefore:true,review:'La compra tiene una devolución registrada o en proceso. Revisá Mercado Pago antes de entregar.'};
    if(p.status==='processed'&&p.status_detail==='accredited') {
      if(paid!==amount(p.total_amount))return {status:'review',paidBefore:paid>0,review:'El importe acreditado no coincide con el total. Revisá Mercado Pago antes de entregar.'};
      const credited=payments.filter(x=>x.status==='processed'&&x.status_detail==='accredited');
      if(credited.length>1)return {status:'review',paidBefore:true,review:'Hay varias transacciones acreditadas. Revisá los movimientos antes de entregar.'};
      return {status:'approved',paidBefore:true};
    }
    if(paid>0)return {status:'review',paidBefore:true,review:'Se informó dinero acreditado con otro estado. Verificá el cobro antes de entregar.'};
    const statuses={created:'awaiting',processing:'in_process',action_required:'authorized',failed:'rejected',canceled:'cancelled',expired:'expired'};
    return {status:statuses[p.status]||'review',review:statuses[p.status]?undefined:'Mercado Pago informó un estado nuevo. Revisá el pedido antes de entregar.'};
  }
  async function applyOrder(p,{expectedId,fromWebhook=false}={}) {
    const id=String(p.external_reference||'').replace(/^AZUL-/,'');
    if(!UUID.test(id))return false;
    if(expectedId&&expectedId!==id)throw new ShopError('La orden pertenece a otra compra.',409);
    const o=await getOrder(id);if(!o||o.api!=='orders')return false;validateOrder(p,o);
    const next=classify(p),updated=Date.parse(p.last_updated_date);
    await inventory.change(data=>{
      const current=data.checkouts[id],oldTime=Date.parse(current.provider_updated_at||'');
      if(current.mp_order_id&&current.mp_order_id!==p.id)throw new ShopError('Esta compra ya tiene otra orden asociada.',409);
      const oldVersion=current.provider_version,newVersion=Number.isSafeInteger(p.version)?p.version:undefined;
      if(newVersion!==undefined&&oldVersion!==undefined&&newVersion<oldVersion||Number.isFinite(oldTime)&&updated<oldTime)return;
      // Never regress a terminal or refunded state on equal timestamps.
      if(updated===oldTime&&['refunded','charged_back','review'].includes(current.paymentStatus)&&next.status==='approved')return;
      current.mp_order_id=p.id;current.provider_updated_at=p.last_updated_date;current.provider_status=p.status;current.provider_status_detail=p.status_detail;
      if(newVersion!==undefined)current.provider_version=newVersion;
      current.last_checked=now();current.everPaid ||= next.paidBefore;
      const ps=p.transactions?.payments||[];
      current.payments=Object.fromEntries(ps.filter(x=>typeof x.id==='string'&&/^[A-Z0-9]{1,60}$/.test(x.id)).map(x=>[x.id,{status:x.status,updated_at:p.last_updated_date}]));
      if(next.review)current.review=next.review;
      if(next.status==='approved'){
        if(fromWebhook)current.payment_notified=true;
        current.paymentStatus=current.payment_notified?'approved':confirming;
        if(!current.stockHeld){
          const enough=current.items.every(i=>{const product=data.products.find(p=>p.id===i.id),v=product?.variants.find(v=>v.size===i.size);return product?.active&&!product.sample&&v?.stock>=i.qty;});
          if(enough){for(const i of current.items){const product=data.products.find(p=>p.id===i.id);product.variants.find(v=>v.size===i.size).stock-=i.qty;product.revision=(product.revision||0)+1;}current.stockHeld=true;data.orders[id].deducted=true;data.orders[id].status='Nuevo';}
          else current.review='El pago llegó después de liberar la reserva y ya no hay stock. No entregues el pedido: contactá a la compradora y gestioná la devolución en Mercado Pago.';
        }
      }else if(current.everPaid&&!['refunded','charged_back','review'].includes(next.status)){
        current.paymentStatus='review';current.review='Cambió el estado de un cobro previamente detectado. Revisá Mercado Pago antes de entregar.';
      }else current.paymentStatus=next.status;
    });return true;
  }
  async function providerOrder(id,o) {
    if(!ORDER_ID.test(id||''))throw new ShopError('Número de orden no válido.',400);
    const p=await mp('/v1/orders/'+id);if(p.id!==id)throw new ShopError('La orden consultada no coincide.',409);validateOrder(p,o);return p;
  }
  async function recover(o) {
    const from=new Date(Date.parse(o.created_at)-5*60000).toISOString(),until=new Date(now()+60000).toISOString();
    const query=new URLSearchParams({begin_date:from,end_date:until,external_reference:reference(o.id),limit:'10'});
    const found=await mp('/v1/orders?'+query);
    const total=Number(found.paging?.total);
    if(!Array.isArray(found.data)||!Number.isSafeInteger(total)||total<0||total>10||total!==found.data.length)throw new ShopError('No pudimos recuperar la orden completa. Conservamos tu reserva.',502);
    if(found.data.length>1){await inventory.change(data=>{data.checkouts[o.id].review='Hay más de una orden para esta compra. Revisá Mercado Pago antes de entregar.';});throw new ShopError('Esta compra necesita revisar sus órdenes en Mercado Pago.',409);}
    if(!found.data.length)return null;
    const p=await providerOrder(found.data[0].id,o);await applyOrder(p,{expectedId:o.id});
    // GET order may omit checkout_url. The validated ID can reconstruct the
    // documented redirect without another POST or a new idempotency key.
    const url=checkoutUrl(p.checkout_url||baseCheckout(p.id));
    await inventory.change(data=>{data.checkouts[o.id].url=url;});return p;
  }
  const baseCheckout=id=>'https://www.mercadopago.com.ar/checkout/v1/redirect?order_id='+id;
  async function release(o) {
    return inventory.change(data=>{
      const current=data.checkouts[o.id];
      if(current.everPaid||!['canceled','expired','failed'].includes(current.provider_status))return;
      if(current.stockHeld){
        for(const i of current.items){const product=data.products.find(p=>p.id===i.id),v=product?.variants.find(v=>v.size===i.size);if(!v||v.stock+i.qty>10000)throw new ShopError('Revisá las cantidades antes de liberar la reserva.',409);}
        for(const i of current.items){const product=data.products.find(p=>p.id===i.id);product.variants.find(v=>v.size===i.size).stock+=i.qty;product.revision=(product.revision||0)+1;}
        current.stockHeld=false;data.orders[o.id].deducted=false;
      }
     current.paymentStatus = current.provider_status === 'failed'
  ? 'rejected'
  : current.provider_status === 'canceled'
    ? 'cancelled'
    : 'expired';
data.orders[o.id].status = 'Cancelado';
    });
  }
  async function reconcile(id) {
    ready();let o=await getOrder(id);if(!o)throw new ShopError('No encontramos el pedido.',404);
    if(o.api!=='orders')return legacy.reconcile(id);
    await inventory.change(data=>{data.checkouts[id].last_checked=now();});
    let p=o.mp_order_id?await providerOrder(o.mp_order_id,o):await recover(o);
    if(!p)return getOrder(id); // Uncertain creation never releases stock blindly.
    await applyOrder(p,{expectedId:id});o=await getOrder(id);
    if(now()>Date.parse(o.expires_at)+15*60000&&!o.everPaid&&!o.review){
      if(p.status==='created'){
        try{await mp('/v1/orders/'+p.id+'/cancel',{method:'POST',headers:{'X-Idempotency-Key':o.cancel_key}});}catch(e){if(e.providerStatus!==409)throw e;}
        // A payment can race cancellation. Release only after a fresh GET.
        p=await providerOrder(p.id,o);await applyOrder(p,{expectedId:id});o=await getOrder(id);
      }
    }
    o=await getOrder(id);
    if(!o.everPaid&&!o.review&&['canceled','expired','failed'].includes(o.provider_status))await release(o);
    return getOrder(id);
  }
  async function ownership(b) {ready();if(!UUID.test(b.key||''))throw new ShopError('No encontramos el pedido.',404);const o=await getOrder(b.key);if(!o||!same(b.proof||'',proof(o)))throw new ShopError('No encontramos el comprobante del pedido.',404);return o;}
  function publicStatus(o) {return {...result(o),url:!o.everPaid&&!o.review&&!['expired','cancelled','rejected'].includes(o.paymentStatus)&&now()<Date.parse(o.expires_at)?o.url||null:null,label:paymentLabel(o.paymentStatus),paid:o.paymentStatus==='approved'&&o.stockHeld&&!o.review,review:!!o.review,delivery:o.delivery,shippingIncluded:false,retryAllowed:!o.everPaid&&!o.review&&!o.stockHeld&&['expired','cancelled','rejected'].includes(o.paymentStatus)};}
  async function webhook(r) {
    ready();deadline=Date.now()+18000;
    const u=new URL(r.url),rawId=u.searchParams.get('data.id'),requestId=r.headers.get('x-request-id')?.trim(),signature=r.headers.get('x-signature')||'';
    // Numeric legacy IDs are handled exclusively by the read-only adapter.
    if(digits(rawId))return legacy.handle(r);
    const id=rawId?.toUpperCase(),parts=signature.split(',').map(x=>x.trim().split('=')),ts=parts.find(([k])=>k==='ts')?.[1],v1=parts.find(([k])=>k==='v1')?.[1];
    if(!ANY_ORDER_ID.test(rawId||'')||!requestId||requestId.length>200||!/^\d{10,13}$/.test(ts||'')||!/^[a-f0-9]{64}$/.test(v1||''))throw new ShopError('Firma no válida.',401);
    const expected=createHmac('sha256',secret).update(`id:${rawId};request-id:${requestId};ts:${ts};`).digest('hex');
    const tsMs=ts.length<=10?Number(ts)*1000:Number(ts);
    if(!same(v1,expected)||Math.abs(now()-tsMs)>5*60000)throw new ShopError('Firma no válida o vencida.',401);
    const b=await body(r);
    if(!['order','orders','orders_v2'].includes(b.type)||String(b.data?.id).toUpperCase()!==id)throw new ShopError('Notificación no válida.',400);
    if(!ORDER_ID.test(id)||b.live_mode!==true||String(b.user_id)!==String(config.MERCADOPAGO_COLLECTOR_ID))throw new ShopError('La notificación no corresponde al entorno real de la tienda.',409);
    const p=await mp('/v1/orders/'+id);if(p.id!==id)throw new ShopError('Orden no válida.',409);
    await applyOrder(p,{fromWebhook:true});return json({received:true});
  }
  async function sweep() {
    if(!available())return {checked:0};deadline=Date.now()+22000;
    const orders=Object.values((await inventory.snapshot()).data.checkouts||{}).filter(o=>o.paymentStatus!=='expired').sort((a,b)=>(a.last_checked||0)-(b.last_checked||0)).slice(0,3);
    const results=await Promise.allSettled(orders.map(o=>reconcile(o.id)));return {checked:orders.length,failed:results.filter(r=>r.status==='rejected').length};
  }
  async function handle(r) {
    const u=new URL(r.url),path=u.pathname;
    if(path==='/api/checkout/config'&&r.method==='GET')return json({enabled:enabled(),integration:'orders'});
    if(path==='/api/checkout/create'&&r.method==='POST')return create(r);
    if(path==='/api/checkout/webhook'&&r.method==='POST')return webhook(r);
    if(path==='/api/checkout/status'&&r.method==='GET'){
      const o=await ownership({key:u.searchParams.get('key'),proof:u.searchParams.get('proof')});
      return o.api==='orders'?json(publicStatus(o)):legacy.handle(r);
    }
    if(path==='/api/checkout/verify'&&r.method==='POST'){
      originCheck(r);const b=await body(r.clone()),o=await ownership(b);if(o.api!=='orders')return legacy.handle(r);
      if(now()-(o.last_public_check||0)<10000)return json(publicStatus(o));
      await inventory.change(data=>{if(now()-(data.checkouts[o.id].last_public_check||0)<10000)throw new ShopError('Esperá unos segundos antes de actualizar.',429);data.checkouts[o.id].last_public_check=now();});
      // Browser order_id is merely a hint. Bind to the saved order or recover by
      // external_reference; never accept a browser status or a numeric payment.
      if(b.orderId&&o.mp_order_id&&b.orderId!==o.mp_order_id)throw new ShopError('La orden indicada no coincide con tu compra.',409);
      await reconcile(o.id);return json(publicStatus(await getOrder(o.id)));
    }
    if(path==='/api/checkout/admin/status'&&r.method==='GET'){administrator(r);let merchant=null,error='';if(available()){try{merchant=await seller();}catch(e){error=e.message;}}return json({configured:available(),enabled:enabled(),merchant,error,production:environment==='production',url:base,integration:'orders'});}
    if(path==='/api/checkout/admin/reconcile'&&r.method==='POST'){administrator(r);const b=await body(r);if(!UUID.test(b.key||''))throw new ShopError('Pedido no válido.');const o=await reconcile(b.key);return json({ok:true,label:paymentLabel(o.paymentStatus)});}
    throw new ShopError('Ruta no encontrada.',404);
  }
  return {handle,sweep,reconcile,applyOrder};
}
