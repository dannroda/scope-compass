// CLI `scompass` (spec §6). run() no toca process: recibe argv y dónde escribir, y devuelve el código de salida.
// Sin hub escribe directo en compass/ con el store json-files (misma validación y escritura atómica).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { exportMarkdown } from './export-md.js';
import { checkRefs, loadDocs, resolveRef, sectionMarkdown, stampIds, suggestRefs } from './docs.js';
import { writeAtomic } from './store/atomic.js';
import { importArtifact } from './import-artifact.js';
import { KINDS, loadValidators, parseDoc, SCHEMA_DIR } from './schema.js';
import { canonical } from './store/canonical.js';
import { createJsonFilesStore, StoreError } from './store/json-files.js';
import { createHttpStore, detectHub } from './store/http.js';
import { createServer, listen } from './server.js';
import { startTray } from './tray.js';
import { hubsOf, listHubs, registerHub, unregisterHub } from './registry.js';
import { listMilestones, listTasks } from './views.js';

const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');
const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'scompass.js');
const STATUS = { todo: 'Pendiente', doing: 'En curso', review: 'Revisión', done: 'Hecho' };

const USAGE = `Uso: scompass [--dir <proyecto>] <comando>

  init [--project <nombre>]                 crea compass/ en el proyecto
  serve [--port 4711] [--open] [--force]    levanta el hub en 127.0.0.1 (uno por proyecto; Ctrl+C para cerrar)
  restart                                   reinicia el hub de este proyecto (para cargar código nuevo)
  hubs                                      hubs activos de todos los proyectos
        [--exit-on-stdin-close]             se cierra cuando se corta su entrada (lo usa el dock de Godot)
        [--tray]                            ícono en la bandeja del sistema, con "Detener hub"
  list [--milestone m00] [--status doing]   tareas (--json para agentes)
  show <id>                                 una tarea, con los pasos numerados
  add "<título>" --milestone m00 [--code 0.11] [--status todo]
  move <id> <todo|doing|review|done>
  check <id> <n> [--undo]                   tilda el paso n (desde 1)
  step add <id> "<texto>" [--detail "…"]     agrega un paso (texto corto; el detalle se despliega)
  step set <id> <n> [--text …] [--detail …]  cambia un paso (--detail "" lo quita)
  step rm <id> <n>                          quita un paso
  set <id> --file task.json                 reemplazo completo (--file - lee stdin)
  set <id> [--title t] [--notes n] [--test p] [--code c] [--milestone m] [--status s]
                                            cambia solo esos campos
  milestone list | show <id> | set <id> --file m.json
  doc list                                  documentos de config.json con su índice de secciones
  doc show <alias>#<id> [--raw]             una sección (--raw: solo el markdown, para agentes)
  doc stamp-ids <alias> [--dry-run]         agrega <!-- id: … --> a las secciones que no tienen
  refs check                                referencias rotas (sale con 1 si hay) y frágiles
  refs suggest                              propone refs a partir de citas "gdd.md §4.3" (no aplica nada)
  ref add|rm <tarea> <alias>#<id>           agrega o quita una referencia de la tarea
  export md [--out docs/tareas.md]          regenera el markdown (también se hace solo al escribir)
  import artifact <carpeta> [--dry-run] [--overwrite]
                                            migra el export de ArtifactData (milestones/, tasks/)

  --json      salida JSON en lecturas y escrituras
  --etag <e>  en escrituras: falla con conflicto si el documento cambió (none: si ya existe)
  --dir <p>   raíz del proyecto (por defecto: la carpeta con compass/ más cercana hacia arriba)
  --direct    escribir directo en compass/ aunque haya un hub corriendo

Si hay un hub de este proyecto en el puerto de config.json, las lecturas y escrituras pasan por su API.`;

class UsageError extends Error {}

// Campos de una tarea que `set` edita sin --file.
const FIELDS = ['title', 'notes', 'test', 'code', 'milestone', 'status'];

const OPTIONS = {
  dir: { type: 'string' }, json: { type: 'boolean' }, etag: { type: 'string' },
  milestone: { type: 'string' }, status: { type: 'string' }, code: { type: 'string' },
  file: { type: 'string' }, out: { type: 'string' }, overwrite: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, undo: { type: 'boolean' }, project: { type: 'string' },
  raw: { type: 'boolean' },
  port: { type: 'string' }, open: { type: 'boolean' }, direct: { type: 'boolean' }, 'exit-on-stdin-close': { type: 'boolean' }, tray: { type: 'boolean' }, force: { type: 'boolean' },
  title: { type: 'string' }, notes: { type: 'string' }, test: { type: 'string' }, text: { type: 'string' }, detail: { type: 'string' },
  help: { type: 'boolean', short: 'h' }
};

// La carpeta del proyecto: --dir, o la primera hacia arriba que tenga compass/config.json.
export function findProject(cwd, dir) {
  if (dir) return resolve(cwd, dir);
  for (let d = resolve(cwd); ; d = dirname(d)) {
    if (existsSync(join(d, 'compass', 'config.json'))) return d;
    if (dirname(d) === d) return resolve(cwd);
  }
}


// signal: corta `serve` (los tests lo usan); sin él, serve termina con SIGINT o SIGTERM.
export async function run(argv, { cwd = process.cwd(), out = process.stdout, err = process.stderr, stdin = process.stdin, now, signal } = {}) {
  const print = (s) => out.write(s + '\n');
  const warn = (s) => err.write(s + '\n');
  let args;
  try {
    args = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  } catch (e) {
    warn(e.message + '\n\n' + USAGE);
    return 2;
  }
  const { values: o, positionals: [cmd, ...rest] } = args;
  if (o.help || !cmd) {
    (cmd || o.help ? print : warn)(USAGE);
    return cmd || o.help ? 0 : 2;
  }

  const project = findProject(cwd, o.dir);
  const compass = join(project, 'compass');
  const validators = loadValidators();
  let store = createJsonFilesStore(compass, { validators, ...(now && { now }) });
  // Con un hub de este proyecto corriendo, todo pasa por su API (eventos al instante, una sola cola de escritura).
  if (!o.direct && !['init', 'serve', 'restart', 'hubs', 'help'].includes(cmd)) {
    const cfg = await readFile(join(compass, 'config.json'), 'utf8').then(JSON.parse).catch(() => null);
    const hub = await detectHub(project, cfg?.port);
    if (hub) store = createHttpStore(hub, compass, { validators });
  }
  // --etag none: el documento no tiene que existir.
  const ifMatch = o.etag === undefined ? {} : { ifMatch: o.etag === 'none' ? null : o.etag };
  const showWarnings = (ws) => { for (const w of ws) warn(`aviso [${w.code}] ${w.path}: ${w.message}`); };
  const need = (v, what) => { if (v === undefined || v === '') throw new UsageError(`falta ${what}`); return v; };

  const readJsonFile = async (path) => {
    const text = path === '-' ? await streamText(stdin) : await readFile(resolve(cwd, path), 'utf8');
    try { return JSON.parse(text); } catch (e) { throw new StoreError('invalid_argument', `${path}: JSON inválido: ${e.message}`); }
  };
  const done = (r, msg) => { o.json ? print(JSON.stringify(r)) : print(msg); return 0; };
  // D13: después de cada escritura se regenera el export, salvo auto_export_md: false. Con hub, lo hace el hub.
  const written = async (r, msg) => {
    if (store.hub) return done(r, msg);
    const all = await store.loadAll();
    if (all.config?.export_md && all.config.auto_export_md !== false) await exportMarkdown(project, all);
    return done(r, msg);
  };

  const commands = {
    async init() {
      if (existsSync(join(compass, 'config.json'))) throw new StoreError('conflict', `ya existe ${join(compass, 'config.json')}`);
      for (const d of ['milestones', 'tasks', 'schema']) await mkdir(join(compass, d), { recursive: true });
      for (const k of KINDS) await copyFile(join(SCHEMA_DIR, `${k}.schema.json`), join(compass, 'schema', `${k}.schema.json`));
      await copyFile(join(TEMPLATES, 'compass-README.md'), join(compass, 'README.md'));
      await writeFile(join(compass, '.gdignore'), '');
      const config = { project: o.project || basename(project), export_md: 'docs/tareas.md', port: 4711 };
      const res = parseDoc(JSON.stringify(config), 'config', validators);
      if (!res.ok) throw new StoreError('invalid_argument', res.message);
      await writeFile(join(compass, 'config.json'), canonical(config));
      return done({ dir: compass, config }, `Creado ${compass}`);
    },

    async serve() {
      if (!existsSync(join(compass, 'config.json'))) {
        throw new StoreError('not_found', `no hay ${compass}: corré \`scompass --dir ${project} init\` para crearla`);
      }
      const all = await store.loadAll();
      showWarnings(all.warnings);
      // Un hub por proyecto: dos escribirían el mismo compass/ y la UI y el dock podrían quedar en hubs distintos.
      const others = hubsOf(project).filter((h) => h.pid !== process.pid);
      if (others.length && !o.force) {
        const h = others[0];
        throw new StoreError('conflict', `ya hay un hub de este proyecto: PID ${h.pid} en http://127.0.0.1:${h.port}/ (scompass hubs lista todos; --force para levantar otro igual)`);
      }
      const port = Number(o.port ?? all.config?.port ?? 4711);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UsageError(`puerto inválido: ${o.port}`);
      let restart = false;
      const app = createServer({ projectDir: project, store, validators, watch: true, exportMd: true,
        onRestart: () => { restart = true; ac.abort(); } });
      if (!o.json) app.events.on('event', (e) => { if (e.type === 'warning') warn(`aviso [${e.code}] ${e.path}: ${e.message}`); });
      let addr;
      try {
        addr = await listen(app, port);
      } catch (e) {
        await app.close();
        if (e.code === 'EADDRINUSE') throw new StoreError('io_error', `el puerto ${port} está ocupado (¿ya hay un hub corriendo?)`);
        throw e;
      }
      registerHub({ port: addr.port, project });
      const url = `http://${addr.address}:${addr.port}/`;
      o.json ? print(JSON.stringify({ url, port: addr.port, project })) : print(`Scope Compass en ${url} · ${project} · Ctrl+C para cerrar`);
      // SCOMPASS_OPEN reemplaza a xdg-open (los tests lo usan para no abrir el navegador).
      const openBoard = () => spawn(process.env.SCOMPASS_OPEN || 'xdg-open', [url], { detached: true, stdio: 'ignore' })
        .on('error', () => warn(`no se pudo abrir el navegador: ${url}`)).unref();
      if (o.open) openBoard();
      // Desde la bandeja: si ya hay un tablero abierto que puede notificar, se le pide que llame la atención en
      // lugar de abrir otra pestaña (el navegador no deja enfocar una pestaña desde afuera).
      const showBoard = () => { if (!app.focusBoard()) openBoard(); };
      const ac = new AbortController();
      let tray = null;
      if (o.tray) {
        try {
          tray = await startTray({
            title: 'Scope Compass',
            tooltip: `${all.config?.project ?? project} · ${url}`,
            onActivate: showBoard,
            items: [{ label: 'Abrir tablero', onClick: showBoard }, { label: 'Reiniciar hub', onClick: () => { restart = true; ac.abort(); } },
              { label: 'Detener hub', onClick: () => ac.abort() }]
          });
        } catch (e) {
          warn(`sin ícono en la bandeja: ${e.message}`);
        }
      }
      if (signal) signal.addEventListener('abort', () => ac.abort(), { once: true });
      else {
        process.once('SIGINT', () => ac.abort());
        process.once('SIGTERM', () => ac.abort());
      }
      // Lanzado por el dock con una tubería: si Godot se cierra o muere, la entrada se corta y el hub se va.
      if (o['exit-on-stdin-close']) {
        stdin.on('end', () => ac.abort());
        stdin.on('close', () => ac.abort());
        stdin.on('error', () => ac.abort());
        stdin.resume();
      }
      const stop = ac.signal;
      if (!stop.aborted && !signal?.aborted) await new Promise((res) => stop.addEventListener('abort', res, { once: true }));
      if (o['exit-on-stdin-close'] && !restart) stdin.pause?.();
      tray?.close();
      await app.close();
      unregisterHub();
      // Reinicio: el mismo comando otra vez, con la misma entrada y salida (si lo lanzó el dock, sigue atado a
      // Godot por la misma tubería) y el puerto ya libre.
      if (restart) {
        // En el mismo puerto que tenía (con --port 0 tomaría otro al azar).
        const again = argv.filter((x, i) => x !== '--port' && argv[i - 1] !== '--port' && !x.startsWith('--port='));
        spawn(process.execPath, [BIN, ...again, '--port', String(addr.port)], { cwd, env: process.env, stdio: 'inherit', detached: true }).unref();
        if (!o.json) print('Reiniciando el hub…');
        if (stdin === process.stdin) process.exit(0);
      }
      return 0;
    },

    async list() {
      if (o.status && !STATUS[o.status]) throw new UsageError(`estado inválido: ${o.status} (todo, doing, review, done)`);
      const all = await store.loadAll();
      showWarnings(all.warnings);
      const ms = new Map(all.milestones);
      const tasks = listTasks(all, { milestone: o.milestone, status: o.status });
      if (o.json) {
        print(JSON.stringify({ tasks, warnings: all.warnings }));
        return 0;
      }
      let last;
      for (const t of tasks) {
        if (t.milestone !== last) {
          last = t.milestone;
          const m = ms.get(last);
          print(`\n${m ? `${m.code} · ${m.title}` : last}`);
        }
        const cl = t.checklist ?? [];
        const steps = cl.length ? `  ${cl.filter((c) => c.done).length}/${cl.length}` : '';
        print(`  ${t.id.padEnd(9)} ${(t.code || '').padEnd(5)} ${STATUS[t.status].padEnd(9)} ${t.title}${steps}`);
      }
      if (!tasks.length) print('Sin tareas.');
      return 0;
    },

    async show() {
      const t = await store.get('tasks', need(rest[0], 'el id'));
      if (o.json) return done({ id: t.id, etag: t.etag, ...t.doc });
      const d = t.doc;
      print(`${d.code ? d.code + ' ' : ''}${d.title}  [${t.id}]`);
      print(`Estado: ${STATUS[d.status]} · Hito: ${d.milestone}${d.updated_at ? ' · Actualizada: ' + d.updated_at : ''}`);
      (d.checklist ?? []).forEach((c, i) => {
        print(`  ${String(i + 1).padStart(2)}. [${c.done ? 'x' : ' '}] ${c.text}`);
        if (c.detail) for (const l of c.detail.split('\n')) print(`         ${l}`);
      });
      if (d.test) print(`Prueba: ${d.test}`);
      if (d.notes) print(`Notas: ${d.notes}`);
      if (d.refs?.length) print(`Referencias: ${d.refs.map((r) => `${r.doc}#${r.section}`).join(', ')}`);
      return 0;
    },

    async restart() {
      const cfg = await readFile(join(compass, 'config.json'), 'utf8').then(JSON.parse).catch(() => null);
      const hub = await detectHub(project, cfg?.port);
      if (!hub) throw new StoreError('not_found', `no hay un hub de este proyecto en el puerto ${cfg?.port ?? 4711}`);
      const before = (await (await fetch(hub + '/api/health')).json()).pid;
      const r = await fetch(hub + '/api/restart', { method: 'POST' });
      if (r.status !== 202) throw new StoreError('io_error', `el hub no aceptó reiniciarse (HTTP ${r.status})`);
      // Espera al hub nuevo: mismo puerto, otro PID.
      for (let i = 0; i < 100; i++) {
        await new Promise((res) => setTimeout(res, 100));
        const h = await fetch(hub + '/api/health', { signal: AbortSignal.timeout(300) }).then((x) => x.json()).catch(() => null);
        if (h?.pid && h.pid !== before) return done({ hub, pid: h.pid, previous: before }, `Hub reiniciado en ${hub} (PID ${before} → ${h.pid})`);
      }
      throw new StoreError('io_error', 'el hub se cerró pero no volvió en 10 s: mirá su log');
    },

    async hubs() {
      const hubs = listHubs();
      if (o.json) return done({ hubs });
      if (!hubs.length) print('No hay hubs de Scope Compass corriendo.');
      for (const h of hubs) print(`PID ${String(h.pid).padEnd(8)} http://127.0.0.1:${h.port}/  ${h.project}  (desde ${new Date(h.startedAt).toLocaleString('es-AR')})`);
      const dup = hubs.filter((h, i) => hubs.findIndex((x) => x.project === h.project) !== i);
      for (const h of dup) warn(`aviso: más de un hub para ${h.project}`);
      return 0;
    },

    async doc() {
      const [sub, target] = rest;
      const all = await store.loadAll();
      const docs = await loadDocs(project, all.config);
      if (sub === 'list') {
        if (o.json) {
          return done({ docs: docs.map((d) => ({ alias: d.alias, path: d.path, warnings: d.warnings,
            sections: d.sections.map(({ id, title, level, explicit }) => ({ id, title, level, explicit })) })) });
        }
        if (!docs.length) print('Sin documentos: agregalos en compass/config.json › docs.');
        for (const d of docs) {
          const fragile = d.sections.filter((s) => !s.explicit).length;
          print(`${d.alias.padEnd(12)} ${d.path}  ${d.sections.length} secciones${fragile ? ` · ${fragile} sin id (frágiles)` : ''}`);
          for (const w of d.warnings) warn(`aviso [${w.code}] ${d.path}: ${w.message}`);
        }
        return 0;
      }
      if (sub === 'show') {
        const r = resolveRef(docs, need(target, '<alias>#<id>'));
        if (!r.doc) throw new StoreError('not_found', `no hay un documento "${r.key}" (doc list muestra los que hay)`);
        if (!r.section) throw new StoreError('not_found', `no hay una sección "${r.id}" en ${r.doc.path}`);
        const md = sectionMarkdown(r.doc, r.section);
        if (o.raw) { out.write(md); return 0; }
        const { id, title, level, explicit, start, end } = r.section;
        if (o.json) return done({ alias: r.doc.alias, path: r.doc.path, id, title, level, explicit, lines: [start + 1, end], markdown: md });
        print(`${r.doc.alias}#${id} · ${r.doc.path}, líneas ${start + 1}–${end}${explicit ? '' : ' · sin id (frágil)'}`);
        print('');
        out.write(md);
        return 0;
      }
      if (sub === 'stamp-ids') {
        const d = docs.find((x) => x.alias === need(target, 'el alias del documento') || x.path === target);
        if (!d) throw new StoreError('not_found', `no hay un documento "${target}"`);
        const text = await readFile(join(project, d.path), 'utf8');
        const r = stampIds(text);
        if (r.stamped.length && !o['dry-run']) await writeAtomic(join(project, d.path), r.text);
        if (o.json) return done({ path: d.path, stamped: r.stamped, dryRun: !!o['dry-run'] });
        print(r.stamped.length ? `${o['dry-run'] ? 'Se estamparían' : 'Estampados'} ${r.stamped.length} ids en ${d.path}: ${r.stamped.join(', ')}` : `${d.path} ya tiene ids en todas sus secciones.`);
        return 0;
      }
      throw new UsageError(`subcomando desconocido: doc ${sub ?? ''}`);
    },

    async refs() {
      if (rest[0] !== 'check' && rest[0] !== 'suggest') throw new UsageError(`subcomando desconocido: refs ${rest[0] ?? ''} (check, suggest)`);
      const all = await store.loadAll();
      const docs = await loadDocs(project, all.config);
      if (rest[0] === 'suggest') {
        const s = suggestRefs(docs, [...all.tasks].map(([id, doc]) => ({ id, ...doc })));
        if (o.json) return done({ suggestions: s });
        const pending = s.filter((x) => !x.already);
        for (const x of s) {
          print(`${x.already ? 'ya está' : 'propuesta'}  ${(x.code || x.task).padEnd(6)} ${x.where}: "${x.cite}" → ${x.ref} (${x.title.replace(/`/g, '')})`);
          if (!x.already) print(`           scompass ref add ${x.task} ${x.ref}`);
        }
        print(s.length ? `${pending.length} por revisar, ${s.length - pending.length} ya referenciadas.` : 'No hay citas por número de sección.');
        return 0;
      }
      const problems = checkRefs(docs, [...all.tasks].map(([id, doc]) => ({ id, ...doc })));
      const broken = problems.filter((p) => p.problem !== 'fragile');
      if (o.json) print(JSON.stringify({ broken, fragile: problems.filter((p) => p.problem === 'fragile') }));
      else {
        const why = { missing_doc: 'no existe el documento', missing_section: 'no existe la sección', fragile: 'sin id explícito (frágil)' };
        for (const p of problems) (p.problem === 'fragile' ? warn : print)(`${p.problem === 'fragile' ? 'aviso' : 'rota'}  ${p.task.padEnd(9)} ${p.ref} (${p.where}): ${why[p.problem]}`);
        if (!problems.length) print('Todas las referencias resuelven.');
      }
      return broken.length ? 1 : 0;
    },

    async ref() {
      const [sub, taskId, target] = rest;
      if (sub !== 'add' && sub !== 'rm') throw new UsageError(`subcomando desconocido: ref ${sub ?? ''} (add, rm)`);
      need(taskId, 'la tarea');
      const all = await store.loadAll();
      const docs = await loadDocs(project, all.config);
      const r = resolveRef(docs, need(target, '<alias>#<id>'));
      const cur = await store.get('tasks', taskId);
      const refs = cur.doc.refs ?? [];
      let next;
      if (sub === 'add') {
        if (!r.doc) throw new StoreError('not_found', `no hay un documento "${r.key}"`);
        if (!r.section) throw new StoreError('not_found', `no hay una sección "${r.id}" en ${r.doc.path}`);
        if (refs.some((x) => x.doc === r.doc.path && x.section === r.id)) return done({ id: cur.id, etag: cur.etag, ...cur.doc }, `${taskId} ya referencia ${target}`);
        next = [...refs, { doc: r.doc.path, section: r.id }];
      } else {
        const path = r.doc?.path ?? r.key;
        next = refs.filter((x) => !((x.doc === path || x.doc === r.key) && x.section === r.id));
        if (next.length === refs.length) throw new StoreError('not_found', `${taskId} no referencia ${target}`);
      }
      const w = await store.patch('tasks', taskId, { refs: next }, { ifMatch: o.etag ?? cur.etag });
      return written({ id: w.id, etag: w.etag, ...w.doc }, `${taskId}: ${sub === 'add' ? 'agregada' : 'quitada'} ${target}`);
    },

    async export() {
      if (rest[0] !== 'md') throw new UsageError(`formato de export desconocido: ${rest[0] ?? ''} (md)`);
      const all = await store.loadAll();
      showWarnings(all.warnings);
      const path = await exportMarkdown(project, all, { out: o.out && resolve(cwd, o.out) });
      return done({ path }, `Exportado ${path}`);
    },

    async import() {
      if (rest[0] !== 'artifact') throw new UsageError(`origen de import desconocido: ${rest[0] ?? ''} (artifact)`);
      const src = resolve(cwd, need(rest[1], 'la carpeta del export'));
      if (!existsSync(join(compass, 'config.json'))) throw new StoreError('not_found', `no hay ${join(compass, 'config.json')}: corré \`scompass init\` primero`);
      const r = await importArtifact(src, compass, { validators, overwrite: o.overwrite, dryRun: o['dry-run'], ...(now && { now }) });
      const wrote = ['milestones', 'tasks'].some((c) => r[c].created.length + r[c].updated.length);
      if (wrote && !o['dry-run'] && !store.hub) {
        const all = await store.loadAll();
        if (all.config?.export_md && all.config.auto_export_md !== false) await exportMarkdown(project, all);
      }
      if (o.json) print(JSON.stringify(r));
      else {
        const line = (label, x) => `${label}: ${Object.values(x).reduce((n, l) => n + l.length, 0)} en el export · ` +
          `${x.created.length} nuevos, ${x.unchanged.length} sin cambios, ${x.updated.length} actualizados, ` +
          `${x.different.length} distintos (no importados), ${x.invalid.length} inválidos`;
        if (o['dry-run']) print('Simulación: no se escribió nada.');
        print(line('Hitos', r.milestones));
        print(line('Tareas', r.tasks));
        for (const c of ['milestones', 'tasks']) if (r[c].different.length) print(`Distintos en ${c}: ${r[c].different.join(', ')} (--overwrite para reemplazarlos)`);
        for (const w of r.warnings) warn(`aviso ${w.path}: ${w.message}`);
        // Citas "gdd.md §4.3" en lo importado: se proponen como refs, sin aplicarlas (spec §10.5).
        if (!o['dry-run']) {
          const all = await store.loadAll();
          const pending = suggestRefs(await loadDocs(project, all.config), [...all.tasks].map(([id, doc]) => ({ id, ...doc }))).filter((x) => !x.already);
          if (pending.length) print(`${pending.length} citas por número de sección pueden pasar a referencias: scompass refs suggest`);
        }
      }
      const clean = ['milestones', 'tasks'].every((c) => !r[c].different.length && !r[c].invalid.length);
      return clean && !r.warnings.length ? 0 : 1;
    },

    async add() {
      const title = need(rest[0], 'el título');
      const milestone = need(o.milestone, '--milestone');
      await store.get('milestones', milestone);
      const r = await store.create('tasks', {
        milestone, title, code: o.code ?? '', status: o.status ?? 'todo', checklist: [], test: '', notes: '', refs: []
      });
      return written({ id: r.id, etag: r.etag, ...r.doc }, `Creada ${r.id}: ${title}`);
    },

    async move() {
      const [id, status] = [need(rest[0], 'el id'), need(rest[1], 'el estado')];
      if (!STATUS[status]) throw new UsageError(`estado inválido: ${status} (todo, doing, review, done)`);
      const r = await store.patch('tasks', id, { status }, ifMatch);
      return written({ id: r.id, etag: r.etag, ...r.doc }, `${id} → ${STATUS[status]}`);
    },

    async check() {
      const id = need(rest[0], 'el id');
      const n = Number(need(rest[1], 'el número de paso'));
      const cur = await store.get('tasks', id);
      const cl = cur.doc.checklist ?? [];
      if (!Number.isInteger(n) || n < 1 || n > cl.length) {
        throw new StoreError('invalid_argument', `paso inexistente: ${rest[1]} (la tarea tiene ${cl.length})`);
      }
      const next = cl.map((c, i) => (i === n - 1 ? { ...c, done: !o.undo } : c));
      const r = await store.patch('tasks', id, { checklist: next }, { ifMatch: o.etag ?? cur.etag });
      return written({ id: r.id, etag: r.etag, ...r.doc }, `${id} paso ${n} ${o.undo ? 'desmarcado' : 'hecho'}: ${cl[n - 1].text}`);
    },

    async step() {
      const [sub, id, arg] = rest;
      if (!['add', 'set', 'rm'].includes(sub)) throw new UsageError(`subcomando desconocido: step ${sub ?? ''} (add, set, rm)`);
      need(id, 'el id de la tarea');
      const cur = await store.get('tasks', id);
      const cl = cur.doc.checklist ?? [];
      let next;
      let msg;
      if (sub === 'add') {
        const text = need(arg, 'el texto del paso');
        next = [...cl, { text, done: false, ...(o.detail ? { detail: o.detail } : {}) }];
        msg = `${id}: paso ${next.length} agregado`;
      } else {
        const n = Number(need(arg, 'el número de paso'));
        if (!Number.isInteger(n) || n < 1 || n > cl.length) throw new StoreError('invalid_argument', `paso inexistente: ${arg} (la tarea tiene ${cl.length})`);
        if (sub === 'rm') {
          next = cl.filter((_, i) => i !== n - 1);
          msg = `${id}: paso ${n} quitado`;
        } else {
          if (o.text === undefined && o.detail === undefined) throw new UsageError('falta --text o --detail');
          next = cl.map((c, i) => {
            if (i !== n - 1) return c;
            const { detail, ...rest } = c;
            const out = { ...rest, ...(o.text !== undefined ? { text: o.text } : {}) };
            const d = o.detail !== undefined ? o.detail : detail;
            return d ? { ...out, detail: d } : out;
          });
          msg = `${id}: paso ${n} actualizado`;
        }
      }
      const r = await store.patch('tasks', id, { checklist: next }, { ifMatch: o.etag ?? cur.etag });
      return written({ id: r.id, etag: r.etag, ...r.doc }, msg);
    },

    async set() {
      const id = need(rest[0], 'el id');
      const fields = Object.fromEntries(FIELDS.filter((f) => o[f] !== undefined).map((f) => [f, o[f]]));
      if (o.file !== undefined && Object.keys(fields).length) throw new UsageError('--file reemplaza la tarea entera: no se combina con campos sueltos');
      if (o.file === undefined && !Object.keys(fields).length) throw new UsageError(`falta --file o algún campo (${FIELDS.map((f) => '--' + f).join(', ')})`);
      if (fields.status && !STATUS[fields.status]) throw new UsageError(`estado inválido: ${fields.status} (todo, doing, review, done)`);
      const r = o.file !== undefined
        ? await store.put('tasks', id, await readJsonFile(o.file), ifMatch)
        : await store.patch('tasks', id, fields, ifMatch);
      return written({ id: r.id, etag: r.etag, ...r.doc }, `Guardada ${id}`);
    },

    async milestone() {
      const [sub, id] = rest;
      if (sub === 'list') {
        const { items, warnings } = await store.list('milestones');
        showWarnings(warnings);
        const milestones = listMilestones(items.map((m) => [m.id, m.doc]));
        if (o.json) return done({ milestones, warnings });
        for (const m of milestones) print(`  ${m.id.padEnd(5)} ${m.code.padEnd(4)} ${m.title}`);
        return 0;
      }
      if (sub === 'show') {
        const m = await store.get('milestones', need(id, 'el id'));
        if (o.json) return done({ id: m.id, etag: m.etag, ...m.doc });
        print(`${m.doc.code} · ${m.doc.title}  [${m.id}]`);
        if (m.doc.goal) print(m.doc.goal);
        for (const w of m.doc.done_when ?? []) print(`  - ${w}`);
        return 0;
      }
      if (sub === 'set') {
        const r = await store.put('milestones', need(id, 'el id'), await readJsonFile(need(o.file, '--file')), ifMatch);
        return written({ id: r.id, etag: r.etag, ...r.doc }, `Guardado ${r.id}`);
      }
      throw new UsageError(`subcomando desconocido: milestone ${sub ?? ''}`);
    }
  };

  if (!Object.hasOwn(commands, cmd)) {
    warn(`comando desconocido: ${cmd}\n\n${USAGE}`);
    return 2;
  }
  try {
    return await commands[cmd]();
  } catch (e) {
    if (e instanceof UsageError) { warn(`${e.message}\n\n${USAGE}`); return 2; }
    if (!(e instanceof StoreError)) throw e;
    if (o.json) err.write(JSON.stringify({ error: { code: e.code, message: e.message, ...(e.current && { current: e.current }) } }) + '\n');
    else warn(`error [${e.code}]: ${e.message}`);
    return 1;
  }
}

async function streamText(stream) {
  let s = '';
  for await (const chunk of stream) s += chunk;
  return s;
}
