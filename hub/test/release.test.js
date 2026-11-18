// Pasos de la release (tools/release.mjs, spec §35, D47): subir la versión, el CHANGELOG, las notas, los checksums.
import './isolate.js';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  absoluteLinks, bump, changelogSection, checkVersions, nextVersion, readVersions, releaseChangelog, releaseNotes,
  ReleaseError, sha256sums,
} from '../../tools/release.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'tools', 'release.mjs');
const REAL = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let repo;

function fakeRepo(hub = '0.1.0', addon = hub, claude = hub) {
  mkdirSync(join(repo, 'hub'), { recursive: true });
  mkdirSync(join(repo, 'addons', 'scope_compass'), { recursive: true });
  mkdirSync(join(repo, 'claude-plugin', '.claude-plugin'), { recursive: true });
  writeFileSync(join(repo, 'claude-plugin', '.claude-plugin', 'plugin.json'), `{\n  "name": "scope-compass",\n  "version": "${claude}",\n  "license": "MIT"\n}\n`);
  writeFileSync(join(repo, 'hub', 'package.json'), `{\n  "name": "scope-compass",\n  "version": "${hub}",\n  "private": true\n}\n`);
  writeFileSync(join(repo, 'hub', 'package-lock.json'), JSON.stringify({
    name: 'scope-compass', version: hub, lockfileVersion: 3,
    packages: { '': { name: 'scope-compass', version: hub }, 'node_modules/ajv': { version: '8.20.0' } },
  }, null, 2) + '\n');
  writeFileSync(join(repo, 'addons', 'scope_compass', 'plugin.cfg'), `[plugin]\n\nname="Scope Compass"\nversion="${addon}"\nscript="scope_compass.gd"\n`);
}

beforeEach(() => { repo = mkdtempSync(join(tmpdir(), 'scompass-release-')); });
afterEach(() => rmSync(repo, { recursive: true, force: true }));

const CHANGELOG = `# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Releases with a binary for Linux and Windows.

### Fixed

- The dock no longer hangs.

## [0.1.0] - 2026-11-01

### Added

- First version.

[Unreleased]: https://github.com/dannroda/scope-compass/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/dannroda/scope-compass/releases/tag/v0.1.0
`;

test('nextVersion: patch, minor, major y una versión exacta (con o sin v)', () => {
  assert.equal(nextVersion('0.1.9', 'patch'), '0.1.10');
  assert.equal(nextVersion('0.1.9', 'minor'), '0.2.0');
  assert.equal(nextVersion('0.1.9', 'major'), '1.0.0');
  assert.equal(nextVersion('0.1.9', '2.3.4'), '2.3.4');
  assert.equal(nextVersion('0.1.9', 'v2.3.4'), '2.3.4');
  assert.throws(() => nextVersion('0.1.9', 'mayor'), ReleaseError);
  assert.throws(() => nextVersion('0.1.9', '1.2'), ReleaseError);
  assert.throws(() => nextVersion('0.1', 'patch'), ReleaseError);
});

test('bump: sube package.json, su lock, plugin.cfg y el plugin de Claude Code sin tocar el resto', () => {
  fakeRepo();
  assert.equal(bump(repo, 'minor'), '0.2.0');
  assert.deepEqual(readVersions(repo), { hub: '0.2.0', addon: '0.2.0', claude: '0.2.0' });
  assert.equal(readFileSync(join(repo, 'claude-plugin', '.claude-plugin', 'plugin.json'), 'utf8'), '{\n  "name": "scope-compass",\n  "version": "0.2.0",\n  "license": "MIT"\n}\n');
  assert.equal(readFileSync(join(repo, 'hub', 'package.json'), 'utf8'), '{\n  "name": "scope-compass",\n  "version": "0.2.0",\n  "private": true\n}\n');
  const lock = JSON.parse(readFileSync(join(repo, 'hub', 'package-lock.json'), 'utf8'));
  assert.equal(lock.version, '0.2.0');
  assert.equal(lock.packages[''].version, '0.2.0');
  assert.equal(lock.packages['node_modules/ajv'].version, '8.20.0');
  assert.equal(readFileSync(join(repo, 'addons', 'scope_compass', 'plugin.cfg'), 'utf8'), '[plugin]\n\nname="Scope Compass"\nversion="0.2.0"\nscript="scope_compass.gd"\n');
});

test('bump: con versiones distintas en el hub y el addon no sube nada', () => {
  fakeRepo('0.1.0', '0.1.1');
  assert.throws(() => bump(repo, 'patch'), /versions differ/);
  assert.deepEqual(readVersions(repo), { hub: '0.1.0', addon: '0.1.1', claude: '0.1.0' });
  fakeRepo('0.1.0', '0.1.0', '0.0.9');
  assert.throws(() => bump(repo, 'patch'), /plugin\.json 0\.0\.9/);
});

test('checkVersions: el tag, package.json y plugin.cfg tienen que coincidir', () => {
  fakeRepo('1.2.3');
  assert.equal(checkVersions(repo, 'v1.2.3'), '1.2.3');
  assert.throws(() => checkVersions(repo, 'v1.2.4'), /tag v1\.2\.4, hub\/package\.json 1\.2\.3/);
  assert.throws(() => checkVersions(repo, '1.2.3'), /must be vX\.Y\.Z/);
  fakeRepo('1.2.3', '1.2.2');
  assert.throws(() => checkVersions(repo, 'v1.2.3'), /plugin\.cfg 1\.2\.2/);
  fakeRepo('1.2.3', '1.2.3', '1.2.0');
  assert.throws(() => checkVersions(repo, 'v1.2.3'), /claude-plugin\/\.claude-plugin\/plugin\.json 1\.2\.0/);
});

test('releaseChangelog: Unreleased pasa a la versión con fecha, queda vacío arriba y los links de comparación se actualizan', () => {
  const out = releaseChangelog(CHANGELOG, '0.2.0', '2026-11-14');
  assert.equal(out, `# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.2.0] - 2026-11-14

### Added

- Releases with a binary for Linux and Windows.

### Fixed

- The dock no longer hangs.

## [0.1.0] - 2026-11-01

### Added

- First version.

[Unreleased]: https://github.com/dannroda/scope-compass/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/dannroda/scope-compass/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/dannroda/scope-compass/releases/tag/v0.1.0
`);
  assert.equal(changelogSection(out, 'Unreleased'), '');
});

test('releaseChangelog: falla con Unreleased vacío, sin Unreleased o con la versión ya en el archivo', () => {
  const empty = '# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - 2026-11-01\n\n- First.\n';
  assert.throws(() => releaseChangelog(empty, '0.2.0', '2026-11-14'), /Unreleased.*is empty/);
  assert.throws(() => releaseChangelog('# Changelog\n\n## [Unreleased]\n\n[Unreleased]: https://x/compare/v0.1.0...HEAD\n', '0.2.0', '2026-11-14'), /is empty/);
  assert.throws(() => releaseChangelog('# Changelog\n', '0.2.0', '2026-11-14'), /no '## \[Unreleased\]'/);
  assert.throws(() => releaseChangelog(CHANGELOG, '0.1.0', '2026-11-14'), /already has/);
});

test('releaseChangelog: el primer release, sin versiones anteriores ni links, y con CRLF', () => {
  const first = '# Changelog\r\n\r\n## [Unreleased]\r\n\r\n### Added\r\n\r\n- Everything.\r\n';
  assert.equal(releaseChangelog(first, '0.1.0', '2026-11-14'),
    '# Changelog\r\n\r\n## [Unreleased]\r\n\r\n## [0.1.0] - 2026-11-14\r\n\r\n### Added\r\n\r\n- Everything.\r\n');
});

test('releaseNotes: la sección de la versión, sin los links del final, más cómo instalar', () => {
  const out = releaseChangelog(CHANGELOG, '0.2.0', '2026-11-14');
  const notes = releaseNotes(out, '0.2.0');
  assert.ok(notes.startsWith('### Added\n\n- Releases with a binary for Linux and Windows.\n\n### Fixed\n\n- The dock no longer hangs.\n\n---\n'));
  assert.match(notes, /scompass-v0\.2\.0-linux-x64/);
  assert.match(notes, /scompass-v0\.2\.0-windows-x64\.exe/);
  assert.match(notes, /scope-compass-addon-v0\.2\.0\.zip/);
  assert.match(notes, /SHA256SUMS/);
  assert.doesNotMatch(notes, /0\.1\.0|compare/);
  // Cómo instalar es un comando que baja el instalador del repo (D63), solo la primera vez; sin el canal beta.
  assert.match(notes, /only the first time/);
  assert.ok(notes.includes('`irm https://raw.githubusercontent.com/dannroda/scope-compass/main/tools/install.ps1 | iex`'));
  assert.ok(notes.includes('`curl -fsSL https://raw.githubusercontent.com/dannroda/scope-compass/main/tools/install.sh | sh`'));
  assert.doesNotMatch(notes, /SCOMPASS_CHANNEL|beta/);
  // En una pre-release, los comandos instalan del canal beta.
  const pre = releaseNotes(out, '0.2.0', { prerelease: true });
  assert.ok(pre.includes("`$env:SCOMPASS_CHANNEL = 'beta'; irm https://raw.githubusercontent.com/dannroda/scope-compass/main/tools/install.ps1 | iex`"));
  assert.ok(pre.includes('`curl -fsSL https://raw.githubusercontent.com/dannroda/scope-compass/main/tools/install.sh | SCOMPASS_CHANNEL=beta sh`'));
  assert.match(pre, /scompass upgrade --channel beta/);
  // La última sección no se lleva las definiciones de links del final del archivo.
  assert.equal(changelogSection(out, '0.1.0'), '### Added\n\n- First version.');
  assert.throws(() => releaseNotes(out, '0.3.0'), /no '## \[0\.3\.0\]' section/);
});

test('absoluteLinks: los links relativos van a GitHub en el tag; los externos, anclas y los que viajan en el zip quedan', () => {
  const md = '[up](../otro) [spec](docs/spec.md#35) ![shot](./docs/img/board.png) <img src="docs/a.svg"> [web](https://x.y/z) [top](#install) [lic](LICENSE)';
  assert.equal(absoluteLinks(md, 'dannroda/scope-compass', 'v0.2.0', ['LICENSE']),
    '[up](../otro) [spec](https://github.com/dannroda/scope-compass/blob/v0.2.0/docs/spec.md#35) '
    + '![shot](https://raw.githubusercontent.com/dannroda/scope-compass/v0.2.0/docs/img/board.png) '
    + '<img src="https://raw.githubusercontent.com/dannroda/scope-compass/v0.2.0/docs/a.svg"> [web](https://x.y/z) [top](#install) [lic](LICENSE)');
});

test('sha256sums: un renglón por archivo, en orden, como sha256sum (sin SHA256SUMS ni ocultos)', () => {
  writeFileSync(join(repo, 'b.zip'), 'zip');
  writeFileSync(join(repo, 'a-linux-x64'), 'bin');
  writeFileSync(join(repo, 'SHA256SUMS'), 'viejo');
  writeFileSync(join(repo, '.gdignore'), '');
  mkdirSync(join(repo, 'carpeta'));
  const h = (s) => createHash('sha256').update(s).digest('hex');
  assert.equal(sha256sums(repo), `${h('bin')}  a-linux-x64\n${h('zip')}  b.zip\n`);
});

test('CLI: un comando que no existe muestra el uso, los errores salen sin stack y sums escribe el archivo', () => {
  const r = spawnSync(process.execPath, [SCRIPT, 'nada'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: node tools\/release\.mjs/);
  const bad = spawnSync(process.execPath, [SCRIPT, 'check', 'v0.0.0-no'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /^release: the tag must be vX\.Y\.Z/);
  // sums sobre una carpeta escribe el archivo.
  writeFileSync(join(repo, 'x'), 'x');
  execFileSync(process.execPath, [SCRIPT, 'sums', repo]);
  assert.equal(readFileSync(join(repo, 'SHA256SUMS'), 'utf8'), `${createHash('sha256').update('x').digest('hex')}  x\n`);
});

// §40: el plugin de Claude Code del repo sale con la versión de Scope Compass, y su skill tiene name y description.
test('el repo: hub, addon y plugin de Claude Code con la misma versión; la skill con su frontmatter', () => {
  const { hub } = readVersions(REAL);
  assert.equal(checkVersions(REAL, `v${hub}`), hub);
  const skill = readFileSync(join(REAL, 'claude-plugin', 'skills', 'scope-compass', 'SKILL.md'), 'utf8');
  const front = /^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1] ?? '';
  assert.match(front, /^name: scope-compass$/m);
  assert.match(front, /^description: .{40,}$/m);
  const market = JSON.parse(readFileSync(join(REAL, '.claude-plugin', 'marketplace.json'), 'utf8'));
  assert.deepEqual(market.plugins.map((p) => [p.name, p.source]), [['scope-compass', './claude-plugin']]);
});

// install.ps1 corre con `irm … | iex` en PowerShell 5.1 (D63): un BOM al principio rompe iex, y como -File sin BOM se
// lee en ANSI antes de volver a leerse como UTF-8, ningún carácter puede tener en UTF-8 un byte que en Windows-1252 sea
// una comilla (0x82, 0x84, 0x91-0x94: el — y la → los tienen) o el script ni se llega a parsear.
test('install.ps1: sin BOM y sin caracteres que en ANSI se vuelvan comillas', () => {
  const bytes = readFileSync(join(REAL, 'tools', 'install.ps1'));
  assert.notDeepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'sin BOM');
  const bad = [...new Set(bytes.toString('utf8'))].filter((c) => [...Buffer.from(c)].some((b) => [0x82, 0x84, 0x91, 0x92, 0x93, 0x94].includes(b)));
  assert.deepEqual(bad, []);
});
