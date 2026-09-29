// Hub de Scope Compass (spec §5): Fastify sobre el store json-files de un proyecto.
// createServer arma la app sin escuchar (los tests usan inject); listen la abre solo en 127.0.0.1.
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { registerApi } from './api.js';
import { createAutoExport } from './auto-export.js';
import { registerWs } from './ws.js';
import { StoreError } from './store/json-files.js';
import { createWatcher } from './watcher.js';
import { flat } from './views.js';

export const VERSION = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')).version;
export const HOST = '127.0.0.1';

const HTTP_STATUS = { invalid_argument: 400, not_found: 404, conflict: 409, invalid_file: 409, io_error: 500 };

// token: si se pasa, cada request tiene que traer `Authorization: Bearer <token>` (hosting, §12). En local no se usa.
// watch: mira compass/ y publica los cambios externos (necesita validators).
// exportMd: regenera el export markdown tras cada cambio (D13); app.events emite 'exported' con la ruta.
// app.events emite 'event' con los mensajes del protocolo WebSocket (§5.5): upsert, delete, warning.
export function createServer({ projectDir, store, validators, watch = false, exportMd = false, token = null, logger = false }) {
  const app = Fastify({ logger });
  app.decorate('events', new EventEmitter());
  const emit = (evt) => app.events.emit('event', evt);

  const watcher = watch ? createWatcher(join(projectDir, 'compass'), { validators, emit }) : null;
  if (watcher) {
    app.addHook('onReady', () => watcher.start());
    app.addHook('onClose', async () => watcher.close());
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

  app.get('/api/health', async () => ({ ok: true, name: 'scope-compass', version: VERSION, project: projectDir }));
  registerApi(app, { store, projectDir, publish });
  app.register(registerWs, { store, publish, version: VERSION });

  // La UI llega en M3.
  app.get('/', async (req, reply) => reply.type('text/plain; charset=utf-8')
    .send(`Scope Compass ${VERSION}: el hub está corriendo. La UI web llega en M3; mientras, usá la API en /api.\n`));

  return app;
}

export async function listen(app, port) {
  await app.listen({ host: HOST, port });
  return app.server.address();
}
