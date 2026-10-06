// Listas (8.3, spec §16.4, D25): schema, store, CLI con y sin hub, API y export markdown.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadValidators, parseDoc } from '../src/schema.js';
import { canonical } from '../src/store/canonical.js';
import { createJsonFilesStore } from '../src/store/json-files.js';
import { createServer, listen } from '../src/server.js';
import { renderMarkdown } from '../src/export-md.js';
import { freeId, isValidDue, slugify } from '../src/lists.js';
import { run } from '../src/cli.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'compass');
const V = loadValidators();
const NOW = '2026-10-04T12:00:00.000Z';
let root, disk, hubDir, app, port, events;

async function project(name, cfgPort) {
  const p = join(root, name);
  await cp(FIXTURE, join(p, 'compass'), { recursive: true });
  const cfgPath = join(p, 'compass', 'config.json');
  await writeFile(cfgPath, canonical({ ...JSON.parse(await readFile(cfgPath, 'utf8')), port: cfgPort }));
  return p;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'scompass-lists-'));
  hubDir = await project('con-hub', 1);
  app = createServer({ projectDir: hubDir, store: createJsonFilesStore(join(hubDir, 'compass'), { validators: V, now: () => NOW }) });
  ({ port } = await listen(app, 0));
  const cfgPath = join(hubDir, 'compass', 'config.json');
  await writeFile(cfgPath, canonical({ ...JSON.parse(await readFile(cfgPath, 'utf8')), port }));
  disk = await project('sin-hub', 1);
  events = [];
  app.events.on('event', (e) => events.push(e));
});
afterEach(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true, maxRetries: 10 });
});

async function cli(cwd, argv) {
  let out = '', err = '';
  const code = await run(argv, { cwd, now: () => NOW, out: { write: (s) => { out += s; } }, err: { write: (s) => { err += s; } } });
  return { code, out, err };
}

test('slugify y freeId: ids legibles y sin repetir', () => {
  assert.equal(slugify('Libros para leer'), 'libros-para-leer');
  assert.equal(slugify('  Ideas de regalos ¡2026!  '), 'ideas-de-regalos-2026');
  assert.equal(slugify('Mudanza: depto nuevo'), 'mudanza-depto-nuevo');
  assert.equal(slugify('Árbol ñandú'), 'arbol-nandu');
  assert.equal(slugify('¿?'), 'lista');
  assert.ok(slugify('x'.repeat(100)).length <= 60);
  assert.equal(freeId('compras', []), 'compras');
  assert.equal(freeId('compras', ['compras', 'compras-2']), 'compras-3');
});

test('isValidDue: formato y fecha que existe', () => {
  for (const ok of ['2026-10-10', '2026-10-10T17:30', '2028-02-29', '2026-12-31T00:00']) assert.ok(isValidDue(ok), ok);
  for (const bad of ['2026-02-30', '2027-02-29', '2026-13-01', '2026-10-10T24:00', '2026-10-10 17:30', '10/10/2026', '', null]) assert.ok(!isValidDue(bad), String(bad));
});

test('schema: lista válida y errores comunes', () => {
  const ok = { title: 'Compras', order: 1, items: [{ text: 'Yerba', done: false, due: '2026-10-10', created_at: NOW }] };
  assert.ok(parseDoc(JSON.stringify(ok), 'list', V).ok);
  for (const bad of [
    { ...ok, items: [{ text: '', done: false }] },
    { ...ok, items: [{ text: 'x', done: false, due: '10/10' }] },
    { ...ok, items: [{ text: 'x' }] },
    { ...ok, extra: 1 },
    { title: 'x', order: 1 }
  ]) assert.equal(parseDoc(JSON.stringify(bad), 'list', V).ok, false, JSON.stringify(bad));
});

test('CLI sin hub: crear, agregar, tildar, editar, quitar y borrar', async () => {
  const c = (...a) => cli(disk, a);
  assert.match((await c('lists')).out, /Sin listas/);
  assert.match((await c('lists', 'add', 'Compras')).out, /Creada la lista compras: Compras/);
  assert.match((await c('lists', 'add', 'Compras')).out, /compras-2/, 'el mismo título no pisa');
  assert.equal((await c('item', 'add', 'compras', 'Yerba')).code, 0);
  assert.equal((await c('item', 'add', 'compras', 'Pagar la luz', '--due', '2026-10-10')).code, 0);
  let r = await c('item', 'add', 'compras', 'Nada', '--due', '2026-02-30');
  assert.equal(r.code, 1);
  assert.match(r.err, /fecha inválida/);
  assert.equal((await c('item', 'check', 'compras', '1')).code, 0);
  r = await c('item', 'check', 'compras', '9');
  assert.match(r.err, /ítem inexistente: 9 \(la lista tiene 2\)/);
  assert.equal((await c('item', 'set', 'compras', '2', '--text', 'Pagar el gas', '--due', '2026-10-12T09:00')).code, 0);
  const doc = JSON.parse((await c('lists', 'show', 'compras', '--json')).out);
  assert.deepEqual(doc.items, [
    { text: 'Yerba', done: true, created_at: NOW },
    { text: 'Pagar el gas', done: false, created_at: NOW, due: '2026-10-12T09:00' }
  ]);
  assert.equal(doc.order, 1);
  assert.equal(doc.created_at, NOW);
  assert.match((await c('lists', 'show', 'compras')).out, /2\. \[ \] Pagar el gas  · vence 2026-10-12 09:00/);
  assert.match((await c('lists')).out, /compras\s+Compras  1 de 2 pendiente\n\s+compras-2\s+Compras  vacía/);
  assert.equal((await c('item', 'set', 'compras', '2', '--due', '')).code, 0);
  assert.equal(JSON.parse((await c('lists', 'show', 'compras', '--json')).out).items[1].due, undefined, '--due "" quita la fecha');
  assert.match((await c('item', 'clear', 'compras')).out, /1 tildado quitado/);
  assert.match((await c('item', 'rm', 'compras', '1')).out, /ítem 1 quitado/);
  assert.deepEqual(JSON.parse((await c('lists', 'show', 'compras', '--json')).out).items, []);
  assert.equal((await c('lists', 'set', 'compras', '--title', 'Súper')).code, 0);
  assert.equal(JSON.parse((await c('lists', 'show', 'compras', '--json')).out).title, 'Súper');
  assert.equal((await c('lists', 'rm', 'compras-2')).code, 0);
  assert.ok(!existsSync(join(disk, 'compass', 'lists', 'compras-2.json')));
  assert.equal((await c('item', 'nada', 'compras')).code, 2);
});

test('CLI: tildar un ítem cambia una sola línea del JSON', async () => {
  await cli(disk, ['lists', 'add', 'Compras']);
  for (const t of ['Yerba', 'Café', 'Pan']) await cli(disk, ['item', 'add', 'compras', t]);
  const path = join(disk, 'compass', 'lists', 'compras.json');
  const before = (await readFile(path, 'utf8')).split('\n');
  await cli(disk, ['item', 'check', 'compras', '2']);
  const after = (await readFile(path, 'utf8')).split('\n');
  const changed = before.filter((l, i) => l !== after[i]);
  // La línea del ítem y updated_at (que con el mismo NOW no cambia).
  assert.deepEqual(changed, ['      "done": false,']);
});

test('CLI: pasar un ítem a tarea la crea y deja el ítem enlazado', async () => {
  await cli(disk, ['lists', 'add', 'Assets a conseguir']);
  await cli(disk, ['item', 'add', 'assets-a-conseguir', 'Sonidos de espada']);
  const r = JSON.parse((await cli(disk, ['item', 'task', 'assets-a-conseguir', '1', '--milestone', 'm01', '--code', '1.9', '--json'])).out);
  assert.equal(r.items[0].task, r.task.id);
  const t = JSON.parse((await cli(disk, ['show', r.task.id, '--json'])).out);
  assert.deepEqual([t.title, t.milestone, t.code, t.status], ['Sonidos de espada', 'm01', '1.9', 'todo']);
  const again = await cli(disk, ['item', 'task', 'assets-a-conseguir', '1', '--milestone', 'm01']);
  assert.equal(again.code, 1);
  assert.match(again.err, /ya pasó a la tarea/);
  await cli(disk, ['item', 'add', 'assets-a-conseguir', 'Música']);
  assert.equal((await cli(disk, ['item', 'task', 'assets-a-conseguir', '2'])).code, 2, 'falta --milestone');
  const md = await readFile(join(disk, 'docs', 'tareas.md'), 'utf8');
  assert.match(md, /## Listas\n\n### Assets a conseguir  \(0\/2\)\n\n- \[ \] Sonidos de espada · → tarea 1\.9\n- \[ \] Música\n/);
});

test('CLI con hub: las listas pasan por la API y se publican', async () => {
  const c = (...a) => cli(hubDir, a);
  const first = await c('lists', 'add', 'Pendientes');
  assert.equal(first.code, 0, first.err);
  assert.equal((await c('item', 'add', 'pendientes', 'Pagar la luz', '--due', '2026-10-10')).code, 0);
  assert.equal((await c('item', 'check', 'pendientes', '1')).code, 0);
  const ups = events.filter((e) => e.type === 'upsert' && e.collection === 'lists');
  assert.equal(ups.length, 3);
  assert.equal(ups.at(-1).doc.items[0].done, true);
  // Misma salida que sin hub.
  await cli(disk, ['lists', 'add', 'Pendientes']);
  await cli(disk, ['item', 'add', 'pendientes', 'Pagar la luz', '--due', '2026-10-10']);
  await cli(disk, ['item', 'check', 'pendientes', '1']);
  const [a, b] = await Promise.all([hubDir, disk].map((p) => readFile(join(p, 'compass', 'lists', 'pendientes.json'), 'utf8')));
  assert.equal(a, b);
  assert.equal((await c('lists', 'rm', 'pendientes')).code, 0);
  assert.ok(events.some((e) => e.type === 'delete' && e.collection === 'lists' && e.id === 'pendientes'));
});

test('API: crear con If-None-Match, conflicto si ya existe, y lista ordenada', async () => {
  const base = `http://127.0.0.1:${port}/api/lists`;
  const put = (id, body, headers = {}) => fetch(`${base}/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  assert.equal((await put('b', { title: 'B', order: 2, items: [] }, { 'if-none-match': '*' })).status, 200);
  assert.equal((await put('a', { title: 'A', order: 1, items: [] }, { 'if-none-match': '*' })).status, 200);
  assert.equal((await put('a', { title: 'A2', order: 1, items: [] }, { 'if-none-match': '*' })).status, 409);
  assert.equal((await put('c', { title: 'C', order: 3 }, {})).status, 400, 'sin items');
  const all = await (await fetch(base)).json();
  assert.deepEqual(all.lists.map((l) => l.id), ['a', 'b']);
  const r = await fetch(`${base}/a`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Primera' }) });
  assert.equal((await r.json()).title, 'Primera');
});

test('watcher: una lista editada a mano se publica; una inválida avisa', async () => {
  const w = createServer({ projectDir: disk, store: createJsonFilesStore(join(disk, 'compass'), { validators: V }), validators: V, watch: true });
  const seen = [];
  w.events.on('event', (e) => seen.push(e));
  await listen(w, 0);
  try {
    await mkdir(join(disk, 'compass', 'lists'), { recursive: true });
    await writeFile(join(disk, 'compass', 'lists', 'ideas.json'), canonical({ title: 'Ideas', order: 1, items: [] }));
    for (let i = 0; i < 100 && !seen.some((e) => e.collection === 'lists'); i++) await new Promise((r) => setTimeout(r, 20));
    assert.ok(seen.some((e) => e.type === 'upsert' && e.collection === 'lists' && e.id === 'ideas'));
    await writeFile(join(disk, 'compass', 'lists', 'ideas.json'), '{ roto');
    for (let i = 0; i < 100 && !seen.some((e) => e.type === 'warning'); i++) await new Promise((r) => setTimeout(r, 20));
    assert.ok(seen.some((e) => e.type === 'warning' && e.path === 'compass/lists/ideas.json'));
  } finally {
    await w.close();
  }
});

test('export: sin listas no cambia nada; con listas, una sección al final', () => {
  const base = { milestones: [['m00', { code: 'M0', order: 0, title: 'Cero' }]], tasks: [['t1', { milestone: 'm00', title: 'T', code: '0.1', status: 'todo' }]] };
  const opts = { title: 'P', date: '2026-01-01' };
  assert.equal(renderMarkdown({ ...base, lists: [] }, opts), renderMarkdown(base, opts));
  const md = renderMarkdown({ ...base, lists: [
    ['z', { title: 'Segunda', order: 2, items: [] }],
    ['a', { title: 'Primera', order: 1, items: [{ text: 'Uno', done: true }, { text: 'Dos', done: false, due: '2026-10-10T17:30', task: 't1' }] }]
  ] }, opts);
  assert.ok(md.endsWith('## Listas\n\n### Primera  (1/2)\n\n- [x] Uno\n- [ ] Dos · vence 2026-10-10 17:30 · → tarea 0.1\n\n### Segunda\n'));
});

test('API: crear con id del título, tildar con la regla de la CLI y pasar a tarea', async () => {
  const base = `http://127.0.0.1:${port}/api/lists`;
  const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  let r = await post('', { title: 'Libros para leer' });
  assert.equal(r.status, 201);
  assert.equal((await r.json()).id, 'libros-para-leer');
  assert.equal((await (await post('', { title: 'Libros para leer' })).json()).id, 'libros-para-leer-2');
  assert.equal((await post('', { title: '  ' })).status, 400);
  await fetch(`${base}/libros-para-leer`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: [
    { text: 'Rayuela', done: false }, { text: 'Revista', done: false, due: '2026-01-31', repeat: { every: 'month' } }
  ] }) });
  r = await post('/libros-para-leer/check', { n: 2 });
  let body = await r.json();
  assert.deepEqual([body.advanced, body.list.items[1].done, body.list.items[1].due], [true, false, '2026-02-28']);
  assert.equal((await post('/libros-para-leer/check', { n: 1 }, { 'if-match': '"viejo"' })).status, 409);
  r = await post('/libros-para-leer/check', { n: 1 }, { 'if-match': `"${body.list.etag}"` });
  assert.equal((await r.json()).list.items[0].done, true);
  assert.equal((await post('/libros-para-leer/check', { n: 9 })).status, 400);
  assert.equal((await post('/libros-para-leer/check', { n: 2, undo: true })).status, 400, 'uno que se repite no se destilda');
  r = await post('/libros-para-leer/task', { n: 1, milestone: 'm01' });
  assert.equal(r.status, 201);
  body = await r.json();
  assert.equal(body.list.items[0].task, body.task.id);
  assert.equal(body.task.title, 'Rayuela');
  assert.equal((await post('/libros-para-leer/task', { n: 1, milestone: 'm01' })).status, 409);
  assert.ok(events.some((e) => e.type === 'upsert' && e.collection === 'tasks' && e.id === body.task.id), 'la tarea nueva se publica');
});
