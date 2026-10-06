// El Inicio como multi-hub (9.2, spec §17, D29): sirve cada proyecto en /p/<clave>/ sin un puerto propio, o
// reenvía a su hub suelto si ya hay uno (un solo proceso escribe cada compass/).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadValidators } from '../src/schema.js';
import { canonical } from '../src/store/canonical.js';
import { createJsonFilesStore } from '../src/store/json-files.js';
import { createServer, listen } from '../src/server.js';
import { createHomeServer } from '../src/home.js';
import { projectKeys } from '../src/home-serve.js';
import { recordProject } from '../src/projects.js';
import { registerHub, unregisterHub } from '../src/registry.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'compass');
const V = loadValidators();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let root, saved, home, base;

async function project(name) {
  const p = join(root, name);
  await cp(FIXTURE, join(p, 'compass'), { recursive: true });
  await recordProject(p);
  return p;
}
const until = async (fn, ms = 3000) => { const t0 = Date.now(); while (!fn() && Date.now() - t0 < ms) await sleep(20); return fn(); };
function socket(url) {
  const ws = new WebSocket(url);
  const got = [];
  ws.addEventListener('message', (m) => got.push(JSON.parse(m.data)));
  return { ws, got, open: new Promise((r) => ws.addEventListener('open', r)) };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'scompass-home-serve-'));
  saved = { reg: process.env.SCOMPASS_REGISTRY, cfg: process.env.SCOMPASS_CONFIG };
  process.env.SCOMPASS_REGISTRY = join(root, 'registro');
  process.env.SCOMPASS_CONFIG = join(root, 'config');
  home = createHomeServer({ validators: V, pollMs: 50 });
  const { port } = await listen(home, 0);
  base = `http://127.0.0.1:${port}`;
});
afterEach(async () => {
  await home.close();
  for (const [k, v] of [['SCOMPASS_REGISTRY', saved.reg], ['SCOMPASS_CONFIG', saved.cfg]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(root, { recursive: true, force: true, maxRetries: 10 });
});

test('projectKeys: el nombre de la carpeta como slug, sin repetir', () => {
  const keys = projectKeys([{ path: '/a/Vida' }, { path: '/b/vida' }, { path: '/c/Project Epiphany' }]);
  assert.deepEqual([...keys.values()], ['vida', 'vida-2', 'project-epiphany']);
});

test('sin hub suelto: el Inicio sirve el tablero, la API y el WebSocket del proyecto, sin abrir otro puerto', async () => {
  const p = await project('Vida');
  const projects = (await (await fetch(base + '/api/projects')).json()).projects;
  assert.deepEqual([projects[0].key, projects[0].url, projects[0].served], ['vida', '/p/vida/', null]);
  // El tablero: la misma página del hub.
  const page = await fetch(base + '/p/vida/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<script src="app\.js"/);
  assert.equal((await fetch(base + '/p/vida/app.css')).headers.get('content-type'), 'text/css; charset=utf-8');
  assert.equal((await fetch(base + '/p/vida', { redirect: 'manual' })).headers.get('location'), '/p/vida/');
  // La API, con etag y escrituras.
  const t = (await (await fetch(base + '/p/vida/api/tasks/m1-04')).json());
  const ws = socket(base.replace('http', 'ws') + '/p/vida/ws');
  await ws.open;
  const r = await fetch(base + '/p/vida/api/tasks/m1-04', { method: 'PATCH', headers: { 'content-type': 'application/json', 'if-match': `"${t.etag}"` }, body: JSON.stringify({ status: 'review' }) });
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(await readFile(join(p, 'compass', 'tasks', 'm1-04.json'), 'utf8')).status, 'review');
  assert.equal((await fetch(base + '/p/vida/api/tasks/m1-04', { method: 'PATCH', headers: { 'content-type': 'application/json', 'if-match': '"viejo"' }, body: '{"status":"done"}' })).status, 409);
  const created = await fetch(base + '/p/vida/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ milestone: 'm01', title: 'Nueva', status: 'todo' }) });
  assert.match(created.headers.get('location'), /^\/p\/vida\/api\/tasks\/m1-\d+$/);
  // Apagar o reiniciar un proyecto que sirve el Inicio no tiene sentido: se rechaza y el Inicio sigue.
  assert.equal((await fetch(base + '/p/vida/api/shutdown', { method: 'POST' })).status, 400);
  assert.equal((await fetch(base + '/p/vida/api/restart', { method: 'POST' })).status, 400);
  assert.equal((await fetch(base + '/api/health')).status, 200);
  // El WebSocket: hello y el upsert de la escritura.
  assert.ok(await until(() => ws.got.some((e) => e.type === 'upsert' && e.id === 'm1-04')), JSON.stringify(ws.got));
  assert.equal(ws.got[0].type, 'hello');
  // Un cambio hecho a mano (o por la CLI) llega por el watcher del proyecto.
  const cur = JSON.parse(await readFile(join(p, 'compass', 'tasks', 'm1-05.json'), 'utf8'));
  await writeFile(join(p, 'compass', 'tasks', 'm1-05.json'), canonical({ ...cur, title: 'Editada a mano' }));
  assert.ok(await until(() => ws.got.some((e) => e.type === 'upsert' && e.id === 'm1-05' && e.doc.title === 'Editada a mano')));
  assert.equal((await (await fetch(base + '/api/projects')).json()).projects[0].served, 'home');
  ws.ws.close();
});

test('con un hub suelto: el Inicio le reenvía HTTP y WebSocket (no lo sirve él)', async () => {
  const p = await project('juego');
  const hub = createServer({ projectDir: p, store: createJsonFilesStore(join(p, 'compass'), { validators: V }), validators: V });
  const { port } = await listen(hub, 0);
  registerHub({ port, project: p, pid: process.ppid });
  const seen = [];
  hub.events.on('event', (e) => seen.push(e));
  try {
    assert.equal((await (await fetch(base + '/p/juego/api/health')).json()).project, p);
    const ws = socket(base.replace('http', 'ws') + '/p/juego/ws');
    await ws.open;
    await until(() => ws.got.length);
    const t = await (await fetch(base + '/p/juego/api/tasks/m1-04')).json();
    await fetch(base + '/p/juego/api/tasks/m1-04', { method: 'PATCH', headers: { 'content-type': 'application/json', 'if-match': `"${t.etag}"` }, body: JSON.stringify({ status: 'todo' }) });
    assert.ok(seen.some((e) => e.type === 'upsert' && e.id === 'm1-04'), 'la escritura la hizo el hub suelto');
    assert.ok(await until(() => ws.got.some((e) => e.type === 'upsert' && e.id === 'm1-04')), 'el WebSocket puenteado recibió el cambio');
    assert.equal((await (await fetch(base + '/api/projects')).json()).projects[0].served, 'hub');
    ws.ws.close();
  } finally {
    await hub.close();
    unregisterHub(process.ppid);
  }
});

test('una clave que no existe: 404', async () => {
  await project('Vida');
  assert.equal((await fetch(base + '/p/otra/api/tasks')).status, 404);
});

test('registro: un proyecto que sirve el Inicio queda anotado con su base; la CLI pasa por ahí y serve no levanta otro', async () => {
  const { run } = await import('../src/cli.js');
  const { hubsOf } = await import('../src/registry.js');
  const p = await project('Vida');
  await fetch(base + '/p/vida/api/tasks'); // lo activa
  const [entry] = hubsOf(p);
  assert.deepEqual([entry.kind, entry.base, entry.port], ['served', '/p/vida', Number(new URL(base).port)]);
  // La CLI encuentra el proyecto en el Inicio: la escritura llega por el WebSocket del tablero.
  const ws = socket(base.replace('http', 'ws') + '/p/vida/ws');
  await ws.open;
  let out = '', err = '';
  const io = { cwd: p, out: { write: (s) => { out += s; } }, err: { write: (s) => { err += s; } } };
  assert.equal(await run(['move', 'm1-04', 'review'], io), 0, err);
  assert.ok(await until(() => ws.got.some((e) => e.type === 'upsert' && e.id === 'm1-04' && e.doc.status === 'review')), 'no pasó por el Inicio');
  // serve en otro proceso (como en la realidad: el Inicio es otro proceso) no levanta un segundo hub.
  const { execFile } = await import('node:child_process');
  const bin = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'scompass.js');
  const r = await new Promise((done) => execFile(process.execPath, [bin, '--dir', p, 'serve', '--port', '0'], { env: process.env, timeout: 10000 }, (e, so, se) => done({ code: e?.code ?? 0, se })));
  assert.equal(r.code, 1, r.se);
  assert.match(r.se, /lo sirve el Inicio en http:\/\/127\.0\.0\.1:\d+\/p\/vida\//);
  out = '';
  await run(['hubs'], io);
  assert.match(out, /\/p\/vida\/ .*lo sirve el Inicio/);
  ws.ws.close();
  await home.close();
  assert.equal(hubsOf(p).length, 0, 'al cerrar el Inicio se desanota');
  home = createHomeServer({ validators: V, pollMs: 50 }); // para el afterEach
  await listen(home, 0);
});
