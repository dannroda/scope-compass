// Dónde vive el tablero (m32-10, D-pendiente): <proyecto>/compass es siempre la ruta que usan el hub, la CLI, el MCP
// y el addon, pero puede ser
//   - local: una carpeta del proyecto, en su mismo repo (como hasta ahora);
//   - linked: un enlace (symlink; junction en Windows) a un tablero con su propio git en la carpeta de datos del
//     usuario (<datos>/boards/<nombre>), excluido en .git/info/exclude: el repo del proyecto no tiene rastro de él;
//   - repo: una carpeta con su propio .git dentro del proyecto, como un submódulo (el caso colaborativo).
// Lo que cambia según el tipo es qué git se usa para el estado y el historial del tablero (git -C compass, ver
// git.js e history.js) y que las rutas dentro de un tablero enlazado cuentan como del proyecto (paths.js).
import { execFile } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { appendFile, readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { canonical } from './store/canonical.js';
import { StoreError } from './store/json-files.js';
import { folderName, projectsDataDir } from './projects.js';

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

const realOr = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };

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
    info.repo = (await git(path, ['rev-parse', '--git-dir'])).ok;
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
    await appendFile(file.out, `${text && !text.endsWith('\n') ? '\n' : ''}# Tablero de Scope Compass, en su propio repo (scompass board)\n${line}\n`);
  }
  return file.out;
}

function makeLink(target, compass) {
  // Una junction no pide permisos de administrador ni el modo desarrollador, a diferencia de un symlink de Windows.
  symlinkSync(target, compass, WIN ? 'junction' : 'dir');
}

/**
 * <proyecto>/compass pasa a ser un enlace al tablero de target (una ruta, o un nombre dentro de boardsDir()), que ya
 * tiene que existir: es lo que se hace en otro equipo después de clonar el repo del tablero.
 */
export async function linkBoard(projectDir, target) {
  const dir = isAbsolute(target) || target.includes('/') || target.includes('\\') ? resolve(target) : join(boardsDir(), target);
  if (!existsSync(join(dir, 'config.json'))) throw new StoreError('not_found', `${dir} no es un tablero (no tiene config.json)`);
  const compass = join(projectDir, 'compass');
  // lstat y no existsSync: un enlace roto también ocupa el lugar.
  if ((() => { try { lstatSync(compass); return true; } catch { return false; } })()) throw new StoreError('conflict', `ya existe ${compass}`);
  const rel = relative(realOr(projectDir), realOr(dir));
  if (!rel || (!rel.startsWith('..') && !isAbsolute(rel))) throw new StoreError('invalid_argument', `el tablero tiene que estar fuera del proyecto: ${dir}`);
  makeLink(realOr(dir), compass);
  const exclude = await excludeBoard(projectDir);
  return { path: compass, target: realOr(dir), exclude };
}

/**
 * Saca el compass/ local del proyecto a boardsDir()/<name>, con su propio git, y deja el enlace. Si compass/ está en
 * el repo del proyecto, su historial pasa al repo nuevo (git subtree split) y se saca del índice del proyecto
 * (queda para commitear). Lo que no estaba commiteado se copia igual y queda sin commitear en el tablero: la app no
 * commitea (spec §4.5). El export markdown, si estaba fuera de compass/, pasa a compass/tareas.md y el viejo se
 * borra (es una copia del tablero). Devuelve qué hizo.
 */
export async function moveBoard(projectDir, name) {
  const compass = join(projectDir, 'compass');
  const kind = boardKind(projectDir);
  if (kind === 'none') throw new StoreError('not_found', `no hay ${join(compass, 'config.json')}`);
  if (kind !== 'local') throw new StoreError('conflict', `el tablero ya está en su propio repo (${kind === 'linked' ? 'enlazado a ' + realOr(compass) : 'compass/.git'})`);
  const config = JSON.parse(readFileSync(join(compass, 'config.json'), 'utf8'));
  const n = folderName(name ?? config.project);
  if (!n) throw new StoreError('invalid_argument', `nombre de tablero inválido: ${name ?? config.project}`);
  const dest = join(boardsDir(), n);
  if (existsSync(dest)) throw new StoreError('conflict', `ya existe ${dest}`);

  const top = await git(projectDir, ['rev-parse', '--show-toplevel']);
  const prefix = top.ok ? (await gitOk(projectDir, ['rev-parse', '--show-prefix'])) + 'compass' : null;
  const tracked = top.ok && (await git(projectDir, ['log', '-1', '--format=%H', '--', 'compass'])).out !== '';
  mkdirSync(boardsDir(), { recursive: true });
  let history = false;
  if (tracked) {
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
  return { path: compass, target: dest, history, exclude, ...moved };
}
