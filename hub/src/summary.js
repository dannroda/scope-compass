// Resumen de un proyecto para el Inicio (spec §16.2): hito actual, lo que está en curso, lo que sigue y las
// listas; y lo de "Hoy" (vencido, de hoy y en curso). Funciones puras sobre lo que devuelve loadCompass.
import { dueState, milestoneDueState } from './dates.js';
import { listLists, listMilestones, listTasks } from './views.js';

const label = (t) => [t.code, t.title].filter(Boolean).join(' ');

// El hito actual: el primero (por order) que tiene alguna tarea sin terminar; si no hay, el último con tareas.
function currentMilestone(milestones, tasks, now) {
  const ms = listMilestones(milestones);
  const of = (m) => tasks.filter((t) => t.milestone === m.id);
  const m = ms.find((x) => of(x).some((t) => t.status !== 'done')) ?? ms.filter((x) => of(x).length).at(-1);
  if (!m) return null;
  const ts = of(m);
  return { id: m.id, code: m.code, title: m.title, done: ts.filter((t) => t.status === 'done').length, total: ts.length,
    ...(m.due && { due: m.due, due_state: milestoneDueState(m, tasks, now) }) };
}

/** { milestone, counts, doing, next, lists, done_week } para la tarjeta del proyecto. done_week: terminadas en los últimos 7 días. */
export function summarize(all, now = new Date()) {
  const tasks = listTasks(all);
  const milestone = currentMilestone(all.milestones, tasks, now);
  const counts = Object.fromEntries(['todo', 'doing', 'review', 'done'].map((s) => [s, tasks.filter((t) => t.status === s).length]));
  const brief = (t) => ({ id: t.id, code: t.code ?? '', title: t.title, label: label(t), ...(t.due && { due: t.due, due_state: dueState(t.due, now) }) });
  const doing = tasks.filter((t) => t.status === 'doing').map(brief);
  const next = milestone ? tasks.filter((t) => t.milestone === milestone.id && t.status === 'todo').slice(0, 3).map(brief) : [];
  const lists = listLists(all.lists ?? []).map((l) => {
    const open = l.items.filter((x) => !x.done);
    const st = open.map((x) => dueState(x.due, now));
    return { id: l.id, title: l.title, left: open.length, total: l.items.length, today: st.filter((s) => s === 'today').length, overdue: st.filter((s) => s === 'overdue').length };
  });
  const week = now.getTime() - 7 * 864e5;
  const done_week = tasks.filter((t) => t.status === 'done' && t.done_at && Date.parse(t.done_at) >= week).length;
  return { milestone, counts, doing, next, lists, done_week };
}

/**
 * Lo de hoy en un proyecto: ítems de lista y tareas vencidos o que vencen hoy (sin terminar), y tareas en curso.
 * Cada entrada dice cómo actuar sobre ella: { kind: 'item', list, n, etag } o { kind: 'task', id, etag }.
 */
export function todayOf(all, now = new Date()) {
  const out = [];
  for (const l of listLists(all.lists ?? [])) {
    l.items.forEach((x, i) => {
      const s = x.done ? null : dueState(x.due, now);
      if (s === 'overdue' || s === 'today') {
        out.push({ kind: 'item', list: l.id, list_title: l.title, n: i + 1, etag: l.etag, text: x.text, due: x.due, due_state: s, ...(x.repeat && { repeat: x.repeat }) });
      }
    });
  }
  for (const t of listTasks(all)) {
    if (t.status === 'done') continue;
    const s = dueState(t.due, now);
    if (t.status === 'doing' || s === 'overdue' || s === 'today') {
      out.push({ kind: 'task', id: t.id, etag: t.etag, text: label(t), status: t.status, milestone: t.milestone, ...(t.due && { due: t.due, due_state: s }) });
    }
  }
  // Vencido primero, después hoy, después lo que solo está en curso; dentro de cada grupo, por fecha.
  const rank = { overdue: 0, today: 1 };
  return out.sort((a, b) => (rank[a.due_state] ?? 2) - (rank[b.due_state] ?? 2) || String(a.due ?? '~').localeCompare(String(b.due ?? '~')));
}
