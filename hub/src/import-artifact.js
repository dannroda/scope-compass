// Import del export del artifact (spec §8). Port de tools/artifact_to_tablero.py:
// un JSON por documento en <src>/milestones y <src>/tasks → compass/ en formato canónico.
// Descarta `version` e `id`; `created_at` = el existente, o `updated_at`, o ahora. Conserva `updated_at`.
// Nunca pisa un documento distinto salvo con overwrite, ni uno inválido en disco.
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDoc } from './schema.js';
import { canonical } from './store/canonical.js';
import { writeAtomic } from './store/atomic.js';
import { COLLECTIONS } from './store/load.js';
import { isValidId } from './store/json-files.js';
import { T } from './i18n.js';

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

async function listJson(dir) {
  try {
    return (await readdir(dir)).filter((n) => n.endsWith('.json') && !n.startsWith('.')).sort();
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

// Devuelve por colección las listas de ids created/unchanged/updated/different/invalid, y los avisos.
export async function importArtifact(src, compassDir, { validators, overwrite = false, dryRun = false, now = () => new Date().toISOString() }) {
  const report = { milestones: null, tasks: null, warnings: [] };
  const milestoneIds = new Set();
  for (const collection of ['milestones', 'tasks']) {
    const r = { created: [], unchanged: [], updated: [], different: [], invalid: [] };
    report[collection] = r;
    const kind = COLLECTIONS[collection];
    for (const name of await listJson(join(src, collection))) {
      const id = name.slice(0, -5);
      const bad = (message) => { r.invalid.push(id); report.warnings.push({ path: `${collection}/${name}`, message }); };
      if (!isValidId(id)) { bad(T('id inválido como nombre de archivo')); continue; }
      let doc;
      try { doc = await readJson(join(src, collection, name)); } catch (e) { bad(T`JSON inválido: ${e.message}`); continue; }
      delete doc.version;
      delete doc.id;

      const target = join(compassDir, collection, name);
      const text = await readFile(target, 'utf8').catch((e) => (e.code === 'ENOENT' ? null : Promise.reject(e)));
      let current = null;
      if (text !== null) {
        const res = parseDoc(text, kind, validators);
        if (!res.ok) { bad(T`el destino compass/${collection}/${name} es inválido (${res.code}): no se pisa`); continue; }
        current = res.doc;
      }
      if (kind === 'task') {
        doc.created_at = current?.created_at ?? doc.created_at ?? doc.updated_at ?? now();
        doc.refs ??= [];
      }
      const res = parseDoc(JSON.stringify(doc), kind, validators);
      if (!res.ok) { bad(res.message); continue; }

      if (kind === 'milestone') milestoneIds.add(id);
      const out = canonical(res.doc);
      if (current && canonical(current) === out) { r.unchanged.push(id); continue; }
      if (current && !overwrite) { r.different.push(id); continue; }
      if (!dryRun) {
        await mkdir(join(compassDir, collection), { recursive: true });
        await writeAtomic(target, out);
      }
      (current ? r.updated : r.created).push(id);
    }
  }
  for (const name of await listJson(join(compassDir, 'milestones'))) milestoneIds.add(name.slice(0, -5));
  for (const name of await listJson(join(src, 'tasks'))) {
    const id = name.slice(0, -5);
    if (report.tasks.invalid.includes(id)) continue;
    const { milestone } = await readJson(join(src, 'tasks', name));
    if (!milestoneIds.has(milestone)) report.warnings.push({ path: `tasks/${name}`, message: T`hito inexistente: ${milestone}` });
  }
  return report;
}
