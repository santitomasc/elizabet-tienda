import {createHash} from 'node:crypto';
import {sessionUser} from './auth.mjs';
import {ShopError, json, originCheck} from './shop.mjs';

// This first integration intentionally accepts TEST SELLERS ONLY. Test attempts
// are isolated from orders/ and never call inventory.transition().
export function createPaymentPractice({records, config, listProducts, fetcher = fetch}) {
  const token = config.MERCADOPAGO_ACCESS_TOKEN?.trim();
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  const attemptKey = id => 'payment-practice/' + id;
  const authorized = request => {
    if (!sessionUser(request, config)) throw new ShopError('Ingresá al panel de tu tienda para hacer esta prueba.', 401);
    if (!token) throw new ShopError('Falta guardar MERCADOPAGO_ACCESS_TOKEN en Netlify y publicar la actualización.', 503);
  };
  async function readBody(request) {
    const text = await request.text();
    if (text.length > 16000) throw new ShopError('El carrito supera el tamaño permitido.', 413);
    try {const value = JSON.parse(text); if (value && typeof value === 'object' && !Array.isArray(value)) return value;} catch {}
    throw new ShopError('Los datos de la prueba no son válidos.');
  }
  async function mp(path, options = {}) {
    let response;
    try {
      response = await fetcher('https://api.mercadopago.com' + path, {
        ...options, redirect: 'error', signal: AbortSignal.timeout(12000),
        headers: {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}
      });
    } catch {throw new ShopError('No pudimos conectar con Mercado Pago. Volvé a intentar en unos momentos.', 502);}
    if (!response.ok) {
      if ([401, 403].includes(response.status)) throw new ShopError('Mercado Pago no aceptó la credencial. Revisá el Access Token de prueba en Netlify y volvé a publicar.', 503);
      throw new ShopError('Mercado Pago no pudo completar la prueba. Revisá los datos e intentá nuevamente.', 502);
    }
    try {return await response.json();} catch {throw new ShopError('La respuesta de Mercado Pago no es válida.', 502);}
  }
  async function testSeller() {
    const user = await mp('/users/me');
    if (!user?.id || user.site_id !== 'MLA' || !Array.isArray(user.tags) || !user.tags.includes('test_user')) {
      throw new ShopError('Esta práctica solo acepta una cuenta vendedora de prueba de Argentina. Copiá el Access Token desde Credenciales de prueba; no uses el de producción.', 409);
    }
    return String(user.id);
  }
  function checkoutUrl(value) {
    let url; try {url = new URL(value);} catch {throw new ShopError('Mercado Pago no devolvió un enlace válido.', 502);}
    if (url.protocol !== 'https:' || !['www.mercadopago.com.ar', 'www.mercadopago.com', 'mercadopago.com.ar'].includes(url.hostname) || url.username || url.password) {
      throw new ShopError('El enlace de Mercado Pago no es válido.', 502);
    }
    return url.href;
  }
  async function basket(input) {
    if (!Array.isArray(input) || !input.length || input.length > 50) throw new ShopError('Agregá prendas al carrito para probar el pago.');
    const merged = new Map();
    for (const item of input) {
      if (!item || typeof item.id !== 'string' || item.id.length > 80 || typeof item.size !== 'string' || item.size.length > 15 || !Number.isInteger(item.qty) || item.qty < 1 || item.qty > 20) throw new ShopError('Revisá las cantidades y los talles del carrito.');
      const key = JSON.stringify([item.id, item.size]);
      const old = merged.get(key);
      if (old) old.qty += item.qty; else merged.set(key, {id: item.id, size: item.size, qty: item.qty});
    }
    const products = await listProducts();
    return [...merged.values()].map(item => {
      const product = products.find(p => p.id === item.id && p.active);
      const variant = product?.variants.find(v => v.size === item.size);
      if (!product || !variant || item.qty > 20 || variant.stock < item.qty) throw new ShopError('Una prenda o cantidad ya no está disponible. Actualizá la tienda y revisá el carrito.', 409);
      if (!Number.isSafeInteger(product.price) || product.price < 1 || product.price > 100000000) throw new ShopError('Revisá el precio del producto en el panel.');
      return {...item, name: product.name, price: product.price};
    }).sort((a,b) => JSON.stringify([a.id,a.size]).localeCompare(JSON.stringify([b.id,b.size])));
  }
  async function checkout(request) {
    authorized(request); originCheck(request);
    const base = new URL(request.url).origin;
    if (!base.startsWith('https://')) throw new ShopError('Para probar Mercado Pago, abrí la tienda publicada con HTTPS.');
    const input = await readBody(request);
    if (!uuid.test(input.key || '')) throw new ShopError('Volvé a abrir el carrito.');
    const items = await basket(input.items), seller = await testSeller();
    const fingerprint = createHash('sha256').update(JSON.stringify({items, seller})).digest('hex');
    const key = attemptKey(input.key), existing = await records.get(key, {type:'json'});
    if (existing) return reuse(existing, fingerprint);
    const record = {id:input.key, fingerprint, seller, items, total:items.reduce((sum,i) => sum + i.price*i.qty, 0), created_at:new Date().toISOString(), state:'creating'};
    const claim = await records.setJSON(key, record, {onlyIfNew:true});
    if (!claim.modified) return reuse(await records.get(key, {type:'json'}), fingerprint);
    const back = base + '/practica.html?ensayo=' + record.id;
    const preference = await mp('/checkout/preferences', {method:'POST', body:JSON.stringify({
      items:items.map(i => ({id:i.id + ':' + i.size, title:'PRUEBA · ' + i.name + ' · Talle ' + i.size, quantity:i.qty, currency_id:'ARS', unit_price:i.price})),
      external_reference:'ELZ-PRACTICA-' + record.id,
      back_urls:{success:back, failure:back, pending:back}, auto_return:'approved',
      expires:true, expiration_date_to:new Date(Date.now()+3600000).toISOString(),
      metadata:{practice:true, practice_id:record.id}
    })});
    // APP_USR is also used for test credentials: the checked seller determines
    // the environment. Use init_point, not sandbox_init_point, for test users.
    if (!preference.id || String(preference.collector_id) !== seller) throw new ShopError('No pudimos validar el vendedor de la prueba.', 502);
    const next = {...record, state:'ready', preference_id:String(preference.id), url:checkoutUrl(preference.init_point)};
    await records.setJSON(key, next);
    return json({practice:true, id:next.id, url:next.url, total:next.total}, 201);
  }
  function reuse(record, fingerprint) {
    if (!record || record.fingerprint !== fingerprint) throw new ShopError('El carrito cambió. Cerrá la ventana y volvé a iniciar la prueba.', 409);
    if (!record.url) throw new ShopError('La prueba anterior está procesándose. Si no abre, cerrá la ventana del carrito y creá otra prueba.', 409);
    return json({practice:true, id:record.id, url:record.url, total:record.total});
  }
  async function verify(request) {
    authorized(request); originCheck(request);
    const input = await readBody(request);
    if (!uuid.test(input.key || '') || !/^\d{1,30}$/.test(String(input.paymentId || ''))) throw new ShopError('Todavía no recibimos el número de pago. Volvé desde Mercado Pago al finalizar la prueba.');
    const record = await records.get(attemptKey(input.key), {type:'json'});
    if (!record?.preference_id) throw new ShopError('No encontramos esta prueba.', 404);
    const seller = await testSeller();
    const payment = await mp('/v1/payments/' + input.paymentId);
    if (payment.live_mode !== false || String(payment.id) !== String(input.paymentId) || String(payment.collector_id) !== seller || seller !== record.seller || payment.external_reference !== 'ELZ-PRACTICA-' + record.id || payment.currency_id !== 'ARS' || Number(payment.transaction_amount) !== record.total) {
      throw new ShopError('El pago no coincide con esta prueba. No se confirmó ninguna compra.', 409);
    }
    // Do not trust status/collection_status in the browser's return URL.
    const result = {practice:true, id:String(payment.id), status:payment.status, total:record.total, checked_at:new Date().toISOString()};
    await records.setJSON('payment-practice-results/' + record.id + '/' + result.id, result);
    return json(result);
  }
  async function handle(request) {
    const path = new URL(request.url).pathname;
    if (path === '/api/practice/status' && request.method === 'GET') return json({practice:true, admin:!!sessionUser(request, config), configured:!!token});
    if (path === '/api/practice/checkout' && request.method === 'POST') return checkout(request);
    if (path === '/api/practice/verify' && request.method === 'POST') return verify(request);
    throw new ShopError('Ruta no encontrada.', 404);
  }
  return {handle};
}
