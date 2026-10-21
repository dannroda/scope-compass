import './isolate.js';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadValidators } from '../src/schema.js';
import { canonical } from '../src/store/canonical.js';
import { createJsonFilesStore, etagOf, randomId } from '../src/store/json-files.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = join(REPO, 'hub', 'test', 'fixtures', 'compass');
const V = loadValidators();
const NOW = '2026-10-01T12:00:00.000Z';
let dir, compass, store;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'scompass-'));
  compass = join(dir, 'compass');
  await cp(FIXTURE, compass, { recursive: true });
  store = createJsonFilesStore(compass, { validators: V, now: () => NOW });
});
afterEach(() => rm(dir, { recursive: true, force: true, maxRetries: 10 }));

const file = (c, id) => join(compass, c, `${id}.json`);
const assertStoreError = (code) => (e) => e.code === code;

test('get devuelve el documento y un etag estable del contenido canónico', async () => {
  const a = await store.get('tasks', 'm0-01');
  assert.equal(a.doc.code, '0.1');
  assert.equal(a.etag, etagOf(JSON.parse(await readFile(file('tasks', 'm0-01'), 'utf8'))));
  assert.match(a.etag, /^[0-9a-f]{16}$/);
  // Mismo contenido con otro formato → mismo etag.
  await writeFile(file('tasks', 'm0-01'), JSON.stringify(a.doc));
  assert.equal((await store.get('tasks', 'm0-01')).etag, a.etag);
});

test('dos escrituras con el mismo etag: la segunda falla con conflicto y el documento actual', async () => {
  const { etag } = await store.get('tasks', 'm0-05');
  const first = await store.patch('tasks', 'm0-05', { status: 'review' }, { ifMatch: etag });
  await assert.rejects(store.patch('tasks', 'm0-05', { status: 'todo' }, { ifMatch: etag }), (e) => {
    assert.equal(e.code, 'conflict');
    assert.deepEqual(e.current, first);
    return true;
  });
  assert.equal((await store.get('tasks', 'm0-05')).doc.status, 'review');
});

test('mover una tarjeta cambia un solo archivo: status y updated_at', async () => {
  const before = Object.fromEntries(await Promise.all((await readdir(join(compass, 'tasks'))).map(async (n) =>
    [n, await readFile(join(compass, 'tasks', n), 'utf8')])));
  const from = (await store.get('tasks', 'm1-07')).doc.status;
  const to = from === 'doing' ? 'review' : 'doing';
  await store.patch('tasks', 'm1-07', { status: to });
  const changed = [];
  for (const [n, text] of Object.entries(before)) {
    const now = await readFile(join(compass, 'tasks', n), 'utf8');
    if (now !== text) changed.push([n, text.split('\n'), now.split('\n')]);
  }
  assert.equal(changed.length, 1);
  const [name, a, b] = changed[0];
  assert.equal(name, 'm1-07.json');
  const diff = a.map((line, i) => [line, b[i]]).filter(([x, y]) => x !== y);
  assert.deepEqual(diff, [
    [`  "status": "${from}",`, `  "status": "${to}",`],
    [a.find((l) => l.includes('"updated_at"')), `  "updated_at": "${NOW}"`]
  ]);
  assert.deepEqual(await readdir(join(compass, 'tasks')), Object.keys(before).sort());
});

test('patch: los arrays se reemplazan enteros y null borra el campo', async () => {
  const r = await store.patch('tasks', 'm0-01', { checklist: [{ text: 'solo', done: false }], notes: null });
  assert.deepEqual(r.doc.checklist, [{ text: 'solo', done: false }]);
  assert.ok(!('notes' in r.doc));
  assert.equal(await readFile(file('tasks', 'm0-01'), 'utf8'), canonical(r.doc));
});

test('create: id legible del hito (el siguiente número) y created_at = updated_at', async () => {
  const before = (await store.list('tasks')).items.map((t) => t.id).filter((id) => id.startsWith('m1-')).map((id) => Number(id.slice(3)));
  const r = await store.create('tasks', { milestone: 'm01', title: 'Nueva', status: 'todo' });
  assert.equal(r.id, 'm1-' + String(Math.max(...before) + 1).padStart(2, '0'));
  const r2 = await store.create('tasks', { milestone: 'm01', title: 'Otra', status: 'todo' });
  assert.equal(Number(r2.id.slice(3)), Number(r.id.slice(3)) + 1);
  assert.equal(r.doc.created_at, NOW);
  assert.equal(r.doc.updated_at, NOW);
  assert.deepEqual((await store.get('tasks', r.id)).doc, r.doc);
  await assert.rejects(store.create('tasks', r.doc, r.id), assertStoreError('conflict'));
});

test('put conserva created_at y ifMatch null exige que no exista', async () => {
  const cur = await store.get('tasks', 'm0-02');
  const r = await store.put('tasks', 'm0-02', { milestone: 'm00', title: 'Reemplazo', status: 'todo' }, { ifMatch: cur.etag });
  assert.equal(r.doc.created_at, cur.doc.created_at);
  assert.equal(r.doc.title, 'Reemplazo');
  await assert.rejects(store.put('tasks', 'm0-02', r.doc, { ifMatch: null }), assertStoreError('conflict'));
  const m = await store.put('milestones', 'm08', { code: 'M8', order: 8, title: 'Nuevo' }, { ifMatch: null });
  assert.ok(!('updated_at' in m.doc));
});

test('un documento inválido no se escribe', async () => {
  const before = await readFile(file('tasks', 'm0-01'), 'utf8');
  await assert.rejects(store.patch('tasks', 'm0-01', { status: 'wip' }), (e) => {
    assert.equal(e.code, 'invalid_argument');
    assert.match(e.message, /status/);
    return true;
  });
  await assert.rejects(store.patch('tasks', 'm0-01', { extra: 1 }), assertStoreError('invalid_argument'));
  assert.equal(await readFile(file('tasks', 'm0-01'), 'utf8'), before);
});

test('escribir sobre un archivo inválido o con conflicto se rechaza y no lo pisa', async () => {
  const conflict = '<<<<<<< HEAD\n{"status": "done"}\n=======\n{"status": "doing"}\n>>>>>>> otra\n';
  await writeFile(file('tasks', 'm0-03'), conflict);
  for (const op of [
    () => store.get('tasks', 'm0-03'),
    () => store.patch('tasks', 'm0-03', { status: 'done' }),
    () => store.put('tasks', 'm0-03', { milestone: 'm00', title: 'x', status: 'done' }),
    () => store.delete('tasks', 'm0-03'),
    () => store.create('tasks', { milestone: 'm00', title: 'x', status: 'done' }, 'm0-03')
  ]) {
    await assert.rejects(op(), (e) => ['invalid_file', 'conflict'].includes(e.code));
  }
  assert.equal(await readFile(file('tasks', 'm0-03'), 'utf8'), conflict);
  const { items, warnings } = await store.list('tasks');
  assert.ok(!items.some((t) => t.id === 'm0-03'));
  assert.deepEqual(warnings.map((w) => w.code), ['conflict_markers']);
});

test('delete: not_found, hito con tareas rechazado, tarea borrada', async () => {
  await assert.rejects(store.delete('tasks', 'nada'), assertStoreError('not_found'));
  await assert.rejects(store.delete('milestones', 'm00'), (e) => e.code === 'conflict' && e.tasks.includes('m0-01'));
  await store.delete('tasks', 'm0-06');
  await assert.rejects(store.get('tasks', 'm0-06'), assertStoreError('not_found'));
  await store.delete('milestones', 'm07');
  assert.ok(!(await store.list('milestones')).items.some((m) => m.id === 'm07'));
});

test('ids y colecciones inválidos se rechazan antes de tocar el disco', async () => {
  for (const id of ['../config', 'a/b', 'A1', '', '.oculto']) {
    await assert.rejects(store.get('tasks', id), assertStoreError('invalid_argument'), id);
  }
  await assert.rejects(store.list('otra'), assertStoreError('invalid_argument'));
});

test('escrituras concurrentes del mismo proceso no se pisan', async () => {
  const ids = ['m1-01', 'm1-02', 'm1-03', 'm1-04'];
  const { etag } = await store.get('tasks', 'm1-05');
  const results = await Promise.allSettled([
    ...ids.map((id) => store.patch('tasks', id, { status: 'review' })),
    store.patch('tasks', 'm1-05', { notes: 'a' }, { ifMatch: etag }),
    store.patch('tasks', 'm1-05', { notes: 'b' }, { ifMatch: etag })
  ]);
  assert.deepEqual(results.map((r) => r.status), ['fulfilled', 'fulfilled', 'fulfilled', 'fulfilled', 'fulfilled', 'rejected']);
  for (const id of ids) assert.equal((await store.get('tasks', id)).doc.status, 'review');
  assert.equal((await store.get('tasks', 'm1-05')).doc.notes, 'a');
});

test('taskIdFor: m<N>-<NN> por hito; otros hitos, aleatorio', async () => {
  const { taskIdFor } = await import('../src/store/json-files.js');
  assert.equal(taskIdFor('m00', ['m0-01', 'm0-10', 'tagr1kge', 'm0-x']), 'm0-11');
  assert.equal(taskIdFor('m10', ['m1-05']), 'm10-01', 'm1- no cuenta para m10');
  assert.equal(taskIdFor('m08', ['m8-99']), 'm8-100');
  assert.equal(taskIdFor('extra', []), null);
  // Un hito con otro tipo de id: aleatorio (el store no exige que el hito exista).
  assert.match((await store.create('tasks', { milestone: 'extra', title: 'x', status: 'todo' })).id, /^[0-9a-z]{8}$/);
});

test('randomId: 8 caracteres base36', () => {
  const ids = new Set(Array.from({ length: 1000 }, randomId));
  assert.equal(ids.size, 1000);
  for (const id of ids) assert.match(id, /^[0-9a-z]{8}$/);
});

test('done_at (18.1): se pone al pasar a Hecho, se conserva mientras sigue hecha y se quita al salir', async () => {
  let t = 0;
  const at = (n) => `2026-10-0${n}T12:00:00.000Z`;
  const s = createJsonFilesStore(compass, { validators: V, now: () => at(++t) });
  const id = 'm0-05';
  // Una hecha de antes del campo (todas las del fixture): editarla no inventa la fecha.
  assert.equal('done_at' in (await s.patch('tasks', id, { notes: 'x' })).doc, false);
  assert.equal('done_at' in (await s.patch('tasks', id, { status: 'todo' })).doc, false);
  assert.equal((await s.patch('tasks', id, { status: 'done' })).doc.done_at, at(3));
  assert.equal((await s.patch('tasks', id, { title: 'Otra' })).doc.done_at, at(3), 'editar una hecha no la mueve');
  const { done_at: _, ...without } = (await s.get('tasks', id)).doc;
  assert.equal((await s.put('tasks', id, without)).doc.done_at, at(3), 'un put sin el campo no lo pierde');
  assert.equal('done_at' in (await s.patch('tasks', id, { status: 'review' })).doc, false);
  assert.equal((await s.patch('tasks', id, { status: 'done' })).doc.done_at, at(7), 'vuelve a Hecho: fecha nueva');
  assert.equal((await s.create('tasks', { milestone: 'm00', title: 'Ya hecha', status: 'done' })).doc.done_at, at(8));
  const old = await s.create('tasks', { milestone: 'm00', title: 'Importada', status: 'done', done_at: '2026-01-01T00:00:00.000Z' });
  assert.equal(old.doc.done_at, '2026-01-01T00:00:00.000Z', 'la que trae el documento se respeta');
});

test('decisiones (§31): la nueva toma at de la escritura, las de antes lo conservan y el schema rechaza lo inválido', async () => {
  let t = 0;
  const at = (n) => `2026-10-0${n}T12:00:00.000Z`;
  const s = createJsonFilesStore(compass, { validators: V, now: () => at(++t) });
  const id = 'm0-05';
  const one = (await s.patch('tasks', id, { decisions: [{ text: 'Usar X', why: 'porque' }] })).doc.decisions;
  assert.deepEqual(one, [{ text: 'Usar X', why: 'porque', at: at(1) }]);
  const two = (await s.patch('tasks', id, { decisions: [{ ...one[0], review: 'ok' }, { text: '¿Y o Z?', asked: true }] })).doc.decisions;
  assert.deepEqual(two.map((d) => d.at), [at(1), at(2)]);
  for (const bad of [{ text: '' }, { text: 'a', asked: false }, { text: 'a', review: 'maybe' }, { text: 'a', promoted: '43' }, { text: 'a', extra: 1 }]) {
    await assert.rejects(s.patch('tasks', id, { decisions: [bad] }), assertStoreError('invalid_argument'), JSON.stringify(bad));
  }
});
