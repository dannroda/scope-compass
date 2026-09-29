// Export markdown legible de compass/ (spec §4.4, §6, D13). Port de tools/artifact_to_md.py:
// para los mismos datos produce el mismo texto, salvo la fecha.
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { writeAtomic } from './store/atomic.js';

const ST = { todo: 'Pendiente', doing: 'En curso', review: 'Revisión', done: 'Hecho' };

// Mismo orden que Python: (order ?? 0, code como texto), estable.
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byOrderCode = (a, b) => cmp(a.order ?? 0, b.order ?? 0) || cmp(a.code ?? '', b.code ?? '');

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// milestones / tasks: Map o iterable de [id, doc]. board: URL del artifact si todavía es la fuente de verdad.
export function renderMarkdown({ milestones, tasks }, { title, board, date = today() }) {
  const ts = [...tasks].map(([, t]) => t);
  const L = [`# Tareas — ${title}`, '',
    board
      ? `> Copia local del tablero ${board}. El tablero es la fuente de verdad; este archivo se regenera desde ahí.`
      : '> Export de `compass/`, que es la fuente de verdad. No editar: los cambios se hacen en `compass/` o con `scompass`, y este archivo se regenera.',
    `> Generado: ${date}`, ''];
  const ms = [...milestones].sort(([, a], [, b]) => cmp(a.order ?? 0, b.order ?? 0));
  for (const [mid, m] of ms) {
    const mt = ts.filter((t) => t.milestone === mid).sort(byOrderCode);
    const done = mt.filter((t) => t.status === 'done').length;
    L.push(`## ${m.code} — ${m.title}` + (mt.length ? `  (${done}/${mt.length})` : ''), '', m.goal ?? '', '');
    if (m.done_when?.length) L.push('**Hecho cuando:**', ...m.done_when.map((x) => `- ${x}`), '');
    for (const t of mt) {
      const head = [t.code ?? '', t.title].filter(Boolean).join(' ');
      L.push(`### ${head} · ${ST[t.status ?? 'todo'] ?? t.status}`, '');
      const cl = t.checklist ?? [];
      L.push(...cl.map((c) => `- [${c.done ? 'x' : ' '}] ${c.text}`));
      if (cl.length) L.push('');
      if (t.test) L.push(`**Prueba:** ${t.test}`, '');
      if (t.notes) L.push(`**Notas:** ${t.notes}`, '');
      if (t.refs?.length) L.push('**Referencias:** ' + t.refs.map((r) => `\`${r.doc}#${r.section}\``).join(', '), '');
    }
  }
  return L.join('\n').replace(/\s+$/, '') + '\n';
}

// Escribe el export de un proyecto. out: ruta absoluta o relativa al proyecto (por defecto config.export_md).
export async function exportMarkdown(projectDir, { config, milestones, tasks }, { out, date } = {}) {
  const path = resolve(projectDir, out ?? config?.export_md ?? 'docs/tareas.md');
  const text = renderMarkdown({ milestones, tasks }, { title: config?.project ?? 'Proyecto', board: config?.board_url, date });
  await mkdir(dirname(path), { recursive: true });
  await writeAtomic(path, text);
  return path;
}
