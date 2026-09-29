// La CLI con y sin hub (tarea 2.5): mismo resultado, y con hub las escrituras pasan por la API.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadValidators } from '../src/schema.js';
import { canonical } from '../src/store/canonical.js';
import { createJsonFilesStore } from '../src/store/json-files.js';
import { detectHub } from '../src/store/http.js';
import { createServer, listen } from '../src/server.js';
import { run } from '../src/cli.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'compass');
const V = loadValidators();
const NOW = '2026-10-01T12:00:00.000Z';
let root, disk, hubDir, app, port, events;

async function project(name, cfgPort) {
  const p = join(root, name);
  await cp(FIXTURE, join(p, 'compass'), { recursive: true });
  const cfgPath = join(p, 'compass', 'config.json');
  const cfg = JSON.parse(await readFile(cfgPath, 'utf8'));
  await writeFile(cfgPath, canonical({ ...cfg, port: cfgPort }));
  return p;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'scompass-'));
  hubDir = await project('con-hub', 1);
  app = createServer({ projectDir: hubDir, store: createJsonFilesStore(join(hubDir, 'compass'), { validators: V, now: () => NOW }) });
  ({ port } = await listen(app, 0));
  const cfgPath = join(hubDir, 'compass', 'config.json');
  await writeFile(cfgPath, canonical({ ...JSON.parse(await readFile(cfgPath, 'utf8')), port }));
  // Sin hub: un puerto donde no escucha nadie.
  disk = await project('sin-hub', 1);
  events = [];
  app.events.on('event', (e) => events.push(e));
});
afterEach(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
});

async function cli(cwd, argv, stdin = '') {
  let out = '', err = '';
  const code = await run(argv, {
    cwd, now: () => NOW, stdin: [stdin],
    out: { write: (s) => { out += s; } }, err: { write: (s) => { err += s; } }
  });
  return { code, out, err };
}

test('detectHub: solo el hub del mismo proyecto', async () => {
  assert.equal(await detectHub(hubDir, port), `http://127.0.0.1:${port}`);
  assert.equal(await detectHub(disk, port), null, 'otro proyecto');
  assert.equal(await detectHub(hubDir, 1), null, 'nadie escucha');
  assert.equal(await detectHub(hubDir, undefined), null);
});

test('la misma secuencia da la misma salida con y sin hub', async () => {
  const bad = join(root, 'mala.json');
  await writeFile(bad, JSON.stringify({ milestone: 'm00', title: 'x', status: 'wip' }));
  const m8 = join(root, 'm8.json');
  await writeFile(m8, JSON.stringify({ code: 'M8', order: 8, title: 'Extra' }));
  const steps = async (cwd) => {
    const { etag } = JSON.parse((await cli(cwd, ['show', 'm1-04', '--json'])).out);
    return [
      await cli(cwd, ['list', '--json']),
      await cli(cwd, ['list', '--milestone', 'm01']),
      await cli(cwd, ['show', 'm1-07']),
      await cli(cwd, ['move', 'm1-04', 'doing', '--json', '--etag', etag]),
      await cli(cwd, ['move', 'm1-04', 'review', '--json', '--etag', etag]),
      await cli(cwd, ['check', 'm1-07', '1', '--json']),
      await cli(cwd, ['check', 'm1-07', '9']),
      await cli(cwd, ['show', 'nada']),
      await cli(cwd, ['show', 'nada', '--json']),
      await cli(cwd, ['set', 'm0-01', '--file', bad]),
      await cli(cwd, ['milestone', 'set', 'm08', '--file', m8, '--json']),
      await cli(cwd, ['milestone', 'list', '--json']),
      await cli(cwd, ['add', 'x', '--milestone', 'm99'])
    ];
  };
  const a = await steps(disk);
  const b = await steps(hubDir);
  assert.equal(events.length > 0, true, 'con hub las escrituras pasan por la API');
  for (let i = 0; i < a.length; i++) assert.deepEqual(b[i], a[i], `paso ${i}`);
  for (const id of ['m1-04', 'm1-07']) {
    assert.equal(await readFile(join(hubDir, 'compass', 'tasks', `${id}.json`), 'utf8'),
      await readFile(join(disk, 'compass', 'tasks', `${id}.json`), 'utf8'), id);
  }
});

test('add por el hub devuelve la tarea creada y se publica', async () => {
  const r = await cli(hubDir, ['add', 'Por el hub', '--milestone', 'm02', '--json']);
  assert.equal(r.code, 0, r.err);
  const t = JSON.parse(r.out);
  assert.equal(t.order, 1);
  assert.deepEqual(events.map((e) => [e.type, e.id]), [['upsert', t.id]]);
});

test('--direct escribe al disco aunque haya hub', async () => {
  assert.equal((await cli(hubDir, ['move', 'm1-04', 'doing', '--direct'])).code, 0);
  assert.deepEqual(events, [], 'no pasó por la API');
  assert.equal(JSON.parse(await readFile(join(hubDir, 'compass', 'tasks', 'm1-04.json'), 'utf8')).status, 'doing');
});

test('si el hub se cerró, la CLI vuelve a escribir al disco', async () => {
  const { etag } = JSON.parse((await cli(hubDir, ['show', 'm1-04', '--json'])).out);
  await app.close();
  const r = await cli(hubDir, ['move', 'm1-04', 'doing', '--etag', etag]);
  assert.equal(r.code, 0, r.err);
  assert.equal(JSON.parse(await readFile(join(hubDir, 'compass', 'tasks', 'm1-04.json'), 'utf8')).status, 'doing');
});
