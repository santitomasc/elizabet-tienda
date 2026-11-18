export function sameVariant(variant, item) {
  return variant.size === item.size && (variant.color || '') === (item.color || '');
}

export function validVariantColor(color) {
  return color === undefined || typeof color === 'string' && color.length <= 60 && color.trim() === color;
}
