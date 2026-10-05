// Criterios de aceptación de v4 (spec §17.1). Los otros tienen su test donde está la pieza: home-serve.test.js
// (CLI en vivo, hub suelto), dock.test.js (el dock con el Inicio), home-restart.test.js y home.test.js (actualizar).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadValidators } from '../src/schema.js';
import { listen } from '../src/server.js';
import { createHomeServer } from '../src/home.js';
import { recordProject } from '../src/projects.js';
import { listHubs } from '../src/registry.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'compass');
const V = loadValidators();
let root, saved, home, base;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'scompass-m9-'));
  saved = { reg: process.env.SCOMPASS_REGISTRY, cfg: process.env.SCOMPASS_CONFIG };
  process.env.SCOMPASS_REGISTRY = join(root, 'registro');
  process.env.SCOMPASS_CONFIG = join(root, 'config');
  home = createHomeServer({ validators: V });
  const { port } = await listen(home, 0);
  base = `http://127.0.0.1:${port}`;
});
afterEach(async () => {
  await home.close();
  for (const [k, v] of [['SCOMPASS_REGISTRY', saved.reg], ['SCOMPASS_CONFIG', saved.cfg]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(root, { recursive: true, force: true });
});

test('§17.1: abrir un tablero desde el Inicio no cambia de puerto ni levanta procesos, y se edita enseguida', async () => {
  const p = join(root, 'Vida');
  await cp(FIXTURE, join(p, 'compass'), { recursive: true });
  await recordProject(p);
  const pids = () => new Set(listHubs().map((h) => h.pid));
  const before = pids();
  const { projects: [card] } = await (await fetch(base + '/api/projects')).json();
  assert.equal(card.url, '/p/vida/');
  const t0 = Date.now();
  assert.equal((await fetch(base + card.url)).status, 200);
  const t = await (await fetch(base + card.url + 'api/tasks/m1-04')).json();
  const r = await fetch(base + card.url + 'api/tasks/m1-04', { method: 'PATCH', headers: { 'content-type': 'application/json', 'if-match': `"${t.etag}"` }, body: JSON.stringify({ status: 'review' }) });
  assert.equal(r.status, 200);
  assert.ok(Date.now() - t0 < 1000, `tardó ${Date.now() - t0} ms`);
  assert.equal(JSON.parse(await readFile(join(p, 'compass', 'tasks', 'm1-04.json'), 'utf8')).status, 'review');
  // Ningún proceso nuevo: las únicas entradas nuevas del registro son del propio Inicio (este proceso).
  const added = [...pids()].filter((x) => !before.has(x));
  assert.deepEqual(added.filter((x) => x !== process.pid), []);
});
