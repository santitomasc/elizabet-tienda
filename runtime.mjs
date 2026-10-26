import {getStore,getDeployStore} from '@netlify/blobs';
import {deployContext} from './deploy-context.mjs';
import {createShop} from './shop.mjs';
export function runtime(){const preview=!['production','local'].includes(deployContext);const store=(name)=>preview?getDeployStore({name,consistency:'strong'}):getStore({name,consistency:'strong'});return createShop({records:store('elizabet-registros-v1'),photos:store('elizabet-fotos-v1'),config:process.env})}
