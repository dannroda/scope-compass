// Lista y filtros (M11, spec §19, D32): reglas de filterTasks, y etiquetas/prioridad/responsable en la CLI con y sin hub.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadValidators } from '../src/schema.js';
import { canonical } from '../src/store/canonical.js';
import { createJsonFilesStore } from '../src/store/json-files.js';
import { createServer, listen } from '../src/server.js';
import { dueMatches, filterTasks } from '../src/filters.js';
import { run } from '../src/cli.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'compass');
const V = loadValidators();

// --- Reglas --------------------------------------------------------------------------------------

// Jueves 8/10/2026, 12:00 hora local.
const now = new Date(2026, 9, 8, 12, 0);
const T = [
  { id: 'a', code: '1.1', title: 'Diseño del nivel', status: 'todo', due: '2026-10-07', tags: ['arte', 'nivel'], priority: 'high', assignee: 'Dani', checklist: [{ text: 'x', done: false }] },
  { id: 'b', code: '1.2', title: 'Audio del menú', status: 'doing', due: '2026-10-08T18:00', tags: ['audio'], priority: 'low', refs: [{ doc: 'gdd.md', section: 's' }], links: [{ type: 'blocks', task: 'c' }] },
  { id: 'c', code: '1.10', title: 'Jefe final', status: 'todo', due: '2026-10-13', assignee: 'claude', checklist: [{ text: 'x', done: true }] },
  { id: 'd', code: '1.3', title: 'Menú de pausa', status: 'done', due: '2026-10-01', links: [{ type: 'blocks', task: 'e' }] },
  { id: 'e', code: '1.4', title: 'Guardado', status: 'review', due: '2026-10-30' }
];
const ids = (f) => filterTasks(T, f, { now }).map((t) => t.id);

test('filtro de texto: todas las palabras, en código, título o id, sin mayúsculas ni tildes', () => {
  assert.deepEqual(ids({ q: 'diseno' }), ['a']);
  assert.deepEqual(ids({ q: 'MENU' }), ['b', 'd']);
  assert.deepEqual(ids({ q: 'menu pausa' }), ['d']);
  assert.deepEqual(ids({ q: '1.10' }), ['c']);
  assert.deepEqual(ids({ q: '  ' }), ['a', 'b', 'c', 'd', 'e']);
});

test('estado, prioridad (con none), responsable (con none, sin mayúsculas) y etiquetas (alguna)', () => {
  assert.deepEqual(ids({ status: ['todo', 'review'] }), ['a', 'c', 'e']);
  assert.deepEqual(ids({ priority: ['high', 'low'] }), ['a', 'b']);
  assert.deepEqual(ids({ priority: ['none'] }), ['c', 'd', 'e']);
  assert.deepEqual(ids({ assignee: ['Claude'] }), ['c']);
  assert.deepEqual(ids({ assignee: ['none'] }), ['b', 'd', 'e']);
  assert.deepEqual(ids({ tags: ['audio', 'nivel'] }), ['a', 'b']);
  assert.deepEqual(ids({ status: [], tags: [], priority: [], assignee: [] }), ['a', 'b', 'c', 'd', 'e'], 'listas vacías no filtran');
});

test('fecha: vencidas, hoy, semana (con las vencidas) y sin fecha; las hechas no vencen', () => {
  assert.deepEqual(ids({ due: 'overdue' }), ['a']);
  assert.deepEqual(ids({ due: 'today' }), ['b']);
  assert.deepEqual(ids({ due: 'week' }), ['a', 'b', 'c']);
  assert.deepEqual(filterTasks([...T, { id: 'f', title: 'f', status: 'todo' }], { due: 'none' }, { now }).map((t) => t.id), ['f']);
  assert.equal(dueMatches({ status: 'todo', due: '2026-10-15T13:00' }, 'week', now), false, '7 días justos ya no');
});

test('bloqueo (por una tarea sin terminar), pasos pendientes y referencias', () => {
  assert.deepEqual(ids({ blocked: true }), ['c'], 'e la bloquea una tarea hecha: no cuenta');
  assert.deepEqual(ids({ blocked: false }), ['a', 'b', 'd', 'e']);
  assert.deepEqual(ids({ pendingSteps: true }), ['a']);
  assert.deepEqual(ids({ withRefs: true }), ['b']);
  assert.deepEqual(ids({ status: ['todo'], blocked: false, priority: ['high'], q: 'nivel' }), ['a'], 'se combinan');
});

// --- CLI ----------------------------------------------------------------------------------------

const NOW = '2026-10-08T12:00:00.000Z';
let root, disk, hubDir, app;

async function project(name) {
  const p = join(root, name);
  await cp(FIXTURE, join(p, 'compass'), { recursive: true });
  const cfgPath = join(p, 'compass', 'config.json');
  await writeFile(cfgPath, canonical({ ...JSON.parse(await readFile(cfgPath, 'utf8')), port: 1 }));
  return p;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'scompass-filters-'));
  disk = await project('sin-hub');
  hubDir = await project('con-hub');
  app = createServer({ projectDir: hubDir, store: createJsonFilesStore(join(hubDir, 'compass'), { validators: V, now: () => NOW }) });
  const { port } = await listen(app, 0);
  const cfgPath = join(hubDir, 'compass', 'config.json');
  await writeFile(cfgPath, canonical({ ...JSON.parse(await readFile(cfgPath, 'utf8')), port }));
});
afterEach(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true, maxRetries: 10 });
});

async function cli(cwd, argv) {
  let out = '', err = '';
  const code = await run(argv, { cwd, now: () => NOW, stdin: Readable.from(['']), out: { write: (s) => { out += s; } }, err: { write: (s) => { err += s; } } });
  return { code, out, err, json: () => JSON.parse(out) };
}
const read = async (p, id) => JSON.parse(await readFile(join(p, 'compass', 'tasks', `${id}.json`), 'utf8'));

for (const where of ['sin-hub', 'con-hub']) {
  test(`CLI ${where}: add y set con etiquetas, prioridad y responsable; "" los quita`, async () => {
    const p = where === 'sin-hub' ? disk : hubDir;
    const r = await cli(p, ['add', 'Sprites del jefe', '--milestone', 'm01', '--tags', 'arte, jefe,arte', '--priority', 'high', '--assignee', ' Dani ', '--json']);
    assert.equal(r.code, 0, r.err);
    const id = r.json().id;
    let t = await read(p, id);
    assert.deepEqual([t.tags, t.priority, t.assignee], [['arte', 'jefe'], 'high', 'Dani']);
    const show = await cli(p, ['show', id]);
    assert.match(show.out, /Prioridad alta · @Dani · #arte #jefe/);
    assert.equal((await cli(p, ['set', id, '--priority', 'urgente'])).code, 2);
    assert.equal((await cli(p, ['set', id, '--tags', 'a,b'])).code, 0);
    assert.deepEqual((await read(p, id)).tags, ['a', 'b']);
    assert.equal((await cli(p, ['set', id, '--tags', '', '--priority', '', '--assignee', ''])).code, 0);
    t = await read(p, id);
    assert.ok(!('tags' in t) && !('priority' in t) && !('assignee' in t), JSON.stringify(t));
  });

  test(`CLI ${where}: list filtra con las opciones de §19 y avisa las inválidas`, async () => {
    const p = where === 'sin-hub' ? disk : hubDir;
    await cli(p, ['set', 'm1-03', '--status', 'doing', '--tags', 'store', '--priority', 'high', '--assignee', 'Claude', '--due', '2026-10-01']);
    await cli(p, ['set', 'm1-04', '--status', 'todo', '--tags', 'cli,store']);
    await cli(p, ['step', 'add', 'm1-04', 'falta esto']);
    await cli(p, ['link', 'add', 'm1-03', 'blocks', 'm1-04']);
    const list = async (...a) => { const r = await cli(p, ['list', '--json', ...a]); assert.equal(r.code, 0, r.err); return r.json().tasks.map((t) => t.id); };
    assert.deepEqual(await list('--tag', 'store'), ['m1-03', 'm1-04']);
    assert.deepEqual(await list('--status', 'doing,todo', '--milestone', 'm01'), ['m1-03', 'm1-04']);
    assert.deepEqual(await list('--priority', 'high'), ['m1-03']);
    assert.deepEqual(await list('--assignee', 'claude'), ['m1-03']);
    assert.deepEqual(await list('--due', 'overdue'), ['m1-03']);
    assert.deepEqual(await list('--blocked'), ['m1-04']);
    assert.deepEqual(await list('--pending-steps'), ['m1-04']);
    assert.deepEqual(await list('--q', 'store json'), ['m1-03']);
    assert.ok((await list('--unblocked', '--milestone', 'm01')).includes('m1-03'));
    const text = await cli(p, ['list', '--tag', 'store']);
    assert.match(text.out, /m1-03 .* · prioridad alta {2}· @Claude {2}· #store/);
    for (const bad of [['--due', 'mañana'], ['--priority', 'urgente'], ['--status', 'doing,wip'], ['--blocked', '--unblocked']]) {
      assert.equal((await cli(p, ['list', ...bad])).code, 2, bad.join(' '));
    }
  });
}
