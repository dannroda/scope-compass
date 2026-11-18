// Dónde vive el tablero (m32-10, D-pendiente): <proyecto>/compass es siempre la ruta que usan el hub, la CLI, el MCP
// y el addon, pero puede ser
//   - local: una carpeta del proyecto, en su mismo repo (como hasta ahora);
//   - linked: un enlace (symlink; junction en Windows) a un tablero con su propio git en la carpeta de datos del
//     usuario (<datos>/boards/<nombre>), excluido en .git/info/exclude: el repo del proyecto no tiene rastro de él;
//   - repo: una carpeta con su propio .git dentro del proyecto, como un submódulo (el caso colaborativo).
// La carpeta de tableros puede ser la raíz de un repo para todos los tableros (cada uno es una subcarpeta sin .git
// propio) o una carpeta común, y entonces cada tablero tiene su repo (sharedRepo).
// Lo que cambia según el tipo es qué git se usa para el estado y el historial del tablero (git -C compass, ver
// git.js e history.js) y que las rutas dentro de un tablero enlazado cuentan como del proyecto (paths.js).
import { execFile, spawn } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { appendFile, readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { canonical } from './store/canonical.js';
import { StoreError } from './store/json-files.js';
import { folderName, projectsDataDir } from './projects.js';
import { T } from './i18n.js';

const WIN = process.platform === 'win32';

/** Carpeta de los tableros fuera del proyecto: <datos>/boards (SCOMPASS_BOARDS la cambia, para los tests). */
export const boardsDir = () => process.env.SCOMPASS_BOARDS ?? join(projectsDataDir(), 'boards');

const git = (dir, args) => new Promise((done) => {
  execFile('git', ['-C', dir, ...args], { timeout: 60000, windowsHide: true, maxBuffer: 32 << 20 }, (err, stdout, stderr) => done(err ? { ok: false, out: '', err: (stderr || err.message).trim() } : { ok: true, out: stdout.trim() }));
});
const gitOk = async (dir, args) => {
  const r = await git(dir, args);
  if (!r.ok) throw new StoreError('io_error', `git ${args[0]}: ${r.err}`);
  return r.out;
};

// git con otro índice (GIT_INDEX_FILE), para armar un commit sin tocar el índice ni el árbol de trabajo.
const gitEnv = (dir, args, env) => new Promise((done) => {
  execFile('git', ['-C', dir, ...args], { timeout: 60000, windowsHide: true, maxBuffer: 32 << 20, env: { ...process.env, ...env } }, (err, stdout, stderr) => {
    if (err) done(Promise.reject(new StoreError('io_error', `git ${args[0]}: ${(stderr || err.message).trim()}`)));
    else done(stdout.trim());
  });
});

// git con algo por stdin (mktree, commit-tree -F -).
const gitIn = (dir, args, input, env = {}) => new Promise((done, fail) => {
  const p = spawn('git', ['-C', dir, ...args], { windowsHide: true, env: { ...process.env, ...env } });
  let out = '', err = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { err += d; });
  p.on('error', fail);
  p.on('close', (code) => (code === 0 ? done(out.trim()) : fail(new StoreError('io_error', `git ${args[0]}: ${err.trim()}`))));
  p.stdin.end(input);
});

const realOr = (p) => { try { return realpathSync.native(p); } catch { return resolve(p); } };

/**
 * La raíz del repo compartido de tableros, si la carpeta de tableros es la raíz de un repo (no una carpeta dentro de
 * otro repo, como un $HOME versionado); si no, null y cada tablero tiene su propio repo.
 */
export async function sharedRepo() {
  const dir = boardsDir();
  if (!existsSync(dir)) return null;
  const top = await git(dir, ['rev-parse', '--show-toplevel']);
  return top.ok && realOr(top.out) === realOr(dir) ? realOr(dir) : null;
}

/**
 * Crea la carpeta de un tablero nuevo en boardsDir()/<name>, con `git init` si no hay repo compartido, y enlaza
 * <proyecto>/compass a ella (lo usa `init`). La carpeta queda vacía: el contenido lo escribe quien llama.
 */
export async function newBoard(projectDir, name) {
  const n = folderName(name);
  if (!n) throw new StoreError('invalid_argument', T`nombre de tablero inválido: ${name}`);
  const dest = join(boardsDir(), n);
  if (existsSync(dest)) throw new StoreError('conflict', T`ya existe el tablero ${dest}: elegí otro nombre (--board <nombre>) o enlazalo (scompass board link ${n})`);
  const compass = join(projectDir, 'compass');
  if ((() => { try { lstatSync(compass); return true; } catch { return false; } })()) throw new StoreError('conflict', T`ya existe ${compass}`);
  mkdirSync(dest, { recursive: true });
  const shared = await sharedRepo();
  if (!shared) await gitOk(dest, ['init', '-q', '-b', 'main']);
  makeLink(dest, compass);
  const exclude = await excludeBoard(projectDir);
  return { path: compass, target: dest, shared: !!shared, exclude };
}

/** El tipo de tablero: 'none', 'local', 'linked' o 'repo'. */
export function boardKind(projectDir) {
  const compass = join(projectDir, 'compass');
  let st;
  try { st = lstatSync(compass); } catch { return 'none'; }
  if (st.isSymbolicLink()) return existsSync(join(compass, 'config.json')) ? 'linked' : 'none';
  if (!st.isDirectory() || !existsSync(join(compass, 'config.json'))) return 'none';
  // .git es un archivo en un submódulo y una carpeta en un clon suelto: los dos son el repo propio del tablero.
  return existsSync(join(compass, '.git')) ? 'repo' : 'local';
}

/**
 * { kind, path, target, remote, branch }: dónde está el tablero de verdad (target, siguiendo el enlace) y, si tiene
 * repo propio, su origin y su rama. remote y branch son null en un tablero local (son los del proyecto).
 */
export async function boardInfo(projectDir) {
  const path = join(projectDir, 'compass');
  const kind = boardKind(projectDir);
  const info = { kind, path, target: kind === 'none' ? null : realOr(path), remote: null, branch: null };
  if (kind === 'linked' || kind === 'repo') {
    const [remote, branch] = await Promise.all([git(path, ['remote', 'get-url', 'origin']), git(path, ['symbolic-ref', '--short', '-q', 'HEAD'])]);
    info.remote = remote.ok ? remote.out : null;
    info.branch = branch.ok ? branch.out : null;
    // Un enlace a una carpeta sin git es válido, pero el estado y el historial del tablero quedan sin repo.
    const top = await git(path, ['rev-parse', '--show-toplevel']);
    info.repo = top.ok;
    // shared: el tablero es una subcarpeta de un repo con varios (el de todos los tableros).
    info.shared = top.ok && realOr(top.out) !== info.target;
    if (top.ok) info.repoDir = realOr(top.out);
  }
  return info;
}

/** La carpeta real de un tablero enlazado o con repo propio, o null: lo que paths.js acepta como del proyecto. */
export function linkedTarget(projectDir) {
  const compass = join(projectDir, 'compass');
  try { if (!lstatSync(compass).isSymbolicLink()) return null; } catch { return null; }
  // Solo un enlace a un tablero: un compass/ que apunta a / o a $HOME no abre todo el disco.
  return existsSync(join(compass, 'config.json')) ? realOr(compass) : null;
}

/**
 * Agrega /compass (con la ruta desde la raíz del repo) al .git/info/exclude del proyecto: git no lo ve, sin tocar
 * .gitignore, que se commitea. Sin repo, no hace nada. Devuelve el archivo o null.
 */
export async function excludeBoard(projectDir) {
  const [file, prefix] = await Promise.all([git(projectDir, ['rev-parse', '--path-format=absolute', '--git-path', 'info/exclude']), git(projectDir, ['rev-parse', '--show-prefix'])]);
  if (!file.ok || !prefix.ok) return null;
  const line = `/${prefix.out}compass`;
  const text = await readFile(file.out, 'utf8').catch(() => '');
  if (!text.split(/\r?\n/).includes(line)) {
    mkdirSync(join(file.out, '..'), { recursive: true });
    await appendFile(file.out, T`${text && !text.endsWith('\n') ? '\n' : ''}# Tablero de Scope Compass, en su propio repo (scompass board)\n${line}\n`);
  }
  return file.out;
}

function makeLink(target, compass) {
  // Una junction no pide permisos de administrador ni el modo desarrollador, a diferencia de un symlink de Windows.
  symlinkSync(target, compass, WIN ? 'junction' : 'dir');
}

/**
 * Los tableros de boardsDir() (las subcarpetas con config.json), para elegir uno y enlazarlo: { name, path, project,
 * used_by }. project es el de su config.json; used_by, los proyectos (de los que se pasan, los del Inicio) cuyo
 * compass/ apunta a él: uno se puede enlazar desde varios.
 */
export function listBoards(projects = []) {
  const dir = boardsDir();
  const users = new Map();
  for (const p of projects) {
    if (boardKind(p) !== 'linked') continue;
    const t = realOr(join(p, 'compass'));
    users.set(t, [...(users.get(t) ?? []), p]);
  }
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return entries.filter((e) => e.isDirectory() && existsSync(join(dir, e.name, 'config.json'))).map((e) => {
    const path = realOr(join(dir, e.name));
    let project = null;
    try { project = JSON.parse(readFileSync(join(path, 'config.json'), 'utf8')).project ?? null; } catch { /* un config.json roto igual es un tablero */ }
    return { name: e.name, path, project, used_by: users.get(path) ?? [] };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * <proyecto>/compass pasa a ser un enlace al tablero de target (una ruta, o un nombre dentro de boardsDir()), que ya
 * tiene que existir: un tablero creado antes (en este equipo, por otro proyecto o solo) o el que se clonó en otro equipo.
 */
export async function linkBoard(projectDir, target) {
  const dir = boardTarget(projectDir, target);
  const compass = join(projectDir, 'compass');
  // lstat y no existsSync: un enlace roto también ocupa el lugar.
  if ((() => { try { lstatSync(compass); return true; } catch { return false; } })()) throw new StoreError('conflict', T`ya existe ${compass}`);
  makeLink(dir, compass);
  const exclude = await excludeBoard(projectDir);
  return { path: compass, target: dir, exclude };
}

/** La carpeta real del tablero de target (una ruta, o un nombre dentro de boardsDir()): tiene que ser un tablero y estar fuera del proyecto. */
function boardTarget(projectDir, target) {
  const dir = isAbsolute(target) || target.includes('/') || target.includes('\\') ? resolve(target) : join(boardsDir(), target);
  if (!existsSync(join(dir, 'config.json'))) throw new StoreError('not_found', T`${dir} no es un tablero (no tiene config.json)`);
  const rel = relative(realOr(projectDir), realOr(dir));
  if (!rel || (!rel.startsWith('..') && !isAbsolute(rel))) throw new StoreError('invalid_argument', T`el tablero tiene que estar fuera del proyecto: ${dir}`);
  return realOr(dir);
}

/**
 * Cambia el tablero de un proyecto por otro que ya existe (`board link --replace`). Sin tablero, es board link. Un
 * enlace se cambia por el nuevo (el tablero viejo no se toca). Un tablero local (en el repo del proyecto) sale del
 * índice y del disco, con el export markdown de afuera de compass/ (es una copia del tablero), como en board move:
 * queda en el historial del proyecto y el cambio queda para commitear. Se niega si tiene algo sin commitear, porque
 * eso se perdería; un submódulo (compass/.git) se cambia con git.
 */
export async function replaceBoard(projectDir, target) {
  const kind = boardKind(projectDir);
  const compass = join(projectDir, 'compass');
  if (kind === 'none' && !existsSync(compass)) return { ...(await linkBoard(projectDir, target)), replaced: null };
  if (kind === 'none') throw new StoreError('conflict', T`ya existe ${compass} y no es un tablero: sacalo a mano`);
  if (kind === 'repo') throw new StoreError('conflict', T('compass/ es un repo propio (un submódulo): cambialo con git'));
  const dir = boardTarget(projectDir, target);
  if (realOr(compass) === dir) throw new StoreError('conflict', T`el proyecto ya usa ese tablero: ${dir}`);
  const removed = { replaced: kind, untracked: false, exportRemoved: null };
  if (kind === 'linked') {
    unlinkSync(compass);
  } else {
    let exp = null;
    try { exp = JSON.parse(readFileSync(join(compass, 'config.json'), 'utf8')).export_md ?? 'docs/tareas.md'; } catch { /* sin export que sacar */ }
    if (exp?.startsWith('compass/')) exp = null;
    const top = await git(projectDir, ['rev-parse', '--show-toplevel']);
    // Sin git (o ignorado) no queda ningún historial del tablero viejo: borrarlo sería perderlo.
    const tracked = top.ok && (await git(projectDir, ['ls-files', '--', 'compass/config.json'])).out !== '';
    if (!tracked) throw new StoreError('conflict', T('compass/ no está commiteado en un repo de git y se perdería: sacalo con scompass board move o movelo a mano'));
    // Lo sin commitear no está en ningún historial.
    const dirty = await gitOk(projectDir, ['status', '--porcelain', '--', 'compass']);
    if (dirty) throw new StoreError('conflict', T`compass/ tiene cambios sin commitear (${dirty.split('\n').length}): commitealos o descartalos antes de cambiar el tablero, o se pierden`);
    await gitOk(projectDir, ['rm', '-r', '-q', '-f', '--cached', '--', 'compass']);
    removed.untracked = true;
    if (exp) await git(projectDir, ['rm', '-q', '--cached', '--ignore-unmatch', '--', exp]);
    rmSync(compass, { recursive: true, force: true });
    if (exp && existsSync(join(projectDir, exp))) {
      rmSync(join(projectDir, exp), { force: true });
      removed.exportRemoved = exp;
    }
  }
  makeLink(dir, compass);
  const exclude = await excludeBoard(projectDir);
  return { path: compass, target: dir, exclude, ...removed };
}

/**
 * Saca el compass/ local del proyecto a boardsDir()/<name> y deja el enlace. Sin repo compartido, el tablero tiene su
 * propio git; con él, es una subcarpeta del repo de tableros. Si compass/ está en el repo del proyecto, su historial
 * pasa al repo del tablero (git subtree split; con el repo compartido, en un commit, ver importHistory) y se saca del
 * índice del proyecto (queda para commitear). Lo que no estaba commiteado se copia igual y queda sin commitear en el tablero: la app no
 * commitea (spec §4.5). El export markdown, si estaba fuera de compass/, pasa a compass/tareas.md y el viejo se
 * borra (es una copia del tablero). Devuelve qué hizo.
 */
export async function moveBoard(projectDir, name) {
  const compass = join(projectDir, 'compass');
  const kind = boardKind(projectDir);
  if (kind === 'none') throw new StoreError('not_found', T`no hay ${join(compass, 'config.json')}`);
  if (kind !== 'local') throw new StoreError('conflict', T`el tablero ya está en su propio repo (${kind === 'linked' ? T`enlazado a ${realOr(compass)}` : 'compass/.git'})`);
  const config = JSON.parse(readFileSync(join(compass, 'config.json'), 'utf8'));
  const n = folderName(name ?? config.project);
  if (!n) throw new StoreError('invalid_argument', T`nombre de tablero inválido: ${name ?? config.project}`);
  const dest = join(boardsDir(), n);
  if (existsSync(dest)) throw new StoreError('conflict', T`ya existe ${dest}`);

  const top = await git(projectDir, ['rev-parse', '--show-toplevel']);
  const prefix = top.ok ? (await gitOk(projectDir, ['rev-parse', '--show-prefix'])) + 'compass' : null;
  const tracked = top.ok && (await git(projectDir, ['log', '-1', '--format=%H', '--', 'compass'])).out !== '';
  mkdirSync(boardsDir(), { recursive: true });
  const shared = await sharedRepo();
  let history = false;
  if (shared) {
    mkdirSync(dest);
    if (tracked) {
      history = true;
      await importHistory({ shared, name: n, projectTop: top.out, prefix, label: config.project ?? n });
    }
    for (const e of readdirSync(dest)) rmSync(join(dest, e), { recursive: true, force: true });
  } else if (tracked) {
    // subtree split arma la historia de compass/ como si siempre hubiera sido la raíz; se clona desde una rama
    // temporal del proyecto, que después se borra.
    const branch = `scompass-board-${Date.now()}`;
    await gitOk(top.out, ['subtree', 'split', '-q', `--prefix=${prefix}`, '-b', branch]);
    try {
      await gitOk(boardsDir(), ['clone', '-q', '--no-local', '--single-branch', '--branch', branch, top.out, dest]);
    } finally {
      await git(top.out, ['branch', '-D', branch]);
    }
    await gitOk(dest, ['branch', '-m', 'main']);
    await gitOk(dest, ['remote', 'remove', 'origin']);
    // Lo de disco (también lo sin commitear) reemplaza lo de la última versión commiteada.
    for (const e of readdirSync(dest)) if (e !== '.git') rmSync(join(dest, e), { recursive: true, force: true });
    history = true;
  } else {
    mkdirSync(dest);
    await gitOk(dest, ['init', '-q', '-b', 'main']);
  }
  cpSync(compass, dest, { recursive: true, verbatimSymlinks: true });

  // El export pasa adentro del tablero: fuera de él publicaría el tablero con el repo del proyecto.
  const moved = { exportFrom: null, exportTo: null };
  const exp = config.export_md ?? 'docs/tareas.md';
  if (!exp.startsWith('compass/')) {
    config.export_md = 'compass/tareas.md';
    writeFileSync(join(dest, 'config.json'), canonical(config));
    moved.exportFrom = exp;
    moved.exportTo = config.export_md;
    const old = join(projectDir, exp);
    if (existsSync(old)) {
      if (top.ok) await git(projectDir, ['rm', '-q', '--cached', '--ignore-unmatch', '--', exp]);
      rmSync(old, { force: true });
    }
  }

  if (tracked) await gitOk(projectDir, ['rm', '-r', '-q', '-f', '--cached', '--', 'compass']);
  rmSync(compass, { recursive: true, force: true });
  makeLink(dest, compass);
  const exclude = await excludeBoard(projectDir);
  return { path: compass, target: dest, history, shared: !!shared, exclude, ...moved };
}

/**
 * La historia partida de compass/ (con la raíz en el tablero), commit por commit con <name>/ adelante: mismos
 * autores, fechas y mensajes, otros hashes. Sin esto, `git log -- <name>/tasks/x.json` (el historial de una tarea)
 * se corta en el commit que la trae, porque antes los archivos estaban en tasks/; `git subtree add` tiene ese
 * problema. Devuelve el commit nuevo de la punta.
 */
async function prefixHistory(repo, tip, name) {
  const revs = (await gitOk(repo, ['rev-list', '--reverse', '--topo-order', tip])).split('\n').filter(Boolean);
  const map = new Map();
  for (const c of revs) {
    const [tree, parents, an, ae, ad, cn, ce, cd, ...msg] = (await gitOk(repo, ['log', '-1', '--format=%T%x00%P%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%B', c])).split('\0');
    const wrapped = await gitIn(repo, ['mktree'], `040000 tree ${tree}\t${name}\n`);
    const ps = parents.split(' ').filter(Boolean).flatMap((p) => ['-p', map.get(p)]);
    const env = { GIT_AUTHOR_NAME: an, GIT_AUTHOR_EMAIL: ae, GIT_AUTHOR_DATE: ad, GIT_COMMITTER_NAME: cn, GIT_COMMITTER_EMAIL: ce, GIT_COMMITTER_DATE: cd };
    map.set(c, await gitIn(repo, ['commit-tree', wrapped, ...ps, '-F', '-'], msg.join('\0'), env));
  }
  return map.get(tip);
}

/**
 * Con un repo compartido, el historial de compass/ entra como subcarpeta <name>/ en un commit con dos padres (el
 * HEAD del repo y la historia de compass/ con <name>/ adelante, ver prefixHistory), como `git subtree add`, pero
 * armado con un índice aparte:
 * subtree add pide el árbol limpio, y en el repo de todos los tableros casi siempre hay algo sin commitear de otro.
 * Es el único commit que hace la app (decisión del usuario, m32-10). Después, el índice real suma la subcarpeta y
 * sus archivos se escriben en el disco.
 */
async function importHistory({ shared, name, projectTop, prefix, label }) {
  const branch = `scompass-board-${Date.now()}`;
  await gitOk(projectTop, ['subtree', 'split', '-q', `--prefix=${prefix}`, '-b', branch]);
  let split;
  try {
    await gitOk(shared, ['fetch', '-q', '--no-tags', projectTop, `refs/heads/${branch}`]);
    split = await gitOk(shared, ['rev-parse', 'FETCH_HEAD']);
  } finally {
    await git(projectTop, ['branch', '-D', branch]);
  }
  const head = await git(shared, ['rev-parse', '-q', '--verify', 'HEAD']);
  const index = await gitOk(shared, ['rev-parse', '--path-format=absolute', '--git-path', `scompass-index-${Date.now()}`]);
  const env = { GIT_INDEX_FILE: index };
  try {
    if (head.ok) await gitEnv(shared, ['read-tree', 'HEAD'], env);
    await gitEnv(shared, ['read-tree', `--prefix=${name}/`, split], env);
    const tree = await gitEnv(shared, ['write-tree'], env);
    const history = await prefixHistory(shared, split, name);
    const commit = await gitEnv(shared, ['commit-tree', tree, ...(head.ok ? ['-p', head.out] : []), '-p', history, '-m', `Tablero ${label} (${name}/), con su historial (scompass board move)`], {});
    await gitOk(shared, ['update-ref', 'HEAD', commit]);
  } finally {
    rmSync(index, { force: true });
  }
  await gitOk(shared, ['read-tree', `--prefix=${name}/`, split]);
  await gitOk(shared, ['checkout', '--', `${name}/`]);
}
