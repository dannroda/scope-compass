// Store `json-files` (spec §3, §4, §5.3): un archivo JSON por documento en compass/<colección>/<id>.json.
// Sin caché: cada operación lee el disco, así una edición a mano o un git pull se ven al instante.
// Las operaciones de un mismo store se encolan; entre procesos (hub y CLI) protege el ETag.
//
// Interfaz Store (la misma para el modo hosteado, spec §3): loadAll, list, get, create, put, patch, delete.
// Todo devuelve { id, doc, etag } y falla con StoreError; un archivo inválido nunca se sobrescribe.
import { createHash, randomInt } from 'node:crypto';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { canonical } from './canonical.js';
import { writeAtomic } from './atomic.js';
import { COLLECTIONS, loadCollection, loadCompass } from './load.js';
import { parseDoc } from '../schema.js';
import { isValidDue } from '../dates.js';

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
export const isValidId = (id) => typeof id === 'string' && ID.test(id);
const B36 = '0123456789abcdefghijklmnopqrstuvwxyz';
export const randomId = () => Array.from({ length: 8 }, () => B36[randomInt(36)]).join('');

// Id legible para una tarea nueva (4.3): m<N>-<NN> con el siguiente número del hito, como las importadas
// (m00 → m0-12, m10 → m10-03). Un hito con otro tipo de id usa uno aleatorio. Dos ramas que crean la misma
// tarea a la vez chocan en git (add/add): se resuelve renombrando una (el id es el nombre del archivo).
export function taskIdFor(milestone, ids) {
  const m = /^m(\d{1,2})$/.exec(milestone ?? '');
  if (!m) return null;
  const prefix = `m${Number(m[1])}-`;
  const nums = [...ids].map((id) => (id.startsWith(prefix) && /^\d+$/.test(id.slice(prefix.length)) ? Number(id.slice(prefix.length)) : 0));
  return prefix + String(Math.max(0, ...nums) + 1).padStart(2, '0');
}

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
    if (!isValidId(id)) throw new StoreError('invalid_argument', `id inválido: ${id}`);
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
    if (collection === 'tasks' || collection === 'lists') {
      doc = { ...doc, updated_at: now() };
      doc.created_at = current?.doc.created_at ?? doc.created_at ?? doc.updated_at;
    }
    // done_at (18.1): al pasar a Hecho, ahora (o el que traiga el documento); fuera de Hecho, no está. Una tarea que
    // ya estaba hecha conserva el suyo, y una hecha de antes del campo sigue sin él: no se inventa la fecha.
    if (collection === 'tasks') {
      if (doc.status !== 'done') delete doc.done_at;
      else if (current?.doc.status !== 'done') doc.done_at ??= doc.updated_at;
      else if (!doc.done_at && current.doc.done_at) doc.done_at = current.doc.done_at;
    }
    const res = parseDoc(JSON.stringify(doc), COLLECTIONS[collection], validators);
    if (!res.ok) throw new StoreError('invalid_argument', res.message, { details: res.details });
    // El schema mira el formato; una fecha que no existe (2026-02-30) se rechaza al ponerla (19.8). Una que ya estaba
    // en el archivo no impide editar otra cosa.
    if (doc.due !== undefined && doc.due !== current?.doc.due && !isValidDue(doc.due)) throw new StoreError('invalid_argument', `fecha inexistente: ${doc.due}`);
    try {
      // La carpeta puede faltar en un proyecto de antes de esa colección (lists/, D25).
      await mkdir(dirname(pathOf(collection, id)), { recursive: true });
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

    // Crea con id nuevo (tareas: legible por hito, ver taskIdFor) o con el id dado; falla si ya existe. Una tarea
    // sin order va al final de su hito.
    create: (collection, doc, id) => serial(async () => {
      if (id === undefined && collection === 'tasks') {
        const names = await readdir(join(compassDir, 'tasks')).catch(() => []);
        const ids = names.filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5));
        let next = taskIdFor(doc.milestone, ids);
        // Si otro proceso lo creó recién (entre el readdir y acá), el siguiente número.
        while (next && await readCurrent(collection, next).catch(() => true)) { ids.push(next); next = taskIdFor(doc.milestone, ids); }
        id = next ?? undefined;
      }
      if (id === undefined) {
        do id = randomId(); while (await readCurrent(collection, id).catch(() => true));
      } else if (await readCurrent(collection, id).catch(() => true)) {
        throw new StoreError('conflict', `ya existe ${collection}/${id}`);
      }
      // Sin order, la tarea va al final de su hito. Se calcula dentro de la cola: dos altas a la vez no lo repiten.
      if (collection === 'tasks' && doc.order === undefined) {
        const { docs } = await loadCollection(compassDir, 'tasks', validators);
        const orders = [...docs.values()].filter((t) => t.milestone === doc.milestone).map((t) => t.order ?? 0);
        doc = { ...doc, order: Math.max(0, ...orders) + 1 };
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
