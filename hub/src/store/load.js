// Carga de compass/ desde disco: solo lee. Un archivo inválido se reporta en `warnings`,
// no se carga y queda como está hasta que alguien lo corrija (spec §4.3, §4.5).
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { parseDoc } from '../schema.js';
import { T } from '../i18n.js';

// Ruta relativa al proyecto, siempre con "/" (también en Windows), como en git.
const rel = (compassDir, path) => relative(dirname(compassDir), path).split(sep).join('/');

export const COLLECTIONS = { milestones: 'milestone', tasks: 'task', lists: 'list', playtests: 'playtest' };

export async function loadCollection(compassDir, collection, validators) {
  const dir = join(compassDir, collection);
  const docs = new Map();
  const warnings = [];
  const names = (await readdir(dir).catch((e) => (e.code === 'ENOENT' ? [] : Promise.reject(e))))
    .filter((n) => n.endsWith('.json') && !n.startsWith('.'))
    .sort();
  for (const name of names) {
    const path = join(dir, name);
    const res = parseDoc(await readFile(path, 'utf8'), COLLECTIONS[collection], validators);
    if (res.ok) docs.set(name.slice(0, -5), res.doc);
    else warnings.push({ code: res.code, path: rel(compassDir, path), message: res.message });
  }
  return { docs, warnings };
}

export async function loadCompass(compassDir, validators) {
  const out = { config: null, milestones: new Map(), tasks: new Map(), lists: new Map(), playtests: new Map(), warnings: [] };
  const cfgPath = join(compassDir, 'config.json');
  const cfg = await readFile(cfgPath, 'utf8').catch(() => null);
  if (cfg === null) {
    out.warnings.push({ code: 'missing_config', path: rel(compassDir, cfgPath), message: T('falta config.json') });
  } else {
    const res = parseDoc(cfg, 'config', validators);
    if (res.ok) out.config = res.doc;
    else out.warnings.push({ code: res.code, path: rel(compassDir, cfgPath), message: res.message });
  }
  for (const c of Object.keys(COLLECTIONS)) {
    const { docs, warnings } = await loadCollection(compassDir, c, validators);
    out[c] = docs;
    out.warnings.push(...warnings);
  }
  for (const [id, t] of out.tasks) {
    if (!out.milestones.has(t.milestone)) {
      out.warnings.push({ code: 'unknown_milestone', path: rel(compassDir, join(compassDir, 'tasks', `${id}.json`)), message: T`hito inexistente: ${t.milestone}` });
    }
  }
  return out;
}
