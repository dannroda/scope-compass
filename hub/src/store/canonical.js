// Formato canónico de compass/ (spec §4.4, D2): 2 espacios, claves ordenadas, UTF-8, salto de línea final.
// Produce los mismos bytes que json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True) + '\n' de tools/.

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') return value;
  const out = {};
  for (const k of Object.keys(value).sort()) {
    if (value[k] !== undefined) out[k] = sortKeys(value[k]);
  }
  return out;
}

export function canonical(value) {
  return JSON.stringify(sortKeys(value), null, 2) + '\n';
}
