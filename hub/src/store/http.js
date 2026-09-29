// Store sobre la API del hub (spec §6): la misma interfaz que json-files, para que la CLI no cambie
// según haya hub o no. Los errores de la API vuelven como StoreError con el mismo código.
import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDoc } from '../schema.js';
import { StoreError } from './json-files.js';

const unflat = ({ id, etag, ...doc }) => ({ id, etag, doc });

// ¿Hay un hub de este mismo proyecto en el puerto? Devuelve la URL base o null.
export async function detectHub(projectDir, port, { timeoutMs = 300 } = {}) {
  if (!port) return null;
  const base = `http://127.0.0.1:${port}`;
  try {
    const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return null;
    const h = await r.json();
    if (h?.name !== 'scope-compass' || !h.project) return null;
    const [a, b] = await Promise.all([realpath(h.project), realpath(projectDir)]).catch(() => [h.project, projectDir]);
    return a === b ? base : null;
  } catch {
    return null;
  }
}

export function createHttpStore(base, compassDir, { validators }) {
  async function call(method, path, { body, headers = {} } = {}) {
    let r;
    try {
      r = await fetch(base + path, {
        method,
        headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (e) {
      throw new StoreError('io_error', `no se pudo hablar con el hub en ${base}: ${e.cause?.code ?? e.message}`);
    }
    if (r.status === 204) return null;
    const data = await r.json().catch(() => null);
    if (!r.ok) {
      const { code = 'io_error', message = `HTTP ${r.status}`, ...extra } = data?.error ?? {};
      throw new StoreError(code, message, extra);
    }
    return data;
  }
  const pre = ({ ifMatch } = {}) =>
    ifMatch === undefined ? {} : ifMatch === null ? { 'if-none-match': '*' } : { 'if-match': `"${ifMatch}"` };
  const enc = encodeURIComponent;

  async function readConfig() {
    const text = await readFile(join(compassDir, 'config.json'), 'utf8').catch(() => null);
    const res = text === null ? null : parseDoc(text, 'config', validators);
    return res?.ok ? res.doc : null;
  }

  return {
    hub: base,

    async loadAll() {
      const [m, t, config] = await Promise.all([call('GET', '/api/milestones'), call('GET', '/api/tasks'), readConfig()]);
      const toMap = (list) => new Map(list.map((d) => { const { id, doc } = unflat(d); return [id, doc]; }));
      return { config, milestones: toMap(m.milestones), tasks: toMap(t.tasks), warnings: [...m.warnings, ...t.warnings] };
    },

    async list(collection) {
      const data = await call('GET', `/api/${enc(collection)}`);
      return { items: data[collection].map(unflat), warnings: data.warnings };
    },

    get: async (collection, id) => unflat(await call('GET', `/api/${enc(collection)}/${enc(id)}`)),

    async create(collection, doc, id) {
      if (id !== undefined) return unflat(await call('PUT', `/api/${enc(collection)}/${enc(id)}`, { body: doc, headers: pre({ ifMatch: null }) }));
      if (collection !== 'tasks') throw new StoreError('invalid_argument', `crear sin id solo en tasks`);
      return unflat(await call('POST', '/api/tasks', { body: doc }));
    },

    put: async (collection, id, doc, opts) =>
      unflat(await call('PUT', `/api/${enc(collection)}/${enc(id)}`, { body: doc, headers: pre(opts) })),

    patch: async (collection, id, patch, opts) =>
      unflat(await call('PATCH', `/api/${enc(collection)}/${enc(id)}`, { body: patch, headers: pre(opts) })),

    async delete(collection, id, opts) {
      await call('DELETE', `/api/${enc(collection)}/${enc(id)}`, { headers: pre(opts) });
      return { id };
    }
  };
}
