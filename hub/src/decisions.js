// Decisiones de las tareas (§31, D42). El estado se calcula, no se guarda: lo usan el export, la CLI, el resumen
// del Inicio y el historial.

// open: pregunta sin respuesta; pending: decidida sola, sin revisar; revert: a revertir; resolved: lo demás.
export function decisionState(d) {
  if (d.asked) return d.reply ? 'resolved' : 'open';
  if (!d.review) return 'pending';
  return d.review === 'revert' ? 'revert' : 'resolved';
}

export const DECISION_STATES = ['open', 'pending', 'revert'];
export const MARK = { open: '?', pending: '!', revert: '↺', resolved: '✓' };

// En palabras, con más detalle que el estado: una resuelta dice cómo se resolvió.
export function decisionLabel(d) {
  if (d.asked) return d.reply ? 'respondida' : 'pregunta abierta';
  return { ok: 'ok', revert: 'a revertir', reverted: 'revertida' }[d.review] ?? 'sin revisar';
}

// Cuántas decisiones de la tarea hay en cada estado ({ open, pending, revert, resolved }).
export function decisionCounts(t) {
  const n = { open: 0, pending: 0, revert: 0, resolved: 0 };
  for (const d of t.decisions ?? []) n[decisionState(d)]++;
  return n;
}
