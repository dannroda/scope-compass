#!/usr/bin/env node
// Build interna de Scope Compass: deja en dist/ lo necesario para instalarlo sin clonar el repo.
//   scope-compass-<v>.tgz        hub + CLI + UI web + schemas (npm install -g <archivo>)
//   scope-compass-addon-<v>.zip  addons/scope_compass/ para copiar a un proyecto de Godot
//   INSTALAR.md                  los pasos
// Uso: node tools/build.mjs   (desde cualquier carpeta del repo)
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(REPO, 'dist');
const STAGE = join(DIST, 'stage');
const run = (cmd, args, cwd = REPO) => execFileSync(cmd, args, { cwd, encoding: 'utf8' }).trim();

const pkg = JSON.parse(readFileSync(join(REPO, 'hub', 'package.json'), 'utf8'));
const pluginVersion = /^version="([^"]+)"/m.exec(readFileSync(join(REPO, 'addons', 'scope_compass', 'plugin.cfg'), 'utf8'))?.[1];
if (pluginVersion !== pkg.version) {
  console.error(`Las versiones no coinciden: hub/package.json ${pkg.version}, addons/scope_compass/plugin.cfg ${pluginVersion}`);
  process.exit(1);
}
const dirty = run('git', ['status', '--porcelain']);
const commit = run('git', ['rev-parse', '--short', 'HEAD']) + (dirty ? '+cambios sin commitear' : '');

rmSync(DIST, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
writeFileSync(join(DIST, '.gdignore'), ''); // Godot no escanea dist/

// Hub: lo que lista "files" de package.json, con web/ y schema/ (que en el repo están en la raíz) adentro.
for (const d of ['bin', 'src', 'templates', 'assets']) cpSync(join(REPO, 'hub', d), join(STAGE, d), { recursive: true });
for (const d of ['web', 'schema']) cpSync(join(REPO, d), join(STAGE, d), { recursive: true });
for (const f of ['package.json', 'package-lock.json']) cpSync(join(REPO, 'hub', f), join(STAGE, f));
cpSync(join(REPO, 'LICENSE'), join(STAGE, 'LICENSE'));
cpSync(join(REPO, 'docs', 'instalar.md'), join(STAGE, 'README.md'));
const tgz = run('npm', ['pack', '--silent', '--pack-destination', DIST], STAGE).split('\n').pop();
rmSync(STAGE, { recursive: true });

// Addon: solo los archivos versionados (sin .godot ni restos locales).
const zip = `scope-compass-addon-${pkg.version}.zip`;
const files = run('git', ['ls-files', 'addons/scope_compass']).split('\n');
execFileSync('zip', ['-q', '-X', join(DIST, zip), ...files], { cwd: REPO });

writeFileSync(join(DIST, 'INSTALAR.md'), readFileSync(join(REPO, 'docs', 'instalar.md'), 'utf8')
  .replaceAll('<versión>', pkg.version) + `\n---\nBuild ${pkg.version} · commit ${commit}\n`);

console.log(`dist/${tgz}\ndist/${zip}\ndist/INSTALAR.md\n(${pkg.version}, commit ${commit})`);
