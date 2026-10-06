// Criterios de aceptación de v1 (spec §14) que necesitan el hub, sin UI (la UI es M3).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadValidators } from '../src/schema.js';
import { canonical } from '../src/store/canonical.js';
import { createJsonFilesStore } from '../src/store/json-files.js';
import { createServer, listen } from '../src/server.js';
import { run } from '../src/cli.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'compass');
const V = loadValidators();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let dir, compass, app, base;

async function startHub() {
  app = createServer({ projectDir: dir, store: createJsonFilesStore(compass, { validators: V }), validators: V, watch: true, exportMd: true });
  const { port } = await listen(app, 0);
  base = `http://127.0.0.1:${port}`;
  const cfgPath = join(compass, 'config.json');
  await writeFile(cfgPath, canonical({ ...JSON.parse(await readFile(cfgPath, 'utf8')), port }));
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'scompass-'));
  compass = join(dir, 'compass');
  await cp(FIXTURE, compass, { recursive: true });
  await startHub();
});
afterEach(async () => {
  await app?.close();
  await rm(dir, { recursive: true, force: true, maxRetries: 10 });
});

const json = async (path, init) => (await fetch(base + path, init)).json();
const cli = (argv) => run(argv, { cwd: dir, out: { write() {} }, err: { write() {} } });
const taskFile = (id) => join(compass, 'tasks', `${id}.json`);

test('§14: un JSON inválido con el hub corriendo avisa y el hub sigue respondiendo', async () => {
  await writeFile(taskFile('m0-02'), '{"title": ');
  await writeFile(taskFile('m0-03'), '<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> x\n');
  await sleep(300);
  assert.equal((await json('/api/health')).ok, true);
  const { tasks, warnings } = await json('/api/tasks');
  assert.equal(tasks.length, 11);
  assert.deepEqual(warnings.map((w) => w.code).sort(), ['conflict_markers', 'invalid_json']);
  const r = await fetch(base + '/api/tasks/m1-07', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"status":"review"}' });
  assert.equal(r.status, 200, 'el resto sigue editable');
});

test('§14: move, check, add y export md funcionan con el hub corriendo', async () => {
  assert.equal(await cli(['move', 'm1-07', 'doing']), 0);
  assert.equal(await cli(['check', 'm1-07', '1']), 0);
  assert.equal(await cli(['add', 'Con hub', '--milestone', 'm02']), 0);
  assert.equal(await cli(['export', 'md', '--out', 'otro.md']), 0);
  assert.match(await readFile(join(dir, 'otro.md'), 'utf8'), /### Con hub · Pendiente/);
  const t = await json('/api/tasks/m1-07');
  assert.equal(t.status, 'doing');
  assert.equal(t.checklist[0].done, true);
});

test('§14: con la app apagada, una edición a mano se ve al levantarla, sin pérdidas', async () => {
  await app.close();
  app = null;
  const before = JSON.parse(await readFile(taskFile('m1-07'), 'utf8'));
  const { updated_at, ...rest } = before;
  const hand = { ...rest, status: 'review', notes: 'editado con la app apagada ñ', checklist: [...before.checklist, { text: 'nuevo', done: false }] };
  await writeFile(taskFile('m1-07'), JSON.stringify(hand, null, 4));
  assert.equal(await cli(['--direct', 'show', 'm1-07']), 0, 'valida');

  await startHub();
  const { id, etag, ...seen } = await json('/api/tasks/m1-07');
  assert.deepEqual(seen, hand);
  // La primera escritura del hub normaliza el formato y conserva todo lo editado.
  await fetch(base + '/api/tasks/m1-07', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"status":"done"}' });
  const after = JSON.parse(await readFile(taskFile('m1-07'), 'utf8'));
  assert.equal(await readFile(taskFile('m1-07'), 'utf8'), canonical(after));
  assert.deepEqual({ ...after, updated_at: undefined, status: 'review' }, { ...hand, updated_at: undefined });
});

test('§14: un archivo con conflicto no se sobrescribe por ninguna vía del hub', async () => {
  const conflict = '<<<<<<< HEAD\n{"status": "done"}\n=======\n{"status": "todo"}\n>>>>>>> otra\n';
  await writeFile(taskFile('m0-04'), conflict);
  await sleep(200);
  const h = { 'content-type': 'application/json' };
  const codes = [
    (await fetch(base + '/api/tasks/m0-04', { method: 'PATCH', headers: h, body: '{"status":"todo"}' })).status,
    (await fetch(base + '/api/tasks/m0-04', { method: 'PUT', headers: h, body: '{"milestone":"m00","title":"x","status":"todo"}' })).status,
    (await fetch(base + '/api/tasks/m0-04', { method: 'DELETE' })).status
  ];
  assert.deepEqual(codes, [409, 409, 409]);
  assert.equal(await cli(['move', 'm0-04', 'todo']), 1);

  const ws = new WebSocket(base.replace('http', 'ws') + '/ws');
  const err = await new Promise((resolve) => {
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type === 'hello') ws.send(JSON.stringify({ type: 'update', req: 1, collection: 'tasks', id: 'm0-04', patch: { status: 'todo' } }));
      if (m.type === 'error') resolve(m);
    };
  });
  ws.close();
  assert.equal(err.code, 'invalid_file');
  assert.equal(await readFile(taskFile('m0-04'), 'utf8'), conflict);
});

test('escrituras concurrentes de varios clientes: ninguna se pierde y el etag decide', async () => {
  const ids = ['m0-01', 'm0-02', 'm0-03', 'm0-04', 'm0-05', 'm0-06', 'm1-01', 'm1-02'];
  const { etag } = await json('/api/tasks/m1-07');
  const h = { 'content-type': 'application/json' };
  const results = await Promise.all([
    ...ids.map((id) => fetch(`${base}/api/tasks/${id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ notes: `n-${id}` }) })),
    ...['a', 'b', 'c', 'd'].map((n) => fetch(`${base}/api/tasks/m1-07`, { method: 'PATCH', headers: { ...h, 'if-match': `"${etag}"` }, body: JSON.stringify({ notes: n }) })),
    ...['x', 'y'].map((n) => cli(['add', `CLI ${n}`, '--milestone', 'm02']))
  ]);
  const statuses = results.slice(0, ids.length + 4).map((r) => r.status);
  assert.deepEqual(statuses.slice(0, ids.length), ids.map(() => 200));
  assert.deepEqual(statuses.slice(ids.length).sort(), [200, 409, 409, 409], 'un solo ganador con el mismo etag');
  assert.deepEqual(results.slice(-2), [0, 0]);
  for (const id of ids) assert.equal(JSON.parse(await readFile(taskFile(id), 'utf8')).notes, `n-${id}`);
  const { tasks } = await json('/api/tasks?milestone=m02');
  assert.deepEqual(tasks.map((t) => t.title).sort(), ['CLI x', 'CLI y']);
});
