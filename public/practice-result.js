const parameters = new URLSearchParams(location.search);
const attempt = parameters.get('ensayo');
const input = document.getElementById('paymentId');
const returnedId = parameters.get('payment_id') || parameters.get('collection_id');
if (/^\d{1,30}$/.test(returnedId || '')) input.value = returnedId;
document.getElementById('verifyForm').onsubmit = async event => {
  event.preventDefault();
  const button = document.getElementById('verifyButton'), error = document.getElementById('resultError'), result = document.getElementById('verifiedResult');
  button.disabled = true; error.textContent = ''; result.textContent = '';
  try {
    const response = await fetch('/api/practice/verify', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({key:attempt, paymentId:input.value.trim()})});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No pudimos verificar esta prueba.');
    const states = {approved:'Prueba aprobada', pending:'Prueba pendiente', in_process:'Prueba en proceso', rejected:'Prueba rechazada', cancelled:'Prueba cancelada', refunded:'Prueba reembolsada', charged_back:'Prueba con contracargo', authorized:'Prueba autorizada, aún sin captura'};
    document.getElementById('resultTitle').textContent = states[data.status] || 'Estado de la prueba: ' + data.status;
    document.getElementById('resultCopy').textContent = 'Resultado consultado directamente a Mercado Pago. Número de pago: ' + data.id + '.';
    result.textContent = 'Total verificado: ' + new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS'}).format(data.total) + '. Tu stock y tus pedidos de venta se mantienen iguales.';
  } catch (e) {error.textContent = e.message;} finally {button.disabled = false;}
};
