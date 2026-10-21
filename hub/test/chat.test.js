// Chat (M25, §32): el proceso de Claude Code en el hub (25.2), con el claude falso de fake-claude.js.
import './isolate.js';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChatProcess, chatDir, chatEvents, claudeArgs, findClaude } from '../src/chat.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE = join(HERE, 'fake-claude.js');
let root, dir, log, env, chats;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'scompass-chat-'));
  dir = join(root, 'p');
  await cp(join(HERE, 'fixtures', 'compass'), join(dir, 'compass'), { recursive: true });
  log = join(root, 'launches.jsonl');
  env = { ...process.env, SCOMPASS_CLAUDE: FAKE, FAKE_CLAUDE_LOG: log, FAKE_CLAUDE_STATE: join(root, 'sessions') };
  chats = [];
});
afterEach(async () => {
  for (const c of chats) c.close();
  await rm(root, { recursive: true, force: true, maxRetries: 10 });
});

function chat(opts = {}) {
  const c = new ChatProcess({ projectDir: dir, name: 'Prueba', session: randomUUID(), env, ...opts });
  c.events = [];
  c.on('event', (e) => c.events.push(e));
  chats.push(c);
  return c;
}
const turnEnd = (c) => new Promise((resolve) => {
  const on = (e) => { if (e.event === 'end') { c.off('event', on); resolve(e); } };
  c.on('event', on);
});
async function say(c, text) {
  const end = turnEnd(c);
  await c.send(text);
  return end;
}
const launches = async () => (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const text = (c) => c.events.filter((e) => e.event === 'text').map((e) => e.text).join('');
const until = async (cond, ms = 3000) => {
  for (const t = Date.now(); Date.now() - t < ms; await new Promise((r) => setTimeout(r, 10))) if (await cond()) return;
  throw new Error('no pasó a tiempo');
};

test('findClaude: SCOMPASS_CLAUDE, si no el del PATH; null si no hay', async () => {
  assert.equal(findClaude({ SCOMPASS_CLAUDE: FAKE }), FAKE);
  assert.equal(findClaude({ SCOMPASS_CLAUDE: join(root, 'no-está') }), null);
  assert.equal(findClaude({ PATH: root }), null);
  const bin = join(root, 'bin');
  await mkdir(bin);
  const exe = join(bin, process.platform === 'win32' ? 'claude.exe' : 'claude');
  await writeFile(exe, '');
  await chmod(exe, 0o755);
  assert.equal(findClaude({ PATH: [join(root, 'vacía'), bin].join(process.platform === 'win32' ? ';' : ':') }), exe);
});

test('claudeArgs: stream-json, la sesión, solo el MCP scompass y la lectura, sin preguntar permisos', () => {
  const a = claudeArgs({ session: 'S', resume: false, mcpConfig: 'm.json', promptFile: 'p.md' });
  const val = (f) => a[a.indexOf(f) + 1];
  assert.deepEqual(a.slice(0, 7), ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages']);
  assert.equal(val('--session-id'), 'S');
  assert.ok(!a.includes('--resume'));
  assert.equal(val('--mcp-config'), 'm.json');
  assert.ok(a.includes('--strict-mcp-config'));
  assert.equal(val('--tools'), 'Read,Grep,Glob');
  assert.equal(val('--allowedTools'), 'mcp__scompass,Read,Grep,Glob');
  assert.equal(val('--permission-mode'), 'dontAsk');
  assert.equal(val('--permission-prompts'), 'none');
  assert.equal(val('--append-system-prompt-file'), 'p.md');
  const b = claudeArgs({ session: 'S', resume: true, mcpConfig: 'm.json', promptFile: 'p.md' });
  assert.equal(b[b.indexOf('--resume') + 1], 'S');
  assert.ok(!b.includes('--session-id'));
});

test('chatEvents: texto, herramientas, su resultado y el fin del turno; lo de los subagentes no', () => {
  assert.deepEqual(chatEvents({ type: 'system', subtype: 'init', session_id: 'S' }), [{ event: 'init', session: 'S' }]);
  assert.deepEqual(chatEvents({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ho' } } }),
    [{ event: 'text', text: 'ho' }]);
  assert.deepEqual(chatEvents({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '…' } } }), []);
  assert.deepEqual(chatEvents({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'thinking' }, { type: 'text', text: 'x' },
    { type: 'tool_use', id: 't1', name: 'mcp__scompass__list_tasks', input: { milestone: 'm25' } }, { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/a/b.md' } }] } }),
  [{ event: 'tool', id: 't1', name: 'list_tasks', brief: 'm25' }, { event: 'tool', id: 't2', name: 'Read', brief: '/a/b.md' }]);
  assert.deepEqual(chatEvents({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x' }, { type: 'tool_result', tool_use_id: 't2', is_error: true }] } }),
    [{ event: 'tool_result', id: 't1', ok: true }, { event: 'tool_result', id: 't2', ok: false }]);
  assert.deepEqual(chatEvents({ type: 'assistant', parent_tool_use_id: 't9', message: { content: [{ type: 'tool_use', id: 't3', name: 'Read', input: {} }] } }), []);
  assert.deepEqual(chatEvents({ type: 'result', subtype: 'success', is_error: false, terminal_reason: 'completed', total_cost_usd: 0.1, duration_ms: 900 }),
    [{ event: 'end', ok: true, interrupted: false, cost: 0.1, ms: 900 }]);
  assert.deepEqual(chatEvents({ type: 'result', subtype: 'error_during_execution', is_error: true, terminal_reason: 'aborted_streaming' }),
    [{ event: 'end', ok: false, interrupted: true }]);
  assert.deepEqual(chatEvents({ type: 'result', subtype: 'error_max_turns', is_error: true }), [{ event: 'end', ok: false, interrupted: false, error: 'error_max_turns' }]);
  assert.deepEqual(chatEvents({ type: 'rate_limit_event' }), []);
});

test('una conversación: el texto en vivo, un proceso para varios mensajes, en la carpeta del proyecto', async () => {
  const c = chat();
  assert.deepEqual(await say(c, 'hola'), { event: 'end', ok: true, interrupted: false, cost: 0.01, ms: 5,
    tokens: { input: 3, output: 'eco: hola'.length, cache_read: 100, cache_write: 20 } });
  // El uso de los límites de la cuenta llega antes del fin del turno (§33).
  assert.deepEqual(c.events.find((e) => e.event === 'limits'), { event: 'limits', limits: { status: 'allowed',
    five_hour: { used: 0.25, resets_at: new Date(1792572000 * 1000).toISOString() }, seven_day: { used: 0.4, resets_at: new Date(1793062800 * 1000).toISOString() } } });
  assert.deepEqual(c.events.slice(0, 3), [{ event: 'turn', text: 'hola' }, { event: 'text', text: 'eco:' }, { event: 'text', text: ' hola' }]);
  await say(c, 'herramienta');
  assert.deepEqual(c.events.filter((e) => e.event.startsWith('tool')),
    [{ event: 'tool', id: 'toolu_1', name: 'show_task', brief: 'm1-01' }, { event: 'tool_result', id: 'toolu_1', ok: true }]);
  const l = await launches();
  assert.equal(l.length, 1, 'un solo proceso');
  assert.equal(l[0].cwd, dir);
  assert.equal(l[0].argv[l[0].argv.indexOf('--session-id') + 1], c.session);
  // La config del MCP lanza `scompass mcp` sobre este proyecto, y está fuera de compass/.
  const mcp = JSON.parse(await readFile(join(chatDir(dir), 'mcp.json'), 'utf8'));
  assert.deepEqual(mcp.mcpServers.scompass.args.slice(1), ['mcp', '--dir', dir]);
  assert.ok(!chatDir(dir).startsWith(dir));
  assert.match(await readFile(join(chatDir(dir), 'prompt.md'), 'utf8'), /«Prueba»/);
});

test('la config del MCP levanta de verdad el servidor scompass del proyecto', async () => {
  const c = chat();
  await say(c, 'hola');
  const { command, args } = JSON.parse(await readFile(join(chatDir(dir), 'mcp.json'), 'utf8')).mcpServers.scompass;
  const p = spawn(command, args, { stdio: ['pipe', 'pipe', 'ignore'] });
  const lines = createInterface({ input: p.stdout })[Symbol.asyncIterator]();
  p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } })}\n`);
  await lines.next();
  p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'show_task', arguments: { id: 'm1-01' } } })}\n`);
  const r = JSON.parse((await lines.next()).value);
  p.kill();
  assert.equal(r.result.structuredContent.id, 'm1-01');
});

test('cerrar y volver a escribir retoma la sesión con --resume', async () => {
  const c = chat();
  await say(c, 'uno');
  c.close();
  await until(() => !c.alive);
  await say(c, 'dos');
  const l = await launches();
  assert.equal(l.length, 2);
  assert.equal(l[1].argv[l[1].argv.indexOf('--resume') + 1], c.session);
  assert.ok(!l[1].argv.includes('--session-id'));
  // Una conversación que ya existía arranca con --resume desde el primer mensaje.
  const d = chat({ session: c.session, resume: true });
  await say(d, 'tres');
  assert.ok((await launches())[2].argv.includes('--resume'));
});

test('un turno por vez', async () => {
  const c = chat();
  await c.send('lento');
  await assert.rejects(c.send('otro'), { code: 'busy' });
  assert.equal(c.interrupt(), true);
});

test('cortar: termina el turno y el proceso sigue; si claude no hace caso, se mata y se retoma', async () => {
  const c = chat();
  const end = turnEnd(c);
  await c.send('lento');
  await until(() => text(c).length > 0);
  c.interrupt();
  assert.deepEqual(await end, { event: 'end', ok: false, interrupted: true, cost: 0.01, ms: 5 });
  assert.ok(c.alive);
  await say(c, 'sigo');
  assert.equal((await launches()).length, 1);

  const d = chat({ interruptMs: 50 });
  const end2 = turnEnd(d);
  await d.send('colgado');
  await until(() => text(d).length > 0);
  d.interrupt();
  assert.deepEqual(await end2, { event: 'end', ok: false, interrupted: true });
  await until(() => !d.alive);
  assert.equal((await say(d, 'de nuevo')).ok, true);
  const l = (await launches()).filter((x) => x.argv.includes(d.session));
  assert.deepEqual(l.map((x) => x.argv.includes('--resume')), [false, true]);
});

test('sin uso se cierra; el siguiente mensaje lo relanza', async () => {
  const c = chat({ idleMs: 30 });
  await say(c, 'hola');
  await until(() => !c.alive);
  await say(c, 'otra vez');
  assert.equal((await launches()).length, 2);
});

test('sin claude: claude_missing, y la conversación se puede volver a usar', async () => {
  const c = chat({ env: { ...env, SCOMPASS_CLAUDE: join(root, 'no-está') } });
  await assert.rejects(c.send('hola'), { code: 'claude_missing' });
  assert.equal(c.busy, false);
  c.env = env;
  assert.equal((await say(c, 'hola')).ok, true);
});

test('si claude se cae en medio del turno: error con lo que dijo y fin del turno', async () => {
  const c = chat();
  const end = await say(c, 'morir');
  assert.deepEqual(end, { event: 'end', ok: false, interrupted: false });
  assert.deepEqual(c.events.find((e) => e.event === 'error'), { event: 'error', code: 'claude_exit', message: 'se cayó' });
  assert.equal(c.alive, false);
});

test('el hijo no hereda que corre adentro de Claude Code', async () => {
  const c = chat({ env: { ...env, CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' } });
  await say(c, 'hola');
  assert.equal((await launches())[0].claudecode, null);
});

test('si no se sabe si la sesión existe, prueba una vez al revés: retomarla o crearla', async () => {
  // Creada, pero la conversación cree que no: --session-id da "already in use" y se retoma.
  const c = chat();
  await say(c, 'uno');
  c.close();
  await until(() => !c.alive);
  const d = chat({ session: c.session, resume: false });
  assert.equal((await say(d, 'dos')).ok, true);
  assert.equal(text(d), 'eco: dos');
  let l = (await launches()).filter((x) => x.argv.includes(c.session));
  assert.deepEqual(l.map((x) => x.argv.includes('--resume')), [false, false, true]);
  // Nunca llegó a existir y la conversación cree que sí: --resume no la encuentra y se crea.
  const e = chat({ resume: true });
  assert.equal((await say(e, 'tres')).ok, true);
  l = (await launches()).filter((x) => x.argv.includes(e.session));
  assert.deepEqual(l.map((x) => x.argv.includes('--resume')), [true, false]);
  assert.ok(!e.events.some((x) => x.event === 'error'));
});

test('si tampoco anda al revés, el error dice lo que dijo claude', async () => {
  const c = chat({ resume: true, env: { ...env, FAKE_CLAUDE_STATE: join(root, 'solo-lectura') } });
  await writeFile(join(root, 'solo-lectura'), '');
  const end = await say(c, 'hola');
  assert.equal(end.ok, false);
  assert.ok(c.events.some((x) => x.event === 'error'));
});
