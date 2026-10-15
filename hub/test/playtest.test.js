// Sesiones de playtest y estado Pausado (M20, D39, D40): schema, CLI con y sin hub, API, watcher, export markdown y la
// migración del formato anterior (resultado y nota en la sesión) a las tareas.
import './isolate.js';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadValidators, parseDoc } from '../src/schema.js';
import { canonical } from '../src/store/canonical.js';
import { createJsonFilesStore } from '../src/store/json-files.js';
import { createServer, listen } from '../src/server.js';
import { renderMarkdown } from '../src/export-md.js';
import { run } from '../src/cli.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'compass');
const V = loadValidators();
const NOW = '2026-10-04T12:00:00.000Z';
let root, disk, hubDir, app, port, events;

async function project(name, cfgPort) {
  const p = join(root, name);
  await cp(FIXTURE, join(p, 'compass'), { recursive: true });
  const cfgPath = join(p, 'compass', 'config.json');
  await writeFile(cfgPath, canonical({ ...JSON.parse(await readFile(cfgPath, 'utf8')), port: cfgPort }));
  // m1-04 y m1-05 en Revisión, para --review.
  const store = createJsonFilesStore(join(p, 'compass'), { validators: V, now: () => NOW });
  for (const id of ['m1-04', 'm1-05']) await store.patch('tasks', id, { status: 'review' });
  return p;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'scompass-playtest-'));
  hubDir = await project('con-hub', 1);
  app = createServer({ projectDir: hubDir, store: createJsonFilesStore(join(hubDir, 'compass'), { validators: V, now: () => NOW }) });
  ({ port } = await listen(app, 0));
  const cfgPath = join(hubDir, 'compass', 'config.json');
  await writeFile(cfgPath, canonical({ ...JSON.parse(await readFile(cfgPath, 'utf8')), port }));
  disk = await project('sin-hub', 1);
  events = [];
  app.events.on('event', (e) => events.push(e));
});
afterEach(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true, maxRetries: 10 });
});

async function cli(cwd, argv) {
  let out = '', err = '';
  const code = await run(argv, { cwd, now: () => NOW, out: { write: (s) => { out += s; } }, err: { write: (s) => { err += s; } } });
  return { code, out, err };
}
const session = async (p, id) => JSON.parse(await readFile(join(p, 'compass', 'playtests', `${id}.json`), 'utf8'));
const task = async (p, id) => JSON.parse(await readFile(join(p, 'compass', 'tasks', `${id}.json`), 'utf8'));

test('schema: estado paused; playtest de la tarea; sesión válida y errores comunes', () => {
  const t = { milestone: 'm00', title: 'T', status: 'paused' };
  assert.equal(parseDoc(JSON.stringify(t), 'task', V).ok, true);
  assert.equal(parseDoc(JSON.stringify({ ...t, playtest: { result: 'fail', note: 'se traba' } }), 'task', V).ok, true);
  for (const playtest of [{}, { result: 'meh' }, { note: '' }, { result: 'pass', extra: 1 }]) {
    assert.equal(parseDoc(JSON.stringify({ ...t, playtest }), 'task', V).ok, false, JSON.stringify(playtest));
  }
  const ok = { title: 'Build 0.3', order: 1, items: [{ task: 'm1-04' }, { task: 'm1-05' }] };
  assert.equal(parseDoc(JSON.stringify(ok), 'playtest', V).ok, true);
  // El resultado ya no va en la sesión (D40).
  for (const bad of [{ ...ok, items: [{ task: 'm1-04', result: 'pass' }] }, { ...ok, items: [{ task: 'm1-04', note: 'x' }] }, { ...ok, items: [{}] }, { title: 'X', order: 1 }]) {
    assert.equal(parseDoc(JSON.stringify(bad), 'playtest', V).ok, false, JSON.stringify(bad));
  }
});

test('CLI sin hub: Pausado, crear con --review, agregar, mover, anda/falla con nota, reset, sacar y borrar', async () => {
  const c = (...a) => cli(disk, a);
  assert.equal((await c('move', 'm1-06', 'paused')).out, 'm1-06 → Pausado\n');
  assert.match((await c('list', '--status', 'paused')).out, /m1-06 .*Pausado/);

  const made = await c('playtest', 'new', 'Build 0.3', '--review');
  assert.equal(made.code, 0, made.err);
  assert.match(made.out, /Creada la sesión build-0-3: Build 0\.3 \(2 tareas\)/);
  assert.deepEqual((await session(disk, 'build-0-3')).items, [{ task: 'm1-04' }, { task: 'm1-05' }]);

  // Las que ya están no se repiten; --at las pone desde esa posición.
  assert.equal((await c('playtest', 'add', 'build-0-3', 'm1-07', 'm1-04', '--at', '1')).code, 0);
  assert.deepEqual((await session(disk, 'build-0-3')).items.map((x) => x.task), ['m1-07', 'm1-04', 'm1-05']);
  assert.match((await c('playtest', 'add', 'build-0-3', '--review')).out, /nada nuevo/);
  assert.equal((await c('playtest', 'add', 'build-0-3', 'zz-99')).code, 1, 'tarea que no existe');

  // Por id o por número.
  assert.equal((await c('playtest', 'move', 'build-0-3', 'm1-07', '3')).code, 0);
  assert.deepEqual((await session(disk, 'build-0-3')).items.map((x) => x.task), ['m1-04', 'm1-05', 'm1-07']);
  assert.equal((await c('playtest', 'fail', 'build-0-3', '1', '--note', 'se traba al saltar')).code, 0);
  assert.equal((await c('playtest', 'pass', 'build-0-3', 'm1-05')).code, 0);
  // Se guarda en la tarea; la sesión solo ordena.
  assert.deepEqual((await task(disk, 'm1-04')).playtest, { result: 'fail', note: 'se traba al saltar' });
  assert.deepEqual((await task(disk, 'm1-05')).playtest, { result: 'pass' });
  let s = await session(disk, 'build-0-3');
  assert.deepEqual(s.items, [{ task: 'm1-04' }, { task: 'm1-05' }, { task: 'm1-07' }]);

  const shown = await c('playtest', 'show', 'build-0-3');
  assert.match(shown.out, /1\. \[✗\] m1-04 \(1\.4 CLI básica\) · Revisión\n {8}se traba al saltar/);
  assert.match(shown.out, /2\. \[✓\] m1-05/);
  assert.match((await c('playtest')).out, /build-0-3 +Build 0\.3 {2}1 de 3 sin probar · 1 falla/);
  // Otra sesión con la misma tarea ve lo mismo.
  assert.equal((await c('playtest', 'new', 'Otra pasada')).code, 0);
  assert.equal((await c('playtest', 'add', 'otra-pasada', 'm1-04')).code, 0);
  assert.match((await c('playtest', 'show', 'otra-pasada')).out, /1\. \[✗\] m1-04 .*\n {8}se traba al saltar/);
  assert.equal((await c('playtest', 'rm', 'otra-pasada')).code, 0);

  // reset conserva la nota; pass con --note "" la quita.
  assert.equal((await c('playtest', 'reset', 'build-0-3', '1')).code, 0);
  assert.deepEqual((await task(disk, 'm1-04')).playtest, { note: 'se traba al saltar' });
  assert.equal((await c('playtest', 'pass', 'build-0-3', '1', '--note', '')).code, 0);
  assert.deepEqual((await task(disk, 'm1-04')).playtest, { result: 'pass' });
  // Sin resultado ni nota, el campo se va.
  assert.equal((await c('playtest', 'reset', 'build-0-3', '1')).code, 0);
  assert.equal((await task(disk, 'm1-04')).playtest, undefined);
  assert.equal((await c('playtest', 'pass', 'build-0-3', '1')).code, 0);

  assert.equal((await c('playtest', 'drop', 'build-0-3', 'm1-05')).code, 0);
  s = await session(disk, 'build-0-3');
  assert.deepEqual(s.items.map((x) => x.task), ['m1-04', 'm1-07']);
  assert.equal((await c('playtest', 'pass', 'build-0-3', '9')).code, 1);
  assert.equal((await c('playtest', 'move', 'build-0-3', '1', '5')).code, 1);

  // La sesión entra en el export; las tareas no se tocan al borrarla.
  assert.match(await readFile(join(disk, 'docs', 'tareas.md'), 'utf8'), /## Playtest\n\n### Build 0\.3  \(1\/2 probadas\)/);
  assert.equal((await c('playtest', 'rm', 'build-0-3')).code, 0);
  assert.equal((await c('playtest', '--json')).out, '{"playtests":[],"warnings":[]}\n');
});

test('CLI con hub: las sesiones pasan por la API, se publican y quedan igual que sin hub', async () => {
  for (const p of [hubDir, disk]) {
    const c = (...a) => cli(p, a);
    assert.equal((await c('playtest', 'new', 'Build 0.3', '--review', '--milestone', 'm01')).code, 0);
    assert.equal((await c('playtest', 'add', 'build-0-3', 'm1-07', '--at', '2')).code, 0);
    assert.equal((await c('playtest', 'fail', 'build-0-3', 'm1-07', '--note', 'no carga')).code, 0);
  }
  const ups = events.filter((e) => e.type === 'upsert' && e.collection === 'playtests');
  assert.equal(ups.length, 2);
  assert.deepEqual(ups.at(-1).doc.items[1], { task: 'm1-07' });
  assert.deepEqual(events.filter((e) => e.type === 'upsert' && e.collection === 'tasks' && e.id === 'm1-07').at(-1).doc.playtest, { result: 'fail', note: 'no carga' });
  for (const f of ['playtests/build-0-3.json', 'tasks/m1-07.json']) {
    const [a, b] = await Promise.all([hubDir, disk].map((p) => readFile(join(p, 'compass', f), 'utf8')));
    assert.equal(a, b, f);
  }
  assert.equal((await cli(hubDir, ['playtest', 'rm', 'build-0-3'])).code, 0);
  assert.ok(events.some((e) => e.type === 'delete' && e.collection === 'playtests' && e.id === 'build-0-3'));
});

test('API: crear con tareas, id del título, tarea inexistente, PATCH con etag y orden', async () => {
  const base = `http://127.0.0.1:${port}/api/playtests`;
  const post = (body) => fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let r = await post({ title: 'Revisión', tasks: ['m1-05', 'm1-04', 'm1-05'] });
  assert.equal(r.status, 201);
  const first = await r.json();
  assert.equal(first.id, 'revision');
  assert.deepEqual(first.items, [{ task: 'm1-05' }, { task: 'm1-04' }]);
  assert.equal((await (await post({ title: 'Revisión' })).json()).id, 'revision-2');
  assert.equal((await post({ title: 'X', tasks: ['zz-99'] })).status, 404);
  assert.equal((await post({ title: ' ' })).status, 400);
  const patch = (etag, body) => fetch(`${base}/revision`, { method: 'PATCH', headers: { 'content-type': 'application/json', 'if-match': `"${etag}"` }, body: JSON.stringify(body) });
  r = await patch(first.etag, { items: [{ task: 'm1-04' }, { task: 'm1-05' }] });
  assert.equal(r.status, 200);
  assert.equal((await patch(first.etag, { items: [] })).status, 409, 'etag viejo');
  assert.equal((await patch((await r.json()).etag, { items: [{ task: 'm1-04', result: 'pass' }] })).status, 400, 'el resultado va en la tarea');
  // En la tarea: PATCH { playtest }, y null lo quita.
  const tpatch = (body) => fetch(`http://127.0.0.1:${port}/api/tasks/m1-04`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.deepEqual((await (await tpatch({ playtest: { result: 'pass', note: 'ok' } })).json()).playtest, { result: 'pass', note: 'ok' });
  assert.equal((await (await tpatch({ playtest: null })).json()).playtest, undefined);
  const all = await (await fetch(base)).json();
  assert.deepEqual(all.playtests.map((p) => p.id), ['revision', 'revision-2']);
  assert.equal((await fetch(`${base}/revision-2`, { method: 'DELETE' })).status, 204);
  // El estado nuevo se filtra como los demás.
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/tasks?status=paused`)).status, 200);
});

test('watcher: una sesión editada a mano se publica; una inválida avisa', async () => {
  const w = createServer({ projectDir: disk, store: createJsonFilesStore(join(disk, 'compass'), { validators: V }), validators: V, watch: true });
  const seen = [];
  w.events.on('event', (e) => seen.push(e));
  await listen(w, 0);
  try {
    await mkdir(join(disk, 'compass', 'playtests'), { recursive: true });
    await writeFile(join(disk, 'compass', 'playtests', 'build.json'), canonical({ title: 'Build', order: 1, items: [{ task: 'm1-04' }] }));
    for (let i = 0; i < 100 && !seen.some((e) => e.collection === 'playtests'); i++) await new Promise((r) => setTimeout(r, 20));
    assert.ok(seen.some((e) => e.type === 'upsert' && e.collection === 'playtests' && e.id === 'build'));
    await writeFile(join(disk, 'compass', 'playtests', 'build.json'), '{ roto');
    for (let i = 0; i < 100 && !seen.some((e) => e.type === 'warning'); i++) await new Promise((r) => setTimeout(r, 20));
    assert.ok(seen.some((e) => e.type === 'warning' && e.path === 'compass/playtests/build.json'));
  } finally {
    await w.close();
  }
});

test('export: Pausado como estado; sin sesiones no cambia nada; con sesiones, una sección al final', () => {
  const base = { milestones: [['m00', { code: 'M0', order: 0, title: 'Cero' }]], tasks: [['t1', { milestone: 'm00', title: 'T', code: '0.1', status: 'paused' }]] };
  const opts = { title: 'P', date: '2026-01-01' };
  assert.match(renderMarkdown(base, opts), /### 0\.1 T · Pausado/);
  assert.equal(renderMarkdown({ ...base, playtests: [] }, opts), renderMarkdown(base, opts));
  const tasks = [['t1', { ...base.tasks[0][1], playtest: { result: 'fail', note: 'se traba\n# en la cueva' } }]];
  const md = renderMarkdown({ ...base, tasks, playtests: [['b', { title: 'Build', order: 1, items: [{ task: 't1' }, { task: 'zz' }] }]] }, opts);
  // Una nota de varios renglones sigue sangrada debajo del ítem (y un # no se vuelve encabezado).
  assert.ok(md.endsWith('## Playtest\n\n### Build  (1/2 probadas)\n\n1. [ ] 0.1 T · Pausado · **falla** — se traba\n   \\# en la cueva\n2. [ ] zz (no existe)\n'), md);
});

test('migrate: del formato anterior a las tareas; gana la sesión más reciente y las notas se juntan', async () => {
  const dir = join(disk, 'compass', 'playtests');
  await mkdir(dir, { recursive: true });
  const old = (title, updated_at, items) => writeFile(join(dir, `${title}.json`), canonical({ title, order: 1, items, created_at: updated_at, updated_at }));
  await old('vieja', '2026-10-01T10:00:00.000Z', [{ task: 'm1-04', result: 'pass', note: 'anda bien' }, { task: 'm1-05', result: 'pass' }, { task: 'zz-99', result: 'fail' }]);
  await old('nueva', '2026-10-03T10:00:00.000Z', [{ task: 'm1-04', result: 'fail', note: 'en la cueva falla' }, { task: 'm1-05' }, { task: 'm1-07', note: 'sin probar todavía' }]);
  // Lo que la tarea ya tenía se respeta.
  await createJsonFilesStore(join(disk, 'compass'), { validators: V }).patch('tasks', 'm1-07', { playtest: { result: 'pass' } });
  const listed = await cli(disk, ['playtest']);
  assert.match(listed.err, /scompass playtest migrate/);

  const r = await cli(disk, ['playtest', 'migrate']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Sesiones pasadas al formato nuevo: vieja, nueva/);
  assert.match(r.out, /ya no existen .*zz-99/);
  assert.deepEqual((await task(disk, 'm1-04')).playtest, { result: 'fail', note: 'anda bien\nen la cueva falla' });
  assert.deepEqual((await task(disk, 'm1-05')).playtest, { result: 'pass' }, 'la nueva no la probó: queda la vieja');
  assert.deepEqual((await task(disk, 'm1-07')).playtest, { result: 'pass', note: 'sin probar todavía' });
  assert.deepEqual((await session(disk, 'nueva')).items, [{ task: 'm1-04' }, { task: 'm1-05' }, { task: 'm1-07' }]);
  assert.equal((await session(disk, 'nueva')).updated_at, '2026-10-03T10:00:00.000Z');
  assert.doesNotMatch((await cli(disk, ['playtest'])).err, /aviso/);
  assert.match((await cli(disk, ['playtest', 'migrate'])).out, /No hay sesiones del formato anterior/);
});
