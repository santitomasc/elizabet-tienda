import {randomUUID,createHmac} from 'node:crypto';
import {createShop,safe} from '../../lib/shop.mjs';
import {createLivePayments} from '../../lib/live-payments.mjs';
import {issueSession,hashPassword} from '../../lib/auth.mjs';
const testHash=await hashPassword('fake-password-only-for-tests');
export class MemoryStore {
 map=new Map();version=0;
 async get(key,{type}={}){const v=this.map.get(key);return v?type==='json'?structuredClone(v.data):JSON.stringify(v.data):null;}
 async getWithMetadata(key){const v=this.map.get(key);return v?{data:structuredClone(v.data),etag:v.etag}:null;}
 async setJSON(key,data,options={}){const old=this.map.get(key);if(options.onlyIfNew&&old||options.onlyIfMatch&&old?.etag!==options.onlyIfMatch)return {modified:false};const etag=String(++this.version);this.map.set(key,{data:structuredClone(data),etag});return {modified:true,etag};}
 async list({prefix}){return {blobs:[...this.map.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key}))};}
}
export async function fixture({stock=3,environment='production',extraConfig={},testSeller=false,failCreate=false,denyCreate=false,failCancel=false}={}){
 const records=new MemoryStore(),config={ADMIN_USER:'eli',ADMIN_PASSWORD_HASH:testHash,SESSION_SECRET:'a'.repeat(96),MERCADOPAGO_LIVE_ACCESS_TOKEN:'fake-not-a-real-token',MERCADOPAGO_WEBHOOK_SECRET:'fake-secret',MERCADOPAGO_COLLECTOR_ID:'456',STORE_URL:'https://shop.test',MERCADOPAGO_LIVE_ENABLED:'true',...extraConfig};
 const product={id:randomUUID(),name:'Remera',price:18000,category:'Remeras',photos:['/assets/shirt.jpg'],variants:[{size:'XL',stock}],active:true,sample:false,revision:1};
 await records.setJSON('inventory/catalog-v2',{version:2,products:[product],orders:{}});await records.setJSON('settings/brand',{acceptOrders:true,pickup:true,delivery:true});
 const shop=createShop({records,photos:new MemoryStore(),config});let clock=Date.parse('2026-10-31T15:00:00Z'),created=0,seen=[],orders=new Map(),idempotency=new Map();
 async function fetcher(url,options){const u=new URL(url),path=u.pathname;seen.push({path,options,query:u.searchParams.toString()});
  if(path==='/users/me')return Response.json({id:456,site_id:'MLA',tags:testSeller?['test_user']:['normal']});
  if(path==='/v1/orders'&&options.method==='POST'){
   if(denyCreate)return Response.json({error:'invalid_request'}, {status:400});
   const key=options.headers['X-Idempotency-Key'];if(!key)throw new Error('missing idempotency');if(idempotency.has(key))return Response.json({error:'idempotency_key_already_used'},{status:409});
   created++;const b=JSON.parse(options.body),id='ORD'+String(created).padStart(26,'0');
   const p={id,type:b.type,processing_mode:b.processing_mode,capture_mode:b.capture_mode,total_amount:b.total_amount,total_paid_amount:'0.00',external_reference:b.external_reference,user_id:'456',country_code:'ARG',currency:'ARS',created_date:new Date(clock).toISOString(),last_updated_date:new Date(clock).toISOString(),expiration_time:b.expiration_time,status:'created',status_detail:'created',checkout_url:'https://www.mercadopago.com.ar/checkout/v1/redirect?order_id='+id,items:b.items,config:{online:{retries:{allowed:false}}},transactions:{payments:[]},version:1};
   orders.set(id,p);idempotency.set(key,id);if(failCreate)throw new Error('timeout after accepted creation');return Response.json(p);
  }
  if(path==='/v1/orders'&&(!options.method||options.method==='GET')){
   if(!u.searchParams.has('begin_date')||!u.searchParams.has('end_date'))return new Response(null,{status:400});
   const data=[...orders.values()].filter(p=>p.external_reference===u.searchParams.get('external_reference')).map(p=>({id:p.id,status:p.status}));
   return Response.json({data,paging:{total:String(data.length),offset:'0',limit:'10'}});
  }
  if(path.endsWith('/cancel')){
   if(failCancel)return new Response(null,{status:502});
   if(!options.headers['X-Idempotency-Key'])throw new Error('cancel key missing');
   const p=orders.get(path.split('/').at(-2));if(p.status!=='created')return new Response(null,{status:409});p.status='canceled';p.status_detail='canceled_transaction';p.last_updated_date=new Date(clock).toISOString();p.version++;
   return Response.json({id:p.id,status:'canceled'}); // Response omits some fields.
  }
  if(path.startsWith('/v1/orders/')){const p=orders.get(path.split('/').at(-1));if(!p)return new Response(null,{status:404});const copy=structuredClone(p);delete copy.checkout_url;return Response.json(copy);}
  throw new Error('Unexpected provider path '+path);
 }
 const service=createLivePayments({records,inventory:shop.inventory,settings:shop.settings,config,environment,fetcher,now:()=>clock}),cookie='__Host-elizabet_admin='+issueSession(config);
 async function call(path,method='GET',b,headers={}){const r=await safe(()=>service.handle(new Request('https://shop.test'+path,{method,headers,body:b===undefined?undefined:JSON.stringify(b)})));return {status:r.status,data:await r.json()};}
 const body=(key=randomUUID(),extra={})=>({key,customer:'Compradora',phone:'5491112345678',email:'compradora@example.test',delivery:'Retiro',items:[{id:product.id,size:'XL',qty:1}],...extra});
 const create=async(b=body())=>call('/api/checkout/create','POST',b);
 const stored=async id=>(await shop.inventory.snapshot()).data.checkouts[id];
 const stockLeft=async()=> (await shop.inventory.products())[0].variants[0].stock;
 async function update(a,status='processed',detail='accredited',extra={}){const saved=await stored(a.id),p=orders.get(saved.mp_order_id)||[...orders.values()].find(x=>x.external_reference==='AZUL-'+a.id);Object.assign(p,{status,status_detail:detail,last_updated_date:new Date(clock).toISOString(),version:(p.version||0)+1},status==='processed'?{total_paid_amount:a.total.toFixed(2),transactions:{payments:[{id:'PAY'+'1'.repeat(26),amount:a.total.toFixed(2),paid_amount:a.total.toFixed(2),status:'processed',status_detail:'accredited'}]}}:{},extra);return p;}
 async function notify(p,{signature,topic='order',rawId=p.id,live_mode=true,user_id='456',ts=String(clock)}={}){const requestId='fake-request-id',v1=createHmac('sha256',config.MERCADOPAGO_WEBHOOK_SECRET).update(`id:${rawId};request-id:${requestId};ts:${ts};`).digest('hex');return call('/api/checkout/webhook?data.id='+rawId+'&type='+topic,'POST',{type:topic,user_id,live_mode,data:{id:p.id}},{'x-request-id':requestId,'x-signature':signature||'ts='+ts+',v1='+v1});}
 return {records,shop,service,config,product,body,create,call,cookie,stored,stockLeft,update,notify,seen,orders,fetcher,get created(){return created;},advance:ms=>clock+=ms};
}
