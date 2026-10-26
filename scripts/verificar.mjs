import {readFileSync,existsSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const files=['public/app.js','public/admin.js','lib/auth.mjs','lib/shop.mjs','lib/runtime.mjs','netlify/functions/shop.mjs','netlify/functions/auth.mjs'];
for(const file of files){const r=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});if(r.status!==0)process.exit(1)}
for(const file of ['public/index.html','public/admin.html','netlify.toml'])if(!existsSync(file))throw new Error('Falta '+file);
for(const file of ['public/index.html','public/admin.html','public/app.js','public/admin.js'])if(/signin-with-chatgpt|chatGPTSignIn|oai-authenticated-user|chatgpt\.site/.test(readFileSync(file,'utf8')))throw new Error('Quedó una dependencia de la plataforma anterior en '+file);
writeFileSync('lib/deploy-context.mjs','export const deployContext = '+JSON.stringify(process.env.CONTEXT||'local')+';\n');
console.log('Proyecto de Netlify verificado. Frontend estático + Functions + Blobs.');
