// API REST del hub (spec §5.2, §5.3). Documentos con la forma plana de views.js: { id, etag, ...campos }.
// ETag como cabecera HTTP; en escrituras, If-Match exige esa versión e If-None-Match: * exige que no exista.
import { exportMarkdown } from './export-md.js';
import { StoreError } from './store/json-files.js';
import { flat, listMilestones, listTasks, STATUSES } from './views.js';

const quote = (etag) => `"${etag}"`;
const unquote = (v) => v.trim().replace(/^W\//, '').replace(/^"(.*)"$/, '$1');

// Opciones de concurrencia para el store a partir de las cabeceras.
function preconditions(req) {
  const ifNoneMatch = req.headers['if-none-match'];
  if (ifNoneMatch !== undefined) {
    if (ifNoneMatch.trim() !== '*') throw new StoreError('invalid_argument', 'If-None-Match solo admite *');
    return { ifMatch: null };
  }
  const ifMatch = req.headers['if-match'];
  return ifMatch === undefined ? {} : { ifMatch: unquote(ifMatch) };
}

// Cuerpo de escritura: un objeto JSON. `id` y `etag` se ignoran (vienen de una lectura previa).
function body(req) {
  const b = req.body;
  if (b === null || typeof b !== 'object' || Array.isArray(b)) throw new StoreError('invalid_argument', 'el cuerpo tiene que ser un objeto JSON');
  const { id, etag, ...doc } = b;
  return doc;
}

const send = (reply, r, code = 200) => reply.code(code).header('etag', quote(r.etag)).send(flat(r.id, r.doc, r.etag));

export function registerApi(app, { store, projectDir }) {
  app.get('/api/milestones', async () => {
    const { items, warnings } = await store.list('milestones');
    return { milestones: listMilestones(items.map((m) => [m.id, m.doc])), warnings };
  });

  app.get('/api/milestones/:id', async (req, reply) => send(reply, await store.get('milestones', req.params.id)));

  app.put('/api/milestones/:id', async (req, reply) =>
    send(reply, await store.put('milestones', req.params.id, body(req), preconditions(req))));

  app.delete('/api/milestones/:id', async (req, reply) => {
    await store.delete('milestones', req.params.id, preconditions(req));
    return reply.code(204).send();
  });

  app.get('/api/tasks', async (req) => {
    const { milestone, status } = req.query;
    if (status && !STATUSES.includes(status)) throw new StoreError('invalid_argument', `estado inválido: ${status}`);
    const all = await store.loadAll();
    return { tasks: listTasks(all, { milestone, status }), warnings: all.warnings };
  });

  app.get('/api/tasks/:id', async (req, reply) => send(reply, await store.get('tasks', req.params.id)));

  app.post('/api/tasks', async (req, reply) => {
    const r = await store.create('tasks', body(req));
    return send(reply.header('location', `/api/tasks/${r.id}`), r, 201);
  });

  app.put('/api/tasks/:id', async (req, reply) =>
    send(reply, await store.put('tasks', req.params.id, body(req), preconditions(req))));

  // Merge de primer nivel: los arrays se reemplazan enteros y null borra el campo.
  app.patch('/api/tasks/:id', async (req, reply) =>
    send(reply, await store.patch('tasks', req.params.id, body(req), preconditions(req))));

  app.delete('/api/tasks/:id', async (req, reply) => {
    await store.delete('tasks', req.params.id, preconditions(req));
    return reply.code(204).send();
  });

  app.post('/api/export/markdown', async () => ({ path: await exportMarkdown(projectDir, await store.loadAll()) }));
}
