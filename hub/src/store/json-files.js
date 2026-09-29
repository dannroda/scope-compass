// Store `json-files` (spec §3, §4, §5.3): un archivo JSON por documento en compass/<colección>/<id>.json.
// Sin caché: cada operación lee el disco, así una edición a mano o un git pull se ven al instante.
// Las operaciones de un mismo store se encolan; entre procesos (hub y CLI) protege el ETag.
//
// Interfaz Store (la misma para el modo hosteado, spec §3): loadAll, list, get, create, put, patch, delete.
// Todo devuelve { id, doc, etag } y falla con StoreError; un archivo inválido nunca se sobrescribe.
import { createHash, randomInt } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { canonical } from './canonical.js';
import { writeAtomic } from './atomic.js';
import { COLLECTIONS, loadCollection, loadCompass } from './load.js';
import { parseDoc } from '../schema.js';

export class StoreError extends Error {
  // code: invalid_argument | not_found | conflict | invalid_file | io_error
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

export const etagOf = (doc) => createHash('sha256').update(canonical(doc)).digest('hex').slice(0, 16);

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const B36 = '0123456789abcdefghijklmnopqrstuvwxyz';
export const randomId = () => Array.from({ length: 8 }, () => B36[randomInt(36)]).join('');

export function createJsonFilesStore(compassDir, { validators, now = () => new Date().toISOString() }) {
  let queue = Promise.resolve();
  const serial = (fn) => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };

  const checkCollection = (collection) => {
    if (!COLLECTIONS[collection]) throw new StoreError('invalid_argument', `colección desconocida: ${collection}`);
  };
  const pathOf = (collection, id) => {
    checkCollection(collection);
    if (typeof id !== 'string' || !ID.test(id)) throw new StoreError('invalid_argument', `id inválido: ${id}`);
    return join(compassDir, collection, `${id}.json`);
  };

  // null si no existe; StoreError invalid_file si existe pero no se puede usar (no se pisa).
  async function readCurrent(collection, id) {
    const path = pathOf(collection, id);
    let text;
    try {
      text = await readFile(path, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw new StoreError('io_error', e.message);
    }
    const res = parseDoc(text, COLLECTIONS[collection], validators);
    if (!res.ok) throw new StoreError('invalid_file', `compass/${collection}/${id}.json: ${res.message}`, { reason: res.code });
    return { id, doc: res.doc, etag: etagOf(res.doc) };
  }

  function checkMatch(current, ifMatch) {
    if (ifMatch !== undefined && ifMatch !== (current ? current.etag : null)) {
      throw new StoreError('conflict', 'el documento cambió desde que se leyó', { current });
    }
  }

  async function write(collection, id, doc, current) {
    if (collection === 'tasks') {
      doc = { ...doc, updated_at: now() };
      doc.created_at = current?.doc.created_at ?? doc.created_at ?? doc.updated_at;
    }
    const res = parseDoc(JSON.stringify(doc), COLLECTIONS[collection], validators);
    if (!res.ok) throw new StoreError('invalid_argument', res.message, { details: res.details });
    try {
      await writeAtomic(pathOf(collection, id), canonical(res.doc));
    } catch (e) {
      throw new StoreError('io_error', e.message);
    }
    return { id, doc: res.doc, etag: etagOf(res.doc) };
  }

  return {
    // Todo compass/ con avisos por archivo inválido: para el arranque del hub y `scompass list`.
    loadAll: () => serial(() => loadCompass(compassDir, validators)),

    list: (collection) => serial(async () => {
      checkCollection(collection);
      const { docs, warnings } = await loadCollection(compassDir, collection, validators);
      return { items: [...docs].map(([id, doc]) => ({ id, doc, etag: etagOf(doc) })), warnings };
    }),

    get: (collection, id) => serial(async () => {
      const cur = await readCurrent(collection, id);
      if (!cur) throw new StoreError('not_found', `no existe ${collection}/${id}`);
      return cur;
    }),

    // Crea con id nuevo (tareas) o con el id dado; falla si ya existe.
    create: (collection, doc, id) => serial(async () => {
      if (id === undefined) {
        do id = randomId(); while (await readCurrent(collection, id).catch(() => true));
      } else if (await readCurrent(collection, id).catch(() => true)) {
        throw new StoreError('conflict', `ya existe ${collection}/${id}`);
      }
      return write(collection, id, doc, null);
    }),

    // Crea o reemplaza el documento entero. ifMatch: etag esperado (null = no debe existir).
    put: (collection, id, doc, { ifMatch } = {}) => serial(async () => {
      const cur = await readCurrent(collection, id);
      checkMatch(cur, ifMatch);
      return write(collection, id, doc, cur);
    }),

    // Merge de primer nivel: los arrays se reemplazan enteros y null borra el campo.
    patch: (collection, id, patch, { ifMatch } = {}) => serial(async () => {
      const cur = await readCurrent(collection, id);
      if (!cur) throw new StoreError('not_found', `no existe ${collection}/${id}`);
      checkMatch(cur, ifMatch);
      const next = { ...cur.doc };
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) delete next[k];
        else next[k] = v;
      }
      return write(collection, id, next, cur);
    }),

    delete: (collection, id, { ifMatch } = {}) => serial(async () => {
      const cur = await readCurrent(collection, id);
      if (!cur) throw new StoreError('not_found', `no existe ${collection}/${id}`);
      checkMatch(cur, ifMatch);
      if (collection === 'milestones') {
        const { docs } = await loadCollection(compassDir, 'tasks', validators);
        const used = [...docs].filter(([, t]) => t.milestone === id).map(([tid]) => tid);
        if (used.length) throw new StoreError('conflict', `el hito ${id} tiene ${used.length} tareas`, { tasks: used });
      }
      try {
        await rm(pathOf(collection, id));
      } catch (e) {
        throw new StoreError('io_error', e.message);
      }
      return { id };
    })
  };
}
