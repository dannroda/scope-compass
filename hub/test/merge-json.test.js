// Merge driver de git para compass/ (spec §44, m7-04): repos de git temporales, dos ramas que tocan la misma tarea.
import './isolate.js';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical } from '../src/store/canonical.js';
import { driverCommand, ensureMergeDriver, merge3 } from '../src/merge-json.js';
import { updateCompass } from '../src/update.js';
import { loadValidators } from '../src/schema.js';
import { loadCompass } from '../src/store/load.js';
import { run } from '../src/cli.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'compass');
const V = loadValidators();
let dir, compass;

// En inglés, para leer los mensajes de git.
const ENV = { ...process.env, LC_ALL: 'C', LANGUAGE: 'C' };
const git = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8', stdio: 'pipe', env: ENV });
const tryGit = (...a) => spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8', env: ENV });
const file = (id) => join(compass, 'tasks', `${id}.json`);
const read = async (id) => JSON.parse(await readFile(file(id), 'utf8'));
const write = async (id, change) => writeFile(file(id), canonical(change(await read(id))));

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'scompass-merge-'));
  compass = join(dir, 'compass');
  await cp(FIXTURE, compass, { recursive: true });
  git('init', '-q', '-b', 'main');
  // Lo que hace init/update: la .gitattributes de la plantilla y el driver en .git/config.
  updateCompass(compass);
  await write('m1-04', (t) => ({ ...t, status: 'doing', checklist: [{ text: 'Primero', done: false }, { text: 'Segundo', done: false }, { text: 'Tercero', done: false }], decisions: [{ text: 'Usar JSON', at: '2026-11-01T10:00:00.000Z' }], updated_at: '2026-11-01T10:00:00.000Z' }));
  git('add', '-A');
  git('commit', '-qm', 'base');
});
afterEach(() => rm(dir, { recursive: true, force: true, maxRetries: 10 }));

// Rama "telefono" desde main con un cambio, main con otro, y merge de telefono en main.
async function branches(ours, theirs) {
  git('checkout', '-qb', 'telefono');
  await theirs();
  git('commit', '-qam', 'telefono');
  git('checkout', '-q', 'main');
  await ours();
  git('commit', '-qam', 'agente');
  return tryGit('merge', '--no-edit', 'telefono');
}

test('init/update registran el driver en el repo de compass/, y .gitattributes lo usa para los JSON', () => {
  assert.equal(git('config', '--get', 'merge.scompass.driver').trim(), driverCommand());
  assert.match(driverCommand(), /"[^"]+" "[^"]+scompass\.js" merge-json %O %A %B %P$/);
  assert.equal(git('check-attr', 'merge', 'compass/tasks/m1-04.json').trim(), 'compass/tasks/m1-04.json: merge: scompass');
  // No pisa un driver ajeno; uno nuestro con otra ruta se pone al día.
  assert.equal(ensureMergeDriver(compass), 'ok');
  git('config', 'merge.scompass.driver', 'otro-programa %A');
  assert.equal(ensureMergeDriver(compass), 'foreign');
  assert.equal(git('config', '--get', 'merge.scompass.driver').trim(), 'otro-programa %A');
  git('config', 'merge.scompass.driver', '"/viejo/scompass" merge-json %O %A %B %P');
  assert.equal(ensureMergeDriver(compass), 'updated');
  assert.equal(git('config', '--get', 'merge.scompass.driver').trim(), driverCommand());
});

test('campos distintos se juntan: el agente tilda pasos y el teléfono aprueba la decisión', async () => {
  const r = await branches(
    () => write('m1-04', (t) => ({ ...t, checklist: t.checklist.map((c, i) => (i === 0 ? { ...c, done: true } : c)), notes: 'avanzando', updated_at: '2026-11-02T10:00:00.000Z' })),
    () => write('m1-04', (t) => ({ ...t, decisions: [{ ...t.decisions[0], review: 'ok' }], priority: 'high', updated_at: '2026-11-03T10:00:00.000Z' })));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const t = await read('m1-04');
  assert.deepEqual(t.checklist.map((c) => c.done), [true, false, false]);
  assert.equal(t.notes, 'avanzando');
  assert.equal(t.decisions[0].review, 'ok');
  assert.equal(t.priority, 'high');
  assert.equal(t.updated_at, '2026-11-03T10:00:00.000Z', 'updated_at: el mayor');
  assert.equal(await readFile(file('m1-04'), 'utf8'), canonical(t), 'formato canónico');
  assert.deepEqual((await loadCompass(compass, V)).warnings, []);
});

test('pasos tildados en los dos lados, pasos y etiquetas agregados en los dos, y uno quitado', async () => {
  const r = await branches(
    () => write('m1-04', (t) => ({ ...t, checklist: [{ text: 'Primero', done: true }, t.checklist[1], { text: 'Tercero', done: true }, { text: 'Del agente', done: false }], tags: ['cli'] })),
    () => write('m1-04', (t) => ({ ...t, checklist: [{ text: 'Primero', done: true }, { text: 'Tercero', done: false }, { text: 'Del teléfono', done: false }], tags: ['ui'] })));
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const t = await read('m1-04');
  // Segundo lo quitó el teléfono; Tercero lo tildó el agente; cada lado agregó uno.
  assert.deepEqual(t.checklist.map((c) => `${c.text}:${c.done}`), ['Primero:true', 'Tercero:true', 'Del agente:false', 'Del teléfono:false']);
  assert.deepEqual(t.tags, ['cli', 'ui']);
});

test('el mismo campo cambiado distinto en los dos lados: conflicto con marcadores, y el store lo marca inválido', async () => {
  const r = await branches(
    () => write('m1-04', (t) => ({ ...t, notes: 'del agente' })),
    () => write('m1-04', (t) => ({ ...t, notes: 'del teléfono' })));
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /CONFLICT.*m1-04\.json/);
  const text = await readFile(file('m1-04'), 'utf8');
  assert.match(text, /^<{7} compass\/tasks\/m1-04\.json \(nuestro\)/m);
  assert.match(text, /del agente[\s\S]*={7}[\s\S]*del teléfono/);
  const { warnings } = await loadCompass(compass, V);
  assert.deepEqual(warnings.map((w) => [w.code, w.path]), [['conflict_markers', 'compass/tasks/m1-04.json']]);
});

test('tarea borrada de un lado y cambiada del otro: el conflicto de siempre de git, sin el driver', async () => {
  const r = await branches(
    () => write('m1-04', (t) => ({ ...t, notes: 'sigue' })),
    async () => { git('rm', '-q', 'compass/tasks/m1-04.json'); });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /CONFLICT \(modify\/delete\)/);
  // Borrada de un lado y sin cambios del otro: se borra.
  git('merge', '--abort');
  git('checkout', '-q', 'telefono');
  git('checkout', '-qb', 'otra', 'main~1');
  assert.equal(tryGit('merge', '--no-edit', 'telefono').status, 0);
  assert.equal(tryGit('ls-files', '--error-unmatch', 'compass/tasks/m1-04.json').status, 1);
});

test('un resultado que no pasa el schema no se acepta: queda el conflicto', async () => {
  // Un lado agrega un campo que el hito no tiene (a mano, sin pasar por el store); el otro, un criterio. Los campos se
  // juntan sin conflicto, pero el resultado no pasa el schema.
  const ms = join(compass, 'milestones', 'm01.json');
  const base = JSON.parse(await readFile(ms, 'utf8'));
  git('checkout', '-qb', 'telefono');
  await writeFile(ms, canonical({ ...base, status: 'raro' }));
  git('commit', '-qam', 't');
  git('checkout', '-q', 'main');
  await writeFile(ms, canonical({ ...base, done_when: [...(base.done_when ?? []), 'Algo más'] }));
  git('commit', '-qam', 'a');
  const r = tryGit('merge', '--no-edit', 'telefono');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /merge-json compass\/milestones\/m01\.json: conflicto en schema: .*status/);
  // Las líneas se juntaron solas (sin marcadores), pero git lo deja en conflicto y el store lo marca inválido.
  assert.match(tryGit('status', '--porcelain').stdout, /^UU compass\/milestones\/m01\.json/m);
  assert.deepEqual((await loadCompass(compass, V)).warnings.map((w) => [w.code, w.path])[0], ['invalid_schema', 'compass/milestones/m01.json']);
});

test('merge3: orden del lado que reordenó, elementos repetidos, base vacía (agregado en los dos lados)', () => {
  const o = { items: [{ task: 'a' }, { task: 'b' }, { task: 'c' }] };
  const reordered = { items: [{ task: 'c' }, { task: 'a' }, { task: 'b' }] };
  const added = { items: [...o.items, { task: 'd' }] };
  assert.deepEqual(merge3(o, added, reordered).value.items.map((x) => x.task), ['c', 'a', 'b', 'd']);
  const steps = (...d) => ({ checklist: d.map((done) => ({ text: 'Igual', done })) });
  assert.deepEqual(merge3(steps(false, false), steps(true, false), steps(false, true)).value, steps(true, true));
  assert.deepEqual(merge3(undefined, { a: 1 }, { b: 2 }).value, { a: 1, b: 2 });
  assert.deepEqual(merge3(undefined, { a: 1 }, { a: 2 }).conflicts, ['a']);
});

test('scompass merge-json: uso, y se corre sin proyecto', async () => {
  let err = '';
  const cli = (...a) => run(a, { cwd: tmpdir(), out: { write() {} }, err: { write: (s) => { err += s; } } });
  assert.equal(await cli('merge-json', 'a'), 2);
  const p = (n) => join(dir, n);
  await writeFile(p('o'), '{"a":1,"b":1}');
  await writeFile(p('a'), '{"a":2,"b":1}');
  await writeFile(p('b'), '{"a":1,"b":3}');
  assert.equal(await cli('merge-json', p('o'), p('a'), p('b')), 0);
  assert.equal(await readFile(p('a'), 'utf8'), canonical({ a: 2, b: 3 }));
});
