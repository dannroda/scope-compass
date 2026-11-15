// Fechas límite (spec §16.5, D26): `due` en tareas e ítems de lista, YYYY-MM-DD o YYYY-MM-DDTHH:MM en hora local.
import { T } from './i18n.js';

const DUE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/;

// La fecha como Date local, o null si el formato no es válido o la fecha no existe (2026-02-30).
export function parseDue(s) {
  const m = typeof s === 'string' && DUE.exec(s);
  if (!m) return null;
  const [y, mo, d, h = 0, mi = 0] = m.slice(1).map((x) => (x === undefined ? undefined : Number(x)));
  const date = new Date(y, mo - 1, d, h, mi);
  const ok = date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d && h < 24 && mi < 60;
  return ok ? date : null;
}

export const isValidDue = (s) => parseDue(s) !== null;

const dayKey = (d) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();

/**
 * 'overdue' (ya pasó), 'today' (vence hoy, más tarde) o 'later'. Sin hora, vence al terminar el día.
 * null si no hay fecha o no es válida.
 */
export function dueState(due, now = new Date()) {
  const d = parseDue(due);
  if (!d) return null;
  const hasTime = due.includes('T');
  if (hasTime ? d < now : dayKey(d) < dayKey(now)) return 'overdue';
  return dayKey(d) === dayKey(now) ? 'today' : 'later';
}

export const showDue = (due) => due.replace('T', ' ');

/**
 * Estado de la fecha objetivo de un hito (18.2): 'done' si tiene tareas y están todas hechas; si no, el de dueState
 * ('overdue' = atrasado). null sin fecha. tasks: las tareas del proyecto (planas, con milestone y status).
 */
export function milestoneDueState(m, tasks, now = new Date()) {
  if (!m.due) return null;
  const mine = tasks.filter((t) => t.milestone === m.id);
  return mine.length && mine.every((t) => t.status === 'done') ? 'done' : dueState(m.due, now);
}

// El día local (YYYY-MM-DD) de un instante ISO, como done_at (18.1): la hora UTC puede ser de otro día.
export const localDay = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
/** "2026-10-11 14:05" en hora local, de cualquier fecha ISO (UTC o con zona). */
export const localStamp = (iso) => { const d = new Date(iso); return `${localDay(iso)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };

// Con getters: el texto sale en el idioma de quien lo pide (§45), no en el de cuando se cargó el módulo.
export const EVERY = { get day() { return T('cada día'); }, get week() { return T('cada semana'); }, get month() { return T('cada mes'); }, get year() { return T('cada año'); } };
const EVERY_N = { day: (n) => T`cada ${n} días`, week: (n) => T`cada ${n} semanas`, month: (n) => T`cada ${n} meses`, year: (n) => T`cada ${n} años` };
/** "cada mes", "cada 2 días": el texto de un repeat { every, interval? } (31.6). */
export const repeatLabel = (r) => ((r.interval ?? 1) > 1 ? EVERY_N[r.every](r.interval) : EVERY[r.every]);

const pad = (n) => String(n).padStart(2, '0');
const daysIn = (y, m) => new Date(y, m + 1, 0).getDate(); // m desde 0

/**
 * La próxima fecha de algo que se repite, a partir de su fecha límite (no de cuando se hizo): la luz vence el 10
 * aunque se pague el 12. Un mes o un año que no tiene ese día usa el último (31/01 → 28/02, 29/02 → 28/02).
 * Mantiene la hora si la tiene. Ese día queda fijo desde ahí (28/02 → 28/03): el schema no guarda el día original.
 * interval (31.6): cuántos períodos avanza (cada 2 días, cada 3 meses); sin él, 1.
 */
export function nextDue(due, every, interval = 1) {
  const d = parseDue(due);
  if (!d || !EVERY[every] || !Number.isInteger(interval) || interval < 1) throw new Error(T`no se puede repetir ${due} ${every} ${interval}`);
  let y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
  if (every === 'day' || every === 'week') {
    const n = new Date(y, m, day + interval * (every === 'day' ? 1 : 7));
    [y, m, day] = [n.getFullYear(), n.getMonth(), n.getDate()];
  } else {
    if (every === 'month') { m += interval; y += Math.floor(m / 12); m %= 12; } else y += interval;
    day = Math.min(day, daysIn(y, m));
  }
  return `${y}-${pad(m + 1)}-${pad(day)}${due.includes('T') ? due.slice(10) : ''}`;
}
