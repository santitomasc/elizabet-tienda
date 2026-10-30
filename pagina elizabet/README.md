AZUL BENDITO · PROYECTO COMPLETO PARA NETLIFY

ESTA ENTREGA
Incluye el sitio, el panel, las Functions, el catálogo y almacenamiento de fotos,
el inventario, las pruebas y la configuración para compilar en Netlify.
No incluye contraseñas ni claves privadas. Mercado Pago para ventas reales
queda pendiente: el carrito normal no realiza cobros.

PARA QUE ELI VEA EL DISEÑO SIN INSTALAR NADA
Enviarle AZUL_Bendito_Ver_Diseno.html. Descargarlo y abrirlo con Chrome en una
computadora. Puede recorrer el diseño, usar el menú, elegir secciones y talles,
sumar prendas al carrito y cambiar cantidades. Los productos y precios son
ilustrativos. El formulario de esta vista no envía consultas. El panel y el
guardado de fotos se prueban en la tienda publicada, no en el archivo HTML.

PARA ACTUALIZAR TU PROYECTO ACTUAL elicdu
1. Descomprimir este ZIP en la computadora.
2. Abrir https://github.com/santitomasc/elizabet-tienda
3. En la raíz del repositorio: Add file → Upload files.
4. Arrastrar las carpetas COMPLETAS public, lib, netlify, scripts y tests.
   Agregar package.json, package-lock.json y netlify.toml desde esta carpeta.
   Si pregunta por reemplazar archivos, se actualizan los del mismo nombre.
   NO abrir las carpetas para arrastrar sus archivos sueltos a la raíz.
   NO subir el ZIP como archivo al repositorio.
5. Tocar Commit changes. Netlify compilará el proyecto conectado a GitHub.
6. Abrir https://app.netlify.com/projects/elicdu/deploys y esperar a que el
   despliegue más reciente diga Published. Si falla, revisar su registro.
7. Abrir https://elicdu.netlify.app y actualizar con Ctrl + F5.

ESTRUCTURA QUE DEBE QUEDAR EN LA RAÍZ DE GITHUB
package.json
package-lock.json
netlify.toml
public/
lib/
netlify/
scripts/
tests/

MANTENER LOS DATOS Y EL ACCESO ACTUALES
Usar el mismo proyecto de Netlify y las mismas variables de entorno.
No crear otro proyecto, no cambiar los nombres internos de almacenamiento,
no borrar datos de Blobs y no generar un acceso nuevo si el actual funciona.
La instalación conserva el catálogo, las fotos y la configuración guardados
en ese proyecto. Las prendas iniciales solo se usan si no hay un catálogo
guardado. El ZIP no contiene una copia de las fotos cargadas en la web.
No subir node_modules, CONFIGURACION_PRIVADA.env ni claves de Mercado Pago.

ANTES DE PASARLE EL ENLACE A ELI
Entrar a https://elicdu.netlify.app/admin con el acceso actual.
En Mi marca, dejar Habilitar pedidos DESACTIVADO durante la presentación.
Guardar AZUL bendito como nombre y revisar los contactos.
Probar abrir una prenda, elegir talle, sumar al carrito y cambiar cantidades.
El carrito no cobra: la integración real de Mercado Pago se hará después.
La herramienta anterior Probar pagos se conserva para uso privado del dueño;
no es un pago real habilitado para las compradoras ni hace falta usarla ahora.
Compartir la dirección de la tienda, no la pantalla de configuración de Netlify.
Entregar el acceso al panel a Eli por un medio privado para que pruebe cargar
productos. El panel actual utiliza un único acceso; no incluye cuentas separadas.

FORMULARIO DE CONTACTO EN NETLIFY
Antes del despliegue: Forms → Enable form detection.
Tras el despliegue debe aparecer contacto-azul-bendito en Forms.
Configurar su notificación por correo y enviar una consulta de prueba para
comprobar la recepción antes de dar el formulario por activo.
Si ya se desplegó antes de activar la detección, realizar un nuevo despliegue.
https://docs.netlify.com/manage/forms/setup/
https://docs.netlify.com/manage/forms/notifications/

SI QUERÉS INSTALAR EN OTRO PROYECTO DESDE CERO
Subir la misma estructura a un repositorio y conectarlo a Netlify.
Build command: npm run build
Publish directory: public
Functions directory: netlify/functions
Node: 22, indicado en netlify.toml.
Abrir CREAR_ACCESO.html y generar CONFIGURACION_PRIVADA.env en privado.
Importar ADMIN_USER, ADMIN_PASSWORD_HASH y SESSION_SECRET en las variables de
entorno de Netlify, disponibles para Functions en Production. Redesplegar.
Otro proyecto tendrá datos nuevos: no comparte automáticamente las fotos,
productos ni configuración del proyecto elicdu.

PENDIENTE PARA EL LANZAMIENTO COMERCIAL
Catálogo, talles, stock y precios propios de Eli; foto real del local y logo
original de buena calidad (el incluido es una reconstrucción provisional).
Revisar contactos, guía de talles, envíos y cambios con la marca.
Conectar la cuenta comercial de Eli a Mercado Pago, validar pagos en servidor,
notificaciones y stock, y realizar las pruebas antes de habilitar ventas.
El cartel 3 cuotas sin interés es una propuesta visual; todavía no configura
esa financiación. Confirmar su disponibilidad y condiciones antes de ofrecerla.
No habilitar pedidos mientras se esté usando esta versión como presentación.

El sitio no fue publicado desde esta entrega. Se aplica al completar la subida
a GitHub y esperar el despliegue correcto de Netlify.

Diseño por CdU Digital.
