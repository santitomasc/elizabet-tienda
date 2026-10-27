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
    banner.textContent = 'PRÁCTICA DE MERCADO PAGO · Elegí prendas y abrí el carrito. Esta prueba no modifica pedidos ni stock.';
    $('#checkoutBtn').textContent = 'Probar pago con Mercado Pago →';
    $('#checkoutBtn').onclick = function () {
      if (!cart.length) return;
      closeCart();
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
          $('#infoContent').innerHTML = `<div class="eyebrow">ENLACE DE PRUEBA LISTO</div><h2>Ahora, Mercado Pago.</h2><p>Importe de prueba: <strong>${money(result.total)}</strong>.</p><p>Abrí el enlace en una ventana de incógnito para evitar que entre tu cuenta personal de Mercado Pago. Ingresá con la cuenta <strong>compradora de prueba</strong>, distinta de la vendedora.</p><a class="button dark" href="${esc(result.url)}" rel="noreferrer">Abrir Mercado Pago <span>↗</span></a><button id="copyPracticeLink" class="button" style="margin-top:12px;width:100%">Copiar enlace para incógnito</button><p id="copyPracticeStatus" role="status"></p><label>Enlace de prueba<input id="practiceLink" readonly value="${esc(result.url)}" style="width:100%;font-size:13px"></label><p class="fineprint">No se creó un pedido de venta. Al finalizar, volvé al sitio para verificar el resultado.</p>`;
          $('#copyPracticeLink').onclick = async () => {
            try {await navigator.clipboard.writeText(result.url); $('#copyPracticeStatus').textContent = 'Enlace copiado. Pegalo en una pestaña de incógnito.';}
            catch {$('#practiceLink').focus(); $('#practiceLink').select(); $('#copyPracticeStatus').textContent = 'Mantené apretado el enlace y elegí Copiar.';}
          };
        } catch (e) {
          $('#practiceError').textContent = e.message;
          practiceKey = newKey(); button.disabled = false; button.textContent = 'Volver a intentar →';
        }
      };
    };
  } catch (e) {banner.textContent = 'No pudimos preparar la práctica: ' + e.message;}
})();
