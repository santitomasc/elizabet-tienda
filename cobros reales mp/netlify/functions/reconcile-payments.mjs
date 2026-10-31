import {livePaymentRuntime} from '../../lib/runtime.mjs';
export default async function(){const result=await livePaymentRuntime().sweep();if(result.failed)console.error('No se pudieron conciliar algunos pagos; se conservan sus reservas.');return new Response(null,{status:200});}
export const config={schedule:'*/5 * * * *'};
