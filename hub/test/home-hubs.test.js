// Prender y apagar hubs desde el Inicio (8.9, spec §16.2): hijos del Inicio que mueren con él, y aviso antes de
// apagar uno que abrió otro programa (el dock).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadValidators } from '../src/schema.js';
import { listen } from '../src/server.js';
import { createHomeServer } from '../src/home.js';
import { recordProject } from '../src/projects.js';
import { hubsOf } from '../src/registry.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = join(REPO, 'hub', 'test', 'fixtures', 'compass');
const V = loadValidators();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
let root, saved, home, port, p;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'scompass-home-hubs-'));
  saved = { reg: process.env.SCOMPASS_REGISTRY, cfg: process.env.SCOMPASS_CONFIG };
  process.env.SCOMPASS_REGISTRY = join(root, 'registro');
  process.env.SCOMPASS_CONFIG = join(root, 'config');
  p = join(root, 'p');
  await cp(FIXTURE, join(p, 'compass'), { recursive: true });
  await recordProject(p);
  home = createHomeServer({ validators: V, pollMs: 50 });
  ({ port } = await listen(home, 0));
});
afterEach(async () => {
  for (const h of hubsOf(p)) { try { process.kill(h.pid, 'SIGKILL'); } catch {} }
  await home.close();
  for (const [k, v] of [['SCOMPASS_REGISTRY', saved.reg], ['SCOMPASS_CONFIG', saved.cfg]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(root, { recursive: true, force: true });
});

const api = async (method, path, body) => {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { method, ...(body && { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  return { status: r.status, body: await r.json() };
};

test('prender y apagar: el hub arranca, aparece en /api/projects y se cierra', async () => {
  let r = await api('POST', '/api/projects/start', { path: p });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const { pid, port: hubPort } = r.body.hub;
  assert.equal((await (await fetch(`http://127.0.0.1:${hubPort}/api/health`)).json()).pid, pid);
  assert.deepEqual((await api('GET', '/api/projects')).body.projects[0].hubs.map((h) => h.pid), [pid]);
  // Prender otra vez no levanta otro.
  r = await api('POST', '/api/projects/start', { path: p });
  assert.deepEqual([r.status, r.body.already, r.body.hub.pid], [200, true, pid]);
  r = await api('POST', '/api/projects/stop', { path: p });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(!alive(pid));
  assert.equal(hubsOf(p).length, 0);
  assert.equal((await api('POST', '/api/projects/stop', { path: p })).status, 404, 'ya no hay hub');
});

test('los hubs que prendió el Inicio mueren con él', async () => {
  const { body } = await api('POST', '/api/projects/start', { path: p });
  await home.close();
  for (let i = 0; i < 60 && alive(body.hub.pid); i++) await sleep(50);
  assert.ok(!alive(body.hub.pid));
  home = createHomeServer({ validators: V, pollMs: 50 }); // para el afterEach
  ({ port } = await listen(home, 0));
});

test('un hub del dock (atado a otro proceso) se apaga solo con force', async () => {
  // Como lo lanza el dock: su entrada es una tubería de otro proceso.
  const hub = spawn(process.execPath, [join(REPO, 'hub', 'bin', 'scompass.js'), '--dir', p, 'serve', '--port', '0', '--exit-on-stdin-close'], { stdio: ['pipe', 'ignore', 'ignore'] });
  try {
    for (let i = 0; i < 100 && !hubsOf(p).length; i++) await sleep(50);
    const [h] = hubsOf(p);
    assert.equal(h.attached, true);
    let r = await api('POST', '/api/projects/stop', { path: p });
    assert.equal(r.status, 409);
    assert.equal(r.body.error.foreign, true);
    assert.match(r.body.error.message, /dock/);
    assert.ok(alive(hub.pid), 'no lo apagó sin force');
    r = await api('POST', '/api/projects/stop', { path: p, force: true });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(!alive(hub.pid));
  } finally {
    hub.kill('SIGKILL');
  }
});

test('sin compass/config.json no se prende', async () => {
  await rm(join(p, 'compass', 'config.json'));
  const r = await api('POST', '/api/projects/start', { path: p });
  assert.equal(r.status, 404);
  assert.match(r.body.error.message, /no se encuentra/);
});
