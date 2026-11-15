// Registro de proyectos conocidos (8.1, D23): los que se abrieron o se importaron en este equipo, para que el
// Inicio los muestre aunque su hub esté apagado. Vive en $XDG_CONFIG_HOME/scope-compass/projects.json
// (en Windows, %APPDATA%\scope-compass\projects.json, §18)
// ({ projects: [{ path, name, added_at, last_seen }] }) y solo guarda rutas y nombres: borrarlo no pierde datos.
// A diferencia del registro de hubs vivos (registry.js), no se limpia solo: una carpeta que ya no existe se
// muestra como no encontrada y la quita el usuario. La excepción son las carpetas temporales (tableros de prueba):
// no se anotan solas y el Inicio olvida al arrancar las que ya no existen.
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { writeAtomic } from './store/atomic.js';
import { canonical } from './store/canonical.js';
import { hubsOf } from './registry.js';
import { T } from './i18n.js';

const WIN = process.platform === 'win32';

/** La carpeta de configuración del usuario: $XDG_CONFIG_HOME/scope-compass (en Windows, %APPDATA%\\scope-compass). */
export function configDir() {
  return process.env.SCOMPASS_CONFIG ?? (WIN
    ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'scope-compass')
    : join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'scope-compass'));
}

export function projectsFile() {
  return join(configDir(), 'projects.json');
}

/**
 * Dónde se crean los proyectos nuevos del Inicio si no se elige otra carpeta (D28): la carpeta de datos del
 * usuario, $XDG_DATA_HOME/scope-compass (~/.local/share/scope-compass), el equivalente de AppData en Linux; en
 * Windows, %LOCALAPPDATA%\scope-compass. Cada proyecto es una carpeta con su nombre: …/scope-compass/Vida.
 */
export function projectsDataDir() {
  return process.env.SCOMPASS_DATA ?? (WIN
    ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'scope-compass')
    : join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'scope-compass'));
}

// Lo que Windows no acepta en un nombre de carpeta. Vale en las dos plataformas: un proyecto creado en Linux
// tiene que poder abrirse en Windows (D30).
const BAD_CHARS = /[\\/:*?"<>|\x00-\x1f]/;
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

/** El nombre del proyecto como nombre de carpeta, o null si no sirve (vacío, ".", "..", \ / : * ? " < > |, CON…). */
export function folderName(name) {
  const n = String(name ?? '').trim();
  return !n || BAD_CHARS.test(n) || RESERVED.test(n) || n.endsWith('.') ? null : n;
}

export class ProjectsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };

/** Lee el registro. Un archivo que falta es un registro vacío; uno inválido tira error y no se pisa. */
export function loadProjects() {
  const file = projectsFile();
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new ProjectsError('invalid', T`${file}: JSON inválido (${e.message}); corregilo o borralo`); }
  if (!Array.isArray(data?.projects) || !data.projects.every((p) => typeof p?.path === 'string')) {
    throw new ProjectsError('invalid', T`${file}: se esperaba { "projects": [{ "path", … }] }; corregilo o borralo`);
  }
  return data.projects;
}

// Varios procesos anotan a la vez (tres `serve` que arrancan juntos): leer, cambiar y guardar va con un candado
// (una carpeta al lado del registro, que crea uno solo). Uno que quedó de un proceso muerto vence a los 5 s.
async function locked(fn) {
  const lock = projectsFile() + '.lock';
  mkdirSync(dirname(lock), { recursive: true });
  for (let i = 0; ; i++) {
    try { mkdirSync(lock); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - statSync(lock).mtimeMs > 5000) { rmSync(lock, { recursive: true, force: true }); continue; } } catch { continue; }
      if (i > 400) throw new ProjectsError('io_error', T`${lock} sigue tomado: si no corre otro scompass, borralo`);
      await new Promise((r) => setTimeout(r, 15));
    }
  }
  try { return await fn(); } finally { rmSync(lock, { recursive: true, force: true }); }
}

async function save(projects) {
  const file = projectsFile();
  mkdirSync(dirname(file), { recursive: true });
  await writeAtomic(file, canonical({ projects }));
}

const configOf = (dir) => { try { return JSON.parse(readFileSync(join(dir, 'compass', 'config.json'), 'utf8')); } catch { return null; } };

// Carpetas temporales del sistema: lo que se crea ahí (un tablero para probar algo, los tests) se borra solo.
const TEMP = [...new Set([tmpdir(), ...(WIN ? [] : ['/tmp', '/var/tmp'])].map((d) => real(d)))];
export const isTempPath = (dir) => TEMP.some((t) => { const r = relative(t, real(dir)); return r !== '' && !r.startsWith('..') && !isAbsolute(r); });

/**
 * Anota un proyecto o actualiza su nombre. seen: además marca last_seen (lo usa `serve`). auto: lo anota `init` o
 * `serve` sin que nadie lo pida; uno en una carpeta temporal no se anota (no queda basura en el Inicio).
 * Devuelve { entry, added } (entry null si no se anotó).
 */
export function recordProject(dir, opts) {
  return locked(() => record(dir, opts));
}

async function record(dir, { seen = false, auto = false, now = () => new Date().toISOString() } = {}) {
  const path = real(dir);
  const config = configOf(path);
  if (!config) throw new ProjectsError('not_found', T`no hay ${join(path, 'compass', 'config.json')}`);
  const projects = loadProjects();
  // Con un projects.json también temporal (tests aislados, SCOMPASS_CONFIG en /tmp) no hay basura que evitar.
  if (auto && isTempPath(path) && !isTempPath(projectsFile()) && !projects.some((p) => real(p.path) === path)) return { entry: null, added: false };
  const t = now();
  const i = projects.findIndex((p) => real(p.path) === path);
  const prev = i >= 0 ? projects[i] : { path, added_at: t };
  const entry = { ...prev, path, name: config.project || prev.name || path, ...(seen && { last_seen: t }) };
  const next = i >= 0 ? projects.with(i, entry) : [...projects, entry];
  if (JSON.stringify(next) !== JSON.stringify(projects)) await save(next);
  return { entry, added: i < 0 };
}

/** Quita un proyecto del registro (no toca su carpeta). Devuelve la entrada quitada. */
export function forgetProject(dir) {
  return locked(() => forget(dir));
}

async function forget(dir) {
  const projects = loadProjects();
  const path = real(dir);
  const i = projects.findIndex((p) => real(p.path) === path || p.path === resolve(dir));
  if (i < 0) throw new ProjectsError('not_found', T`${resolve(dir)} no está en el registro`);
  await save(projects.toSpliced(i, 1));
  return projects[i];
}

/** Olvida los proyectos de carpetas temporales que ya no existen (al arrancar el Inicio). Devuelve cuántos. */
export function pruneTempProjects() {
  return locked(prune);
}

async function prune() {
  const projects = loadProjects();
  if (isTempPath(projectsFile())) return 0;
  const keep = projects.filter((p) => !isTempPath(p.path) || existsSync(join(p.path, 'compass', 'config.json')));
  if (keep.length !== projects.length) await save(keep);
  return projects.length - keep.length;
}

/** El registro con el estado de cada proyecto: found (existe su compass/) y los hubs vivos. */
export function projectsStatus() {
  return loadProjects().map((p) => {
    const found = existsSync(join(p.path, 'compass', 'config.json'));
    return { ...p, found, hubs: found ? hubsOf(p.path).map(({ pid, port }) => ({ pid, port })) : [] };
  });
}
