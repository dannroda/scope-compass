// Registro de proyectos conocidos (8.1, D23): los que se abrieron o se importaron en este equipo, para que el
// Inicio los muestre aunque su hub esté apagado. Vive en $XDG_CONFIG_HOME/scope-compass/projects.json
// ({ projects: [{ path, name, added_at, last_seen }] }) y solo guarda rutas y nombres: borrarlo no pierde datos.
// A diferencia del registro de hubs vivos (registry.js), no se limpia solo: una carpeta que ya no existe se
// muestra como no encontrada y la quita el usuario.
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { writeAtomic } from './store/atomic.js';
import { canonical } from './store/canonical.js';
import { hubsOf } from './registry.js';

export function projectsFile() {
  const base = process.env.SCOMPASS_CONFIG ?? join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'scope-compass');
  return join(base, 'projects.json');
}

/**
 * Dónde se crean los proyectos nuevos del Inicio si no se elige otra carpeta (D28): la carpeta de datos del
 * usuario, $XDG_DATA_HOME/scope-compass/proyectos (~/.local/share/…), el equivalente de AppData en Linux.
 */
export function projectsDataDir() {
  return process.env.SCOMPASS_DATA ?? join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'scope-compass', 'proyectos');
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
  try { data = JSON.parse(text); } catch (e) { throw new ProjectsError('invalid', `${file}: JSON inválido (${e.message}); corregilo o borralo`); }
  if (!Array.isArray(data?.projects) || !data.projects.every((p) => typeof p?.path === 'string')) {
    throw new ProjectsError('invalid', `${file}: se esperaba { "projects": [{ "path", … }] }; corregilo o borralo`);
  }
  return data.projects;
}

async function save(projects) {
  const file = projectsFile();
  mkdirSync(dirname(file), { recursive: true });
  await writeAtomic(file, canonical({ projects }));
}

const configOf = (dir) => { try { return JSON.parse(readFileSync(join(dir, 'compass', 'config.json'), 'utf8')); } catch { return null; } };

/**
 * Anota un proyecto o actualiza su nombre. seen: además marca last_seen (lo usa `serve`).
 * Devuelve { entry, added }.
 */
export async function recordProject(dir, { seen = false, now = () => new Date().toISOString() } = {}) {
  const path = real(dir);
  const config = configOf(path);
  if (!config) throw new ProjectsError('not_found', `no hay ${join(path, 'compass', 'config.json')}`);
  const projects = loadProjects();
  const t = now();
  const i = projects.findIndex((p) => real(p.path) === path);
  const prev = i >= 0 ? projects[i] : { path, added_at: t };
  const entry = { ...prev, path, name: config.project || prev.name || path, ...(seen && { last_seen: t }) };
  const next = i >= 0 ? projects.with(i, entry) : [...projects, entry];
  if (JSON.stringify(next) !== JSON.stringify(projects)) await save(next);
  return { entry, added: i < 0 };
}

/** Quita un proyecto del registro (no toca su carpeta). Devuelve la entrada quitada. */
export async function forgetProject(dir) {
  const projects = loadProjects();
  const path = real(dir);
  const i = projects.findIndex((p) => real(p.path) === path || p.path === resolve(dir));
  if (i < 0) throw new ProjectsError('not_found', `${resolve(dir)} no está en el registro`);
  await save(projects.toSpliced(i, 1));
  return projects[i];
}

/** El registro con el estado de cada proyecto: found (existe su compass/) y los hubs vivos. */
export function projectsStatus() {
  return loadProjects().map((p) => {
    const found = existsSync(join(p.path, 'compass', 'config.json'));
    return { ...p, found, hubs: found ? hubsOf(p.path).map(({ pid, port }) => ({ pid, port })) : [] };
  });
}
