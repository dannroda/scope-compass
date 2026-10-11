// Aviso de cambios sin commitear (4.4): el hub cuenta compass/ y el export con git status, lo publica después de cada
// escritura y lo vuelve a mirar mientras haya algo pendiente (un commit no toca compass/).
import './isolate.js';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadValidators } from '../src/schema.js';
import { createJsonFilesStore } from '../src/store/json-files.js';
import { createServer, listen } from '../src/server.js';
import { boardStatus } from '../src/git.js';
import { run } from '../src/cli.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'compass');
const V = loadValidators();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let dir, app, base, events;
const git = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { stdio: 'ignore' });

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'scompass-git-'));
  await cp(FIXTURE, join(dir, 'compass'), { recursive: true });
  git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'base');
  app = createServer({ projectDir: dir, store: createJsonFilesStore(join(dir, 'compass'), { validators: V }), validators: V, watch: true, exportMd: true, gitPollMs: 100 });
  events = [];
  app.events.on('event', (e) => events.push(e));
  const { port } = await listen(app, 0);
  base = `http://127.0.0.1:${port}`;
});
afterEach(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true, maxRetries: 10 });
});
const until = async (fn, ms = 3000) => { const t0 = Date.now(); while (!fn() && Date.now() - t0 < ms) await sleep(20); return fn(); };

test('boardStatus: fuera de un repo, repo false; en uno, cuenta compass/ y el export', async () => {
  const out = await mkdtemp(join(tmpdir(), 'scompass-nogit-'));
  try { assert.deepEqual(await boardStatus(out, null), { repo: false, uncommitted: 0, files: [] }); } finally { await rm(out, { recursive: true, force: true, maxRetries: 10 }); }
  assert.deepEqual(await boardStatus(dir, { export_md: 'docs/tareas.md' }), { repo: true, uncommitted: 0, files: [] });
});

test('una escritura publica `git` con los archivos; al commitear vuelve a 0 sola', async () => {
  assert.deepEqual(await (await fetch(base + '/api/git')).json(), { repo: true, uncommitted: 0, files: [] });
  await fetch(base + '/api/tasks/m1-04', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'todo' }) });
  assert.ok(await until(() => events.some((e) => e.type === 'git' && e.uncommitted === 2)), JSON.stringify(events.filter((e) => e.type === 'git')));
  const ev = events.filter((e) => e.type === 'git').at(-1);
  assert.deepEqual(ev.files.sort(), ['compass/tasks/m1-04.json', 'docs/tareas.md']);
  git('add', '-A'); git('commit', '-qm', 'tablero');
  assert.ok(await until(() => events.filter((e) => e.type === 'git').at(-1).uncommitted === 0), 'no se enteró del commit');
});

test('scompass list lo recuerda al final; --json lo trae como uncommitted', async () => {
  let out = '';
  const io = { cwd: dir, out: { write: (s) => { out += s; } }, err: { write() {} } };
  await run(['--direct', 'move', 'm1-04', 'todo'], { ...io, out: { write() {} } });
  assert.equal(await run(['--direct', 'list'], io), 0);
  assert.match(out, /\n2 archivos del tablero sin commitear \(git status -- compass docs\/tareas\.md\)\n$/);
  out = '';
  await run(['--direct', 'list', '--json'], io);
  assert.equal(JSON.parse(out).uncommitted, 2);
});

// --- Estado de git de los documentos (12.3) ---
const GDD = '# Juego\n<!-- id: juego -->\n\n## Combate\n<!-- id: combate -->\n\nGolpes.\n\n## Cámara\n<!-- id: camara -->\n\nCenital.\n';
async function withGdd() {
  const { readFile, writeFile } = await import('node:fs/promises');
  await writeFile(join(dir, 'gdd.md'), GDD);
  const cfg = join(dir, 'compass', 'config.json');
  await writeFile(cfg, JSON.stringify({ ...JSON.parse(await readFile(cfg, 'utf8')), docs: [{ alias: 'gdd', path: 'gdd.md' }, { alias: 'docs', path: 'docs/**/*.md' }] }, null, 2) + '\n');
  git('add', '-A'); git('commit', '-qm', 'gdd');
}
const cli = async (...argv) => {
  let out = '';
  const code = await run(['--direct', ...argv], { cwd: dir, out: { write: (s) => { out += s; } }, err: { write() {} } });
  return { code, out };
};

test('docsStatus, docLog y docDiff: modificado, nuevo sin seguir, limpio tras commitear; sin repo, repo false', async () => {
  const { writeFile, mkdir } = await import('node:fs/promises');
  const { docsStatus, docLog, docDiff } = await import('../src/git.js');
  await withGdd();
  assert.deepEqual(await docsStatus(dir), { repo: true, status: {} });
  await writeFile(join(dir, 'gdd.md'), GDD.replace('Cenital.', 'Cenital, con zoom.'));
  await mkdir(join(dir, 'docs'), { recursive: true });
  await writeFile(join(dir, 'docs', 'enemigos.md'), '# Enemigos\n');
  assert.deepEqual((await docsStatus(dir)).status, { 'gdd.md': 'modified', 'docs/enemigos.md': 'untracked' });
  assert.match(await docDiff(dir, 'gdd.md'), /^-Cenital\.\n\+Cenital, con zoom\.$/m);
  assert.equal(await docDiff(dir, 'docs/enemigos.md', { untracked: true, text: '# Enemigos\n' }), '--- /dev/null\n+++ b/docs/enemigos.md\n@@ -0,0 +1,1 @@\n+# Enemigos\n');
  git('add', '-A'); git('commit', '-qm', 'Cámara con zoom');
  assert.deepEqual((await docsStatus(dir)).status, {});
  assert.deepEqual((await docLog(dir, 'gdd.md')).map((c) => c.subject), ['Cámara con zoom', 'gdd']);
  assert.match((await docLog(dir, 'gdd.md'))[0].hash, /^[0-9a-f]{7,}$/);
  const out = await mkdtemp(join(tmpdir(), 'scompass-nogit-'));
  try { assert.deepEqual(await docsStatus(out), { repo: false, status: {} }); } finally { await rm(out, { recursive: true, force: true, maxRetries: 10 }); }
});

test('doc status y doc diff: lo marca modificado con el diff y las secciones; tras commitear, limpio con el commit nuevo', async () => {
  const { writeFile } = await import('node:fs/promises');
  await withGdd();
  await writeFile(join(dir, 'gdd.md'), GDD.replace('Cenital.', 'Cenital, con zoom.'));
  let r = await cli('doc', 'status');
  assert.match(r.out, /^gdd +gdd\.md {2}modificado · [0-9a-f]+ \d{4}-\d\d-\d\d t: gdd$/m);
  r = await cli('doc', 'diff', 'gdd');
  assert.match(r.out, /\+Cenital, con zoom\./);
  assert.match(r.out, /Secciones tocadas: juego, camara\n$/);
  const j = JSON.parse((await cli('doc', 'diff', 'gdd', '--json')).out);
  assert.deepEqual([j.git, j.sections], ['modified', ['juego', 'camara']]);
  git('add', '-A'); git('commit', '-qm', 'Cámara con zoom');
  const s = JSON.parse((await cli('doc', 'status', '--json')).out);
  assert.equal(s.repo, true);
  assert.deepEqual(s.docs.map((d) => [d.alias, d.git, d.last_commit.subject]), [['gdd', 'clean', 'Cámara con zoom']]);
  assert.match((await cli('doc', 'diff', 'gdd')).out, /gdd\.md: sin cambios contra HEAD/);
});

test('API: git en /api/docs, /diff y /log; docs_git avisa al editar y al commitear', async () => {
  const { writeFile } = await import('node:fs/promises');
  await withGdd();
  const get = async (u) => (await fetch(base + u)).json();
  // El hub de beforeEach armó su watcher sin documentos en la config: uno nuevo, que ya los ve.
  await app.close();
  app = createServer({ projectDir: dir, store: createJsonFilesStore(join(dir, 'compass'), { validators: V }), validators: V, watch: true, gitPollMs: 100 });
  events = [];
  app.events.on('event', (e) => events.push(e));
  base = `http://127.0.0.1:${(await listen(app, 0)).port}`;
  assert.deepEqual((await get('/api/docs')).docs.map((d) => [d.alias, d.git]), [['gdd', 'clean']]);
  await sleep(500); // la primera mirada solo toma la referencia
  await writeFile(join(dir, 'gdd.md'), GDD.replace('Golpes.', 'Golpes y bloqueos.'));
  assert.ok(await until(() => events.some((e) => e.type === 'docs_git' && e.docs.gdd === 'modified')), JSON.stringify(events));
  assert.equal((await get('/api/docs/gdd')).git, 'modified');
  const diff = await get('/api/docs/gdd/diff');
  assert.deepEqual([diff.git, diff.sections], ['modified', ['juego', 'combate']]);
  assert.match(diff.diff, /\+Golpes y bloqueos\./);
  git('add', '-A'); git('commit', '-qm', 'Bloqueos');
  assert.ok(await until(() => events.filter((e) => e.type === 'docs_git').at(-1).docs.gdd === 'clean'), 'no se enteró del commit');
  assert.deepEqual((await get('/api/docs/gdd/log')).commits.map((c) => c.subject), ['Bloqueos', 'gdd']);
  assert.deepEqual((await get('/api/docs/gdd/diff')).diff, '');
});
