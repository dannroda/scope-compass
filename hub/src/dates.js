// Fechas límite (spec §16.5, D26): `due` en tareas e ítems de lista, YYYY-MM-DD o YYYY-MM-DDTHH:MM en hora local.

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
