#!/usr/bin/env node
// Un claude falso para los tests del chat (§32, 25.5): habla stream-json como `claude -p --input-format stream-json
// --output-format stream-json`, sin red ni tokens. Lo que hace depende del mensaje:
//   "herramienta …" usa show_task y contesta; "lento …" escribe de a poco y se puede cortar; "colgado …" escribe de
//   a poco y no hace caso al corte; "morir" se cae con un error; cualquier otro, "eco: <mensaje>" en dos partes.
// FAKE_CLAUDE_LOG: agrega una línea JSON por lanzamiento ({ argv, cwd, claudecode, config }).
// Las sesiones se anotan en FAKE_CLAUDE_STATE (una carpeta) o, sin ella, como el real: en la carpeta del perfil
// (CLAUDE_CONFIG_DIR, o ~/.claude), en projects/fake/<sesión>.jsonl. --resume de una que no existe falla.
// `auth status --json` responde el fake-account.json de la carpeta del perfil, o sin login.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
const configDir = process.env.CLAUDE_CONFIG_DIR || join(process.env.HOME || homedir(), '.claude');
if (argv[0] === 'auth') {
  let account = { loggedIn: false, authMethod: 'none', apiProvider: 'firstParty' };
  try { account = JSON.parse(readFileSync(join(configDir, 'fake-account.json'), 'utf8')); } catch {}
  process.stdout.write(JSON.stringify(account, null, 2) + '\n');
  process.exit(0);
}
if (process.env.FAKE_CLAUDE_LOG) {
  appendFileSync(process.env.FAKE_CLAUDE_LOG, `${JSON.stringify({ argv, cwd: process.cwd(), claudecode: process.env.CLAUDECODE ?? null, config: process.env.CLAUDE_CONFIG_DIR ?? null })}\n`);
}
const resume = opt('--resume');
const session = resume ?? opt('--session-id');
// Nunca en el ~/.claude de verdad: fuera de la carpeta temporal, las sesiones van a una propia.
let state = process.env.FAKE_CLAUDE_STATE || join(configDir, 'projects', 'fake');
if (!process.env.FAKE_CLAUDE_STATE && !state.startsWith(tmpdir())) state = join(tmpdir(), 'fake-claude-sessions');
// Los errores del real: el id ya usado con --session-id, o --resume de una sesión que no existe.
if (state) {
  mkdirSync(state, { recursive: true });
  const file = (id) => join(state, process.env.FAKE_CLAUDE_STATE ? id : `${id}.jsonl`);
  if (!resume && existsSync(file(session))) {
    process.stderr.write(`Error: Session ID ${session} is already in use.\n`);
    process.exit(1);
  }
  if (resume && !existsSync(file(resume))) {
    process.stdout.write(`No conversation found with session ID: ${resume}\n`);
    process.stdout.write(`${JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: resume, total_cost_usd: 0 })}\n`);
    process.exit(1);
  }
  writeFileSync(file(session), '');
}

const out = (msg) => process.stdout.write(`${JSON.stringify({ ...msg, session_id: session })}\n`);
const delta = (text) => out({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } });
const result = (text) => out({ type: 'result', subtype: 'success', is_error: false, terminal_reason: 'completed', result: text, total_cost_usd: 0.01, duration_ms: 5 });
let writing = null;

function slow(obey) {
  let n = 0;
  writing = { obey, timer: setInterval(() => delta(`${++n} `), 20) };
}

createInterface({ input: process.stdin }).on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.type === 'control_request' && msg.request?.subtype === 'interrupt') {
    out({ type: 'control_response', response: { subtype: 'success', request_id: msg.request_id, response: { still_queued: [] } } });
    if (!writing?.obey) return;
    clearInterval(writing.timer);
    writing = null;
    out({ type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } });
    out({ type: 'result', subtype: 'error_during_execution', is_error: true, terminal_reason: 'aborted_streaming', total_cost_usd: 0.01, duration_ms: 5 });
    return;
  }
  if (msg.type !== 'user') return;
  const text = msg.message.content;
  // La tarea abierta que el chat pone delante no cambia qué hacer.
  const said = text.replace(/^Tarea abierta: [^\n]*\n\n/, '');
  out({ type: 'system', subtype: 'init', cwd: process.cwd(), tools: ['Read', 'Grep', 'Glob'] });
  if (said === 'morir') {
    process.stderr.write('se cayó\n');
    process.exit(3);
  }
  if (said.startsWith('lento')) return slow(true);
  if (said.startsWith('colgado')) return slow(false);
  if (said.startsWith('herramienta')) {
    out({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id: 'toolu_1', name: 'mcp__scompass__show_task', input: { id: 'm1-01' } }] } });
    out({ type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '{}' }] } });
    delta('listo');
    return result('listo');
  }
  const answer = `eco: ${text}`;
  delta(answer.slice(0, 4));
  delta(answer.slice(4));
  out({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: answer }] } });
  result(answer);
}).on('close', () => process.exit(0));
