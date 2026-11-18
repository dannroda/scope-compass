import './isolate.js';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadValidators } from '../src/schema.js';
import { canonical } from '../src/store/canonical.js';
import { createJsonFilesStore } from '../src/store/json-files.js';
import { createServer, listen } from '../src/server.js';
import { run } from '../src/cli.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'compass');
const V = loadValidators();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let dir, compass, md, exports, apps;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'scompass-'));
  compass = join(dir, 'compass');
  md = join(dir, 'docs', 'tareas.md');
  await cp(FIXTURE, compass, { recursive: true });
  exports = 0;
  apps = [];
});
// Si un assert falla antes de app.close(), el hub (con su watcher) dejaba el proceso del test abierto para siempre.
afterEach(async () => {
  for (const app of apps) await app.close().catch(() => {});
  await rm(dir, { recursive: true, force: true, maxRetries: 10 });
});

async function hub(opts = {}) {
  const app = createServer({ projectDir: dir, store: createJsonFilesStore(compass, { validators: V }), validators: V, watch: true, exportMd: true, ...opts });
  app.events.on('exported', () => { exports++; });
  apps.push(app);
  await app.ready();
  return app;
}
const patch = (app, id, body) => app.inject({ method: 'PATCH', url: `/api/tasks/${id}`, payload: body });
async function waitExports(n) {
  for (let i = 0; i < 300 && exports < n; i++) await sleep(10);
  await sleep(300);
}
async function setConfig(changes) {
  const p = join(compass, 'config.json');
  await writeFile(p, canonical({ ...JSON.parse(await readFile(p, 'utf8')), ...changes }));
}

test('mover una tarjeta por la API actualiza docs/tareas.md', async () => {
  const app = await hub();
  await patch(app, 'm1-07', { status: 'review' });
  await waitExports(1);
  assert.equal(exports, 1);
  assert.match(await readFile(md, 'utf8'), /### 1\.7 Tests de M1 · Revisión/);
  await app.close();
});

test('una ráfaga de cambios da un solo export', async () => {
  // Ventana de 1 s y no los 200 ms de siempre: con la suite entera en Windows, entre dos PATCH pasaban más de 200 ms.
  const app = await hub({ exportDebounceMs: 1000 });
  for (const s of ['todo', 'doing', 'review', 'done', 'doing']) await patch(app, 'm1-07', { status: s });
  await waitExports(1);
  assert.equal(exports, 1);
  assert.match(await readFile(md, 'utf8'), /### 1\.7 Tests de M1 · En curso/);
  await app.close();
});

test('un cambio a mano detectado por el watcher también exporta', async () => {
  const app = await hub();
  const p = join(compass, 'tasks', 'm1-07.json');
  await writeFile(p, JSON.stringify({ ...JSON.parse(await readFile(p, 'utf8')), title: 'Editada a mano' }));
  await waitExports(1);
  assert.match(await readFile(md, 'utf8'), /### 1\.7 Editada a mano/);
  await app.close();
});

test('auto_export_md: false se respeta sin reiniciar el hub', async () => {
  const app = await hub();
  await setConfig({ auto_export_md: false });
  await patch(app, 'm1-07', { status: 'review' });
  await sleep(500);
  assert.equal(exports, 0);
  assert.ok(!existsSync(md));
  await setConfig({ auto_export_md: true });
  await patch(app, 'm1-07', { status: 'doing' });
  await waitExports(1);
  assert.equal(exports, 1);
  await app.close();
});

test('al cerrar el hub, un export pendiente se hace igual', async () => {
  const app = await hub();
  await patch(app, 'm1-07', { status: 'review' });
  await app.close();
  assert.equal(exports, 1);
  assert.match(await readFile(md, 'utf8'), /· Revisión/);
});

test('sin exportMd el hub no escribe el markdown', async () => {
  const app = await hub({ exportMd: false });
  await patch(app, 'm1-07', { status: 'review' });
  await sleep(400);
  assert.ok(!existsSync(md));
  await app.close();
});

test('la CLI con hub no exporta por su cuenta: lo hace el hub', async () => {
  const app = await hub({ exportMd: false });
  const { port } = await listen(app, 0);
  await setConfig({ port });
  const quiet = { out: { write() {} }, err: { write() {} } };
  assert.equal(await run(['move', 'm1-07', 'review'], { cwd: dir, ...quiet }), 0);
  await sleep(300);
  assert.ok(!existsSync(md), 'la CLI no exportó');
  assert.equal(JSON.parse(await readFile(join(compass, 'tasks', 'm1-07.json'), 'utf8')).status, 'review');
  await app.close();
});
