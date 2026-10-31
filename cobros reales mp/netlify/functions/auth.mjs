import {runtime} from '../../lib/runtime.mjs';
import {safe} from '../../lib/shop.mjs';
export default async function handler(request){return safe(()=>runtime().auth(request))}
export const config={path:['/api/auth/login','/api/auth/logout'],rateLimit:{action:'rate_limit',aggregateBy:['ip','domain'],windowLimit:10,windowSize:60}};
