import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as netServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadValidators } from '../src/schema.js';
import { createJsonFilesStore, StoreError } from '../src/store/json-files.js';
import { createServer, listen, VERSION } from '../src/server.js';
import { run } from '../src/cli.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'compass');
const V = loadValidators();
let dir, store;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'scompass-'));
  await cp(FIXTURE, join(dir, 'compass'), { recursive: true });
  store = createJsonFilesStore(join(dir, 'compass'), { validators: V });
});
afterEach(() => rm(dir, { recursive: true, force: true, maxRetries: 10 }));

test('GET /api/health devuelve versión y proyecto', async () => {
  const app = createServer({ projectDir: dir, store });
  const r = await app.inject('/api/health');
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { ok: true, name: 'scope-compass', version: VERSION, project: dir, pid: process.pid });
  await app.close();
});

test('rutas inexistentes y errores del store usan {error: {code, message}}', async () => {
  const app = createServer({ projectDir: dir, store });
  const current = { id: 'x', doc: { title: 't' }, etag: 'e' };
  const codes = { invalid_argument: 400, not_found: 404, conflict: 409, invalid_file: 409, io_error: 500 };
  app.get('/boom/:code', async (req) => { throw new StoreError(req.params.code, 'mal', { current }); });
  app.get('/crash', async () => { throw new Error('inesperado'); });

  const nf = await app.inject('/api/nada');
  assert.equal(nf.statusCode, 404);
  assert.equal(nf.json().error.code, 'not_found');
  for (const [code, status] of Object.entries(codes)) {
    const r = await app.inject(`/boom/${code}`);
    assert.equal(r.statusCode, status, code);
    assert.deepEqual(r.json().error, { code, message: 'mal', current });
  }
  const c = await app.inject('/crash');
  assert.equal(c.statusCode, 500);
  assert.deepEqual(c.json(), { error: { code: 'io_error', message: 'inesperado' } });
  await app.close();
});

test('con token, cada request lo exige', async () => {
  const app = createServer({ projectDir: dir, store, token: 's3cr3t' });
  assert.equal((await app.inject('/api/health')).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/health', headers: { authorization: 'Bearer otro' } })).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/health', headers: { authorization: 'Bearer s3cr3t' } })).statusCode, 200);
  await app.close();
});

test('listen abre solo en 127.0.0.1', async () => {
  const app = createServer({ projectDir: dir, store });
  const addr = await listen(app, 0);
  assert.equal(addr.address, '127.0.0.1');
  const r = await fetch(`http://127.0.0.1:${addr.port}/api/health`);
  assert.equal((await r.json()).ok, true);
  await app.close();
});

async function serve(argv) {
  let out = '', err = '';
  const ac = new AbortController();
  const done = run(argv, { cwd: dir, signal: ac.signal, out: { write: (s) => { out += s; } }, err: { write: (s) => { err += s; } } });
  // Espera a que imprima la URL o a que termine con error.
  for (let i = 0; i < 100 && !out && !err; i++) await new Promise((r) => setTimeout(r, 20));
  return { ac, done, out: () => out, err: () => err };
}

test('scompass serve: arranca, responde y se cierra con la señal', async () => {
  const s = await serve(['serve', '--port', '0', '--json']);
  const { url, project } = JSON.parse(s.out());
  assert.equal(project, dir);
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  assert.equal((await (await fetch(url + 'api/health')).json()).project, dir);
  s.ac.abort();
  assert.equal(await s.done, 0);
  await assert.rejects(fetch(url + 'api/health'));
});

test('scompass serve: si el puerto de la config está ocupado usa el siguiente libre y la CLI lo encuentra', async (t) => {
  const busy = netServer().listen(0, '127.0.0.1');
  await new Promise((r) => busy.once('listening', r));
  const taken = busy.address().port;
  t.after(() => busy.close());
  const cfg = join(dir, 'compass', 'config.json');
  await writeFile(cfg, JSON.stringify({ ...JSON.parse(await readFile(cfg, 'utf8')), port: taken }));
  const s = await serve(['serve', '--json']);
  for (let i = 0; i < 100 && !s.out(); i++) await new Promise((r) => setTimeout(r, 20));
  const { port } = JSON.parse(s.out());
  assert.ok(port > taken && port <= taken + 20, `puerto ${port}`);
  assert.match(s.err(), /está ocupado; este hub usa el/);
  // Otra invocación de la CLI llega al hub por el registro, aunque la config diga otro puerto.
  const { detectHub } = await import('../src/store/http.js');
  assert.equal(await detectHub(dir, taken), `http://127.0.0.1:${port}`);
  s.ac.abort();
  assert.equal(await s.done, 0);
});

test('scompass serve: puerto ocupado y proyecto sin compass/ fallan con 1', async () => {
  const busy = netServer().listen(0, '127.0.0.1');
  await new Promise((r) => busy.once('listening', r));
  const s = await serve(['serve', '--port', String(busy.address().port)]);
  assert.equal(await s.done, 1);
  assert.match(s.err(), /ocupado/);
  busy.close();

  await rm(join(dir, 'compass'), { recursive: true });
  const n = await serve(['serve', '--port', '0']);
  assert.equal(await n.done, 1);
  assert.match(n.err(), /init/);
});

test('sirve la UI de web/ y nada fuera de ella', async () => {
  const app = createServer({ projectDir: dir, store });
  const index = await app.inject('/');
  assert.equal(index.statusCode, 200);
  assert.match(index.headers['content-type'], /text\/html/);
  assert.match(index.body, /<script src="app.js"/);
  assert.match((await app.inject('/app.js')).headers['content-type'], /javascript/);
  assert.match((await app.inject('/app.css')).headers['content-type'], /text\/css/);
  for (const url of ['/fonts/..%2F..%2Fpackage.json', '/fonts/.hidden.woff2', '/fonts/nada.woff2', '/README.md', '/api/nada']) {
    const r = await app.inject(url);
    assert.equal(r.statusCode, 404, url);
    assert.equal(r.json().error.code, 'not_found', url);
  }
  await app.close();
});

test('GET /api/config devuelve la config del proyecto', async () => {
  const app = createServer({ projectDir: dir, store });
  const r = await app.inject('/api/config');
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().project, 'Scope Compass');
  await rm(join(dir, 'compass', 'config.json'));
  assert.equal((await app.inject('/api/config')).statusCode, 409);
  await app.close();
});
