// El tablero fuera del repo del proyecto (m32-10): compass/ como enlace a <datos>/boards/<nombre>, con su propio git.
import './isolate.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../src/cli.js';
import { boardInfo, boardKind, boardsDir } from '../src/board.js';
import { realInside } from '../src/paths.js';
import { loadValidators } from '../src/schema.js';
import { createJsonFilesStore } from '../src/store/json-files.js';
import { createServer } from '../src/server.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'compass');
const V = loadValidators();
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);

async function project() {
  const dir = await mkdtemp(join(tmpdir(), 'scompass-board-'));
  const git = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=Ana', '-c', 'user.email=a@a', ...a], { encoding: 'utf8' });
  let out = '', err = '';
  const cli = async (...argv) => { out = ''; err = ''; const code = await run(['--direct', ...argv], { cwd: dir, out: { write: (s) => { out += s; } }, err: { write: (s) => { err += s; } } }); return { code, out, err }; };
  git('init', '-q', '-b', 'main');
  await cp(FIXTURE, join(dir, 'compass'), { recursive: true });
  await writeFile(join(dir, 'main.gd'), 'extends Node\n');
  return { dir, git, cli };
}

test('board move: el tablero pasa a su propio repo con su historial, compass/ queda enlazado y fuera del proyecto', async () => {
  const { dir, git, cli } = await project();
  const name = `mover-${Date.now()}`;
  try {
    // El export fuera de compass/ (como en una plantilla) se commitea con el tablero.
    const cfg = JSON.parse(readFileSync(join(dir, 'compass', 'config.json'), 'utf8'));
    await writeFile(join(dir, 'compass', 'config.json'), JSON.stringify({ ...cfg, export_md: 'docs/tareas.md' }));
    await mkdir(join(dir, 'docs'));
    await writeFile(join(dir, 'docs', 'tareas.md'), '# viejo\n');
    git('add', '-A'); git('commit', '-qm', 'primero');
    const id = JSON.parse((await cli('list', '--json')).out).tasks[0].id;
    assert.equal((await cli('move', id, 'doing')).code, 0);
    git('add', '-A'); git('commit', '-qm', 'segundo');
    // Algo sin commitear: tiene que llegar al tablero nuevo.
    assert.equal((await cli('move', id, 'review')).code, 0);
    assert.equal(boardKind(dir), 'local');

    const r = await cli('board', 'move', name, '--json');
    assert.equal(r.code, 0, r.err);
    const res = JSON.parse(r.out);
    const target = join(boardsDir(), name);
    assert.equal(res.target, target);
    assert.equal(res.history, true);
    assert.equal(res.exportTo, 'compass/tareas.md');
    assert.ok(lstatSync(join(dir, 'compass')).isSymbolicLink());
    assert.equal(realpathSync(join(dir, 'compass')), realpathSync(target));
    assert.equal(boardKind(dir), 'linked');

    // El historial: los dos commits, con la raíz en el tablero.
    const log = execFileSync('git', ['-C', target, 'log', '--format=%s'], { encoding: 'utf8' }).trim().split('\n');
    assert.deepEqual(log, ['segundo', 'primero']);
    assert.ok(existsSync(join(target, 'config.json')) && existsSync(join(target, '.git')));
    assert.equal(JSON.parse(readFileSync(join(target, 'tasks', `${id}.json`), 'utf8')).status, 'review', 'lo sin commitear llegó');
    assert.equal(JSON.parse(readFileSync(join(target, 'config.json'), 'utf8')).export_md, 'compass/tareas.md');

    // El proyecto: compass/ y el export viejo fuera del índice, y git no ve el enlace.
    const status = git('status', '--porcelain');
    assert.match(status, /^D {2}compass\/config\.json$/m);
    assert.match(status, /^D {2}docs\/tareas\.md$/m);
    assert.doesNotMatch(status, /^\?\? compass/m);
    assert.ok(!existsSync(join(dir, 'docs', 'tareas.md')));
    assert.match(readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf8'), /^\/compass$/m);

    // Todo sigue andando por el enlace: escribir, el export dentro del tablero y el historial desde su git.
    assert.equal((await cli('move', id, 'done')).code, 0);
    assert.ok(existsSync(join(target, 'tareas.md')));
    const h = await cli('history', id, '--json');
    const entries = JSON.parse(h.out).entries;
    assert.equal(entries[0].hash, null, 'lo sin commitear arriba');
    assert.deepEqual(entries.slice(1).map((e) => e.subject), ['segundo', 'primero']);

    const info = await boardInfo(dir);
    assert.equal(info.kind, 'linked');
    assert.equal(info.branch, 'main');
    assert.equal(info.remote, null);
    assert.equal((await cli('board', 'move', name)).code, 1, 'ya está afuera');
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(join(boardsDir(), name), { recursive: true, force: true });
  }
});

test('board move sin git en el proyecto, y board link en otro proyecto', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'scompass-board-'));
  const other = await mkdtemp(join(tmpdir(), 'scompass-board-'));
  const name = `suelto-${Date.now()}`;
  const cli = (cwd, ...argv) => run(['--direct', ...argv], { cwd, out: { write() {} }, err: { write() {} } });
  try {
    await cp(FIXTURE, join(dir, 'compass'), { recursive: true });
    assert.equal(await cli(dir, 'board', 'move', name), 0);
    const target = join(boardsDir(), name);
    assert.ok(existsSync(join(target, '.git')), 'repo nuevo, sin commits');
    assert.equal(execFileSync('git', ['-C', target, 'status', '--porcelain'], { encoding: 'utf8' }).includes('config.json'), true);

    execFileSync('git', ['-C', other, 'init', '-q']);
    assert.equal(await cli(other, 'board', 'link', name), 0);
    assert.equal(realpathSync(join(other, 'compass')), realpathSync(target));
    assert.match(readFileSync(join(other, '.git', 'info', 'exclude'), 'utf8'), /^\/compass$/m);
    assert.equal(await cli(other, 'board', 'link', name), 1, 'compass/ ya existe');
    assert.equal(await cli(other, 'board', 'link', 'no-existe'), 1);
  } finally {
    for (const d of [dir, other, join(boardsDir(), name)]) await rm(d, { recursive: true, force: true });
  }
});

test('tablero enlazado en el hub: estado de git del tablero, capturas, watcher y rutas', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'scompass-board-'));
  const board = await mkdtemp(join(tmpdir(), 'scompass-board-target-'));
  const outside = await mkdtemp(join(tmpdir(), 'scompass-board-out-'));
  let app;
  try {
    execFileSync('git', ['-C', dir, 'init', '-q']);
    await cp(FIXTURE, board, { recursive: true });
    execFileSync('git', ['-C', board, 'init', '-q']);
    execFileSync('git', ['-C', board, '-c', 'user.name=Ana', '-c', 'user.email=a@a', 'add', '-A']);
    execFileSync('git', ['-C', board, '-c', 'user.name=Ana', '-c', 'user.email=a@a', 'commit', '-qm', 'tablero']);
    assert.equal(await run(['--direct', 'board', 'link', board], { cwd: dir, out: { write() {} }, err: { write() {} } }), 0);

    // Rutas: lo del tablero cuenta como del proyecto; lo de otra carpeta no.
    assert.equal(await realInside(dir, join(dir, 'compass', 'images', 'x.png')), true);
    assert.equal(await realInside(dir, join(outside, 'x.png')), false);

    app = createServer({ projectDir: dir, store: createJsonFilesStore(join(dir, 'compass'), { validators: V }), validators: V, watch: true });
    const events = [];
    app.events.on('event', (e) => events.push(e));
    await app.ready();
    assert.deepEqual((await app.inject({ url: '/api/git' })).json(), { repo: true, uncommitted: 0, files: [] });

    const { tasks } = (await app.inject({ url: '/api/tasks' })).json();
    const id = tasks[0].id;
    // Una captura pegada: se guarda en el tablero y se sirve aunque el git del proyecto no la liste.
    const up = await app.inject({ method: 'POST', url: `/api/tasks/${id}/images`, payload: { data: PNG.toString('base64') } });
    assert.equal(up.statusCode, 201, up.body);
    const path = up.json().images.at(-1);
    assert.match(path, /^compass\/images\//);
    assert.ok(existsSync(join(board, path.slice('compass/'.length))));
    assert.equal((await app.inject({ url: `/api/files/raw?path=${encodeURIComponent(path)}` })).statusCode, 200);

    const g = (await app.inject({ url: '/api/git' })).json();
    assert.equal(g.repo, true);
    assert.ok(g.files.includes(`compass/tasks/${id}.json`), JSON.stringify(g.files));
    assert.ok(g.files.some((f) => f.startsWith('compass/images/')));

    // El watcher mira el tablero a través del enlace: un cambio de afuera llega como evento.
    const before = events.length;
    const file = join(board, 'tasks', `${id}.json`);
    const doc = JSON.parse(await readFile(file, 'utf8'));
    await writeFile(file, JSON.stringify({ ...doc, title: 'Cambiada desde afuera' }, null, 2) + '\n');
    const t0 = Date.now();
    while (!events.slice(before).some((e) => e.type === 'task_changed' || e.type === 'changed' || JSON.stringify(e).includes('Cambiada desde afuera')) && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 20));
    assert.ok(events.slice(before).some((e) => JSON.stringify(e).includes(id)), JSON.stringify(events.slice(before)));
  } finally {
    await app?.close();
    for (const d of [dir, board, outside]) await rm(d, { recursive: true, force: true });
  }
});
