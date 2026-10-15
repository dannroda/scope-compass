// Playtest (D39, D40): cómo salió la prueba vive en la tarea (`playtest: { result?, note? }`) y las sesiones de
// compass/playtests/ solo ordenan. Reglas compartidas por la CLI, la API y el export, y la migración desde el formato
// anterior, que guardaba result y note en cada ítem de la sesión.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDoc } from './schema.js';
import { canonical } from './store/canonical.js';
import { writeAtomic } from './store/atomic.js';
import { StoreError } from './store/json-files.js';

/** Cuántas tareas de la sesión faltan probar y cuántas fallan. tasks: Map o lista de [id, doc] / { id, ...doc }. */
export function sessionState(session, tasks) {
  const byId = new Map([...tasks].map((t) => (Array.isArray(t) ? t : [t.id, t])));
  const results = session.items.map((x) => byId.get(x.task)?.playtest?.result);
  return { left: results.filter((r) => !r).length, fail: results.filter((r) => r === 'fail').length, total: results.length };
}

// El resultado nuevo de la tarea: result y note como vienen (undefined no cambia, null o "" lo quita). Sin nada, null.
export function nextPlaytest(cur = {}, { result, note } = {}) {
  const out = { ...cur };
  for (const [k, v] of Object.entries({ result, note })) {
    if (v === undefined) continue;
    if (v === null || (typeof v === 'string' && !v.trim())) delete out[k];
    else out[k] = k === 'note' ? v.trim() : v;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Pasa las sesiones del formato anterior (result y note en cada ítem) al de ahora. Si una tarea está en varias
 * sesiones, gana el resultado de la más reciente (updated_at) que la probó, y las notas distintas se juntan, de la
 * más vieja a la más nueva. Lo que la tarea ya tenía en playtest se respeta. Las sesiones se reescriben directo en
 * disco (inválidas para el schema nuevo, el store no las pisa); las tareas, con el store (pasa por el hub si corre).
 * Devuelve { sessions, tasks, missing }.
 */
export async function migrateSessions(compassDir, store, validators) {
  const dir = join(compassDir, 'playtests');
  const names = (await readdir(dir).catch(() => [])).filter((n) => n.endsWith('.json') && !n.startsWith('.')).sort();
  const legacy = [];
  for (const name of names) {
    let doc;
    try { doc = JSON.parse(await readFile(join(dir, name), 'utf8')); } catch { continue; }
    if (Array.isArray(doc?.items) && doc.items.some((x) => x && ('result' in x || 'note' in x))) legacy.push({ id: name.slice(0, -5), doc });
  }
  legacy.sort((a, b) => String(a.doc.updated_at ?? '').localeCompare(String(b.doc.updated_at ?? '')));
  const found = new Map(); // tarea → { result, notes: [] }
  for (const { doc } of legacy) {
    for (const x of doc.items) {
      if (!x?.task) continue;
      const f = found.get(x.task) ?? { notes: [] };
      if (x.result === 'pass' || x.result === 'fail') f.result = x.result;
      if (typeof x.note === 'string' && x.note.trim() && !f.notes.includes(x.note.trim())) f.notes.push(x.note.trim());
      found.set(x.task, f);
    }
  }
  const tasks = [], missing = [];
  for (const [id, f] of found) {
    const cur = await store.get('tasks', id).catch((e) => (e.code === 'not_found' ? null : Promise.reject(e)));
    if (!cur) { missing.push(id); continue; }
    const had = cur.doc.playtest ?? {};
    const notes = [...(had.note ? [had.note] : []), ...f.notes.filter((n) => n !== had.note)];
    const playtest = nextPlaytest({}, { result: had.result ?? f.result, note: notes.join('\n') });
    if (!playtest || JSON.stringify(playtest) === JSON.stringify(cur.doc.playtest)) continue;
    await store.patch('tasks', id, { playtest }, { ifMatch: cur.etag });
    tasks.push({ id, playtest });
  }
  for (const { id, doc } of legacy) {
    const clean = { ...doc, items: doc.items.filter((x) => x?.task).map((x) => ({ task: x.task })) };
    const res = parseDoc(JSON.stringify(clean), 'playtest', validators);
    if (!res.ok) throw new StoreError('invalid_file', `compass/playtests/${id}.json: ${res.message}`);
    await writeAtomic(join(dir, `${id}.json`), canonical(res.doc));
  }
  return { sessions: legacy.map((s) => s.id), tasks, missing };
}
