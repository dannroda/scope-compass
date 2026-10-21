// Chat (M25, spec §32, D43): el hub lanza el Claude Code instalado con stream-json, un proceso por conversación,
// en la carpeta del proyecto. Cada mensaje del usuario es una línea en stdin; los eventos se leen línea por línea
// de stdout y se pasan a unos pocos (texto, herramienta, resultado de la herramienta, fin del turno). Solo tiene el
// MCP scompass y las herramientas de lectura, permitidos de antemano: lo demás se niega sin preguntar. El proceso
// se cierra tras un rato sin uso y el siguiente mensaje lo vuelve a lanzar con --resume.
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { projectsFile } from './projects.js';

const WIN = process.platform === 'win32';
const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'scompass.js');
export const IDLE_MS = 10 * 60 * 1000;
export const INTERRUPT_MS = 5000;
export const TOOLS = ['Read', 'Grep', 'Glob'];

/** Dónde guarda el hub lo del chat de un proyecto: junto a projects.json, fuera de compass/ (es de la máquina). */
export function chatDir(projectDir) {
  return join(dirname(projectsFile()), 'chats', createHash('sha1').update(projectDir).digest('hex'));
}

/**
 * El ejecutable de Claude Code: SCOMPASS_CLAUDE si está (un .js se corre con node, para el test), si no `claude`
 * del PATH (en Windows también claude.exe y claude.cmd). null si no está.
 */
export function findClaude(env = process.env) {
  if (env.SCOMPASS_CLAUDE) return existsSync(env.SCOMPASS_CLAUDE) ? env.SCOMPASS_CLAUDE : null;
  const names = WIN ? ['claude.exe', 'claude.cmd', 'claude'] : ['claude'];
  for (const d of (env.PATH ?? env.Path ?? '').split(delimiter)) {
    for (const n of names) {
      const p = join(d, n);
      try { if (statSync(p).isFile()) return p; } catch {}
    }
  }
  return null;
}

const PROMPT = (name) => `Sos el chat de Scope Compass del proyecto «${name}», en la web del tablero. El tablero se opera con las herramientas del MCP scompass y valen las reglas de compass/AGENTS.md: registrá las decisiones que tomes sin consultar (add_decision) y las preguntas que hagas, y pasá a review las tareas que termines. Podés leer los archivos del proyecto; no podés editarlos ni correr comandos: si hace falta, decí qué hacer en la terminal. Contestá en el idioma del usuario, corto.`;

/** Los argumentos de claude (§32): la primera vez fija el id de la sesión, después la retoma. */
export function claudeArgs({ session, resume, mcpConfig, promptFile }) {
  return ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    resume ? '--resume' : '--session-id', session,
    '--mcp-config', mcpConfig, '--strict-mcp-config',
    '--tools', TOOLS.join(','), '--allowedTools', ['mcp__scompass', ...TOOLS].join(','),
    '--permission-mode', 'dontAsk', '--permission-prompts', 'none',
    '--append-system-prompt-file', promptFile];
}

// Lo que no entra en un renglón de la web: el resumen de los argumentos de una herramienta.
const brief = (input) => {
  if (!input || typeof input !== 'object') return '';
  const v = input.file_path ?? input.pattern ?? input.path ?? input.id ?? input.title ?? input.q ?? input.text ?? input.ref ?? Object.values(input).find((x) => typeof x === 'string');
  return typeof v === 'string' ? (v.length > 80 ? `${v.slice(0, 79)}…` : v) : '';
};

/**
 * Un evento de stream-json, pasado a los del chat (§32): { event: 'init' | 'text' | 'tool' | 'tool_result' | 'end' },
 * o null si no hace falta mostrarlo. Lo de los subagentes (parent_tool_use_id) no se muestra.
 */
export function chatEvents(msg) {
  if (!msg || msg.parent_tool_use_id) return [];
  if (msg.type === 'system' && msg.subtype === 'init') return [{ event: 'init', session: msg.session_id }];
  if (msg.type === 'stream_event' && msg.event?.type === 'content_block_delta' && msg.event.delta?.type === 'text_delta') {
    return [{ event: 'text', text: msg.event.delta.text }];
  }
  const content = Array.isArray(msg.message?.content) ? msg.message.content : [];
  if (msg.type === 'assistant') {
    return content.filter((c) => c.type === 'tool_use')
      .map((c) => ({ event: 'tool', id: c.id, name: c.name.replace(/^mcp__scompass__/, ''), brief: brief(c.input) }));
  }
  if (msg.type === 'user') {
    return content.filter((c) => c.type === 'tool_result').map((c) => ({ event: 'tool_result', id: c.tool_use_id, ok: !c.is_error }));
  }
  if (msg.type === 'result') {
    const interrupted = msg.terminal_reason === 'aborted_streaming';
    const end = { event: 'end', ok: !msg.is_error, interrupted };
    if (msg.total_cost_usd !== undefined) end.cost = msg.total_cost_usd;
    if (msg.duration_ms !== undefined) end.ms = msg.duration_ms;
    if (msg.is_error && !interrupted) end.error = String(msg.result ?? msg.subtype ?? 'error');
    return [end];
  }
  return [];
}

export class ChatError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/**
 * Una conversación: lanza claude cuando hace falta, le manda los mensajes y emite 'event' con los del chat
 * (más { event: 'turn', text } al mandar y { event: 'error', code, message } si el proceso falla). Un turno por vez.
 * session es el id de la sesión de Claude Code (un uuid); resume, si ya existe.
 */
export class ChatProcess extends EventEmitter {
  constructor({ projectDir, name, session, resume = false, env = process.env, idleMs = IDLE_MS, interruptMs = INTERRUPT_MS }) {
    super();
    Object.assign(this, { projectDir, name: name ?? projectDir, session, resume, env, idleMs, interruptMs });
    this.child = null;
    this.busy = false;
    this.idle = null;
    this.stopping = null;
  }

  get alive() { return this.child !== null; }

  async send(text) {
    if (this.busy) throw new ChatError('busy', 'hay un turno en curso');
    this.busy = true;
    clearTimeout(this.idle);
    try {
      if (!this.child) await this.#start();
    } catch (e) {
      this.busy = false;
      throw e;
    }
    this.emit('event', { event: 'turn', text });
    this.message = `${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`;
    this.child.stdin.write(this.message);
  }

  /** Corta el turno en curso; si claude no lo termina en interruptMs, se mata y el próximo mensaje lo retoma. */
  interrupt() {
    if (!this.busy || !this.child) return false;
    const child = this.child;
    child.stdin.write(`${JSON.stringify({ type: 'control_request', request_id: `i${Date.now()}`, request: { subtype: 'interrupt' } })}\n`);
    this.stopping = setTimeout(() => {
      if (this.child !== child || !this.busy) return;
      this.#endTurn({ event: 'end', ok: false, interrupted: true });
      child.kill();
    }, this.interruptMs);
    return true;
  }

  /** Cierra el proceso (sin uso, o al cerrar el hub). La conversación sigue con --resume. */
  close() {
    clearTimeout(this.idle);
    const child = this.child;
    if (!child) return;
    if (this.busy) this.#endTurn({ event: 'end', ok: false, interrupted: true });
    child.stdin.end();
    const t = setTimeout(() => child.kill(), 2000);
    t.unref();
    child.once('close', () => clearTimeout(t));
  }

  async #start() {
    const exe = findClaude(this.env);
    if (!exe) throw new ChatError('claude_missing', 'no se encontró claude (Claude Code); instalalo y entrá con `claude` una vez');
    const dir = chatDir(this.projectDir);
    await mkdir(dir, { recursive: true });
    const mcpConfig = join(dir, 'mcp.json');
    const promptFile = join(dir, 'prompt.md');
    await writeFile(mcpConfig, JSON.stringify({ mcpServers: { scompass: { command: process.execPath, args: [BIN, 'mcp', '--dir', this.projectDir] } } }, null, 2));
    await writeFile(promptFile, PROMPT(this.name));
    const args = claudeArgs({ session: this.session, resume: this.resume, mcpConfig, promptFile });
    // Si el hub corre adentro de una sesión de Claude Code, el hijo no tiene que creerse anidado.
    const env = { ...this.env };
    for (const k of Object.keys(env)) if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_')) delete env[k];
    const js = /\.m?js$/i.test(exe);
    const cmd = WIN && /\.cmd$/i.test(exe);
    const child = spawn(js ? process.execPath : exe, js ? [exe, ...args] : cmd ? args.map((a) => `"${a}"`) : args,
      { cwd: this.projectDir, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: cmd });
    this.child = child;
    // Lo que dijo claude fuera del protocolo (y el error de un resultado antes del init), para el mensaje de error.
    let said = '';
    let inited = false;
    child.stderr.on('data', (d) => { said = (said + d).slice(-2000); });
    child.stdin.on('error', () => {});
    createInterface({ input: child.stdout }).on('line', (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { said = (said + line + '\n').slice(-2000); return; }
      for (const e of chatEvents(msg)) {
        if (e.event === 'init') { inited = true; this.resume = true; this.retried = false; continue; }
        if (e.event === 'end' && !inited) { if (e.error) said += `${e.error}\n`; continue; }
        if (e.event === 'end') this.#endTurn(e);
        else if (this.child === child) this.emit('event', e);
      }
    });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', (e) => {
        if (this.child === child) this.child = null;
        reject(e.code === 'ENOENT' ? new ChatError('claude_missing', `no se pudo lanzar ${exe}`) : e);
      });
    });
    // close y no exit: llega después de leer toda la salida, así un resultado que llegó al final no se pierde.
    child.once('close', async (code) => {
      if (this.child !== child) return;
      this.child = null;
      clearTimeout(this.idle);
      if (!this.busy) return;
      // Si el hub se cerró antes de que claude confirmara la sesión, no se sabe si existe: claude dice que el id
      // ya está en uso (había que retomarla) o que no la encuentra (había que crearla). Se prueba una vez al revés.
      const wrong = !inited && !this.retried && /already in use|No conversation found/i.test(said);
      if (wrong) {
        this.retried = true;
        this.resume = !this.resume;
        try {
          await this.#start();
          this.child.stdin.write(this.message);
          return;
        } catch (e) {
          said = e.message;
        }
      }
      this.emit('event', { event: 'error', code: 'claude_exit', message: said.trim() || `claude terminó (código ${code})` });
      this.#endTurn({ event: 'end', ok: false, interrupted: false });
    });
  }

  #endTurn(e) {
    if (!this.busy) return;
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
