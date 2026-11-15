// Archivos del repo (14.1, spec §22): lo que git no ignora, su estado y cada archivo con su contenido, su diff y su
// historial. Solo lectura, y solo rutas que git lista.
import './isolate.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadValidators } from '../src/schema.js';
import { createJsonFilesStore } from '../src/store/json-files.js';
import { createServer, listen } from '../src/server.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'compass');
const V = loadValidators();
// Un PNG de 1×1.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
let dir, app, base;
const git = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { stdio: 'ignore' });
const get = async (u) => { const r = await fetch(base + u); return { status: r.status, type: r.headers.get('content-type'), body: r.headers.get('content-type')?.startsWith('application/json') ? await r.json() : Buffer.from(await r.arrayBuffer()) }; };
const q = (p) => encodeURIComponent(p);

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'scompass-files-'));
  await cp(FIXTURE, join(dir, 'compass'), { recursive: true });
  await mkdir(join(dir, 'src'));
  await mkdir(join(dir, 'art'));
  await writeFile(join(dir, 'src', 'player.gd'), 'extends Node\n\nfunc _ready():\n\tpass\n');
  await writeFile(join(dir, 'README.md'), '# Juego\n\nUn juego.\n');
  await writeFile(join(dir, 'art', 'icon.png'), PNG);
  await writeFile(join(dir, '.gitignore'), 'secreto.txt\n');
  await writeFile(join(dir, 'secreto.txt'), 'clave\n');
  git('init', '-q', '-b', 'main'); git('add', '-A'); git('commit', '-qm', 'base');
  await writeFile(join(dir, 'src', 'player.gd'), 'extends Node\n\nfunc _ready():\n\tprint("hola")\n');
  await writeFile(join(dir, 'src', 'enemy.gd'), 'extends Node\n');
  await symlink('/etc/hostname', join(dir, 'afuera'));
  app = createServer({ projectDir: dir, store: createJsonFilesStore(join(dir, 'compass'), { validators: V }), validators: V });
  base = `http://127.0.0.1:${(await listen(app, 0)).port}`;
});
after(async () => {
  await app?.close();
  await rm(dir, { recursive: true, force: true, maxRetries: 10 });
});

test('/api/files: lo que git no ignora, con su estado, la rama y los últimos commits', async () => {
  const { body } = await get('/api/files');
  assert.equal(body.repo, true);
  assert.equal(body.branch, 'main');
  for (const f of ['src/player.gd', 'src/enemy.gd', 'README.md', 'art/icon.png', '.gitignore', 'compass/config.json']) assert.ok(body.files.includes(f), f);
  assert.ok(!body.files.includes('secreto.txt'), 'el ignorado no aparece');
  assert.equal(body.status['src/player.gd'], 'modified');
  assert.equal(body.status['src/enemy.gd'], 'untracked');
  assert.deepEqual(body.commits.map((c) => c.subject), ['base']);
});

test('/api/files/file: código resaltado, markdown renderizado, imagen, enlace sin seguir; con estado e historial', async () => {
  const gd = (await get('/api/files/file?path=src/player.gd')).body;
  assert.deepEqual([gd.kind, gd.git, gd.lines, gd.commits.length], ['text', 'modified', 4, 1]);
  assert.match(gd.html, /<pre class="code language-gdscript"><code><span class="token keyword">extends<\/span>/);
  const md = (await get('/api/files/file?path=README.md')).body;
  assert.deepEqual([md.kind, md.git], ['markdown', 'clean']);
  assert.match(md.html, /<h1>Juego<\/h1>/);
  assert.equal((await get('/api/files/file?path=art/icon.png')).body.kind, 'image');
  const link = (await get('/api/files/file?path=afuera')).body;
  assert.deepEqual([link.kind, link.target, link.html], ['link', process.platform === 'win32' ? resolve('/etc/hostname') : '/etc/hostname', undefined]);
  const raw = await get('/api/files/raw?path=art/icon.png');
  assert.equal(raw.type, 'image/png');
  assert.deepEqual(raw.body, PNG);
  assert.equal((await get('/api/files/raw?path=src/player.gd')).status, 400);
});

test('/api/files/diff: contra HEAD; uno nuevo, entero; uno sin cambios, vacío', async () => {
  const d = (await get('/api/files/diff?path=src/player.gd')).body;
  assert.equal(d.git, 'modified');
  assert.match(d.diff, /^-\tpass\n\+\tprint\("hola"\)$/m);
  assert.equal((await get('/api/files/diff?path=src/enemy.gd')).body.diff, '--- /dev/null\n+++ b/src/enemy.gd\n@@ -0,0 +1,1 @@\n+extends Node\n');
  assert.deepEqual((await get('/api/files/diff?path=README.md')).body, { path: 'README.md', git: 'clean', diff: '' });
});

test('solo rutas que git lista: ni lo ignorado, ni ../, ni una carpeta', async () => {
  for (const p of ['secreto.txt', '../etc/passwd', 'src/../secreto.txt', '/etc/passwd', 'src', '']) {
    for (const route of ['file', 'diff', 'raw']) assert.equal((await get(`/api/files/${route}?path=${q(p)}`)).status, 404, `${route} ${p}`);
  }
});

test('el hub solo atiende pedidos a localhost o a una IP (DNS rebinding) y de su propia página (CSRF)', async () => {
  assert.equal((await app.inject({ url: '/api/files', headers: { host: 'malo.example:4711' } })).statusCode, 403);
  assert.equal((await app.inject({ url: '/api/files', headers: { host: 'localhost:4711' } })).statusCode, 200);
  assert.equal((await app.inject({ url: '/api/files', headers: { host: '192.168.1.5:4711' } })).statusCode, 200, 'la IP de la red, con --lan');
  // Otra página no escribe ni abre el WebSocket (un POST sin cuerpo bastaba para apagar el hub).
  const from = (origin, method = 'GET', url = '/api/files') => app.inject({ method, url, headers: { host: '127.0.0.1:4711', origin } });
  assert.equal((await from('http://malo.example', 'POST', '/api/shutdown')).statusCode, 403);
  assert.equal((await from('null', 'POST', '/api/shutdown')).statusCode, 403);
  assert.equal((await from('http://127.0.0.1:9999')).statusCode, 403, 'otro puerto es otra página');
  assert.equal((await app.inject({ url: '/ws', headers: { host: '127.0.0.1:4711', origin: 'http://malo.example', connection: 'upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==' } })).statusCode, 403, 'el WebSocket tampoco');
  assert.equal((await from('http://127.0.0.1:4711')).statusCode, 200, 'su propia página sí');
  const { createHomeServer } = await import('../src/home.js');
  const home = createHomeServer({ validators: V });
  try {
    assert.equal((await home.inject({ url: '/api/projects', headers: { host: 'malo.example' } })).statusCode, 403, 'el Inicio también');
    assert.equal((await home.inject({ method: 'POST', url: '/api/shutdown', headers: { origin: 'http://malo.example' } })).statusCode, 403);
    assert.equal((await home.inject({ url: '/api/projects' })).statusCode, 200);
  } finally { await home.close(); }
});

test('fuera de un repo: repo false y sin archivos', async () => {
  const out = await mkdtemp(join(tmpdir(), 'scompass-files-nogit-'));
  await cp(FIXTURE, join(out, 'compass'), { recursive: true });
  const other = createServer({ projectDir: out, store: createJsonFilesStore(join(out, 'compass'), { validators: V }), validators: V });
  try {
    assert.deepEqual((await other.inject({ url: '/api/files' })).json(), { repo: false, files: [], status: {}, commits: [] });
    assert.equal((await other.inject({ url: '/api/files/file?path=compass/config.json' })).statusCode, 404);
  } finally {
    await other.close();
    await rm(out, { recursive: true, force: true, maxRetries: 10 });
  }
});
