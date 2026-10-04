// Reglas de las listas (spec §16.4, D25) compartidas por la CLI y la API: id legible a partir del título y
// fechas límite válidas.

// "Libros para leer" → "libros-para-leer"; sin letras ni números, "lista". Cabe en el id de un archivo (json-files).
export function slugify(title) {
  const s = title.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  return s || 'lista';
}

// El primer id libre: compras, compras-2, compras-3…
export function freeId(base, taken) {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

// Fecha límite: YYYY-MM-DD o YYYY-MM-DDTHH:MM (hora local, sin zona). Además del formato, la fecha tiene que existir.
const DUE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/;
export function isValidDue(s) {
  const m = typeof s === 'string' && DUE.exec(s);
  if (!m) return false;
  const [y, mo, d, h = 0, mi = 0] = m.slice(1).map((x) => (x === undefined ? undefined : Number(x)));
  const date = new Date(y, mo - 1, d, h, mi);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d && h < 24 && mi < 60;
}
