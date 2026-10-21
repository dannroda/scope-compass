// Chat (M25, §32): las conversaciones, su copia y retomarlas (25.3), con el claude falso de fake-claude.js.
import './isolate.js';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chatDir } from '../src/chat.js';
import { ChatManager, chatStore, chatTitle, withTask } from '../src/chats.js';

const HERE = dirname(fileURLToPath(import.meta.url));
let root, dir, log, env, managers;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'scompass-chats-'));
  dir = join(root, 'p');
  await mkdir(dir);
  log = join(root, 'launches.jsonl');
  env = { ...process.env, SCOMPASS_CLAUDE: join(HERE, 'fake-claude.js'), FAKE_CLAUDE_LOG: log, FAKE_CLAUDE_STATE: join(root, 'sessions') };
  managers = [];
});
afterEach(async () => {
  for (const m of managers) m.close();
  await rm(chatDir(dir), { recursive: true, force: true });
  await rm(root, { recursive: true, force: true, maxRetries: 10 });
});

function manager(opts = {}) {
  let t = 0;
  const m = new ChatManager({ projectDir: dir, name: 'Prueba', env, now: () => new Date(Date.UTC(2026, 9, 21, 12, 0, t++)).toISOString(), ...opts });
  m.events = [];
  m.on('event', (e) => m.events.push(e));
  managers.push(m);
  return m;
}
const turnEnd = (m, id) => new Promise((resolve) => {
  const on = (e) => { if (e.event === 'end' && (!id || e.chat === id)) { m.off('event', on); resolve(e); } };
  m.on('event', on);
});
const launches = async () => (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const until = async (cond, ms = 3000) => {
  for (const t = Date.now(); Date.now() - t < ms; await new Promise((r) => setTimeout(r, 10))) if (await cond()) return;
  throw new Error('no pasó a tiempo');
};

test('chatTitle: el comienzo del primer mensaje, en una línea', () => {
  assert.equal(chatTitle('  ¿Qué falta\n en M25?  '), '¿Qué falta en M25?');
  const long = chatTitle('x'.repeat(100));
  assert.equal(long.length, 60);
  assert.ok(long.endsWith('…'));
});

test('withTask: la tarea abierta va delante del mensaje', () => {
  assert.equal(withTask('hola'), 'hola');
  assert.equal(withTask('¿y esta?', { id: 'm25-03', code: '25.3', title: 'Conversaciones' }),
    'Tarea abierta: 25.3 Conversaciones (compass://task/m25-03)\n\n¿y esta?');
  assert.equal(withTask('x', { id: 'abc', title: 'Sin código' }), 'Tarea abierta: Sin código (compass://task/abc)\n\nx');
});

test('chatStore: crear, listar (la última usada primero), anotar el uso, copiar y borrar; fuera de compass/', async () => {
  let t = 0;
  const s = chatStore(dir, { now: () => `2026-10-21T12:00:0${t++}.000Z` });
  assert.deepEqual(await s.list(), []);
  const a = await s.create('primera');
  const b = await s.create('segunda');
  assert.match(a.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual((await s.list()).map((c) => c.title), ['segunda', 'primera']);
  await s.touch(a.id, { started: true });
  assert.deepEqual((await s.list()).map((c) => c.title), ['primera', 'segunda']);
  assert.equal((await s.get(a.id)).started, true);
  await s.append(a.id, { role: 'user', text: 'hola' });
  assert.deepEqual(await s.read(a.id), [{ role: 'user', text: 'hola', at: '2026-10-21T12:00:03.000Z' }]);
  assert.deepEqual(await s.read(b.id), []);
  assert.ok(!chatDir(dir).startsWith(dir));
  assert.equal(await s.remove(a.id), true);
  assert.equal(await s.remove(a.id), false);
  assert.deepEqual(await s.read(a.id), []);
  assert.deepEqual((await s.list()).map((c) => c.id), [b.id]);
  await assert.rejects(s.read('../../x'), { code: 'not_found' });
  // Un índice roto no tira el chat: se empieza de cero.
  await writeFile(join(chatDir(dir), 'index.json'), '{');
  assert.deepEqual(await s.list(), []);
});

test('chatStore: creaciones a la vez no se pisan', async () => {
  const s = chatStore(dir);
  await Promise.all(['a', 'b', 'c', 'd'].map((x) => s.create(x)));
  assert.deepEqual((await s.list()).map((c) => c.title).sort(), ['a', 'b', 'c', 'd']);
});

test('una conversación: se lista, guarda la copia en orden y los eventos llevan su id', async () => {
  const m = manager();
  const end = turnEnd(m);
  const chat = await m.create('hola', { task: { id: 'm1-01', code: '1.1', title: 'Algo' } });
  await end;
  assert.deepEqual((await m.list()).map((c) => [c.id, c.title, c.started]), [[chat.id, 'hola', true]]);
  assert.ok(m.events.every((e) => e.chat === chat.id));
  assert.deepEqual(m.events.map((e) => e.event), ['turn', 'text', 'text', 'end']);
  const { entries, busy } = await m.get(chat.id);
  assert.equal(busy, false);
  // claude recibe la tarea delante; la copia guarda el mensaje como se escribió, y la tarea aparte.
  const answer = `eco: ${withTask('hola', { id: 'm1-01', code: '1.1', title: 'Algo' })}`;
  assert.deepEqual(entries.map(({ at: _, ...e }) => e), [
    { role: 'user', text: 'hola', task: 'm1-01' },
    { role: 'assistant', text: answer, tools: [], ok: true, cost: 0.01 },
  ]);
  const end2 = turnEnd(m);
  await m.send(chat.id, 'herramienta');
  await end2;
  const last = (await m.get(chat.id)).entries.at(-1);
  assert.deepEqual(last.tools, [{ name: 'show_task', brief: 'm1-01', ok: true }]);
  assert.equal((await launches()).length, 1);
});

test('después de cerrar el hub, la conversación se retoma con --resume', async () => {
  const m = manager();
  const end = turnEnd(m);
  const chat = await m.create('uno');
  await end;
  m.close();
  const again = manager();
  const end2 = turnEnd(again);
  await again.send(chat.id, 'dos');
  await end2;
  const l = await launches();
  assert.equal(l.length, 2);
  assert.equal(l[1].argv[l[1].argv.indexOf('--resume') + 1], chat.id);
  assert.deepEqual((await again.get(chat.id)).entries.map((e) => e.text), ['uno', 'eco: uno', 'dos', 'eco: dos']);
});

test('get durante un turno: está ocupada y trae lo que va de la respuesta; cortar lo guarda como cortado', async () => {
  const m = manager();
  const chat = await m.create('lento');
  await until(async () => (await m.get(chat.id)).turn?.text.length > 0);
  const now = await m.get(chat.id);
  assert.equal(now.busy, true);
  assert.deepEqual(now.entries.map((e) => e.role), ['user']);
  const end = turnEnd(m);
  assert.equal(m.interrupt(chat.id), true);
  assert.equal((await end).interrupted, true);
  const last = (await m.get(chat.id)).entries.at(-1);
  assert.equal(last.interrupted, true);
  assert.equal(last.ok, false);
  assert.ok(last.text.length > 0);
  assert.equal(m.interrupt(chat.id), false);
});

test('si claude se cae, la copia guarda el error', async () => {
  const m = manager();
  const end = turnEnd(m);
  const chat = await m.create('morir');
  await end;
  const last = (await m.get(chat.id)).entries.at(-1);
  assert.equal(last.error, 'se cayó');
  // El init llegó antes de caerse: la sesión existe y el próximo mensaje la retoma.
  assert.equal((await m.store.get(chat.id)).started, true);
});

test('sin claude: crear falla con claude_missing y no deja la conversación', async () => {
  const m = manager({ env: { ...env, SCOMPASS_CLAUDE: join(root, 'no-está') } });
  await assert.rejects(m.create('hola'), { code: 'claude_missing' });
  assert.deepEqual(await m.list(), []);
});

test('borrar: cierra el proceso y la saca de la lista; una que no existe da not_found', async () => {
  const m = manager();
  const end = turnEnd(m);
  const chat = await m.create('hola');
  await end;
  const proc = m.procs.get(chat.id);
  assert.ok(proc.alive);
  await m.remove(chat.id);
  await until(() => !proc.alive);
  assert.deepEqual(await m.list(), []);
  await assert.rejects(m.get(chat.id), { code: 'not_found' });
  await assert.rejects(m.remove(chat.id), { code: 'not_found' });
  await assert.rejects(m.send(chat.id, 'x'), { code: 'not_found' });
});

test('varias conversaciones a la vez, cada una con su proceso', async () => {
  const m = manager();
  const [a, b] = await Promise.all([m.create('a'), m.create('b')]);
  await until(async () => !(await m.get(a.id)).busy && !(await m.get(b.id)).busy && (await m.get(b.id)).entries.length === 2);
  assert.equal((await m.get(a.id)).entries[1].text, 'eco: a');
  assert.equal((await m.get(b.id)).entries[1].text, 'eco: b');
  assert.equal((await launches()).length, 2);
});
