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
    else if (!h || !alive(Number(n.slice(0, -5)))) rmSync(join(dir, n), { force: true });
  }
  return out.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

export const hubsOf = (project) => listHubs().filter((h) => h.kind !== 'home' && real(h.project) === real(project));
/** El Inicio que esté corriendo (uno por usuario), o null. */
export const liveHome = () => listHubs().find((h) => h.kind === 'home') ?? null;

export function registerHub({ port, project, pid = process.pid, kind }) {
  const dir = registryDir();
  mkdirSync(dir, { recursive: true });
  const entry = kind === 'home' ? { pid, port, kind, startedAt: new Date().toISOString() } : { pid, port, project: real(project), startedAt: new Date().toISOString() };
  writeFileSync(join(dir, `${pid}.json`), JSON.stringify(entry) + '\n');
  return entry;
}

export function unregisterHub(pid = process.pid) {
  rmSync(join(registryDir(), `${pid}.json`), { force: true });
}
