import {readFile} from 'node:fs/promises';
import {getStore} from '@netlify/blobs';
import {validateBackup, restoreToStores} from '../lib/backup-format.mjs';

const [file, action] = process.argv.slice(2);
if (!file || action && action !== '--probar-en-netlify') {
  console.error('Uso: node scripts/restaurar-respaldo.mjs archivo.json [--probar-en-netlify]');
  process.exit(1);
}
try {
  const raw = await readFile(file);
  if (raw.length > 100 * 1024 * 1024) throw new Error('Archivo demasiado grande.');
  const backup = JSON.parse(raw.toString('utf8'));
  const summary = validateBackup(backup);
  console.log(`Integridad comprobada: ${summary.entries} archivos, ${summary.bytes} bytes.`);
  if (action) {
    const siteID = process.env.NETLIFY_SITE_ID, token = process.env.NETLIFY_AUTH_TOKEN;
    if (!siteID || !token) throw new Error('Faltan NETLIFY_SITE_ID y NETLIFY_AUTH_TOKEN en el entorno local. No los pegues en el código.');
    const prefix = 'azul-restauracion-'+new Date().toISOString().replace(/[^0-9]/g,'')+'-'+Math.random().toString(36).slice(2,8);
    const names = {records:prefix+'-registros', photos:prefix+'-fotos'};
    const stores = Object.fromEntries(Object.entries(names).map(([group,name]) => [group,getStore({name,siteID,token,consistency:'strong'})]));
    await restoreToStores(backup, stores, names);
    console.log('Recuperación y lectura de comprobación completadas en almacenes aislados:');
    console.log(names.records); console.log(names.photos);
    console.log('La tienda real no fue modificada. Estos almacenes no se sirven públicamente.');
  } else console.log('Solo comprobación local. No se escribió nada en Netlify.');
} catch (error) {
  console.error('No se completó la comprobación o recuperación:', error.message);
  process.exitCode = 1;
}
