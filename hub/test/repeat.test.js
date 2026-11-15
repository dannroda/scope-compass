// Repetición simple en ítems de lista (8.5, spec §16.5, D26): nextDue, checkItem, CLI y export.
import './isolate.js';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadValidators, parseDoc } from '../src/schema.js';
import { renderMarkdown } from '../src/export-md.js';
import { nextDue } from '../src/dates.js';
import { checkItem } from '../src/lists.js';
import { run } from '../src/cli.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'compass');
const V = loadValidators();
const NOW = '2026-10-04T12:00:00.000Z';
let dir;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'scompass-repeat-'));
  await cp(FIXTURE, join(dir, 'compass'), { recursive: true });
});
afterEach(() => rm(dir, { recursive: true, force: true, maxRetries: 10 }));

async function cli(...argv) {
  let out = '', err = '';
  const code = await run(['--dir', dir, '--direct', ...argv], { now: () => NOW, out: { write: (s) => { out += s; } }, err: { write: (s) => { err += s; } } });
  return { code, out, err };
}
const items = async (l = 'pendientes') => JSON.parse((await cli('lists', 'show', l, '--json')).out).items;

test('nextDue: desde la fecha límite, con fin de mes y años bisiestos', () => {
  for (const [due, every, next] of [
    ['2026-01-31', 'month', '2026-02-28'], // criterio de §16.8
    ['2028-01-31', 'month', '2028-02-29'],
    ['2026-03-31', 'month', '2026-04-30'],
    ['2026-12-15', 'month', '2027-01-15'],
    ['2028-02-29', 'year', '2029-02-28'],
    ['2026-10-10', 'year', '2027-10-10'],
    ['2026-12-31', 'day', '2027-01-01'],
    ['2026-03-28', 'week', '2026-04-04'],
    ['2026-10-10T17:30', 'week', '2026-10-17T17:30']
  ]) assert.equal(nextDue(due, every), next, `${due} ${every}`);
  assert.throws(() => nextDue('2026-10-10', 'hour'));
});

test('checkItem: uno que se repite avanza y sigue sin tildar; destildarlo es un error', () => {
  const it = { text: 'Pagar la luz', done: false, due: '2026-10-10', repeat: { every: 'month' } };
  assert.deepEqual(checkItem(it), { item: { ...it, due: '2026-11-10' }, advanced: true });
  assert.throws(() => checkItem(it, { undo: true }), /no se destilda/);
  assert.deepEqual(checkItem({ text: 'x', done: false }), { item: { text: 'x', done: true }, advanced: false });
});

test('schema: repeat necesita due y un período conocido', () => {
  const list = (item) => JSON.stringify({ title: 'P', order: 1, items: [item] });
  assert.ok(parseDoc(list({ text: 'x', done: false, due: '2026-10-10', repeat: { every: 'week' } }), 'list', V).ok);
  assert.equal(parseDoc(list({ text: 'x', done: false, repeat: { every: 'week' } }), 'list', V).ok, false, 'sin due');
  assert.equal(parseDoc(list({ text: 'x', done: false, due: '2026-10-10', repeat: { every: 'hour' } }), 'list', V).ok, false);
  assert.ok(parseDoc(list({ text: 'x', done: false, due: '2026-10-10', repeat: { every: 'day', interval: 3 } }), 'list', V).ok, 'interval (31.6)');
  for (const interval of [0, 1.5, '2']) assert.equal(parseDoc(list({ text: 'x', done: false, due: '2026-10-10', repeat: { every: 'day', interval } }), 'list', V).ok, false, `interval ${interval}`);
});

test('interval (31.6): avanza N períodos; sin él, uno', () => {
  for (const [due, every, n, next] of [
    ['2026-11-03', 'day', 2, '2026-11-05'],
    ['2026-12-30', 'day', 3, '2027-01-02'],
    ['2026-10-10T08:00', 'week', 2, '2026-10-24T08:00'],
    ['2026-11-30', 'month', 3, '2027-02-28'],
    ['2026-01-31', 'month', 12, '2027-01-31'],
    ['2028-02-29', 'year', 4, '2032-02-29']
  ]) assert.equal(nextDue(due, every, n), next, `${due} ${every} ×${n}`);
  assert.throws(() => nextDue('2026-10-10', 'day', 0));
  const it = { text: 'Regar', done: false, due: '2026-11-03', repeat: { every: 'day', interval: 2 } };
  assert.equal(checkItem(it).item.due, '2026-11-05');
});

test('CLI: --interval al agregar y al cambiar; 1 no se escribe', async () => {
  await cli('lists', 'add', 'Rutina');
  assert.equal((await cli('item', 'add', 'rutina', 'Regar', '--due', '2026-11-03', '--repeat', 'day', '--interval', '2')).code, 0);
  assert.deepEqual((await items('rutina'))[0].repeat, { every: 'day', interval: 2 });
  assert.match((await cli('lists', 'show', 'rutina')).out, /↻ cada 2 días/);
  await cli('item', 'check', 'rutina', '1');
  assert.equal((await items('rutina'))[0].due, '2026-11-05');
  assert.equal((await cli('item', 'set', 'rutina', '1', '--repeat', 'week')).code, 0);
  assert.deepEqual((await items('rutina'))[0].repeat, { every: 'week', interval: 2 }, '--repeat solo cambia la unidad');
  assert.equal((await cli('item', 'set', 'rutina', '1', '--interval', '1')).code, 0);
  assert.deepEqual((await items('rutina'))[0].repeat, { every: 'week' });
  let r = await cli('item', 'add', 'rutina', 'X', '--due', '2026-11-03', '--interval', '2');
  assert.match(r.err, /--interval va con --repeat/);
  r = await cli('item', 'add', 'rutina', 'X', '--due', '2026-11-03', '--repeat', 'day', '--interval', '0');
  assert.match(r.err, /intervalo inválido/);
  assert.equal((await cli('item', 'set', 'rutina', '1', '--repeat', '')).code, 0, 'quitar la repetición');
  assert.equal((await items('rutina'))[0].repeat, undefined);
});

test('CLI: ítem mensual 2026-01-31 pasa a 2026-02-28 al tildarlo y sigue sin tildar', async () => {
  await cli('lists', 'add', 'Pendientes');
  assert.equal((await cli('item', 'add', 'pendientes', 'Pagar la luz', '--due', '2026-01-31', '--repeat', 'month')).code, 0);
  const path = join(dir, 'compass', 'lists', 'pendientes.json');
  const before = (await readFile(path, 'utf8')).split('\n');
  const r = await cli('item', 'check', 'pendientes', '1');
  assert.match(r.out, /↻ próxima vez: 2026-02-28/);
  assert.deepEqual(await items(), [{ text: 'Pagar la luz', done: false, due: '2026-02-28', repeat: { every: 'month' }, created_at: NOW }]);
  const after = (await readFile(path, 'utf8')).split('\n');
  assert.deepEqual(after.filter((l, i) => l !== before[i]), ['      "due": "2026-02-28",'], 'una sola línea');
  assert.match((await cli('lists', 'show', 'pendientes')).out, /vence 2026-02-28 \(vencida\)  ↻ cada mes/);
  const undo = await cli('item', 'check', 'pendientes', '1', '--undo');
  assert.equal(undo.code, 1);
  assert.match(undo.err, /no se destilda/);
});

test('CLI: --repeat necesita --due; set lo cambia o lo quita', async () => {
  await cli('lists', 'add', 'Pendientes');
  let r = await cli('item', 'add', 'pendientes', 'Regar', '--repeat', 'week');
  assert.equal(r.code, 1);
  assert.match(r.err, /necesita fecha límite/);
  r = await cli('item', 'add', 'pendientes', 'Regar', '--due', '2026-10-05', '--repeat', 'cada-tanto');
  assert.match(r.err, /repetición inválida/);
  await cli('item', 'add', 'pendientes', 'Regar', '--due', '2026-10-05', '--repeat', 'week');
  assert.equal((await cli('item', 'set', 'pendientes', '1', '--repeat', 'day')).code, 0);
  assert.deepEqual((await items())[0].repeat, { every: 'day' });
  r = await cli('item', 'set', 'pendientes', '1', '--due', '');
  assert.match(r.err, /necesita fecha límite/, 'no se quita la fecha de algo que se repite');
  assert.equal((await cli('item', 'set', 'pendientes', '1', '--repeat', '')).code, 0);
  assert.equal((await items())[0].repeat, undefined);
  // Sin repetición, tildar lo marca hecho como siempre.
  await cli('item', 'check', 'pendientes', '1');
  assert.equal((await items())[0].done, true);
});

test('export: la repetición se lee en el markdown', () => {
  const md = renderMarkdown({ milestones: [], tasks: [], lists: [['p', { title: 'Pendientes', order: 1, items: [{ text: 'Pagar la luz', done: false, due: '2026-10-10', repeat: { every: 'month' } }] }]] }, { title: 'P', date: '2026-01-01' });
  assert.match(md, /- \[ \] Pagar la luz · vence 2026-10-10 · se repite cada mes\n/);
  assert.match(renderMarkdown({ milestones: [], tasks: [], lists: [['p', { title: 'P', order: 1, items: [{ text: 'Regar', done: false, due: '2026-10-10', repeat: { every: 'day', interval: 2 } }] }]] }, { title: 'P', date: '2026-01-01' }), /se repite cada 2 días/);
});
