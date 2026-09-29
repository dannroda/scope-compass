// Tests del dock de Godot (M5): lanza Godot sin ventana con hub/test/godot/runner.gd sobre una copia del fixture.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical } from '../src/store/canonical.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = join(REPO, 'hub', 'test', 'fixtures', 'compass');
const hasGodot = (() => { try { execFileSync('godot', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const skip = !hasGodot && 'sin godot en el PATH';
let dir;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'scompass-dock-'));
  await cp(FIXTURE, join(dir, 'compass'), { recursive: true });
  await setTask('m1-03', { status: 'doing' });
  await setTask('m1-05', { status: 'review' });
});
afterEach(() => rm(dir, { recursive: true, force: true }));

async function setTask(id, changes) {
  const p = join(dir, 'compass', 'tasks', `${id}.json`);
  await writeFile(p, canonical({ ...JSON.parse(await readFile(p, 'utf8')), ...changes }));
}

function godot(...args) {
  return new Promise((resolve) => {
    execFile('godot', ['--headless', '--path', REPO, '--script', 'res://hub/test/godot/runner.gd', '--', ...args],
      { timeout: 60000 }, (err, stdout, stderr) => resolve({ code: err ? err.code ?? 1 : 0, out: stdout + stderr }));
  });
}
const expectOk = (r, name) => assert.ok(r.code === 0 && r.out.includes(`OK ${name}`), r.out.split('\n').filter((l) => /FAIL|ERROR|OK /.test(l)).join('\n') || r.out);

test('sin hub: tareas del primer hito sin terminar, agrupadas por estado, en solo lectura', { skip }, async () => {
  const expected = ['doing:m1-03', 'review:m1-05', 'done:m1-01', 'done:m1-02', 'done:m1-04', 'done:m1-06', 'done:m1-07'];
  expectOk(await godot('offline', dir, 'm01', JSON.stringify(expected)), 'offline');
});

test('elegir un hito lo recuerda y cambia la lista', { skip }, async () => {
  const expected = ['done:m0-01', 'done:m0-02', 'done:m0-03', 'done:m0-04', 'done:m0-05', 'done:m0-06'];
  expectOk(await godot('pick_milestone', dir, 'm00', JSON.stringify(expected)), 'pick_milestone');
});

test('archivo con conflicto: aviso y fuera de la lista; corregido a mano, vuelve al recargar', { skip }, async () => {
  const p = join(dir, 'compass', 'tasks', 'm1-02.json');
  const valid = canonical({ ...JSON.parse(await readFile(p, 'utf8')), status: 'doing' });
  await writeFile(p, '<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> x\n');
  expectOk(await godot('invalid_and_reload', dir, valid), 'invalid_and_reload');
});

test('el pie cuenta los archivos de compass/ sin commitear', { skip }, async () => {
  const git = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]);
  git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'base');
  expectOk(await godot('uncommitted', dir, '0'), 'uncommitted');
  await setTask('m1-01', { status: 'todo' });
  await setTask('m1-02', { status: 'todo' });
  expectOk(await godot('uncommitted', dir, '2'), 'uncommitted');
});
