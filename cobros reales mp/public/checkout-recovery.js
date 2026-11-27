/* Recover only a receipt already held by this tab. Never infer ownership from
   a product, customer email, public order number, or the browser return status. */
(() => {
  'use strict';
  const LAST = 'azul-last-checkout', REQUEST = 'azul-checkout-request';
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  let current = null, pending = null;
  const read = key => {try {return JSON.parse(sessionStorage.getItem(key));} catch {return null;}};
  const write = (key, value) => {try {sessionStorage.setItem(key, JSON.stringify(value));} catch {}};
  function receipt(value) {
    if (!value || typeof value.back !== 'string' || !Array.isArray(value.items) || value.items.length > 30) return null;
    try {
      const url = new URL(value.back, location.origin);
      const key = url.searchParams.get('pedido'), proof = url.searchParams.get('comprobante');
      if (url.origin !== location.origin || url.pathname !== '/pago.html' || url.hash || url.username || url.password || !uuid.test(key || '') || !/^[a-f0-9]{64}$/.test(proof || '')) return null;
      const items = value.items;
      if (!items.length || items.some(i => !i || !uuid.test(i.id || '') || typeof i.size !== 'string' || !i.size || i.size.length > 15 || i.color !== undefined && (typeof i.color !== 'string' || i.color.length > 60 || i.color.trim() !== i.color) || !Number.isInteger(i.qty) || i.qty < 1 || i.qty > 20)) return null;
      return {key, proof, items, back: '/pago.html?' + new URLSearchParams({pedido: key, comprobante: proof})};
    } catch {return null;}
  }
  function retire(key) {
    // Visiting an old receipt must not erase a newer checkout in this tab.
    try {
      if (read(REQUEST)?.key === key) sessionStorage.removeItem(REQUEST);
      if (receipt(read(LAST))?.key === key) sessionStorage.removeItem(LAST);
    } catch {}
    if (current?.key === key) current = null;
  }
  function remember(result, items) {
    const saved = receipt({back: '/pago.html?' + new URLSearchParams({pedido: result.id, comprobante: result.proof}), items});
    if (!saved) throw new Error('No pudimos validar el comprobante de tu compra.');
    write(LAST, {back: saved.back, items});
    current = {...saved, status: null};
    return saved.back;
  }
  async function refresh() {
    if (pending) return pending;
    const saved = receipt(read(LAST)) || current;
    if (!saved) {current = null; return null;}
    current = {...saved, status: null};
    pending = (async () => {
      try {
        const response = await fetch('/api/checkout/status?' + new URLSearchParams({key: saved.key, proof: saved.proof}), {cache: 'no-store'});
        if (response.status === 404) {retire(saved.key); return null;}
        const data = await response.json();
        if (!response.ok || data.id !== saved.key) return current;
        if (data.retryAllowed === true && data.paid === false && !data.review && ['expired', 'cancelled', 'rejected'].includes(data.paymentStatus)) {
          retire(saved.key);
          return null;
        }
        // Do not overwrite a newer checkout if this response arrived late.
        if (current?.key === saved.key) current.status = data;
      } catch {
        // Keep the safe receipt link on a failed lookup instead of starting a
        // second order whose stock could conflict with the first reservation.
      }
      return current;
    })();
    try {return await pending;} finally {pending = null;}
  }
  function reservedQty(item) {
    if (current?.status?.reserved !== true) return 0;
    return current.items.filter(i => i.id === item.id && i.size === item.size && (i.color || '') === (item.color || '')).reduce((n, i) => n + i.qty, 0);
  }
  function render() {
    const box = document.getElementById('checkoutRecovery');
    if (!box) return;
    box.hidden = !current;
    if (!current) return;
    document.getElementById('checkoutRecoveryText').textContent = current.status?.reserved ? 'Tu selección está reservada para vos. Retomá tu compra sin volver a agregar las prendas.' : 'Tenés una compra iniciada. Consultá su estado antes de iniciar otra.';
    document.getElementById('checkoutRecoveryLink').href = current.back;
  }
  window.AzulCheckoutRecovery = {remember, refresh, retire, reservedQty, render, get: () => current};
})();
