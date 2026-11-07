# Respaldo de AZUL bendito

## Publicar este cambio

El ZIP de cambios contiene la carpeta `cobros reales mp`. No reemplazar el repositorio por una carpeta vacía ni borrar archivos existentes.

1. Descomprimir el ZIP de cambios en la computadora.
2. En GitHub, abrir la raíz de `santitomasc/elizabet-tienda`, rama `main`.
3. Elegir **Add file → Upload files**.
4. Arrastrar la carpeta **cobros reales mp** del ZIP. GitHub debe mostrar rutas como `cobros reales mp/lib/backup.mjs`. No arrastrar solo su contenido en la raíz.
5. Confirmar con el mensaje **Agregar respaldo manual de datos y fotos**.
6. Esperar el deploy de Netlify. Si está Canceled, reintentar el deploy de este último commit. No reintentar uno antiguo.
7. Cuando diga Published, recargar `/admin` con Ctrl + Shift + R.

## Prueba real después de publicar

1. Ingresar al panel y abrir **Mis productos**.
2. En el lateral inferior, elegir **Respaldo**.
3. Descargar la copia. Hacerlo cuando nadie esté modificando productos o pedidos.
4. Confirmar que el navegador guardó el archivo `.json` en Descargas.
5. En **Comprobar una copia**, seleccionar ese archivo: debe informar integridad comprobada.
6. Guardar una segunda copia en almacenamiento privado protegido. El archivo contiene datos personales y referencias de pagos: no subir a GitHub, no enviar por enlaces públicos ni adjuntarlo al chat para esta prueba.
7. Cerrar sesión y volver a intentar descargar: la API debe rechazar el acceso. La pantalla explicativa es pública, los archivos de respaldo no lo son.

Es una copia MANUAL. No se ha configurado ninguna tarea automática ni almacenamiento externo. Mantener varias fechas: por ejemplo siete copias diarias y cuatro semanales, según el volumen de trabajo. Es una pauta de operación, no una función ya automatizada.

## Qué incluye

- Todos los objetos de `elizabet-registros-v1`: inventario, movimientos, pedidos, datos asociados a pagos, configuración y registros auxiliares existentes.
- Todos los objetos de `elizabet-fotos-v1`, con bytes originales y metadatos.
- Listado de versiones, fecha y huellas SHA-256 de contenido y metadatos.

No incluye variables de Netlify ni contraseñas. El código y los archivos estáticos de `public/assets` se conservan por separado en GitHub: mantener también una copia del repositorio.

La descarga compara el listado de versiones antes y después y comprueba cada versión al leerla. Si cambia la tienda, no guarda una copia como válida y pide repetir. No bloquea ventas. No es una transacción entre almacenes ni promete una copia instantánea durante actividad continua.

Límites de esta versión: 64 MiB de datos originales, 4 MiB por objeto, 5.000 objetos y 100 MiB por archivo de respaldo al comprobarlo. Si se superan, solicitar exportación asistida; no omitir fotos ni pedidos para simular una copia completa.

Las huellas detectan corrupción accidental: no son una firma que pruebe quién creó la copia. Conservar el archivo original en una ubicación confiable. El JSON no está cifrado.

## Recuperación: primero en un destino aislado

La página NO ofrece un botón para sobrescribir producción. El script está pensado para quien administra técnicamente el sitio.

Comprobar localmente desde `cobros reales mp`, con Node 22 o superior y las dependencias instaladas:

```sh
node scripts/restaurar-respaldo.mjs /ruta/privada/copia.json
```

Por defecto solo comprueba: no conecta ni escribe en Netlify.

Para una prueba real en Netlify, el administrador configura localmente `NETLIFY_SITE_ID` y `NETLIFY_AUTH_TOKEN` mediante su entorno seguro, nunca dentro del código o GitHub. Ejecutar:

```sh
node scripts/restaurar-respaldo.mjs /ruta/privada/copia.json --probar-en-netlify
```

El script crea destinos nuevos con prefijo `azul-restauracion-`, exige que estén vacíos, copia los datos y fotos y vuelve a leerlos para verificar sus huellas y metadatos. No permite usar `elizabet-registros-v1` ni `elizabet-fotos-v1` como destino. No altera pagos ni contacta a Mercado Pago. Si falla a mitad, puede dejar un destino de prueba parcial: no usarlo y repetir en destinos nuevos. Los destinos de prueba también contienen datos privados; el administrador debe eliminarlos desde Netlify al finalizar su revisión.

Esto prueba copia y lectura; no arranca una tienda de ensayo ni ejecuta compras. Una recuperación real exige un procedimiento aparte: detener escrituras de forma controlada, preservar el estado actual, elegir la fecha correcta, reconciliar cobros posteriores y validar stock. Nunca restaurar a ciegas un inventario antiguo sobre ventas nuevas.

## Validación realizada antes de entregar

- Build y comprobación de sintaxis del proyecto.
- Suite de pagos, stock y tienda conservada.
- Exportación, descarga del cliente y validación local con datos simulados.
- Recuperación y lectura de datos/fotos/metadatos en almacenes simulados aislados.
- Rechazo sin sesión, sesión vencida, origen ajeno y métodos de escritura.
- Rechazo de corrupción, duplicados, inventario faltante y cambios durante descarga.
- Bloqueo de destinos reales y destinos ocupados.

No se accedió a los datos reales ni se desplegó desde este entorno. La descarga de producción y la recuperación en almacenes reales de prueba quedan pendientes de validación tras publicar.

Este cambio no constituye una auditoría de seguridad completa. No agrega segundo factor, sesiones revocables individualmente ni backups automáticos.
