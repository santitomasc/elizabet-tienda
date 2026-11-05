import {livePaymentRuntime} from '../../lib/runtime.mjs';
import {safe} from '../../lib/shop.mjs';

const handleCheckout = async request => safe(async () => {
  const webhook =
    new URL(request.url).pathname === '/api/checkout/webhook';

  if (webhook) console.info('MP webhook: recibido');

  try {
    const response = await livePaymentRuntime().handle(request);
    if (webhook) console.info('MP webhook: procesado');
    return response;
  } catch (error) {
    if (webhook) {
      const reasons = [
        'Firma no válida.',
        'Firma no válida o vencida.',
        'Notificación no válida.',
        'La notificación no corresponde al entorno real de la tienda.',
        'La orden no coincide con el pedido, el importe o la cuenta real de la tienda.'
      ];

      console.error('MP webhook: rechazado', {
        reason: reasons.includes(error.message)
          ? error.message
          : 'Error interno o consulta a Mercado Pago'
      });
    }
    throw error;
  }
});
export default async request => {
  const response = await handleCheckout(request);
  response.headers.set('X-Azul-Diagnostico', 'webhook-2');
  return response;
};
export const config = {path:'/api/checkout/*'};
