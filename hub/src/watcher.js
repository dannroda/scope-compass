// Watcher de compass/ (spec §5.4): cambios hechos fuera del hub (edición a mano, git pull, la CLI sin hub).
// Mantiene el etag conocido de cada documento y solo emite cuando cambia; las escrituras del hub lo
// avisan con note() para no emitir dos veces. Los eventos tienen la forma del protocolo WebSocket (§5.5).
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDoc } from './schema.js';
import { COLLECTIONS } from './store/load.js';
import { etagOf } from './store/json-files.js';
import { flat } from './views.js';
import { watchTree } from './watch-tree.js';

const DOC = /^(milestones|tasks|lists)\/([a-z0-9][a-z0-9_-]{0,63})\.json$/;
const INVALID = Symbol('invalid');

export function createWatcher(compassDir, { validators, emit, debounceMs = 50 }) {
  const known = new Map(); // "tasks/m0-01" → etag | INVALID
  const timers = new Map();
  let fsw = null;
  let closed = false;

  async function check(collection, id) {
    const key = `${collection}/${id}`;
    const path = join(compassDir, collection, `${id}.json`);
    let text;
    try {
      text = await readFile(path, 'utf8');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      if (known.has(key)) {
        known.delete(key);
        emit({ type: 'delete', collection, id });
      }
      return;
    }
    const res = parseDoc(text, COLLECTIONS[collection], validators);
    if (!res.ok) {
      if (known.get(key) !== INVALID) {
        known.set(key, INVALID);
        emit({ type: 'warning', code: res.code, path: `compass/${key}.json`, message: res.message });
      }
      return;
    }
    const etag = etagOf(res.doc);
    if (known.get(key) === etag) return;
    known.set(key, etag);
    emit({ type: 'upsert', collection, id, doc: flat(id, res.doc, etag) });
  }

  // Todos los documentos en disco contra lo conocido: altas, cambios y bajas.
  async function rescan() {
    const seen = new Set();
    for (const collection of Object.keys(COLLECTIONS)) {
      const names = await readdir(join(compassDir, collection)).catch(() => []);
      for (const name of names) {
        const m = DOC.exec(`${collection}/${name}`);
        if (!m) continue;
        seen.add(`${collection}/${m[2]}`);
        await check(collection, m[2]);
      }
    }
    for (const key of [...known.keys()]) {
      if (!seen.has(key)) {
        const [collection, id] = key.split('/');
        await check(collection, id);
      }
    }
  }

  const run = (fn) => fn().catch((e) => emit({ type: 'warning', code: 'io_error', path: 'compass/', message: e.message }));

  function schedule(key, fn) {
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => { timers.delete(key); if (!closed) run(fn); }, debounceMs));
  }

  return {
    // Carga el estado inicial sin emitir y empieza a mirar.
    async start() {
      const quiet = emit;
      emit = () => {};
      try { await rescan(); } finally { emit = quiet; }
      fsw = watchTree(compassDir, (filename) => {
        const m = filename && DOC.exec(filename);
        if (m) schedule(`${m[1]}/${m[2]}`, () => check(m[1], m[2]));
        // Sin nombre, o una carpeta de colección que apareció o se fue (git checkout): se mira todo.
        else if (!filename || filename in COLLECTIONS) schedule('*', rescan);
      }, { onError: (e) => emit({ type: 'warning', code: 'io_error', path: 'compass/', message: `watcher: ${e.message}` }) });
      await fsw.ready;
    },

    // El hub escribió (etag) o borró (null) este documento: el evento de disco que sigue no se reemite.
    note(collection, id, etag) {
      if (etag === null) known.delete(`${collection}/${id}`);
      else known.set(`${collection}/${id}`, etag);
    },

    rescan: () => run(rescan),

    close() {
      closed = true;
      for (const t of timers.values()) clearTimeout(t);
      fsw?.close();
    }
  };
}
