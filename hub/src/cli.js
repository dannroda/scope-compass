// CLI `scompass` (spec §6). run() no toca process: recibe argv y dónde escribir, y devuelve el código de salida.
// Sin hub escribe directo en compass/ con el store json-files (misma validación y escritura atómica).
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { exportMarkdown } from './export-md.js';
import { importArtifact } from './import-artifact.js';
import { KINDS, loadValidators, parseDoc, SCHEMA_DIR } from './schema.js';
import { canonical } from './store/canonical.js';
import { createJsonFilesStore, etagOf, StoreError } from './store/json-files.js';

const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');
const STATUS = { todo: 'Pendiente', doing: 'En curso', review: 'Revisión', done: 'Hecho' };

const USAGE = `Uso: scompass [--dir <proyecto>] <comando>

  init [--project <nombre>]                 crea compass/ en el proyecto
  list [--milestone m00] [--status doing]   tareas (--json para agentes)
  show <id>                                 una tarea, con los pasos numerados
  add "<título>" --milestone m00 [--code 0.11] [--status todo]
  move <id> <todo|doing|review|done>
  check <id> <n> [--undo]                   tilda el paso n (desde 1)
  set <id> --file task.json                 reemplazo completo (--file - lee stdin)
  milestone list | show <id> | set <id> --file m.json
  export md [--out docs/tareas.md]          regenera el markdown (también se hace solo al escribir)
  import artifact <carpeta> [--dry-run] [--overwrite]
                                            migra el export de ArtifactData (milestones/, tasks/)

  --json      salida JSON en lecturas y escrituras
  --etag <e>  en escrituras: falla con conflicto si el documento cambió
  --dir <p>   raíz del proyecto (por defecto: la carpeta con compass/ más cercana hacia arriba)`;

class UsageError extends Error {}

const OPTIONS = {
  dir: { type: 'string' }, json: { type: 'boolean' }, etag: { type: 'string' },
  milestone: { type: 'string' }, status: { type: 'string' }, code: { type: 'string' },
  file: { type: 'string' }, out: { type: 'string' }, overwrite: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, undo: { type: 'boolean' }, project: { type: 'string' },
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

const byOrder = (a, b) => (a.doc.order ?? 0) - (b.doc.order ?? 0) ||
  String(a.doc.code ?? '').localeCompare(String(b.doc.code ?? ''), 'es', { numeric: true }) || a.id.localeCompare(b.id);

export async function run(argv, { cwd = process.cwd(), out = process.stdout, err = process.stderr, stdin = process.stdin, now } = {}) {
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
  const store = createJsonFilesStore(compass, { validators, ...(now && { now }) });
  const ifMatch = o.etag === undefined ? {} : { ifMatch: o.etag };
  const showWarnings = (ws) => { for (const w of ws) warn(`aviso [${w.code}] ${w.path}: ${w.message}`); };
  const need = (v, what) => { if (v === undefined || v === '') throw new UsageError(`falta ${what}`); return v; };

  const readJsonFile = async (path) => {
    const text = path === '-' ? await streamText(stdin) : await readFile(resolve(cwd, path), 'utf8');
    try { return JSON.parse(text); } catch (e) { throw new StoreError('invalid_argument', `${path}: JSON inválido: ${e.message}`); }
  };
  const done = (r, msg) => { o.json ? print(JSON.stringify(r)) : print(msg); return 0; };
  // D13: después de cada escritura se regenera el export, salvo auto_export_md: false.
  const written = async (r, msg) => {
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

    async list() {
      if (o.status && !STATUS[o.status]) throw new UsageError(`estado inválido: ${o.status} (todo, doing, review, done)`);
      const all = await store.loadAll();
      showWarnings(all.warnings);
      const ms = new Map(all.milestones);
      const mOrder = (id) => ms.get(id)?.order ?? Infinity;
      const tasks = [...all.tasks].map(([id, doc]) => ({ id, doc }))
        .filter((t) => !o.milestone || t.doc.milestone === o.milestone)
        .filter((t) => !o.status || t.doc.status === o.status)
        .sort((a, b) => mOrder(a.doc.milestone) - mOrder(b.doc.milestone) || byOrder(a, b));
      if (o.json) {
        print(JSON.stringify({ tasks: tasks.map((t) => ({ id: t.id, etag: etagOf(t.doc), ...t.doc })), warnings: all.warnings }));
        return 0;
      }
      let last;
      for (const t of tasks) {
        if (t.doc.milestone !== last) {
          last = t.doc.milestone;
          const m = ms.get(last);
          print(`\n${m ? `${m.code} · ${m.title}` : last}`);
        }
        const cl = t.doc.checklist ?? [];
        const steps = cl.length ? `  ${cl.filter((c) => c.done).length}/${cl.length}` : '';
        print(`  ${t.id.padEnd(9)} ${(t.doc.code || '').padEnd(5)} ${STATUS[t.doc.status].padEnd(9)} ${t.doc.title}${steps}`);
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
      (d.checklist ?? []).forEach((c, i) => print(`  ${String(i + 1).padStart(2)}. [${c.done ? 'x' : ' '}] ${c.text}`));
      if (d.test) print(`Prueba: ${d.test}`);
      if (d.notes) print(`Notas: ${d.notes}`);
      if (d.refs?.length) print(`Referencias: ${d.refs.map((r) => `${r.doc}#${r.section}`).join(', ')}`);
      return 0;
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
      if (wrote && !o['dry-run']) {
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
      }
      const clean = ['milestones', 'tasks'].every((c) => !r[c].different.length && !r[c].invalid.length);
      return clean && !r.warnings.length ? 0 : 1;
    },

    async add() {
      const title = need(rest[0], 'el título');
      const milestone = need(o.milestone, '--milestone');
      await store.get('milestones', milestone);
      const { items } = await store.list('tasks');
      const order = Math.max(0, ...items.filter((t) => t.doc.milestone === milestone).map((t) => t.doc.order ?? 0)) + 1;
      const r = await store.create('tasks', {
        milestone, title, code: o.code ?? '', status: o.status ?? 'todo', order, checklist: [], test: '', notes: '', refs: []
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

    async set() {
      const id = need(rest[0], 'el id');
      const r = await store.put('tasks', id, await readJsonFile(need(o.file, '--file')), ifMatch);
      return written({ id: r.id, etag: r.etag, ...r.doc }, `Guardada ${id}`);
    },

    async milestone() {
      const [sub, id] = rest;
      if (sub === 'list') {
        const { items, warnings } = await store.list('milestones');
        showWarnings(warnings);
        items.sort(byOrder);
        if (o.json) return done({ milestones: items.map((m) => ({ id: m.id, etag: m.etag, ...m.doc })), warnings });
        for (const m of items) print(`  ${m.id.padEnd(5)} ${m.doc.code.padEnd(4)} ${m.doc.title}`);
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
  for (const later of ['serve']) {
    commands[later] = async () => { throw new StoreError('invalid_argument', `\`scompass ${later}\` todavía no está disponible`); };
  }

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
