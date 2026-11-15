// WebSocket del hub (spec §5.5): reenvía los eventos de app.events y acepta `update` de tareas.
// Servidor → cliente: hello, upsert, delete, warning, ack, error, focus, chat. Cliente → servidor: update, presence.
import websocket from '@fastify/websocket';
import { StoreError } from './store/json-files.js';
import { flat } from './views.js';
import { isLoopback } from './chat-api.js';
import { PROTOCOL } from './protocol.js';
import { T } from './i18n.js';

// Plugin de Fastify: app.register(registerWs, { store, publish, version, boards }).
// boards: Set con el `send` de cada pestaña del tablero que puede notificar (ver app.focusBoard).
export async function registerWs(app, { store, publish, version, boards = new Set() }) {
  // Al cerrar el hub, los clientes se cortan en el acto (el cierre educado espera hasta 30 s).
  await app.register(websocket, {
    preClose(done) {
      for (const client of this.websocketServer.clients) client.terminate();
      this.websocketServer.close(done);
    }
  });

  app.get('/ws', { websocket: true }, (socket, req) => attachSocket(socket, { app, store, publish, version, boards, local: isLoopback(req.socket.remoteAddress) }));
}

/**
 * Atiende un WebSocket del protocolo de §5.5 contra un hub: le manda sus eventos y recibe `update` y `presence`.
 * Lo usan el hub suelto (/ws) y el Inicio, que sirve el hub de cada proyecto en /p/<clave>/ws sin que el hub
 * escuche en un puerto propio (D29). app: la app del hub (sus `events` y su log). local: si el cliente está en este
 * equipo; si no, no recibe los eventos del chat (§32).
 */
export function attachSocket(socket, { app, store, publish, version, boards, local = false }) {
  const send = (msg) => { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg)); };
  const forward = (evt) => { if (evt.type !== 'chat' || local) send(evt); };
  app.events.on('event', forward);
  socket.on('close', () => { app.events.off('event', forward); boards.delete(send); });
  send({ type: 'hello', server_version: version, protocol: PROTOCOL });

  socket.on('message', async (data) => {
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return send({ type: 'error', req: null, code: 'invalid_argument', message: T('mensaje que no es JSON') });
    }
    const req = msg?.req ?? null;
    if (msg?.type === 'presence') {
      boards.delete(send);
      if (msg.notify === true) boards.add(send);
      return;
    }
    try {
      if (msg?.type !== 'update') throw new StoreError('invalid_argument', T`tipo de mensaje desconocido: ${msg?.type}`);
      if (msg.collection !== 'tasks') throw new StoreError('invalid_argument', T('update solo admite la colección tasks'));
      if (!msg.patch || typeof msg.patch !== 'object' || Array.isArray(msg.patch)) {
        throw new StoreError('invalid_argument', T('falta patch (objeto)'));
      }
      const { id: _id, etag: _etag, ...patch } = msg.patch;
      const r = await store.patch('tasks', msg.id, patch, msg.etag === undefined ? {} : { ifMatch: msg.etag });
      send({ type: 'ack', req, doc: flat(r.id, r.doc, r.etag) });
      publish.upsert('tasks', r);
    } catch (e) {
      // Un error inesperado no puede tumbar el hub: se responde como io_error.
      if (!(e instanceof StoreError)) app.log.error(e);
      const err = { type: 'error', req, code: e instanceof StoreError ? e.code : 'io_error', message: e.message };
      if (e.current) err.doc = flat(e.current.id, e.current.doc, e.current.etag);
      send(err);
    }
  });
}
