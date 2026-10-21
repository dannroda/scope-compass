// Export markdown legible de compass/ (spec §4.4, §6, D13). Port de tools/artifact_to_md.py:
// para los mismos datos produce el mismo texto, salvo la fecha.
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { projectRel, realInside } from './paths.js';
import { StoreError } from './store/json-files.js';
import { writeAtomic } from './store/atomic.js';
import { linkView } from './links.js';
import { EVERY, localDay, milestoneDueState } from './dates.js';
import { PRIORITY_LABEL } from './filters.js';
import { decisionState, MARK } from './decisions.js';

const ST = { todo: 'Pendiente', paused: 'Pausado', doing: 'En curso', review: 'Revisión', done: 'Hecho' };

// Mismo orden que Python: (order ?? 0, code como texto), estable.
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byOrderCode = (a, b) => cmp(a.order ?? 0, b.order ?? 0) || cmp(a.code ?? '', b.code ?? '');

// Textos que viene a mano o de la API (19.7): un título o un paso con saltos de línea van en un renglón, y un renglón
// de un texto largo que empieza con # no se vuelve un encabezado que rompa la estructura del export.
const line = (s) => String(s ?? '').replace(/\s*\n\s*/g, ' ').trim();
const block = (s) => String(s).split('\n').map((l) => l.replace(/^(\s{0,3})#/, '$1\\#')).join('\n');

// Decisiones (§31): una marca por estado; el porqué, lo descartado y la respuesta van sangrados debajo.
const STATE_NOTE = { open: ' · pregunta abierta', pending: ' · sin revisar', revert: ' · a revertir', resolved: '' };
const indented = (label, s) => block(s).split('\n').map((l, k) => (k ? (l ? `  ${l}` : '') : `  ${label}: ${l}`));
function decisionLines(d) {
  const st = decisionState(d);
  return [`- ${MARK[st]} ${line(d.text)}${STATE_NOTE[st]}${d.review === 'reverted' ? ' · revertida' : ''}${d.promoted ? ` · ${d.promoted}` : ''}`,
    ...(d.why ? indented('Por qué', d.why) : []), ...(d.alternatives ? indented('Descartado', d.alternatives) : []),
    ...(d.reply ? indented(d.asked ? 'Respuesta' : 'Qué hacer', d.reply) : [])];
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// milestones / tasks / lists / playtests: Map o iterable de [id, doc]. board: URL del artifact si todavía es la fuente de verdad.
export function renderMarkdown({ milestones, tasks, lists = [], playtests = [] }, { title, board, date = today() }) {
  const ts = [...tasks].map(([id, t]) => ({ id, ...t }));
  const name = (id) => { const t = ts.find((x) => x.id === id); return t ? [t.code ?? '', line(t.title)].filter(Boolean).join(' ') : `${id} (no existe)`; };
  const L = [`# Tareas — ${title}`, '',
    board
      ? `> Copia local del tablero ${board}. El tablero es la fuente de verdad; este archivo se regenera desde ahí.`
      : '> Export de `compass/`, que es la fuente de verdad. No editar: los cambios se hacen en `compass/` o con `scompass`, y este archivo se regenera.',
    `> Generado: ${date}`, ''];
  const ms = [...milestones].sort(([, a], [, b]) => cmp(a.order ?? 0, b.order ?? 0));
  for (const [mid, m] of ms) {
    const mt = ts.filter((t) => t.milestone === mid).sort(byOrderCode);
    // Las de Revisión cuentan como hechas en el avance, y se dice cuántas son.
    const review = mt.filter((t) => t.status === 'review').length, done = mt.filter((t) => t.status === 'done').length + review;
    L.push(`## ${m.code} — ${line(m.title)}` + (mt.length ? `  (${done}/${mt.length}${review ? `, ${review} en revisión` : ''})` : ''), '', block(m.goal ?? ''), '');
    if (m.due) L.push(`**Fecha objetivo:** ${m.due.replace('T', ' ')}${milestoneDueState({ id: mid, ...m }, ts) === 'overdue' ? ' (atrasado)' : ''}`, '');
    if (m.done_when?.length) L.push('**Hecho cuando:**', ...m.done_when.map((x) => `- ${line(x)}`), '');
    for (const t of mt) {
      const head = [t.code ?? '', line(t.title)].filter(Boolean).join(' ');
      L.push(`### ${head} · ${ST[t.status ?? 'todo'] ?? t.status}`, '');
      if (t.due) L.push(`**Vence:** ${t.due.replace('T', ' ')}`, '');
      // Cuándo se terminó (18.1), prioridad, responsable y etiquetas (D32) en una línea.
      const meta = [t.done_at && `**Terminada:** ${localDay(t.done_at)}`, t.priority && `**Prioridad:** ${PRIORITY_LABEL[t.priority] ?? t.priority}`, t.size && `**Tamaño:** ${t.size.toUpperCase()}`, t.assignee && `**Responsable:** ${t.assignee}`,
        t.tags?.length && '**Etiquetas:** ' + t.tags.map((x) => `\`${x}\``).join(', ')].filter(Boolean);
      if (meta.length) L.push(meta.join(' · '), '');
      if (t.description) L.push(block(t.description), '');
      const cl = t.checklist ?? [];
      // El detalle de un paso va sangrado debajo, como continuación del ítem de la lista.
      L.push(...cl.flatMap((c) => [`- [${c.done ? 'x' : ' '}] ${line(c.text)}`, ...(c.detail ? c.detail.split('\n').map((l) => (l ? `  ${l}` : '')) : [])]));
      if (cl.length) L.push('');
      if (t.decisions?.length) L.push('**Decisiones:**', ...t.decisions.flatMap(decisionLines), '');
      if (t.test) L.push(`**Prueba:** ${block(t.test)}`, '');
      if (t.notes) L.push(`**Notas:** ${block(t.notes)}`, '');
      if (t.refs?.length) L.push('**Referencias:** ' + t.refs.map((r) => `\`${r.section ? `${r.doc}#${r.section}` : r.doc}\``).join(', '), '');
      if (t.files?.length) L.push('**Archivos:** ' + t.files.map((f) => `\`${f}\``).join(', '), '');
      if (t.images?.length) L.push('**Capturas:** ' + t.images.map((f) => `\`${f}\``).join(', '), '');
      const v = linkView(ts, t.id);
      if (v.blocks.length) L.push('**Bloquea a:** ' + v.blocks.map(name).join('; '), '');
      if (v.blockedBy.length) L.push('**Bloqueada por:** ' + v.blockedBy.map(name).join('; '), '');
      if (v.related.length) L.push('**Relacionadas:** ' + v.related.map(name).join('; '), '');
    }
  }
  // Listas (D25), después de los hitos: un proyecto sin listas exporta lo mismo que antes.
  const ls = [...lists].sort(([ia, a], [ib, b]) => cmp(a.order ?? 0, b.order ?? 0) || cmp(ia, ib));
  if (ls.length) L.push('## Listas', '');
  for (const [, l] of ls) {
    const items = l.items ?? [];
    L.push(`### ${line(l.title)}` + (items.length ? `  (${items.filter((x) => x.done).length}/${items.length})` : ''), '');
    L.push(...items.map((x) => `- [${x.done ? 'x' : ' '}] ${line(x.text)}` + (x.due ? ` · vence ${x.due.replace('T', ' ')}` : '') + (x.repeat ? ` · se repite ${EVERY[x.repeat.every]}` : '') + (x.task ? ` · → tarea ${ts.find((t) => t.id === x.task)?.code || x.task}` : '')));
    if (items.length) L.push('');
  }
  // Sesiones de playtest (D39), al final: las tareas en el orden de prueba, con su estado y cómo salieron (eso vive
  // en la tarea, D40: es lo mismo en todas las sesiones que la tienen).
  const ps = [...playtests].sort(([ia, a], [ib, b]) => cmp(a.order ?? 0, b.order ?? 0) || cmp(ia, ib));
  if (ps.length) L.push('## Playtest', '');
  for (const [, p] of ps) {
    const items = (p.items ?? []).map((x) => ({ x, t: ts.find((y) => y.id === x.task) }));
    L.push(`### ${line(p.title)}` + (items.length ? `  (${items.filter(({ t }) => t?.playtest?.result).length}/${items.length} probadas)` : ''), '');
    L.push(...items.map(({ x, t }, i) => {
      const { result, note } = t?.playtest ?? {};
      return `${i + 1}. [${result === 'pass' ? 'x' : ' '}] ${name(x.task)}` + (t ? ` · ${ST[t.status ?? 'todo'] ?? t.status}` : '') +
        (result === 'fail' ? ' · **falla**' : result === 'pass' ? ' · anda' : '') +
        // Una nota de varios renglones sigue sangrada debajo, como continuación del ítem.
        (note ? ' — ' + block(note).split('\n').map((l, k) => (k && l ? '   ' + l : l)).join('\n') : '');
    }));
    if (items.length) L.push('');
  }
  return L.join('\n').replace(/\s+$/, '') + '\n';
}

// Escribe el export de un proyecto. out: ruta absoluta o relativa al proyecto (scompass export --out, la elige quien
// la escribe). Sin out, config.export_md, que tiene que ser un .md dentro del proyecto (19.2): config.json viene con
// el repo, y un export a ~/.bashrc sería escribir donde nadie lo pidió.
export async function exportMarkdown(projectDir, { config, milestones, tasks, lists, playtests }, { out, date } = {}) {
  let path;
  if (out !== undefined) path = resolve(projectDir, out);
  else {
    const rel = projectRel(config?.export_md ?? 'docs/tareas.md');
    if (!rel || !rel.endsWith('.md') || rel.includes('*')) throw new StoreError('invalid_argument', `export_md tiene que ser un .md dentro del proyecto: ${config.export_md}`);
    path = join(projectDir, rel);
  }
  const text = renderMarkdown({ milestones, tasks, lists, playtests }, { title: config?.project ?? 'Proyecto', board: config?.board_url, date });
  await mkdir(dirname(path), { recursive: true });
  if (out === undefined && !(await realInside(projectDir, path))) throw new StoreError('invalid_argument', `export_md sale del proyecto por un enlace simbólico: ${config.export_md}`);
  await writeAtomic(path, text);
  return path;
}
