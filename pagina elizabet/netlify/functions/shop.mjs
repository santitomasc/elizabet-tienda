import {runtime} from '../../lib/runtime.mjs';
import {safe,ShopError} from '../../lib/shop.mjs';
export default async function handler(request){return safe(async()=>{const shop=runtime(),p=new URL(request.url).pathname;if(p==='/api/catalog'&&request.method==='GET')return shop.catalog(request);if(p.startsWith('/api/admin/'))return shop.admin(request);if(p==='/api/orders'&&request.method==='POST')return shop.order(request);if(p.startsWith('/media/')&&request.method==='GET')return shop.media(request);throw new ShopError('Ruta no encontrada.',404)})}
export const config={path:['/api/catalog','/api/admin/*','/api/orders','/media/*']};
