// Criterios de aceptación de v1 (spec §14) que no necesitan el hub, probados como los describe el spec.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadValidators, parseDoc } from '../src/schema.js';
import { canonical } from '../src/store/canonical.js';
import { run } from '../src/cli.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EPIPHANY = join(REPO, '..', 'project-epiphany', 'compass');
const hasGit = (() => { try { execFileSync('git', ['--version']); return true; } catch { return false; } })();
let dir;

async function cli(argv) {
  let out = '', err = '';
  const code = await run(argv, { cwd: dir, out: { write: (s) => { out += s; } }, err: { write: (s) => { err += s; } } });
  return { code, out, err };
}
const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, encoding: 'utf8' });

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'scompass-'));
  await cp(join(REPO, 'compass'), join(dir, 'compass'), { recursive: true });
});
afterEach(() => rm(dir, { recursive: true, force: true }));

test('compass/schema/ es copia exacta de schema/', async () => {
  for (const name of await readdir(join(REPO, 'schema'))) {
    assert.equal(await readFile(join(REPO, 'compass', 'schema', name), 'utf8'), await readFile(join(REPO, 'schema', name), 'utf8'), name);
  }
});

test('§14: import artifact migra los 11 hitos y las 10 tareas de Epiphany sin diferencias', { skip: !existsSync(EPIPHANY) && 'no está project-epiphany' }, async () => {
  const exp = join(dir, 'export');
  for (const c of ['milestones', 'tasks']) {
    await mkdir(join(exp, c), { recursive: true });
    for (const name of await readdir(join(EPIPHANY, c))) {
      const doc = JSON.parse(await readFile(join(EPIPHANY, c, name), 'utf8'));
      if (c === 'tasks') delete doc.created_at;
      await writeFile(join(exp, c, name), JSON.stringify({ ...doc, version: 2 }));
    }
  }
  const p = join(dir, 'epiphany');
  await cp(EPIPHANY, join(p, 'compass'), { recursive: true });
  let out = '';
  const code = await run(['--dir', p, 'import', 'artifact', exp, '--json'], { out: { write: (s) => { out += s; } }, err: { write() {} } });
  assert.equal(code, 0);
  const r = JSON.parse(out);
  assert.equal(r.milestones.unchanged.length, 11);
  assert.equal(r.tasks.unchanged.length, 10);
  for (const c of ['milestones', 'tasks']) {
    for (const name of await readdir(join(EPIPHANY, c))) {
      assert.equal(await readFile(join(p, 'compass', c, name), 'utf8'), await readFile(join(EPIPHANY, c, name), 'utf8'));
    }
  }
});

test('§14: mover una tarjeta cambia un archivo de compass/ y el diff es status + updated_at', { skip: !hasGit && 'sin git' }, async () => {
  await cli(['export', 'md']);
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'base');
  assert.equal((await cli(['move', 'm1-07', 'doing'])).code, 0);
  assert.equal(git('ls-files', '--others', '--exclude-standard'), '');
  const changed = git('diff', '--name-only').trim().split('\n').sort();
  // D13: el export markdown se regenera en la misma escritura.
  assert.deepEqual(changed, ['compass/tasks/m1-07.json', 'docs/tareas.md']);
  const diff = git('diff', '-U0', '--', 'compass/tasks/m1-07.json').split('\n').filter((l) => /^[-+] /.test(l));
  assert.equal(diff.length, 4);
  assert.deepEqual(diff.filter((l) => l.includes('"status"')), ['-  "status": "todo",', '+  "status": "doing",']);
  assert.equal(diff.filter((l) => l.includes('"updated_at"')).length, 2);
});

test('§14: con la app apagada, una edición a mano valida con compass/schema y se ve sin pérdidas', async () => {
  const path = join(dir, 'compass', 'tasks', 'm1-07.json');
  const orig = JSON.parse(await readFile(path, 'utf8'));
  // Edición a mano: otro formato, sin updated_at, un paso nuevo.
  const { updated_at, ...rest } = orig;
  const hand = { ...rest, status: 'review', checklist: [...orig.checklist, { text: 'Paso a mano ñ', done: true }] };
  await writeFile(path, JSON.stringify(hand));

  const fromCopy = loadValidators(join(dir, 'compass', 'schema'));
  assert.equal(parseDoc(await readFile(path, 'utf8'), 'task', fromCopy).ok, true);

  const show = await cli(['show', 'm1-07', '--json']);
  assert.equal(show.code, 0);
  const seen = JSON.parse(show.out);
  assert.equal(seen.status, 'review');
  assert.equal(seen.checklist.at(-1).text, 'Paso a mano ñ');

  // La próxima escritura de la app normaliza el formato sin perder nada.
  assert.equal((await cli(['check', 'm1-07', '1'])).code, 0);
  const after = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(await readFile(path, 'utf8'), canonical(after));
  const { updated_at: u, ...afterRest } = after;
  assert.ok(u);
  assert.deepEqual(afterRest, { ...hand, checklist: hand.checklist.map((c, i) => (i === 0 ? { ...c, done: true } : c)) });
});

test('§14: un archivo con marcadores de conflicto se marca inválido y la CLI no lo sobrescribe', async () => {
  const path = join(dir, 'compass', 'tasks', 'm0-03.json');
  const orig = await readFile(path, 'utf8');
  const merged = orig.replace('  "status": "done",\n', '<<<<<<< HEAD\n  "status": "done",\n=======\n  "status": "doing",\n>>>>>>> rama\n');
  await writeFile(path, merged);
  const list = await cli(['list']);
  assert.equal(list.code, 0);
  assert.match(list.err, /aviso \[conflict_markers\] compass\/tasks\/m0-03\.json/);
  assert.ok(!list.out.includes('m0-03'));
  for (const argv of [['move', 'm0-03', 'todo'], ['check', 'm0-03', '1'], ['show', 'm0-03']]) {
    const r = await cli(argv);
    assert.equal(r.code, 1);
    assert.match(r.err, /invalid_file/);
  }
  assert.equal(await readFile(path, 'utf8'), merged);
});

test('§14: move, check, add y export md funcionan sin servidor y sin red', async () => {
  const add = await cli(['add', 'Sin red', '--milestone', 'm01', '--json']);
  assert.equal(add.code, 0);
  const { id } = JSON.parse(add.out);
  assert.equal((await cli(['move', id, 'doing'])).code, 0);
  assert.equal((await cli(['check', 'm1-07', '2'])).code, 0);
  assert.equal((await cli(['export', 'md'])).code, 0);
  assert.match(await readFile(join(dir, 'docs', 'tareas.md'), 'utf8'), /### Sin red · En curso/);
});
