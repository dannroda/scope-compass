import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadValidators } from '../src/schema.js';
import { createJsonFilesStore } from '../src/store/json-files.js';
import { createServer } from '../src/server.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'compass');
const V = loadValidators();
let dir, app;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'scompass-'));
  await cp(FIXTURE, join(dir, 'compass'), { recursive: true });
  app = createServer({ projectDir: dir, store: createJsonFilesStore(join(dir, 'compass'), { validators: V }) });
});
afterEach(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

const req = (method, url, payload, headers = {}) => app.inject({ method, url, payload, headers });
const file = (c, id) => join(dir, 'compass', c, `${id}.json`);

test('GET /api/milestones: ordenados, con id y etag', async () => {
  const r = await req('GET', '/api/milestones');
  assert.equal(r.statusCode, 200);
  const { milestones, warnings } = r.json();
  assert.deepEqual(warnings, []);
  assert.deepEqual(milestones.map((m) => m.code), ['M0', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7']);
  assert.match(milestones[0].etag, /^[0-9a-f]{16}$/);
  assert.equal(milestones[0].id, 'm00');
});

test('GET /api/tasks con filtros; estado inválido es 400', async () => {
  const all = (await req('GET', '/api/tasks')).json().tasks;
  assert.equal(all.length, 13);
  assert.equal(all[0].id, 'm0-01');
  const f = (await req('GET', '/api/tasks?milestone=m01&status=done')).json().tasks;
  assert.ok(f.length > 0 && f.every((t) => t.milestone === 'm01' && t.status === 'done'));
  const bad = await req('GET', '/api/tasks?status=wip');
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().error.code, 'invalid_argument');
});

test('GET de una tarea: cuerpo plano y cabecera ETag entre comillas', async () => {
  const r = await req('GET', '/api/tasks/m0-01');
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers.etag, `"${r.json().etag}"`);
  assert.equal(r.json().code, '0.1');
  assert.equal((await req('GET', '/api/tasks/nada')).statusCode, 404);
  assert.equal((await req('GET', '/api/tasks/..%2Fconfig')).statusCode, 400);
});

test('dos PATCH con el mismo If-Match: el segundo es 409 con el documento actual', async () => {
  const etag = (await req('GET', '/api/tasks/m1-04')).headers.etag;
  const a = await req('PATCH', '/api/tasks/m1-04', { status: 'review' }, { 'if-match': etag });
  assert.equal(a.statusCode, 200);
  assert.notEqual(a.headers.etag, etag);
  const b = await req('PATCH', '/api/tasks/m1-04', { status: 'todo' }, { 'if-match': etag });
  assert.equal(b.statusCode, 409);
  const { error } = b.json();
  assert.equal(error.code, 'conflict');
  assert.equal(error.current.doc.status, 'review');
  assert.equal(`"${error.current.etag}"`, a.headers.etag);
  assert.equal(JSON.parse(await readFile(file('tasks', 'm1-04'), 'utf8')).status, 'review');
  // Weak ETag y sin comillas también valen.
  const w = await req('PATCH', '/api/tasks/m1-04', { notes: 'x' }, { 'if-match': `W/${a.headers.etag}` });
  assert.equal(w.statusCode, 200);
});

test('PATCH: null borra, los arrays se reemplazan, id/etag del cuerpo se ignoran', async () => {
  const cur = (await req('GET', '/api/tasks/m0-01')).json();
  const r = await req('PATCH', '/api/tasks/m0-01', { ...cur, notes: null, checklist: [{ text: 'uno', done: false }] });
  assert.equal(r.statusCode, 200, r.body);
  assert.ok(!('notes' in r.json()));
  assert.deepEqual(r.json().checklist, [{ text: 'uno', done: false }]);
});

test('POST /api/tasks: 201, Location, ETag e id nuevo', async () => {
  const r = await req('POST', '/api/tasks', { milestone: 'm02', title: 'Nueva', status: 'todo' });
  assert.equal(r.statusCode, 201);
  const t = r.json();
  assert.match(t.id, /^[0-9a-z]{8}$/);
  assert.equal(r.headers.location, `/api/tasks/${t.id}`);
  assert.equal(r.headers.etag, `"${t.etag}"`);
  assert.ok(existsSync(file('tasks', t.id)));
});

test('PUT con If-None-Match: * crea solo si no existe', async () => {
  const doc = { milestone: 'm02', title: 'Con id', status: 'todo' };
  assert.equal((await req('PUT', '/api/tasks/m2-99', doc, { 'if-none-match': '*' })).statusCode, 200);
  const again = await req('PUT', '/api/tasks/m2-99', doc, { 'if-none-match': '*' });
  assert.equal(again.statusCode, 409);
  assert.equal((await req('PUT', '/api/tasks/m2-99', doc, { 'if-none-match': '"abc"' })).statusCode, 400);
  const m = await req('PUT', '/api/milestones/m08', { code: 'M8', order: 8, title: 'Extra' }, { 'if-none-match': '*' });
  assert.equal(m.statusCode, 200);
});

test('DELETE: 204; hito con tareas es 409 con la lista', async () => {
  assert.equal((await req('DELETE', '/api/tasks/m0-06')).statusCode, 204);
  assert.equal((await req('GET', '/api/tasks/m0-06')).statusCode, 404);
  const m = await req('DELETE', '/api/milestones/m00');
  assert.equal(m.statusCode, 409);
  assert.ok(m.json().error.tasks.includes('m0-01'));
  assert.equal((await req('DELETE', '/api/milestones/m07')).statusCode, 204);
});

test('cuerpos inválidos: 400 por schema, JSON roto, no-objeto; 415 por Content-Type', async () => {
  const s = await req('PATCH', '/api/tasks/m0-01', { status: 'wip' });
  assert.equal(s.statusCode, 400);
  assert.match(s.json().error.message, /status/);
  const broken = await app.inject({ method: 'PATCH', url: '/api/tasks/m0-01', payload: '{"status":', headers: { 'content-type': 'application/json' } });
  assert.equal(broken.statusCode, 400);
  assert.equal(broken.json().error.code, 'invalid_argument');
  assert.equal((await req('PATCH', '/api/tasks/m0-01', [1, 2])).statusCode, 400);
  const txt = await app.inject({ method: 'PATCH', url: '/api/tasks/m0-01', payload: 'hola', headers: { 'content-type': 'text/plain' } });
  assert.equal(txt.statusCode, 400);
  const ct = await app.inject({ method: 'PATCH', url: '/api/tasks/m0-01', payload: '<a/>', headers: { 'content-type': 'application/xml' } });
  assert.equal(ct.statusCode, 415);
  assert.equal(ct.json().error.code, 'invalid_argument');
});

test('archivo con conflicto: GET y escrituras son 409 invalid_file, y no se pisa', async () => {
  const conflict = '<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> x\n';
  await writeFile(file('tasks', 'm0-02'), conflict);
  for (const [m, payload] of [['GET'], ['PATCH', { status: 'todo' }], ['PUT', { milestone: 'm00', title: 'x', status: 'todo' }], ['DELETE']]) {
    const r = await req(m, '/api/tasks/m0-02', payload);
    assert.equal(r.statusCode, 409, m);
    assert.equal(r.json().error.code, 'invalid_file');
  }
  assert.equal(await readFile(file('tasks', 'm0-02'), 'utf8'), conflict);
  const list = (await req('GET', '/api/tasks')).json();
  assert.ok(!list.tasks.some((t) => t.id === 'm0-02'));
  assert.equal(list.warnings[0].code, 'conflict_markers');
});

test('POST /api/export/markdown escribe export_md', async () => {
  const r = await req('POST', '/api/export/markdown');
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().path, join(dir, 'docs', 'tareas.md'));
  assert.match(await readFile(r.json().path, 'utf8'), /^# Tareas — Scope Compass/);
});
