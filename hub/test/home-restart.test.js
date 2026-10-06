// Reiniciar el Inicio (9.8): `scompass home restart` (y POST /api/restart) lo vuelve a lanzar en el mismo puerto,
// con otro PID, y sigue sirviendo los proyectos.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(REPO, 'hub', 'bin', 'scompass.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let root, env, home;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'scompass-home-restart-'));
  env = { ...process.env, SCOMPASS_REGISTRY: join(root, 'registro'), SCOMPASS_CONFIG: join(root, 'config') };
  await cp(join(REPO, 'hub', 'test', 'fixtures', 'compass'), join(root, 'Vida', 'compass'), { recursive: true });
});
afterEach(async () => {
  home?.kill('SIGKILL');
  // El Inicio nuevo no es hijo de este test: se lo busca por el registro.
  const h = await cli(['hubs', '--json']).then((r) => JSON.parse(r.out).hubs.find((x) => x.kind === 'home')).catch(() => null);
  if (h) try { process.kill(h.pid, 'SIGKILL'); } catch {}
  await rm(root, { recursive: true, force: true, maxRetries: 10 });
});
const cli = (args) => new Promise((done) => execFile(process.execPath, [BIN, ...args], { env, timeout: 20000 }, (e, out, err) => done({ code: e?.code ?? 0, out, err })));

test('scompass home restart: mismo puerto, otro PID, y los proyectos siguen', async () => {
  assert.equal((await cli(['home', 'add', join(root, 'Vida')])).code, 0);
  home = spawn(process.execPath, [BIN, 'home', '--port', '0', '--json'], { env });
  let out = '';
  home.stdout.on('data', (d) => { out += d; });
  for (let i = 0; i < 100 && !out.includes('url'); i++) await sleep(50);
  const { url, port } = JSON.parse(out.split('\n')[0]);
  const before = (await (await fetch(url + 'api/health')).json()).pid;
  const r = await cli(['home', 'restart', '--json']);
  assert.equal(r.code, 0, r.err);
  const after = JSON.parse(r.out);
  assert.deepEqual([after.previous, after.url], [before, url]);
  assert.notEqual(after.pid, before);
  assert.equal(new URL(after.url).port, String(port));
  assert.equal((await fetch(url + 'p/vida/api/tasks')).status, 200, 'sigue sirviendo el proyecto');
  // POST /api/shutdown lo cierra ordenado (§18, también en Windows): se da de baja del registro él mismo.
  assert.equal((await fetch(url + 'api/shutdown', { method: 'POST' })).status, 202);
  for (let i = 0; i < 100; i++) { try { process.kill(after.pid, 0); await sleep(50); } catch { break; } }
  assert.ok(!existsSync(join(root, 'registro', 'hubs', `${after.pid}.json`)), 'se dio de baja al cerrar');
  // Sin Inicio, restart avisa.
  const none = await cli(['home', 'restart']);
  assert.equal(none.code, 1);
  assert.match(none.err, /no está corriendo/);
});
