import {getStore,getDeployStore} from '@netlify/blobs';
import {deployContext} from './deploy-context.mjs';
import {createShop} from './shop.mjs';
import {createPaymentPractice} from './payment-practice.mjs';
export function runtime(){const preview=!['production','local'].includes(deployContext);const store=(name)=>preview?getDeployStore({name,consistency:'strong'}):getStore({name,consistency:'strong'});return createShop({records:store('elizabet-registros-v1'),photos:store('elizabet-fotos-v1'),config:process.env})}
export function paymentRuntime(){const preview=!['production','local'].includes(deployContext);const records=preview?getDeployStore({name:'elizabet-registros-v1',consistency:'strong'}):getStore({name:'elizabet-registros-v1',consistency:'strong'});const shop=runtime();return createPaymentPractice({records,config:process.env,listProducts:async()=> (await (await shop.catalog()).json()).products});}
