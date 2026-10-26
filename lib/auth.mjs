import { createHmac, timingSafeEqual, pbkdf2, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
const derive=promisify(pbkdf2), cookieName='__Host-elizabet_admin';
export function configured(config){return !!(config.ADMIN_USER&&/^pbkdf2\$600000\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(config.ADMIN_PASSWORD_HASH||'')&&config.SESSION_SECRET?.length>=64)}
export async function hashPassword(password){if(typeof password!=='string'||password.length<14||password.length>200)throw new Error('Usá una contraseña de entre 14 y 200 caracteres.');const salt=randomBytes(16).toString('hex'),hash=await derive(password,salt,600000,32,'sha256');return `pbkdf2$600000$${salt}$${hash.toString('hex')}`}
const equal=(a,b)=>{const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb)};
export async function validPassword(user,password,config){if(!configured(config)||typeof user!=='string'||typeof password!=='string'||password.length>200)return false;const [,iterations,salt,hash]=config.ADMIN_PASSWORD_HASH.split('$');const actual=(await derive(password,salt,Number(iterations),32,'sha256')).toString('hex');return equal(actual,hash)&&equal(user,config.ADMIN_USER)}
function signature(payload,config){return createHmac('sha256',config.SESSION_SECRET).update(payload).digest('base64url')}
export function issueSession(config,now=Date.now()){const payload=Buffer.from(JSON.stringify({user:config.ADMIN_USER,exp:now+8*3600000})).toString('base64url');return payload+'.'+signature(payload,config)}
export function sessionUser(request,config,now=Date.now()){if(!configured(config))return null;const token=request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);if(!token||token.length>1500)return null;const [payload,sig]=token.split('.');if(!payload||!sig||!equal(sig,signature(payload,config)))return null;try{const data=JSON.parse(Buffer.from(payload,'base64url').toString());if(data.user!==config.ADMIN_USER||!Number.isFinite(data.exp)||data.exp<now)return null;return {uid:'shop-admin',email:'',owner:true,name:config.ADMIN_USER}}catch{return null}}
export function sessionCookie(token){return `${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`}
export function clearCookie(){return `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`}
