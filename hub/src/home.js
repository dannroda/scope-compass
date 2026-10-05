// Inicio (`scompass home`, spec §16.2, D24): un proceso aparte que conoce todos los proyectos del registro (D23),
// los lee de disco y habla con sus hubs vivos. No reemplaza a ningún hub: cada proyecto sigue con el suyo.
//   GET    /api/health
//   GET    /api/projects                     registro + estado del hub + resumen de cada proyecto
//   POST   /api/projects        { path }     importar (anotar sin levantar el hub)
//   DELETE /api/projects?path=…              quitar del registro (no toca los datos)
//   GET    /api/today                        vencido, de hoy y en curso, de todos los proyectos
//   POST   /api/projects/check-item  { path, list, n, etag? }   tildar un ítem (los que se repiten avanzan)
//   POST   /api/projects/move-task   { path, id, status, etag? }
//   GET    /ws                               { type: 'changed', path, collection?, id? } | { type: 'hubs' } | { type: 'projects' }
// Las escrituras pasan por el hub del proyecto si está vivo (lo publica a sus pestañas y al dock); si no, van
// directo a compass/ con etag, como la CLI, y regeneran el export markdown.
import { EventEmitter } from 'node:events';
import { statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { exportMarkdown } from './export-md.js';
import { checkItem } from './lists.js';
import { forgetProject, loadProjects, projectsFile, projectsStatus, ProjectsError, recordProject } from './projects.js';
import { listHubs } from './registry.js';
import { VERSION } from './server.js';
import { createHttpStore, detectHub } from './store/http.js';
import { createJsonFilesStore, StoreError } from './store/json-files.js';
import { loadCompass } from './store/load.js';
import { summarize, todayOf } from './summary.js';
import { STATUSES } from './views.js';

const HTTP_STATUS = { invalid_argument: 400, not_found: 404, conflict: 409, invalid_file: 409, invalid: 409, io_error: 500 };

// now: función que devuelve la fecha "de hoy" (los tests la fijan). pollMs: cada cuánto mira el registro de hubs.
export function createHomeServer({ validators, now = () => new Date(), pollMs = 1000, logger = false }) {
  const app = Fastify({ logger, forceCloseConnections: true });
  const events = new EventEmitter();
  app.decorate('events', events);
  const emit = (e) => events.emit('event', e);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof StoreError || err instanceof ProjectsError) {
      const body = { error: { code: err.code, message: err.message } };
      if (err.current) body.error.current = err.current;
      return reply.code(HTTP_STATUS[err.code] ?? 500).send(body);
    }
    if (err.statusCode >= 400 && err.statusCode < 500) return reply.code(err.statusCode).send({ error: { code: 'invalid_argument', message: err.message } });
    req.log.error(err);
    return reply.code(500).send({ error: { code: 'io_error', message: err.message } });
  });
  app.setNotFoundHandler((req, reply) => reply.code(404).send({ error: { code: 'not_found', message: `no existe ${req.method} ${req.url}` } }));

  // Solo se actúa sobre proyectos del registro: el Inicio no escribe en carpetas que nadie le pidió.
  const known = (path) => {
    if (typeof path !== 'string' || !path) throw new StoreError('invalid_argument', 'falta path');
    const p = projectsStatus().find((x) => x.path === path);
    if (!p) throw new StoreError('not_found', `${path} no está en el registro (importalo primero)`);
    if (!p.found) throw new StoreError('not_found', `no se encuentra ${join(path, 'compass')}`);
    return p;
  };
  const compassOf = (path) => join(path, 'compass');
  const readConfig = (path) => readFile(join(path, 'compass', 'config.json'), 'utf8').then(JSON.parse).catch(() => null);

  // El store del proyecto: su hub si está vivo, o compass/ directo.
  async function storeFor(path) {
    const hub = await detectHub(path, (await readConfig(path))?.port);
    return hub ? createHttpStore(hub, compassOf(path), { validators }) : createJsonFilesStore(compassOf(path), { validators });
  }
  // Después de escribir directo: export markdown y aviso a las pestañas del Inicio (con hub, lo hacen el hub y su WS).
  async function afterWrite(path, store, collection, id) {
    if (!store.hub) {
      const all = await store.loadAll();
      if (all.config?.export_md && all.config.auto_export_md !== false) await exportMarkdown(path, all);
      emit({ type: 'changed', path, collection, id });
    }
  }

  async function projectView(p) {
    const base = { path: p.path, name: p.name, found: p.found, hubs: p.hubs, added_at: p.added_at, last_seen: p.last_seen };
    if (!p.found) return base;
    const all = await loadCompass(compassOf(p.path), validators);
    return { ...base, name: all.config?.project ?? p.name, views: all.config?.views ?? null, warnings: all.warnings.length, summary: summarize(all, now()) };
  }

  app.get('/api/health', async () => ({ ok: true, name: 'scope-compass-home', version: VERSION, pid: process.pid, projects_file: projectsFile() }));

  app.get('/api/projects', async () => ({ projects: await Promise.all(projectsStatus().map(projectView)) }));

  app.post('/api/projects', async (req, reply) => {
    const { entry, added } = await recordProject(req.body?.path ?? '');
    emit({ type: 'projects' });
    return reply.code(added ? 201 : 200).send({ project: entry, added });
  });

  app.delete('/api/projects', async (req) => {
    const removed = await forgetProject(req.query.path ?? '');
    emit({ type: 'projects' });
    return { removed };
  });

  app.get('/api/today', async () => {
    const items = [];
    for (const p of projectsStatus().filter((x) => x.found)) {
      const all = await loadCompass(compassOf(p.path), validators);
      for (const x of todayOf(all, now())) items.push({ ...x, project: { path: p.path, name: all.config?.project ?? p.name } });
    }
    const rank = { overdue: 0, today: 1 };
    return { items: items.sort((a, b) => (rank[a.due_state] ?? 2) - (rank[b.due_state] ?? 2) || String(a.due ?? '~').localeCompare(String(b.due ?? '~'))) };
  });

  app.post('/api/projects/check-item', async (req) => {
    const { path, list, n, etag, undo } = req.body ?? {};
    known(path);
    const store = await storeFor(path);
    const cur = await store.get('lists', list);
    if (etag !== undefined && etag !== cur.etag) throw new StoreError('conflict', 'la lista cambió desde que se leyó', { current: { id: cur.id, etag: cur.etag, ...cur.doc } });
    const items = cur.doc.items;
    if (!Number.isInteger(n) || n < 1 || n > items.length) throw new StoreError('invalid_argument', `ítem inexistente: ${n} (la lista tiene ${items.length})`);
    let r;
    try { r = checkItem(items[n - 1], { undo: !!undo }); } catch (e) { throw new StoreError(e.code ?? 'invalid_argument', e.message); }
    const w = await store.patch('lists', list, { items: items.with(n - 1, r.item) }, { ifMatch: cur.etag });
    await afterWrite(path, store, 'lists', list);
    return { list: { id: w.id, etag: w.etag, ...w.doc }, advanced: r.advanced, via: store.hub ? 'hub' : 'disk' };
  });

  app.post('/api/projects/move-task', async (req) => {
    const { path, id, status, etag } = req.body ?? {};
    known(path);
    if (!STATUSES.includes(status)) throw new StoreError('invalid_argument', `estado inválido: ${status}`);
    const store = await storeFor(path);
    const w = await store.patch('tasks', id, { status }, etag === undefined ? {} : { ifMatch: etag });
    await afterWrite(path, store, 'tasks', id);
    return { task: { id: w.id, etag: w.etag, ...w.doc }, via: store.hub ? 'hub' : 'disk' };
  });

  // En vivo: el Inicio se suscribe al WebSocket de cada hub vivo de un proyecto conocido y reenvía sus cambios.
  const subs = new Map(); // `${pid}` → { ws, path }
  let lastHubs = '';
  let lastMtime = null;
  const mtime = () => { try { return statSync(projectsFile()).mtimeMs; } catch { return null; } };
  function poll() {
    const paths = new Set(loadProjectsSafe().map((p) => p.path));
    const live = listHubs().filter((h) => h.kind !== 'home' && paths.has(h.project));
    const key = live.map((h) => `${h.pid}:${h.port}`).sort().join(',');
    for (const [pid, s] of subs) if (!live.some((h) => String(h.pid) === pid)) { s.ws.close(); subs.delete(pid); }
    for (const h of live) {
      if (subs.has(String(h.pid))) continue;
      const ws = new WebSocket(`ws://127.0.0.1:${h.port}/ws`);
      ws.addEventListener('message', (m) => {
        let e;
        try { e = JSON.parse(m.data); } catch { return; }
        if (e.type === 'upsert' || e.type === 'delete') emit({ type: 'changed', path: h.project, collection: e.collection, id: e.id });
      });
      ws.addEventListener('error', () => {});
      ws.addEventListener('close', () => { if (subs.get(String(h.pid))?.ws === ws) subs.delete(String(h.pid)); });
      subs.set(String(h.pid), { ws, path: h.project });
    }
    if (key !== lastHubs) { lastHubs = key; emit({ type: 'hubs' }); }
    const m = mtime();
    if (m !== lastMtime) { if (lastMtime !== null || m !== null) emit({ type: 'projects' }); lastMtime = m; }
  }
  const loadProjectsSafe = () => { try { return loadProjects(); } catch { return []; } };
  let timer = null;
  app.addHook('onReady', async () => { lastMtime = mtime(); poll(); timer = setInterval(poll, pollMs); });
  app.addHook('onClose', async () => { clearInterval(timer); for (const s of subs.values()) s.ws.close(); subs.clear(); });
  app.decorate('poll', poll);

  app.register(async (scope) => {
    await scope.register(websocket, {
      preClose(done) { for (const c of this.websocketServer.clients) c.terminate(); this.websocketServer.close(done); }
    });
    scope.get('/ws', { websocket: true }, (socket) => {
      const forward = (e) => { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(e)); };
      events.on('event', forward);
      socket.on('close', () => events.off('event', forward));
      forward({ type: 'hello', server_version: VERSION });
    });
  });

  return app;
}
