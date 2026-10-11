// Criterios de aceptación de v3 (spec §16.8), uno por test. El de la bandeja con tres hubs está en tray.test.js
// (necesita un bus D-Bus de prueba).
import './isolate.js';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadValidators } from '../src/schema.js';
import { createJsonFilesStore } from '../src/store/json-files.js';
import { createServer, listen } from '../src/server.js';
import { createHomeServer } from '../src/home.js';
import { loadProjects, projectsFile, recordProject } from '../src/projects.js';
import { hubsOf, registerHub, unregisterHub } from '../src/registry.js';
import { viewsOf } from '../src/views.js';
import { run } from '../src/cli.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = join(REPO, 'hub', 'test', 'fixtures', 'compass');
const BIN = join(REPO, 'hub', 'bin', 'scompass.js');
const V = loadValidators();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let root, saved, home, homeUrl, children;

const quiet = { out: { write() {} }, err: { write() {} } };
const cli = (...argv) => run(argv, quiet);
async function project(name) {
  const p = join(root, name);
  await cp(FIXTURE, join(p, 'compass'), { recursive: true });
  return p;
}
const api = async (method, path, body) => {
  const r = await fetch(homeUrl + path, { method, ...(body && { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  return { status: r.status, body: await r.json() };
};
// Las líneas que cambiaron entre dos versiones de un archivo.
const changed = (a, b) => { const x = a.split('\n'), y = b.split('\n'); return y.filter((l, i) => l !== x[i]); };

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'scompass-m8-'));
  saved = { reg: process.env.SCOMPASS_REGISTRY, cfg: process.env.SCOMPASS_CONFIG };
  process.env.SCOMPASS_REGISTRY = join(root, 'registro');
  process.env.SCOMPASS_CONFIG = join(root, 'config');
  children = [];
  home = createHomeServer({ validators: V }); // con el intervalo de verdad, no uno de test
  const { port } = await listen(home, 0);
  homeUrl = `http://127.0.0.1:${port}`;
});
afterEach(async () => {
  for (const c of children) c.kill('SIGKILL');
  await home.close();
  for (const [k, v] of [['SCOMPASS_REGISTRY', saved.reg], ['SCOMPASS_CONFIG', saved.cfg]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(root, { recursive: true, force: true, maxRetries: 10 });
});

test('§16.8: con el Inicio abierto, un hub que levanta el dock se ve activo en menos de 1 s y queda en projects.json', async () => {
  const p = await project('juego');
  const ws = new WebSocket(homeUrl.replace('http', 'ws') + '/ws');
  const events = [];
  ws.addEventListener('message', (m) => events.push({ at: Date.now(), e: JSON.parse(m.data) }));
  await new Promise((r) => ws.addEventListener('open', r));
  // Como lo lanza el dock: `serve --exit-on-stdin-close` con la entrada en una tubería.
  const hub = spawn(process.execPath, [BIN, '--dir', p, 'serve', '--port', '0', '--exit-on-stdin-close'], { stdio: ['pipe', 'ignore', 'ignore'], env: process.env });
  children.push(hub);
  let up = null;
  for (let i = 0; i < 200 && !up; i++) { if (hubsOf(p).length) up = Date.now(); else await sleep(10); }
  assert.ok(up, 'el hub no arrancó');
  for (let i = 0; i < 150 && !events.some((x) => x.e.type === 'hubs' && x.at >= up); i++) await sleep(10);
  const seen = events.find((x) => x.e.type === 'hubs' && x.at >= up);
  assert.ok(seen, 'el Inicio no avisó');
  assert.ok(seen.at - up < 1000, `tardó ${seen.at - up} ms`);
  const { body } = await api('GET', '/api/projects');
  assert.deepEqual(body.projects.map((x) => [x.path, x.hubs.length]), [[p, 1]]);
  assert.ok(loadProjects()[0].last_seen);
  ws.close();
});

test('§16.8: importar una carpeta la muestra sin levantar su hub; prenderlo y apagarlo desde el Inicio funciona', async () => {
  const p = await project('importado');
  let r = await api('POST', '/api/projects', { path: p });
  assert.equal(r.status, 201);
  const [entry] = (await api('GET', '/api/projects')).body.projects;
  assert.deepEqual([entry.path, entry.found, entry.hubs], [p, true, []]);
  assert.equal(hubsOf(p).length, 0, 'importar no prende nada');
  r = await api('POST', '/api/projects/start', { path: p });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal((await (await fetch(`http://127.0.0.1:${r.body.hub.port}/api/health`)).json()).project, p);
  r = await api('POST', '/api/projects/stop', { path: p });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(hubsOf(p).length, 0);
});

for (const mode of ['con hub', 'sin hub']) {
  test(`§16.8: tildar un ítem en Hoy cambia una sola línea del JSON de la lista (${mode})`, async () => {
    const p = await project('vida');
    const pad = (n) => String(n).padStart(2, '0');
    const d = new Date();
    const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const store = createJsonFilesStore(join(p, 'compass'), { validators: V });
    await store.put('lists', 'pendientes', { title: 'Pendientes', order: 1, items: [{ text: 'Yerba', done: false }, { text: 'Pagar la luz', done: false, due: today }] }, { ifMatch: null });
    await recordProject(p);
    let hub = null;
    if (mode === 'con hub') {
      hub = createServer({ projectDir: p, store: createJsonFilesStore(join(p, 'compass'), { validators: V }), validators: V });
      const { port } = await listen(hub, 0);
      registerHub({ port, project: p, pid: process.ppid });
    }
    try {
      const path = join(p, 'compass', 'lists', 'pendientes.json');
      const before = await readFile(path, 'utf8');
      const item = (await api('GET', '/api/today')).body.items.find((x) => x.text === 'Pagar la luz');
      const r = await api('POST', '/api/projects/check-item', { path: p, list: item.list, n: item.n, etag: item.etag });
      assert.equal(r.body.via, mode === 'con hub' ? 'hub' : 'disk');
      const lines = changed(before, await readFile(path, 'utf8')).filter((l) => !l.includes('updated_at'));
      assert.deepEqual(lines, ['      "done": true,']);
    } finally {
      if (hub) { await hub.close(); unregisterHub(process.ppid); }
    }
  });
}

test('§16.8: un ítem mensual con due 2026-01-31 pasa a 2026-02-28 al tildarlo', async () => {
  const p = await project('vida');
  assert.equal(await cli('--dir', p, '--direct', 'lists', 'add', 'Pendientes'), 0);
  assert.equal(await cli('--dir', p, '--direct', 'item', 'add', 'pendientes', 'Pagar la luz', '--due', '2026-01-31', '--repeat', 'month'), 0);
  assert.equal(await cli('--dir', p, '--direct', 'item', 'check', 'pendientes', '1'), 0);
  const [it] = JSON.parse(await readFile(join(p, 'compass', 'lists', 'pendientes.json'), 'utf8')).items;
  assert.deepEqual([it.due, it.done], ['2026-02-28', false]);
});

test('§16.8: scompass init --template personal crea un proyecto que abre en Listas', async () => {
  const p = join(root, 'Vida');
  assert.equal(await cli('--dir', p, 'init', '--template', 'personal', '--project', 'Vida'), 0);
  const cfg = JSON.parse(await readFile(join(p, 'compass', 'config.json'), 'utf8'));
  assert.equal(viewsOf(cfg)[0], 'lists');
  assert.deepEqual((await readdir(join(p, 'compass', 'lists'))).sort(), ['compras.json', 'pendientes.json']);
});

test('§16.8: borrar ~/.config/scope-compass/ no pierde ningún dato: solo hay que volver a importar', async () => {
  const p = await project('vida');
  await recordProject(p);
  const before = await readdir(join(p, 'compass', 'tasks'));
  await rm(dirname(projectsFile()), { recursive: true });
  assert.deepEqual((await api('GET', '/api/projects')).body.projects, [], 'el Inicio queda vacío');
  assert.deepEqual(await readdir(join(p, 'compass', 'tasks')), before, 'los datos siguen en compass/');
  assert.equal((await api('POST', '/api/projects', { path: p })).status, 201);
  const [again] = (await api('GET', '/api/projects')).body.projects;
  assert.ok(again.found && again.summary.milestone, 'vuelve con su resumen');
  assert.ok(existsSync(projectsFile()));
});
