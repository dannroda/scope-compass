// Fecha límite en tareas (8.2, spec §16.5, D26): dueState, CLI con y sin hub, y export markdown.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadValidators, parseDoc } from '../src/schema.js';
import { canonical } from '../src/store/canonical.js';
import { createJsonFilesStore } from '../src/store/json-files.js';
import { createServer, listen } from '../src/server.js';
import { renderMarkdown } from '../src/export-md.js';
import { dueState, parseDue } from '../src/dates.js';
import { run } from '../src/cli.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'compass');
const V = loadValidators();
const NOW = '2026-10-04T12:00:00.000Z';
let root, disk, hubDir, app;

async function project(name, cfgPort) {
  const p = join(root, name);
  await cp(FIXTURE, join(p, 'compass'), { recursive: true });
  const cfgPath = join(p, 'compass', 'config.json');
  await writeFile(cfgPath, canonical({ ...JSON.parse(await readFile(cfgPath, 'utf8')), port: cfgPort }));
  return p;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'scompass-due-'));
  hubDir = await project('con-hub', 1);
  app = createServer({ projectDir: hubDir, store: createJsonFilesStore(join(hubDir, 'compass'), { validators: V, now: () => NOW }) });
  const { port } = await listen(app, 0);
  const cfgPath = join(hubDir, 'compass', 'config.json');
  await writeFile(cfgPath, canonical({ ...JSON.parse(await readFile(cfgPath, 'utf8')), port }));
  disk = await project('sin-hub', 1);
});
afterEach(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
});

async function cli(cwd, argv) {
  let out = '', err = '';
  const code = await run(argv, { cwd, now: () => NOW, out: { write: (s) => { out += s; } }, err: { write: (s) => { err += s; } } });
  return { code, out, err };
}

test('dueState: vencida, hoy o más adelante, en hora local', () => {
  const now = new Date(2026, 9, 4, 15, 0); // 4/10/2026 15:00 local
  assert.equal(dueState('2026-10-03', now), 'overdue');
  assert.equal(dueState('2026-10-04', now), 'today', 'sin hora vence al terminar el día');
  assert.equal(dueState('2026-10-04T14:59', now), 'overdue');
  assert.equal(dueState('2026-10-04T17:30', now), 'today');
  assert.equal(dueState('2026-10-05T00:00', now), 'later');
  assert.equal(dueState('2026-02-30', now), null);
  assert.equal(dueState(undefined, now), null);
  assert.equal(parseDue('2026-10-04T17:30').getHours(), 17);
});

test('schema: due en tareas con el mismo formato que en las listas', () => {
  const t = { milestone: 'm00', title: 'x', status: 'todo' };
  assert.ok(parseDoc(JSON.stringify({ ...t, due: '2026-10-10' }), 'task', V).ok);
  assert.ok(parseDoc(JSON.stringify({ ...t, due: '2026-10-10T09:00' }), 'task', V).ok);
  assert.equal(parseDoc(JSON.stringify({ ...t, due: '10/10/2026' }), 'task', V).ok, false);
});

for (const [name, dir] of [['sin hub', () => disk], ['con hub', () => hubDir]]) {
  test(`CLI ${name}: add y set --due, list y show la muestran, --due "" la quita`, async () => {
    const c = (...a) => cli(dir(), a);
    const add = JSON.parse((await c('add', 'Entregar demo', '--milestone', 'm01', '--due', '2026-10-10', '--json')).out);
    assert.equal(add.due, '2026-10-10');
    let r = await c('add', 'Mal', '--milestone', 'm01', '--due', '2026-02-30');
    assert.equal(r.code, 1);
    assert.match(r.err, /fecha inválida: 2026-02-30/);
    assert.match((await c('list', '--milestone', 'm01')).out, new RegExp(`${add.id}.*Entregar demo  · vence 2026-10-10`));
    assert.equal((await c('set', add.id, '--due', '2026-10-12T18:00')).code, 0);
    assert.match((await c('show', add.id)).out, /· Vence 2026-10-12 18:00/);
    // Una hecha no se marca como vencida.
    assert.equal((await c('set', add.id, '--due', '2020-01-01')).code, 0);
    assert.match((await c('list', '--milestone', 'm01')).out, /vence 2020-01-01 \(vencida\)/);
    await c('move', add.id, 'done');
    assert.match((await c('list', '--milestone', 'm01')).out, /vence 2020-01-01/);
    assert.doesNotMatch((await c('list', '--milestone', 'm01')).out, /vencida/);
    assert.equal((await c('set', add.id, '--due', '')).code, 0);
    assert.equal(JSON.parse((await c('show', add.id, '--json')).out).due, undefined);
  });
}

test('set --due cambia una sola línea del JSON (más updated_at)', async () => {
  const path = join(disk, 'compass', 'tasks', 'm1-04.json');
  const before = (await readFile(path, 'utf8')).split('\n');
  await cli(disk, ['set', 'm1-04', '--due', '2026-10-10']);
  const after = (await readFile(path, 'utf8')).split('\n');
  const added = after.filter((l) => !before.includes(l));
  assert.deepEqual(added.filter((l) => !l.includes('updated_at')), ['  "due": "2026-10-10",']);
});

test('export: "Vence" debajo del título de la tarea', () => {
  const md = renderMarkdown({
    milestones: [['m00', { code: 'M0', order: 0, title: 'Cero' }]],
    tasks: [['a', { milestone: 'm00', title: 'A', code: '0.1', status: 'todo', due: '2026-10-10T17:30' }]]
  }, { title: 'P', date: '2026-01-01' });
  assert.match(md, /### 0\.1 A · Pendiente\n\n\*\*Vence:\*\* 2026-10-10 17:30\n/);
});
