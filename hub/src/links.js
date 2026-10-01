// Vínculos entre tareas (spec §4.2): cada tarea guarda `links: [{ type, task }]` con type "blocks" (esta tarea
// bloquea a `task`) o "related". El sentido inverso ("bloqueada por") no se guarda: se calcula acá.
// La UI web (web/app.js) y el dock (board.gd) repiten esta lógica.
export const LINK_TYPES = ['blocks', 'related'];

export const linksOf = (t) => (Array.isArray(t?.links) ? t.links : []);

/** Vínculos de una tarea vistos desde ella: { blocks, blockedBy, related } con ids. tasks: [{ id, links }]. */
export function linkView(tasks, id) {
  const me = tasks.find((t) => t.id === id);
  const out = { blocks: [], blockedBy: [], related: [] };
  const add = (list, x) => { if (x !== id && !list.includes(x)) list.push(x); };
  for (const l of linksOf(me)) add(l.type === 'blocks' ? out.blocks : out.related, l.task);
  for (const t of tasks) {
    for (const l of linksOf(t)) {
      if (l.task === id) add(l.type === 'blocks' ? out.blockedBy : out.related, t.id);
    }
  }
  return out;
}

/** Tareas sin terminar que bloquean a esta. */
export function openBlockers(tasks, id) {
  return linkView(tasks, id).blockedBy.filter((b) => { const t = tasks.find((x) => x.id === b); return t && t.status !== 'done'; });
}

/** ¿`from` bloquea a `to` cerraría un ciclo? (si desde `to` ya se llega a `from` por "blocks"). */
export function wouldCycle(tasks, from, to) {
  const seen = new Set();
  const stack = [to];
  while (stack.length) {
    const cur = stack.pop();
    if (cur === from) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const l of linksOf(tasks.find((t) => t.id === cur))) if (l.type === 'blocks') stack.push(l.task);
  }
  return false;
}

/** Vínculos que apuntan a tareas que no existen: [{ id, type, task }]. */
export function brokenLinks(tasks) {
  const ids = new Set(tasks.map((t) => t.id));
  return tasks.flatMap((t) => linksOf(t).filter((l) => !ids.has(l.task)).map((l) => ({ id: t.id, type: l.type, task: l.task })));
}
