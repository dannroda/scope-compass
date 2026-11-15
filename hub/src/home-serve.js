// El Inicio como multi-hub (spec §17, D29): sirve cada proyecto del registro en /p/<clave>/ con la misma app del
// hub (createServer), sin que esa app escuche en un puerto. Los pedidos HTTP le llegan con inject() y su WebSocket
// lo atiende attachSocket. Un solo proceso escribe cada compass/: si el proyecto ya tiene un hub suelto (el del
// dock, `scompass serve`), el Inicio le reenvía HTTP y WebSocket en lugar de servirlo él.
import { randomBytes } from 'node:crypto';
import { basename, join } from 'node:path';
import { slugify, freeId } from './lists.js';
import { hubsOf, registerServed, unregisterServed } from './registry.js';
import { createServer } from './server.js';
import { createJsonFilesStore } from './store/json-files.js';
import { attachSocket } from './ws.js';
import { isLoopback } from './chat-api.js';
import { T } from './i18n.js';

/**
 * Clave de cada proyecto en la URL (/p/<clave>/): el nombre de su carpeta como slug, sin repetir, en orden. keys: las
 * que ya se dieron (19.5): un proyecto conserva la suya aunque se quite otro anterior con el mismo nombre, así una
 * pestaña abierta o la base anotada en el registro no pasan a otro proyecto.
 */
export function projectKeys(projects, keys = new Map()) {
  for (const p of projects) if (!keys.has(p.path)) keys.set(p.path, freeId(slugify(basename(p.path)), [...keys.values()]));
  return keys;
}

// Cabeceras que pasan del navegador al hub y de vuelta.
const IN = ['content-type', 'if-match', 'if-none-match', 'accept', 'accept-language'];
// nosniff y la CSP con sandbox de /api/files/raw también pasan (19.8).
const OUT = ['content-type', 'etag', 'location', 'cache-control', 'x-content-type-options', 'content-security-policy'];

// Cabecera con que el Inicio le dice al hub de un proyecto que sirve él (sin puerto, solo por inject) que el pedido
// es de un dispositivo vinculado (§49). Lleva un secreto de este proceso: no se puede mandar desde afuera, y además
// IN no deja pasar cabeceras que no conoce.
const LINKED = 'x-scompass-linked';

/**
 * Registra /p/:key, /p/:key/* y /p/:key/ws en la app del Inicio. projects(): el registro con su estado
 * (projectsStatus). onChange(path, evt): un cambio en un proyecto que sirve el Inicio (para avisar a sus pestañas).
 * devices: los dispositivos vinculados (createDevices, §49); sin él, el chat es solo de este equipo.
 * Devuelve { served(path), close() }.
 */
export function registerProjectRoutes(app, { validators, projects, onChange, devices = null, port: portOf = () => app.server?.address()?.port }) {
  const secret = randomBytes(24).toString('base64url');
  const chatAllow = (req) => isLoopback(req.socket.remoteAddress) || req.headers[LINKED] === secret;
  // Los WebSocket de dispositivos vinculados, para cerrarlos al desvincular.
  const linkedSockets = new Map(); // id → Set(socket)
  const onRemoved = (id) => { for (const s of linkedSockets.get(id) ?? []) s.close(4403, T('dispositivo desvinculado')); linkedSockets.delete(id); };
  devices?.events.on('removed', onRemoved);
  const linkSocket = (socket, device) => {
    if (!device) return;
    if (!linkedSockets.has(device.id)) linkedSockets.set(device.id, new Set());
    linkedSockets.get(device.id).add(socket);
    socket.on('close', () => linkedSockets.get(device.id)?.delete(socket));
  };
  const live = new Map(); // path → { key, hub, ready }
  const given = new Map(); // path → clave, mientras viva el Inicio
  const keyed = () => {
    const list = projects().filter((p) => p.found);
    const keys = projectKeys(list, given);
    return { list, keys };
  };
  const find = (key) => {
    const { list, keys } = keyed();
    const p = list.find((x) => keys.get(x.path) === key);
    return p ? { ...p, key } : null;
  };

  // La app del hub de un proyecto, creada la primera vez que se la pide (con su watcher y su export).
  async function activate(p) {
    let entry = live.get(p.path);
    if (!entry) {
      const hub = createServer({ projectDir: p.path, store: createJsonFilesStore(join(p.path, 'compass'), { validators }), validators, watch: true, exportMd: true, chatAllow });
      hub.events.on('event', (e) => onChange?.(p.path, e));
      entry = { key: p.key, hub, ready: hub.ready().then(() => registerServed({ port: portOf(), project: p.path, base: `/p/${p.key}`, key: p.key })) };
      live.set(p.path, entry);
    }
    await entry.ready;
    return entry.hub;
  }
  // Quién sirve el proyecto ahora: un hub suelto (se le reenvía) o el Inicio.
  const route = (p) => {
    const standalone = hubsOf(p.path).find((h) => h.pid !== process.pid);
    return standalone && !live.has(p.path) ? { port: standalone.port } : null;
  };

  const missing = (reply, key) => reply.code(404).send({ error: { code: 'not_found', message: T`no hay un proyecto "${key}" en el Inicio` } });

  app.get('/p/:key', (req, reply) => reply.redirect(`/p/${encodeURIComponent(req.params.key)}/`));

  // El límite del cuerpo alcanza para una captura en base64 (18.4); el hub del proyecto aplica el suyo, más fino.
  app.all('/p/:key/*', { bodyLimit: 16 << 20 }, async (req, reply) => {
    const p = find(req.params.key);
    if (!p) return missing(reply, req.params.key);
    // La ruta cruda, sin decodificar: params['*'] vuelve "docs%2Fspec%2Fia" en "docs/spec/ia" y el hub no la encuentra.
    const url = req.url.slice(req.url.indexOf('/', 3));
    // El chat solo desde este equipo o un dispositivo vinculado (§32, §49): el hub del proyecto ve al Inicio como
    // 127.0.0.1, así que se mira acá. Sobre la ruta decodificada, para que "/api/%63hats" no se saltee el chequeo.
    const local = isLoopback(req.socket.remoteAddress);
    const isChat = /^api\/(chats|chat-engine)(\/|$)/.test(req.params['*']);
    const linked = isChat && !local && devices ? devices.of(req) : null;
    if (isChat && !local && !linked) {
      return reply.code(403).send({ error: { code: 'forbidden', message: T('el chat solo anda en este equipo (127.0.0.1)') } });
    }
    const headers = Object.fromEntries(IN.filter((h) => req.headers[h] !== undefined).map((h) => [h, req.headers[h]]));
    const payload = req.body === undefined || req.body === null ? undefined : typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const base = `/p/${encodeURIComponent(p.key)}`;
    const proxy = route(p);
    let status, outHeaders, body;
    if (proxy) {
      const r = await fetch(`http://127.0.0.1:${proxy.port}${url}`, { method: req.method, headers, body: payload }).catch(() => null);
      if (!r) return reply.code(502).send({ error: { code: 'io_error', message: T('el hub del proyecto no responde') } });
      status = r.status;
      outHeaders = Object.fromEntries(OUT.filter((h) => r.headers.get(h) !== null).map((h) => [h, r.headers.get(h)]));
      body = Buffer.from(await r.arrayBuffer());
    } else {
      const hub = await activate(p);
      // Al hub suelto no: él atiende el chat porque el pedido le llega del Inicio, desde 127.0.0.1.
      if (linked) headers[LINKED] = secret;
      const r = await hub.inject({ method: req.method, url, headers, payload, remoteAddress: req.socket.remoteAddress });
      status = r.statusCode;
      outHeaders = Object.fromEntries(OUT.filter((h) => r.headers[h] !== undefined).map((h) => [h, r.headers[h]]));
      body = r.rawPayload;
    }
    if (outHeaders.location?.startsWith('/')) outHeaders.location = base + outHeaders.location;
    return reply.code(status).headers(outHeaders).send(body);
  });

  // El WebSocket del tablero: contra la app del proyecto, o un puente al hub suelto.
  app.register(async (scope) => {
    scope.get('/p/:key/ws', { websocket: true }, async (socket, req) => {
      const p = find(req.params.key);
      if (!p) { socket.close(4404, T('no existe el proyecto')); return; }
      const proxy = route(p);
      const local = isLoopback(req.socket.remoteAddress);
      // Un dispositivo vinculado recibe los eventos del chat mientras siga vinculado (§49).
      const device = !local && devices ? devices.of(req) : null;
      linkSocket(socket, device);
      const chat = () => local || (!!device && devices.has(device.id));
      if (!proxy) {
        const hub = await activate(p);
        attachSocket(socket, { app: hub, ...hub.hub, chat });
        return;
      }
      const up = new WebSocket(`ws://127.0.0.1:${proxy.port}/ws`);
      const pending = [];
      up.addEventListener('open', () => { for (const m of pending.splice(0)) up.send(m); });
      // El hub suelto ve al Inicio como local: los eventos del chat se filtran acá.
      up.addEventListener('message', (m) => {
        const data = String(m.data);
        if (data.startsWith('{"type":"chat"') && !chat()) return;
        if (socket.readyState === socket.OPEN) socket.send(data);
      });
      up.addEventListener('close', () => socket.close());
      up.addEventListener('error', () => socket.close());
      socket.on('message', (d) => (up.readyState === WebSocket.OPEN ? up.send(String(d)) : pending.push(String(d))));
      socket.on('close', () => up.close());
    });
  });

  return {
    served: (path) => (live.has(path) ? 'home' : hubsOf(path).some((h) => h.pid !== process.pid) ? 'hub' : null),
    keyOf: (path) => keyed().keys.get(path) ?? null,
    // El store y el publish de un proyecto que sirve este Inicio (para escribir sin pasar por HTTP), o null.
    local: (path) => (live.has(path) ? { store: live.get(path).hub.hub.store, publish: live.get(path).hub.hub.publish } : null),
    // Activar un proyecto sin pedirle nada (el "Iniciar hub" del dock con el Inicio corriendo, 9.5).
    activate: async (path) => { const { list, keys } = keyed(); const p = list.find((x) => x.path === path); if (!p) return null; await activate({ ...p, key: keys.get(path) }); return `/p/${keys.get(path)}`; },
    async close() { devices?.events.off('removed', onRemoved); unregisterServed(); for (const e of live.values()) await e.hub.close().catch(() => {}); live.clear(); }
  };
}
