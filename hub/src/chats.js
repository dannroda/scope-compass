// Conversaciones del chat (M25, spec §32, 25.3): qué conversaciones hay en un proyecto y una copia liviana de lo
// que se mostró. Viven en la carpeta del chat del proyecto (chatDir), fuera de compass/: index.json
// ({ chats: [{ id, title, created_at, last_at, started?, engine?, agy_session? }] }) y un <id>.jsonl por conversación.
// Con claude, el id es el de la sesión de Claude Code, que guarda la conversación de verdad y la retoma con --resume;
// started dice que ya existe. Con agy (engine: 'agy', §47) el id lo elige el hub y agy_session es el sessionId de agy.
// ChatManager junta eso con un ChatProcess por conversación en uso.
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ChatError, ChatProcess, chatDir } from './chat.js';
import { AgyProcess } from './chat-agy.js';
import { ENGINES, engineFor } from './chat-engine.js';
import { DEFAULT_PROFILE, listProfiles, saveLimits, sessionProfile } from './profiles.js';
import { writeAtomic } from './store/atomic.js';
import { T } from './i18n.js';

const TITLE = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** El título de una conversación: el comienzo del primer mensaje, en una línea. */
export function chatTitle(text) {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > TITLE ? `${t.slice(0, TITLE - 1)}…` : t;
}

/** El mensaje que recibe claude: con una tarea abierta en la web, la nombra delante (el agente la lee con show_task). */
export function withTask(text, task) {
  if (!task) return text;
  return T`Tarea abierta: ${task.code ? `${task.code} ` : ''}${task.title} (compass://task/${task.id})\n\n${text}`;
}

export function chatStore(projectDir, { now = () => new Date().toISOString() } = {}) {
  const dir = chatDir(projectDir);
  const index = join(dir, 'index.json');
  const copy = (id) => {
    if (!UUID.test(id)) throw new ChatError('not_found', T`no hay una conversación ${id}`);
    return join(dir, `${id}.jsonl`);
  };
  // Las escrituras del índice, de a una (un solo proceso sirve el proyecto). fn recibe las conversaciones y el
  // índice entero (para el perfil del proyecto, §33).
  let queue = Promise.resolve();
  const change = (fn) => {
    const p = queue.then(async () => {
      const idx = await read();
      const out = fn(idx.chats, idx);
      await mkdir(dir, { recursive: true });
      await writeAtomic(index, `${JSON.stringify(idx, null, 2)}\n`);
      return out;
    });
    queue = p.catch(() => {});
    return p;
  };
  async function read() {
    try {
      const idx = JSON.parse(await readFile(index, 'utf8'));
      return { ...idx, chats: Array.isArray(idx?.chats) ? idx.chats : [] };
    } catch (e) {
      if (e.code === 'ENOENT' || e instanceof SyntaxError) return { chats: [] };
      throw e;
    }
  }
  const list = async () => (await read()).chats;
  return {
    /** Las conversaciones, la última usada primero. */
    async list() { return (await list()).sort((a, b) => b.last_at.localeCompare(a.last_at)); },
    async get(id) { return (await list()).find((c) => c.id === id) ?? null; },
    /**
     * Una conversación nueva; con session, una sesión de Claude Code que ya existe (started) y se creó afuera.
     * profile: su perfil (§33); el predeterminado no se anota.
     */
    create(text, { session, profile, engine = 'claude' } = {}) {
      const at = now();
      const chat = { id: session ?? randomUUID(), title: chatTitle(text), created_at: at, last_at: at, ...(session && { started: true, external: true }),
        ...(engine === 'agy' ? { engine } : profile && profile !== DEFAULT_PROFILE && { profile }) };
      return change((chats) => { chats.push(chat); return chat; });
    },
    /** Anota que se usó (y que la sesión de Claude Code ya existe, con started). */
    touch(id, { started = false, agySession } = {}) {
      return change((chats) => {
        const c = chats.find((x) => x.id === id);
        if (!c) return null;
        c.last_at = now();
        if (started) c.started = true;
        if (agySession) c.agy_session = agySession;
        return c;
      });
    },
    /** El perfil que el proyecto usa para las conversaciones nuevas (§33). */
    async profile() { return (await read()).profile ?? DEFAULT_PROFILE; },
    setProfile(profile) { return change((chats, idx) => { idx.profile = profile; return profile; }); },
    async remove(id) {
      const found = await change((chats) => {
        const i = chats.findIndex((x) => x.id === id);
        return i < 0 ? false : (chats.splice(i, 1), true);
      });
      if (found) await rm(copy(id), { force: true });
      return found;
    },
    async append(id, entry) {
      await mkdir(dir, { recursive: true });
      await appendFile(copy(id), `${JSON.stringify({ ...entry, at: entry.at ?? now() })}\n`);
    },
    /** La copia de la conversación: [{ role: 'user', text, task?, at } | { role: 'assistant', text, tools, ok, … }]. */
    async read(id) {
      let text;
      try { text = await readFile(copy(id), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
      return text.split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
    },
  };
}

/**
 * Las conversaciones de un proyecto con sus procesos: crea, manda, corta y borra, guarda la copia al final de cada
 * turno y emite 'event' con { chat, ...evento } (los de ChatProcess) para el WebSocket. close() cierra los procesos.
 */
export class ChatManager extends EventEmitter {
  constructor({ projectDir, name, env = process.env, now, idleMs, interruptMs }) {
    super();
    Object.assign(this, { projectDir, name, env, idleMs, interruptMs });
    this.now = now ?? (() => new Date().toISOString());
    this.store = chatStore(projectDir, { now });
    this.procs = new Map();
    this.turns = new Map();
    this.saving = new Map();
    // Lo que falta guardar del último fin de turno de cada conversación (la respuesta y la fecha): get lo espera.
    this.ending = new Map();
    this.pending = new Set();
  }

  list() { return this.store.list(); }

  /** Una conversación con su copia, si hay un turno en curso y lo que va de él. */
  async get(id) {
    // Recién terminado un turno, la respuesta se está guardando: sin esperarla, daba busy false y la copia sin ella.
    await this.ending.get(id);
    const chat = await this.store.get(id);
    if (!chat) throw new ChatError('not_found', T`no hay una conversación ${id}`);
    const turn = this.turns.get(id);
    return { chat, entries: await this.store.read(id), busy: !!turn, turn: turn ? { text: turn.text, tools: turn.tools } : null };
  }

  /**
   * Crea una conversación y le manda el primer mensaje. task: { id, code, title } de la tarea abierta en la web.
   * session: retomar una sesión de Claude Code de afuera (la que hizo una pregunta, §32); si ya está en la lista,
   * solo se le manda el mensaje.
   */
  async create(text, { task, session, profile, engine } = {}) {
    if (session && !UUID.test(session)) throw new ChatError('invalid_argument', T('session tiene que ser el id de una sesión de Claude Code'));
    const known = session ? await this.store.get(session) : null;
    if (known) {
      await this.send(known.id, text, { task });
      return known;
    }
    // El motor: una sesión de afuera es de Claude Code; una nueva, el pedido o el elegido en Ajustes (§47).
    if (engine !== undefined && !ENGINES.includes(engine)) throw new ChatError('invalid_argument', T`motor desconocido: ${engine} (claude o agy)`);
    engine = session ? 'claude' : (engine ?? engineFor(this.env));
    // Una sesión de afuera, en el perfil donde está (§33); una nueva, en el elegido, que queda para las siguientes.
    if (engine === 'agy') profile = undefined;
    else if (session) profile = sessionProfile(session, this.profiles())?.id ?? DEFAULT_PROFILE;
    else if (profile !== undefined) {
      this.profileOf(profile);
      await this.store.setProfile(profile);
    } else profile = await this.store.profile();
    const chat = await this.store.create(text, { session, profile, engine });
    try {
      await this.send(chat.id, text, { task });
    } catch (e) {
      await this.store.remove(chat.id);
      throw e;
    }
    return chat;
  }

  async send(id, text, { task } = {}) {
    const chat = await this.store.get(id);
    if (!chat) throw new ChatError('not_found', T`no hay una conversación ${id}`);
    const proc = this.#proc(chat);
    await proc.send(withTask(text, task));
    // El fin del turno espera a que esté guardado el mensaje, así la copia queda en orden.
    const saved = this.store.append(id, { role: 'user', text, ...(task ? { task: task.id } : {}) });
    this.saving.set(id, saved.catch(() => {}));
    await saved;
  }

  interrupt(id) { return this.procs.get(id)?.interrupt() ?? false; }

  /** Los perfiles de Claude Code del equipo (§33). */
  profiles() { return listProfiles(this.env); }
  profileOf(id) {
    const p = this.profiles().find((x) => x.id === (id ?? DEFAULT_PROFILE));
    if (!p) throw new ChatError('invalid_argument', T`no hay un perfil ${id} de Claude Code en este equipo`);
    return p;
  }
  async setProfile(id) {
    this.profileOf(id);
    return this.store.setProfile(id);
  }

  async remove(id) {
    this.procs.get(id)?.close();
    this.procs.delete(id);
    this.turns.delete(id);
    if (!await this.store.remove(id)) throw new ChatError('not_found', T`no hay una conversación ${id}`);
  }

  /** Cierra los procesos; termina cuando está guardado lo que quedó de los turnos cortados. */
  async close() {
    await Promise.all([...this.procs.values()].map((p) => p.close()));
    this.procs.clear();
    await Promise.all(this.pending);
  }

  #proc(chat) {
    let proc = this.procs.get(chat.id);
    if (proc) return proc;
    const opts = chat.engine === 'agy'
      ? { projectDir: this.projectDir, name: this.name, session: chat.id, agySession: chat.agy_session ?? null, env: this.env }
      : { projectDir: this.projectDir, name: this.name, session: chat.id, resume: !!chat.started, retry: !chat.external, profile: this.profileOf(chat.profile), env: this.env };
    if (this.idleMs !== undefined) opts.idleMs = this.idleMs;
    if (this.interruptMs !== undefined) opts.interruptMs = this.interruptMs;
    proc = chat.engine === 'agy' ? new AgyProcess(opts) : new ChatProcess(opts);
    proc.on('event', (e) => this.#event(chat.id, proc, e));
    this.procs.set(chat.id, proc);
    return proc;
  }

  // Arma la respuesta del turno con lo que va llegando y la guarda en la copia al terminar.
  #event(id, proc, e) {
    // El sessionId de agy se anota enseguida: si el hub se cierra en medio del turno, la conversación se retoma igual.
    if (e.event === 'session') {
      const saved = this.store.touch(id, { agySession: e.agySession }).catch(() => {});
      this.pending.add(saved);
      saved.finally(() => this.pending.delete(saved));
      return;
    }
    // Los límites son de la cuenta del perfil: se guardan y salen con el perfil, no con la respuesta.
    if (e.event === 'limits') {
      const profile = proc.profile?.id ?? DEFAULT_PROFILE;
      const at = this.now();
      const saved = saveLimits(profile, e.limits, at).catch(() => {});
      this.pending.add(saved);
      saved.finally(() => this.pending.delete(saved));
      this.emit('event', { chat: id, event: 'limits', profile, limits: e.limits, at });
      return;
    }
    if (e.event === 'turn') this.turns.set(id, { text: '', tools: [], errors: [] });
    const turn = this.turns.get(id);
    if (turn) {
      if (e.event === 'text') turn.text += e.text;
      else if (e.event === 'tool') turn.tools.push({ id: e.id, name: e.name, brief: e.brief });
      else if (e.event === 'tool_result') {
        const t = turn.tools.find((x) => x.id === e.id);
        if (t) t.ok = e.ok;
      } else if (e.event === 'error') turn.errors.push(e.message);
      else if (e.event === 'end') {
        this.turns.delete(id);
        const entry = { role: 'assistant', text: turn.text, tools: turn.tools.map(({ id: _, ...t }) => t), ok: e.ok };
        if (e.interrupted) entry.interrupted = true;
        const error = [e.error, ...turn.errors].filter(Boolean).join('\n');
        if (error) entry.error = error;
        if (e.cost !== undefined) entry.cost = e.cost;
        if (e.tokens) entry.tokens = e.tokens;
        const save = (this.saving.get(id) ?? Promise.resolve()).then(() => this.store.append(id, entry)).then(() => this.store.touch(id, { started: proc.resume }));
        const done = save.catch((err) => this.emit('event', { chat: id, event: 'error', code: 'io_error', message: err.message }))
          .then(() => this.emit('event', { chat: id, ...e }));
        this.pending.add(done);
        this.ending.set(id, done);
        done.finally(() => {
          this.pending.delete(done);
          if (this.ending.get(id) === done) this.ending.delete(id);
        });
        return;
      }
    }
    this.emit('event', { chat: id, ...e });
  }
}
