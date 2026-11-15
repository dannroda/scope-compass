// Chat con Antigravity CLI (M27, spec §47, D58): el hub lanza `agy acp` y le habla ACP (JSON-RPC 2.0 por stdio, una
// línea por mensaje). Misma forma que ChatProcess (chat.js): send, interrupt, close y 'event' con los del chat.
// Solo lectura: agy corre con ajustes propios del chat (~/.gemini/scope-compass-chat/settings.json, agentMode vacío y
// toolPermission strict), así cada edición y cada comando le piden permiso al hub, que solo deja leer y usar scompass.
// Si algo que edita o corre comandos termina sin haber pedido permiso, el hub corta el proceso.
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { brief, ChatError, chatPrompt, IDLE_MS, INTERRUPT_MS } from './chat.js';
import { cleanEnv } from './profiles.js';
import { selfCommand } from './self.js';
import { T } from './i18n.js';

const WIN = process.platform === 'win32';
/** La carpeta de los ajustes del chat, relativa a ~/.gemini (agy no acepta otra cosa en --app-data-dir). */
export const AGY_APP_DIR = 'scope-compass-chat';
/** Lo que tienen que decir los ajustes del chat para que cada edición y cada comando pidan permiso. */
export const AGY_SETTINGS = { agentMode: '', toolPermission: 'strict' };
// Lo que edita o corre algo: si termina sin haber pedido permiso, los ajustes no están funcionando.
const GATED = new Set(['edit', 'delete', 'move', 'execute']);

/** El ejecutable de agy: SCOMPASS_AGY si está (un .js se corre con node, para el test), si no `agy` del PATH. */
export function findAgy(env = process.env) {
  if (env.SCOMPASS_AGY) return existsSync(env.SCOMPASS_AGY) ? env.SCOMPASS_AGY : null;
  const names = WIN ? ['agy.exe', 'agy.cmd', 'agy'] : ['agy'];
  for (const d of (env.PATH ?? env.Path ?? '').split(delimiter)) {
    for (const n of names) {
      const p = join(d, n);
      try { if (statSync(p).isFile()) return p; } catch {}
    }
  }
  return null;
}

/** ~/.gemini, o SCOMPASS_GEMINI_DIR (para el test). */
export const geminiDir = (env = process.env) => env.SCOMPASS_GEMINI_DIR || join(env.HOME || env.USERPROFILE || homedir(), '.gemini');
export const agySettingsFile = (env = process.env) => join(geminiDir(env), AGY_APP_DIR, 'settings.json');

/**
 * Los ajustes del chat: si no están, los crea; si están y dicen otra cosa en agentMode o toolPermission, no los pisa
 * y falla con agy_unsafe (el chat no arranca sin poder negar las ediciones).
 */
export async function ensureAgySettings(env = process.env) {
  const file = agySettingsFile(env);
  let text = null;
  try { text = await readFile(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (text === null) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(AGY_SETTINGS, null, 2)}\n`);
    return file;
  }
  let s = null;
  try { s = JSON.parse(text.replace(/^﻿/, '')); } catch {}
  const wrong = Object.entries(AGY_SETTINGS).filter(([k, v]) => s?.[k] !== v);
  if (wrong.length) {
    throw new ChatError('agy_unsafe', T`${file} tiene que decir ${wrong.map(([k, v]) => `"${k}": ${JSON.stringify(v)}`).join(' y ')}: sin eso agy edita archivos sin pedir permiso y el chat no arranca. Corregilo o borralo (el hub lo vuelve a crear).`);
  }
  return file;
}

/** Los argumentos de agy acp: los ajustes del chat (y otra carpeta de ~/.gemini, para el test). */
export function agyArgs(env = process.env) {
  return ['acp', '--app-data-dir', AGY_APP_DIR, ...(env.SCOMPASS_GEMINI_DIR ? ['--gemini-dir', env.SCOMPASS_GEMINI_DIR] : [])];
}

/** El nombre de una herramienta como se muestra: las de scompass sin el prefijo. */
export const agyToolName = (name) => String(name ?? '').replace(/^mcp_scompass_/, '');

/** Si el hub deja usar esta herramienta: leer y scompass sí; editar, borrar, mover, comandos y la web no. */
export const agyAllowed = (call) => String(call?.name ?? '').startsWith('mcp_scompass_') || ['read', 'search'].includes(call?.kind);

/**
 * Una conversación con agy. session es el id de la conversación en el hub (se le pasa al MCP como
 * SCOMPASS_CHAT_SESSION); agySession, el sessionId de agy si ya existe. Emite 'event' como ChatProcess y además
 * { event: 'session', agySession } cuando agy da o cambia el id.
 */
export class AgyProcess extends EventEmitter {
  constructor({ projectDir, name, session, agySession = null, env = process.env, idleMs = IDLE_MS, interruptMs = INTERRUPT_MS }) {
    super();
    Object.assign(this, { projectDir, name: name ?? projectDir, session, agySession, env, idleMs, interruptMs });
    this.profile = null;
    this.child = null;
    this.busy = false;
    this.idle = null;
    this.stopping = null;
    this.ids = 0;
    this.pending = new Map();
    this.fresh = false;
  }

  get alive() { return this.child !== null; }
  // Para ChatManager: una conversación de agy ya existe cuando agy dio su id.
  get resume() { return !!this.agySession; }

  async send(text) {
    if (this.busy) throw new ChatError('busy', T('hay un turno en curso'));
    this.busy = true;
    clearTimeout(this.idle);
    try {
      if (!this.child) await this.#start();
    } catch (e) {
      this.busy = false;
      if (this.child) this.#kill();
      throw e;
    }
    this.emit('event', { event: 'turn', text });
    this.turn = { text: '', denied: [], tools: new Map() };
    // Una sesión nueva lleva delante las instrucciones del chat (§32), como prompt.md con claude.
    const prompt = this.fresh ? `${chatPrompt(this.name)}\n\n---\n\n${text}` : text;
    this.fresh = false;
    const child = this.child;
    this.#call('session/prompt', { sessionId: this.agySession, prompt: [{ type: 'text', text: prompt }] }).then((r) => {
      if (this.child !== child) return;
      const u = r?.usage;
      const end = { event: 'end', ok: r?.stopReason !== 'refusal', interrupted: r?.stopReason === 'cancelled' };
      if (u) end.tokens = { input: u.inputTokens ?? 0, output: u.outputTokens ?? 0, cache_read: u.cachedReadTokens ?? 0, cache_write: u.cachedWriteTokens ?? 0 };
      this.#endTurn(end);
    }, (err) => {
      if (this.child !== child) return;
      this.#endTurn({ event: 'end', ok: false, interrupted: false, error: err.message });
    });
  }

  /** Corta el turno con session/cancel; si agy no lo termina en interruptMs, se mata y se retoma después. */
  interrupt() {
    if (!this.busy || !this.child) return false;
    const child = this.child;
    this.#notify('session/cancel', { sessionId: this.agySession });
    this.stopping = setTimeout(() => {
      if (this.child !== child || !this.busy) return;
      this.#endTurn({ event: 'end', ok: false, interrupted: true });
      this.#kill();
    }, this.interruptMs);
    return true;
  }

  close() {
    clearTimeout(this.idle);
    const child = this.child;
    if (!child) return Promise.resolve();
    if (this.busy) this.#endTurn({ event: 'end', ok: false, interrupted: true });
    const closed = child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise((r) => child.once('close', r));
    this.child = null;
    child.stdin.end();
    const t = setTimeout(() => child.kill(), 2000);
    t.unref();
    child.once('close', () => clearTimeout(t));
    return closed;
  }

  #kill() {
    const child = this.child;
    this.child = null;
    for (const { reject } of this.pending.values()) reject(new Error(T('agy se cerró')));
    this.pending.clear();
    child?.kill();
  }

  #write(msg) { this.child?.stdin.write(`${JSON.stringify(msg)}\n`); }
  #notify(method, params) { this.#write({ jsonrpc: '2.0', method, params }); }
  #call(method, params) {
    const id = ++this.ids;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.#write({ jsonrpc: '2.0', id, method, params });
    });
  }

  async #start() {
    const exe = findAgy(this.env);
    if (!exe) throw new ChatError('agy_missing', T('no se encontró agy (Antigravity CLI); instalalo y entrá con `agy` una vez'));
    await ensureAgySettings(this.env);
    const js = /\.m?js$/i.test(exe);
    const cmd = WIN && /\.cmd$/i.test(exe);
    const args = agyArgs(this.env);
    const child = spawn(js ? process.execPath : exe, js ? [exe, ...args] : cmd ? args.map((a) => `"${a}"`) : args,
      { cwd: this.projectDir, env: cleanEnv(this.env), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: cmd });
    this.child = child;
    let said = '';
    child.stderr.on('data', (d) => { said = (said + d).slice(-2000); });
    child.stdin.on('error', () => {});
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (this.child !== child) return;
      let msg;
      try { msg = JSON.parse(line); } catch { said = (said + line + '\n').slice(-2000); return; }
      this.#message(msg);
    });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', (e) => {
        if (this.child === child) this.child = null;
        reject(e.code === 'ENOENT' ? new ChatError('agy_missing', T`no se pudo lanzar ${exe}`) : e);
      });
    });
    child.once('close', (code) => {
      if (this.child !== child) return;
      this.child = null;
      clearTimeout(this.idle);
      for (const { reject } of this.pending.values()) reject(new Error(said.trim() || T`agy terminó (código ${code})`));
      this.pending.clear();
      if (!this.busy) return;
      this.emit('event', { event: 'error', code: 'agy_exit', message: said.trim() || T`agy terminó (código ${code})` });
      this.#endTurn({ event: 'end', ok: false, interrupted: false });
    });
    const failed = (e) => new ChatError('agy_exit', said.trim() || e.message);
    try {
      await this.#call('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } });
    } catch (e) { throw failed(e); }
    const [command, args0] = selfCommand(['mcp', '--dir', this.projectDir]);
    const mcpServers = [{ name: 'scompass', command, args: args0, env: [{ name: 'SCOMPASS_CHAT_SESSION', value: this.session }] }];
    if (this.agySession) {
      try {
        await this.#call('session/resume', { sessionId: this.agySession, cwd: this.projectDir, mcpServers });
        return;
      } catch {
        this.emit('event', { event: 'error', code: 'agy_resume', message: T('agy no pudo retomar la conversación: sigue en una sesión nueva, sin lo anterior') });
      }
    }
    let r;
    try { r = await this.#call('session/new', { cwd: this.projectDir, mcpServers }); } catch (e) { throw failed(e); }
    if (!r?.sessionId) throw new ChatError('agy_exit', T('agy no devolvió el id de la sesión'));
    this.agySession = r.sessionId;
    this.fresh = true;
    this.emit('event', { event: 'session', agySession: r.sessionId });
  }

  #message(msg) {
    // Respuesta a un pedido del hub.
    if (msg.id !== undefined && !msg.method) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) p?.reject(new Error(msg.error.message ?? 'error'));
      else p?.resolve(msg.result);
      return;
    }
    if (msg.method === 'session/request_permission') {
      const call = msg.params?.toolCall ?? {};
      const options = msg.params?.options ?? [];
      const ok = agyAllowed(call);
      const opt = ok ? options.find((o) => o.kind === 'allow_once') : (options.find((o) => o.kind === 'reject_once') ?? options.find((o) => o.kind?.startsWith('reject')));
      if (this.turn) {
        const t = this.turn.tools.get(call.toolCallId) ?? {};
        t.asked = true;
        this.turn.tools.set(call.toolCallId, t);
        if (!ok) this.turn.denied.push(call.title || agyToolName(call.name));
      }
      this.#write({ jsonrpc: '2.0', id: msg.id, result: { outcome: opt ? { outcome: 'selected', optionId: opt.optionId } : { outcome: 'cancelled' } } });
      return;
    }
    if (msg.method === 'session/update') { this.#update(msg.params?.update ?? {}); return; }
    // Otro pedido de agy (archivos, terminal): el hub no los ofrece.
    if (msg.id !== undefined && msg.method) this.#write({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'not supported' } });
  }

  #update(u) {
    if (!this.busy || !this.turn) return;
    if (u.sessionUpdate === 'agent_message_chunk' && u.content?.type === 'text' && u.content.text) {
      this.turn.text += u.content.text;
      this.emit('event', { event: 'text', text: u.content.text });
      return;
    }
    if (u.sessionUpdate === 'tool_call') {
      const t = this.turn.tools.get(u.toolCallId) ?? {};
      Object.assign(t, { kind: u.kind, name: u.name, shown: true });
      this.turn.tools.set(u.toolCallId, t);
      this.emit('event', { event: 'tool', id: u.toolCallId, name: agyToolName(u.name) || u.title || '?', brief: brief(u.rawInput ?? u.args) || (u.title ?? '') });
    }
    if (u.sessionUpdate === 'tool_call' || u.sessionUpdate === 'tool_call_update') {
      const t = this.turn.tools.get(u.toolCallId) ?? {};
      if (u.kind) t.kind = u.kind;
      this.turn.tools.set(u.toolCallId, t);
      if (u.status !== 'completed' && u.status !== 'failed') return;
      if (t.done) return;
      t.done = true;
      // Algo que edita o corre comandos y terminó sin pedir permiso: los ajustes del chat no están funcionando.
      if (u.status === 'completed' && GATED.has(t.kind) && !t.asked) {
        this.emit('event', { event: 'error', code: 'agy_unsafe', message: T`agy usó ${t.name ?? u.title ?? '?'} sin pedir permiso: el chat se cortó. Revisá ${agySettingsFile(this.env)} (agentMode "", toolPermission "strict").` });
        this.#endTurn({ event: 'end', ok: false, interrupted: false });
        this.#kill();
        return;
      }
      if (t.shown) this.emit('event', { event: 'tool_result', id: u.toolCallId, ok: u.status === 'completed' });
    }
  }

  #endTurn(e) {
    if (!this.busy) return;
    // agy suele cortar el turno después de un rechazo, sin decir nada: lo dice el chat.
    if (this.turn && !this.turn.text.trim() && this.turn.denied.length) {
      this.emit('event', { event: 'text', text: T`No se hizo: ${[...new Set(this.turn.denied)].join(', ')}. El chat solo lee el proyecto y opera el tablero; para editar o correr comandos, usá la terminal.` });
    }
    this.turn = null;
    this.busy = false;
    clearTimeout(this.stopping);
    this.emit('event', e);
    clearTimeout(this.idle);
    if (this.child) {
      this.idle = setTimeout(() => this.close(), this.idleMs);
      this.idle.unref();
    }
  }
}
