// Inicio (8.8, spec §16.2, D24): resumen y "Hoy" de todos los proyectos, escrituras por el hub o directo,
// cambios en vivo desde los hubs, y un solo Inicio por usuario.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadValidators } from '../src/schema.js';
import { canonical } from '../src/store/canonical.js';
import { createJsonFilesStore } from '../src/store/json-files.js';
import { createServer, listen } from '../src/server.js';
import { createHomeServer } from '../src/home.js';
import { recordProject } from '../src/projects.js';
import { liveHome, registerHub, unregisterHub } from '../src/registry.js';
import { summarize, todayOf } from '../src/summary.js';
import { run } from '../src/cli.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'compass');
const V = loadValidators();
const TODAY = new Date(2026, 9, 4, 12, 0); // 4/10/2026 12:00 local
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let root, saved, hubApp, hubPort, home, homePort, a, b;

async function project(name, lists) {
  const p = join(root, name);
  await cp(FIXTURE, join(p, 'compass'), { recursive: true });
  for (const [id, doc] of Object.entries(lists)) {
    const store = createJsonFilesStore(join(p, 'compass'), { validators: V });
    await store.put('lists', id, doc, { ifMatch: null });
  }
  return p;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'scompass-home-'));
  saved = { reg: process.env.SCOMPASS_REGISTRY, cfg: process.env.SCOMPASS_CONFIG };
  process.env.SCOMPASS_REGISTRY = join(root, 'registro');
  process.env.SCOMPASS_CONFIG = join(root, 'config');
  // a: con hub. b: sin hub, con un ítem mensual vencido.
  a = await project('a', { compras: { title: 'Compras', order: 1, items: [{ text: 'Yerba', done: false }, { text: 'Pagar la luz', done: false, due: '2026-10-04' }] } });
  b = await project('b', { pendientes: { title: 'Pendientes', order: 1, items: [{ text: 'Gas', done: false, due: '2026-09-10', repeat: { every: 'month' } }] } });
  hubApp = createServer({ projectDir: a, store: createJsonFilesStore(join(a, 'compass'), { validators: V }), validators: V });
  ({ port: hubPort } = await listen(hubApp, 0));
  const cfg = join(a, 'compass', 'config.json');
  await writeFile(cfg, canonical({ ...JSON.parse(await readFile(cfg, 'utf8')), port: hubPort }));
  // Otro pid vivo (el del padre): el de este proceso lo usa el Inicio de la CLI en el último test.
  registerHub({ port: hubPort, project: a, pid: process.ppid });
  await recordProject(a);
  await recordProject(b);
  home = createHomeServer({ validators: V, now: () => TODAY, pollMs: 50 });
  ({ port: homePort } = await listen(home, 0));
});
afterEach(async () => {
  await home.close();
  await hubApp.close();
  unregisterHub(process.ppid);
  for (const [k, v] of [['SCOMPASS_REGISTRY', saved.reg], ['SCOMPASS_CONFIG', saved.cfg]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(root, { recursive: true, force: true, maxRetries: 10 });
});

const api = async (method, path, body) => {
  const r = await fetch(`http://127.0.0.1:${homePort}${path}`, { method, ...(body && { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  return { status: r.status, body: await r.json() };
};

test('summarize: hito actual, en curso, lo que sigue y listas', async () => {
  const { loadCompass } = await import('../src/store/load.js');
  const s = summarize(await loadCompass(join(a, 'compass'), V), TODAY);
  assert.ok(s.milestone && s.milestone.total > 0);
  assert.ok(s.next.length <= 3);
  assert.deepEqual(s.lists, [{ id: 'compras', title: 'Compras', left: 2, total: 2, today: 1, overdue: 0 }]);
  const empty = summarize({ milestones: new Map(), tasks: new Map(), lists: new Map() }, TODAY);
  assert.deepEqual(empty, { milestone: null, counts: { todo: 0, doing: 0, review: 0, done: 0 }, doing: [], next: [], lists: [], done_week: 0 });
  // Terminadas en los últimos 7 días (18.1): por done_at; sin el campo no cuentan.
  const day = (n) => new Date(TODAY.getTime() - n * 864e5).toISOString();
  const week = summarize({ milestones: new Map(), lists: new Map(), tasks: new Map([
    ['a', { milestone: 'm00', title: 'a', status: 'done', done_at: day(1) }], ['b', { milestone: 'm00', title: 'b', status: 'done', done_at: day(8) }],
    ['c', { milestone: 'm00', title: 'c', status: 'done' }], ['d', { milestone: 'm00', title: 'd', status: 'doing' }]]) }, TODAY);
  assert.equal(week.done_week, 1);
  // Fecha objetivo del hito actual (18.2).
  const late = summarize({ lists: new Map(), milestones: new Map([['m00', { code: 'M0', order: 0, title: 'Cero', due: '2020-01-01' }]]),
    tasks: new Map([['a', { milestone: 'm00', title: 'a', status: 'todo' }]]) }, TODAY);
  assert.deepEqual([late.milestone.due, late.milestone.due_state], ['2020-01-01', 'overdue']);
});

test('todayOf: vencido antes que hoy, y las tareas en curso al final', () => {
  const all = {
    milestones: new Map([['m00', { code: 'M0', order: 0, title: 'Cero' }]]),
    tasks: new Map([['t1', { milestone: 'm00', title: 'En curso', status: 'doing' }], ['t2', { milestone: 'm00', title: 'Hecha', status: 'done', due: '2026-10-01' }], ['t3', { milestone: 'm00', title: 'Vence', status: 'todo', due: '2026-10-04' }]]),
    lists: new Map([['l', { title: 'L', order: 1, items: [{ text: 'Vencido', done: false, due: '2026-10-01' }, { text: 'Mañana', done: false, due: '2026-10-05' }, { text: 'Tildado', done: true, due: '2026-10-01' }] }]])
  };
  assert.deepEqual(todayOf(all, TODAY).map((x) => x.text), ['Vencido', 'Vence', 'En curso']);
});

test('GET /api/projects: los dos proyectos, con el estado de su hub y su resumen', async () => {
  const { body } = await api('GET', '/api/projects');
  assert.deepEqual(body.projects.map((p) => [p.path, p.hubs.map((h) => h.port)]), [[a, [hubPort]], [b, []]]);
  assert.equal(body.projects[1].summary.lists[0].overdue, 1);
});

test('GET /api/today junta lo de todos los proyectos', async () => {
  const { body } = await api('GET', '/api/today');
  const items = body.items.filter((x) => x.kind === 'item');
  assert.deepEqual(items.map((x) => [x.project.path, x.text, x.due_state]), [[b, 'Gas', 'overdue'], [a, 'Pagar la luz', 'today']]);
});

test('check-item con hub pasa por el hub; sin hub escribe directo y avanza lo que se repite', async () => {
  const hubEvents = [];
  hubApp.events.on('event', (e) => hubEvents.push(e));
  let r = await api('POST', '/api/projects/check-item', { path: a, list: 'compras', n: 2 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.via, 'hub');
  assert.equal(r.body.list.items[1].done, true);
  assert.ok(hubEvents.some((e) => e.type === 'upsert' && e.collection === 'lists'), 'el hub lo publicó');
  r = await api('POST', '/api/projects/check-item', { path: b, list: 'pendientes', n: 1 });
  assert.equal(r.body.via, 'disk');
  assert.equal(r.body.advanced, true);
  const disk = JSON.parse(await readFile(join(b, 'compass', 'lists', 'pendientes.json'), 'utf8'));
  assert.deepEqual([disk.items[0].done, disk.items[0].due], [false, '2026-10-10']);
  assert.match(await readFile(join(b, 'docs', 'tareas.md'), 'utf8'), /Gas · vence 2026-10-10/, 'regenera el export');
  // Etag viejo: conflicto con el estado actual.
  r = await api('POST', '/api/projects/check-item', { path: b, list: 'pendientes', n: 1, etag: 'viejo' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.current.items[0].due, '2026-10-10');
});

test('move-task y los límites: proyecto desconocido, ítem o estado inválidos', async () => {
  const { body: { tasks } } = await fetch(`http://127.0.0.1:${hubPort}/api/tasks`).then(async (x) => ({ body: await x.json() }));
  const t = tasks[0];
  const to = t.status === 'doing' ? 'review' : 'doing';
  let r = await api('POST', '/api/projects/move-task', { path: a, id: t.id, status: to, etag: t.etag });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.task.status, to);
  assert.equal((await api('POST', '/api/projects/move-task', { path: a, id: t.id, status: 'done', etag: t.etag })).status, 409, 'etag viejo');
  assert.equal((await api('POST', '/api/projects/move-task', { path: a, id: t.id, status: 'wip' })).status, 400);
  assert.equal((await api('POST', '/api/projects/move-task', { path: join(root, 'otro'), id: t.id, status: 'done' })).status, 404);
  assert.equal((await api('POST', '/api/projects/check-item', { path: a, list: 'compras', n: 9 })).status, 400);
});

test('importar y quitar proyectos', async () => {
  const c = await project('c', {});
  let r = await api('POST', '/api/projects', { path: c });
  assert.equal(r.status, 201);
  assert.equal((await api('POST', '/api/projects', { path: c })).status, 200, 'ya estaba');
  assert.equal((await api('POST', '/api/projects', { path: join(root, 'nada') })).status, 404);
  assert.equal((await api('GET', '/api/projects')).body.projects.length, 3);
  r = await api('DELETE', `/api/projects?path=${encodeURIComponent(c)}`);
  assert.equal(r.status, 200);
  assert.equal((await api('GET', '/api/projects')).body.projects.length, 2);
});

test('WebSocket: reenvía los cambios de los hubs y avisa cuando cambian los hubs vivos', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${homePort}/ws`);
  const got = [];
  ws.addEventListener('message', (m) => got.push(JSON.parse(m.data)));
  await new Promise((r) => ws.addEventListener('open', r));
  await sleep(150); // que el Inicio se suscriba al hub de a
  await fetch(`http://127.0.0.1:${hubPort}/api/lists/compras`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Súper' }) });
  for (let i = 0; i < 40 && !got.some((e) => e.type === 'changed'); i++) await sleep(25);
  assert.ok(got.some((e) => e.type === 'changed' && e.path === a && e.collection === 'lists' && e.id === 'compras'), JSON.stringify(got));
  // Sin hub: una escritura del Inicio también avisa.
  await api('POST', '/api/projects/check-item', { path: b, list: 'pendientes', n: 1 });
  assert.ok(got.some((e) => e.type === 'changed' && e.path === b));
  // El hub de a se va del registro: aviso de hubs.
  got.length = 0;
  unregisterHub(process.ppid);
  for (let i = 0; i < 40 && !got.some((e) => e.type === 'hubs'); i++) await sleep(25);
  assert.ok(got.some((e) => e.type === 'hubs'));
  ws.close();
});

test('CLI: un solo Inicio por usuario', async () => {
  let out = '', err = '';
  const ac = new AbortController();
  const io = { out: { write: (s) => { out += s; } }, err: { write: (s) => { err += s; } } };
  const first = run(['home', '--port', '0', '--json'], { signal: ac.signal, ...io });
  for (let i = 0; i < 100 && !out; i++) await sleep(20);
  try {
    const { port } = JSON.parse(out);
    assert.equal(liveHome().port, port);
    let out2 = '';
    assert.equal(await run(['home', '--json'], { out: { write: (s) => { out2 += s; } }, err: io.err }), 0);
    assert.deepEqual([JSON.parse(out2).port, JSON.parse(out2).already], [port, true]);
    // Con --lan no dice "ya corre" como si nada: el que corre no está en la red (D36).
    let err2 = '';
    assert.equal(await run(['home', '--lan'], { out: io.out, err: { write: (s) => { err2 += s; } } }), 1);
    assert.match(err2, /sin --lan: cerralo/);
    const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
    assert.equal(health.name, 'scope-compass-home');
  } finally {
    ac.abort();
    await first;
  }
  assert.equal(liveHome(), null, 'se desanota al cerrar');
});

test('init: <carpeta de datos>/<nombre> con git init, o <otra>/<nombre>; una que ya existe no se usa', async () => {
  const saved = process.env.SCOMPASS_DATA;
  process.env.SCOMPASS_DATA = join(root, 'datos');
  try {
    let r = await api('POST', '/api/projects/init', { name: 'Vida', template: 'personal' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.path, join(root, 'datos', 'Vida'), 'el nombre es la carpeta, tal cual');
    assert.equal(r.body.git_init, true);
    r = await api('POST', '/api/projects/init', { name: 'Vida', template: 'vacio' });
    assert.equal(r.status, 409, 'ya existe');
    assert.match(r.body.error.message, /ya existe/);
    assert.equal((await api('POST', '/api/projects/init', { template: 'vacio' })).status, 400, 'sin nombre');
    assert.equal((await api('POST', '/api/projects/init', { name: 'a/b' })).status, 400, 'con /');
    // Nombres que Windows no acepta, también en Linux (§18): el proyecto tiene que poder abrirse en las dos.
    for (const name of ['a\\b', 'Vida: notas', 'CON', 'nul.txt', 'Vida.']) {
      assert.equal((await api('POST', '/api/projects/init', { name })).status, 400, name);
    }
    assert.equal((await api('POST', '/api/projects/init', { name: 'Rel', parent: 'relativa' })).status, 400, 'carpeta relativa');
    assert.equal((await api('GET', '/api/templates')).body.data_dir, join(root, 'datos'));
    assert.equal((await api('GET', '/api/templates')).body.sep, sep, 'la página arma la ruta con el separador del sistema');
    // Otra carpeta: el proyecto queda adentro, con su nombre; dentro de un repo no se hace otro.
    r = await api('POST', '/api/projects/init', { name: 'Sub', parent: join(root, 'datos', 'Vida') });
    assert.equal(r.body.path, join(root, 'datos', 'Vida', 'Sub'));
    assert.equal(r.body.git_init, false);
  } finally {
    if (saved === undefined) delete process.env.SCOMPASS_DATA; else process.env.SCOMPASS_DATA = saved;
  }
});

test('pick-folder: lo que elige el selector del escritorio; cancelar no es un error', async () => {
  const { writeFile: wf } = await import('node:fs/promises');
  // Un .js: SCOMPASS_PICKER lo corre con Node, así el selector falso anda en Linux y en Windows.
  const picker = join(root, 'picker.js');
  const saved = process.env.SCOMPASS_PICKER;
  process.env.SCOMPASS_PICKER = picker;
  try {
    await wf(picker, `process.stdout.write(${JSON.stringify(join(root, 'elegida'))} + '\\n');`);
    assert.deepEqual((await api('POST', '/api/pick-folder', {})).body, { path: join(root, 'elegida') });
    await wf(picker, 'process.exit(1);');
    assert.deepEqual((await api('POST', '/api/pick-folder', {})).body, { cancelled: true });
    process.env.SCOMPASS_PICKER = join(root, 'no-existe');
    assert.equal((await api('POST', '/api/pick-folder', {})).status, 404);
  } finally {
    if (saved === undefined) delete process.env.SCOMPASS_PICKER; else process.env.SCOMPASS_PICKER = saved;
  }
});

test('actualizar compass/ desde el Inicio, sin hub: la tarjeta lo marca y la API lo copia', async () => {
  const { writeFile: wf, readFile: rf } = await import('node:fs/promises');
  const schema = join(b, 'compass', 'schema', 'task.schema.json');
  await wf(schema, '{}\n');
  const card = (await api('GET', '/api/projects')).body.projects.find((x) => x.path === b);
  assert.ok(card.outdated.includes('schema/task.schema.json'), JSON.stringify(card.outdated));
  const r = await api('POST', '/api/projects/update', { path: b });
  assert.equal(r.status, 200);
  assert.ok(r.body.updated.includes('compass/schema/task.schema.json'));
  assert.notEqual(await rf(schema, 'utf8'), '{}\n');
  assert.ok(!(await api('GET', '/api/projects')).body.projects.find((x) => x.path === b).outdated.includes('schema/task.schema.json'));
  assert.equal((await api('POST', '/api/projects/update', { path: join(root, 'otro') })).status, 404);
});
