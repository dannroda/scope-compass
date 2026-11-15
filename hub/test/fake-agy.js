#!/usr/bin/env node
// Un agy falso para los tests del chat con agy (§47): habla ACP como `agy acp` (JSON-RPC 2.0, una línea por mensaje),
// sin red ni cuota, con los eventos que dio agy 1.4.12 en la prueba real. Lo que hace depende del mensaje:
//   "scompass …" usa mcp_scompass_show_task y contesta; "leer …" pide permiso para leer y contesta;
//   "permiso …" pide permiso para escribir un archivo y, si se lo niegan, termina el turno sin texto (como agy);
//   "colarse …" escribe un archivo sin pedir permiso (lo que pasa con agentMode auto); "lento …" escribe de a poco y
//   hace caso a session/cancel; "colgado …" escribe de a poco y no hace caso; "morir" se cae con un error;
//   cualquier otro, "eco: <mensaje>" en dos partes.
// FAKE_AGY_LOG: una línea JSON por lanzamiento ({ type: 'launch', argv, cwd, claudecode, settings }) y por pedido
// ({ type: <método>, params }). Las sesiones se anotan en FAKE_AGY_STATE (una carpeta); session/resume de una que no
// existe falla. No hay carpeta de ajustes (--gemini-dir + --app-data-dir sin settings.json): no arranca.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
const state = process.env.FAKE_AGY_STATE || join(process.cwd(), '.fake-agy');
const settingsFile = join(opt('--gemini-dir') ?? '', opt('--app-data-dir') ?? 'antigravity-cli', 'settings.json');
const settings = (() => { try { return JSON.parse(readFileSync(settingsFile, 'utf8')); } catch { return null; } })();
const log = (entry) => { if (process.env.FAKE_AGY_LOG) appendFileSync(process.env.FAKE_AGY_LOG, `${JSON.stringify(entry)}\n`); };
log({ type: 'launch', argv, cwd: process.cwd(), claudecode: process.env.CLAUDECODE ?? null, settings });

const send = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
const update = (sessionId, u) => send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: u } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ids = 1000;
const waiting = new Map();
const ask = (method, params) => new Promise((resolve) => { const id = ++ids; waiting.set(id, resolve); send({ jsonrpc: '2.0', id, method, params }); });
let cancelled = false;

async function prompt(sessionId, text) {
  cancelled = false;
  const tool = (id, name, kind, title, rawInput) => ({ sessionUpdate: 'tool_call', toolCallId: id, name, kind, title, rawInput, status: 'in_progress' });
  const say = (t) => update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: t } });
  update(sessionId, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'pensando' } });
  const msg = text.split('\n---\n\n').pop();
  if (msg.startsWith('morir')) {
    process.stderr.write('se cayó agy\n');
    process.exit(3);
  }
  if (msg.startsWith('scompass')) {
    update(sessionId, tool('c1', 'mcp_scompass_show_task', 'other', 'Run mcp_scompass_show_task', { id: 'm1-01' }));
    update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'c1', status: 'completed', kind: 'other' });
    say('la tarea ');
    say('está en curso');
    return 'end_turn';
  }
  if (msg.startsWith('leer') || msg.startsWith('permiso')) {
    const read = msg.startsWith('leer');
    const call = read ? tool('c2', 'read_file', 'read', 'File note.txt', { Path: 'note.txt' }) : tool('c2', 'write_file', 'edit', 'File out.txt', { Path: 'out.txt', Content: 'hi' });
    update(sessionId, call);
    const r = await ask('session/request_permission', { sessionId, toolCall: { ...call, status: 'pending' }, options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }, { optionId: 'deny', name: 'Deny', kind: 'reject_once' }] });
    log({ type: 'permission', tool: call.name, outcome: r?.outcome });
    const ok = r?.outcome?.outcome === 'selected' && r.outcome.optionId === 'allow';
    if (ok && !read) writeFileSync(join(process.cwd(), 'out.txt'), 'hi');
    update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'c2', status: ok ? 'completed' : 'failed', kind: call.kind });
    if (!ok) return 'end_turn';
    say(read ? 'leído' : 'escrito');
    return 'end_turn';
  }
  if (msg.startsWith('colarse')) {
    update(sessionId, tool('c3', 'write_file', 'edit', 'File out.txt', { Path: 'out.txt', Content: 'hi' }));
    writeFileSync(join(process.cwd(), 'out.txt'), 'hi');
    update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: 'c3', status: 'completed', kind: 'edit' });
    say('escrito');
    return 'end_turn';
  }
  if (msg.startsWith('lento') || msg.startsWith('colgado')) {
    for (let i = 0; i < 100; i++) {
      if (cancelled && msg.startsWith('lento')) return 'cancelled';
      say('.');
      await sleep(50);
    }
    return 'end_turn';
  }
  say('eco: ');
  say(msg);
  return 'end_turn';
}

createInterface({ input: process.stdin }).on('line', async (line) => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (m.id !== undefined && !m.method) { const r = waiting.get(m.id); waiting.delete(m.id); r?.(m.result); return; }
  log({ type: m.method, params: m.params });
  const reply = (result) => send({ jsonrpc: '2.0', id: m.id, result });
  const fail = (message) => send({ jsonrpc: '2.0', id: m.id, error: { code: -32603, message } });
  if (m.method === 'initialize') return reply({ protocolVersion: 1, agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} } }, agentInfo: { name: 'fake agy', version: '0' } });
  if (m.method === 'session/new') {
    if (!settings) return fail(`Failed to start Antigravity: no settings in ${settingsFile}`);
    const sessionId = `agy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    mkdirSync(state, { recursive: true });
    writeFileSync(join(state, sessionId), '');
    return reply({ sessionId, models: { currentModelId: 'fake' }, configOptions: [] });
  }
  if (m.method === 'session/resume') {
    if (!existsSync(join(state, m.params.sessionId))) return fail(`session not found: ${m.params.sessionId}`);
    return reply({});
  }
  if (m.method === 'session/cancel') { cancelled = true; return; }
  if (m.method === 'session/prompt') {
    const text = (m.params.prompt ?? []).map((p) => p.text ?? '').join('');
    appendFileSync(join(state, m.params.sessionId), `${text}\n`);
    const stopReason = await prompt(m.params.sessionId, text);
    return reply({ stopReason, usage: { inputTokens: 100, outputTokens: 7, cachedReadTokens: 3, cachedWriteTokens: 0, totalTokens: 110 } });
  }
  if (m.id !== undefined) fail(`Method not found: ${m.method}`);
});
