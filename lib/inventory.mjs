// Product quantities and order movements share one conditional write, so a sale
// can never deduct half a basket or overwrite another simultaneous sale.
export function createInventory(records, migrate, fail) {
  const key = 'inventory/catalog-v2';
  async function snapshot() {
    let current = await records.getWithMetadata(key, {type: 'json'});
    if (!current) {
      await records.setJSON(key, {version: 2, products: await migrate(), orders: {}}, {onlyIfNew: true});
      current = await records.getWithMetadata(key, {type: 'json'});
    }
    if (!current?.etag) throw fail('No pudimos leer el inventario. Volvé a intentar.', 503);
    return current;
  }
  async function change(update) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const {data, etag} = await snapshot();
      const result = update(data);
      if (JSON.stringify(data).length > 4000000) throw fail('El inventario necesita mantenimiento. Contactá a quien administra la tienda.', 503);
      const write = await records.setJSON(key, data, {onlyIfMatch: etag});
      if (write.modified) return result;
    }
    throw fail('El stock está cambiando. Actualizá el panel y volvé a intentar.', 409);
  }
  const revise = p => {p.revision = (p.revision || 0) + 1; p.updated_at = new Date().toISOString();};
  const checkRevision = (p, revision) => {
    if (revision !== (p.revision || 0)) throw fail('El producto cambió desde que lo abriste. Cerrá la edición, actualizá el panel y abrilo de nuevo.', 409);
  };
  const pending = (data, id) => Object.values(data.orders).filter(o => o.deducted && o.items.some(i => i.id === id));
  return {
    snapshot,
    async products() {return (await snapshot()).data.products;},
    async add(product) {return change(data => {data.products.push(product); return product;});},
    async edit(id, product, revision) {
      return change(data => {
        const index = data.products.findIndex(p => p.id === id), old = data.products[index];
        if (!old) throw fail('El producto ya no existe.', 404);
        checkRevision(old, revision);
        for (const order of pending(data, id)) for (const item of order.items.filter(i => i.id === id)) {
          if (!product.variants.some(v => v.size === item.size)) throw fail('Ese talle tiene ventas confirmadas. Conservá el talle con stock 0 para permitir una cancelación.');
        }
        const next = {...product, id, revision: old.revision || 0}; revise(next);
        data.products[index] = next; return next;
      });
    },
    async remove(id, revision) {
      return change(data => {
        const old = data.products.find(p => p.id === id);
        if (!old) throw fail('El producto ya no existe.', 404);
        checkRevision(old, revision);
        if (pending(data, id).length) throw fail('Esta prenda tiene ventas confirmadas. Desactivá “Visible en la tienda” para ocultarla y conservar su control de stock.');
        data.products = data.products.filter(p => p.id !== id);
      });
    },
    async transition(order, status, previousStatus) {
      return change(data => {
        const old = data.orders[order.id] || {status: order.status, deducted: false, legacy: ['En preparación', 'Entregado'].includes(order.status), items: order.items};
        if (old.status === status) return old;
        if (previousStatus !== old.status) throw fail('El pedido cambió. Actualizá el panel antes de guardar.', 409);
        if (old.status === 'Cancelado') throw fail('Un pedido cancelado no se puede reabrir. Creá un pedido nuevo.');
        if (status === 'Nuevo') throw fail('Un pedido confirmado no puede volver a Nuevo. Cancelalo si la venta no se concreta.');
        if (old.status === 'Entregado' && status === 'En preparación') throw fail('Este pedido ya fue entregado.');
        const deduct = ['En preparación', 'Entregado'].includes(status);
        const next = {...old, status};
        if (!old.legacy && deduct !== old.deducted) {
          for (const item of old.items) {
            const product = data.products.find(p => p.id === item.id);
            const variant = product?.variants.find(v => v.size === item.size);
            if (!variant || deduct && (!product.active || product.sample || variant.stock < item.qty)) throw fail(`No hay stock suficiente de ${item.name}, talle ${item.size}.`, 409);
            if (!deduct && variant.stock + item.qty > 10000) throw fail('Revisá el stock de la prenda antes de cancelar.', 409);
          }
          for (const item of old.items) {
            const product = data.products.find(p => p.id === item.id);
            product.variants.find(v => v.size === item.size).stock += deduct ? -item.qty : item.qty;
            revise(product);
          }
          next.deducted = deduct;
        }
        data.orders[order.id] = next;
        return next;
      });
    }
  };
}
