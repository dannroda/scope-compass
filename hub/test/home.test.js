// Inicio (8.8, spec §16.2, D24): resumen y "Hoy" de todos los proyectos, escrituras por el hub o directo,
// cambios en vivo desde los hubs, y un solo Inicio por usuario.
import './isolate.js';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
import { summarize, todayOf, weekOf } from '../src/summary.js';
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
  assert.deepEqual(empty, { milestone: null, counts: { todo: 0, paused: 0, doing: 0, review: 0, done: 0 }, doing: [], next: [], lists: [], done_week: 0, decisions: { open: 0, pending: 0, revert: 0 } });
  // El hito actual cuenta las de Revisión como hechas, y sigue siendo el actual hasta que estén en Hecho.
  const rv = summarize({ lists: new Map(), milestones: new Map([['m0', { code: 'M0', order: 0, title: 'Cero' }], ['m1', { code: 'M1', order: 1, title: 'Uno' }]]),
    tasks: new Map([['a', { milestone: 'm0', title: 'A', status: 'done' }], ['b', { milestone: 'm0', title: 'B', status: 'review' }], ['c', { milestone: 'm1', title: 'C', status: 'todo' }]]) }, TODAY);
  assert.deepEqual([rv.milestone.code, rv.milestone.done, rv.milestone.review, rv.milestone.total], ['M0', 2, 1, 2]);
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

test('weekOf (31.3): lo que vence después de hoy y dentro de 7 días, por fecha; con las áreas de cada tarea', () => {
  const all = {
    milestones: new Map([['m00', { code: 'M0', order: 0, title: 'Cero' }]]),
    tasks: new Map([['t1', { milestone: 'm00', title: 'En 6 días', status: 'doing', due: '2026-10-10T09:00', tags: ['casa'] }], ['t2', { milestone: 'm00', title: 'Hecha', status: 'done', due: '2026-10-06' }],
      ['t3', { milestone: 'm00', title: 'En 7 días', status: 'todo', due: '2026-10-11' }], ['t4', { milestone: 'm00', title: 'Hoy', status: 'todo', due: '2026-10-04' }]]),
    lists: new Map([['l', { title: 'L', order: 1, items: [{ text: 'Mañana', done: false, due: '2026-10-05', repeat: { every: 'day', interval: 2 } }, { text: 'Tildado', done: true, due: '2026-10-06' }, { text: 'Vencido', done: false, due: '2026-10-01' }, { text: 'Sin fecha', done: false }] }]])
  };
  const week = weekOf(all, TODAY);
  assert.deepEqual(week.map((x) => [x.kind, x.text, x.due]), [['item', 'Mañana', '2026-10-05'], ['task', 'En 6 días', '2026-10-10T09:00']]);
  assert.deepEqual(week[0].repeat, { every: 'day', interval: 2 });
  assert.deepEqual(week[1].tags, ['casa']);
  assert.deepEqual(todayOf(all, TODAY).find((x) => x.text === 'En 6 días').tags, ['casa'], 'Hoy también trae las áreas');
});

test('decisiones (§31): las preguntas abiertas van primero en Hoy; el resumen cuenta las que esperan', () => {
  const all = {
    milestones: new Map([['m00', { code: 'M0', order: 0, title: 'Cero' }]]),
    tasks: new Map([['t1', { milestone: 'm00', code: '0.1', title: 'En curso', status: 'doing', decisions: [
      { text: '¿A o B?', asked: true, at: '2026-10-02T10:00:00Z' }, { text: '¿C?', asked: true, reply: 'sí', at: '2026-10-02T11:00:00Z' }, { text: 'X', at: '2026-10-02T12:00:00Z' }] }],
    ['t2', { milestone: 'm00', title: 'Hecha', status: 'done', decisions: [{ text: '¿D?', asked: true, at: '2026-10-01T10:00:00Z' }, { text: 'Y', review: 'revert', at: '2026-10-01T11:00:00Z' }] }],
    ['t3', { milestone: 'm00', title: 'Vence', status: 'todo', due: '2026-10-01' }]]),
    lists: new Map()
  };
  const today = todayOf(all, TODAY);
  assert.deepEqual(today.map((x) => [x.kind, x.text]), [['question', '¿D?'], ['question', '¿A o B?'], ['task', 'Vence'], ['task', '0.1 En curso']]);
  const { etag, ...q } = today[1];
  assert.match(etag, /^[0-9a-f]{16}$/);
  assert.deepEqual(q, { kind: 'question', id: 't1', n: 1, text: '¿A o B?', task: '0.1 En curso', milestone: 'm00', at: '2026-10-02T10:00:00Z' });
  assert.deepEqual(summarize(all, TODAY).decisions, { open: 2, pending: 1, revert: 1 });
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

test('worktrees (23.2): /api/projects y /api/today dicen el repo, si es el principal y la rama', async () => {
  const git = (cwd, ...x) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...x], { stdio: 'ignore' });
  git(b, 'init', '-q', '-b', 'main'); git(b, 'add', '-A'); git(b, 'commit', '-qm', 'base');
  const wt = join(root, 'b-arte');
  git(b, 'worktree', 'add', '-q', '-b', 'arte', wt);
  await recordProject(wt);
  const { body } = await api('GET', '/api/projects');
  const of = (path) => body.projects.find((p) => p.path === path).worktree;
  assert.equal(of(a), null, 'sin repo');
  assert.deepEqual({ ...of(b), repo: undefined }, { repo: undefined, main: true, branch: 'main' });
  assert.deepEqual({ ...of(wt), repo: undefined }, { repo: undefined, main: false, branch: 'arte' });
  assert.equal(of(wt).repo, of(b).repo);
  const today = (await api('GET', '/api/today')).body.items.filter((x) => x.kind === 'item' && x.text === 'Gas');
  assert.deepEqual(today.map((x) => [x.project.path, x.project.worktree.main, x.project.worktree.repo === of(b).repo]).sort(), [[b, true, true], [wt, false, true]]);
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

test('GET /api/today trae week; add-item (31.2) agrega con la regla de item add, por el hub o directo', async () => {
  let r = await api('POST', '/api/projects/add-item', { path: b, list: 'pendientes', text: '  Llamar al dentista ', due: '2026-10-07' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.via, 'disk');
  assert.equal(r.body.n, 2);
  const disk = JSON.parse(await readFile(join(b, 'compass', 'lists', 'pendientes.json'), 'utf8'));
  assert.deepEqual(disk.items[1], { text: 'Llamar al dentista', done: false, due: '2026-10-07', created_at: TODAY.toISOString() });
  const { body } = await api('GET', '/api/today');
  assert.deepEqual(body.week.map((x) => [x.project.path, x.text, x.due]), [[b, 'Llamar al dentista', '2026-10-07']]);
  r = await api('POST', '/api/projects/add-item', { path: a, list: 'compras', text: 'Pan' });
  assert.equal(r.body.via, 'hub');
  assert.equal(r.body.list.items.at(-1).text, 'Pan');
  for (const [bad, re] of [[{ text: ' ' }, /falta el texto/], [{ text: 'x', due: '2026-02-30' }, /fecha inválida/], [{ text: 'x', etag: 'viejo' }, /cambió/]]) {
    r = await api('POST', '/api/projects/add-item', { path: b, list: 'pendientes', ...bad });
    assert.match(r.body.error.message, re);
  }
  assert.equal((await api('POST', '/api/projects/add-item', { path: b, text: 'x' })).status, 400, 'sin lista');
  assert.equal((await api('POST', '/api/projects/add-item', { path: join(root, 'otro'), list: 'x', text: 'x' })).status, 404);
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
  // Si el Inicio no llega a escuchar o no se cierra, el test falla diciendo qué escribió, en lugar de quedar colgado
  // hasta el timeout de la suite (m10-10).
  let ended = null;
  const first = run(['home', '--port', '0', '--json'], { signal: ac.signal, ...io }).then((code) => { ended = { code }; return code; }, (e) => { ended = { error: e }; throw e; });
  for (let i = 0; i < 1000 && !out && !ended; i++) await sleep(20);
  const seen = () => `out: ${JSON.stringify(out)}, err: ${JSON.stringify(err)}, run: ${ended ? JSON.stringify(ended.error?.message ?? ended.code) : 'sin terminar'}`;
  try {
    assert.ok(out, `el Inicio no escribió su dirección en 20 s (${seen()})`);
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
    let timer;
    const late = new Promise((_, fail) => { timer = setTimeout(() => fail(new Error(`el Inicio no se cerró en 20 s (${seen()})`)), 20000); });
    try { await Promise.race([first, late]); } finally { clearTimeout(timer); }
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
    // 19.8: un nombre que empieza con - es el nombre, no otra opción de scompass init.
    r = await api('POST', '/api/projects/init', { name: '-guion', template: 'vacio' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(JSON.parse(await readFile(join(r.body.path, 'compass', 'config.json'), 'utf8')).project, '-guion');
    // Si init falla, la carpeta que creó el pedido no queda.
    r = await api('POST', '/api/projects/init', { name: 'Rota', template: 'vacio', parent: join(root, 'datos', 'Vida', 'compass', 'config.json') });
    assert.ok(r.status >= 400);
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

test('Actualizar todos (§38): pone al día el compass/ de cada proyecto desactualizado y dice cuáles', async () => {
  const { writeFile: wf, readFile: rf } = await import('node:fs/promises');
  const sa = join(a, 'compass', 'schema', 'task.schema.json');
  const sb = join(b, 'compass', 'AGENTS.md');
  await wf(sa, '{}\n');
  await wf(sb, 'viejo\n');
  const r = await api('POST', '/api/projects/update-all');
  assert.equal(r.status, 200);
  const byPath = Object.fromEntries(r.body.updated.map((x) => [x.path, x.files]));
  assert.ok(byPath[a]?.includes('compass/schema/task.schema.json'), JSON.stringify(r.body));
  assert.ok(byPath[b]?.includes('compass/AGENTS.md'), JSON.stringify(r.body));
  assert.notEqual(await rf(sa, 'utf8'), '{}\n');
  assert.notEqual(await rf(sb, 'utf8'), 'viejo\n');
  assert.ok((await api('GET', '/api/projects')).body.projects.every((x) => !x.outdated?.length));
  assert.deepEqual((await api('POST', '/api/projects/update-all')).body, { updated: [] });
});
