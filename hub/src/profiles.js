// Perfiles de Claude Code para el chat (M28, spec §33, D44): carpetas de configuración (CLAUDE_CONFIG_DIR), cada una
// con su login, su settings.json y sus sesiones. El predeterminado es ~/.claude (claude sin CLAUDE_CONFIG_DIR); los
// demás, las carpetas de ~/.claude-profiles (o de SCOMPASS_CLAUDE_PROFILES) con .claude.json o settings.json.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { claudeSpawn, findClaude } from './chat.js';
import { projectsFile } from './projects.js';
import { writeAtomic } from './store/atomic.js';

export const DEFAULT_PROFILE = 'default';
const ACCOUNT_MS = 10 * 60 * 1000;

const home = (env) => env.HOME || env.USERPROFILE || homedir();

/** Los perfiles del equipo: [{ id, label, dir, default? }], el predeterminado primero y los demás por nombre. */
export function listProfiles(env = process.env) {
  const out = [{ id: DEFAULT_PROFILE, label: 'Predeterminado', dir: join(home(env), '.claude'), default: true }];
  const base = env.SCOMPASS_CLAUDE_PROFILES || join(home(env), '.claude-profiles');
  let names = [];
  try { names = readdirSync(base).sort((a, b) => a.localeCompare(b)); } catch {}
  for (const name of names) {
    const dir = join(base, name);
    try { if (!statSync(dir).isDirectory()) continue; } catch { continue; }
    if (name === DEFAULT_PROFILE || !['.claude.json', 'settings.json'].some((f) => existsSync(join(dir, f)))) continue;
    out.push({ id: name, label: name, dir });
  }
  return out;
}

/** El entorno con que se lanza claude en ese perfil: sin CLAUDE_CONFIG_DIR el predeterminado, con él los demás. */
export function profileEnv(profile, env = process.env) {
  const out = { ...env };
  delete out.CLAUDE_CONFIG_DIR;
  if (profile && !profile.default) out.CLAUDE_CONFIG_DIR = profile.dir;
  return out;
}

/**
 * En qué perfil está una sesión de Claude Code: el primero con <perfil>/projects/<carpeta>/<session>.jsonl. Solo
 * mira si el archivo existe. null si no está en ninguno.
 */
export function sessionProfile(session, profiles) {
  for (const p of profiles) {
    let dirs = [];
    try { dirs = readdirSync(join(p.dir, 'projects')); } catch { continue; }
    if (dirs.some((d) => existsSync(join(p.dir, 'projects', d, `${session}.jsonl`)))) return p;
  }
  return null;
}

const accounts = new Map(); // dir → { at, value }

/**
 * La cuenta de un perfil, de `claude auth status --json` (no gasta tokens), guardada 10 minutos:
 * { logged_in, method, email?, org?, plan? }, o null si claude no está o no contesta.
 */
export async function accountOf(profile, { env = process.env, now = Date.now } = {}) {
  const hit = accounts.get(profile.dir);
  if (hit && now() - hit.at < ACCOUNT_MS) return hit.value;
  const exe = findClaude(env);
  if (!exe) return null;
  const out = await new Promise((resolve) => {
    let text = '';
    const child = claudeSpawn(exe, ['auth', 'status', '--json'], { env: profileEnv(profile, cleanEnv(env)), stdio: ['ignore', 'pipe', 'ignore'] });
    const t = setTimeout(() => child.kill(), 15000);
    child.stdout.on('data', (d) => { text += d; });
    child.on('error', () => resolve(null));
    child.on('close', () => { clearTimeout(t); resolve(text); });
  });
  let s;
  try { s = JSON.parse(out); } catch { return null; }
  const value = { logged_in: s.loggedIn === true, method: s.authMethod ?? null };
  if (s.email) value.email = s.email;
  if (s.orgName) value.org = s.orgName;
  if (s.subscriptionType) value.plan = s.subscriptionType;
  accounts.set(profile.dir, { at: now(), value });
  return value;
}

/** Olvida las cuentas guardadas (los tests, o después de un login). */
export function forgetAccounts() { accounts.clear(); }

/** El entorno sin lo de la sesión de Claude Code que pudo lanzar el hub: el hijo no tiene que creerse anidado. */
export function cleanEnv(env) {
  const out = { ...env };
  for (const k of Object.keys(out)) if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_')) delete out[k];
  return out;
}

// El último uso de los límites de cada perfil (§33), de los rate_limit_event: es de la cuenta, no del proyecto, así
// que vive junto a las carpetas de los chats. { <perfil>: { status, five_hour?, seven_day?, overage?, at } }.
const limitsFile = () => join(dirname(projectsFile()), 'chats', 'limits.json');
let limitsQueue = Promise.resolve();
export async function loadLimits() {
  try { return JSON.parse(await readFile(limitsFile(), 'utf8')) ?? {}; } catch { return {}; }
}
export function saveLimits(profile, limits, at) {
  const p = limitsQueue.then(async () => {
    const all = await loadLimits();
    all[profile] = { ...limits, at };
    await mkdir(dirname(limitsFile()), { recursive: true });
    await writeAtomic(limitsFile(), `${JSON.stringify(all, null, 2)}\n`);
    return all[profile];
  });
  limitsQueue = p.catch(() => {});
  return p;
}
