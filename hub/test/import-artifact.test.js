import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadValidators } from '../src/schema.js';
import { importArtifact } from '../src/import-artifact.js';
import { canonical } from '../src/store/canonical.js';
import { run } from '../src/cli.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = join(REPO, 'hub', 'test', 'fixtures', 'compass');
const V = loadValidators();
let dir, exp;

// Un export como el de ArtifactData: con `version` e `id`, sin `created_at`.
async function makeExport(from, to) {
  for (const c of ['milestones', 'tasks']) {
    await mkdir(join(to, c), { recursive: true });
    for (const name of await readdir(join(from, c))) {
      const doc = JSON.parse(await readFile(join(from, c, name), 'utf8'));
      delete doc.created_at;
      await writeFile(join(to, c, name), JSON.stringify({ ...doc, id: name.slice(0, -5), version: 3 }, null, 4));
    }
  }
}
const read = async (c, id, base = join(dir, 'compass')) => JSON.parse(await readFile(join(base, c, `${id}.json`), 'utf8'));
const quiet = { out: { write() {} }, err: { write() {} } };

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'scompass-'));
  exp = join(dir, 'export');
  await makeExport(FIXTURE, exp);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

test('import en un compass/ vacío: canónico, sin version, created_at = updated_at', async () => {
  const target = join(dir, 'nuevo');
  const r = await importArtifact(exp, target, { validators: V });
  assert.equal(r.milestones.created.length, 8);
  assert.equal(r.tasks.created.length, 13);
  assert.deepEqual(r.warnings, []);
  for (const id of r.tasks.created) {
    const t = await read('tasks', id, target);
    const orig = await read('tasks', id, FIXTURE);
    assert.ok(!('version' in t) && !('id' in t));
    assert.equal(t.created_at, t.updated_at);
    assert.deepEqual({ ...t, created_at: orig.created_at }, orig);
  }
  const text = await readFile(join(target, 'tasks', 'm0-01.json'), 'utf8');
  assert.equal(text, canonical(JSON.parse(text)));
});

test('reimportar los mismos datos: todo sin cambios y se conserva created_at', async () => {
  await cp(FIXTURE, join(dir, 'compass'), { recursive: true });
  const r = await importArtifact(exp, join(dir, 'compass'), { validators: V });
  assert.equal(r.milestones.unchanged.length, 8);
  assert.equal(r.tasks.unchanged.length, 13);
  assert.deepEqual([...r.tasks.created, ...r.tasks.updated, ...r.tasks.different, ...r.tasks.invalid], []);
});

test('un documento distinto no se pisa sin overwrite; con overwrite se actualiza', async () => {
  await cp(FIXTURE, join(dir, 'compass'), { recursive: true });
  const t = JSON.parse(await readFile(join(exp, 'tasks', 'm1-07.json'), 'utf8'));
  await writeFile(join(exp, 'tasks', 'm1-07.json'), JSON.stringify({ ...t, status: 'review' }));
  const before = await read('tasks', 'm1-07');

  const dry = await importArtifact(exp, join(dir, 'compass'), { validators: V, overwrite: true, dryRun: true });
  assert.deepEqual(dry.tasks.updated, ['m1-07']);
  assert.deepEqual(await read('tasks', 'm1-07'), before);

  const r = await importArtifact(exp, join(dir, 'compass'), { validators: V });
  assert.deepEqual(r.tasks.different, ['m1-07']);
  assert.deepEqual(await read('tasks', 'm1-07'), before);

  const o = await importArtifact(exp, join(dir, 'compass'), { validators: V, overwrite: true });
  assert.deepEqual(o.tasks.updated, ['m1-07']);
  const after = await read('tasks', 'm1-07');
  assert.equal(after.status, 'review');
  assert.equal(after.created_at, before.created_at);
});

test('documentos inválidos, destino con conflicto y hito inexistente se reportan', async () => {
  await cp(FIXTURE, join(dir, 'compass'), { recursive: true });
  await writeFile(join(exp, 'tasks', 'mala.json'), JSON.stringify({ milestone: 'm00', title: 'x', status: 'wip' }));
  await writeFile(join(exp, 'tasks', 'rota.json'), '{');
  await writeFile(join(exp, 'tasks', 'huerfana.json'), JSON.stringify({ milestone: 'm99', title: 'x', status: 'todo' }));
  const conflict = '<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> x\n';
  await writeFile(join(dir, 'compass', 'tasks', 'm0-02.json'), conflict);

  const r = await importArtifact(exp, join(dir, 'compass'), { validators: V });
  assert.deepEqual(r.tasks.invalid.sort(), ['m0-02', 'mala', 'rota']);
  assert.deepEqual(r.tasks.created, ['huerfana']);
  assert.ok(r.warnings.some((w) => w.path === 'tasks/huerfana.json' && /m99/.test(w.message)));
  assert.equal(await readFile(join(dir, 'compass', 'tasks', 'm0-02.json'), 'utf8'), conflict);
});

test('CLI: init + import artifact migra, exporta el markdown y sale con 0', async () => {
  const p = join(dir, 'proyecto');
  await mkdir(p);
  assert.equal(await run(['import', 'artifact', exp], { cwd: p, ...quiet }), 1, 'sin init falla');
  assert.equal(await run(['init', '--project', 'Migrado'], { cwd: p, ...quiet }), 0);
  let out = '';
  const code = await run(['import', 'artifact', exp, '--json'], { cwd: p, out: { write: (s) => { out += s; } }, err: quiet.err });
  assert.equal(code, 0);
  assert.equal(JSON.parse(out).tasks.created.length, 13);
  assert.match(await readFile(join(p, 'docs', 'tareas.md'), 'utf8'), /^# Tareas — Migrado\n/);
  assert.equal(await run(['import', 'artifact', exp], { cwd: p, ...quiet }), 0, 'reimportar no cambia nada');
});
