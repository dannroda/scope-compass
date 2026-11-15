// API del chat (M25, spec §32, 25.4): conversaciones con el Claude Code instalado. Los eventos de cada turno salen
// por el WebSocket del proyecto como { type: 'chat', chat, event, … }. Solo para pedidos desde el mismo equipo
// (la dirección del socket, no el Host): el chat corre un agente con la cuenta del usuario y lee el repo, y sin
// login no se abre a la red aunque haya --lan (D43). Con token (hosting) está apagado.
import { basename } from 'node:path';
import { ChatError, findClaude } from './chat.js';
import { ChatManager } from './chats.js';
import { accountOf, loadLimits } from './profiles.js';
import { StoreError } from './store/json-files.js';
import { T } from './i18n.js';

/** Si una dirección es del mismo equipo (127.0.0.1, ::1 o 127.0.0.1 escrita como IPv6). */
export const isLoopback = (addr) => addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';

const STATUS = { busy: 409, not_found: 404, claude_missing: 503, forbidden: 403, invalid_argument: 400 };

// allow(req): si el pedido puede usar el chat. Por defecto, solo desde este equipo; el Inicio suma los dispositivos
// vinculados (§49) para los proyectos que sirve él.
export function registerChatApi(app, { projectDir, store, emit, token = null, env = process.env, allow = (req) => isLoopback(req.socket.remoteAddress) }) {
  let manager = null;
  const chats = async () => {
    if (!manager) {
      const { config } = await store.loadAll();
      manager = new ChatManager({ projectDir, name: config?.project ?? basename(projectDir), env });
      manager.on('event', (e) => emit({ type: 'chat', ...e }));
    }
    return manager;
  };
  app.addHook('onClose', async () => manager?.close());

  // La tarea abierta en la web, para nombrarla en el mensaje.
  const taskOf = async (id) => {
    if (id === undefined || id === null) return undefined;
    if (typeof id !== 'string') throw new ChatError('invalid_argument', T('task tiene que ser el id de una tarea'));
    const r = await store.get('tasks', id).catch(() => null);
    if (!r) throw new ChatError('invalid_argument', T`no existe la tarea ${id}`);
    return { id: r.id, code: r.doc.code, title: r.doc.title };
  };
  const textOf = (body) => {
    const text = body?.text;
    if (typeof text !== 'string' || !text.trim()) throw new ChatError('invalid_argument', T('falta text'));
    return text;
  };

  app.register(async (scope) => {
    scope.addHook('onRequest', async (req) => {
      if (token) throw new ChatError('forbidden', T('el chat está apagado en un hub con token'));
      if (!allow(req)) throw new ChatError('forbidden', T('el chat solo anda en este equipo (127.0.0.1)'));
    });
    scope.setErrorHandler((err, req, reply) => {
      if (err instanceof ChatError || err instanceof StoreError) {
        return reply.code(STATUS[err.code] ?? 500).send({ error: { code: err.code, message: err.message } });
      }
      if (err.statusCode >= 400 && err.statusCode < 500) {
        return reply.code(err.statusCode).send({ error: { code: 'invalid_argument', message: err.message } });
      }
      req.log.error(err);
      return reply.code(500).send({ error: { code: 'io_error', message: err.message } });
    });

    scope.get('/api/chats', async () => {
      const m = await chats();
      return { chats: await m.list(), claude: findClaude(env) !== null, profile: await m.store.profile() };
    });
    // Perfiles de Claude Code con su cuenta (§33): claude auth status por perfil, guardado un rato.
    scope.get('/api/chats/profiles', async () => {
      const m = await chats();
      const limits = await loadLimits();
      const profiles = await Promise.all(m.profiles().map(async (p) => ({ ...p, account: await accountOf(p, { env }), limits: limits[p.id] ?? null })));
      return { profiles, profile: await m.store.profile() };
    });
    scope.put('/api/chats/profile', async (req) => {
      const profile = req.body?.profile;
      if (typeof profile !== 'string') throw new ChatError('invalid_argument', T('falta profile'));
      return { profile: await (await chats()).setProfile(profile) };
    });
    scope.post('/api/chats', async (req, reply) => {
      const text = textOf(req.body);
      const session = req.body.session ?? undefined;
      if (session !== undefined && typeof session !== 'string') throw new ChatError('invalid_argument', T('session tiene que ser un texto'));
      const profile = req.body.profile ?? undefined;
      if (profile !== undefined && typeof profile !== 'string') throw new ChatError('invalid_argument', T('profile tiene que ser un texto'));
      const chat = await (await chats()).create(text, { task: await taskOf(req.body.task), session, profile });
      return reply.code(201).send(chat);
    });
    scope.get('/api/chats/:id', async (req) => (await chats()).get(req.params.id));
    scope.post('/api/chats/:id/messages', async (req, reply) => {
      const text = textOf(req.body);
      await (await chats()).send(req.params.id, text, { task: await taskOf(req.body.task) });
      return reply.code(202).send({ ok: true });
    });
    scope.post('/api/chats/:id/interrupt', async (req) => {
      const m = await chats();
      await m.get(req.params.id);
      return { interrupted: m.interrupt(req.params.id) };
    });
    scope.delete('/api/chats/:id', async (req, reply) => {
      await (await chats()).remove(req.params.id);
      return reply.code(204).send();
    });
  });
}
