import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadValidators } from '../src/schema.js';
import { canonical } from '../src/store/canonical.js';
import { createJsonFilesStore } from '../src/store/json-files.js';
import { createServer } from '../src/server.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'compass');
const V = loadValidators();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let dir, compass, app, events;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'scompass-'));
  compass = join(dir, 'compass');
  await cp(FIXTURE, compass, { recursive: true });
  app = createServer({ projectDir: dir, store: createJsonFilesStore(compass, { validators: V }), validators: V, watch: true });
  events = [];
  app.events.on('event', (e) => events.push(e));
  await app.ready();
});
afterEach(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true, maxRetries: 10 });
});

const file = (c, id) => join(compass, c, `${id}.json`);
const readDoc = async (c, id) => JSON.parse(await readFile(file(c, id), 'utf8'));

// Espera hasta que haya `n` eventos (o 1 s) y deja pasar un rato para ver si llegan de más.
async function waitEvents(n, extraMs = 200) {
  const t0 = Date.now();
  while (events.length < n && Date.now() - t0 < 1000) await sleep(10);
  const elapsed = Date.now() - t0;
  await sleep(extraMs);
  return elapsed;
}

test('al arrancar no emite nada', async () => {
  await sleep(200);
  assert.deepEqual(events, []);
});

test('una edición a mano se emite como upsert en menos de 1 s', async () => {
  const doc = await readDoc('tasks', 'm1-07');
  await writeFile(file('tasks', 'm1-07'), JSON.stringify({ ...doc, status: 'review' }));
  const elapsed = await waitEvents(1);
  assert.ok(elapsed < 1000, `${elapsed} ms`);
  assert.equal(events.length, 1);
  const [e] = events;
  assert.equal(e.type, 'upsert');
  assert.equal(e.collection, 'tasks');
  assert.equal(e.id, 'm1-07');
  assert.equal(e.doc.status, 'review');
  assert.match(e.doc.etag, /^[0-9a-f]{16}$/);
});

test('reformatear sin cambiar el contenido no emite', async () => {
  const doc = await readDoc('tasks', 'm1-07');
  await writeFile(file('tasks', 'm1-07'), JSON.stringify(doc));
  await sleep(300);
  assert.deepEqual(events, []);
});

test('JSON roto: un aviso (no uno por cada escritura); al corregirlo, upsert', async () => {
  await writeFile(file('tasks', 'm0-02'), '{"title": ');
  await waitEvents(1);
  await writeFile(file('tasks', 'm0-02'), '<<<<<<< HEAD\n{}\n');
  await sleep(300);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'warning');
  assert.equal(events[0].path, 'compass/tasks/m0-02.json');
  assert.equal(events[0].code, 'invalid_json');

  await writeFile(file('tasks', 'm0-02'), canonical(await readDoc('tasks', 'm0-01')));
  await waitEvents(2);
  assert.equal(events.length, 2);
  assert.equal(events[1].type, 'upsert');
  assert.equal(events[1].id, 'm0-02');
});

test('borrar y crear archivos a mano: delete y upsert', async () => {
  await unlink(file('tasks', 'm0-06'));
  await writeFile(file('tasks', 'nueva'), canonical({ milestone: 'm02', title: 'A mano', status: 'todo' }));
  await waitEvents(2);
  const byId = Object.fromEntries(events.map((e) => [e.id, e.type]));
  assert.deepEqual(byId, { 'm0-06': 'delete', nueva: 'upsert' });
  assert.equal(events.length, 2);
});

test('una escritura de otro proceso (CLI sin hub) emite un solo upsert, sin los temporales', async () => {
  const cliStore = createJsonFilesStore(compass, { validators: V });
  await cliStore.patch('tasks', 'm1-04', { status: 'doing' });
  await waitEvents(1, 300);
  assert.equal(events.length, 1);
  assert.equal(events[0].doc.status, 'doing');
});

test('una escritura de la API se publica una sola vez (el watcher no la repite)', async () => {
  const r = await app.inject({ method: 'PATCH', url: '/api/tasks/m1-04', payload: { status: 'review' } });
  assert.equal(r.statusCode, 200);
  assert.equal(events.length, 1, 'se publica al instante');
  await sleep(300);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].doc, r.json());

  await app.inject({ method: 'DELETE', url: '/api/tasks/m1-04' });
  await sleep(300);
  assert.deepEqual(events.slice(1).map((e) => [e.type, e.id]), [['delete', 'm1-04']]);
});

test('ráfaga de cambios (git pull): un evento por archivo', async () => {
  const ids = ['m0-01', 'm0-02', 'm0-03', 'm0-04', 'm0-05'];
  for (const id of ids) {
    const doc = await readDoc('tasks', id);
    await writeFile(file('tasks', id), canonical({ ...doc, notes: 'pull' }));
  }
  await waitEvents(ids.length);
  assert.deepEqual(events.map((e) => e.id).sort(), ids);
  assert.ok(events.every((e) => e.type === 'upsert' && e.doc.notes === 'pull'));
});
