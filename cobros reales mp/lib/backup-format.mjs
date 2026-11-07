import {createHash} from 'node:crypto';

export const FORMAT = 'azul-bendito-backup-v1';
export const MAX_BYTES = 64 * 1024 * 1024;
export const MAX_ENTRIES = 5000;
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const manifestHash = entries => digest(JSON.stringify(entries.map(({store,key,etag}) => ({store,key,etag})).sort((a,b) => ((a.store+'\0'+a.key) < (b.store+'\0'+b.key) ? -1 : (a.store+'\0'+a.key) > (b.store+'\0'+b.key) ? 1 : 0))));

export function validateBackup(backup) {
  if (backup?.format !== FORMAT || !Array.isArray(backup.entries) || !backup.entries.length || backup.entries.length > MAX_ENTRIES) throw new Error('Formato de respaldo no válido.');
  if (!['production','local'].includes(backup.environment) && typeof backup.environment !== 'string') throw new Error('Falta el entorno de origen.');
  const seen = new Set(); let total = 0;
  for (const entry of backup.entries) {
    if (!['records','photos'].includes(entry.store) || typeof entry.key !== 'string' || !entry.key || entry.key.length > 600 || typeof entry.etag !== 'string' || !entry.etag) throw new Error('Entrada no válida.');
    const id = entry.store+'\0'+entry.key;
    if (seen.has(id)) throw new Error('El respaldo tiene entradas repetidas.');
    seen.add(id);
    if (!entry.metadata || typeof entry.metadata !== 'object' || Array.isArray(entry.metadata) || Buffer.byteLength(JSON.stringify(entry.metadata)) > 2048) throw new Error('Metadatos no válidos.');
    if (entry.metadataSha256 !== digest(JSON.stringify(entry.metadata))) throw new Error('Los metadatos del respaldo están dañados.');
    if (typeof entry.base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entry.base64)) throw new Error('Contenido no válido.');
    const bytes = Buffer.from(entry.base64, 'base64');
    total += bytes.length;
    if (total > MAX_BYTES || bytes.length > 4 * 1024 * 1024) throw new Error('El respaldo supera el tamaño permitido.');
    if (entry.bytes !== bytes.length || entry.sha256 !== digest(bytes)) throw new Error('El respaldo está dañado: no coincide la huella del contenido.');
    if (entry.store === 'records') {
      try { JSON.parse(bytes.toString('utf8')); } catch { throw new Error('Un registro del respaldo no es JSON válido.'); }
    }
  }
  if (!seen.has('records\0inventory/catalog-v2')) throw new Error('Falta el inventario del respaldo.');
  if (backup.manifestHash !== manifestHash(backup.entries)) throw new Error('La lista del respaldo no coincide con su huella.');
  return {entries: backup.entries.length, bytes: total};
}

// Solo admite destinos de recuperación separados de los almacenes reales.
export async function restoreToStores(backup, stores, names) {
  const summary = validateBackup(backup);
  for (const group of ['records','photos']) {
    if (!/^azul-restauracion-[a-z0-9-]+$/.test(names?.[group] || '') || names.records === names.photos) throw new Error('El destino debe ser un almacén de recuperación separado.');
    const {blobs} = await stores[group].list();
    if (blobs.length) throw new Error('El destino no está vacío. Usá un destino nuevo.');
  }
  for (const entry of backup.entries) {
    const store = stores[entry.store];
    const bytes = Buffer.from(entry.base64, 'base64');
    const write = await store.set(entry.key, bytes, {metadata: entry.metadata, onlyIfNew: true});
    if (!write.modified) throw new Error('El destino cambió durante la recuperación. Usá un destino nuevo.');
    const check = await store.getWithMetadata(entry.key, {type:'arrayBuffer'});
    if (!check || digest(Buffer.from(check.data)) !== entry.sha256 || JSON.stringify(check.metadata || {}) !== JSON.stringify(entry.metadata)) throw new Error('No se pudo verificar un archivo recuperado.');
  }
  return summary;
}
