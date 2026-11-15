// CLI `scompass` (spec §6). run() no toca process: recibe argv y dónde escribir, y devuelve el código de salida.
// Sin hub escribe directo en compass/ con el store json-files (misma validación y escritura atómica).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { exportMarkdown } from './export-md.js';
import { changeDocs, checkRefs, diffSections, loadDocs, resolveRef, searchDocs, sectionMarkdown, stampIds, suggestRefs } from './docs.js';
import { writeAtomic } from './store/atomic.js';
import { openUrl as openInBrowser } from './desktop.js';
import { importArtifact } from './import-artifact.js';
import { KINDS, loadValidators, parseDoc, SCHEMA_DIR } from './schema.js';
import { canonical } from './store/canonical.js';
import { createJsonFilesStore, StoreError } from './store/json-files.js';
import { createHttpStore, detectHub, hubCompatible, hubVersions } from './store/http.js';
import { createServer, freePortFrom, listen, PROTOCOL, VERSION } from './server.js';
import { serveMcp } from './mcp.js';
import { startTray } from './tray.js';
import { outdatedFiles, TEMPLATES, updateAllCompasses, updateCompass } from './update.js';
import { listTemplates, loadTemplate as loadTemplateFile } from './templates.js';
import { hubsOf, listHubs, liveHome, registerHub, unregisterHub } from './registry.js';
import { createHomeServer } from './home.js';
import { boardStatus, docDiff, docLog, docsStatus, repoFiles } from './git.js';
import { imageFile, repoFile } from './files-api.js';
import { dropImage, IMAGE_EXT, importImage, insideProject, isImagePath } from './images.js';
import { taskHistory } from './history.js';
import { boardInfo, boardsDir, linkBoard, moveBoard, newBoard } from './board.js';
import { promoteDecision } from './promote.js';
import { forgetProject, isTempPath, projectsFile, projectsStatus, pruneTempProjects, recordProject, ProjectsError } from './projects.js';
import { listLists, listMilestones, listPlaytests, listTasks } from './views.js';
import { checkItem, freeId, newItem, repeatOf, slugify } from './lists.js';
import { migrateSessions, nextPlaytest, sessionState } from './playtests.js';
import { dueState, isValidDue, repeatLabel, localDay, localStamp, milestoneDueState, showDue } from './dates.js';
import { brokenLinks, linksOf, linkView, openBlockers, reviewBlockers, wouldCycle } from './links.js';
import { decisionCounts, decisionLabel, decisionState, DECISION_STATES, MARK } from './decisions.js';
import { descriptionTemplate, DUE_FILTERS, filterTasks, PRIORITIES, PRIORITY_LABEL, SIZES, splitList } from './filters.js';
import { selfCommand } from './self.js';
import { claudeSpawn, findClaude } from './chat.js';

const STATUS = { todo: 'Pendiente', paused: 'Pausado', doing: 'En curso', review: 'Revisión', done: 'Hecho' };
// --lan (D36): las direcciones de este equipo en la red, para abrir el hub o el Inicio desde el teléfono.
const lanUrls = (port) => Object.values(networkInterfaces()).flat().filter((a) => a.family === 'IPv4' && !a.internal).map((a) => `http://${a.address}:${port}/`);
const LAN_WARNING = 'sin login: cualquiera en esta red puede ver y editar';

const USAGE = `Uso: scompass [--dir <proyecto>] <comando>

  init [--project <nombre>] [--template juego|personal|vacio] [--board <nombre>] [--in-project]
                                            crea el tablero (la plantilla trae vistas, hitos, listas y documentos
                                            iniciales; por defecto vacio). Va a la carpeta de tableros del usuario
                                            (--board: con otro nombre que el del proyecto) y compass/ queda como
                                            enlace, fuera del git del proyecto; --in-project lo crea adentro, como
                                            antes (también si el proyecto está en una carpeta temporal)
  update [--check]                          pone al día los archivos generados de compass/ (schema/ y AGENTS.md,
                                            la guía para agentes); --check solo avisa y sale con 1 si hay algo viejo
  update --all [--check]                    lo mismo en todos los proyectos que conoce el Inicio
  serve [--port 4711] [--open] [--force]    levanta el hub en 127.0.0.1 (uno por proyecto; Ctrl+C para cerrar)
        [--lan]                             también en la red, para el teléfono (sin login: solo en una red de
                                            confianza, como la de casa)
        [--exit-on-stdin-close]             se cierra cuando se corta su entrada (lo usa el dock de Godot)
        [--tray]                            ícono en la bandeja del sistema, con "Detener hub"
        [--log <archivo>]                   agrega la salida a ese archivo (el dock en Windows)
  restart                                   reinicia el hub de este proyecto (para cargar código nuevo)
  mcp                                       servidor MCP por stdio para Claude Code (§30): las herramientas son
                                            estos comandos; el proyecto es --dir o el de CLAUDE_PROJECT_DIR
  mcp install                               registra este scompass en Claude Code (claude mcp add --scope user),
                                            con su ruta entera: no hace falta tenerlo en el PATH
  hubs                                      hubs activos de todos los proyectos
  home [--port 4700] [--open] [--tray]      levanta el Inicio: todos los proyectos del equipo (uno solo por usuario;
       [--lan]                              si ya corre, dice dónde); --lan como en serve
  home restart                              reinicia el Inicio (para cargar código nuevo), en el mismo puerto
  home list                                 proyectos conocidos en este equipo, con el estado de su hub
  board                                     dónde está el tablero: en el proyecto, enlazado a un tablero con su
                                            propio git o en un submódulo (con su origin)
  board move [<nombre>]                     saca compass/ a la carpeta de tableros del usuario, con su propio git y
                                            su historial; compass/ queda como enlace y fuera del git del proyecto
  board link <nombre|carpeta>               enlaza compass/ a un tablero ya clonado (en otro equipo)
  home add [<carpeta>]                      anota un proyecto sin levantar su hub (por defecto, el de --dir)
  home rm [<carpeta>]                       lo quita del registro (no toca sus datos)
  list [--milestone m00] [--status doing,review] [filtros]
                                            tareas (--json para agentes). Filtros (§19): --q "texto",
                                            --due overdue|today|week|none, --blocked, --unblocked,
                                            --pending-steps, --with-refs, --tag arte,audio,
                                            --priority high,medium,low,none, --size s,m,l,none,
                                            --assignee nombre|none, --decisions open,pending,revert
  show <id>                                 una tarea, con los pasos numerados
  history <id>                              qué cambió en la tarea en cada commit (y lo que hay sin commitear)
  add "<título>" --milestone m00 [--code 0.11] [--status todo] [--due 2026-10-10]
      [--tags arte,audio] [--priority high|medium|low] [--size s|m|l] [--assignee nombre] [--description "…"]
  move <id> <todo|paused|doing|review|done>
  rm <id>                                   borra la tarea (y sus capturas guardadas por la app que nadie más cita);
                                            los vínculos de otras tareas hacia ella quedan rotos, como en la web
  check <id> <n> [--undo]                   tilda el paso n (desde 1)
  step add <id> "<texto>" [--detail "…"]     agrega un paso (texto corto; el detalle se despliega)
  step set <id> <n> [--text …] [--detail …]  cambia un paso (--detail "" lo quita)
  step rm <id> <n>                          quita un paso
  decide <id> "<texto>" [--why "…"] [--alternatives "…"] [--ask] [--session <uuid>]
                                            registra una decisión (§31): sin --ask, tomada sin consultar (queda sin
                                            revisar); con --ask, una pregunta al usuario (queda abierta) y la sesión de
                                            Claude Code que la hace (--session, o CLAUDE_CODE_SESSION_ID), para
                                            retomarla desde el chat al responder
  decision ok|revert|reverted <id> <n> [--reply "…"]
                                            revisa la decisión n (desde 1): de acuerdo, a revertir (--reply: qué
                                            hacer en su lugar) o ya revertida
  decision reply <id> <n> "<respuesta>"     responde la pregunta n
  decision rm <id> <n>                      quita la decisión n
  decision promote <id> <n>                 la agrega como entrada D-n al documento de decisiones (el alias de
                                            config.json › decisions_doc, o "decisiones"); no commitea
  decisions [--open] [--pending] [--revert] [--milestone m00]
                                            decisiones de todo el proyecto, la más nueva arriba (sin filtro, todas)
  set <id> --file task.json                 reemplazo completo (--file - lee stdin; vale la salida de show --json)
  set <id> [--title t] [--description d] [--notes n] [--test p] [--code c] [--milestone m] [--status s]
      [--due d] [--tags a,b] [--priority p] [--size s|m|l] [--assignee a]
                                            cambia solo esos campos (--due: fecha límite, YYYY-MM-DD o
                                            YYYY-MM-DDTHH:MM; "" quita --description, --due, --tags,
                                            --priority, --size o --assignee)
  milestone list | show <id> | set <id> --file m.json
  milestone set <id> --due 2026-11-01       fecha objetivo del hito ("" la quita); atrasado si pasa con tareas pendientes
  lists                                     listas, con cuántos ítems quedan
  lists show <lista>                        una lista, con los ítems numerados
  lists add "<título>"                      crea una lista (el id sale del título: "Libros para leer" → libros-para-leer)
  lists set <lista> --title "…"              le cambia el título
  lists rm <lista>                          borra la lista
  item add <lista> "<texto>" [--due 2026-10-10] [--repeat month] [--interval 2]
                                            agrega un ítem (--due: fecha límite, YYYY-MM-DD o YYYY-MM-DDTHH:MM;
                                            --repeat day|week|month|year, con --due; --interval: cada cuántos)
  item check <lista> <n> [--undo]           tilda el ítem n (desde 1); si se repite, su fecha avanza un período
  item set <lista> <n> [--text …] [--due …] [--repeat …] [--interval …]
                                            cambia un ítem (--due "" quita la fecha; --repeat "" deja de repetirlo)
  item rm <lista> <n>                       quita un ítem
  item clear <lista>                        quita los ítems tildados
  item task <lista> <n> --milestone m00 [--code 0.12]
                                            pasa el ítem a una tarea nueva y lo deja enlazado
  playtest                                  sesiones de playtest, con cuántas tareas faltan probar
  playtest show <sesión>                    una sesión, con las tareas numeradas en el orden de prueba
  playtest new "<título>" [--review] [--milestone m00]
                                            crea una sesión (el id sale del título); --review la carga con las
                                            tareas en Revisión (de ese hito, con --milestone)
  playtest set <sesión> --title "…"          le cambia el título
  playtest rm <sesión>                      borra la sesión (las tareas no se tocan)
  playtest add <sesión> <tarea>… [--at n] [--review] [--milestone m00]
                                            agrega tareas ya creadas al final (o desde la posición n); las que ya
                                            están no se repiten; --review suma las que están en Revisión
  playtest move <sesión> <n|tarea> <pos>    la lleva a la posición pos (desde 1)
  playtest drop <sesión> <n|tarea>          la saca de la sesión
  playtest pass|fail <sesión> <n|tarea> [--note "…"]
                                            anda / falla, con lo que se vio (--note "" quita la nota); se guarda en
                                            la tarea, así se ve igual en todas las sesiones que la tienen
  playtest reset <sesión> <n|tarea>         vuelve a "sin probar" (la nota queda)
  playtest migrate                          pasa las sesiones del formato anterior (resultado y nota en la sesión)
                                            a las tareas
  doc list                                  documentos de config.json con su índice de secciones
  doc add <alias> <ruta|patrón>             declara un documento (un archivo, o un patrón como "docs/**/*.md")
  doc rm <alias>                            deja de declararlo (el archivo no se toca)
  doc show <alias>[#<id>] [--raw]           una sección, o el documento entero sin #<id> (--raw: solo el markdown)
  doc stamp-ids <alias> [--dry-run]         agrega <!-- id: … --> a las secciones que no tienen
  doc search "<texto>"                      líneas de los documentos con todas las palabras (sin tildes ni mayúsculas)
  doc status                                estado de git de cada documento y su último commit
  doc diff <alias>                          cambios sin commitear del documento (contra HEAD) y las secciones que toca
  refs check                                referencias rotas (sale con 1 si hay) y frágiles; también archivos que ya no están
  refs suggest                              propone refs a partir de citas "gdd.md §4.3" (no aplica nada)
  ref add|rm <tarea> <alias>[#<id>]         agrega o quita una referencia (sin #<id>, al documento entero)
  file add|rm <tarea> <ruta>                vincula un archivo del repo a la tarea (un script, una escena; acepta res://)
  image add|rm <tarea> <ruta>               captura de la tarea: una imagen del repo, o una de afuera, que se copia a
                                            compass/images/ (rm borra el archivo si lo guardó la app y nadie más lo cita)
  link add <tarea> <blocks|blocked-by|related> <otra>
                                            vincula dos tareas (reemplaza el vínculo que tuvieran)
  link rm <tarea> <otra>                    quita el vínculo entre las dos
  link list [<tarea>]                       vínculos de una tarea o de todas; avisa los rotos (sale con 1)
  export md [--out docs/tareas.md]          regenera el markdown (también se hace solo al escribir)
  import artifact <carpeta> [--dry-run] [--overwrite]
                                            migra el export de ArtifactData (milestones/, tasks/)

  --json      salida JSON en lecturas y escrituras
  --etag <e>  en escrituras: falla con conflicto si el documento cambió (none: si ya existe)
  --dir <p>   raíz del proyecto (por defecto: la carpeta con compass/ más cercana hacia arriba)
  --direct    escribir directo en compass/ aunque haya un hub corriendo

Si hay un hub de este proyecto en el puerto de config.json, las lecturas y escrituras pasan por su API.`;

class UsageError extends Error {}

// "m5-02 (5.2 Título)" para mostrar una tarea vinculada; si no existe, se avisa.
const taskLabel = (tasks, id) => { const t = tasks.find((x) => x.id === id); return t ? `${id} (${[t.code, t.title].filter(Boolean).join(' ')})` : `${id} (no existe)`; };

// Los agentes solo cargan solos el AGENTS.md o CLAUDE.md de la raíz: la guía se enlaza desde ahí, a mano.
const AGENTS_HINT = 'Para que los agentes la usen, agregá al AGENTS.md o CLAUDE.md del proyecto: "El tablero de tareas se maneja con scompass; leé compass/AGENTS.md antes de tocarlo."';

// Campos de una tarea que `set` edita sin --file.
const FIELDS = ['title', 'description', 'notes', 'test', 'code', 'milestone', 'status', 'due', 'tags', 'priority', 'size', 'assignee'];

const OPTIONS = {
  dir: { type: 'string' }, json: { type: 'boolean' }, etag: { type: 'string' },
  milestone: { type: 'string' }, status: { type: 'string' }, code: { type: 'string' },
  file: { type: 'string' }, out: { type: 'string' }, overwrite: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, undo: { type: 'boolean' }, project: { type: 'string' },
  raw: { type: 'boolean' }, check: { type: 'boolean' }, template: { type: 'string' }, due: { type: 'string' }, repeat: { type: 'string' }, interval: { type: 'string' },
  port: { type: 'string' }, open: { type: 'boolean' }, direct: { type: 'boolean' }, 'exit-on-stdin-close': { type: 'boolean' }, tray: { type: 'boolean' }, lan: { type: 'boolean' }, force: { type: 'boolean' }, log: { type: 'string' },
  q: { type: 'string' }, blocked: { type: 'boolean' }, unblocked: { type: 'boolean' }, 'pending-steps': { type: 'boolean' }, 'with-refs': { type: 'boolean' },
  tag: { type: 'string' }, tags: { type: 'string' }, priority: { type: 'string' }, size: { type: 'string' }, assignee: { type: 'string' },
  at: { type: 'string' }, review: { type: 'boolean' }, note: { type: 'string' },
  why: { type: 'string' }, alternatives: { type: 'string' }, ask: { type: 'boolean' }, session: { type: 'string' }, reply: { type: 'string' }, decisions: { type: 'string' },
  pending: { type: 'boolean' }, revert: { type: 'boolean' }, 'in-project': { type: 'boolean' }, all: { type: 'boolean' }, board: { type: 'string' },
  title: { type: 'string' }, description: { type: 'string' }, notes: { type: 'string' }, test: { type: 'string' }, text: { type: 'string' }, detail: { type: 'string' },
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
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function run(argv, { cwd = process.cwd(), out = process.stdout, err = process.stderr, stdin = process.stdin, now, signal, env = process.env } = {}) {
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
  if (!o.direct && !['init', 'update', 'serve', 'restart', 'hubs', 'home', 'help', 'mcp', 'board'].includes(cmd)) {
    const cfg = await readFile(join(compass, 'config.json'), 'utf8').then(JSON.parse).catch(() => null);
    const hub = await detectHub(project, cfg?.port);
    // Un hub de otro protocolo (§39) no se usa: la API pudo cambiar. Se escribe directo en compass/ y su watcher lo ve.
    if (hub && !hubCompatible(hub)) {
      const h = hubVersions.get(hub);
      warn(`aviso: el hub en ${hub} es la versión ${h.version || '?'} (protocolo ${h.protocol ?? 'anterior a §39'}) y esta CLI la ${VERSION} (protocolo ${PROTOCOL}): no se usa y se escribe directo en compass/. Reinicialo con la versión nueva`);
    } else if (hub) {
      store = createHttpStore(hub, compass, { validators });
      // Hub de otra versión (por ejemplo, quedó corriendo de antes de actualizar): puede no conocer campos nuevos.
      const v = hubVersions.get(hub)?.version;
      if (v && v !== VERSION) warn(`aviso: el hub en ${hub} es la versión ${v} y esta CLI la ${VERSION}; reinicialo con \`scompass restart\``);
    }
  }
  // --etag none: el documento no tiene que existir.
  const ifMatch = o.etag === undefined ? {} : { ifMatch: o.etag === 'none' ? null : o.etag };
  const showWarnings = (ws) => { for (const w of ws) warn(`aviso [${w.code}] ${w.path}: ${w.message}`); };
  const need = (v, what) => { if (v === undefined || v === '') throw new UsageError(`falta ${what}`); return v; };
  // Fecha límite (D26): "" sirve para quitarla.
  const due = (v) => { if (v !== '' && !isValidDue(v)) throw new StoreError('invalid_argument', `fecha inválida: ${v} (YYYY-MM-DD o YYYY-MM-DDTHH:MM)`); return v; };
  // Etiquetas, prioridad y responsable (D32): "" quita el campo (null en un patch).
  const priority = (v) => { if (v !== '' && !PRIORITIES.includes(v)) throw new UsageError(`prioridad inválida: ${v} (${PRIORITIES.join(', ')})`); return v || null; };
  const size = (v) => { const s = v.toLowerCase(); if (s !== '' && !SIZES.includes(s)) throw new UsageError(`tamaño inválido: ${v} (${SIZES.join(', ')})`); return s || null; };
  const tagList = (v) => { const t = [...new Set(splitList(v))]; return t.length ? t : null; };
  const extras = (d) => [d.priority && `prioridad ${PRIORITY_LABEL[d.priority] ?? d.priority}`, d.size && `tamaño ${d.size.toUpperCase()}`, d.assignee && `@${d.assignee}`, d.tags?.length && d.tags.map((x) => '#' + x).join(' ')].filter(Boolean);
  // Fecha objetivo de un hito (18.2): atrasado si pasó con tareas sin terminar.
  const msDueNote = (m, tasks) => {
    const s = milestoneDueState(m, tasks);
    return s ? `fecha objetivo ${showDue(m.due)}${s === 'overdue' ? ' (atrasado)' : s === 'today' ? ' (hoy)' : ''}` : '';
  };
  const dueNote = (d, done) => { const s = done ? null : dueState(d); return `vence ${showDue(d)}${s === 'overdue' ? ' (vencida)' : s === 'today' ? ' (hoy)' : ''}`; };

  const readJsonFile = async (path) => {
    const text = path === '-' ? await streamText(stdin) : await readFile(resolve(cwd, path), 'utf8');
    try { return JSON.parse(text); } catch (e) { throw new StoreError('invalid_argument', `${path}: JSON inválido: ${e.message}`); }
  };
  // Documento entero para --file (19.4): lo que devuelve show --json trae id y etag, que no son campos. El etag, si
  // no se pasó --etag, sirve de If-Match: si alguien cambió el documento después del show, es un conflicto.
  const readDocFile = async (path, id) => {
    const body = await readJsonFile(path);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new StoreError('invalid_argument', `${path}: tiene que ser un objeto JSON`);
    const { id: fileId, etag, ...doc } = body;
    if (fileId !== undefined && fileId !== id) throw new UsageError(`${path} es de ${fileId}, no de ${id}`);
    return { doc, opts: o.etag === undefined && typeof etag === 'string' ? { ifMatch: etag } : ifMatch };
  };
  const done = (r, msg) => { o.json ? print(JSON.stringify(r)) : print(msg); return 0; };
  // "  2. ! Usar X · sin revisar", con el porqué, lo descartado y la respuesta debajo. task: de qué tarea, en decisions.
  const printDecision = (d, n, pad, task) => {
    const st = decisionState(d);
    print(`${pad}${String(n).padStart(2)}. ${MARK[st]} ${d.text} · ${decisionLabel(d)}${d.promoted ? ' · ' + d.promoted : ''}${task ? ` · ${task}` : ''}${d.at ? ' · ' + localDay(d.at) : ''}`);
    for (const [label, s] of [['Por qué', d.why], ['Descartado', d.alternatives], [d.asked ? 'Respuesta' : 'Qué hacer', d.reply]]) {
      if (s) print(`${pad}      ${label}: ${s.replace(/\n/g, `\n${pad}      `)}`);
    }
  };
  // D13: después de cada escritura se regenera el export, salvo auto_export_md: false. Con hub, lo hace el hub.
  const written = async (r, msg) => {
    if (store.hub) return done(r, msg);
    const all = await store.loadAll();
    if (all.config?.export_md && all.config.auto_export_md !== false) await exportMarkdown(project, all);
    return done(r, msg);
  };

  // El Inicio: un proceso por usuario (kind "home" en el registro de hubs). Si ya hay uno, dice dónde está.
  async function serveHome() {
    const openUrl = (url) => openInBrowser(url, { onError: () => warn(`no se pudo abrir el navegador: ${url}`) });
    const running = liveHome();
    if (running) {
      const url = `http://127.0.0.1:${running.port}/`;
      // --lan no se le agrega a uno que ya corre (home restart repite sus mismas opciones): hay que cerrarlo.
      if (o.lan && !running.lan) throw new StoreError('conflict', `el Inicio ya corre en ${url} (PID ${running.pid}) sin --lan: cerralo ("Salir" en la bandeja o Ctrl+C) y volvé a correr este comando`);
      if (o.open) openUrl(url);
      return done({ url, port: running.port, pid: running.pid, already: true }, `El Inicio ya corre en ${url} (PID ${running.pid})`);
    }
    let port = Number(o.port ?? 4700);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UsageError(`puerto inválido: ${o.port}`);
    if (o.port === undefined) {
      const free = await freePortFrom(port);
      if (free !== null && free !== port) { warn(`aviso: el puerto ${port} está ocupado; el Inicio usa el ${free}`); port = free; }
    }
    // Reiniciar (9.8): se cierra y se vuelve a lanzar el mismo comando en el mismo puerto (carga código nuevo).
    // withLan: con qué --lan vuelve al reiniciar; la bandeja lo cambia (una IP no se suma a un servidor que ya escucha).
    let restart = false, withLan = !!o.lan;
    const app = createHomeServer({ validators, onRestart: () => { restart = true; ac.abort(); }, onShutdown: () => ac.abort() });
    let addr;
    try { addr = await listen(app, port, { lan: o.lan }); } catch (e) {
      await app.close();
      if (e.code === 'EADDRINUSE') throw new StoreError('io_error', `el puerto ${port} está ocupado`);
      throw e;
    }
    registerHub({ port: addr.port, kind: 'home', lan: o.lan });
    // Tableros de prueba en carpetas temporales que ya se borraron: no quedan en el Inicio.
    try { await pruneTempProjects(); } catch { /* un projects.json roto lo informa la página */ }
    const url = `http://127.0.0.1:${addr.port}/`;
    const lan = o.lan ? lanUrls(addr.port) : undefined;
    o.json ? print(JSON.stringify({ url, port: addr.port, lan })) : print(`Inicio de Scope Compass en ${url} · ${projectsFile()} · Ctrl+C para cerrar`);
    if (lan && !o.json) print(`En la red (${LAN_WARNING}): ${lan.join(' ') || 'ninguna dirección'}`);
    if (o.open) openUrl(url);
    const ac = new AbortController();
    let tray = null;
    if (o.tray) {
      try {
        tray = await startTray({ title: 'Scope Compass', tooltip: `Inicio · ${url}`, onActivate: () => openUrl(url),
          items: () => homeTrayItems({ app, url, openUrl, warn, close: () => ac.abort(), restart: () => { restart = true; ac.abort(); },
            lan, toggleLan: () => { withLan = !withLan; restart = true; ac.abort(); }, refresh: () => tray?.refresh() }) });
        // Recién con el ícono puesto los hubs esconden el suyo.
        registerHub({ port: addr.port, kind: 'home', tray: true, lan: o.lan });
        app.events.on('event', (e) => { if (e.type === 'hubs' || e.type === 'projects') tray?.refresh(); });
      } catch (e) {
        warn(`sin ícono en la bandeja: ${e.message}`);
      }
    }
    if (signal) signal.addEventListener('abort', () => ac.abort(), { once: true });
    else { process.once('SIGINT', () => ac.abort()); process.once('SIGTERM', () => ac.abort()); }
    if (!ac.signal.aborted && !signal?.aborted) await new Promise((res) => ac.signal.addEventListener('abort', res, { once: true }));
    tray?.close();
    await app.close();
    unregisterHub();
    if (restart) {
      const again = argv.filter((x, i) => x !== '--port' && argv[i - 1] !== '--port' && !x.startsWith('--port=') && x !== '--open' && x !== '--lan');
      spawn(...selfCommand([...again, '--port', String(addr.port), ...(withLan ? ['--lan'] : [])]), { cwd, env: process.env, stdio: 'inherit', detached: true, windowsHide: true }).unref();
      if (!o.json) print('Reiniciando el Inicio…');
    }
    return 0;
  }

  // `scompass home restart`: le pide al Inicio que se reinicie y espera al nuevo (mismo puerto, otro PID).
  async function restartHome() {
    const h = liveHome();
    if (!h) throw new StoreError('not_found', 'el Inicio no está corriendo (scompass home lo levanta)');
    const url = `http://127.0.0.1:${h.port}`;
    const r = await fetch(url + '/api/restart', { method: 'POST' }).catch(() => null);
    if (r?.status !== 202) throw new StoreError('io_error', `el Inicio no aceptó reiniciarse (${r ? 'HTTP ' + r.status : 'sin respuesta'})`);
    for (let i = 0; i < 100; i++) {
      await new Promise((res) => setTimeout(res, 100));
      const health = await fetch(url + '/api/health', { signal: AbortSignal.timeout(300) }).then((x) => x.json()).catch(() => null);
      if (health?.pid && health.pid !== h.pid) return done({ url: url + '/', pid: health.pid, previous: h.pid }, `Inicio reiniciado en ${url}/ (PID ${h.pid} → ${health.pid})`);
    }
    throw new StoreError('io_error', 'el Inicio se cerró pero no volvió en 10 s');
  }

  // El resto de init, ya con compass/ (o el enlace del tablero, m32-10) en su lugar.
  async function initBoard(tpl, board) {
    for (const d of ['milestones', 'tasks', 'schema']) await mkdir(join(compass, d), { recursive: true });
    for (const k of KINDS) await copyFile(join(SCHEMA_DIR, `${k}.schema.json`), join(compass, 'schema', `${k}.schema.json`));
    await copyFile(join(TEMPLATES, 'compass-README.md'), join(compass, 'README.md'));
    await copyFile(join(TEMPLATES, 'compass-AGENTS.md'), join(compass, 'AGENTS.md'));
    await copyFile(join(TEMPLATES, 'compass-gitattributes'), join(compass, '.gitattributes'));
    await writeFile(join(compass, '.gdignore'), '');
    const config = { project: o.project || basename(project), export_md: board ? 'compass/tareas.md' : 'docs/tareas.md', port: 4711, ...tpl.config };
    const res = parseDoc(JSON.stringify(config), 'config', validators);
    if (!res.ok) throw new StoreError('invalid_argument', res.message);
    await writeFile(join(compass, 'config.json'), canonical(config));
    for (const [id, doc] of Object.entries(tpl.milestones ?? {})) await store.put('milestones', id, doc, { ifMatch: null });
    for (const [id, doc] of Object.entries(tpl.lists ?? {})) await store.put('lists', id, doc, { ifMatch: null });
    // Archivos del proyecto (el GDD de la plantilla juego): solo si no existen.
    const files = { created: [], kept: [] };
    for (const [rel, text] of Object.entries(tpl.files ?? {})) {
      const path = join(project, rel);
      if (existsSync(path)) { files.kept.push(rel); continue; }
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, text);
      files.created.push(rel);
    }
    // Con datos iniciales, el export ya los muestra; sin datos (vacio) se genera en la primera escritura, como antes.
    if (Object.keys(tpl.milestones ?? {}).length + Object.keys(tpl.lists ?? {}).length) await exportMarkdown(project, await store.loadAll());
    try { await recordProject(project, { auto: true }); } catch (e) { warn(`aviso: no se anotó el proyecto en ${projectsFile()}: ${e.message}`); }
    const extra = [...files.created.map((f) => `Creado ${f}`), ...files.kept.map((f) => `Ya existía ${f}: no se tocó`)];
    return done({ dir: compass, config, template: tpl.name, files, ...(board && { board: board.target, shared: board.shared }) },
      [`Creado ${board ? `${board.target} (plantilla ${tpl.name}), enlazado desde ${compass}` : `${compass} (plantilla ${tpl.name})`}`, ...extra, AGENTS_HINT].join('\n'));
  }

  const commands = {
    async init() {
      if (existsSync(join(compass, 'config.json'))) throw new StoreError('conflict', `ya existe ${join(compass, 'config.json')}`);
      // Plantilla (spec §16.6, D25): config prearmada + datos iniciales, sin código propio. Se valida antes de crear nada.
      const tpl = await loadTemplate(o.template ?? 'vacio');
      // Los tableros son del usuario (m32-10): afuera, salvo --in-project o un proyecto de prueba en /tmp (como el
      // registro del Inicio, que no anota los temporales). --board fuerza afuera.
      const outside = !o['in-project'] && (o.board !== undefined || !isTempPath(project));
      const board = outside ? await newBoard(project, o.board ?? (o.project || basename(project))) : null;
      try {
        return await initBoard(tpl, board);
      } catch (e) {
        // Un tablero nuevo a medio armar no queda en la carpeta de tableros.
        if (board) { await rm(board.path, { force: true }).catch(() => {}); await rm(board.target, { recursive: true, force: true }).catch(() => {}); }
        throw e;
      }
    },

    // schema/ y AGENTS.md al día con esta versión de Scope Compass (ver update.js).
    async update() {
      // --all (§38): todos los proyectos que conoce el Inicio, como "Actualizar todos".
      if (o.all) {
        const r = updateAllCompasses(projectsStatus(), { check: o.check });
        const lines = r.map((x) => `  ${x.name} (${x.path}): ${x.files.join(', ')}`).join('\n');
        if (o.check) {
          o.json ? print(JSON.stringify({ outdated: r })) : print(r.length ? `Desactualizados (corré \`scompass update --all\`):\n${lines}` : 'Todos los tableros están al día.');
          return r.length ? 1 : 0;
        }
        const hint = r.some((x) => x.files.includes('compass/AGENTS.md')) ? `\n${AGENTS_HINT}` : '';
        return done({ updated: r }, r.length ? `Actualizados:\n${lines}${hint}` : 'Todos los tableros ya estaban al día.');
      }
      if (!existsSync(join(compass, 'config.json'))) throw new StoreError('not_found', `no hay ${compass}: corré \`scompass --dir ${project} init\` para crearla`);
      const names = outdatedFiles(compass).map((rel) => `compass/${rel}`);
      if (o.check) {
        o.json ? print(JSON.stringify({ outdated: names })) : print(names.length ? `Desactualizados (corré \`scompass update\`):\n${names.map((n) => '  ' + n).join('\n')}` : 'compass/ está al día.');
        return names.length ? 1 : 0;
      }
      updateCompass(compass);
      const hint = names.includes('compass/AGENTS.md') ? `\n${AGENTS_HINT}` : '';
      return done({ updated: names }, names.length ? `Actualizados:\n${names.map((n) => '  ' + n).join('\n')}${hint}` : 'compass/ ya estaba al día.');
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
        if (h.kind === 'served') throw new StoreError('conflict', `este proyecto lo sirve el Inicio en http://127.0.0.1:${h.port}${h.base}/ (D29): no hace falta otro hub`);
        throw new StoreError('conflict', `ya hay un hub de este proyecto: PID ${h.pid} en http://127.0.0.1:${h.port}/ (scompass hubs lista todos; --force para levantar otro igual)`);
      }
      let port = Number(o.port ?? all.config?.port ?? 4711);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UsageError(`puerto inválido: ${o.port}`);
      // El puerto de la config ocupado (típico: el hub de otro proyecto, todos nacen con 4711): se usa el siguiente
      // libre. La CLI y el dock encuentran el hub por el registro. Con --port explícito no se cambia: falla.
      if (o.port === undefined && port !== 0) {
        const free = await freePortFrom(port);
        if (free !== null && free !== port) {
          warn(`aviso: el puerto ${port} está ocupado; este hub usa el ${free}`);
          port = free;
        }
      }
      let restart = false;
      const app = createServer({ projectDir: project, store, validators, watch: true, exportMd: true,
        onRestart: () => { restart = true; ac.abort(); }, onShutdown: () => ac.abort() });
      if (!o.json) app.events.on('event', (e) => { if (e.type === 'warning') warn(`aviso [${e.code}] ${e.path}: ${e.message}`); });
      let addr;
      try {
        addr = await listen(app, port, { lan: o.lan });
      } catch (e) {
        await app.close();
        if (e.code === 'EADDRINUSE') throw new StoreError('io_error', `el puerto ${port} está ocupado (¿ya hay un hub corriendo?)`);
        throw e;
      }
      registerHub({ port: addr.port, project, attached: !!o['exit-on-stdin-close'] });
      // Registro de proyectos (D23): el Inicio lo conoce aunque después se apague. Un registro roto no frena al hub.
      try { await recordProject(project, { seen: true, auto: true }); } catch (e) { warn(`aviso: no se anotó el proyecto en ${projectsFile()}: ${e.message}`); }
      const url = `http://127.0.0.1:${addr.port}/`;
      const lan = o.lan ? lanUrls(addr.port) : undefined;
      o.json ? print(JSON.stringify({ url, port: addr.port, project, lan })) : print(`Scope Compass en ${url} · ${project} · Ctrl+C para cerrar`);
      if (lan && !o.json) print(`En la red (${LAN_WARNING}): ${lan.join(' ') || 'ninguna dirección'}`);
      const openBoard = () => openInBrowser(url, { onError: () => warn(`no se pudo abrir el navegador: ${url}`) });
      if (o.open) openBoard();
      // Desde la bandeja: si ya hay un tablero abierto que puede notificar, se le pide que llame la atención en
      // lugar de abrir otra pestaña (el navegador no deja enfocar una pestaña desde afuera).
      const showBoard = () => { if (!app.focusBoard()) openBoard(); };
      const ac = new AbortController();
      let tray = null;
      // Con un Inicio con bandeja (D24, §16.3) el ícono de este hub se esconde: el Inicio lo muestra en su menú.
      // Se revisa cada segundo; si el Inicio se va, el ícono vuelve.
      const homeHasTray = () => !!liveHome()?.tray;
      let trayBusy = false;
      let trayWarned = false;
      const showTray = async () => {
        if (trayBusy || tray) return;
        trayBusy = true;
        try {
          tray = await startTray({
            title: 'Scope Compass',
            tooltip: `${all.config?.project ?? project} · ${url}`,
            onActivate: showBoard,
            items: [{ label: 'Abrir tablero', onClick: showBoard },
              // Solo se ve si compass/schema o AGENTS.md quedaron viejos; se revisa cada vez que se abre el menú.
              { label: () => { const n = outdatedFiles(compass).length; return `Actualizar compass/ (${n} archivo${n === 1 ? '' : 's'})`; },
                visible: () => outdatedFiles(compass).length > 0,
                onClick: () => {
                  try { const files = updateCompass(compass); if (!o.json) print(`compass/ actualizado: ${files.join(', ')}`); }
                  catch (e) { warn(`no se pudo actualizar compass/: ${e.message}`); }
                  tray?.refresh();
                } },
              { label: 'Reiniciar hub', onClick: () => { restart = true; ac.abort(); } },
              { label: 'Detener hub', onClick: () => ac.abort() }]
          });
        } catch (e) {
          if (!trayWarned) warn(`sin ícono en la bandeja: ${e.message}`);
          trayWarned = true;
        } finally {
          trayBusy = false;
        }
      };
      let traySync = null;
      if (o.tray) {
        if (!homeHasTray()) await showTray();
        traySync = setInterval(() => {
          if (homeHasTray()) { if (tray) { tray.close(); tray = null; } }
          else if (!tray && !trayWarned) showTray();
        }, 1000);
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
      clearInterval(traySync);
      tray?.close();
      await app.close();
      unregisterHub();
      // Reinicio: el mismo comando otra vez, con la misma entrada y salida (si lo lanzó el dock, sigue atado a
      // Godot por la misma tubería) y el puerto ya libre.
      if (restart) {
        // En el mismo puerto que tenía (con --port 0 tomaría otro al azar).
        const again = argv.filter((x, i) => x !== '--port' && argv[i - 1] !== '--port' && !x.startsWith('--port='));
        spawn(...selfCommand([...again, '--port', String(addr.port)]), { cwd, env: process.env, stdio: 'inherit', detached: true, windowsHide: true }).unref();
        if (!o.json) print('Reiniciando el hub…');
        if (stdin === process.stdin) process.exit(0);
      }
      return 0;
    },

    async list() {
      const statuses = splitList(o.status);
      for (const st of statuses) if (!STATUS[st]) throw new UsageError(`estado inválido: ${st} (todo, paused, doing, review, done)`);
      if (o.due !== undefined && !DUE_FILTERS.includes(o.due)) throw new UsageError(`--due en list: ${DUE_FILTERS.join(', ')}`);
      if (o.blocked && o.unblocked) throw new UsageError('--blocked y --unblocked no van juntos');
      const priorities = splitList(o.priority);
      for (const p of priorities) if (p !== 'none' && !PRIORITIES.includes(p)) throw new UsageError(`prioridad inválida: ${p} (${PRIORITIES.join(', ')}, none)`);
      const sizes = splitList(o.size).map((x) => x.toLowerCase());
      for (const s of sizes) if (s !== 'none' && !SIZES.includes(s)) throw new UsageError(`tamaño inválido: ${s} (${SIZES.join(', ')}, none)`);
      const decisions = splitList(o.decisions);
      for (const s of decisions) if (!DECISION_STATES.includes(s)) throw new UsageError(`--decisions: ${DECISION_STATES.join(', ')}`);
      const all = await store.loadAll();
      showWarnings(all.warnings);
      const ms = new Map(all.milestones);
      const everything = listTasks(all);
      const tasks = filterTasks(listTasks(all, { milestone: o.milestone }), {
        q: o.q, status: statuses, due: o.due, blocked: o.blocked ? true : o.unblocked ? false : undefined,
        pendingSteps: o['pending-steps'], withRefs: o['with-refs'], tags: splitList(o.tag ?? o.tags), priority: priorities, size: sizes, assignee: splitList(o.assignee), decisions
      }, { all: everything });
      const git = await boardStatus(project, all.config);
      if (o.json) {
        print(JSON.stringify({ tasks, warnings: all.warnings, ...(git.repo && { uncommitted: git.uncommitted }) }));
        return 0;
      }
      let last;
      for (const t of tasks) {
        if (t.milestone !== last) {
          last = t.milestone;
          const m = ms.get(last);
          print(`\n${m ? `${m.code} · ${m.title}${m.due ? ' · ' + msDueNote({ id: last, ...m }, everything) : ''}` : last}`);
        }
        const cl = t.checklist ?? [];
        const steps = cl.length ? `  ${cl.filter((c) => c.done).length}/${cl.length}` : '';
        const blockers = t.status === 'done' ? [] : openBlockers(everything, t.id);
        const inReview = blockers.length || t.status === 'done' ? [] : reviewBlockers(everything, t.id);
        const blocked = blockers.length ? `  [bloqueada por ${blockers.join(', ')}]` : inReview.length ? `  [desbloqueada, en revisión: ${inReview.join(', ')}]` : '';
        const when = t.due ? `  · ${dueNote(t.due, t.status === 'done')}` : '';
        const dc = decisionCounts(t);
        const more = [...extras(t), dc.open && `${dc.open} ${dc.open === 1 ? 'pregunta abierta' : 'preguntas abiertas'}`, dc.pending && `${dc.pending} sin revisar`,
          dc.revert && `${dc.revert} a revertir`].filter(Boolean).map((x) => `  · ${x}`).join('');
        print(`  ${t.id.padEnd(9)} ${(t.code || '').padEnd(5)} ${STATUS[t.status].padEnd(9)} ${t.title}${steps}${when}${more}${blocked}`);
      }
      if (!tasks.length) print('Sin tareas.');
      // Recordatorio (4.4): la app no commitea en local.
      if (git.uncommitted) print(`\n${git.uncommitted === 1 ? '1 archivo' : git.uncommitted + ' archivos'} del tablero sin commitear (git status -- ${['compass', all.config?.export_md].filter(Boolean).join(' ')})`);
      return 0;
    },

    async show() {
      const t = await store.get('tasks', need(rest[0], 'el id'));
      if (o.json) return done({ id: t.id, etag: t.etag, ...t.doc });
      const d = t.doc;
      print(`${d.code ? d.code + ' ' : ''}${d.title}  [${t.id}]`);
      print(`Estado: ${STATUS[d.status]}${d.done_at ? ' el ' + localDay(d.done_at) : ''} · Hito: ${d.milestone}${d.due ? ' · ' + dueNote(d.due, d.status === 'done').replace(/^v/, 'V') : ''}${d.updated_at ? ' · Actualizada: ' + d.updated_at : ''}`);
      if (extras(d).length) print(extras(d).join(' · ').replace(/^p/, 'P'));
      if (d.description) print(d.description);
      (d.checklist ?? []).forEach((c, i) => {
        print(`  ${String(i + 1).padStart(2)}. [${c.done ? 'x' : ' '}] ${c.text}`);
        if (c.detail) for (const l of c.detail.split('\n')) print(`         ${l}`);
      });
      if (d.decisions?.length) {
        print('Decisiones:');
        d.decisions.forEach((x, i) => printDecision(x, i + 1, '  '));
      }
      if (d.test) print(`Prueba: ${d.test}`);
      if (d.notes) print(`Notas: ${d.notes}`);
      if (d.refs?.length) print(`Referencias: ${d.refs.map((r) => (r.section ? `${r.doc}#${r.section}` : r.doc)).join(', ')}`);
      if (d.files?.length) print(`Archivos: ${d.files.join(', ')}`);
      const tasks = listTasks(await store.loadAll());
      const v = linkView(tasks, t.id);
      const line = (label, ids) => { if (ids.length) print(`${label}: ${ids.map((id) => taskLabel(tasks, id)).join('; ')}`); };
      line('Bloquea a', v.blocks);
      line('Bloqueada por', v.blockedBy);
      line('Relacionadas', v.related);
      return 0;
    },

    // Entre dos tareas hay a lo sumo un vínculo: add reemplaza el que hubiera, en cualquiera de las dos.
    async link() {
      const sub = rest[0];
      if (!['add', 'rm', 'list'].includes(sub)) throw new UsageError(`subcomando desconocido: link ${sub ?? ''} (add, rm, list)`);
      const tasks = listTasks(await store.loadAll());
      const exists = (id) => { if (!tasks.some((t) => t.id === id)) throw new StoreError('not_found', `no hay una tarea "${id}"`); return id; };
      if (sub === 'list') {
        const ids = rest[1] ? [exists(rest[1])] : tasks.map((t) => t.id);
        const views = ids.map((id) => { const v = linkView(tasks, id); return { id, blocks: v.blocks, blocked_by: v.blockedBy, related: v.related }; })
          .filter((v) => rest[1] || v.blocks.length || v.blocked_by.length || v.related.length);
        const broken = brokenLinks(tasks).filter((b) => !rest[1] || b.id === rest[1]);
        if (o.json) print(JSON.stringify({ links: views, broken }));
        else {
          for (const v of views) {
            print(taskLabel(tasks, v.id));
            for (const [label, list] of [['bloquea a', v.blocks], ['bloqueada por', v.blocked_by], ['relacionada con', v.related]]) {
              for (const id of list) print(`  ${label} ${taskLabel(tasks, id)}`);
            }
          }
          if (!views.some((v) => v.blocks.length || v.blocked_by.length || v.related.length)) print('Sin vínculos.');
          for (const b of broken) warn(`vínculo roto: ${b.id} → ${b.task} (la tarea no existe; quitalo con \`scompass link rm ${b.id} ${b.task}\`)`);
        }
        return broken.length ? 1 : 0;
      }
      const a = exists(need(rest[1], 'la tarea'));
      const type = sub === 'add' ? need(rest[2], 'el tipo (blocks, blocked-by, related)') : null;
      const b = need(sub === 'add' ? rest[3] : rest[2], 'la otra tarea');
      if (sub === 'add') exists(b); // rm también sirve para quitar un vínculo roto
      if (a === b) throw new StoreError('invalid_argument', 'una tarea no se vincula consigo misma');
      if (type && !['blocks', 'blocked-by', 'related'].includes(type)) throw new UsageError(`tipo de vínculo inválido: ${type} (blocks, blocked-by, related)`);
      // Sin el vínculo actual entre las dos…
      const next = new Map([a, b].map((id) => [id, linksOf(tasks.find((t) => t.id === id))]));
      const had = next.get(a).some((l) => l.task === b) || next.get(b).some((l) => l.task === a);
      next.set(a, next.get(a).filter((l) => l.task !== b));
      next.set(b, next.get(b).filter((l) => l.task !== a));
      if (sub === 'rm' && !had) throw new StoreError('not_found', `${a} y ${b} no están vinculadas`);
      // …y con el nuevo, guardado en la tarea que bloquea (o en la primera, si es "related").
      if (sub === 'add') {
        const [from, to] = type === 'blocked-by' ? [b, a] : [a, b];
        const without = tasks.map((t) => (next.has(t.id) ? { ...t, links: next.get(t.id) } : t));
        if (type !== 'related' && wouldCycle(without, from, to)) throw new StoreError('conflict', `${to} ya bloquea (directa o indirectamente) a ${from}: sería un ciclo`);
        next.set(from, [...next.get(from), { type: type === 'related' ? 'related' : 'blocks', task: to }]);
      }
      let last;
      for (const [id, links] of next) {
        const cur = tasks.find((t) => t.id === id);
        if (!cur || JSON.stringify(links) === JSON.stringify(linksOf(cur))) continue;
        last = await store.patch('tasks', id, { links: links.length ? links : null }, { ifMatch: cur.etag });
      }
      const text = { blocks: `${a} bloquea a ${b}`, 'blocked-by': `${a} queda bloqueada por ${b}`, related: `${a} y ${b} relacionadas` };
      const r = last ? { id: last.id, etag: last.etag, ...last.doc } : { id: a };
      return written(r, sub === 'add' ? text[type] : `${a} y ${b}: vínculo quitado`);
    },

    // Servidor MCP (§30, D41): el proyecto es --dir, el de la carpeta donde lo lanzan o, si ahí no hay compass/, el
    // de CLAUDE_PROJECT_DIR, que Claude Code pasa a sus servidores.
    async mcp() {
      // mcp install (§37): registra este scompass en Claude Code, con la ruta entera, para todos los proyectos.
      if (rest[0] === 'install') {
        const [command, args] = selfCommand(['mcp']);
        const add = ['mcp', 'add', '--scope', 'user', 'scompass', '--', command, ...args];
        const quote = (a) => (/[\s"]/.test(a) ? `"${a}"` : a);
        const claude = findClaude(env);
        if (!claude) {
          warn(`no encontré Claude Code (claude); registralo a mano:\n  claude ${add.map(quote).join(' ')}`);
          return 1;
        }
        const code = await new Promise((res) => {
          const p = claudeSpawn(claude, add, { env, stdio: ['ignore', 'pipe', 'pipe'] });
          p.stdout.on('data', (d) => out.write(d));
          p.stderr.on('data', (d) => err.write(d));
          p.on('error', () => res(-1));
          p.on('close', res);
        });
        if (code !== 0) warn(`claude terminó con ${code}; si ya estaba registrado, sacalo con \`claude mcp remove --scope user scompass\` y probá de nuevo`);
        else print(`MCP scompass registrado en Claude Code: ${[command, ...args].map(quote).join(' ')} mcp`);
        return code === 0 ? 0 : 1;
      }
      const found = o.dir || existsSync(join(project, 'compass', 'config.json'));
      const root = found || !process.env.CLAUDE_PROJECT_DIR ? project : findProject(process.env.CLAUDE_PROJECT_DIR);
      await serveMcp({ project: root, stdin, out, err });
      return 0;
    },

    async restart() {
      const cfg = await readFile(join(compass, 'config.json'), 'utf8').then(JSON.parse).catch(() => null);
      const hub = await detectHub(project, cfg?.port);
      if (!hub) throw new StoreError('not_found', `no hay un hub de este proyecto en el puerto ${cfg?.port ?? 4711}`);
      // Lo sirve el Inicio (/p/<clave>, D29): ese hub no se reinicia solo (19.8).
      if (new URL(hub).pathname.startsWith('/p/')) throw new StoreError('invalid_argument', 'este proyecto lo sirve el Inicio: reinicialo con scompass home restart');
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
      for (const h of hubs) print(`PID ${String(h.pid).padEnd(8)} http://127.0.0.1:${h.port}${h.base ?? ''}/  ${h.kind === 'home' ? 'Inicio (scompass home)' : h.kind === 'served' ? `${h.project}  (lo sirve el Inicio)` : h.project}  (desde ${new Date(h.startedAt).toLocaleString('es-AR')})`);
      const dup = hubs.filter((h, i) => h.kind !== 'home' && hubs.findIndex((x) => x.project === h.project) !== i);
      for (const h of dup) warn(`aviso: más de un hub para ${h.project}`);
      return 0;
    },

    // El tablero fuera del repo del proyecto (m32-10): ver board.js.
    async board() {
      const [sub, arg] = rest;
      const KIND = { local: 'en el proyecto (compass/, en su repo)', linked: 'enlazado a un tablero con su propio git', repo: 'con su propio git dentro del proyecto (submódulo)', none: 'no hay tablero' };
      if (sub === undefined) {
        const info = await boardInfo(project);
        if (o.json) return done({ ...info, boards: boardsDir() });
        print(`Tablero: ${info.shared ? 'enlazado, en el repo de todos los tableros' : KIND[info.kind]}`);
        if (info.kind !== 'none') print(`  ${info.path}${info.target !== info.path ? ` → ${info.target}` : ''}`);
        if (info.kind === 'linked' || info.kind === 'repo') print(info.repo === false ? '  sin repo de git' : `  ${info.shared ? `repo ${info.repoDir} · ` : ''}rama ${info.branch ?? '(HEAD suelto)'} · origin ${info.remote ?? `(ninguno: git -C ${info.repoDir} remote add origin <url>)`}`);
        if (info.kind === 'local') print(`Para sacarlo del repo del proyecto: scompass board move (va a ${boardsDir()})`);
        return 0;
      }
      if (sub === 'move') {
        // Con un hub mirando compass/, la carpeta desaparece debajo de él.
        if (hubsOf(project).length) throw new StoreError('conflict', 'hay un hub de este proyecto corriendo: detenelo (o el Inicio) antes de mover el tablero');
        const r = await moveBoard(project, arg);
        const lines = [`Tablero movido a ${r.target}${r.shared ? ', en el repo de todos los tableros' : ''}${r.history ? `, con su historial${r.shared ? ' (en un commit)' : ''}` : ''}`, `compass/ es ahora un enlace${r.exclude ? `, excluido en ${r.exclude}` : ''}`];
        if (r.exportFrom) lines.push(`El export markdown pasó de ${r.exportFrom} a ${r.exportTo} (dentro del tablero)`);
        if (r.history) lines.push('En el proyecto, compass/ quedó fuera del índice: commiteá ese cambio con `git commit` y sin `-- compass` (con la ruta, git lee los archivos a través del enlace y los vuelve a agregar).');
        lines.push(`Lo sin commitear quedó sin commitear en el tablero.${r.shared ? '' : ` Para un remoto: git -C ${r.target} remote add origin <url>`}`);
        return done(r, lines.join('\n'));
      }
      if (sub === 'link') {
        const r = await linkBoard(project, need(arg, 'el nombre o la carpeta del tablero'));
        return done(r, `compass/ → ${r.target}${r.exclude ? ` (excluido en ${r.exclude})` : ''}`);
      }
      throw new UsageError(`subcomando desconocido: board ${sub} (move, link)`);
    },

    // Registro de proyectos conocidos (D23); sin subcomando, el Inicio (D24).
    async home() {
      const sub = rest[0];
      if (sub === undefined) return serveHome();
      if (sub === 'restart') return restartHome();
      if (sub === 'list') {
        const projects = projectsStatus();
        if (o.json) return done({ file: projectsFile(), projects });
        if (!projects.length) print(`No hay proyectos anotados en ${projectsFile()}.`);
        for (const p of projects) {
          const state = !p.found ? 'no encontrado' : p.hubs.length ? `hub :${p.hubs.map((h) => h.port).join(', :')}` : 'apagado';
          print(`${p.name.padEnd(20)} ${state.padEnd(14)} ${p.path}`);
        }
        return 0;
      }
      if (sub === 'add' || sub === 'rm') {
        const target = rest[1] ? resolve(cwd, rest[1]) : project;
        if (sub === 'rm') {
          const e = await forgetProject(target);
          return done({ removed: e }, `Quitado del registro: ${e.name} (${e.path})`);
        }
        const { entry, added } = await recordProject(target);
        return done({ project: entry, added }, `${added ? 'Anotado' : 'Ya estaba anotado'}: ${entry.name} (${entry.path})`);
      }
      throw new UsageError(`subcomando desconocido: home ${sub ?? ''} (restart, list, add, rm)`);
    },

    async doc() {
      const [sub, target] = rest;
      // Agregar o quitar un documento (12.2): con hub, por su API (así mira los documentos nuevos); sin hub, directo
      // en config.json. La ruta se toma desde la carpeta actual, como --file.
      if (sub === 'add' || sub === 'rm') {
        const alias = need(target, 'el alias');
        const path = sub === 'add' ? relative(project, resolve(cwd, need(rest[2], 'la ruta o el patrón (docs/**/*.md)'))).split(sep).join('/') : undefined;
        let entry;
        if (store.hub) {
          const r = await fetch(store.hub + '/api/docs' + (sub === 'rm' ? '/' + encodeURIComponent(alias) : ''),
            sub === 'add' ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ alias, path }) } : { method: 'DELETE' });
          if (!r.ok) { const e = (await r.json().catch(() => null))?.error ?? {}; throw new StoreError(e.code ?? 'io_error', e.message ?? `HTTP ${r.status}`); }
          entry = sub === 'add' ? await r.json() : { alias };
        } else {
          entry = await changeDocs(project, validators, sub === 'add' ? { add: { alias, path } } : { remove: alias });
        }
        return done({ [sub === 'add' ? 'added' : 'removed']: entry }, sub === 'add' ? `Agregado ${entry.alias}: ${entry.path}` : `Quitado ${alias} de compass/config.json (el archivo no se toca)`);
      }
      const all = await store.loadAll();
      const docs = await loadDocs(project, all.config);
      if (sub === 'list') {
        if (o.json) {
          return done({ docs: docs.map((d) => ({ alias: d.alias, path: d.path, warnings: d.warnings,
            sections: d.sections.map(({ id, title, level, explicit }) => ({ id, title, level, explicit })) })) });
        }
        if (!docs.length) print('Sin documentos: agregalos con scompass doc add <alias> <ruta>.');
        for (const d of docs) {
          const fragile = d.sections.filter((s) => !s.explicit).length;
          print(`${d.alias.padEnd(12)} ${d.path}  ${d.sections.length} secciones${fragile ? ` · ${fragile} sin id (frágiles)` : ''}`);
          for (const w of d.warnings) warn(`aviso [${w.code}] ${d.path}: ${w.message}`);
        }
        return 0;
      }
      if (sub === 'show') {
        const r = resolveRef(docs, need(target, '<alias>[#<id>]'));
        if (!r.doc) throw new StoreError('not_found', `no hay un documento "${r.key}" (doc list muestra los que hay)`);
        if (r.whole) {
          const md = r.doc.lines.join('\n').replace(/\s+$/, '') + '\n';
          if (o.raw) { out.write(md); return 0; }
          if (o.json) return done({ alias: r.doc.alias, path: r.doc.path, lines: [1, r.doc.lines.length], markdown: md });
          print(`${r.doc.alias} · ${r.doc.path}, ${r.doc.lines.length} líneas`);
          print('');
          out.write(md);
          return 0;
        }
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
      // Estado de git de los documentos (12.3): solo lectura, la app nunca commitea (spec §4.5).
      const GIT_LABEL = { clean: 'sin cambios', modified: 'modificado', added: 'nuevo (agregado)', untracked: 'nuevo sin seguir', deleted: 'borrado', renamed: 'renombrado' };
      if (sub === 'status') {
        const g = await docsStatus(project);
        const rows = await Promise.all(docs.map(async (d) => ({ alias: d.alias, path: d.path, ...(g.repo && { git: g.status[d.path] ?? 'clean', last_commit: (await docLog(project, d.path, { limit: 1 }))[0] ?? null }) })));
        if (o.json) return done({ repo: g.repo, docs: rows });
        if (!g.repo) print('El proyecto no está en un repo de git.');
        for (const r of rows) {
          const c = r.last_commit;
          print(`${r.alias.padEnd(12)} ${r.path}  ${g.repo ? GIT_LABEL[r.git] : ''}${c ? ` · ${c.hash} ${c.date.slice(0, 10)} ${c.author}: ${c.subject}` : g.repo ? ' · sin commits' : ''}`);
        }
        return 0;
      }
      if (sub === 'diff') {
        const d = docs.find((x) => x.alias === need(target, 'el alias del documento') || x.path === target);
        if (!d) throw new StoreError('not_found', `no hay un documento "${target}"`);
        const g = await docsStatus(project);
        const git = g.repo ? g.status[d.path] ?? 'clean' : null;
        const diff = git && git !== 'clean' ? await docDiff(project, d.path, { untracked: git === 'untracked', text: d.lines.join('\n') }) : '';
        const sections = diffSections(d, diff);
        if (o.json) return done({ alias: d.alias, path: d.path, repo: g.repo, ...(g.repo && { git }), diff, sections });
        if (!g.repo) throw new StoreError('not_found', 'el proyecto no está en un repo de git');
        if (!diff) { print(`${d.path}: sin cambios contra HEAD.`); return 0; }
        out.write(diff);
        print(`Secciones tocadas: ${sections.length ? sections.join(', ') : 'ninguna'}`);
        return 0;
      }
      // Texto en todos los documentos (12.4): cada línea con la sección donde está, para seguir con doc show.
      if (sub === 'search') {
        const r = searchDocs(docs.filter((d) => !d.missing), need(rest.slice(1).join(' ').trim() || undefined, 'el texto a buscar'));
        if (o.json) return done(r);
        for (const x of r.results) print(`${x.alias}${x.section ? '#' + x.section : ''}  ${x.path}:${x.line}  ${x.snippet}`);
        print(r.results.length ? `${r.results.length}${r.more ? '+' : ''} coincidencias.` : 'Ninguna coincidencia.');
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
      const tasks = [...all.tasks].map(([id, doc]) => ({ id, ...doc }));
      const problems = checkRefs(docs, tasks);
      // Archivos citados (15.1) que git ya no lista: se borraron o se movieron.
      const [listing, g] = await Promise.all([repoFiles(project), docsStatus(project)]);
      const known = new Set([...(listing ?? []), ...Object.keys(g.status)]);
      // Sin repo (19.6), lo que cuenta es que esté en el disco.
      const there = (f) => (listing ? known.has(f) : existsSync(join(project, f)));
      for (const t of tasks) for (const where of ['files', 'images']) for (const f of t[where] ?? []) if (!there(f)) problems.push({ task: t.id, ref: f, where, problem: 'missing_file' });
      const broken = problems.filter((p) => p.problem !== 'fragile');
      if (o.json) print(JSON.stringify({ broken, fragile: problems.filter((p) => p.problem === 'fragile') }));
      else {
        const why = { missing_doc: 'no existe el documento', missing_section: 'no existe la sección', missing_file: 'el archivo ya no está en el repo', fragile: 'sin id explícito (frágil)' };
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
      const r = resolveRef(docs, need(target, '<alias>[#<id>]'));
      const cur = await store.get('tasks', taskId);
      const refs = cur.doc.refs ?? [];
      // Sin #<id>, la referencia es al documento entero: se guarda sin section.
      const same = (x, path) => (x.doc === path || x.doc === r.key) && (x.section || null) === r.id;
      let next;
      if (sub === 'add') {
        if (!r.doc) throw new StoreError('not_found', `no hay un documento "${r.key}"`);
        if (!r.whole && !r.section) throw new StoreError('not_found', `no hay una sección "${r.id}" en ${r.doc.path}`);
        if (refs.some((x) => same(x, r.doc.path))) return done({ id: cur.id, etag: cur.etag, ...cur.doc }, `${taskId} ya referencia ${target}`);
        next = [...refs, r.whole ? { doc: r.doc.path } : { doc: r.doc.path, section: r.id }];
      } else {
        const path = r.doc?.path ?? r.key;
        next = refs.filter((x) => !same(x, path));
        if (next.length === refs.length) throw new StoreError('not_found', `${taskId} no referencia ${target}`);
      }
      const w = await store.patch('tasks', taskId, { refs: next }, { ifMatch: o.etag ?? cur.etag });
      return written({ id: w.id, etag: w.etag, ...w.doc }, `${taskId}: ${sub === 'add' ? 'agregada' : 'quitada'} ${target}`);
    },

    async file() {
      const [sub, taskId, target] = rest;
      if (sub !== 'add' && sub !== 'rm') throw new UsageError(`subcomando desconocido: file ${sub ?? ''} (add, rm)`);
      need(taskId, 'la tarea');
      // Desde la raíz del proyecto, como la pestaña Archivos. res:// es la misma carpeta: el dock vive en el proyecto de Godot.
      // \ → / (19.8): en Windows la terminal completa las rutas con \; en el repo van con /.
      const path = need(target, '<ruta>').replace(/\\/g, '/').replace(/^res:\/\//, '').replace(/^\.\//, '');
      const cur = await store.get('tasks', taskId);
      const files = cur.doc.files ?? [];
      let next;
      if (sub === 'add') {
        await repoFile(project, path);
        if (files.includes(path)) return done({ id: cur.id, etag: cur.etag, ...cur.doc }, `${taskId} ya cita ${path}`);
        next = [...files, path];
      } else {
        next = files.filter((x) => x !== path);
        if (next.length === files.length) throw new StoreError('not_found', `${taskId} no cita ${path}`);
      }
      const w = await store.patch('tasks', taskId, { files: next.length ? next : null }, { ifMatch: o.etag ?? cur.etag });
      return written({ id: w.id, etag: w.etag, ...w.doc }, `${taskId}: ${sub === 'add' ? 'agregado' : 'quitado'} ${path}`);
    },

    // Historial de la tarea desde git (18.5).
    async history() {
      const id = need(rest[0], 'el id');
      await store.get('tasks', id);
      const h = await taskHistory(project, id);
      if (o.json) return done(h);
      if (!h.repo) { print('Sin historial: el proyecto no está en un repo de git.'); return 0; }
      for (const e of h.entries) {
        print(`${e.hash ?? 'sin commitear'}  ${e.date ? localStamp(e.date) : ''}${e.author ? '  ' + e.author : ''}${e.hash ? '  ' + e.subject.slice(0, 72) + (e.subject.length > 72 ? '…' : '') : ''}`);
        for (const c of e.created ? ['Creada'] : e.deleted ? ['Borrada'] : e.changes) print(`    ${c}`);
      }
      if (!h.entries.length) print('La tarea todavía no tiene commits.');
      return 0;
    },

    // Capturas (18.4): una imagen del repo se cita tal cual; una de fuera del proyecto se copia a compass/images/.
    async image() {
      const [sub, taskId, target] = rest;
      if (sub !== 'add' && sub !== 'rm') throw new UsageError(`subcomando desconocido: image ${sub ?? ''} (add, rm)`);
      need(taskId, 'la tarea');
      const raw = need(target, '<ruta>');
      const cur = await store.get('tasks', taskId);
      const images = cur.doc.images ?? [];
      if (sub === 'rm') {
        const path = raw.replace(/\\/g, '/').replace(/^res:\/\//, '').replace(/^\.\//, '');
        if (!images.includes(path)) throw new StoreError('not_found', `${taskId} no tiene la captura ${path}`);
        const next = images.filter((x) => x !== path);
        const w = await store.patch('tasks', taskId, { images: next.length ? next : null }, { ifMatch: o.etag ?? cur.etag });
        const gone = await dropImage(project, path, listTasks(await store.loadAll()));
        return written({ id: w.id, etag: w.etag, ...w.doc }, `${taskId}: quitada ${path}${gone ? ' (y borrado el archivo, que había guardado la app)' : ''}`);
      }
      const abs = resolve(cwd, raw);
      const here = existsSync(abs) ? insideProject(project, abs) : null;
      let path;
      if (existsSync(abs) && here === null) path = await importImage(project, taskId, abs);
      else {
        path = here ?? raw.replace(/\\/g, '/').replace(/^res:\/\//, '').replace(/^\.\//, '');
        if (!isImagePath(path)) throw new StoreError('invalid_argument', `${path} no es una imagen (${IMAGE_EXT.join(', ')})`);
        await imageFile(project, path);
        if (images.includes(path)) return done({ id: cur.id, etag: cur.etag, ...cur.doc }, `${taskId} ya tiene ${path}`);
      }
      try {
        const w = await store.patch('tasks', taskId, { images: [...images, path] }, { ifMatch: o.etag ?? cur.etag });
        return written({ id: w.id, etag: w.etag, ...w.doc }, `${taskId}: agregada ${path}`);
      } catch (e) {
        if (here === null && existsSync(abs)) await dropImage(project, path, []);
        throw e;
      }
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
      // Con una etiqueta que tiene plantilla y sin --description, la descripción arranca con la plantilla (18.6).
      const template = o.tags && !o.description?.trim() ? descriptionTemplate([], tagList(o.tags), '', (await store.loadAll()).config) : null;
      const r = await store.create('tasks', {
        milestone, title, code: o.code ?? '', status: o.status ?? 'todo', checklist: [], test: '', notes: '', refs: [],
        ...(o.due ? { due: due(o.due) } : {}),
        ...(o.tags && tagList(o.tags) ? { tags: tagList(o.tags) } : {}),
        ...(o.priority ? { priority: priority(o.priority) } : {}),
        ...(o.size ? { size: size(o.size) } : {}),
        ...(o.assignee ? { assignee: o.assignee.trim() } : {}),
        ...(o.description?.trim() ? { description: o.description } : template ? { description: template } : {})
      });
      return written({ id: r.id, etag: r.etag, ...r.doc }, `Creada ${r.id}: ${title}`);
    },

    async move() {
      const [id, status] = [need(rest[0], 'el id'), need(rest[1], 'el estado')];
      if (!STATUS[status]) throw new UsageError(`estado inválido: ${status} (todo, paused, doing, review, done)`);
      const r = await store.patch('tasks', id, { status }, ifMatch);
      return written({ id: r.id, etag: r.etag, ...r.doc }, `${id} → ${STATUS[status]}`);
    },

    async rm() {
      const id = need(rest[0], 'el id');
      const cur = await store.get('tasks', id);
      // Las tareas con un vínculo hacia esta: no se tocan (como en la web), pero quedan rotos y se avisa.
      const linked = listTasks(await store.loadAll()).filter((t) => t.id !== id && linksOf(t).some((l) => l.task === id)).map((t) => t.id);
      await store.delete('tasks', id, { ifMatch: o.etag ?? cur.etag });
      // Sus capturas guardadas por la app que nadie más cita, como DELETE /api/tasks/:id (con hub ya las borró él).
      const all = listTasks(await store.loadAll());
      for (const path of cur.doc.images ?? []) await dropImage(project, path, all);
      if (linked.length) warn(`aviso: quedan vínculos rotos hacia ${id} en ${linked.join(', ')} (scompass link rm <tarea> ${id} los quita)`);
      return written({ id }, `Borrada ${id}: ${cur.doc.title}`);
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

    // Decisiones (§31, D42): como los pasos, se lee la tarea y se escribe la lista entera con If-Match.
    async decide() {
      const id = need(rest[0], 'el id');
      const text = need(rest[1], 'el texto de la decisión').trim();
      if (!text) throw new UsageError('el texto de la decisión está vacío');
      const cur = await store.get('tasks', id);
      const list = cur.doc.decisions ?? [];
      // Una pregunta guarda la sesión de Claude Code que la hace (Claude Code la pone en el entorno de Bash y del MCP),
      // para retomarla desde el chat con la respuesta (§32). --session "" no la guarda.
      const session = o.session ?? (o.ask ? env.CLAUDE_CODE_SESSION_ID : undefined);
      if (o.session && !SESSION_ID.test(o.session)) throw new UsageError(`--session tiene que ser el id de una sesión de Claude Code (un uuid): ${o.session}`);
      const d = { text, ...(o.why?.trim() && { why: o.why }), ...(o.alternatives?.trim() && { alternatives: o.alternatives }), ...(o.ask && { asked: true }),
        ...(session && SESSION_ID.test(session) && { session }) };
      const r = await store.patch('tasks', id, { decisions: [...list, d] }, { ifMatch: o.etag ?? cur.etag });
      return written({ id: r.id, etag: r.etag, ...r.doc }, `${id}: decisión ${list.length + 1} registrada (${decisionLabel(d)})`);
    },

    async decision() {
      const [sub, id, arg] = rest;
      const SUBS = ['ok', 'revert', 'reverted', 'reply', 'rm', 'promote'];
      if (!SUBS.includes(sub)) throw new UsageError(`subcomando desconocido: decision ${sub ?? ''} (${SUBS.join(', ')})`);
      need(id, 'el id de la tarea');
      if (sub === 'promote') {
        const n = Number(need(arg, 'el número de decisión'));
        let task, promoted, path;
        if (store.hub) {
          const r = await fetch(`${store.hub}/api/tasks/${encodeURIComponent(id)}/decisions/${encodeURIComponent(arg)}/promote`, { method: 'POST' });
          if (!r.ok) { const e = (await r.json().catch(() => null))?.error ?? {}; throw new StoreError(e.code ?? 'io_error', e.message ?? `HTTP ${r.status}`); }
          task = await r.json();
          promoted = r.headers.get('x-promoted');
          path = decodeURIComponent(r.headers.get('x-promoted-path'));
        } else {
          const r = await promoteDecision(project, store, id, n, { ...(now && { now }) });
          task = { id: r.task.id, etag: r.task.etag, ...r.task.doc };
          ({ promoted, doc: { path } } = r);
        }
        return written(task, `${id}: decisión ${n} promovida a ${promoted} (${path})`);
      }
      const cur = await store.get('tasks', id);
      const list = cur.doc.decisions ?? [];
      const n = Number(need(arg, 'el número de decisión'));
      if (!Number.isInteger(n) || n < 1 || n > list.length) throw new StoreError('invalid_argument', `decisión inexistente: ${arg} (la tarea tiene ${list.length})`);
      const d = list[n - 1];
      let next;
      if (sub === 'rm') next = list.filter((_, i) => i !== n - 1);
      else if (sub === 'reply') {
        if (!d.asked) throw new StoreError('invalid_argument', `la decisión ${n} no es una pregunta: se revisa con decision ok o revert`);
        const reply = need(rest[3], 'la respuesta').trim();
        if (!reply) throw new UsageError('la respuesta está vacía');
        next = list.map((x, i) => (i === n - 1 ? { ...x, reply } : x));
      } else {
        if (d.asked) throw new StoreError('invalid_argument', `la decisión ${n} es una pregunta: se responde con decision reply`);
        if (sub === 'reverted' && d.review !== 'revert' && d.review !== 'reverted') throw new StoreError('invalid_argument', `la decisión ${n} no está para revertir`);
        const { reply, ...rest } = d;
        const r = o.reply !== undefined ? o.reply.trim() : reply;
        next = list.map((x, i) => (i === n - 1 ? { ...rest, review: sub, ...(r && { reply: r }) } : x));
      }
      const r = await store.patch('tasks', id, { decisions: next.length ? next : null }, { ifMatch: o.etag ?? cur.etag });
      return written({ id: r.id, etag: r.etag, ...r.doc }, sub === 'rm' ? `${id}: decisión ${n} quitada` : `${id}: decisión ${n} ${decisionLabel(next[n - 1])}`);
    },

    // Las de todo el proyecto, la más nueva arriba. Sin --open, --pending ni --revert, todas.
    async decisions() {
      const states = DECISION_STATES.filter((s) => o[s]);
      const all = await store.loadAll();
      showWarnings(all.warnings);
      const tasks = listTasks(all, { milestone: o.milestone });
      const out = tasks.flatMap((t) => (t.decisions ?? []).map((d, i) => ({ task: t.id, n: i + 1, state: decisionState(d), ...d })))
        .filter((d) => !states.length || states.includes(d.state))
        .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
      if (o.json) return done({ decisions: out });
      for (const d of out) printDecision(d, d.n, '', taskLabel(tasks, d.task));
      if (!out.length) print('Sin decisiones.');
      return 0;
    },

    async set() {
      const id = need(rest[0], 'el id');
      const fields = Object.fromEntries(FIELDS.filter((f) => o[f] !== undefined).map((f) => [f, o[f]]));
      if (o.file !== undefined && Object.keys(fields).length) throw new UsageError('--file reemplaza la tarea entera: no se combina con campos sueltos');
      if (o.file === undefined && !Object.keys(fields).length) throw new UsageError(`falta --file o algún campo (${FIELDS.map((f) => '--' + f).join(', ')})`);
      if (fields.status && !STATUS[fields.status]) throw new UsageError(`estado inválido: ${fields.status} (todo, paused, doing, review, done)`);
      if (fields.due !== undefined) fields.due = due(fields.due) || null; // "" → null: patch quita el campo
      if (fields.tags !== undefined) fields.tags = tagList(fields.tags);
      if (fields.priority !== undefined) fields.priority = priority(fields.priority);
      if (fields.size !== undefined) fields.size = size(fields.size);
      if (fields.assignee !== undefined) fields.assignee = fields.assignee.trim() || null;
      if (fields.description !== undefined) fields.description = fields.description.trim() ? fields.description : null;
      if (fields.tags && fields.description === undefined) {
        const cur = await store.get('tasks', id);
        const template = descriptionTemplate(cur.doc.tags, fields.tags, cur.doc.description, (await store.loadAll()).config);
        if (template) fields.description = template;
      }
      let r;
      if (o.file !== undefined) {
        const f = await readDocFile(o.file, id);
        r = await store.put('tasks', id, f.doc, f.opts);
      } else r = await store.patch('tasks', id, fields, ifMatch);
      return written({ id: r.id, etag: r.etag, ...r.doc }, `Guardada ${id}`);
    },

    // Listas (spec §16.4, D25).
    async lists() {
      const sub = rest[0] ?? 'list';
      if (sub === 'list') {
        const { items, warnings } = await store.list('lists');
        showWarnings(warnings);
        const lists = listLists(items.map((l) => [l.id, l.doc]));
        if (o.json) return done({ lists, warnings });
        if (!lists.length) print('Sin listas: scompass lists add "<título>" crea una.');
        for (const l of lists) {
          const left = l.items.filter((x) => !x.done).length;
          const state = !l.items.length ? 'vacía' : left ? `${left} de ${l.items.length} pendiente${left === 1 ? '' : 's'}` : 'todo tildado';
          print(`  ${l.id.padEnd(20)} ${l.title}  ${state}`);
        }
        return 0;
      }
      if (sub === 'show') {
        const l = await store.get('lists', need(rest[1], 'la lista'));
        if (o.json) return done({ id: l.id, etag: l.etag, ...l.doc });
        print(`${l.doc.title}  [${l.id}]`);
        if (!l.doc.items.length) print('  (vacía)');
        l.doc.items.forEach((x, i) => print(`  ${String(i + 1).padStart(2)}. [${x.done ? 'x' : ' '}] ${x.text}${x.due ? `  · ${dueNote(x.due, x.done)}` : ''}${x.repeat ? `  ↻ ${repeatLabel(x.repeat)}` : ''}${x.task ? `  → ${x.task}` : ''}`));
        return 0;
      }
      if (sub === 'add') {
        const title = need(rest[1], 'el título');
        const { items } = await store.list('lists');
        const id = freeId(slugify(title), items.map((l) => l.id));
        // order se calcula acá: con hub, crear con id es un PUT y el hub no lo completa.
        const order = Math.max(0, ...items.map((l) => l.doc.order ?? 0)) + 1;
        const r = await store.create('lists', { title, order, items: [] }, id);
        return written({ id: r.id, etag: r.etag, ...r.doc }, `Creada la lista ${r.id}: ${title}`);
      }
      if (sub === 'set') {
        const id = need(rest[1], 'la lista');
        const r = await store.patch('lists', id, { title: need(o.title, '--title') }, ifMatch);
        return written({ id: r.id, etag: r.etag, ...r.doc }, `Guardada la lista ${id}`);
      }
      if (sub === 'rm') {
        const id = need(rest[1], 'la lista');
        await store.delete('lists', id, ifMatch);
        return written({ id }, `Borrada la lista ${id}`);
      }
      throw new UsageError(`subcomando desconocido: lists ${sub} (show, add, set, rm)`);
    },

    async item() {
      const [sub, id, arg] = rest;
      if (!['add', 'check', 'set', 'rm', 'clear', 'task'].includes(sub)) throw new UsageError(`subcomando desconocido: item ${sub ?? ''} (add, check, set, rm, clear, task)`);
      const cur = await store.get('lists', need(id, 'la lista'));
      const items = cur.doc.items;
      const nth = () => {
        const n = Number(need(arg, 'el número de ítem'));
        if (!Number.isInteger(n) || n < 1 || n > items.length) throw new StoreError('invalid_argument', `ítem inexistente: ${arg} (la lista tiene ${items.length})`);
        return n;
      };
      const needsDue = (x) => { if (x.repeat && !x.due) throw new StoreError('invalid_argument', 'un ítem que se repite necesita fecha límite (--due)'); return x; };
      const save = async (next, msg) => {
        const r = await store.patch('lists', id, { items: next }, { ifMatch: o.etag ?? cur.etag });
        return written({ id: r.id, etag: r.etag, ...r.doc }, msg);
      };
      if (sub === 'add') {
        const item = newItem({ text: need(arg, 'el texto'), due: o.due ? due(o.due) : undefined, repeat: repeatOf(o.repeat, o.interval) },
          (now ?? (() => new Date().toISOString()))());
        return save([...items, item], `${id}: ítem ${items.length + 1} agregado`);
      }
      if (sub === 'clear') {
        const left = items.filter((x) => !x.done);
        const k = items.length - left.length;
        return save(left, `${id}: ${k} ${k === 1 ? 'tildado quitado' : 'tildados quitados'}`);
      }
      const n = nth();
      const it = items[n - 1];
      if (sub === 'check') {
        let r;
        try { r = checkItem(it, { undo: o.undo }); } catch (e) { throw new StoreError(e.code ?? 'invalid_argument', e.message); }
        const msg = r.advanced ? `${id} ítem ${n} hecho: ${it.text} · ↻ próxima vez: ${showDue(r.item.due)}` : `${id} ítem ${n} ${o.undo ? 'desmarcado' : 'hecho'}: ${it.text}`;
        return save(items.with(n - 1, r.item), msg);
      }
      if (sub === 'rm') return save(items.toSpliced(n - 1, 1), `${id}: ítem ${n} quitado`);
      if (sub === 'set') {
        if (o.text === undefined && o.due === undefined && o.repeat === undefined && o.interval === undefined) throw new UsageError('falta --text, --due, --repeat o --interval');
        const { due: d, repeat: rp, ...others } = it;
        const nd = o.due !== undefined ? due(o.due) : d;
        // --interval solo cambia el intervalo; --repeat solo, la unidad (cada 2 días → cada 2 semanas).
        const nr = o.repeat === '' ? null : o.repeat === undefined && o.interval === undefined ? rp : repeatOf(o.repeat ?? rp?.every, o.interval ?? rp?.interval);
        const next = needsDue({ ...others, ...(o.text !== undefined ? { text: o.text } : {}), ...(nd ? { due: nd } : {}), ...(nr ? { repeat: nr } : {}) });
        return save(items.with(n - 1, next), `${id}: ítem ${n} actualizado`);
      }
      // task: una tarea nueva con el texto del ítem, y el ítem queda apuntando a ella.
      if (it.task) throw new StoreError('conflict', `el ítem ${n} ya pasó a la tarea ${it.task}`);
      const milestone = need(o.milestone, '--milestone');
      await store.get('milestones', milestone);
      const t = await store.create('tasks', { milestone, title: it.text, code: o.code ?? '', status: 'todo', checklist: [], test: '', notes: '', refs: [] });
      const r = await store.patch('lists', id, { items: items.with(n - 1, { ...it, task: t.id }) }, { ifMatch: o.etag ?? cur.etag });
      return written({ id: r.id, etag: r.etag, ...r.doc, task: { id: t.id, etag: t.etag, ...t.doc } }, `${id}: ítem ${n} → tarea ${t.id}`);
    },

    // Sesiones de playtest (D39): tareas ya creadas en el orden en que se prueban, con resultado y nota.
    async playtest() {
      const sub = rest[0] ?? 'list';
      // Cómo salió cada prueba vive en la tarea (D40): la misma en todas las sesiones que la tienen.
      const RESULT = { pass: '✓', fail: '✗' };
      const show = (p, tasks) => {
        print(`${p.doc.title}  [${p.id}]`);
        if (!p.doc.items.length) print('  (vacía)');
        p.doc.items.forEach((x, i) => {
          const t = tasks.find((y) => y.id === x.task);
          print(`  ${String(i + 1).padStart(2)}. [${RESULT[t?.playtest?.result] ?? ' '}] ${taskLabel(tasks, x.task)}${t ? ` · ${STATUS[t.status]}` : ''}`);
          if (t?.playtest?.note) print(`        ${t.playtest.note.replace(/\n/g, '\n        ')}`);
        });
      };
      // Las tareas en Revisión (de un hito, con --milestone), en el orden de `scompass list`.
      const inReview = async () => listTasks(await store.loadAll(), { milestone: o.milestone, status: 'review' }).map((t) => t.id);
      if (sub === 'migrate') {
        const r = await migrateSessions(compass, store, validators);
        const lines = [r.sessions.length ? `Sesiones pasadas al formato nuevo: ${r.sessions.join(', ')}` : 'No hay sesiones del formato anterior.'];
        for (const t of r.tasks) lines.push(`  ${t.id}: ${t.playtest.result === 'pass' ? 'anda' : t.playtest.result === 'fail' ? 'falla' : 'sin probar'}${t.playtest.note ? ' · ' + t.playtest.note.split('\n')[0] : ''}`);
        if (r.missing.length) lines.push(`Tareas que ya no existen (su resultado se descartó): ${r.missing.join(', ')}`);
        return written(r, lines.join('\n'));
      }
      if (sub === 'list') {
        const { items, warnings } = await store.list('playtests');
        showWarnings(warnings);
        if (warnings.some((w) => w.path.startsWith('compass/playtests/') && /\((result|note)\)/.test(w.message))) warn('aviso: hay sesiones del formato anterior (result y note en la sesión): scompass playtest migrate las pasa a las tareas');
        const playtests = listPlaytests(items.map((p) => [p.id, p.doc]));
        if (o.json) return done({ playtests, warnings });
        if (!playtests.length) print('Sin sesiones de playtest: scompass playtest new "<título>" crea una.');
        const tasks = (await store.loadAll()).tasks;
        for (const p of playtests) {
          const { left, fail } = sessionState(p, tasks);
          const state = !p.items.length ? 'vacía' : left ? `${left} de ${p.items.length} sin probar` : 'todo probado';
          print(`  ${p.id.padEnd(20)} ${p.title}  ${state}${fail ? ` · ${fail} ${fail === 1 ? 'falla' : 'fallan'}` : ''}`);
        }
        return 0;
      }
      if (sub === 'new') {
        const title = need(rest[1], 'el título');
        if (o.milestone && !o.review) throw new UsageError('--milestone va con --review');
        const { items } = await store.list('playtests');
        const id = freeId(slugify(title, 'playtest'), items.map((p) => p.id));
        const order = Math.max(0, ...items.map((p) => p.doc.order ?? 0)) + 1;
        const tasks = o.review ? await inReview() : [];
        const r = await store.create('playtests', { title, order, items: tasks.map((task) => ({ task })) }, id);
        return written({ id: r.id, etag: r.etag, ...r.doc }, `Creada la sesión ${r.id}: ${title}${tasks.length ? ` (${tasks.length} ${tasks.length === 1 ? 'tarea' : 'tareas'})` : ''}`);
      }
      const id = need(rest[1], 'la sesión');
      if (sub === 'set') {
        const r = await store.patch('playtests', id, { title: need(o.title, '--title') }, ifMatch);
        return written({ id: r.id, etag: r.etag, ...r.doc }, `Guardada la sesión ${id}`);
      }
      if (sub === 'rm') {
        await store.delete('playtests', id, ifMatch);
        return written({ id }, `Borrada la sesión ${id}`);
      }
      if (!['show', 'add', 'move', 'drop', 'pass', 'fail', 'reset'].includes(sub)) {
        throw new UsageError(`subcomando desconocido: playtest ${sub} (show, new, set, rm, add, move, drop, pass, fail, reset, migrate)`);
      }
      const cur = await store.get('playtests', id);
      if (sub === 'show') {
        if (o.json) return done({ id: cur.id, etag: cur.etag, ...cur.doc });
        show(cur, listTasks(await store.loadAll()));
        return 0;
      }
      const items = cur.doc.items;
      const save = async (next, msg) => {
        const r = await store.patch('playtests', id, { items: next }, { ifMatch: o.etag ?? cur.etag });
        return written({ id: r.id, etag: r.etag, ...r.doc }, msg);
      };
      // Posición en la sesión (desde 1), o el id de una tarea que está en ella.
      const pos = (arg, n = items.length) => {
        const k = Number(arg);
        if (Number.isInteger(k) && String(k) === String(arg).trim() && k >= 1 && k <= n) return k;
        const i = items.findIndex((x) => x.task === arg);
        if (i < 0) throw new StoreError('invalid_argument', `${arg ?? ''} no está en la sesión (tiene ${items.length} ${items.length === 1 ? 'tarea' : 'tareas'})`);
        return i + 1;
      };
      if (sub === 'add') {
        const asked = rest.slice(2);
        if (!asked.length && !o.review) throw new UsageError('falta alguna tarea (o --review)');
        if (o.milestone && !o.review) throw new UsageError('--milestone va con --review');
        for (const t of asked) await store.get('tasks', t);
        const have = new Set(items.map((x) => x.task));
        const fresh = [...new Set([...asked, ...(o.review ? await inReview() : [])])].filter((t) => !have.has(t));
        const at = o.at === undefined ? items.length + 1 : Number(o.at);
        if (!Number.isInteger(at) || at < 1 || at > items.length + 1) throw new StoreError('invalid_argument', `posición inválida: ${o.at} (de 1 a ${items.length + 1})`);
        const msg = fresh.length ? `${id}: ${fresh.length === 1 ? `${fresh[0]} agregada` : `${fresh.length} tareas agregadas`} desde la posición ${at}` : `${id}: nada nuevo para agregar`;
        return save(items.toSpliced(at - 1, 0, ...fresh.map((task) => ({ task }))), msg);
      }
      const n = pos(rest[2]);
      const it = items[n - 1];
      if (sub === 'move') {
        const to = Number(need(rest[3], 'la posición'));
        if (!Number.isInteger(to) || to < 1 || to > items.length) throw new StoreError('invalid_argument', `posición inválida: ${rest[3]} (de 1 a ${items.length})`);
        return save(items.toSpliced(n - 1, 1).toSpliced(to - 1, 0, it), `${id}: ${it.task} en la posición ${to}`);
      }
      if (sub === 'drop') return save(items.toSpliced(n - 1, 1), `${id}: ${it.task} fuera de la sesión`);
      // pass, fail y reset escriben en la tarea, no en la sesión: se ve igual en todas las que la tienen.
      const t = await store.get('tasks', it.task);
      const playtest = nextPlaytest(t.doc.playtest, { result: sub === 'reset' ? null : sub, note: o.note });
      const r = await store.patch('tasks', it.task, { playtest }, ifMatch);
      return written({ id: r.id, etag: r.etag, ...r.doc }, `${it.task} ${sub === 'reset' ? 'sin probar' : sub === 'pass' ? 'anda ✓' : 'falla ✗'}`);
    },

    async milestone() {
      const [sub, id] = rest;
      if (sub === 'list') {
        const { items, warnings } = await store.list('milestones');
        showWarnings(warnings);
        const milestones = listMilestones(items.map((m) => [m.id, m.doc]));
        if (o.json) return done({ milestones, warnings });
        const tasks = listTasks(await store.loadAll());
        for (const m of milestones) print(`  ${m.id.padEnd(5)} ${m.code.padEnd(4)} ${m.title}${m.due ? '  · ' + msDueNote(m, tasks) : ''}`);
        return 0;
      }
      if (sub === 'show') {
        const m = await store.get('milestones', need(id, 'el id'));
        if (o.json) return done({ id: m.id, etag: m.etag, ...m.doc });
        print(`${m.doc.code} · ${m.doc.title}  [${m.id}]`);
        if (m.doc.due) print(msDueNote({ id: m.id, ...m.doc }, listTasks(await store.loadAll())).replace(/^f/, 'F'));
        if (m.doc.goal) print(m.doc.goal);
        for (const w of m.doc.done_when ?? []) print(`  - ${w}`);
        return 0;
      }
      if (sub === 'set') {
        // --due cambia solo la fecha objetivo ("" la quita); --file reemplaza el hito entero.
        if (o.due !== undefined && o.file === undefined) {
          // Por el hub los hitos solo se reemplazan enteros (D12): se lee y se reescribe con su etag.
          const cur = await store.get('milestones', need(id, 'el id'));
          const { due: _old, ...rest } = cur.doc;
          const d = due(o.due);
          const r = await store.put('milestones', id, d ? { ...rest, due: d } : rest, { ifMatch: o.etag ?? cur.etag });
          return written({ id: r.id, etag: r.etag, ...r.doc }, r.doc.due ? `${r.id}: fecha objetivo ${showDue(r.doc.due)}` : `${r.id}: sin fecha objetivo`);
        }
        if (o.due !== undefined) throw new UsageError('--file reemplaza el hito entero: no se combina con --due');
        const f = await readDocFile(need(o.file, '--file'), need(id, 'el id'));
        const r = await store.put('milestones', id, f.doc, f.opts);
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
    if (!(e instanceof StoreError) && !(e instanceof ProjectsError)) throw e;
    if (o.json) err.write(JSON.stringify({ error: { code: e.code, message: e.message, ...(e.current && { current: e.current }) } }) + '\n');
    else warn(`error [${e.code}]: ${e.message}`);
    return 1;
  }
}

// Menú de la bandeja del Inicio (§16.3): un submenú por proyecto del registro, con lo mismo que la bandeja de un
// hub (Abrir, Actualizar compass/ si hace falta, Reiniciar, Detener) o Prender si está apagado.
function homeTrayItems({ app, url, openUrl, warn, close, restart, lan, toggleLan, refresh }) {
  const act = (fn) => async () => { try { await fn(); } catch (e) { warn(`bandeja: ${e.message}`); } refresh(); };
  const projects = (() => { try { return projectsStatus(); } catch (e) { warn(`bandeja: ${e.message}`); return []; } })();
  // D29: el Inicio sirve los proyectos, así que no hay nada que prender; un hub suelto (el del dock) se puede detener.
  const project = (p) => {
    if (!p.found) return { label: `${p.name} · no encontrado`, enabled: false };
    const key = app.serving.keyOf(p.path);
    const standalone = p.hubs.map((x) => listHubs().find((y) => y.pid === x.pid)).find((h) => h && !h.base && h.pid !== process.pid);
    const compass = join(p.path, 'compass');
    const stale = outdatedFiles(compass).length;
    return {
      label: standalone ? `${p.name} · hub suelto :${standalone.port}` : p.name,
      children: [
        { label: 'Abrir tablero', onClick: () => openUrl(`${url}p/${encodeURIComponent(key)}/`) },
        { label: `Actualizar compass/ (${stale} archivo${stale === 1 ? '' : 's'})`, visible: stale > 0, onClick: act(() => updateCompass(compass)) },
        // Desde el menú no hay confirmación, así que el label avisa si lo abrió el dock.
        ...(standalone ? [{ label: app.hubs.isForeign(standalone) ? 'Detener hub suelto (lo abrió el dock)' : 'Detener hub suelto', onClick: act(() => app.hubs.stop(p.path, { force: true })) }] : [])
      ]
    };
  };
  return [
    { label: 'Abrir Inicio', onClick: () => openUrl(url) },
    { separator: true },
    ...projects.map(project),
    ...(projects.length ? [{ separator: true }] : []),
    { label: 'Agregar proyecto…', onClick: () => openUrl(url) },
    // Con --lan, el label dice dónde abrirlo desde el teléfono (lanzado desde el menú no hay terminal que lo muestre).
    { label: lan ? `Desactivar acceso en la red (${lan.join(' ') || 'sin dirección'})` : 'Activar acceso en la red (teléfono)', onClick: toggleLan },
    { label: 'Reiniciar Inicio', onClick: restart },
    { label: 'Cerrar Inicio', onClick: close }
  ];
}

export { listTemplates };

async function loadTemplate(name) {
  const tpl = await loadTemplateFile(name);
  if (!tpl) throw new UsageError(`plantilla desconocida: ${name} (${(await listTemplates()).join(', ')})`);
  return tpl;
}

async function streamText(stream) {
  let s = '';
  for await (const chunk of stream) s += chunk;
  return s;
}
