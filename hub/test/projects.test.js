// Registro de proyectos conocidos (8.1, D23): serve se anota solo, home add/rm/list, y un registro roto no se pisa.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { forgetProject, loadProjects, projectsFile, projectsStatus, recordProject } from '../src/projects.js';
import { run } from '../src/cli.js';

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
  await rm(dir, { recursive: true, force: true });
});

async function cli(args) {
  let out = '', err = '';
  const code = await run(args, { cwd: dir, out: { write: (s) => { out += s; } }, err: { write: (s) => { err += s; } } });
  return { code, out, err };
}

const projectName = async (p) => JSON.parse(await readFile(join(p, 'compass', 'config.json'), 'utf8')).project;

test('el archivo vive en SCOMPASS_CONFIG, o en XDG_CONFIG_HOME/scope-compass', () => {
  assert.equal(projectsFile(), join(dir, 'config', 'projects.json'));
  delete process.env.SCOMPASS_CONFIG;
  const xdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = join(dir, 'xdg');
  try { assert.equal(projectsFile(), join(dir, 'xdg', 'scope-compass', 'projects.json')); }
  finally { if (xdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = xdg; }
});

test('recordProject: alta con el nombre de la config, sin duplicar por otra forma de la ruta', async () => {
  const p = join(dir, 'p');
  await symlink(p, join(dir, 'enlace'));
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
