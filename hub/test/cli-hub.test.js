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
  await rm(root, { recursive: true, force: true, maxRetries: 10 });
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

test('add simultáneos por el hub: order distintos y consecutivos', async () => {
  const outs = await Promise.all(Array.from({ length: 6 }, (_, i) => cli(hubDir, ['add', `Tarea ${i}`, '--milestone', 'm02', '--json'])));
  assert.ok(outs.every((o) => o.code === 0));
  const orders = outs.map((o) => JSON.parse(o.out).order).sort((a, b) => a - b);
  assert.deepEqual(orders, [1, 2, 3, 4, 5, 6]);
});

test('--etag none y campos sueltos dan lo mismo con y sin hub', async () => {
  const t = join(root, 't.json');
  await writeFile(t, JSON.stringify({ milestone: 'm02', title: 'X', status: 'todo' }));
  for (const cwd of [disk, hubDir]) {
    assert.equal((await cli(cwd, ['set', 'm2-99', '--file', t, '--etag', 'none'])).code, 0);
    assert.equal((await cli(cwd, ['set', 'm2-99', '--file', t, '--etag', 'none'])).code, 1);
    assert.equal((await cli(cwd, ['set', 'm2-99', '--notes', 'n'])).code, 0);
  }
  assert.equal(await readFile(join(hubDir, 'compass', 'tasks', 'm2-99.json'), 'utf8'),
    await readFile(join(disk, 'compass', 'tasks', 'm2-99.json'), 'utf8'));
});

// --- Reiniciar el hub ---
import { spawn } from 'node:child_process';
import { createServer as netServer } from 'node:net';

const freePort = () => new Promise((res) => { const s = netServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('scompass restart: el hub vuelve en el mismo puerto con otro PID y sigue atado a la misma entrada', async () => {
  let port = await freePort();
  const cfgPath = join(disk, 'compass', 'config.json');
  await writeFile(cfgPath, canonical({ ...JSON.parse(await readFile(cfgPath, 'utf8')), port }));
  const bin = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'scompass.js');
  // Entrada por un pipe del sistema, como la de Godot (con cat en el medio): con la tubería 'pipe' de Node directa,
  // al cerrarse el proceso viejo el nuevo recibe fin de entrada y se va (en Linux es un par de sockets y el viejo le
  // hace shutdown; en Windows pasa lo mismo). En Windows, `findstr "^"` hace de cat.
  const args = [bin, '--dir', disk, 'serve', '--exit-on-stdin-close'];
  const hub = process.platform === 'win32'
    ? spawn('cmd', ['/d', '/s', '/c', `"findstr "^" | "${process.execPath}" ${args.map((a) => `"${a}"`).join(' ')}"`], { stdio: ['pipe', 'pipe', 'pipe'], windowsVerbatimArguments: true })
    : spawn('sh', ['-c', 'cat | exec "$0" "$@"', process.execPath, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
  let newPid = 0;
  try {
    // El puerto real, del mensaje del hub: si otro proceso tomó `port` entre medio, el hub usa el siguiente libre.
    port = Number(/127\.0\.0\.1:(\d+)/.exec(String(await new Promise((r) => hub.stdout.once('data', r))))[1]);
    const before = (await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()).pid;
    const r = await cli(disk, ['restart', '--json']);
    assert.equal(r.code, 0, r.err);
    ({ pid: newPid } = JSON.parse(r.out));
    assert.notEqual(newPid, before);
    assert.equal((await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()).pid, newPid);
    for (let i = 0; i < 40 && alive(before); i++) await new Promise((res) => setTimeout(res, 50));
    assert.ok(!alive(before), 'el viejo terminó');
    // Y el nuevo sigue: no recibió fin de entrada cuando se fue el viejo.
    await new Promise((res) => setTimeout(res, 1000));
    assert.ok(alive(newPid), 'el hub nuevo se cerró solo después del reinicio');
    // La entrada es la misma tubería: al cortarla, el hub nuevo también se cierra.
    hub.stdin.end();
    for (let i = 0; i < 40 && alive(newPid); i++) await new Promise((res) => setTimeout(res, 50));
    assert.ok(!alive(newPid), 'el hub nuevo sigue vivo con la entrada cerrada');
  } finally {
    hub.kill('SIGKILL');
    if (newPid && alive(newPid)) process.kill(newPid, 'SIGKILL');
  }
});

test('scompass restart sin hub: error claro', async () => {
  const r = await cli(disk, ['restart']);
  assert.equal(r.code, 1);
  assert.match(r.err, /no hay un hub de este proyecto/);
});
