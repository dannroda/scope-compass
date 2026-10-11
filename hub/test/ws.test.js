import './isolate.js';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadValidators } from '../src/schema.js';
import { createJsonFilesStore } from '../src/store/json-files.js';
import { createServer, listen, VERSION } from '../src/server.js';
import { run } from '../src/cli.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'compass');
const V = loadValidators();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let dir, compass, app, base, clients;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'scompass-'));
  compass = join(dir, 'compass');
  await cp(FIXTURE, compass, { recursive: true });
  app = createServer({ projectDir: dir, store: createJsonFilesStore(compass, { validators: V }), validators: V, watch: true });
  const { port } = await listen(app, 0);
  base = `127.0.0.1:${port}`;
  clients = [];
});
afterEach(async () => {
  for (const c of clients) c.ws.close();
  await app.close();
  await rm(dir, { recursive: true, force: true, maxRetries: 10 });
});

// Cliente mínimo: guarda los mensajes y permite esperar el siguiente de un tipo.
async function connect() {
  const ws = new WebSocket(`ws://${base}/ws`);
  const msgs = [];
  const waiters = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    msgs.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
  });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const next = (pred, ms = 1000) => {
    const found = msgs.find(pred);
    if (found) { msgs.splice(msgs.indexOf(found), 1); return Promise.resolve(found); }
    return new Promise((resolve, reject) => {
      const w = { pred, resolve: (m) => { clearTimeout(t); msgs.splice(msgs.indexOf(m), 1); resolve(m); } };
      const t = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); reject(new Error('timeout esperando mensaje')); }, ms);
      waiters.push(w);
    });
  };
  const c = { ws, msgs, next, send: (m) => ws.send(typeof m === 'string' ? m : JSON.stringify(m)) };
  clients.push(c);
  await next((m) => m.type === 'hello');
  return c;
}
const type = (t) => (m) => m.type === t;

test('hello al conectar con la versión del servidor', async () => {
  const ws = new WebSocket(`ws://${base}/ws`);
  const first = await new Promise((res) => ws.addEventListener('message', (e) => res(JSON.parse(e.data))));
  assert.deepEqual(first, { type: 'hello', server_version: VERSION });
  ws.close();
});

test('mover una tarjeta por la API llega como upsert a todos los clientes', async () => {
  const [a, b] = [await connect(), await connect()];
  const r = await fetch(`http://${base}/api/tasks/m1-04`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'doing' }) });
  const doc = await r.json();
  for (const c of [a, b]) {
    const m = await c.next(type('upsert'));
    assert.deepEqual(m, { type: 'upsert', collection: 'tasks', id: 'm1-04', doc });
  }
});

test('mover una tarjeta con la CLI (sin pasar por el hub) llega como upsert', async () => {
  const c = await connect();
  assert.equal(await run(['move', 'm1-04', 'review'], { cwd: dir, out: { write() {} }, err: { write() {} } }), 0);
  const m = await c.next(type('upsert'));
  assert.equal(m.id, 'm1-04');
  assert.equal(m.doc.status, 'review');
  await sleep(200);
  assert.equal(c.msgs.filter(type('upsert')).length, 0, 'un solo evento');
});

test('edición a mano: upsert; JSON roto: warning; borrado por la API: delete', async () => {
  const c = await connect();
  const doc = JSON.parse(await readFile(join(compass, 'tasks', 'm0-01.json'), 'utf8'));
  await writeFile(join(compass, 'tasks', 'm0-01.json'), JSON.stringify({ ...doc, title: 'A mano' }));
  assert.equal((await c.next(type('upsert'))).doc.title, 'A mano');
  await writeFile(join(compass, 'tasks', 'm0-02.json'), '{');
  const w = await c.next(type('warning'));
  assert.equal(w.path, 'compass/tasks/m0-02.json');
  await fetch(`http://${base}/api/tasks/m0-03`, { method: 'DELETE' });
  assert.deepEqual(await c.next(type('delete')), { type: 'delete', collection: 'tasks', id: 'm0-03' });
});

test('update: ack a quien lo manda y upsert para todos', async () => {
  const [a, b] = [await connect(), await connect()];
  const { etag } = await (await fetch(`http://${base}/api/tasks/m1-07`)).json();
  a.send({ type: 'update', req: 7, collection: 'tasks', id: 'm1-07', etag, patch: { status: 'review' } });
  const ack = await a.next(type('ack'));
  assert.equal(ack.req, 7);
  assert.equal(ack.doc.status, 'review');
  assert.notEqual(ack.doc.etag, etag);
  assert.deepEqual((await b.next(type('upsert'))).doc, ack.doc);
  assert.deepEqual((await a.next(type('upsert'))).doc, ack.doc);
  assert.equal(JSON.parse(await readFile(join(compass, 'tasks', 'm1-07.json'), 'utf8')).status, 'review');
});

test('update con etag viejo: error conflict con el documento actual, nada escrito', async () => {
  const c = await connect();
  const { etag } = await (await fetch(`http://${base}/api/tasks/m1-07`)).json();
  c.send({ type: 'update', req: 1, collection: 'tasks', id: 'm1-07', etag, patch: { status: 'doing' } });
  const ok = await c.next(type('ack'));
  c.send({ type: 'update', req: 2, collection: 'tasks', id: 'm1-07', etag, patch: { status: 'todo' } });
  const err = await c.next(type('error'));
  assert.equal(err.req, 2);
  assert.equal(err.code, 'conflict');
  assert.deepEqual(err.doc, ok.doc);
  assert.equal(JSON.parse(await readFile(join(compass, 'tasks', 'm1-07.json'), 'utf8')).status, 'doing');
});

test('mensajes inválidos responden error sin cerrar la conexión', async () => {
  const c = await connect();
  const cases = [
    ['no es json', null, 'invalid_argument'],
    [{ type: 'otra', req: 1 }, 1, 'invalid_argument'],
    [{ type: 'update', req: 2, collection: 'milestones', id: 'm00', patch: {} }, 2, 'invalid_argument'],
    [{ type: 'update', req: 3, collection: 'tasks', id: 'm1-07' }, 3, 'invalid_argument'],
    [{ type: 'update', req: 4, collection: 'tasks', id: 'nada', patch: { status: 'done' } }, 4, 'not_found'],
    [{ type: 'update', req: 5, collection: 'tasks', id: 'm1-07', patch: { status: 'wip' } }, 5, 'invalid_argument']
  ];
  for (const [msg, req, code] of cases) {
    c.send(msg);
    const e = await c.next(type('error'));
    assert.deepEqual([e.req, e.code], [req, code], JSON.stringify(msg));
  }
  assert.equal(c.ws.readyState, WebSocket.OPEN);
});

test('al cerrar la conexión se suelta la suscripción', async () => {
  const before = app.events.listenerCount('event');
  const c = await connect();
  assert.equal(app.events.listenerCount('event'), before + 1);
  c.ws.close();
  for (let i = 0; i < 50 && app.events.listenerCount('event') > before; i++) await sleep(10);
  assert.equal(app.events.listenerCount('event'), before);
});
