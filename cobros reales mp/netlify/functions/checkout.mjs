import {livePaymentRuntime} from '../../lib/runtime.mjs';
import {safe} from '../../lib/shop.mjs';
export default async request=>safe(()=>livePaymentRuntime().handle(request));
export const config={path:'/api/checkout/*'};
