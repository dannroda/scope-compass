// Hub de Scope Compass (spec §5): Fastify sobre el store json-files de un proyecto.
// createServer arma la app sin escuchar (los tests usan inject); listen la abre solo en 127.0.0.1.
import { EventEmitter } from 'node:events';
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

export const VERSION = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')).version;
export const HOST = '127.0.0.1';
export const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web');

// Archivos de la UI (spec §7). Rutas fijas, sin comodín: un /api/... inexistente sigue siendo un 404 JSON.
const WEB_TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };

const HTTP_STATUS = { invalid_argument: 400, not_found: 404, conflict: 409, invalid_file: 409, io_error: 500 };

// token: si se pasa, cada request tiene que traer `Authorization: Bearer <token>` (hosting, §12). En local no se usa.
// watch: mira compass/ y publica los cambios externos (necesita validators).
// exportMd: regenera el export markdown tras cada cambio (D13); app.events emite 'exported' con la ruta.
// app.events emite 'event' con los mensajes del protocolo WebSocket (§5.5): upsert, delete, warning.
// webDir: carpeta de la UI (por defecto web/ del repo).
// onRestart: si se pasa, POST /api/restart lo llama (serve cierra y se vuelve a lanzar).
export function createServer({ projectDir, store, validators, watch = false, exportMd = false, token = null, logger = false, webDir = WEB_DIR, onRestart = null }) {
  // Al cerrar se cortan todas las conexiones: con la UI abierta (que reintenta cada 0,5 s) el cierre
  // podía quedar esperando una conexión nueva o el cierre educado de un WebSocket.
  const app = Fastify({ logger, forceCloseConnections: true });
  app.decorate('events', new EventEmitter());
  const emit = (evt) => app.events.emit('event', evt);

  const watcher = watch ? createWatcher(join(projectDir, 'compass'), { validators, emit }) : null;
  if (watcher) {
    app.addHook('onReady', () => watcher.start());
    app.addHook('onClose', async () => watcher.close());
    // Documentos del proyecto (§10.4): doc_changed al editarlos.
    let docWatcher = null;
    app.addHook('onReady', async () => {
      const { config } = await store.loadAll();
      docWatcher = createDocWatcher(projectDir, { docs: config?.docs, emit });
    });
    app.addHook('onClose', async () => docWatcher?.close());
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
  registerApi(app, { store, projectDir, publish });
  registerDocsApi(app, { store, projectDir });
  app.register(registerWs, { store, publish, version: VERSION });

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
  app.get('/fonts/:file', (req, reply) => serveWeb(reply, 'fonts', req.params.file));

  return app;
}

export async function listen(app, port) {
  await app.listen({ host: HOST, port });
  return app.server.address();
}
