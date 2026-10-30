// Optional, private practice mode. It is enabled only after the server confirms
// an administrator session, and it never submits /api/orders.
(async function () {
  if (new URLSearchParams(location.search).get('practica') !== '1') return;
  const banner = document.createElement('div');
  banner.className = 'demo-note';
  banner.style.cssText = 'margin:0;padding:16px 22px;text-align:center;border-radius:0';
  banner.setAttribute('role', 'status');
  banner.textContent = 'Preparando la práctica de Mercado Pago…';
  document.body.prepend(banner);
  try {
    const status = await api('/api/practice/status');
    if (!status.admin) {
      banner.innerHTML = 'Para probar pagos, <a href="/admin">ingresá a tu panel</a> y tocá “Probar pagos”.';
      return;
    }
    if (!status.configured) {
      banner.textContent = 'Falta guardar el Access Token de prueba en Netlify y volver a publicar.';
      return;
    }
    const dialog = $('#infoDialog'), storageKey = 'elizabet-practice-link-v2';
    let lastLink = null;
    function validLink(value) {
      try {
        const url = new URL(value?.url);
        return Number.isFinite(value.total) && value.total > 0 && Number.isFinite(value.savedAt) && Date.now() - value.savedAt < 45 * 60000 && value.savedAt <= Date.now() && url.protocol === 'https:' && !url.username && !url.password && ['www.mercadopago.com.ar','www.mercadopago.com','mercadopago.com.ar'].includes(url.hostname);
      } catch {return false;}
    }
    try {const saved = JSON.parse(sessionStorage.getItem(storageKey)); if (validLink(saved)) lastLink = saved; else sessionStorage.removeItem(storageKey);} catch {}
    banner.innerHTML = '<span>PRÁCTICA DE MERCADO PAGO · Elegí prendas y abrí el carrito. Esta prueba no modifica pedidos ni stock.</span> <button type="button" id="recoverPracticeLink" style="display:block;margin:10px auto 0;padding:10px 18px;border:1px solid currentColor;font-weight:600" hidden>Recuperar último enlace de prueba</button>';
    const recover = $('#recoverPracticeLink');
    recover.hidden = !lastLink;
    // The store normally closes dialogs on a backdrop click. A selection or a
    // clipboard interaction must not dismiss the payment link by that handler.
    dialog.addEventListener('click', event => {
      if (dialog.dataset.practiceLinkReady === 'true' && event.target === dialog) event.stopImmediatePropagation();
    }, true);
    function showLink(result, remember = false) {
      const saved = remember ? {...result, savedAt:Date.now()} : result;
      if (!validLink(saved)) {recover.hidden = true; toast('El enlace venció. Prepará un nuevo pago de prueba desde el carrito.'); return;}
      if (remember) {
        lastLink = saved; recover.hidden = false;
        try {sessionStorage.setItem(storageKey, JSON.stringify({url:saved.url,total:saved.total,savedAt:saved.savedAt}));} catch {}
      }
      dialog.dataset.practiceLinkReady = 'true';
      $('#infoContent').innerHTML = `<div class="eyebrow">ENLACE DE PRUEBA LISTO</div><h2>Copiá tu enlace de prueba.</h2><p>Importe de prueba: <strong>${money(result.total)}</strong>.</p><p>Tocá el botón para copiar. Después abrí una ventana de incógnito con <strong>Ctrl + Shift + N</strong> y pegá el enlace con <strong>Ctrl + V</strong>.</p><button type="button" id="copyPracticeLink" class="button dark" style="width:100%;justify-content:center">COPIAR ENLACE DE PRUEBA</button><p id="copyPracticeStatus" role="status" aria-live="polite">El enlace queda disponible aunque cierres esta ventana.</p><label for="practiceLink">Enlace de prueba</label><textarea id="practiceLink" readonly rows="3" spellcheck="false" style="width:100%;font-size:14px;overflow-wrap:anywhere;resize:vertical">${esc(result.url)}</textarea><a class="button" href="${esc(result.url)}" target="_blank" rel="noopener noreferrer" style="width:100%;margin-top:12px;justify-content:center;border:1px solid currentColor">Abrir enlace en otra pestaña ↗</a><p>En Mercado Pago, ingresá con la cuenta <strong>compradora de prueba</strong> y usá una tarjeta de prueba.</p><p class="fineprint">Si se cierra esta ventana, usá “Recuperar último enlace de prueba” en la barra superior. No se creó un pedido de venta.</p>`;
      if (!dialog.open) dialog.showModal();
      const field = $('#practiceLink'), button = $('#copyPracticeLink'), status = $('#copyPracticeStatus');
      field.addEventListener('click', event => event.stopPropagation());
      field.addEventListener('pointerdown', event => event.stopPropagation());
      button.onclick = async event => {
        event.preventDefault(); event.stopPropagation();
        let copied = false;
        try {await navigator.clipboard.writeText(result.url); copied = true;} catch {
          field.focus(); field.select();
          try {copied = document.execCommand('copy');} catch {}
        }
        if (!dialog.open) dialog.showModal();
        button.textContent = copied ? '✓ ENLACE COPIADO · COPIAR OTRA VEZ' : 'SELECCIONAR ENLACE PARA COPIAR';
        status.textContent = copied ? 'Listo. Abrí incógnito con Ctrl + Shift + N y pegá con Ctrl + V.' : 'El navegador bloqueó la copia automática. El enlace está seleccionado: presioná Ctrl + C o mantenelo apretado y elegí Copiar.';
      };
    }
    recover.onclick = event => {event.preventDefault();event.stopPropagation();if(lastLink)showLink(lastLink);};
    $('#checkoutBtn').textContent = 'Probar pago con Mercado Pago →';
    $('#checkoutBtn').onclick = function () {
      if (!cart.length) return;
      closeCart();
      dialog.dataset.practiceLinkReady = 'false';
      let practiceKey = newKey();
      $('#infoContent').innerHTML = `<div class="eyebrow">PRÁCTICA PRIVADA</div><h2>Probá tu primera compra.</h2>${cart.map(item => {
        const p = products.find(p => p.id === item.id);
        return `<p class="checkout-line"><span>${item.qty} × ${esc(p?.name || 'Prenda')}<br><small>Talle ${esc(item.size)}</small></span><strong>${money((p?.price || 0)*item.qty)}</strong></p>`;
      }).join('')}<div class="checkout-total"><span>Total de prueba</span><strong>${money(total())}</strong></div><p>Usá una cuenta compradora de prueba y una tarjeta de prueba. No uses tu cuenta personal ni una tarjeta real.</p><p>Al continuar se prepara un enlace para abrir Mercado Pago. La práctica conserva tu carrito y no cambia el stock.</p><p id="practiceError" class="form-error" role="alert"></p><button id="practicePay" class="button dark">Preparar pago de prueba <span>→</span></button><p class="fineprint"><a href="https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-preferences/integration-test/test-purchases" target="_blank" rel="noopener noreferrer">Ver tarjetas y pasos de prueba oficiales ↗</a></p>`;
      $('#infoDialog').showModal();
      $('#practicePay').onclick = async function () {
        const button = this;
        button.disabled = true;
        $('#practiceError').textContent = '';
        button.textContent = 'Preparando…';
        try {
          const result = await api('/api/practice/checkout', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({key:practiceKey, items:cart.map(({id,size,qty}) => ({id,size,qty}))})});
          showLink(result, true);
        } catch (e) {
          $('#practiceError').textContent = e.message;
          practiceKey = newKey(); button.disabled = false; button.textContent = 'Volver a intentar →';
        }
      };
    };
  } catch (e) {banner.textContent = 'No pudimos preparar la práctica: ' + e.message;}
})();
