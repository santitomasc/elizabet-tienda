const $ = id => document.getElementById(id);
const MAX_BYTES = 64 * 1024 * 1024;
let controller;
const hex = bytes => [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2,'0')).join('');
const hash = async bytes => hex(await crypto.subtle.digest('SHA-256', bytes));
const manifestHash = async entries => hash(new TextEncoder().encode(JSON.stringify(entries.map(({store,key,etag}) => ({store,key,etag})).sort((a,b) => ((a.store+'\0'+a.key) < (b.store+'\0'+b.key) ? -1 : (a.store+'\0'+a.key) > (b.store+'\0'+b.key) ? 1 : 0)))));
function decode(base64) {
  if (typeof base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error('Contenido de respaldo no válido.');
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}
async function validate(backup) {
  if (backup?.format !== 'azul-bendito-backup-v1' || !Array.isArray(backup.entries) || !backup.entries.length || backup.entries.length > 5000) throw new Error('Formato de respaldo no válido.');
  const seen = new Set(); let total = 0;
  for (const entry of backup.entries) {
    if (!['records','photos'].includes(entry.store) || typeof entry.key !== 'string' || !entry.key || entry.key.length > 600 || typeof entry.etag !== 'string' || !entry.etag) throw new Error('Entrada de respaldo no válida.');
    const id = entry.store+'\0'+entry.key;
    if (seen.has(id)) throw new Error('La copia tiene entradas repetidas.');
    seen.add(id);
    if (!entry.metadata || typeof entry.metadata !== 'object' || Array.isArray(entry.metadata) || new TextEncoder().encode(JSON.stringify(entry.metadata)).length > 2048) throw new Error('Metadatos no válidos.');
    if (entry.metadataSha256 !== await hash(new TextEncoder().encode(JSON.stringify(entry.metadata)))) throw new Error('Los metadatos de la copia están dañados.');
    const bytes = decode(entry.base64); total += bytes.length;
    if (total > MAX_BYTES || bytes.length > 4 * 1024 * 1024) throw new Error('La copia supera el tamaño admitido.');
    if (entry.bytes !== bytes.length || entry.sha256 !== await hash(bytes)) throw new Error('La copia está dañada o incompleta.');
    if (entry.store === 'records') JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
  }
  if (!seen.has('records\0inventory/catalog-v2') || backup.manifestHash !== await manifestHash(backup.entries)) throw new Error('El inventario o la lista de archivos está incompleto.');
  return total;
}
async function api(path) {
  const r = await fetch('/api/backup/'+path, {signal:controller.signal, cache:'no-store'});
  const b = await r.json();
  if (!r.ok) throw new Error(b.error || 'No pudimos descargar el respaldo.');
  return b;
}
$('cancel').onclick = () => controller?.abort();
$('download').onclick = async () => {
  controller = new AbortController();
  $('download').disabled = true; $('cancel').hidden = false;
  $('status').textContent = 'Consultando los archivos de la tienda…';
  try {
    const start = await api('manifest');
    const entries = []; let total = 0;
    for (const entry of start.entries) {
      $('status').textContent = `Descargando archivo ${entries.length+1} de ${start.entries.length}…`;
      const item = await api('item?'+new URLSearchParams(entry));
      if (item.store !== entry.store || item.key !== entry.key || item.etag !== entry.etag || !Number.isSafeInteger(item.bytes) || item.bytes < 0) throw new Error('La respuesta del respaldo no coincide con el archivo solicitado.');
      total += item.bytes;
      if (total > MAX_BYTES) throw new Error('La copia supera 64 MB. Solicitá una exportación asistida.');
      entries.push(item);
    }
    const end = await api('manifest');
    if (end.manifestHash !== start.manifestHash) throw new Error('La tienda cambió durante la descarga. Repetí el respaldo cuando no haya cambios.');
    const backup = {...start, completedAt:new Date().toISOString(), entries};
    $('status').textContent = 'Comprobando el contenido descargado…';
    await validate(backup);
    controller.signal.throwIfAborted();
    const blob = new Blob([JSON.stringify(backup)], {type:'application/json'});
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'azul-bendito-respaldo-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    $('status').textContent = `Copia comprobada: ${entries.filter(e=>e.store==='records').length} registros y ${entries.filter(e=>e.store==='photos').length} fotos. Se solicitó la descarga: confirmá que el archivo esté en Descargas y comprobalo abajo.`;
  } catch (error) {
    $('status').textContent = error.name === 'AbortError' ? 'Descarga cancelada. No se modificó la tienda.' : error.message;
  } finally { $('download').disabled = false; $('cancel').hidden = true; }
};
$('file').onchange = async () => {
  const file = $('file').files[0]; if (!file) return;
  $('file').disabled = true; $('validation').textContent = 'Comprobando la copia…';
  try {
    if (file.size > 100 * 1024 * 1024) throw new Error('El archivo supera el tamaño admitido.');
    const backup = JSON.parse(await file.text());
    const bytes = await validate(backup);
    $('validation').textContent = `Integridad comprobada: ${backup.entries.length} archivos, ${(bytes/1024/1024).toFixed(2)} MB. Origen: ${backup.environment}. Fecha de la copia: ${backup.createdAt}. Esto comprueba el archivo; la recuperación se prueba por separado.`;
  } catch (error) { $('validation').textContent = 'No pudimos validar la copia: '+error.message; }
  finally { $('file').disabled = false; }
};
