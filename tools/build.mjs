#!/usr/bin/env node
// Build interna de Scope Compass: deja en dist/ lo necesario para instalarlo sin clonar el repo.
//   scope-compass-<v>.tgz        hub + CLI + UI web + schemas (npm install -g <archivo>)
//   scompass-v<v>-<so>-<arq>     el mismo paquete como ejecutable, sin Node instalado (Node SEA, tools/sea-main.cjs);
//                                solo el de la plataforma donde corre el build (.exe en Windows)
//   scope-compass-addon-<v>.zip  addons/scope_compass/ para copiar a un proyecto de Godot
//   INSTALAR.md                  los pasos
// Uso: node tools/build.mjs   (desde cualquier carpeta del repo)
import { execFileSync, execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(REPO, 'dist');
const STAGE = join(DIST, 'stage');
const WIN = process.platform === 'win32';
const run = (cmd, args, cwd = REPO) => execFileSync(cmd, args, { cwd, encoding: 'utf8' }).trim();
// En Windows npm es npm.cmd, y Node solo lanza un .cmd a través de la consola: una línea, con los argumentos entre
// comillas (el nombre no: entre comillas, npm.cmd busca sus archivos en la carpeta actual).
const npm = (args, cwd) => (WIN
  ? execSync(['npm.cmd', ...args.map((a) => `"${a}"`)].join(' '), { cwd, encoding: 'utf8' }).trim()
  : run('npm', args, cwd));

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
// Sin scripts: postinstall solo sirve en el repo (el .gdignore de node_modules para Godot) y `npm test` necesita los
// tests, que no van. npm reciente además frena los scripts de una instalación global y avisa.
const staged = JSON.parse(readFileSync(join(STAGE, 'package.json'), 'utf8'));
delete staged.scripts;
writeFileSync(join(STAGE, 'package.json'), JSON.stringify(staged, null, 2) + '\n');
cpSync(join(REPO, 'LICENSE'), join(STAGE, 'LICENSE'));
cpSync(join(REPO, 'docs', 'instalar.md'), join(STAGE, 'README.md'));
const tgz = npm(['pack', '--silent', '--pack-destination', DIST], STAGE).split('\n').pop();

// Binario: el mismo paquete con sus dependencias de producción, en un solo payload que sea-main.cjs extrae.
npm(['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--silent'], STAGE);
const files = (function walk(d) {
  return readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
})(STAGE).filter((f) => !/[\\/]package-lock\.json$/.test(f)).sort();
const index = files.map((f) => [relative(STAGE, f).replaceAll('\\', '/'), readFileSync(f).length]);
const head = Buffer.from(JSON.stringify(index));
const len = Buffer.alloc(4);
len.writeUInt32LE(head.length);
const payload = gzipSync(Buffer.concat([len, head, ...files.map((f) => readFileSync(f))]), { level: 9 });
const SEA = join(DIST, 'sea');
mkdirSync(SEA);
writeFileSync(join(SEA, 'payload'), payload);
writeFileSync(join(SEA, 'meta.json'), JSON.stringify({ version: pkg.version, hash: createHash('sha256').update(payload).digest('hex').slice(0, 12) }));
const os = { linux: 'linux', win32: 'windows', darwin: 'macos' }[process.platform] ?? process.platform;
const bin = `scompass-v${pkg.version}-${os}-${process.arch}${WIN ? '.exe' : ''}`;
writeFileSync(join(SEA, 'sea.json'), JSON.stringify({
  main: join(REPO, 'tools', 'sea-main.cjs'),
  output: join(DIST, bin),
  disableExperimentalSEAWarning: true,
  useCodeCache: false,
  assets: { payload: join(SEA, 'payload'), 'meta.json': join(SEA, 'meta.json') },
}));
try {
  execFileSync(process.execPath, ['--build-sea', join(SEA, 'sea.json')], { stdio: ['ignore', 'ignore', 'inherit'] });
} catch (e) {
  console.error(`No se pudo armar el binario: hace falta Node 25.5 o más nuevo (--build-sea); este es ${process.version}.`);
  throw e;
}
// Que arranque de verdad, con su runtime en una carpeta aparte (no la caché del usuario).
const smoke = join(SEA, 'runtime');
execFileSync(join(DIST, bin), ['list', '--dir', REPO, '--milestone', 'm00'], { env: { ...process.env, SCOMPASS_RUNTIME_DIR: smoke }, stdio: 'ignore' });
rmSync(SEA, { recursive: true });
rmSync(STAGE, { recursive: true });

// Addon: solo los archivos versionados (sin .godot ni restos locales).
const zip = `scope-compass-addon-${pkg.version}.zip`;
const addonFiles = run('git', ['ls-files', 'addons/scope_compass']).split('\n');
// En Windows no hay zip: el tar.exe que trae Windows 10/11 (bsdtar) arma un .zip con -a.
if (WIN) execFileSync('tar.exe', ['-a', '-c', '-f', join(DIST, zip), ...addonFiles], { cwd: REPO });
else {
  // Sin zip instalado (Arch no lo trae), bsdtar de libarchive arma el mismo .zip.
  try { execFileSync('zip', ['-q', '-X', join(DIST, zip), ...addonFiles], { cwd: REPO }); }
  catch (e) { if (e.code !== 'ENOENT') throw e; execFileSync('bsdtar', ['-a', '-c', '-f', join(DIST, zip), ...addonFiles], { cwd: REPO }); }
}

cpSync(join(REPO, 'tools', 'install.sh'), join(DIST, 'install.sh')); // Linux: npm install -g y el lanzador del menú
writeFileSync(join(DIST, 'INSTALAR.md'), readFileSync(join(REPO, 'docs', 'instalar.md'), 'utf8')
  .replaceAll('<versión>', pkg.version) + `\n---\nBuild ${pkg.version} · commit ${commit}\n`);

console.log(`dist/${tgz}\ndist/${bin}\ndist/${zip}\ndist/install.sh\ndist/INSTALAR.md\n(${pkg.version}, commit ${commit})`);
