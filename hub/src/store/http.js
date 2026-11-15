// Store sobre la API del hub (spec §6): la misma interfaz que json-files, para que la CLI no cambie
// según haya hub o no. Los errores de la API vuelven como StoreError con el mismo código.
import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDoc } from '../schema.js';
import { StoreError } from './json-files.js';
import { hubsOf } from '../registry.js';
import { PROTOCOL } from '../protocol.js';

const unflat = ({ id, etag, ...doc }) => ({ id, etag, doc });

// El hub de este proyecto: primero en el puerto de la config y, si no, donde diga el registro de hubs
// (por si se lanzó con otro --port). Devuelve la URL base o null.
/** Versión y protocolo que informó cada hub encontrado (URL base → { version, protocol }), para avisar si no es la de esta CLI. */
export const hubVersions = new Map();

// ¿El hub en `base` habla el mismo protocolo que este proceso (§39)? Uno anterior a §39 no lo informa: es otro.
export function hubCompatible(base) {
  const h = hubVersions.get(base);
  return !h || h.protocol === PROTOCOL;
}

// Las entradas del registro pueden traer una base (el Inicio sirve el proyecto en /p/<clave>, D29): la URL
// devuelta ya la incluye, así el store HTTP no cambia.
export async function detectHub(projectDir, port, opts = {}) {
  const candidates = [...hubsOf(projectDir).map((h) => [h.port, h.base ?? '']), [port, '']]
    .filter(([p, b], i, a) => p && a.findIndex(([q, c]) => q === p && c === b) === i);
  for (const [p, b] of candidates) {
    const base = await probeHub(projectDir, p, { ...opts, prefix: b });
    if (base) return base;
  }
  return null;
}

async function probeHub(projectDir, port, { timeoutMs = 300, prefix = '' } = {}) {
  if (!port) return null;
  const base = `http://127.0.0.1:${port}${prefix}`;
  try {
    const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return null;
    const h = await r.json();
    if (h?.name !== 'scope-compass' || !h.project) return null;
    const [a, b] = await Promise.all([realpath(h.project), realpath(projectDir)]).catch(() => [h.project, projectDir]);
    if (a === b) hubVersions.set(base, { version: String(h.version ?? ''), protocol: h.protocol ?? null });
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
      // Un hub de antes de las listas (o del playtest) no tiene /api/lists (/api/playtests): se ven vacías (la CLI ya
      // avisa que el hub es viejo).
      const optional = (name) => call('GET', `/api/${name}`).catch((e) => (e.code === 'not_found' ? { [name]: [], warnings: [] } : Promise.reject(e)));
      const [m, t, l, p, config] = await Promise.all([call('GET', '/api/milestones'), call('GET', '/api/tasks'), optional('lists'), optional('playtests'), readConfig()]);
      const toMap = (list) => new Map(list.map((d) => { const { id, doc } = unflat(d); return [id, doc]; }));
      return { config, milestones: toMap(m.milestones), tasks: toMap(t.tasks), lists: toMap(l.lists), playtests: toMap(p.playtests),
        warnings: [...m.warnings, ...t.warnings, ...l.warnings, ...p.warnings] };
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
