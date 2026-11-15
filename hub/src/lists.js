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
import { EVERY, isValidDue, nextDue } from './dates.js';
import { StoreError } from './store/json-files.js';

const bad = (msg) => new StoreError('invalid_argument', msg);

/**
 * El repeat de --repeat y --interval (31.6): null sin every; interval 1 no se escribe, así los archivos de antes no
 * cambian. interval puede venir como texto (CLI) o número (API).
 */
export function repeatOf(every, interval) {
  const given = interval !== undefined && interval !== null && interval !== '';
  if (!every) { if (given) throw bad('--interval va con --repeat'); return null; }
  if (!EVERY[every]) throw bad(`repetición inválida: ${every} (day, week, month, year)`);
  const n = given ? Number(interval) : 1;
  if (!Number.isInteger(n) || n < 1) throw bad(`intervalo inválido: ${interval} (un entero desde 1)`);
  return n > 1 ? { every, interval: n } : { every };
}

/** Un ítem nuevo con la regla de `item add`; la usan la CLI y la captura rápida del Inicio (31.2). */
export function newItem({ text, due, repeat }, createdAt) {
  if (typeof text !== 'string' || !text.trim()) throw bad('falta el texto');
  if (due && !isValidDue(due)) throw bad(`fecha inválida: ${due} (YYYY-MM-DD o YYYY-MM-DDTHH:MM)`);
  if (repeat && !due) throw bad('un ítem que se repite necesita fecha límite (--due)');
  return { text, done: false, created_at: createdAt, ...(due ? { due } : {}), ...(repeat ? { repeat } : {}) };
}

/**
 * Tildar (o destildar) un ítem. Uno que se repite no queda tildado: su fecha avanza un período (D26).
 * Devuelve { item, advanced }; destildar uno que se repite es un error (no hay a qué fecha volver con certeza).
 */
export function checkItem(item, { undo = false } = {}) {
  if (!item.repeat) return { item: { ...item, done: !undo }, advanced: false };
  if (undo) throw Object.assign(new Error('un ítem que se repite no se destilda: cambiale la fecha con `item set --due`'), { code: 'invalid_argument' });
  return { item: { ...item, done: false, due: nextDue(item.due, item.repeat.every, item.repeat.interval) }, advanced: true };
}
