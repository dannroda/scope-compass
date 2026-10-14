// Reglas de las listas (spec §16.4, D25) compartidas por la CLI y la API: id legible a partir del título.

// "Libros para leer" → "libros-para-leer"; sin letras ni números, fallback ("lista"). Cabe en el id de un archivo (json-files).
export function slugify(title, fallback = 'lista') {
  const s = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  return s || fallback;
}

// El primer id libre: compras, compras-2, compras-3…
export function freeId(base, taken) {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

// Las fechas límite viven en dates.js (también las usan las tareas).
export { isValidDue } from './dates.js';
import { nextDue } from './dates.js';

/**
 * Tildar (o destildar) un ítem. Uno que se repite no queda tildado: su fecha avanza un período (D26).
 * Devuelve { item, advanced }; destildar uno que se repite es un error (no hay a qué fecha volver con certeza).
 */
export function checkItem(item, { undo = false } = {}) {
  if (!item.repeat) return { item: { ...item, done: !undo }, advanced: false };
  if (undo) throw Object.assign(new Error('un ítem que se repite no se destilda: cambiale la fecha con `item set --due`'), { code: 'invalid_argument' });
  return { item: { ...item, done: false, due: nextDue(item.due, item.repeat.every) }, advanced: true };
}
