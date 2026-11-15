#!/usr/bin/env node
// Pasos de la release que corre .github/workflows/release.yml (spec §35, D47). Es Node y no sh para que ande igual
// en los runners de Linux y de Windows; lo que tiene lógica está en funciones exportadas, con tests en
// hub/test/release.test.js.
//
//   node tools/release.mjs bump <patch|minor|major|X.Y.Z>   sube la versión en hub/package.json (y su lock) y en
//                                                            addons/scope_compass/plugin.cfg; imprime la nueva
//   node tools/release.mjs changelog <X.Y.Z> [AAAA-MM-DD]   pasa «## [Unreleased]» de CHANGELOG.md a
//                                                            «## [X.Y.Z] - fecha» (falla si está vacía)
//   node tools/release.mjs notes <X.Y.Z>                     imprime las notas: la sección de esa versión del
//                                                            CHANGELOG más cómo instalar
//   node tools/release.mjs check <vX.Y.Z>                    falla si el tag, package.json y plugin.cfg no
//                                                            tienen la misma versión
//   node tools/release.mjs sums <carpeta>                    escribe SHA256SUMS con los archivos de la carpeta
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const PKG = ['hub', 'package.json'];
const LOCK = ['hub', 'package-lock.json'];
const PLUGIN = ['addons', 'scope_compass', 'plugin.cfg'];
const CHANGELOG = 'CHANGELOG.md';
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const UNRELEASED = 'Unreleased';

export class ReleaseError extends Error {}

// --- Versión ---

export function nextVersion(current, bump) {
  const m = SEMVER.exec(current);
  if (!m) throw new ReleaseError(`the current version is not X.Y.Z: '${current}'`);
  const [major, minor, patch] = m.slice(1).map(Number);
  if (bump === 'patch') return `${major}.${minor}.${patch + 1}`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  if (bump === 'major') return `${major + 1}.0.0`;
  const v = String(bump).replace(/^v/, '');
  if (!SEMVER.exec(v)) throw new ReleaseError(`expected patch, minor, major or X.Y.Z, got '${bump}'`);
  return v;
}

const PLUGIN_VERSION = /^version="([^"]*)"/m;

export function readVersions(repo = REPO) {
  return {
    hub: JSON.parse(readFileSync(join(repo, ...PKG), 'utf8')).version,
    addon: PLUGIN_VERSION.exec(readFileSync(join(repo, ...PLUGIN), 'utf8'))?.[1],
  };
}

// Reemplaza solo el campo "version" de nivel superior (y el del paquete raíz en el lock) sin reformatear el JSON.
function setJsonVersion(text, version, lock) {
  const data = JSON.parse(text);
  data.version = version;
  if (lock && data.packages?.['']) data.packages[''].version = version;
  const indent = /^\{\r?\n([ \t]+)"/.exec(text)?.[1] ?? '  ';
  return JSON.stringify(data, null, indent) + (text.endsWith('\n') ? '\n' : '');
}

export function writeVersion(repo, version) {
  const pkg = join(repo, ...PKG);
  writeFileSync(pkg, setJsonVersion(readFileSync(pkg, 'utf8'), version, false));
  const lock = join(repo, ...LOCK);
  try { writeFileSync(lock, setJsonVersion(readFileSync(lock, 'utf8'), version, true)); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  const cfg = join(repo, ...PLUGIN);
  const text = readFileSync(cfg, 'utf8');
  if (!PLUGIN_VERSION.test(text)) throw new ReleaseError(`no version="…" line in ${PLUGIN.join('/')}`);
  writeFileSync(cfg, text.replace(PLUGIN_VERSION, `version="${version}"`));
}

// La versión de hub/package.json manda: plugin.cfg tiene que coincidir (tools/build.mjs también lo exige).
export function bump(repo, how) {
  const { hub, addon } = readVersions(repo);
  if (hub !== addon) throw new ReleaseError(`versions differ: hub/package.json ${hub}, plugin.cfg ${addon}`);
  const next = nextVersion(hub, how);
  writeVersion(repo, next);
  return next;
}

export function checkVersions(repo, tag) {
  const m = /^v(\d+\.\d+\.\d+)$/.exec(tag ?? '');
  if (!m) throw new ReleaseError(`the tag must be vX.Y.Z, got '${tag}'`);
  const { hub, addon } = readVersions(repo);
  if (hub !== m[1] || addon !== m[1]) {
    throw new ReleaseError(`versions differ: tag ${tag}, hub/package.json ${hub}, addons/scope_compass/plugin.cfg ${addon}`);
  }
  return m[1];
}

// --- CHANGELOG.md (Keep a Changelog) ---

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Las definiciones de links del final ([Unreleased]: https://…/compare/v1.0.0...HEAD) no son parte de la última
// sección. Sin la bandera m: $ es el final del archivo, no el de cada línea.
const LINK_DEFS = /(?:^|\n)(?:\[[^\]\n]+\]:[ \t]*\S[^\n]*(?:\n|$))+\s*$/;

// Divide el texto en lo de antes del encabezado «## [nombre]», el encabezado, el cuerpo y lo de después.
export function findSection(text, name) {
  const header = new RegExp(`^## \\[${escape(name)}\\][^\\r\\n]*$`, 'm').exec(text);
  if (!header) return null;
  const bodyStart = header.index + header[0].length;
  const rest = text.slice(bodyStart);
  const next = /^## /m.exec(rest);
  let bodyEnd = next ? bodyStart + next.index : text.length;
  if (!next) {
    const defs = LINK_DEFS.exec(rest);
    if (defs) bodyEnd = bodyStart + defs.index + (defs[0].startsWith('\n') ? 1 : 0);
  }
  return { before: text.slice(0, header.index), header: header[0], body: text.slice(bodyStart, bodyEnd), after: text.slice(bodyEnd) };
}

export function changelogSection(text, name) {
  const s = findSection(text, name);
  if (!s) throw new ReleaseError(`${CHANGELOG} has no '## [${name}]' section`);
  return s.body.trim();
}

// Pasa Unreleased a la versión nueva y deja un Unreleased vacío arriba. Si al final están los links de comparación
// de Keep a Changelog, los actualiza también.
export function releaseChangelog(text, version, date) {
  const s = findSection(text, UNRELEASED);
  if (!s) throw new ReleaseError(`${CHANGELOG} has no '## [${UNRELEASED}]' section`);
  if (!s.body.trim()) throw new ReleaseError(`the '## [${UNRELEASED}]' section of ${CHANGELOG} is empty: add the release's changes there first`);
  if (findSection(text, version)) throw new ReleaseError(`${CHANGELOG} already has a '## [${version}]' section`);
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  let after = s.after.replace(/^\s+/, '');
  const link = new RegExp(`^\\[${UNRELEASED}\\]:[ \\t]*(\\S+)/compare/(\\S+)\\.\\.\\.HEAD[ \\t]*$`, 'm').exec(after);
  if (link) {
    const [line, base, prev] = link;
    after = after.replace(line, `[${UNRELEASED}]: ${base}/compare/v${version}...HEAD${nl}[${version}]: ${base}/compare/${prev}...v${version}`);
  }
  const body = s.body.trim();
  return `${s.before}${s.header}${nl}${nl}## [${version}] - ${date}${nl}${nl}${body}${nl}${after ? nl + after : ''}`;
}

export const installText = (v) => [
  '---',
  '',
  `**Install.** \`scompass-v${v}-linux-x64\` and \`scompass-v${v}-windows-x64.exe\` are the hub and the CLI as a single`
    + ' executable that needs no Node: run it once (on Linux, `chmod +x` it first) and the Godot dock and'
    + ' `scompass mcp install` find it without the PATH; to type `scompass` in a terminal, put it in your PATH as'
    + ' `scompass` (`scompass.exe` on Windows).'
    + ' For the Godot dock,'
    + ` unzip \`scope-compass-addon-v${v}.zip\` at the root of your project (it creates \`addons/scope_compass/\`) and`
    + ' enable **Scope Compass** in Project Settings → Plugins. `SHA256SUMS` has the checksums of every file.',
].join('\n');

export function releaseNotes(text, version) {
  return `${changelogSection(text, version)}\n\n${installText(version)}\n`;
}

// --- README del zip del addon ---

// Los links relativos del README apuntan a archivos del repo que no viajan en el zip: pasan a GitHub, fijados al tag.
// Los que van en el zip (keep), los absolutos y los que salen del repo (../) quedan como están.
export function absoluteLinks(text, slug, tag, keep = []) {
  return text.replace(/(\]\(|src=")([^)"#\s][^)"\s]*)/g, (all, prefix, target) => {
    const path = target.split('#')[0];
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/') || target.startsWith('../') || keep.includes(path)) return all;
    const image = /\.(png|jpe?g|gif|svg|webp)$/i.test(path);
    return `${prefix}${image ? `https://raw.githubusercontent.com/${slug}/${tag}` : `https://github.com/${slug}/blob/${tag}`}/${target.replace(/^\.\//, '')}`;
  });
}

// --- SHA256SUMS ---

export function sha256sums(dir) {
  return readdirSync(dir)
    .filter((f) => f !== 'SHA256SUMS' && !f.startsWith('.') && statSync(join(dir, f)).isFile())
    .sort()
    .map((f) => `${createHash('sha256').update(readFileSync(join(dir, f))).digest('hex')}  ${f}\n`)
    .join('');
}

// --- CLI ---

const USAGE = `usage: node tools/release.mjs <command>
  bump <patch|minor|major|X.Y.Z>   bump hub/package.json (and its lock) and plugin.cfg; prints the new version
  changelog <X.Y.Z> [YYYY-MM-DD]   turn '## [Unreleased]' of CHANGELOG.md into '## [X.Y.Z] - date'
  notes <X.Y.Z>                    print the release notes: that CHANGELOG section plus how to install
  check <vX.Y.Z>                   fail unless the tag, hub/package.json and plugin.cfg have the same version
  sums <dir>                       write <dir>/SHA256SUMS with the files of <dir>`;

function exact(v) {
  const s = String(v ?? '').replace(/^v/, '');
  if (!SEMVER.test(s)) throw new ReleaseError(`expected a version X.Y.Z, got '${v ?? ''}'`);
  return s;
}

function main([cmd, arg, extra]) {
  const changelog = join(REPO, CHANGELOG);
  switch (cmd) {
    case 'bump':
      console.log(bump(REPO, arg));
      return;
    case 'changelog':
      writeFileSync(changelog, releaseChangelog(readFileSync(changelog, 'utf8'), exact(arg), extra ?? new Date().toISOString().slice(0, 10)));
      return;
    case 'notes':
      process.stdout.write(releaseNotes(readFileSync(changelog, 'utf8'), exact(arg)));
      return;
    case 'check':
      console.log(checkVersions(REPO, arg));
      return;
    case 'sums': {
      if (!arg) break;
      const sums = sha256sums(arg);
      writeFileSync(join(arg, 'SHA256SUMS'), sums);
      process.stdout.write(sums);
      return;
    }
  }
  console.error(USAGE);
  process.exit(2);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try { main(process.argv.slice(2)); }
  catch (e) {
    if (!(e instanceof ReleaseError) && e.code !== 'ENOENT') throw e;
    console.error(`release: ${e.message}`);
    process.exit(1);
  }
}
