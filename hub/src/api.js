// API REST del hub (spec §5.2, §5.3). Documentos con la forma plana de views.js: { id, etag, ...campos }.
// ETag como cabecera HTTP; en escrituras, If-Match exige esa versión e If-None-Match: * exige que no exista.
import { exportMarkdown } from './export-md.js';
import { StoreError } from './store/json-files.js';
import { flat, listLists, listMilestones, listPlaytests, listTasks, STATUSES } from './views.js';
import { checkItem, freeId, slugify } from './lists.js';
import { dropImage, MAX_IMAGE, saveImage } from './images.js';
import { promoteDecision } from './promote.js';
import { taskHistory } from './history.js';

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
  // * es "cualquier versión" (19.4): como no mandar la cabecera.
  return ifMatch === undefined || ifMatch.trim() === '*' ? {} : { ifMatch: unquote(ifMatch) };
}

// Cuerpo de escritura: un objeto JSON. `id` y `etag` se ignoran (vienen de una lectura previa).
function body(req) {
  const b = req.body;
  if (b === null || typeof b !== 'object' || Array.isArray(b)) throw new StoreError('invalid_argument', 'el cuerpo tiene que ser un objeto JSON');
  const { id, etag, ...doc } = b;
  return doc;
}

const send = (reply, r, code = 200) => reply.code(code).header('etag', quote(r.etag)).send(flat(r.id, r.doc, r.etag));

export function registerApi(app, { store, projectDir, publish }) {
  const wrote = (collection, r) => { publish.upsert(collection, r); return r; };

  app.get('/api/milestones', async () => {
    const { items, warnings } = await store.list('milestones');
    return { milestones: listMilestones(items.map((m) => [m.id, m.doc])), warnings };
  });

  app.get('/api/milestones/:id', async (req, reply) => send(reply, await store.get('milestones', req.params.id)));

  app.put('/api/milestones/:id', async (req, reply) =>
    send(reply, wrote('milestones', await store.put('milestones', req.params.id, body(req), preconditions(req)))));

  app.delete('/api/milestones/:id', async (req, reply) => {
    await store.delete('milestones', req.params.id, preconditions(req));
    publish.delete('milestones', req.params.id);
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
    const r = wrote('tasks', await store.create('tasks', body(req)));
    return send(reply.header('location', `/api/tasks/${r.id}`), r, 201);
  });

  app.put('/api/tasks/:id', async (req, reply) =>
    send(reply, wrote('tasks', await store.put('tasks', req.params.id, body(req), preconditions(req)))));

  // Merge de primer nivel: los arrays se reemplazan enteros y null borra el campo.
  app.patch('/api/tasks/:id', async (req, reply) =>
    send(reply, wrote('tasks', await store.patch('tasks', req.params.id, body(req), preconditions(req)))));

  // Promover una decisión a una entrada D-n del documento de decisiones (§31): agrega al final del documento y marca
  // la decisión. El watcher de documentos avisa el cambio del documento.
  app.post('/api/tasks/:id/decisions/:n/promote', async (req, reply) => {
    const r = await promoteDecision(projectDir, store, req.params.id, Number(req.params.n));
    return send(reply.header('x-promoted', r.promoted).header('x-promoted-path', encodeURIComponent(r.doc.path)), wrote('tasks', r.task));
  });

  // Historial desde git (18.5): los commits que tocaron la tarea y qué cambió en cada uno.
  app.get('/api/tasks/:id/history', async (req) => {
    await store.get('tasks', req.params.id);
    return taskHistory(projectDir, req.params.id);
  });

  // Capturas (18.4, D38): { data: base64 } se guarda en compass/images/ y se suma a images de la tarea. If-Match opcional.
  app.post('/api/tasks/:id/images', { bodyLimit: Math.ceil(MAX_IMAGE * 4 / 3) + 4096 }, async (req, reply) => {
    const data = req.body?.data;
    if (typeof data !== 'string' || !data) throw new StoreError('invalid_argument', 'falta data (la imagen en base64)');
    const cur = await store.get('tasks', req.params.id);
    const path = await saveImage(projectDir, req.params.id, Buffer.from(data.replace(/^data:[^,]*,/, ''), 'base64'));
    const { ifMatch } = preconditions(req);
    try {
      return send(reply, wrote('tasks', await store.patch('tasks', req.params.id, { images: [...(cur.doc.images ?? []), path] }, { ifMatch: ifMatch ?? cur.etag })), 201);
    } catch (e) {
      await dropImage(projectDir, path, []); // no se pudo citar: no queda suelta
      throw e;
    }
  });

  // Quita una captura de la tarea; si la guardó la app y nadie más la cita, borra el archivo.
  app.delete('/api/tasks/:id/images', async (req, reply) => {
    const path = String(req.query.path ?? '');
    const cur = await store.get('tasks', req.params.id);
    const images = cur.doc.images ?? [];
    if (!images.includes(path)) throw new StoreError('not_found', `${req.params.id} no tiene la captura ${path}`);
    const next = images.filter((x) => x !== path);
    const { ifMatch } = preconditions(req);
    const r = wrote('tasks', await store.patch('tasks', req.params.id, { images: next.length ? next : null }, { ifMatch: ifMatch ?? cur.etag }));
    const all = await store.list('tasks');
    await dropImage(projectDir, path, all.items.map((x) => x.doc));
    return send(reply, r);
  });

  app.delete('/api/tasks/:id', async (req, reply) => {
    const cur = await store.get('tasks', req.params.id).catch(() => null);
    await store.delete('tasks', req.params.id, preconditions(req));
    publish.delete('tasks', req.params.id);
    // Sus capturas guardadas por la app que nadie más cita se borran, como al quitarlas (19.8).
    if (cur?.doc.images?.length) {
      const all = (await store.list('tasks')).items.map((x) => x.doc);
      for (const path of cur.doc.images) await dropImage(projectDir, path, all);
    }
    return reply.code(204).send();
  });

  // Listas (D25): el id lo elige el cliente (un slug del título), así que se crean con PUT + If-None-Match: *.
  app.get('/api/lists', async () => {
    const { items, warnings } = await store.list('lists');
    return { lists: listLists(items.map((l) => [l.id, l.doc])), warnings };
  });

  app.get('/api/lists/:id', async (req, reply) => send(reply, await store.get('lists', req.params.id)));

  // Crear con el id que saldría en la CLI (slug del título, -2 si ya existe), al final de la barra lateral.
  app.post('/api/lists', async (req, reply) => {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    if (!title) throw new StoreError('invalid_argument', 'falta el título');
    const { items } = await store.list('lists');
    const id = freeId(slugify(title), items.map((l) => l.id));
    const order = Math.max(0, ...items.map((l) => l.doc.order ?? 0)) + 1;
    const r = wrote('lists', await store.create('lists', { title, order, items: [] }, id));
    return send(reply.header('location', `/api/lists/${r.id}`), r, 201);
  });

  // Ítem n (desde 1) de una lista, con el etag de la lista si se manda (If-Match) para no tildar otro.
  const itemOf = async (req) => {
    const cur = await store.get('lists', req.params.id);
    const pre = preconditions(req);
    if (pre.ifMatch !== undefined && pre.ifMatch !== cur.etag) throw new StoreError('conflict', 'la lista cambió desde que se leyó', { current: cur });
    const n = req.body?.n;
    if (!Number.isInteger(n) || n < 1 || n > cur.doc.items.length) throw new StoreError('invalid_argument', `ítem inexistente: ${n} (la lista tiene ${cur.doc.items.length})`);
    return { cur, n, items: cur.doc.items };
  };

  // Tildar con la regla de la CLI (D26): uno que se repite no queda tildado, su fecha avanza un período.
  app.post('/api/lists/:id/check', async (req, reply) => {
    const { cur, n, items } = await itemOf(req);
    let r;
    try { r = checkItem(items[n - 1], { undo: !!req.body?.undo }); } catch (e) { throw new StoreError('invalid_argument', e.message); }
    const w = wrote('lists', await store.patch('lists', cur.id, { items: items.with(n - 1, r.item) }, { ifMatch: cur.etag }));
    return reply.header('etag', quote(w.etag)).send({ list: flat(w.id, w.doc, w.etag), advanced: r.advanced });
  });

  // Pasar a tarea: una tarea nueva con el texto del ítem, y el ítem queda apuntando a ella.
  app.post('/api/lists/:id/task', async (req, reply) => {
    const { cur, n, items } = await itemOf(req);
    const it = items[n - 1];
    if (it.task) throw new StoreError('conflict', `el ítem ${n} ya pasó a la tarea ${it.task}`);
    const milestone = req.body?.milestone;
    await store.get('milestones', typeof milestone === 'string' ? milestone : '');
    const t = wrote('tasks', await store.create('tasks', { milestone, title: it.text, code: req.body?.code ?? '', status: 'todo', checklist: [], test: '', notes: '', refs: [] }));
    const w = wrote('lists', await store.patch('lists', cur.id, { items: items.with(n - 1, { ...it, task: t.id }) }, { ifMatch: cur.etag }));
    return reply.code(201).send({ list: flat(w.id, w.doc, w.etag), task: flat(t.id, t.doc, t.etag) });
  });

  app.put('/api/lists/:id', async (req, reply) =>
    send(reply, wrote('lists', await store.put('lists', req.params.id, body(req), preconditions(req)))));

  app.patch('/api/lists/:id', async (req, reply) =>
    send(reply, wrote('lists', await store.patch('lists', req.params.id, body(req), preconditions(req)))));

  app.delete('/api/lists/:id', async (req, reply) => {
    await store.delete('lists', req.params.id, preconditions(req));
    publish.delete('lists', req.params.id);
    return reply.code(204).send();
  });

  // Sesiones de playtest (D39): como las listas, el id sale del título. Los ítems (tareas en orden, resultado y nota)
  // se escriben enteros con PATCH { items }, con If-Match.
  app.get('/api/playtests', async () => {
    const { items, warnings } = await store.list('playtests');
    return { playtests: listPlaytests(items.map((p) => [p.id, p.doc])), warnings };
  });

  app.get('/api/playtests/:id', async (req, reply) => send(reply, await store.get('playtests', req.params.id)));

  // { title, tasks? }: tasks, ids de tareas que ya existen, para arrancarla cargada (sin repetir).
  app.post('/api/playtests', async (req, reply) => {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    if (!title) throw new StoreError('invalid_argument', 'falta el título');
    const tasks = req.body?.tasks ?? [];
    if (!Array.isArray(tasks) || tasks.some((x) => typeof x !== 'string')) throw new StoreError('invalid_argument', 'tasks tiene que ser una lista de ids');
    for (const t of tasks) await store.get('tasks', t);
    const { items } = await store.list('playtests');
    const id = freeId(slugify(title, 'playtest'), items.map((p) => p.id));
    const order = Math.max(0, ...items.map((p) => p.doc.order ?? 0)) + 1;
    const r = wrote('playtests', await store.create('playtests', { title, order, items: [...new Set(tasks)].map((task) => ({ task })) }, id));
    return send(reply.header('location', `/api/playtests/${r.id}`), r, 201);
  });

  app.put('/api/playtests/:id', async (req, reply) =>
    send(reply, wrote('playtests', await store.put('playtests', req.params.id, body(req), preconditions(req)))));

  app.patch('/api/playtests/:id', async (req, reply) =>
    send(reply, wrote('playtests', await store.patch('playtests', req.params.id, body(req), preconditions(req)))));

  app.delete('/api/playtests/:id', async (req, reply) => {
    await store.delete('playtests', req.params.id, preconditions(req));
    publish.delete('playtests', req.params.id);
    return reply.code(204).send();
  });

  app.post('/api/export/markdown', async () => ({ path: await exportMarkdown(projectDir, await store.loadAll()) }));
}
