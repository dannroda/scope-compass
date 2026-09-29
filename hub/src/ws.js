// WebSocket del hub (spec §5.5): reenvía los eventos de app.events y acepta `update` de tareas.
// Servidor → cliente: hello, upsert, delete, warning, ack, error. Cliente → servidor: update.
import websocket from '@fastify/websocket';
import { StoreError } from './store/json-files.js';
import { flat } from './views.js';

// Plugin de Fastify: app.register(registerWs, { store, publish, version }).
export async function registerWs(app, { store, publish, version }) {
  // Al cerrar el hub, los clientes se cortan en el acto (el cierre educado espera hasta 30 s).
  await app.register(websocket, {
    preClose(done) {
      for (const client of this.websocketServer.clients) client.terminate();
      this.websocketServer.close(done);
    }
  });

  app.get('/ws', { websocket: true }, (socket) => {
    const send = (msg) => { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg)); };
    const forward = (evt) => send(evt);
    app.events.on('event', forward);
    socket.on('close', () => app.events.off('event', forward));
    send({ type: 'hello', server_version: version });

    socket.on('message', async (data) => {
      let msg;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return send({ type: 'error', req: null, code: 'invalid_argument', message: 'mensaje que no es JSON' });
      }
      const req = msg?.req ?? null;
      try {
        if (msg?.type !== 'update') throw new StoreError('invalid_argument', `tipo de mensaje desconocido: ${msg?.type}`);
        if (msg.collection !== 'tasks') throw new StoreError('invalid_argument', 'update solo admite la colección tasks');
        if (!msg.patch || typeof msg.patch !== 'object' || Array.isArray(msg.patch)) {
          throw new StoreError('invalid_argument', 'falta patch (objeto)');
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
  });
}
