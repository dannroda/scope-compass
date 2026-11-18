// Registro de proyectos conocidos (8.1, D23): serve se anota solo, home add/rm/list, y un registro roto no se pisa.
import './isolate.js';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { folderName, forgetProject, loadProjects, projectsDataDir, projectsFile, projectsStatus, recordProject } from '../src/projects.js';
import { run } from '../src/cli.js';
import { link } from './links.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'compass');
let dir, saved;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'scompass-proj-'));
  saved = { reg: process.env.SCOMPASS_REGISTRY, cfg: process.env.SCOMPASS_CONFIG };
  process.env.SCOMPASS_REGISTRY = join(dir, 'registro');
  process.env.SCOMPASS_CONFIG = join(dir, 'config');
  await cp(FIXTURE, join(dir, 'p', 'compass'), { recursive: true });
});
afterEach(async () => {
  for (const [k, v] of [['SCOMPASS_REGISTRY', saved.reg], ['SCOMPASS_CONFIG', saved.cfg]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  await rm(dir, { recursive: true, force: true, maxRetries: 10 });
});

async function cli(args) {
  let out = '', err = '';
  const code = await run(args, { cwd: dir, out: { write: (s) => { out += s; } }, err: { write: (s) => { err += s; } } });
  return { code, out, err };
}

const projectName = async (p) => JSON.parse(await readFile(join(p, 'compass', 'config.json'), 'utf8')).project;

// Sin SCOMPASS_CONFIG, la carpeta de cada plataforma: ver "carpetas por plataforma" más abajo.
test('el archivo vive en SCOMPASS_CONFIG si está', () => {
  assert.equal(projectsFile(), join(dir, 'config', 'projects.json'));
});

test('recordProject: alta con el nombre de la config, sin duplicar por otra forma de la ruta', async () => {
  const p = join(dir, 'p');
  await link(p, join(dir, 'enlace'));
  const times = ['2026-10-04T10:00:00.000Z', '2026-10-04T11:00:00.000Z'];
  const a = await recordProject(p, { now: () => times[0] });
  assert.equal(a.added, true);
  assert.deepEqual(a.entry, { path: p, name: await projectName(p), added_at: times[0] });
  const b = await recordProject(join(dir, 'enlace', '.'), { seen: true, now: () => times[1] });
  assert.equal(b.added, false);
  assert.deepEqual(loadProjects(), [{ path: p, name: await projectName(p), added_at: times[0], last_seen: times[1] }]);
  // Formato canónico, como el resto de los archivos de Scope Compass.
  const text = await readFile(projectsFile(), 'utf8');
  assert.match(text, /^\{\n  "projects": \[\n/);
});

test('recordProject: una carpeta sin compass/ no se anota', async () => {
  await mkdir(join(dir, 'vacio'));
  await assert.rejects(recordProject(join(dir, 'vacio')), { code: 'not_found' });
  assert.deepEqual(loadProjects(), []);
});

test('un registro inválido avisa y no se pisa', async () => {
  await mkdir(join(dir, 'config'));
  await writeFile(projectsFile(), '{ roto');
  assert.throws(() => loadProjects(), { code: 'invalid' });
  await assert.rejects(recordProject(join(dir, 'p')), { code: 'invalid' });
  assert.equal(await readFile(projectsFile(), 'utf8'), '{ roto');
});

test('projectsStatus: no encontrado cuando la carpeta ya no está', async () => {
  await recordProject(join(dir, 'p'));
  await cp(join(dir, 'p'), join(dir, 'q'), { recursive: true });
  await recordProject(join(dir, 'q'));
  await rm(join(dir, 'q'), { recursive: true });
  assert.deepEqual(projectsStatus().map((p) => [p.path, p.found, p.hubs]), [[join(dir, 'p'), true, []], [join(dir, 'q'), false, []]]);
  // Se puede quitar aunque la carpeta ya no exista.
  assert.equal((await forgetProject(join(dir, 'q'))).path, join(dir, 'q'));
  assert.equal(loadProjects().length, 1);
});

test('CLI: home add, list y rm', async () => {
  const p = join(dir, 'p');
  let r = await cli(['--dir', p, 'home', 'add']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^Anotado: /);
  r = await cli(['home', 'add', 'p']);
  assert.match(r.out, /^Ya estaba anotado: /);
  r = await cli(['home', 'list', '--json']);
  const list = JSON.parse(r.out);
  assert.equal(list.file, projectsFile());
  assert.deepEqual(list.projects.map((x) => [x.path, x.found, x.hubs]), [[p, true, []]]);
  r = await cli(['home', 'list']);
  assert.match(r.out, /apagado\s+\S*[\\/]p\n/);
  r = await cli(['home', 'rm', 'p']);
  assert.equal(r.code, 0, r.err);
  r = await cli(['home', 'rm', 'p']);
  assert.equal(r.code, 1);
  assert.match(r.err, /no está en el registro/);
  r = await cli(['home', 'otra']);
  assert.equal(r.code, 2);
});

test('serve anota el proyecto con last_seen y home list muestra su hub', async () => {
  const p = join(dir, 'p');
  let out = '', err = '';
  const ac = new AbortController();
  const done = run(['--dir', p, 'serve', '--port', '0', '--json'], { signal: ac.signal, out: { write: (s) => { out += s; } }, err: { write: (s) => { err += s; } } });
  for (let i = 0; i < 100 && !out && !err; i++) await new Promise((r) => setTimeout(r, 20));
  try {
    const { port } = JSON.parse(out);
    const [entry] = loadProjects();
    assert.equal(entry.path, p);
    assert.ok(entry.last_seen);
    const r = await cli(['home', 'list', '--json']);
    assert.deepEqual(JSON.parse(r.out).projects[0].hubs.map((h) => h.port), [port]);
  } finally {
    ac.abort();
    await done;
  }
  assert.deepEqual(JSON.parse((await cli(['home', 'list', '--json'])).out).projects[0].hubs, [], 'el hub ya no está vivo');
});

test('serve con un registro roto avisa y levanta igual', async () => {
  await mkdir(join(dir, 'config'));
  await writeFile(projectsFile(), '[]');
  let out = '', err = '';
  const ac = new AbortController();
  const done = run(['--dir', join(dir, 'p'), 'serve', '--port', '0', '--json'], { signal: ac.signal, out: { write: (s) => { out += s; } }, err: { write: (s) => { err += s; } } });
  for (let i = 0; i < 100 && !out; i++) await new Promise((r) => setTimeout(r, 20));
  ac.abort();
  assert.equal(await done, 0);
  assert.ok(JSON.parse(out).port);
  assert.match(err, /no se anotó el proyecto/);
  assert.equal(await readFile(projectsFile(), 'utf8'), '[]');
});

test('carpetas por plataforma (§18): XDG en Linux, %APPDATA% y %LOCALAPPDATA% en Windows', () => {
  const keys = ['SCOMPASS_CONFIG', 'SCOMPASS_DATA', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'APPDATA', 'LOCALAPPDATA'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    for (const k of keys) delete process.env[k];
    Object.assign(process.env, { XDG_CONFIG_HOME: join(dir, 'xc'), XDG_DATA_HOME: join(dir, 'xd'), APPDATA: join(dir, 'ad'), LOCALAPPDATA: join(dir, 'ld') });
    if (process.platform === 'win32') {
      assert.equal(projectsFile(), join(dir, 'ad', 'scope-compass', 'projects.json'));
      assert.equal(projectsDataDir(), join(dir, 'ld', 'scope-compass'));
    } else {
      assert.equal(projectsFile(), join(dir, 'xc', 'scope-compass', 'projects.json'));
      assert.equal(projectsDataDir(), join(dir, 'xd', 'scope-compass'));
    }
  } finally {
    for (const k of keys) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
});

test('folderName: nombres que sirven de carpeta en Linux y en Windows', () => {
  for (const ok of ['Vida', 'Gran Juego', 'juego.v2', 'com10', 'Lecturas 2026']) assert.equal(folderName(` ${ok} `), ok);
  for (const bad of ['', '.', '..', 'a/b', 'a\\b', 'x:y', 'a*', 'q?', '"x"', '<x>', 'a|b', 'tab\tx', 'CON', 'con.txt', 'Nul', 'COM1', 'lpt9.md', 'Vida.']) {
    assert.equal(folderName(bad), null, JSON.stringify(bad));
  }
});

test('tableros de prueba: con el projects.json del usuario, init y serve no anotan una carpeta temporal y el Inicio olvida las que se borraron', async () => {
  const { recordProject, pruneTempProjects, loadProjects, isTempPath } = await import('../src/projects.js');
  const { homedir } = await import('node:os');
  const { mkdtempSync, writeFileSync, mkdirSync, rmSync } = await import('node:fs');
  // Un projects.json fuera de las carpetas temporales, como el real (en el home, dentro de una carpeta de prueba).
  const cfg = mkdtempSync(join(homedir(), '.scompass-test-'));
  const before = process.env.SCOMPASS_CONFIG;
  process.env.SCOMPASS_CONFIG = cfg;
  try {
    const tmp = mkdtempSync(join(dir, 'tablero-'));
    mkdirSync(join(tmp, 'compass'));
    writeFileSync(join(tmp, 'compass', 'config.json'), JSON.stringify({ project: 'Prueba' }));
    assert.equal(isTempPath(tmp), true);
    assert.deepEqual(await recordProject(tmp, { auto: true }), { entry: null, added: false });
    assert.deepEqual(loadProjects(), []);
    // Anotado a mano (home add) sí queda; borrado, el Inicio lo olvida al arrancar.
    assert.equal((await recordProject(tmp)).added, true);
    rmSync(tmp, { recursive: true, force: true });
    assert.equal(await pruneTempProjects(), 1);
    assert.deepEqual(loadProjects(), []);
  } finally {
    process.env.SCOMPASS_CONFIG = before;
    rmSync(cfg, { recursive: true, force: true });
  }
});
