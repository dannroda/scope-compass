import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findProject, run } from '../src/cli.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = join(REPO, 'hub', 'test', 'fixtures', 'compass');
const NOW = '2026-10-01T12:00:00.000Z';
let dir;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'scompass-'));
  await cp(FIXTURE, join(dir, 'compass'), { recursive: true });
});
afterEach(() => rm(dir, { recursive: true, force: true }));

async function cli(argv, { cwd = dir, stdin = '' } = {}) {
  let out = '', err = '';
  const code = await run(argv, {
    cwd, now: () => NOW, stdin: Readable.from([stdin]),
    out: { write: (s) => { out += s; } }, err: { write: (s) => { err += s; } }
  });
  return { code, out, err, json: () => JSON.parse(out) };
}
const task = async (id) => JSON.parse(await readFile(join(dir, 'compass', 'tasks', `${id}.json`), 'utf8'));

test('findProject sube hasta la carpeta con compass/config.json; --dir manda', async () => {
  await mkdir(join(dir, 'a', 'b'), { recursive: true });
  assert.equal(findProject(join(dir, 'a', 'b')), dir);
  assert.equal(findProject(join(dir, 'a'), '..'), dir);
});

test('list --json: tareas con id y etag, filtros por hito y estado', async () => {
  const r = await cli(['list', '--json', '--milestone', 'm00', '--status', 'done']);
  assert.equal(r.code, 0);
  const { tasks, warnings } = r.json();
  assert.deepEqual(warnings, []);
  assert.ok(tasks.length > 0);
  for (const t of tasks) {
    assert.equal(t.milestone, 'm00');
    assert.equal(t.status, 'done');
    assert.match(t.etag, /^[0-9a-f]{16}$/);
  }
  assert.deepEqual(tasks.map((t) => t.id), [...tasks.map((t) => t.id)].sort());
  assert.equal((await cli(['list', '--status', 'wip'])).code, 2);
});

test('list en texto agrupa por hito', async () => {
  const r = await cli(['list']);
  assert.match(r.out, /M0 · Fundaciones del repo\n {2}m0-01 /);
  assert.ok(r.out.indexOf('M0 ·') < r.out.indexOf('M1 ·'));
});

test('add → move → check → show, escribiendo en compass/', async () => {
  const a = await cli(['add', 'Probar la CLI', '--milestone', 'm01', '--code', '1.8', '--json']);
  assert.equal(a.code, 0, a.err);
  const { id, order } = a.json();
  assert.match(id, /^[0-9a-z]{8}$/);
  assert.equal(order, 8);
  assert.equal((await task(id)).created_at, NOW);

  assert.equal((await cli(['move', id, 'doing'])).code, 0);
  assert.equal((await task(id)).status, 'doing');

  await cli(['set', id, '--file', '-'], { stdin: JSON.stringify({ ...(await task(id)), checklist: [{ text: 'uno', done: false }, { text: 'dos', done: false }] }) });
  assert.equal((await cli(['check', id, '2'])).code, 0);
  assert.deepEqual((await task(id)).checklist.map((c) => c.done), [false, true]);
  assert.equal((await cli(['check', id, '2', '--undo'])).code, 0);
  assert.deepEqual((await task(id)).checklist.map((c) => c.done), [false, false]);
  assert.equal((await cli(['check', id, '3'])).code, 1);

  const s = await cli(['show', id]);
  assert.match(s.out, /^1\.8 Probar la CLI {2}\[/);
  assert.match(s.out, / {3}2\. \[ \] dos/);
});

test('--etag viejo: conflicto con el documento actual en --json y nada escrito', async () => {
  const { etag } = (await cli(['show', 'm1-04', '--json'])).json();
  assert.equal((await cli(['move', 'm1-04', 'doing', '--etag', etag])).code, 0);
  const r = await cli(['move', 'm1-04', 'review', '--etag', etag, '--json']);
  assert.equal(r.code, 1);
  const { error } = JSON.parse(r.err);
  assert.equal(error.code, 'conflict');
  assert.equal(error.current.doc.status, 'doing');
  assert.equal((await task('m1-04')).status, 'doing');
});

test('errores: tarea o hito inexistente, estado inválido, comando desconocido', async () => {
  assert.equal((await cli(['show', 'nada'])).code, 1);
  assert.equal((await cli(['add', 'x', '--milestone', 'm99'])).code, 1);
  assert.equal((await cli(['move', 'm0-01', 'wip'])).code, 2);
  assert.equal((await cli(['volar'])).code, 2);
});

test('set y milestone set validan y no pisan con un documento inválido', async () => {
  const before = await readFile(join(dir, 'compass', 'tasks', 'm0-01.json'), 'utf8');
  await writeFile(join(dir, 'bad.json'), JSON.stringify({ milestone: 'm00', title: 'x', status: 'wip' }));
  const r = await cli(['set', 'm0-01', '--file', 'bad.json']);
  assert.equal(r.code, 1);
  assert.match(r.err, /invalid_argument.*status/);
  assert.equal(await readFile(join(dir, 'compass', 'tasks', 'm0-01.json'), 'utf8'), before);

  await writeFile(join(dir, 'm.json'), JSON.stringify({ code: 'M8', order: 8, title: 'Extra' }));
  assert.equal((await cli(['milestone', 'set', 'm08', '--file', 'm.json'])).code, 0);
  assert.equal((await cli(['milestone', 'show', 'm08', '--json'])).json().title, 'Extra');
  assert.ok((await cli(['milestone', 'list'])).out.includes('m08'));
});

test('init crea un compass/ válido y no pisa uno existente', async () => {
  const p = join(dir, 'nuevo');
  await mkdir(p);
  const r = await cli(['--dir', p, 'init', '--project', 'Nuevo']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual((await readdir(join(p, 'compass'))).sort(), ['.gdignore', 'README.md', 'config.json', 'milestones', 'schema', 'tasks']);
  assert.deepEqual(JSON.parse(await readFile(join(p, 'compass', 'config.json'), 'utf8')), { export_md: 'docs/tareas.md', port: 4711, project: 'Nuevo' });
  assert.equal((await cli(['list', '--json'], { cwd: p })).json().tasks.length, 0);
  assert.equal((await cli(['--dir', p, 'init'])).code, 1);
});
