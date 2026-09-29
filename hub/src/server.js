// Hub de Scope Compass (spec §5): Fastify sobre el store json-files de un proyecto.
// createServer arma la app sin escuchar (los tests usan inject); listen la abre solo en 127.0.0.1.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { StoreError } from './store/json-files.js';

export const VERSION = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')).version;
export const HOST = '127.0.0.1';

const HTTP_STATUS = { invalid_argument: 400, not_found: 404, conflict: 409, invalid_file: 409, io_error: 500 };

// token: si se pasa, cada request tiene que traer `Authorization: Bearer <token>` (hosting, §12). En local no se usa.
export function createServer({ projectDir, store, token = null, logger = false }) {
  const app = Fastify({ logger });

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
    if (err.validation || err.statusCode === 400) {
      return reply.code(400).send({ error: { code: 'invalid_argument', message: err.message } });
    }
    req.log.error(err);
    return reply.code(500).send({ error: { code: 'io_error', message: err.message } });
  });
  app.setNotFoundHandler((req, reply) =>
    reply.code(404).send({ error: { code: 'not_found', message: `no existe ${req.method} ${req.url}` } }));

  app.get('/api/health', async () => ({ ok: true, name: 'scope-compass', version: VERSION, project: projectDir }));

  // La UI llega en M3.
  app.get('/', async (req, reply) => reply.type('text/plain; charset=utf-8')
    .send(`Scope Compass ${VERSION}: el hub está corriendo. La UI web llega en M3; mientras, usá la API en /api.\n`));

  return app;
}

export async function listen(app, port) {
  await app.listen({ host: HOST, port });
  return app.server.address();
}
