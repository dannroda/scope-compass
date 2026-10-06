// Aviso de cambios sin commitear (4.4): el hub cuenta compass/ y el export con git status, lo publica después de cada
// escritura y lo vuelve a mirar mientras haya algo pendiente (un commit no toca compass/).
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
