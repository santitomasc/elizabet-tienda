import {sessionUser} from './auth.mjs';
import {ShopError, json, originCheck} from './shop.mjs';
import {FORMAT, MAX_ENTRIES, digest, manifestHash} from './backup-format.mjs';

export function createBackup({records, photos, config, environment}) {
  const stores = {records, photos};
  return async request => {
    if (!sessionUser(request, config)) throw new ShopError('Ingresá al panel para descargar el respaldo.', 401);
    originCheck(request);
    if (request.method !== 'GET') throw new ShopError('Método no permitido.', 405);
    const url = new URL(request.url);
    if (url.pathname === '/api/backup/manifest') {
      const entries = [];
      for (const [store, client] of Object.entries(stores)) {
        const {blobs} = await client.list();
        for (const {key, etag} of blobs) {
          if (typeof etag !== 'string' || !etag) throw new ShopError('No se pudo comprobar la versión de los datos.', 503);
          entries.push({store,key,etag});
        }
      }
      if (entries.length > MAX_ENTRIES) throw new ShopError('El respaldo necesita una exportación asistida por su tamaño.', 413);
      if (!entries.some(e => e.store === 'records' && e.key === 'inventory/catalog-v2')) throw new ShopError('Abrí Mis productos antes de crear el primer respaldo.', 409);
      entries.sort((a,b) => ((a.store+'\0'+a.key) < (b.store+'\0'+b.key) ? -1 : (a.store+'\0'+a.key) > (b.store+'\0'+b.key) ? 1 : 0));
      return json({format:FORMAT, environment, createdAt:new Date().toISOString(), entries, manifestHash:manifestHash(entries)});
    }
    if (url.pathname === '/api/backup/item') {
      const store = url.searchParams.get('store'), key = url.searchParams.get('key'), etag = url.searchParams.get('etag');
      if (!Object.hasOwn(stores, store) || !key || key.length > 600 || !etag || etag.length > 300) throw new ShopError('Archivo de respaldo no válido.', 400);
      const entry = await stores[store].getWithMetadata(key, {type:'arrayBuffer'});
      if (!entry || entry.etag !== etag) throw new ShopError('La tienda cambió durante el respaldo. Volvé a descargarlo cuando no haya cambios.', 409);
      const bytes = Buffer.from(entry.data);
      if (bytes.length > 4 * 1024 * 1024) throw new ShopError('Un archivo necesita una exportación asistida por su tamaño.', 413);
      return json({store,key,etag,metadata:entry.metadata || {}, metadataSha256:digest(JSON.stringify(entry.metadata || {})), bytes:bytes.length, sha256:digest(bytes), base64:bytes.toString('base64')});
    }
    throw new ShopError('Ruta no encontrada.', 404);
  };
}
