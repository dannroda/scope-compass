// Registro de hubs activos: un archivo por hub en $XDG_RUNTIME_DIR/scope-compass/hubs/<pid>.json con
// { pid, port, project, startedAt }. El Inicio (`scompass home`, D24) se anota igual, con kind: "home" y sin project. Sirve para no levantar dos hubs del mismo proyecto y para encontrar el hub
// de un proyecto aunque no esté en el puerto de su config. Los registros de procesos muertos se limpian solos.
import { mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';

export function registryDir() {
  const base = process.env.SCOMPASS_REGISTRY ?? (process.env.XDG_RUNTIME_DIR ? join(process.env.XDG_RUNTIME_DIR, 'scope-compass') : join(tmpdir(), `scope-compass-${userInfo().uid}`));
  return join(base, 'hubs');
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const real = (p) => { try { return realpathSync(p); } catch { return p; } };

/** Hubs vivos (limpia los registros de procesos que ya no existen). */
export function listHubs() {
  const dir = registryDir();
  let names = [];
  try { names = readdirSync(dir).filter((n) => n.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const n of names) {
    let h = null;
    try { h = JSON.parse(readFileSync(join(dir, n), 'utf8')); } catch { /* a medio escribir o roto */ }
    if (h && Number.isInteger(h.pid) && alive(h.pid)) out.push(h);
    else if (!h || !alive(parseInt(n, 10))) rmSync(join(dir, n), { force: true });
  }
  return out.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

export const hubsOf = (project) => listHubs().filter((h) => h.kind !== 'home' && real(h.project) === real(project));
/** El Inicio que esté corriendo (uno por usuario), o null. */
export const liveHome = () => listHubs().find((h) => h.kind === 'home') ?? null;

// attached: el hub se cierra cuando se corta su entrada (--exit-on-stdin-close: lo lanzó el dock o el Inicio);
// parent: el pid de quien lo lanzó. El Inicio los usa para avisar antes de apagar un hub que no es suyo.
// tray (solo el Inicio): tiene ícono en la bandeja, así que los hubs esconden el suyo.
export function registerHub({ port, project, pid = process.pid, kind, attached = false, parent = process.ppid, tray = false }) {
  const dir = registryDir();
  mkdirSync(dir, { recursive: true });
  const entry = kind === 'home' ? { pid, port, kind, startedAt: new Date().toISOString(), ...(tray && { tray }) }
    : { pid, port, project: real(project), startedAt: new Date().toISOString(), ...(attached && { attached, parent }),
      // SCOMPASS_LAUNCHED_BY=home: lo prendió el Inicio (se hereda al reiniciar el hub, que cambia de padre).
      ...(process.env.SCOMPASS_LAUNCHED_BY && { by: process.env.SCOMPASS_LAUNCHED_BY }) };
  writeFileSync(join(dir, `${pid}.json`), JSON.stringify(entry) + '\n');
  return entry;
}

export function unregisterHub(pid = process.pid) {
  rmSync(join(registryDir(), `${pid}.json`), { force: true });
}

// Proyectos que sirve el Inicio (D29): una entrada por proyecto, <pid>-<clave>.json, con base: "/p/<clave>". Para
// la CLI y el dock es un hub más (hubsOf los incluye), en el puerto del Inicio y con esa base delante de las rutas.
export function registerServed({ port, project, base, key, pid = process.pid }) {
  const dir = registryDir();
  mkdirSync(dir, { recursive: true });
  const entry = { pid, port, project: real(project), base, kind: 'served', startedAt: new Date().toISOString() };
  writeFileSync(join(dir, `${pid}-${key}.json`), JSON.stringify(entry) + '\n');
  return entry;
}

/** Quita todas las entradas de proyectos servidos por este proceso. */
export function unregisterServed(pid = process.pid) {
  let names = [];
  try { names = readdirSync(registryDir()); } catch { return; }
  for (const n of names) if (n.startsWith(`${pid}-`) && n.endsWith('.json')) rmSync(join(registryDir(), n), { force: true });
}
