import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {randomBytes} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {hashPassword} from '../lib/auth.mjs';
let hidden=false;
const output=new Writable({write(chunk,encoding,callback){if(!hidden)process.stdout.write(chunk);callback()}});output.isTTY=process.stdout.isTTY;
const rl=createInterface({input:process.stdin,output,terminal:!!process.stdin.isTTY});
try{
 const user=(await rl.question('Usuario para Elizabet (por ejemplo, elizabet): ')).trim();if(!/^[a-zA-Z0-9._-]{3,60}$/.test(user))throw new Error('Usá entre 3 y 60 letras, números, puntos, guiones o guiones bajos.');
 process.stdout.write('Contraseña nueva (mínimo 14 caracteres; no se verá al escribir): ');hidden=true;const password=await rl.question('');hidden=false;process.stdout.write('\n');
 process.stdout.write('Repetí la contraseña: ');hidden=true;const confirm=await rl.question('');hidden=false;process.stdout.write('\n');if(password!==confirm)throw new Error('Las contraseñas no coinciden.');
 const hash=await hashPassword(password),secret=randomBytes(48).toString('hex');
 const content=`ADMIN_USER=${user}\nADMIN_PASSWORD_HASH=${hash}\nSESSION_SECRET=${secret}\n`;writeFileSync('CONFIGURACION_PRIVADA.env',content,{mode:0o600});
 console.log('\nListo. Se creó CONFIGURACION_PRIVADA.env.\nImportá ese archivo en las variables de entorno del proyecto de Netlify.\nGuardalo en un lugar privado: no lo subas a GitHub ni lo compartas con compradores.\nLa contraseña elegida se la entregás a Elizabet por un medio privado.');
}catch(e){hidden=false;console.error('\n'+e.message);process.exitCode=1}finally{rl.close()}
