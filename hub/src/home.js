// Inicio (`scompass home`, spec §16.2, D24): un proceso aparte que conoce todos los proyectos del registro (D23),
// los lee de disco y habla con sus hubs vivos. No reemplaza a ningún hub: cada proyecto sigue con el suyo.
//   GET    /api/health
//   GET    /api/projects                     registro + estado del hub + resumen de cada proyecto
//   POST   /api/projects        { path }     importar (anotar sin levantar el hub)
//   DELETE /api/projects?path=…              quitar del registro (no toca los datos)
//   GET    /api/today                        preguntas abiertas, vencido, de hoy y en curso (items) y lo que vence en
//                                            los próximos 7 días (week, 31.3), de todos los proyectos
//   POST   /api/projects/check-item  { path, list, n, etag? }   tildar un ítem (los que se repiten avanzan)
//   POST   /api/projects/add-item    { path, list, text, due?, etag? }   anotar un ítem (31.2), como `item add`
//   POST   /api/projects/move-task   { path, id, status, etag? }
//   POST   /api/projects/start   { path }          levanta su hub como hijo del Inicio (muere con él)
//   POST   /api/projects/stop    { path, force? }  apaga su hub; uno que abrió otro (el dock) pide force
//   GET    /api/templates                    plantillas para crear un proyecto
//   POST   /api/projects/init  { name, template, path? }   crea compass/ con `scompass init` y lo anota (sin path:
//                                            en la carpeta de datos del usuario, D28)
//   POST   /api/devices/code                 solo local: código de un solo uso para vincular un teléfono (§49)
//   POST   /api/devices/pair    { code, name }   canjea el código por el token del dispositivo, en una cookie
//   GET    /api/devices                      solo local: los dispositivos vinculados
//   DELETE /api/devices/:id                  solo local: desvincular (cierra sus WebSocket)
//   GET    /vincular                         la página del teléfono que canjea el código (#código en la dirección)
//   GET    /api/upgrade[?force=1]            ¿hay un binario más nuevo? (§39, D62; la consulta a GitHub se guarda un día)
//   POST   /api/upgrade                      solo local: lo baja y lo pone en lugar del que corre; el Inicio sigue con
//                                            el anterior hasta reiniciarse (POST /api/restart)
//   GET    /ws                               { type: 'changed', path, collection?, id? } | { type: 'hubs' } | { type: 'projects' } | { type: 'devices' } | { type: 'upgrade' }
// Las escrituras pasan por el hub del proyecto si está vivo (lo publica a sus pestañas y al dock); si no, van
// directo a compass/ con etag, como la CLI, y regeneran el export markdown.
import { execFile, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { exportMarkdown } from './export-md.js';
import { checkItem, newItem } from './lists.js';
import { pickFolder } from './desktop.js';
import { folderName, forgetProject, loadProjects, projectsDataDir, projectsFile, projectsStatus, ProjectsError, recordProject } from './projects.js';
import { hubsOf, listHubs } from './registry.js';
import { localOnly, PROTOCOL, VERSION, WEB_DIR } from './server.js';
import { langRoutes, T } from './i18n.js';
import { createHttpStore, detectHub, hubCompatible } from './store/http.js';
import { createJsonFilesStore, StoreError } from './store/json-files.js';
import { loadCompass } from './store/load.js';
import { byToday, summarize, todayOf, weekOf } from './summary.js';
import { registerProjectRoutes } from './home-serve.js';
import { isLoopback } from './chat-api.js';
import { createDevices, deviceCookie, DeviceError } from './devices.js';
import { outdatedFiles, updateAllCompasses, updateCompass } from './update.js';
import { boardStatus, repoWorktree } from './git.js';
import { boardsDir, linkBoard, listBoards } from './board.js';
import { listTemplates, loadTemplate } from './templates.js';
import { STATUSES } from './views.js';
import { IS_BINARY, selfCommand } from './self.js';
import { checkUpgrade, installUpgrade, UpgradeError } from './upgrade.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

const HTTP_STATUS = { invalid_argument: 400, forbidden: 403, not_found: 404, conflict: 409, invalid_file: 409, invalid: 409, io_error: 500, not_binary: 409 };

// now: función que devuelve la fecha "de hoy" (los tests la fijan). pollMs: cada cuánto mira el registro de hubs
// (medio segundo: un hub que se levanta se ve en el Inicio en menos de 1 s, §16.8). lan(): las direcciones de la red
// donde escucha (`--lan`, D36), para vincular un teléfono (§49); null si solo escucha en 127.0.0.1. devices: las
// opciones de createDevices (los tests acortan los tiempos).
export function createHomeServer({ validators, now = () => new Date(), pollMs = 500, logger = false, webDir = WEB_DIR, onRestart = null, onShutdown = null, lan = () => null, devices: deviceOptions = {}, upgrade: upgradeOptions = {} }) {
  const app = Fastify({ logger, forceCloseConnections: true });
  langRoutes(app);
  localOnly(app);
  const events = new EventEmitter();
  app.decorate('events', events);
  const emit = (e) => events.emit('event', e);
  // Un solo plugin de WebSocket para el del Inicio (/ws) y el de cada proyecto (/p/<clave>/ws).
  app.register(websocket, {
    preClose(done) { for (const c of this.websocketServer.clients) c.terminate(); this.websocketServer.close(done); }
  });
  // Teléfonos vinculados para el chat (§49).
  const devices = createDevices(deviceOptions);
  app.addHook('onClose', async () => devices.close());
  // La lista del Inicio se pone al día también si se desvinculó con la CLI.
  devices.events.on('removed', () => emit({ type: 'devices' }));
  // Multi-hub (D29): cada proyecto en /p/<clave>/, servido acá o reenviado a su hub suelto.
  const serving = registerProjectRoutes(app, {
    validators,
    devices,
    projects: () => { try { return projectsStatus(); } catch { return []; } },
    onChange: (path, e) => { if (e.type === 'upsert' || e.type === 'delete') emit({ type: 'changed', path, collection: e.collection, id: e.id }); }
  });
  app.addHook('onClose', () => serving.close());
  app.decorate('serving', serving);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof UpgradeError) return reply.code(err.code === 'offline' ? 502 : HTTP_STATUS[err.code] ?? 500).send({ error: { code: err.code, message: err.message } });
    if (err instanceof DeviceError) return reply.code(HTTP_STATUS[err.code] ?? 500).send({ error: { code: err.code, message: err.message } });
    if (err instanceof StoreError || err instanceof ProjectsError) {
      const body = { error: { code: err.code, message: err.message } };
      if (err.current) body.error.current = err.current;
      if (err.foreign) body.error.foreign = true;
      return reply.code(HTTP_STATUS[err.code] ?? 500).send(body);
    }
    if (err.statusCode >= 400 && err.statusCode < 500) return reply.code(err.statusCode).send({ error: { code: 'invalid_argument', message: err.message } });
    req.log.error(err);
    return reply.code(500).send({ error: { code: 'io_error', message: err.message } });
  });
  app.setNotFoundHandler((req, reply) => reply.code(404).send({ error: { code: 'not_found', message: T`no existe ${req.method} ${req.url}` } }));

  // Solo se actúa sobre proyectos del registro: el Inicio no escribe en carpetas que nadie le pidió.
  const known = (path) => {
    if (typeof path !== 'string' || !path) throw new StoreError('invalid_argument', T('falta path'));
    const p = projectsStatus().find((x) => x.path === path);
    if (!p) throw new StoreError('not_found', T`${path} no está en el registro (importalo primero)`);
    if (!p.found) throw new StoreError('not_found', T`no se encuentra ${join(path, 'compass')}`);
    return p;
  };
  const compassOf = (path) => join(path, 'compass');
  const readConfig = (path) => readFile(join(path, 'compass', 'config.json'), 'utf8').then(JSON.parse).catch(() => null);

  // El store del proyecto: su hub si está vivo, o compass/ directo.
  // El store del proyecto: el del hub que lo sirve acá mismo (D29), el de su hub suelto, o compass/ directo.
  async function storeFor(path) {
    const local = serving.local(path);
    if (local) return Object.assign(Object.create(local.store), { local });
    const hub = await detectHub(path, (await readConfig(path))?.port);
    // Un hub de otro protocolo (§39) no se usa: se escribe directo y su watcher lo ve.
    return hub && hubCompatible(hub) ? createHttpStore(hub, compassOf(path), { validators }) : createJsonFilesStore(compassOf(path), { validators });
  }
  // Después de escribir: si lo sirve este Inicio, se publica como cualquier escritura del hub (pestañas, export);
  // si fue directo a compass/, export markdown y aviso a las pestañas del Inicio. Con un hub suelto lo hace él.
  async function afterWrite(path, store, collection, id, w) {
    if (store.local) { store.local.publish.upsert(collection, w); return; }
    if (!store.hub) {
      const all = await store.loadAll();
      if (all.config?.export_md && all.config.auto_export_md !== false) await exportMarkdown(path, all);
      emit({ type: 'changed', path, collection, id });
    }
  }

  async function projectView(p) {
    const key = serving.keyOf(p.path);
    // url: el tablero dentro del Inicio; served: quién lo sirve ahora ('home', 'hub' o null si nadie lo pidió todavía).
    const base = { path: p.path, name: p.name, found: p.found, hubs: p.hubs, added_at: p.added_at, last_seen: p.last_seen,
      ...(key && { key, url: `/p/${encodeURIComponent(key)}/`, served: serving.served(p.path) }) };
    if (!p.found) return base;
    const all = await loadCompass(compassOf(p.path), validators);
    const [git, worktree] = await Promise.all([boardStatus(p.path, all.config), repoWorktree(p.path)]);
    // worktree (23.2): los worktrees del mismo repo comparten repo; la página los junta en una tarjeta.
    return { ...base, worktree, name: all.config?.project ?? p.name, views: all.config?.views ?? null, godot: existsSync(join(p.path, 'project.godot')),
      warnings: all.warnings.length, summary: summarize(all, now()), git: git.repo ? { uncommitted: git.uncommitted } : null,
      // schema/ o AGENTS.md de una versión anterior de Scope Compass (9.9): la tarjeta ofrece actualizarlos.
      outdated: outdatedFiles(compassOf(p.path)) };
  }

  // Vincular un teléfono (§49). Pedir un código y administrar dispositivos, solo desde este equipo.
  const onlyHere = (req) => {
    if (!isLoopback(req.socket.remoteAddress)) throw new DeviceError('forbidden', T('los dispositivos se vinculan y se quitan solo desde este equipo'));
  };
  app.post('/api/devices/code', async (req) => {
    onlyHere(req);
    const urls = lan() ?? [];
    if (!urls.length) throw new DeviceError('conflict', T('el Inicio no está en la red: abrilo con --lan para vincular un teléfono'));
    const { code, expires_at } = devices.code();
    return { code, expires_at, url: `${urls[0]}vincular#${code}`, urls: urls.map((u) => `${u}vincular#${code}`) };
  });
  app.post('/api/devices/pair', async (req, reply) => {
    const { device, token } = await devices.pair(req.body?.code, req.body?.name);
    emit({ type: 'devices' });
    const secure = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';
    reply.header('set-cookie', deviceCookie(token, { secure }));
    return reply.code(201).send({ device });
  });
  app.get('/api/devices', async (req) => { onlyHere(req); return { devices: devices.list() }; });
  app.delete('/api/devices/:id', async (req) => {
    onlyHere(req);
    if (!(await devices.remove(req.params.id))) throw new DeviceError('not_found', T`no hay un dispositivo ${req.params.id}`);
    return { ok: true };
  });

  app.get('/api/health', async () => ({ ok: true, name: 'scope-compass-home', version: VERSION, protocol: PROTOCOL, pid: process.pid, projects_file: projectsFile() }));

  app.get('/api/projects', async () => ({ projects: await Promise.all(projectsStatus().map(projectView)) }));

  // Actualizar compass/ de un proyecto sin hub (9.9): lo mismo que `scompass update` (schema y AGENTS.md).
  app.post('/api/projects/update', async (req) => {
    const p = known(req.body?.path);
    const updated = updateCompass(compassOf(p.path));
    emit({ type: 'projects' });
    return { updated: updated.map((f) => 'compass/' + f) };
  });

  // Actualizar todos (§38): los compass/ desactualizados de todos los proyectos conocidos, en una sola vez. Varios
  // proyectos con el mismo tablero (worktrees, enlaces) lo actualizan una vez: el segundo ya lo encuentra al día.
  app.post('/api/projects/update-all', async () => {
    const updated = updateAllCompasses(projectsStatus());
    if (updated.length) emit({ type: 'projects' });
    return { updated };
  });

  // Actualizar el binario (§39, D62). app.upgrade.state: la última consulta (la bandeja la lee sin esperar); installed:
  // la versión que quedó en disco, que este proceso todavía no corre. Solo el binario consulta GitHub (enabled): desde
  // npm o el repo no hay nada que reemplazar, y los tests no salen a internet; ellos pasan enabled, check e install.
  const up = { enabled: IS_BINARY, check: checkUpgrade, install: installUpgrade, ...upgradeOptions };
  const upgrade = {
    state: null,
    installed: null,
    async check({ force = false } = {}) {
      if (!up.enabled) return { current: VERSION, latest: null, available: false, release: null, binary: false, installed: null };
      const state = await up.check({ force });
      const changed = state.latest !== upgrade.state?.latest || state.available !== upgrade.state?.available;
      upgrade.state = state;
      if (changed) emit({ type: 'upgrade' });
      return upgrade.view();
    },
    async install() {
      if (!up.enabled) throw new UpgradeError('not_binary', T('este Inicio no corre del binario: se actualiza con npm o con git pull'));
      const state = await up.check({ force: true });
      upgrade.state = state;
      if (!state.available) throw new UpgradeError('conflict', T`ya está la versión más nueva (${state.current})`);
      const r = await up.install(state.release);
      upgrade.installed = r.version;
      emit({ type: 'upgrade' });
      return { ...upgrade.view(), path: r.path };
    },
    view: () => ({ ...upgrade.state, installed: upgrade.installed })
  };
  app.decorate('upgrade', upgrade);
  app.get('/api/upgrade', async (req) => upgrade.check({ force: req.query?.force === '1' }));
  app.post('/api/upgrade', async (req) => {
    if (!isLoopback(req.socket.remoteAddress)) throw new StoreError('forbidden', T('scompass se actualiza solo desde este equipo'));
    return upgrade.install();
  });

  // Reiniciar el Inicio (9.8): responde antes de cerrar; el nuevo toma el mismo puerto (lo hace `scompass home`).
  app.post('/api/restart', async (req, reply) => {
    if (!onRestart) throw new StoreError('invalid_argument', T('este Inicio no se puede reiniciar desde la API'));
    reply.code(202).send({ ok: true, restarting: true });
    setImmediate(onRestart);
    return reply;
  });
  // Apagar el Inicio (§18): lo mismo que Ctrl+C, en todas las plataformas.
  app.post('/api/shutdown', async (req, reply) => {
    if (!onShutdown) throw new StoreError('invalid_argument', T('este Inicio no se puede apagar desde la API'));
    reply.code(202).send({ ok: true, stopping: true });
    setImmediate(onShutdown);
    return reply;
  });

  app.post('/api/projects', async (req, reply) => {
    const { entry, added } = await recordProject(req.body?.path ?? '');
    emit({ type: 'projects' });
    return reply.code(added ? 201 : 200).send({ project: entry, added });
  });

  app.delete('/api/projects', async (req) => {
    const removed = await forgetProject(req.query.path ?? '');
    emit({ type: 'projects' });
    return { removed };
  });

  app.get('/api/templates', async (req) => ({
    templates: await Promise.all((await listTemplates()).map(async (n) => ({ name: n, description: (await loadTemplate(n, req.lang)).description ?? '' }))),
    data_dir: projectsDataDir(),
    sep
  }));

  // Crear un proyecto: la misma `scompass init` de la CLI, en otro proceso. La carpeta es <parent>/<nombre>, y
  // parent es por defecto la carpeta de datos del usuario (D28): "Vida" → ~/.local/share/scope-compass/Vida.
  // Una carpeta que ya existe no se usa. Fuera de todo repo, la carpeta nueva recibe `git init` (los datos viven
  // en git, D1), sin remoto ni commits.
  app.post('/api/projects/init', async (req, reply) => {
    const { template = 'vacio' } = req.body ?? {};
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const dirName = folderName(name);
    if (!dirName) throw new StoreError('invalid_argument', name ? T`"${name}" no sirve como nombre de carpeta (sin \\ / : * ? " < > |)` : T('falta el nombre del proyecto'));
    const parent = typeof req.body?.parent === 'string' && req.body.parent.trim() ? req.body.parent.trim() : projectsDataDir();
    if (!isAbsolute(parent)) throw new StoreError('invalid_argument', T('la carpeta tiene que ser una ruta absoluta'));
    if (!(await loadTemplate(template))) throw new StoreError('invalid_argument', T`plantilla desconocida: ${template}`);
    const path = join(parent, dirName);
    if (existsSync(path)) throw new StoreError('conflict', T`ya existe ${path}: elegí otro nombre u otra carpeta`);
    await mkdir(path, { recursive: true });
    const inRepo = await new Promise((r) => execFile('git', ['-C', path, 'rev-parse', '--is-inside-work-tree'], { windowsHide: true }, (err) => r(!err)));
    const gitInit = !inRepo && await new Promise((r) => execFile('git', ['-C', path, 'init', '-q'], { windowsHide: true }, (err) => r(!err)));
    // --project=<nombre>: un nombre que empieza con - no se toma por otra opción (19.8).
    // El tablero en el idioma de quien lo crea (§45); los mensajes de init, también.
    const args = ['--dir', path, 'init', '--template', template, '--lang', req.lang, '--json', ...(name ? [`--project=${name}`] : [])];
    const r = await new Promise((resolve) => {
      const child = spawn(...selfCommand(args), { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, SCOMPASS_LANG: req.lang }, windowsHide: true });
      let out = '', err = '';
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('exit', (code) => resolve({ code, out, err }));
    });
    if (r.code !== 0) {
      // La carpeta la creó este pedido (antes no existía): no queda a medio armar.
      await rm(path, { recursive: true, force: true }).catch(() => {});
      let e = null;
      try { e = JSON.parse(r.err.trim().split('\n').at(-1)).error; } catch { /* no era JSON */ }
      throw new StoreError(e?.code ?? 'io_error', e?.message ?? (r.err.trim() || T`scompass init salió con ${r.code}`));
    }
    emit({ type: 'projects' });
    return reply.code(201).send({ ...JSON.parse(r.out), path, git_init: !!gitInit });
  });

  // Vincular un tablero que ya existe (de otro proyecto, uno suelto o uno clonado del repo de tableros) a un
  // proyecto sin compass/: los tableros para elegir, y el enlace (lo mismo que `scompass board link`). El proyecto
  // queda anotado en el Inicio.
  app.get('/api/boards', async () => ({ dir: boardsDir(), boards: listBoards(loadProjects().map((p) => p.path)) }));
  app.post('/api/projects/link', async (req, reply) => {
    const path = typeof req.body?.path === 'string' ? req.body.path.trim() : '';
    const board = typeof req.body?.board === 'string' ? req.body.board.trim() : '';
    if (!path || !isAbsolute(path)) throw new StoreError('invalid_argument', T('la carpeta del proyecto tiene que ser una ruta absoluta'));
    if (!board) throw new StoreError('invalid_argument', T('falta el tablero'));
    if (!existsSync(path) || !statSync(path).isDirectory()) throw new StoreError('not_found', T`no existe la carpeta ${path}`);
    const r = await linkBoard(path, board);
    const { entry } = await recordProject(path);
    emit({ type: 'projects' });
    return reply.code(201).send({ ...r, project: entry });
  });

  // Elegir una carpeta (el botón "Elegir otra carpeta…"): el navegador no puede darle una ruta al servidor, así que
  // el diálogo lo abre el Inicio con el del escritorio (desktop.js: kdialog o zenity, o el de Windows).
  app.post('/api/pick-folder', async (req) => {
    const start = typeof req.body?.start === 'string' ? req.body.start : projectsDataDir();
    // for: link, la carpeta del proyecto al que se vincula un tablero; si no, dónde crear uno nuevo.
    const r = await pickFolder(start, req.body?.for === 'link' ? T('Carpeta del proyecto') : T('Dónde crear el proyecto'));
    if (!r) throw new StoreError('not_found', T('no hay un selector de carpetas (instalá kdialog o zenity); escribí la ruta'));
    return r;
  });

  // Que el Inicio sirva un proyecto ya (el "Iniciar hub" del dock con el Inicio corriendo, D29). Si no estaba en
  // el registro, se anota. Devuelve su base.
  app.post('/api/projects/activate', async (req) => {
    if (typeof req.body?.path !== 'string' || !req.body.path) throw new StoreError('invalid_argument', T('falta path'));
    // El dock puede mandarla con "/" al final o con un symlink en el camino: la del registro es la resuelta.
    let path = resolve(req.body.path);
    try { path = realpathSync.native(path); } catch { /* no existe: known() lo dice */ }
    if (!projectsStatus().some((p) => p.path === path)) { await recordProject(path); emit({ type: 'projects' }); }
    const p = known(path);
    const standalone = standaloneOf(p.path)[0];
    if (standalone) return { base: '', port: standalone.port, standalone: true };
    return { base: await serving.activate(p.path), served: true };
  });

  app.get('/api/today', async () => {
    const items = [], week = [];
    for (const p of projectsStatus().filter((x) => x.found)) {
      const [all, worktree] = await Promise.all([loadCompass(compassOf(p.path), validators), repoWorktree(p.path)]);
      const project = { path: p.path, name: all.config?.project ?? p.name, worktree };
      for (const x of todayOf(all, now())) items.push({ ...x, project });
      for (const x of weekOf(all, now())) week.push({ ...x, project });
    }
    return { items: items.sort(byToday), week: week.sort((a, b) => a.due.localeCompare(b.due)) };
  });

  // Captura rápida (31.2): la regla de `item add` (newItem), por el hub del proyecto o directo con etag.
  app.post('/api/projects/add-item', async (req, reply) => {
    const { path, list, text, due, etag } = req.body ?? {};
    known(path);
    if (typeof list !== 'string' || !list) throw new StoreError('invalid_argument', T('falta list'));
    const store = await storeFor(path);
    const cur = await store.get('lists', list);
    if (etag !== undefined && etag !== cur.etag) throw new StoreError('conflict', T('la lista cambió desde que se leyó'), { current: { id: cur.id, etag: cur.etag, ...cur.doc } });
    const item = newItem({ text: typeof text === 'string' ? text.trim() : text, due: due || undefined }, now().toISOString());
    const w = await store.patch('lists', list, { items: [...cur.doc.items, item] }, { ifMatch: cur.etag });
    await afterWrite(path, store, 'lists', list, w);
    return reply.code(201).send({ list: { id: w.id, etag: w.etag, ...w.doc }, n: w.doc.items.length, via: store.local ? 'home' : store.hub ? 'hub' : 'disk' });
  });

  app.post('/api/projects/check-item', async (req) => {
    const { path, list, n, etag, undo } = req.body ?? {};
    known(path);
    const store = await storeFor(path);
    const cur = await store.get('lists', list);
    if (etag !== undefined && etag !== cur.etag) throw new StoreError('conflict', T('la lista cambió desde que se leyó'), { current: { id: cur.id, etag: cur.etag, ...cur.doc } });
    const items = cur.doc.items;
    if (!Number.isInteger(n) || n < 1 || n > items.length) throw new StoreError('invalid_argument', T`ítem inexistente: ${n} (la lista tiene ${items.length})`);
    let r;
    try { r = checkItem(items[n - 1], { undo: !!undo }); } catch (e) { throw new StoreError(e.code ?? 'invalid_argument', e.message); }
    const w = await store.patch('lists', list, { items: items.with(n - 1, r.item) }, { ifMatch: cur.etag });
    await afterWrite(path, store, 'lists', list, w);
    return { list: { id: w.id, etag: w.etag, ...w.doc }, advanced: r.advanced, via: store.local ? 'home' : store.hub ? 'hub' : 'disk' };
  });

  app.post('/api/projects/move-task', async (req) => {
    const { path, id, status, etag } = req.body ?? {};
    known(path);
    if (!STATUSES.includes(status)) throw new StoreError('invalid_argument', T`estado inválido: ${status}`);
    const store = await storeFor(path);
    const w = await store.patch('tasks', id, { status }, etag === undefined ? {} : { ifMatch: etag });
    await afterWrite(path, store, 'tasks', id, w);
    return { task: { id: w.id, etag: w.etag, ...w.doc }, via: store.local ? 'home' : store.hub ? 'hub' : 'disk' };
  });

  // Los hubs sueltos de un proyecto: sin las entradas de proyectos que sirve este mismo Inicio (D29).
  const standaloneOf = (path) => hubsOf(path).filter((h) => h.pid !== process.pid);
  // Prender y apagar hubs (8.9). Los que prende el Inicio son hijos suyos con la entrada en una tubería
  // (--exit-on-stdin-close, como los del dock): si el Inicio se cierra o muere, se cierran solos.
  const children = new Map(); // pid → ChildProcess
  async function startHub(path) {
    known(path);
    const running = standaloneOf(path);
    if (running.length) return { hub: running[0], already: true };
    const child = spawn(...selfCommand(['--dir', path, 'serve', '--exit-on-stdin-close']), { stdio: ['pipe', 'ignore', 'pipe'], env: { ...process.env, SCOMPASS_LAUNCHED_BY: 'home' }, windowsHide: true });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    children.set(child.pid, child);
    child.on('exit', () => { children.delete(child.pid); poll(); });
    // Hasta 15 s: con la máquina cargada (o el disco frío) Node tarda en arrancar.
    for (let i = 0; i < 300; i++) {
      const h = standaloneOf(path).find((x) => x.pid === child.pid);
      if (h) { poll(); return { hub: h, already: false }; }
      if (child.exitCode !== null) break;
      await sleep(50);
    }
    child.kill();
    throw new StoreError('io_error', T`el hub no arrancó${err.trim() ? `: ${err.trim().split('\n').at(-1)}` : ''}`);
  }

  // Un hub atado a otro proceso que no lanzó el Inicio (el dock de Godot).
  const isForeign = (h) => !!h.attached && !children.has(h.pid) && h.by !== 'home';

  async function stopHub(path, { force = false } = {}) {
    known(path);
    const running = standaloneOf(path);
    if (!running.length) throw new StoreError('not_found', T`${path} no tiene un hub corriendo`);
    // Uno atado a otro proceso (el dock de Godot) se apaga solo con force: el editor se queda sin hub.
    const foreign = running.filter(isForeign);
    if (foreign.length && !force) throw new StoreError('conflict', T('ese hub lo abrió el dock de Godot (u otro programa): el editor se queda sin hub hasta que lo vuelva a iniciar'), { foreign: true });
    // Cierre ordenado en todas las plataformas (§18): a un hijo se le corta la entrada (--exit-on-stdin-close) y a
    // los demás se les pide por la API. Si en 3 s sigue vivo, kill (SIGTERM en Linux; en Windows, en seco).
    await Promise.all(running.map((h) => children.has(h.pid)
      ? children.get(h.pid).stdin.end()
      : fetch(`http://127.0.0.1:${h.port}/api/shutdown`, { method: 'POST', signal: AbortSignal.timeout(1000) }).catch(() => null)));
    for (let i = 0; i < 60 && running.some((h) => alive(h.pid)); i++) await sleep(50);
    for (const h of running) if (alive(h.pid)) { try { process.kill(h.pid); } catch { /* ya no estaba */ } }
    for (let i = 0; i < 40 && running.some((h) => alive(h.pid)); i++) await sleep(50);
    const still = running.filter((h) => alive(h.pid));
    if (still.length) throw new StoreError('io_error', T`el hub (PID ${still.map((h) => h.pid).join(', ')}) no se cerró en 5 s`);
    poll();
    return { stopped: running.map((h) => ({ pid: h.pid, port: h.port })) };
  }

  app.post('/api/projects/start', async (req, reply) => {
    const r = await startHub(req.body?.path);
    return reply.code(r.already ? 200 : 201).send(r);
  });
  app.post('/api/projects/stop', async (req) => stopHub(req.body?.path, { force: !!req.body?.force }));
  // Para la bandeja del Inicio (CLI): las mismas operaciones sin pasar por HTTP.
  app.decorate('hubs', { start: startHub, stop: stopHub, isForeign });
  // Al cerrar el Inicio, sus hijos se van solos al cortarse la entrada (también en Windows). Se los espera hasta
  // 3 s; el que siga vivo, kill.
  app.addHook('onClose', async () => {
    const left = [...children.values()];
    const running = () => left.filter((c) => c.exitCode === null && c.signalCode === null);
    for (const c of left) c.stdin.end();
    for (let i = 0; i < 60 && running().length; i++) await sleep(50);
    for (const c of running()) c.kill();
  });

  // En vivo: el Inicio se suscribe al WebSocket de cada hub vivo de un proyecto conocido y reenvía sus cambios.
  const subs = new Map(); // `${pid}` → { ws, path }
  let lastHubs = '';
  let lastMtime = null;
  const mtime = () => { try { return statSync(projectsFile()).mtimeMs; } catch { return null; } };
  function poll() {
    const paths = new Set(loadProjectsSafe().map((p) => p.path));
    const live = listHubs().filter((h) => h.kind !== 'home' && h.pid !== process.pid && paths.has(h.project));
    const key = live.map((h) => `${h.pid}:${h.port}`).sort().join(',');
    for (const [pid, s] of subs) if (!live.some((h) => String(h.pid) === pid)) { s.ws.close(); subs.delete(pid); }
    for (const h of live) {
      if (subs.has(String(h.pid))) continue;
      const ws = new WebSocket(`ws://127.0.0.1:${h.port}/ws`);
      ws.addEventListener('message', (m) => {
        let e;
        try { e = JSON.parse(m.data); } catch { return; }
        if (e.type === 'upsert' || e.type === 'delete') emit({ type: 'changed', path: h.project, collection: e.collection, id: e.id });
      });
      ws.addEventListener('error', () => {});
      ws.addEventListener('close', () => { if (subs.get(String(h.pid))?.ws === ws) subs.delete(String(h.pid)); });
      subs.set(String(h.pid), { ws, path: h.project });
    }
    if (key !== lastHubs) { lastHubs = key; emit({ type: 'hubs' }); }
    const m = mtime();
    if (m !== lastMtime) { if (lastMtime !== null || m !== null) emit({ type: 'projects' }); lastMtime = m; }
  }
  const loadProjectsSafe = () => { try { return loadProjects(); } catch { return []; } };
  let timer = null;
  app.addHook('onReady', async () => { lastMtime = mtime(); poll(); timer = setInterval(poll, pollMs); });
  app.addHook('onClose', async () => { clearInterval(timer); for (const s of subs.values()) s.ws.close(); subs.clear(); });
  app.decorate('poll', poll);

  // La página del Inicio (web/home.*), con los estilos y las fuentes del tablero. Rutas fijas, como en el hub.
  const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };
  const serveWeb = async (reply, rel) => {
    const missing = new StoreError('not_found', T`no existe /${rel}`);
    const ext = rel.slice(rel.lastIndexOf('.'));
    if (!TYPES[ext] || !/^((fonts|frames)\/)?[\w.-]+$/.test(rel) || rel.split('/').pop().startsWith('.')) throw missing;
    const body = await readFile(join(webDir, rel)).catch(() => null);
    if (!body) throw missing;
    return reply.type(TYPES[ext]).header('cache-control', 'no-cache').send(body);
  };
  app.get('/', (req, reply) => serveWeb(reply, 'home.html'));
  // La página del teléfono para canjear el código (§49); el código va en el fragmento y no llega acá.
  app.get('/vincular', (req, reply) => serveWeb(reply, 'vincular.html'));
  for (const f of ['home.js', 'home.css', 'app.css', 'favicon.svg', 'settings.js', 'qr.js', 'vincular.js']) app.get('/' + f, (req, reply) => serveWeb(reply, f));
  app.get('/fonts/:file', (req, reply) => serveWeb(reply, 'fonts/' + req.params.file));
  app.get('/frames/:file', (req, reply) => serveWeb(reply, 'frames/' + req.params.file));

  app.register(async (scope) => {
    scope.get('/ws', { websocket: true }, (socket) => {
      const forward = (e) => { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(e)); };
      events.on('event', forward);
      socket.on('close', () => events.off('event', forward));
      forward({ type: 'hello', server_version: VERSION, protocol: PROTOCOL });
    });
  });

  return app;
}
