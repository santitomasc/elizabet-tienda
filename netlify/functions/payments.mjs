import {paymentRuntime} from '../../lib/runtime.mjs';
import {safe} from '../../lib/shop.mjs';
export default async function handler(request) {return safe(() => paymentRuntime().handle(request));}
export const config = {path:['/api/practice/status','/api/practice/checkout','/api/practice/verify']};
