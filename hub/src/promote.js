// Promover una decisión de una tarea a una entrada D-n del documento de decisiones (§31, D42). Es lo primero que la
// app escribe en un documento: agrega al final, relee justo antes y nunca commitea. Con hub lo hace el hub
// (POST /api/tasks/:id/decisions/:n/promote); sin hub, la CLI.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { docFiles } from './docs.js';
import { localDay } from './dates.js';
import { decisionState } from './decisions.js';
import { writeAtomic } from './store/atomic.js';
import { StoreError } from './store/json-files.js';
import { processLang, T, withLang } from './i18n.js';

// El alias del documento: config.json › decisions_doc, o "decisiones" si está declarado.
export const decisionsDocAlias = (config) => config?.decisions_doc ?? 'decisiones';

// "## D43 · Título" con la fecha, la tarea de origen y lo que se sabe de la decisión, en el formato de decisiones.md.
export function decisionEntry(number, d, { id, code, day }) {
  const title = (d.asked ? d.reply : d.text).replace(/\s*\n\s*/g, ' ');
  const item = (label, s) => (s ? [`- **${label}:** ${s.replace(/\n/g, '\n  ')}`] : []);
  const items = [...(d.asked ? item(T('Pregunta'), d.text) : []), ...item(T('Por qué'), d.why), ...item(T('Descartado'), d.alternatives)];
  return [`## D${number} · ${title}`, T`**${day} · vigente** · tarea ${code ? `${code} (${id})` : id}`, ...(items.length ? ['', ...items] : [])].join('\n');
}

export async function promoteDecision(projectDir, store, id, n, { now = () => new Date().toISOString() } = {}) {
  const cur = await store.get('tasks', id);
  const list = cur.doc.decisions ?? [];
  if (!Number.isInteger(n) || n < 1 || n > list.length) throw new StoreError('invalid_argument', T`decisión inexistente: ${n} (la tarea tiene ${list.length})`);
  const d = list[n - 1];
  if (d.promoted) throw new StoreError('conflict', T`la decisión ${n} ya está en ${d.promoted}`);
  if (decisionState(d) !== 'resolved' || d.review === 'reverted') {
    throw new StoreError('invalid_argument', T`la decisión ${n} no está resuelta: se promueve una revisada con ok o una pregunta respondida`);
  }
  const { config } = await store.loadAll();
  const alias = decisionsDocAlias(config);
  const doc = (await docFiles(projectDir, config)).find((x) => x.alias === alias);
  if (!doc) throw new StoreError('not_found', T`no hay un documento "${alias}": declaralo con scompass doc add ${alias} <ruta>, o poné otro alias en config.json › decisions_doc`);
  const file = join(projectDir, doc.path);
  const text = await readFile(file, 'utf8').catch(() => { throw new StoreError('not_found', T`no existe ${doc.path}`); });
  const number = Math.max(0, ...[...text.matchAll(/^## D(\d+)\b/gm)].map((m) => Number(m[1]))) + 1;
  // En el idioma del tablero, como el export (§45), no en el del pedido.
  const lang = ['es', 'en'].includes(config?.language) ? config.language : processLang();
  const entry = withLang(lang, () => decisionEntry(number, d, { id, code: cur.doc.code, day: localDay(now()) }));
  await writeAtomic(file, text.replace(/\s*$/, '') + '\n\n' + entry + '\n');
  const promoted = `D${number}`;
  try {
    const r = await store.patch('tasks', id, { decisions: list.map((x, i) => (i === n - 1 ? { ...x, promoted } : x)) }, { ifMatch: cur.etag });
    return { task: r, promoted, doc: { alias, path: doc.path } };
  } catch (e) {
    if (e instanceof StoreError) e.message = T`${promoted} quedó agregada en ${doc.path}, pero la tarea no se pudo marcar: ${e.message}`;
    throw e;
  }
}
