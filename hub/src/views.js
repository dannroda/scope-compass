// Vistas de lectura compartidas por la CLI (--json) y la API: mismo orden y misma forma plana
// { id, etag, ...campos del documento }.
import { etagOf } from './store/json-files.js';

export const STATUSES = ['todo', 'doing', 'review', 'done'];

export const flat = (id, doc, etag = etagOf(doc)) => ({ id, etag, ...doc });

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) ||
  String(a.code ?? '').localeCompare(String(b.code ?? ''), 'es', { numeric: true }) || a.id.localeCompare(b.id);

export function listLists(lists) {
  return [...lists].map(([id, doc]) => flat(id, doc)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
}

export function listMilestones(milestones) {
  return [...milestones].map(([id, doc]) => flat(id, doc)).sort(byOrder);
}

// Tareas ordenadas por hito (order) y dentro de cada hito por order y code; filtros opcionales.
export function listTasks({ milestones, tasks }, { milestone, status } = {}) {
  const ms = new Map(milestones);
  const mOrder = (id) => ms.get(id)?.order ?? Infinity;
  return [...tasks].map(([id, doc]) => flat(id, doc))
    .filter((t) => !milestone || t.milestone === milestone)
    .filter((t) => !status || t.status === status)
    .sort((a, b) => mOrder(a.milestone) - mOrder(b.milestone) || byOrder(a, b));
}
