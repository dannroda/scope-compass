// Actualizar el binario de scompass (spec §39, D62): busca la release más nueva en GitHub, baja el ejecutable de esta
// plataforma, lo compara con SHA256SUMS y lo pone en lugar del que corre. Lo usan `scompass upgrade` y el Inicio (el
// aviso de la web y de la bandeja). Solo el binario: un paquete de npm o un clon del repo se actualizan con npm o git.
//
// Las mismas reglas que el actualizador del addon (addon_updater.gd): sin borradores y sin pre-releases, salvo que se
// pidan (--pre) o que la versión que corre sea una pre-release (quien instaló una sigue recibiendo las siguientes).
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { projectsDataDir } from './projects.js';
import { IS_BINARY } from './self.js';
import { VERSION } from './server.js';
import { T } from './i18n.js';

export const REPO = 'dannroda/scope-compass';
// SCOMPASS_RELEASES_URL: otra lista de releases con el formato de la API de GitHub (los tests usan un servidor local).
const releasesUrl = (env = process.env) => env.SCOMPASS_RELEASES_URL || `https://api.github.com/repos/${REPO}/releases?per_page=10`;
// Una vez por día alcanza (y la API de GitHub sin token permite 60 consultas por hora).
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
const USER_AGENT = `scope-compass/${VERSION}`;

export class UpgradeError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/** -1, 0 o 1, como compare_versions del addon: X.Y.Z y una pre-release (-algo) antes que la misma sin ella. */
export function compareVersions(a, b) {
  const parts = (v) => {
    const clean = String(v).trim().replace(/^v/, '');
    const dash = clean.indexOf('-');
    const nums = (dash >= 0 ? clean.slice(0, dash) : clean).split('.').map((n) => parseInt(n, 10) || 0);
    return { nums: [0, 1, 2].map((i) => nums[i] ?? 0), pre: dash >= 0 ? clean.slice(dash + 1) : '' };
  };
  const pa = parts(a), pb = parts(b);
  for (let i = 0; i < 3; i++) if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] > pb.nums[i] ? 1 : -1;
  if (pa.pre === pb.pre) return 0;
  if (!pa.pre) return 1;
  if (!pb.pre) return -1;
  return pa.pre > pb.pre ? 1 : -1;
}

/** El nombre del ejecutable de una versión en la release, como lo arma tools/build.mjs. */
export function assetName(version, { platform = process.platform, arch = process.arch } = {}) {
  const os = { linux: 'linux', win32: 'windows', darwin: 'macos' }[platform] ?? platform;
  return `scompass-v${version}-${os}-${arch}${platform === 'win32' ? '.exe' : ''}`;
}

/**
 * La release más nueva de la lista de la API que trae el binario de esta plataforma, o null.
 * { version, tag, prerelease, notes, html_url, binary_url, sums_url }. Las pre-releases cuentan con pre, o si la
 * versión `current` es una release marcada como pre-release en la lista.
 */
export function pickRelease(list, { pre = false, current = VERSION, platform, arch } = {}) {
  if (!Array.isArray(list)) return null;
  const releases = list.filter((r) => r && typeof r === 'object' && !r.draft);
  const onPre = pre || releases.some((r) => r.prerelease && compareVersions(String(r.tag_name ?? ''), current) === 0);
  let best = null;
  for (const r of releases) {
    if (r.prerelease && !onPre) continue;
    const version = String(r.tag_name ?? '').replace(/^v/, '');
    const assets = Array.isArray(r.assets) ? r.assets : [];
    const url = (name) => assets.find((a) => a?.name === name)?.browser_download_url ?? null;
    const binary = url(assetName(version, { platform, arch }));
    if (!version || !binary) continue;
    if (best && compareVersions(version, best.version) <= 0) continue;
    best = { version, tag: r.tag_name, prerelease: !!r.prerelease, notes: String(r.body ?? ''), html_url: r.html_url ?? null, binary_url: binary, sums_url: url('SHA256SUMS') };
  }
  return best;
}

async function get(url, what) {
  let r;
  try {
    r = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(what === 'binary' ? 300_000 : 15_000) });
  } catch (e) {
    throw new UpgradeError('offline', T`no se pudo conectar con GitHub: ${e.cause?.message ?? e.message}`);
  }
  if (!r.ok) throw new UpgradeError('io_error', T`GitHub respondió ${r.status} (${url})`);
  return r;
}

const cacheFile = () => join(projectsDataDir(), 'upgrade-check.json');

/**
 * ¿Hay una versión más nueva? { current, latest, available, release, checked_at, binary }. latest es la versión de la
 * release elegida (o null). Guarda la respuesta un día en la carpeta de datos; force la vuelve a pedir.
 */
export async function checkUpgrade({ pre = false, force = false, current = VERSION, now = () => Date.now(), env = process.env, platform, arch } = {}) {
  const file = cacheFile();
  const url = releasesUrl(env);
  let cached = null;
  try { cached = JSON.parse(readFileSync(file, 'utf8')); } catch { /* no hay o está roto */ }
  let list, checkedAt;
  if (!force && cached?.url === url && Array.isArray(cached.list) && now() - Date.parse(cached.checked_at) < CHECK_EVERY_MS) {
    list = cached.list;
    checkedAt = cached.checked_at;
  } else {
    list = await (await get(url, 'list')).json().catch(() => null);
    if (!Array.isArray(list)) throw new UpgradeError('io_error', T('GitHub no devolvió una lista de releases'));
    // Solo lo que usa pickRelease: la respuesta entera de la API pesa cientos de KB.
    list = list.map((r) => ({ tag_name: r.tag_name, draft: r.draft, prerelease: r.prerelease, body: r.body, html_url: r.html_url,
      assets: (r.assets ?? []).map((a) => ({ name: a.name, browser_download_url: a.browser_download_url })) }));
    checkedAt = new Date(now()).toISOString();
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify({ url, checked_at: checkedAt, list }) + '\n');
    } catch { /* sin caché: se vuelve a pedir la próxima vez */ }
  }
  const release = pickRelease(list, { pre, current, platform, arch });
  return { current, latest: release?.version ?? null, available: !!release && compareVersions(release.version, current) > 0, release, checked_at: checkedAt, binary: IS_BINARY };
}

/** El sha256 de `name` en un SHA256SUMS ("<hash>  <nombre>" por línea), o null. */
export function sumFor(sums, name) {
  for (const line of String(sums).split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim());
    if (m && m[2] === name) return m[1].toLowerCase();
  }
  return null;
}

/**
 * Baja el binario de `release` (de pickRelease), lo verifica con SHA256SUMS y lo pone en `target` (el ejecutable que
 * corre). En Windows, el que corre no se puede pisar ni borrar pero sí renombrar: queda como <target>.old hasta la
 * próxima vez. En Linux y macOS, un rename sobre el archivo: el proceso que corre sigue con el viejo. Los procesos que
 * ya corren (el Inicio, los hubs) siguen con la versión anterior hasta reiniciarse. { version, path }.
 */
export async function installUpgrade(release, { target = process.execPath, platform = process.platform, binary = IS_BINARY } = {}) {
  if (!binary) throw new UpgradeError('not_binary', T('este scompass no es el binario: se actualiza con npm (npm install -g scope-compass) o con git pull en el repo'));
  if (!release?.binary_url) throw new UpgradeError('invalid_argument', T('no hay un binario para esta plataforma en la release'));
  if (!release.sums_url) throw new UpgradeError('invalid_file', T`la release ${release.tag} no trae SHA256SUMS: no se instala sin verificar`);
  const name = decodeURIComponent(release.binary_url.split('/').pop());
  const expected = sumFor(await (await get(release.sums_url, 'sums')).text(), name);
  if (!expected) throw new UpgradeError('invalid_file', T`SHA256SUMS no tiene ${name}`);
  const body = Buffer.from(await (await get(release.binary_url, 'binary')).arrayBuffer());
  const actual = createHash('sha256').update(body).digest('hex');
  if (actual !== expected) throw new UpgradeError('invalid_file', T`el binario bajado no coincide con SHA256SUMS (${actual.slice(0, 12)}… en lugar de ${expected.slice(0, 12)}…)`);
  const fresh = `${target}.new`;
  try {
    writeFileSync(fresh, body, { mode: 0o755 });
    if (platform !== 'win32') chmodSync(fresh, 0o755);
  } catch (e) {
    rmSync(fresh, { force: true });
    throw new UpgradeError('io_error', T`no se pudo escribir ${fresh}: ${e.message}`);
  }
  try {
    if (platform === 'win32') {
      // Los .old de actualizaciones anteriores, si ya nadie los usa; uno en uso hace que este se aparte con otro nombre.
      const base = basename(target);
      for (const f of readdirSync(dirname(target))) if (f.startsWith(`${base}.old`)) try { rmSync(join(dirname(target), f), { force: true }); } catch { /* corre todavía */ }
      const aside = existsSync(`${target}.old`) ? `${target}.old-${Date.now()}` : `${target}.old`;
      renameSync(target, aside);
      try {
        renameSync(fresh, target);
      } catch (e) {
        try { renameSync(aside, target); } catch { /* el anterior queda apartado, con el nombre de aside */ }
        throw e;
      }
    } else {
      renameSync(fresh, target);
    }
  } catch (e) {
    rmSync(fresh, { force: true });
    throw new UpgradeError('io_error', T`no se pudo reemplazar ${target}: ${e.message}`);
  }
  return { version: release.version, path: target };
}
