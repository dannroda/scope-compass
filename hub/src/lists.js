// Reglas de las listas (spec §16.4, D25) compartidas por la CLI y la API: id legible a partir del título.

// "Libros para leer" → "libros-para-leer"; sin letras ni números, "lista". Cabe en el id de un archivo (json-files).
export function slugify(title) {
  const s = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  return s || 'lista';
}

// El primer id libre: compras, compras-2, compras-3…
export function freeId(base, taken) {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

// Las fechas límite viven en dates.js (también las usan las tareas).
export { isValidDue } from './dates.js';
