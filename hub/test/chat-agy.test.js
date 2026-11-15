// Chat con agy (M27, spec §47, D58): el adaptador ACP, los ajustes del chat, los permisos y el motor, con el agy falso
// de fake-agy.js.
import './isolate.js';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chatDir } from '../src/chat.js';
import { AGY_APP_DIR, agyAllowed, agyArgs, agySettingsFile, agyToolName, ensureAgySettings, findAgy } from '../src/chat-agy.js';
import { chosenEngine, engineFor, setChosenEngine } from '../src/chat-engine.js';
import { ChatManager } from '../src/chats.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE = join(HERE, 'fake-agy.js');
let root, dir, log, env, managers;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'scompass-agy-'));
  dir = join(root, 'p');
  await mkdir(dir);
  log = join(root, 'agy.jsonl');
  const base = { ...process.env };
  delete base.SCOMPASS_CLAUDE;
  env = { ...base, PATH: '', SCOMPASS_AGY: FAKE, SCOMPASS_GEMINI_DIR: join(root, 'gemini'), FAKE_AGY_LOG: log, FAKE_AGY_STATE: join(root, 'sessions'), CLAUDECODE: '1' };
  managers = [];
});
afterEach(async () => {
  for (const m of managers) await m.close();
  await rm(chatDir(dir), { recursive: true, force: true });
  await rm(root, { recursive: true, force: true, maxRetries: 10 });
});

function manager(opts = {}) {
  const m = new ChatManager({ projectDir: dir, name: 'Prueba', env, ...opts });
  m.events = [];
  m.on('event', (e) => m.events.push(e));
  managers.push(m);
  return m;
}
const turnEnd = (m, id) => new Promise((resolve) => {
  const on = (e) => { if (e.event === 'end' && (!id || e.chat === id)) { m.off('event', on); resolve(e); } };
  m.on('event', on);
});
const entries = async () => (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const of = async (type) => (await entries()).filter((e) => e.type === type);

test('los ajustes del chat: se crean seguros, uno que dice otra cosa no se pisa y no arranca', async () => {
  const file = agySettingsFile(env);
  assert.equal(file, join(root, 'gemini', AGY_APP_DIR, 'settings.json'));
  await ensureAgySettings(env);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { agentMode: '', toolPermission: 'strict' });
  // Otras claves (las que agrega agy) no molestan.
  await writeFile(file, JSON.stringify({ agentMode: '', toolPermission: 'strict', model: 'x' }));
  await ensureAgySettings(env);
  for (const bad of [{ agentMode: 'auto', toolPermission: 'strict' }, { toolPermission: 'strict' }, { agentMode: '' }, 'no es json']) {
    const text = typeof bad === 'string' ? bad : JSON.stringify(bad);
    await writeFile(file, text);
    await assert.rejects(ensureAgySettings(env), (e) => e.code === 'agy_unsafe' && e.message.includes(file));
    assert.equal(await readFile(file, 'utf8'), text);
  }
});

test('argumentos, nombres y qué deja usar el hub', () => {
  assert.deepEqual(agyArgs({}), ['acp', '--app-data-dir', 'scope-compass-chat']);
  assert.deepEqual(agyArgs(env), ['acp', '--app-data-dir', 'scope-compass-chat', '--gemini-dir', join(root, 'gemini')]);
  assert.equal(agyToolName('mcp_scompass_show_task'), 'show_task');
  assert.equal(agyToolName('read_file'), 'read_file');
  assert.ok(agyAllowed({ name: 'mcp_scompass_add_task', kind: 'other' }));
  assert.ok(agyAllowed({ name: 'read_file', kind: 'read' }));
  assert.ok(agyAllowed({ name: 'grep_search', kind: 'search' }));
  for (const c of [{ name: 'write_file', kind: 'edit' }, { name: 'run_command', kind: 'execute' }, { name: 'mcp_otro_x', kind: 'other' }, { name: 'delete_file', kind: 'delete' }, { name: 'read_url', kind: 'fetch' }]) {
    assert.equal(agyAllowed(c), false, c.name);
  }
  assert.equal(findAgy(env), FAKE);
  assert.equal(findAgy({ PATH: '' }), null);
});

test('el motor: el elegido si está, si no claude, si no agy; se guarda por equipo', async () => {
  const both = { PATH: '', SCOMPASS_AGY: FAKE, SCOMPASS_CLAUDE: join(HERE, 'fake-claude.js') };
  const onlyAgy = { PATH: '', SCOMPASS_AGY: FAKE };
  assert.equal(engineFor(both, null), 'claude');
  assert.equal(engineFor(both, 'agy'), 'agy');
  assert.equal(engineFor(onlyAgy, null), 'agy');
  assert.equal(engineFor(onlyAgy, 'claude'), 'agy');
  assert.equal(engineFor({ PATH: '' }, null), 'claude');
  assert.equal(chosenEngine(), null);
  await setChosenEngine('agy');
  assert.equal(chosenEngine(), 'agy');
  assert.equal(engineFor(both), 'agy');
  await setChosenEngine(null);
  assert.equal(chosenEngine(), null);
});

test('una conversación con agy: instrucciones delante del primer mensaje, solo scompass, texto en vivo y su sesión', async () => {
  const m = manager();
  const end = turnEnd(m);
  const chat = await m.create('scompass ¿cómo va m1-01?', { engine: 'agy' });
  const e = await end;
  assert.equal(e.ok, true);
  assert.deepEqual(e.tokens, { input: 100, output: 7, cache_read: 3, cache_write: 0 });
  const [launch] = await of('launch');
  assert.deepEqual(launch.argv, agyArgs(env));
  assert.equal(launch.cwd, dir);
  assert.equal(launch.claudecode, null);
  assert.deepEqual(launch.settings, { agentMode: '', toolPermission: 'strict' });
  const [created] = await of('session/new');
  assert.equal(created.params.cwd, dir);
  assert.deepEqual(created.params.mcpServers.map((s) => s.name), ['scompass']);
  assert.deepEqual(created.params.mcpServers[0].env, [{ name: 'SCOMPASS_CHAT_SESSION', value: chat.id }]);
  assert.ok(created.params.mcpServers[0].args.includes('mcp'));
  const [p] = await of('session/prompt');
  assert.match(p.params.prompt[0].text, /^Sos el chat de Scope Compass del proyecto «Prueba»[\s\S]*\n---\n\nscompass ¿cómo va m1-01\?$/);
  assert.deepEqual(m.events.filter((x) => x.event === 'text').map((x) => x.text), ['la tarea ', 'está en curso']);
  assert.deepEqual(m.events.find((x) => x.event === 'tool'), { chat: chat.id, event: 'tool', id: 'c1', name: 'show_task', brief: 'm1-01' });
  assert.ok(!m.events.some((x) => x.event === 'session'), 'el id de agy no sale por el WebSocket');
  const { chat: saved, entries: copy } = await m.get(chat.id);
  assert.equal(saved.engine, 'agy');
  assert.match(saved.agy_session, /^agy-/);
  assert.equal(saved.profile, undefined);
  assert.deepEqual(copy.map((x) => [x.role, x.text]), [['user', 'scompass ¿cómo va m1-01?'], ['assistant', 'la tarea está en curso']]);
  assert.deepEqual(copy[1].tools, [{ name: 'show_task', brief: 'm1-01', ok: true }]);
  // El segundo mensaje, en el mismo proceso y sin las instrucciones.
  const end2 = turnEnd(m);
  await m.send(chat.id, 'hola');
  await end2;
  assert.equal((await of('launch')).length, 1);
  assert.equal((await of('session/prompt'))[1].params.prompt[0].text, 'hola');
});

test('después de cerrar el hub se retoma con session/resume; si agy no la encuentra, sigue en una nueva y lo dice', async () => {
  let m = manager();
  let end = turnEnd(m);
  const chat = await m.create('hola', { engine: 'agy' });
  await end;
  const first = (await m.get(chat.id)).chat.agy_session;
  await m.close();
  m = manager();
  end = turnEnd(m);
  await m.send(chat.id, 'otra');
  await end;
  const [resumed] = await of('session/resume');
  assert.equal(resumed.params.sessionId, first);
  assert.equal(resumed.params.mcpServers[0].env[0].value, chat.id);
  assert.equal((await of('session/prompt')).at(-1).params.prompt[0].text, 'otra');
  // Se perdió la sesión de agy.
  await m.close();
  await rm(join(root, 'sessions', first));
  m = manager();
  end = turnEnd(m);
  await m.send(chat.id, 'tercera');
  await end;
  assert.ok(m.events.some((x) => x.event === 'error' && x.code === 'agy_resume'));
  const now = (await m.get(chat.id)).chat.agy_session;
  assert.notEqual(now, first);
  assert.match((await of('session/prompt')).at(-1).params.prompt[0].text, /^Sos el chat[\s\S]*tercera$/);
});

test('permisos: leer sí; escribir no, y el chat dice lo que no se hizo', async () => {
  const m = manager();
  let end = turnEnd(m);
  const chat = await m.create('leer note.txt', { engine: 'agy' });
  await end;
  end = turnEnd(m);
  await m.send(chat.id, 'permiso escribí out.txt');
  const e = await end;
  assert.equal(e.ok, true);
  const perms = await of('permission');
  assert.deepEqual(perms.map((p) => [p.tool, p.outcome.optionId]), [['read_file', 'allow'], ['write_file', 'deny']]);
  assert.equal(existsSync(join(dir, 'out.txt')), false);
  const copy = (await m.get(chat.id)).entries;
  assert.equal(copy[1].text, 'leído');
  assert.match(copy[3].text, /^No se hizo: File out\.txt\. El chat solo lee el proyecto y opera el tablero/);
  assert.deepEqual(copy[3].tools, [{ name: 'write_file', brief: 'out.txt', ok: false }]);
});

test('si algo edita sin pedir permiso, el hub corta el proceso y avisa', async () => {
  const m = manager();
  const end = turnEnd(m);
  const chat = await m.create('colarse', { engine: 'agy' });
  const e = await end;
  assert.equal(e.ok, false);
  const err = m.events.find((x) => x.event === 'error');
  assert.equal(err.code, 'agy_unsafe');
  assert.match(err.message, /write_file sin pedir permiso/);
  const copy = (await m.get(chat.id)).entries;
  assert.equal(copy[1].ok, false);
  assert.match(copy[1].error, /sin pedir permiso/);
  assert.equal(m.procs.get(chat.id).alive, false);
});

test('ajustes inseguros: no arranca, con agy_unsafe, y no deja la conversación', async () => {
  await mkdir(dirname(agySettingsFile(env)), { recursive: true });
  await writeFile(agySettingsFile(env), JSON.stringify({ agentMode: 'auto' }));
  const m = manager();
  await assert.rejects(m.create('hola', { engine: 'agy' }), (e) => e.code === 'agy_unsafe');
  assert.deepEqual(await m.list(), []);
  assert.deepEqual(await of('launch'), []);
});

test('sin agy: agy_missing', async () => {
  env.SCOMPASS_AGY = join(root, 'no-esta.js');
  const m = manager();
  await assert.rejects(m.create('hola', { engine: 'agy' }), (e) => e.code === 'agy_missing');
  assert.deepEqual(await m.list(), []);
});

test('cortar: session/cancel; si agy no hace caso, se mata y el próximo mensaje retoma', async () => {
  const m = manager({ interruptMs: 200 });
  let end = turnEnd(m);
  const chat = await m.create('lento', { engine: 'agy' });
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(m.interrupt(chat.id), true);
  let e = await end;
  assert.equal(e.interrupted, true);
  assert.equal((await of('session/cancel')).length, 1);
  assert.equal((await of('launch')).length, 1);
  end = turnEnd(m);
  await m.send(chat.id, 'colgado');
  await new Promise((r) => setTimeout(r, 120));
  m.interrupt(chat.id);
  e = await end;
  assert.equal(e.interrupted, true);
  assert.equal(m.procs.get(chat.id).alive, false);
  end = turnEnd(m);
  await m.send(chat.id, 'sigo');
  await end;
  assert.equal((await of('launch')).length, 2);
  assert.equal((await of('session/resume')).length, 1);
});

test('si agy se cae en medio del turno: el error con lo que dijo y fin del turno', async () => {
  const m = manager();
  const end = turnEnd(m);
  const chat = await m.create('morir', { engine: 'agy' });
  const e = await end;
  assert.equal(e.ok, false);
  assert.match(m.events.find((x) => x.event === 'error').message, /se cayó agy/);
  assert.match((await m.get(chat.id)).entries[1].error, /se cayó agy/);
});

test('sin motor pedido, la conversación nueva usa el elegido en Ajustes o el que está instalado', async () => {
  const m = manager();
  let end = turnEnd(m);
  const a = await m.create('hola');
  await end;
  assert.equal(a.engine, 'agy', 'solo está agy');
  env.SCOMPASS_CLAUDE = join(HERE, 'fake-claude.js');
  env.FAKE_CLAUDE_STATE = join(root, 'claude');
  end = turnEnd(m);
  const b = await m.create('hola');
  await end;
  assert.equal(b.engine, undefined, 'con los dos, claude');
  await setChosenEngine('agy');
  try {
    end = turnEnd(m);
    const c = await m.create('hola');
    await end;
    assert.equal(c.engine, 'agy');
  } finally { await setChosenEngine(null); }
  await assert.rejects(m.create('hola', { engine: 'otro' }), (e) => e.code === 'invalid_argument');
});
