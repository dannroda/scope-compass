// Filtros de tareas (spec §19, D32): los usa `scompass list`. La UI web (web/app.js, taskMatches) repite estas
// reglas; si cambian acá, cambian allá.
import { dueState, parseDue } from './dates.js';
import { openBlockers } from './links.js';

export const DUE_FILTERS = ['overdue', 'today', 'week', 'none'];
export const PRIORITIES = ['high', 'medium', 'low'];
export const PRIORITY_LABEL = { high: 'alta', medium: 'media', low: 'baja' };
// Estimación (18.3): chica, mediana o grande.
export const SIZES = ['s', 'm', 'l'];

// Sin mayúsculas ni tildes: "Diseño" encuentra "diseno".
export const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * ¿La fecha cae en el filtro? overdue, today y week no cuentan las tareas hechas. week: las vencidas y las que vencen
 * antes de la medianoche de dentro de 7 días (el grupo "Esta semana" de las listas en la web).
 */
export function dueMatches(t, which, now = new Date()) {
  if (which === 'none') return !t.due;
  if (!t.due || t.status === 'done') return false;
  const s = dueState(t.due, now);
  if (which === 'overdue') return s === 'overdue';
  if (which === 'today') return s === 'today';
  if (which === 'week') return s === 'overdue' || s === 'today' || parseDue(t.due) < new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
  return true;
}

/** Tarea bloqueada: sin terminar y con alguna tarea sin terminar que la bloquea. all: todas las tareas, con id. */
export const isBlocked = (all, t) => t.status !== 'done' && openBlockers(all, t.id).length > 0;

/**
 * Las tareas que pasan el filtro f (todas las condiciones a la vez; un campo vacío no filtra):
 * { q, status: [], due, blocked: true | false, pendingSteps, withRefs, tags: [], priority: [], size: [], assignee: [] }.
 * En priority, size y assignee, "none" es "sin el campo". Las etiquetas pasan si la tarea tiene alguna.
 */
export function filterTasks(tasks, f = {}, { all = tasks, now = new Date() } = {}) {
  const words = norm(f.q).split(/\s+/).filter(Boolean);
  const has = (list) => Array.isArray(list) && list.length > 0;
  const assignees = has(f.assignee) ? f.assignee.map(norm) : null;
  return tasks.filter((t) => {
    if (words.length) {
      const text = norm(`${t.code ?? ''} ${t.title ?? ''} ${t.id ?? ''}`);
      if (!words.every((w) => text.includes(w))) return false;
    }
    if (has(f.status) && !f.status.includes(t.status)) return false;
    if (f.due && !dueMatches(t, f.due, now)) return false;
    if (f.blocked !== undefined && f.blocked !== null && isBlocked(all, t) !== f.blocked) return false;
    if (f.pendingSteps && !(t.checklist ?? []).some((c) => !c.done)) return false;
    if (f.withRefs && !(t.refs ?? []).length) return false;
    if (has(f.tags) && !(t.tags ?? []).some((x) => f.tags.includes(x))) return false;
    if (has(f.priority) && !f.priority.includes(t.priority ?? 'none')) return false;
    if (has(f.size) && !f.size.includes(t.size ?? 'none')) return false;
    if (assignees && !assignees.includes(t.assignee ? norm(t.assignee) : 'none')) return false;
    return true;
  });
}

/** "a, b,,c" → ["a", "b", "c"]: listas separadas por comas en las opciones de la CLI. */
export const splitList = (s) => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
