// Registro de hubs activos: un hub por proyecto, y encontrarlo aunque no esté en el puerto de la config.
import './isolate.js';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hubsOf, listHubs, registerHub, registryDir, unregisterHub } from '../src/registry.js';
import { detectHub } from '../src/store/http.js';
import { canonical } from '../src/store/canonical.js';
import { run } from '../src/cli.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'compass');
let dir, saved;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'scompass-reg-'));
  saved = process.env.SCOMPASS_REGISTRY;
  process.env.SCOMPASS_REGISTRY = join(dir, 'registro');
  await cp(FIXTURE, join(dir, 'p', 'compass'), { recursive: true });
});
afterEach(async () => {
  if (saved === undefined) delete process.env.SCOMPASS_REGISTRY; else process.env.SCOMPASS_REGISTRY = saved;
  await rm(dir, { recursive: true, force: true, maxRetries: 10 });
});

async function serve(project, port, extra = []) {
  let out = '', err = '';
  const ac = new AbortController();
  const done = run(['--dir', project, 'serve', '--port', String(port), '--json', ...extra], { signal: ac.signal, out: { write: (s) => { out += s; } }, err: { write: (s) => { err += s; } } });
  for (let i = 0; i < 100 && !out && !err; i++) await new Promise((r) => setTimeout(r, 20));
  return { ac, done, out: () => out, err: () => err };
}

test('registro: alta, baja y limpieza de procesos muertos', async () => {
  assert.equal(registryDir(), join(dir, 'registro', 'hubs'));
  registerHub({ port: 1234, project: join(dir, 'p') });
  assert.deepEqual(listHubs().map((h) => [h.pid, h.port]), [[process.pid, 1234]]);
  assert.equal(hubsOf(join(dir, 'p', '.')).length, 1, 'mismo proyecto con otra forma de la ruta');
  await writeFile(join(registryDir(), '999999.json'), JSON.stringify({ pid: 999999, port: 1, project: '/x', startedAt: 'z' }));
  assert.equal(listHubs().length, 1);
  assert.deepEqual(await readdir(registryDir()), [`${process.pid}.json`], 'el registro del muerto se borró');
  unregisterHub();
  assert.deepEqual(listHubs(), []);
});

test('19.5: un registro a medio escribir de un hub vivo no se borra; se escribe con un rename', async () => {
  registerHub({ port: 1234, project: join(dir, 'p') });
  const other = process.ppid;
  await writeFile(join(registryDir(), `${other}.json`), '{"pid":');
  assert.deepEqual(listHubs().map((h) => h.pid), [process.pid]);
  assert.ok((await readdir(registryDir())).includes(`${other}.json`), 'el del proceso vivo sigue');
  assert.ok(!(await readdir(registryDir())).some((n) => n.endsWith('.tmp')));
  unregisterHub();
});

test('serve se niega si ya hay un hub del mismo proyecto (aunque en otro puerto); --force lo permite', async () => {
  const project = join(dir, 'p');
  const a = await serve(project, 0);
  const port = JSON.parse(a.out()).port;
  assert.deepEqual(hubsOf(project).map((h) => h.port), [port]);
  // El registro guarda el PID del proceso (acá, el de los tests); se simula otro proceso con un PID vivo que no
  // es el nuestro: el del runner de tests (PID 1 no sirve: en Windows no existe y el registro lo da por muerto).
  const other = process.ppid;
  await writeFile(join(registryDir(), `${other}.json`), JSON.stringify({ pid: other, port, project, startedAt: new Date().toISOString() }));
  const b = await serve(project, 0);
  assert.equal(await b.done, 1);
  assert.match(b.err(), new RegExp(`ya hay un hub de este proyecto: PID ${other} en http://127\\.0\\.0\\.1:\\d+/`));
  const c = await serve(project, 0, ['--force']);
  assert.ok(JSON.parse(c.out()).port);
  c.ac.abort();
  assert.equal(await c.done, 0);
  a.ac.abort();
  assert.equal(await a.done, 0);
  assert.equal(hubsOf(project).filter((h) => h.pid === process.pid).length, 0, 'al cerrar se da de baja');
});

test('la CLI encuentra el hub del proyecto aunque no esté en el puerto de la config; scompass hubs lo lista', async () => {
  const project = join(dir, 'p');
  const cfg = join(project, 'compass', 'config.json');
  await writeFile(cfg, canonical({ ...JSON.parse(await readFile(cfg, 'utf8')), port: 1 }));
  const a = await serve(project, 0);
  const port = JSON.parse(a.out()).port;
  assert.equal(await detectHub(project, 1), `http://127.0.0.1:${port}`);
  let out = '';
  assert.equal(await run(['hubs', '--json'], { out: { write: (s) => { out += s; } }, err: { write() {} } }), 0);
  assert.deepEqual(JSON.parse(out).hubs.map((h) => h.port), [port]);
  a.ac.abort();
  await a.done;
  assert.equal(await detectHub(project, 1), null);
});
