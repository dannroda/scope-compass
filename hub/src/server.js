// Hub de Scope Compass (spec §5): Fastify sobre el store json-files de un proyecto.
// createServer arma la app sin escuchar (los tests usan inject); listen la abre solo en 127.0.0.1.
import { EventEmitter } from 'node:events';
import { createServer as netServer } from 'node:net';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { registerApi } from './api.js';
import { registerDocsApi } from './docs-api.js';
import { createDocWatcher } from './doc-watcher.js';
import { createAutoExport } from './auto-export.js';
import { registerWs } from './ws.js';
import { StoreError } from './store/json-files.js';
import { createWatcher } from './watcher.js';
import { flat } from './views.js';
import { resourceDir } from './schema.js';
import { boardStatus } from './git.js';
import { liveHome } from './registry.js';

export const VERSION = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')).version;
export const HOST = '127.0.0.1';
export const WEB_DIR = resourceDir('web');

// Archivos de la UI (spec §7). Rutas fijas, sin comodín: un /api/... inexistente sigue siendo un 404 JSON.
const WEB_TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml' };

const HTTP_STATUS = { invalid_argument: 400, not_found: 404, conflict: 409, invalid_file: 409, io_error: 500 };

// token: si se pasa, cada request tiene que traer `Authorization: Bearer <token>` (hosting, §12). En local no se usa.
// watch: mira compass/ y publica los cambios externos (necesita validators).
// exportMd: regenera el export markdown tras cada cambio (D13); app.events emite 'exported' con la ruta.
// app.events emite 'event' con los mensajes del protocolo WebSocket (§5.5): upsert, delete, warning.
// webDir: carpeta de la UI (por defecto web/ del repo).
// onRestart: si se pasa, POST /api/restart lo llama (serve cierra y se vuelve a lanzar).
// onShutdown: si se pasa, POST /api/shutdown lo llama (serve cierra ordenado). Es la forma de apagar un hub en
// todas las plataformas: en Windows no hay SIGTERM y `kill` lo mata en seco, sin darse de baja (§18).
export function createServer({ projectDir, store, validators, watch = false, exportMd = false, token = null, logger = false, webDir = WEB_DIR, onRestart = null, onShutdown = null, gitPollMs = 3000 }) {
  // Al cerrar se cortan todas las conexiones: con la UI abierta (que reintenta cada 0,5 s) el cierre
  // podía quedar esperando una conexión nueva o el cierre educado de un WebSocket.
  const app = Fastify({ logger, forceCloseConnections: true });
  app.decorate('events', new EventEmitter());
  // Pestañas del tablero que pueden avisar con una notificación (mensaje `presence`, §5.5). focusBoard le pide a
  // la más reciente que llame la atención y devuelve false si no hay ninguna (entonces hay que abrir una).
  const boards = new Set();
  app.decorate('focusBoard', () => {
    const send = [...boards].at(-1);
    if (!send) return false;
    send({ type: 'focus' });
    return true;
  });
  const emit = (evt) => app.events.emit('event', evt);

  const watcher = watch ? createWatcher(join(projectDir, 'compass'), { validators, emit }) : null;
  // Documentos del proyecto (§10.4): doc_changed al editarlos. Se vuelve a armar cuando cambia config.json › docs.
  let docWatcher = null;
  const watchDocs = async () => {
    if (!watcher) return;
    const { config } = await store.loadAll();
    docWatcher?.close();
    docWatcher = createDocWatcher(projectDir, { config, emit });
  };
  if (watcher) {
    app.addHook('onReady', () => watcher.start());
    app.addHook('onClose', async () => watcher.close());
    app.addHook('onReady', watchDocs);
    app.addHook('onClose', async () => { docWatcher?.close(); docWatcher = null; });
  }
  if (exportMd) {
    const auto = createAutoExport({ projectDir, store, emit, onExported: (path) => app.events.emit('exported', path) });
    app.events.on('event', (e) => { if (e.type === 'upsert' || e.type === 'delete') auto.schedule(); });
    app.addHook('onClose', () => auto.flush());
  }
  // Escrituras del hub: se publican enseguida y el watcher no las repite.
  const publish = {
    upsert(collection, r) {
      watcher?.note(collection, r.id, r.etag);
      emit({ type: 'upsert', collection, id: r.id, doc: flat(r.id, r.doc, r.etag) });
    },
    delete(collection, id) {
      watcher?.note(collection, id, null);
      emit({ type: 'delete', collection, id });
    }
  };

  if (token) {
    app.addHook('onRequest', async (req, reply) => {
      if (req.headers.authorization !== `Bearer ${token}`) {
        return reply.code(401).send({ error: { code: 'unauthenticated', message: 'falta el token o es inválido' } });
      }
    });
  }

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof StoreError) {
      const body = { error: { code: err.code, message: err.message } };
      if (err.current) body.error.current = err.current;
      if (err.tasks) body.error.tasks = err.tasks;
      if (err.details) body.error.details = err.details;
      return reply.code(HTTP_STATUS[err.code] ?? 500).send(body);
    }
    // Errores de Fastify del lado del cliente: JSON roto (400), Content-Type (415), cuerpo grande (413)…
    if (err.statusCode >= 400 && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: { code: 'invalid_argument', message: err.message } });
    }
    req.log.error(err);
    return reply.code(500).send({ error: { code: 'io_error', message: err.message } });
  });
  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send({ error: { code: 'not_found', message: `no existe ${req.method} ${req.url}` } }));

  app.get('/api/health', async () => ({ ok: true, name: 'scope-compass', version: VERSION, project: projectDir, pid: process.pid }));
  // Reiniciar el hub (carga código nuevo). Responde antes de cerrar; el hub nuevo toma el mismo puerto.
  app.post('/api/restart', async (req, reply) => {
    if (!onRestart) throw new StoreError('invalid_argument', 'este hub no se puede reiniciar desde la API');
    reply.code(202).send({ ok: true, restarting: true });
    setImmediate(onRestart);
    return reply;
  });
  // Apagar el hub. Responde antes de cerrar.
  app.post('/api/shutdown', async (req, reply) => {
    if (!onShutdown) throw new StoreError('invalid_argument', 'este hub no se puede apagar desde la API');
    reply.code(202).send({ ok: true, stopping: true });
    setImmediate(onShutdown);
    return reply;
  });
  // Para servir este hub desde otra app (el Inicio, D29): lo que necesita su WebSocket.
  app.decorate('hub', { store, publish, boards, projectDir, version: VERSION });
  registerApi(app, { store, projectDir, publish });
  // Un documento agregado o quitado (12.2): se miran los documentos nuevos y la UI recarga la lista.
  registerDocsApi(app, { store, projectDir, validators, onDocsChanged: async (alias) => { await watchDocs(); emit({ type: 'doc_changed', alias }); } });
  app.register(registerWs, { store, publish, version: VERSION, boards });

  // Cambios sin commitear (4.4): GET /api/git, y un evento `git` cuando el número cambia después de una escritura
  // (del hub o de afuera). Se calcula después del export markdown, que también cuenta.
  let lastGit = null;
  const gitNow = async () => boardStatus(projectDir, (await store.loadAll()).config);
  app.get('/api/git', async () => { lastGit = await gitNow(); return lastGit; });
  // Un `git commit` no toca compass/: mientras haya algo sin commitear se vuelve a mirar cada gitPollMs.
  let gitTimer = null;
  let gitClosed = false;
  const checkGit = async () => {
    const s = await gitNow().catch(() => null);
    if (gitClosed || !s) return;
    // La primera vez solo toma la referencia: los clientes la piden con GET /api/git al cargar.
    if (lastGit && (s.uncommitted !== lastGit.uncommitted || s.files.join() !== lastGit.files.join())) emit({ type: 'git', ...s });
    lastGit = s;
    if (s.uncommitted > 0) gitTimer = setTimeout(checkGit, gitPollMs);
  };
  const recheckGit = () => { clearTimeout(gitTimer); gitTimer = setTimeout(checkGit, 400); };
  app.events.on('event', (e) => { if (e.type === 'upsert' || e.type === 'delete') recheckGit(); });
  app.events.on('exported', recheckGit);
  app.addHook('onReady', async () => { if (watch) recheckGit(); });
  app.addHook('onClose', async () => { gitClosed = true; clearTimeout(gitTimer); });

  // El Inicio, si está corriendo (D24): la web del tablero muestra "← Inicio" para volver a todos los proyectos.
  app.get('/api/home', async () => {
    const h = liveHome();
    return { url: h ? `http://127.0.0.1:${h.port}/` : null };
  });

  app.get('/api/config', async () => {
    const { config } = await store.loadAll();
    if (!config) throw new StoreError('invalid_file', 'compass/config.json falta o es inválido');
    return config;
  });

  // dir: '' o 'fonts'. name: un solo segmento, sin rutas relativas: no se puede salir de web/.
  const serveWeb = async (reply, dir, name) => {
    const ext = name.slice(name.lastIndexOf('.'));
    const missing = new StoreError('not_found', `no existe /${dir ? dir + '/' : ''}${name}`);
    if (!WEB_TYPES[ext] || !/^[\w.-]+$/.test(name) || name.startsWith('.')) throw missing;
    const body = await readFile(join(webDir, dir, name)).catch(() => null);
    if (!body) throw missing;
    return reply.type(WEB_TYPES[ext]).header('cache-control', 'no-cache').send(body);
  };
  app.get('/', (req, reply) => serveWeb(reply, '', 'index.html'));
  app.get('/app.css', (req, reply) => serveWeb(reply, '', 'app.css'));
  app.get('/app.js', (req, reply) => serveWeb(reply, '', 'app.js'));
  app.get('/favicon.svg', (req, reply) => serveWeb(reply, '', 'favicon.svg'));
  app.get('/fonts/:file', (req, reply) => serveWeb(reply, 'fonts', req.params.file));

  return app;
}

// El primer puerto libre en 127.0.0.1 desde `port` (hasta `tries` seguidos), o null.
export async function freePortFrom(port, tries = 20) {
  const free = (p) => new Promise((resolve) => {
    const s = netServer();
    s.once('error', () => resolve(false));
    s.listen(p, HOST, () => s.close(() => resolve(true)));
  });
  for (let p = port; p < port + tries && p <= 65535; p++) if (await free(p)) return p;
  return null;
}

export async function listen(app, port) {
  await app.listen({ host: HOST, port });
  return app.server.address();
}
