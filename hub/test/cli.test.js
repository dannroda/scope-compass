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
  assert.deepEqual((await readdir(join(p, 'compass'))).sort(), ['.gdignore', 'AGENTS.md', 'README.md', 'config.json', 'milestones', 'schema', 'tasks']);
  assert.deepEqual(JSON.parse(await readFile(join(p, 'compass', 'config.json'), 'utf8')), { export_md: 'docs/tareas.md', port: 4711, project: 'Nuevo' });
  assert.equal((await cli(['list', '--json'], { cwd: p })).json().tasks.length, 0);
  assert.equal((await cli(['--dir', p, 'init'])).code, 1);
  // update: recién creada está al día; con el schema y la guía viejos, --check avisa y update los repone
  // sin tocar los datos.
  assert.equal((await cli(['--dir', p, 'update', '--check'])).code, 0);
  await writeFile(join(p, 'compass', 'AGENTS.md'), 'vieja');
  await writeFile(join(p, 'compass', 'schema', 'task.schema.json'), '{}');
  const check = await cli(['--dir', p, 'update', '--check', '--json']);
  assert.equal(check.code, 1);
  assert.deepEqual(check.json().outdated, ['compass/schema/task.schema.json', 'compass/AGENTS.md']);
  assert.deepEqual((await cli(['--dir', p, 'update', '--json'])).json().updated, ['compass/schema/task.schema.json', 'compass/AGENTS.md']);
  assert.equal(await readFile(join(p, 'compass', 'schema', 'task.schema.json'), 'utf8'), await readFile(join(REPO, 'schema', 'task.schema.json'), 'utf8'));
  assert.deepEqual((await cli(['--dir', p, 'update', '--json'])).json().updated, []);
  // La guía para agentes nombra comandos que existen.
  const guide = await readFile(join(p, 'compass', 'AGENTS.md'), 'utf8');
  const help = (await cli(['--help'])).out;
  for (const m of guide.matchAll(/^scompass ([a-z]+)/gm)) assert.ok(help.includes(`\n  ${m[1]} `), `la guía usa un comando que no está en --help: ${m[1]}`);
  assert.equal((await cli(['--dir', join(dir, 'vacio'), 'update'])).code, 1);
  // El addon lleva la misma guía: en un proyecto que solo tiene el plugin, es lo que el agente encuentra.
  assert.equal(await readFile(new URL('../../addons/scope_compass/AGENTS.md', import.meta.url), 'utf8'), guide, 'addons/scope_compass/AGENTS.md no coincide con hub/templates/compass-AGENTS.md');
});

test('link: bloquea, bloqueada por y relacionada; sin ciclos; el inverso se calcula; rotos', async () => {
  const [a, b, c] = ['m1-01', 'm1-02', 'm1-03'];
  for (const id of [a, b, c]) assert.equal((await cli(['move', id, 'todo'])).code, 0);
  assert.equal((await cli(['link', 'add', a, 'blocks', b])).code, 0);
  assert.equal((await cli(['link', 'add', c, 'blocked-by', b])).code, 0);
  // Se guarda en la que bloquea.
  assert.deepEqual((await cli(['show', a, '--json'])).json().links, [{ task: b, type: 'blocks' }]);
  assert.deepEqual((await cli(['show', b, '--json'])).json().links, [{ task: c, type: 'blocks' }]);
  assert.equal((await cli(['show', c, '--json'])).json().links, undefined);
  // c → a cerraría el ciclo a → b → c.
  const cyc = await cli(['link', 'add', c, 'blocks', a]);
  assert.equal(cyc.code, 1);
  assert.match(cyc.err, /ciclo/);
  assert.equal((await cli(['link', 'add', a, 'blocks', a])).code, 1);
  assert.equal((await cli(['link', 'add', a, 'blocks', 'no-existe'])).code, 1);
  assert.equal((await cli(['link', 'add', a, 'related', c])).code, 0);
  assert.deepEqual((await cli(['link', 'list', b, '--json'])).json(), { links: [{ id: b, blocks: [c], blocked_by: [a], related: [] }], broken: [] });
  assert.deepEqual((await cli(['link', 'list', c, '--json'])).json().links[0], { id: c, blocks: [], blocked_by: [b], related: [a] });
  const shown = (await cli(['show', b])).out;
  assert.match(shown, /Bloquea a: m1-03 \(/);
  assert.match(shown, /Bloqueada por: m1-01 \(/);
  assert.match((await cli(['list', '--milestone', 'm01'])).out, /\[bloqueada por m1-01\]/);
  // Una tarea terminada ya no bloquea.
  await cli(['move', a, 'done']);
  assert.doesNotMatch((await cli(['list', '--milestone', 'm01'])).out, /\[bloqueada por m1-01\]/);
  const md = await readFile(join(dir, 'docs', 'tareas.md'), 'utf8');
  assert.match(md, /\*\*Bloqueada por:\*\* /);
  assert.match(md, /\*\*Relacionadas:\*\* /);
  // Un vínculo nuevo entre las mismas dos reemplaza al anterior, esté en la tarea que esté.
  assert.equal((await cli(['link', 'add', c, 'blocked-by', a])).code, 0);
  assert.deepEqual((await cli(['show', a, '--json'])).json().links, [{ task: b, type: 'blocks' }, { task: c, type: 'blocks' }]);
  assert.equal((await cli(['link', 'rm', a, c])).code, 0);
  assert.equal((await cli(['link', 'rm', a, c])).code, 1);
  // Vínculo a una tarea que ya no existe: link list lo avisa y sale con 1; rm lo limpia.
  await rm(join(dir, 'compass', 'tasks', `${c}.json`));
  const broken = await cli(['link', 'list', '--json']);
  assert.equal(broken.code, 1);
  assert.deepEqual(broken.json().broken, [{ id: b, type: 'blocks', task: c }]);
  assert.equal((await cli(['link', 'rm', b, c])).code, 0);
  assert.equal((await cli(['link', 'list'])).code, 0);
});

test('--etag none: set crea solo si no existe', async () => {
  await writeFile(join(dir, 't.json'), JSON.stringify({ milestone: 'm02', title: 'Nueva', status: 'todo' }));
  assert.equal((await cli(['set', 'm2-99', '--file', 't.json', '--etag', 'none'])).code, 0);
  const again = await cli(['set', 'm2-99', '--file', 't.json', '--etag', 'none']);
  assert.equal(again.code, 1);
  assert.match(again.err, /conflict/);
});

test('set con campos sueltos cambia solo esos campos', async () => {
  const before = await task('m1-07');
  const r = await cli(['set', 'm1-07', '--notes', 'nota nueva', '--title', 'Otro título', '--json']);
  assert.equal(r.code, 0, r.err);
  const after = await task('m1-07');
  assert.deepEqual({ ...after, updated_at: 0 }, { ...before, notes: 'nota nueva', title: 'Otro título', updated_at: 0 });
  assert.equal((await cli(['set', 'm1-07', '--status', 'wip'])).code, 2);
  assert.equal((await cli(['set', 'm1-07'])).code, 2, 'sin --file ni campos');
  assert.equal((await cli(['set', 'm1-07', '--file', 'x.json', '--notes', 'n'])).code, 2, 'no se combinan');
  assert.equal((await cli(['set', 'nada', '--notes', 'n'])).code, 1);
});

test('serve --exit-on-stdin-close: se cierra cuando se corta la entrada; sin la opción, no', async () => {
  const { spawn } = await import('node:child_process');
  const bin = join(REPO, 'hub', 'bin', 'scompass.js');
  const start = (extra) => new Promise((resolve) => {
    const p = spawn(process.execPath, [bin, '--dir', dir, 'serve', '--port', '0', ...extra]);
    p.stdout.once('data', () => resolve(p));
  });
  const withFlag = await start(['--exit-on-stdin-close']);
  const t0 = Date.now();
  const code = await new Promise((r) => { withFlag.on('exit', r); withFlag.stdin.end(); });
  assert.equal(code, 0);
  assert.ok(Date.now() - t0 < 2000);

  const without = await start([]);
  without.stdin.end();
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(without.exitCode, null, 'sin la opción sigue corriendo');
  without.kill('SIGTERM');
  assert.equal(await new Promise((r) => without.on('exit', r)), 0);
});

test('step add/set/rm: texto corto y detalle; show imprime el detalle sangrado', async () => {
  assert.equal((await cli(['step', 'add', 'm1-07', 'Acciones de juego', '--detail', 'interact (B / E)\ndodge (B / Espacio)'])).code, 0);
  let steps = (await task('m1-07')).checklist;
  assert.deepEqual(steps.at(-1), { text: 'Acciones de juego', done: false, detail: 'interact (B / E)\ndodge (B / Espacio)' });
  const n = String(steps.length);
  const show = await cli(['show', 'm1-07']);
  assert.match(show.out, new RegExp(`${n}\\. \\[ \\] Acciones de juego\\n {9}interact \\(B / E\\)\\n {9}dodge`));
  assert.equal((await cli(['step', 'set', 'm1-07', n, '--text', 'Acciones'])).code, 0);
  assert.equal((await task('m1-07')).checklist.at(-1).detail, 'interact (B / E)\ndodge (B / Espacio)', 'cambiar el texto conserva el detalle');
  assert.equal((await cli(['step', 'set', 'm1-07', n, '--detail', ''])).code, 0);
  assert.deepEqual((await task('m1-07')).checklist.at(-1), { text: 'Acciones', done: false }, '--detail "" lo quita');
  assert.equal((await cli(['step', 'set', 'm1-07', '99', '--text', 'x'])).code, 1);
  assert.equal((await cli(['step', 'set', 'm1-07', n])).code, 2);
  assert.equal((await cli(['step', 'rm', 'm1-07', n])).code, 0);
  assert.equal((await task('m1-07')).checklist.length, steps.length - 1);
});
