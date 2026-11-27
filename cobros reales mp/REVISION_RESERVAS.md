# Corrección de reservas y enlaces vencidos

## Comportamiento

Mercado Pago informó `canceled` con detalle `expired` en las dos compras revisadas. La tienda lo mostraba como una cancelación genérica. Se corrige la clasificación y también la presentación de registros históricos, sin migrarlos ni modificar sus cantidades.

Cuando llega una notificación auténtica con un estado terminal sin dinero acreditado, la reserva se libera de forma idempotente. Se vuelve a comprobar el estado dentro de la transacción de inventario para conservar una reserva si hay un pago concurrente o revisión pendiente. El proceso programado conserva la recuperación de estados vencidos que aún retengan existencias.

La compradora puede recuperar el comprobante guardado en su pestaña. Si vuelve a la tienda, ve “Retomar mi compra”; su propia última unidad muestra “Reservado para vos”. El carrito reconoce esa reserva y retoma el pedido existente en lugar de crear otro. Un nuevo intento solo se habilita tras confirmar que la reserva anterior se liberó y el servidor vuelve a validar disponibilidad.

Visitar un comprobante antiguo no borra el identificador de una compra posterior. Un fallo en la consulta de estado conserva el acceso al comprobante. Los enlaces guardados se validan como comprobantes internos con identificador y prueba de acceso válidos.

## Verificación

- `npm run build` y `npm test`: 63 pruebas aprobadas, 11 nuevas regresiones.
- Compras simuladas con una única unidad: retomar el mismo pedido, vencerlo y volver a comprar con un identificador nuevo.
- Dos compradoras compitiendo por la última unidad; notificaciones repetidas; pagos tardíos; firmas inválidas; precios verificados en servidor y controles de cuenta, importe y moneda.
- Navegador: agregar talle, completar datos ficticios, reservar, volver a la tienda, retomar el comprobante, simular vencimiento y crear un segundo pedido después de liberar la unidad.
- Las pruebas no contactan Mercado Pago ni modifican pedidos, precios o stock de producción.

## Límites de la comprobación

El vencimiento de las dos compras está confirmado. No se conserva el recorrido completo de la compradora, por lo que no se afirma que su aviso de falta de stock tuviera necesariamente esta causa.

La recuperación utiliza el comprobante privado guardado en `sessionStorage`: funciona en la misma pestaña mientras conserve esos datos. Otra pestaña, navegador o dispositivo no obtiene acceso a esa reserva por conocer la prenda o el correo de la compradora.

La candidata queda en una rama separada para revisión antes de actualizar la tienda real.
