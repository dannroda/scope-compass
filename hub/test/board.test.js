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
import { boardInfo, boardKind, boardsDir, listBoards } from '../src/board.js';
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

    // board list: los tableros de la carpeta de tableros, con los proyectos que los usan (de los que se pasan).
    const listed = listBoards([dir, other]).find((b) => b.name === name);
    assert.deepEqual(listed, { name, path: realpathSync(target), project: 'Scope Compass', used_by: [dir, other] });
    let out = '';
    assert.equal(await run(['board', 'list', '--json'], { cwd: other, out: { write: (s) => { out += s; } }, err: { write() {} } }), 0);
    assert.equal(JSON.parse(out).boards.find((b) => b.name === name).path, realpathSync(target));
  } finally {
    for (const d of [dir, other, join(boardsDir(), name)]) await rm(d, { recursive: true, force: true });
  }
});

test('board link --replace: un tablero local sale del repo del proyecto (no con algo sin commitear) y un enlace se cambia', async () => {
  const { dir, git, cli } = await project();
  const a = join(boardsDir(), `otro-a-${Date.now()}`);
  const b = join(boardsDir(), `otro-b-${Date.now()}`);
  try {
    await cp(FIXTURE, a, { recursive: true });
    await cp(FIXTURE, b, { recursive: true });
    await mkdir(join(dir, 'docs'));
    await writeFile(join(dir, 'docs', 'tareas.md'), '# viejo\n');
    // Sin commitear, el tablero local no tiene historial: se niega.
    let r = await cli('board', 'link', a, '--replace');
    assert.equal(r.code, 1);
    assert.match(r.err, /no está commiteado/);
    git('add', '-A'); git('commit', '-qm', 'tablero local');
    // Con algo sin commitear en compass/, se perdería: se niega y no toca nada.
    const id = JSON.parse((await cli('list', '--json')).out).tasks[0].id;
    assert.equal((await cli('move', id, 'doing')).code, 0);
    r = await cli('board', 'link', a, '--replace');
    assert.equal(r.code, 1);
    assert.match(r.err, /sin commitear/);
    assert.equal(boardKind(dir), 'local');
    git('checkout', '-q', '--', 'compass', 'docs');
    // Sin --replace, un compass/ que ya existe es un conflicto, como siempre.
    assert.equal((await cli('board', 'link', a)).code, 1);

    r = await cli('board', 'link', a, '--replace', '--json');
    assert.equal(r.code, 0, r.err);
    assert.deepEqual([JSON.parse(r.out).replaced, JSON.parse(r.out).untracked, JSON.parse(r.out).exportRemoved], ['local', true, 'docs/tareas.md']);
    assert.equal(realpathSync(join(dir, 'compass')), realpathSync(a));
    assert.equal(git('ls-files', '--', 'compass', 'docs/tareas.md'), '', 'fuera del índice');
    assert.ok(!existsSync(join(dir, 'docs', 'tareas.md')));
    assert.match(git('status', '--porcelain'), /^D {2}compass\/config\.json$/m, 'la baja queda para commitear');
    assert.match(readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf8'), /^\/compass$/m);
    // El viejo sigue en el historial.
    assert.ok(git('show', 'HEAD:compass/config.json').includes('"project"'));

    // Un enlace se cambia por otro y el tablero de antes no se toca; el mismo es un conflicto.
    assert.equal((await cli('board', 'link', a, '--replace')).code, 1, 'ya usa ese tablero');
    r = await cli('board', 'link', b, '--replace', '--json');
    assert.equal(r.code, 0, r.err);
    assert.equal(JSON.parse(r.out).replaced, 'linked');
    assert.equal(realpathSync(join(dir, 'compass')), realpathSync(b));
    assert.ok(existsSync(join(a, 'config.json')));
    assert.equal((await cli('board', 'link', join(dir, 'main.gd'), '--replace')).code, 1, 'no es un tablero');
    assert.equal(realpathSync(join(dir, 'compass')), realpathSync(b), 'si falla, el enlace queda');
  } finally {
    for (const d of [dir, a, b]) await rm(d, { recursive: true, force: true });
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

// Repo de todos los tableros: SCOMPASS_BOARDS es la raíz de un repo y cada tablero es una subcarpeta.
async function withSharedBoards(fn) {
  const boards = await mkdtemp(join(tmpdir(), 'scompass-boards-'));
  const prev = process.env.SCOMPASS_BOARDS;
  process.env.SCOMPASS_BOARDS = boards;
  const g = (...a) => execFileSync('git', ['-C', boards, '-c', 'user.name=Ana', '-c', 'user.email=a@a', ...a], { encoding: 'utf8' });
  try {
    g('init', '-q', '-b', 'main');
    g('config', 'user.name', 'Ana'); g('config', 'user.email', 'a@a');
    await fn(boards, g);
  } finally {
    if (prev === undefined) delete process.env.SCOMPASS_BOARDS; else process.env.SCOMPASS_BOARDS = prev;
    await rm(boards, { recursive: true, force: true });
  }
}

test('repo compartido: board move trae el historial en un commit y no toca lo sin commitear de otro tablero', async () => {
  await withSharedBoards(async (boards, g) => {
    // Otro tablero con algo sin commitear: el commit de board move no lo puede arrastrar ni pedir el árbol limpio.
    await mkdir(join(boards, 'otro'));
    await writeFile(join(boards, 'otro', 'config.json'), '{}\n');
    g('add', '-A'); g('commit', '-qm', 'otro');
    await writeFile(join(boards, 'otro', 'config.json'), '{"x":1}\n');

    const { dir, git, cli } = await project();
    try {
      git('add', '-A'); git('commit', '-qm', 'primero');
      const id = JSON.parse((await cli('list', '--json')).out).tasks[0].id;
      await cli('move', id, 'doing');
      git('add', '-A'); git('commit', '-qm', 'segundo');
      await cli('move', id, 'review');

      const r = await cli('board', 'move', 'juego', '--json');
      assert.equal(r.code, 0, r.err);
      const res = JSON.parse(r.out);
      assert.equal(res.shared, true);
      assert.equal(res.history, true);
      assert.ok(!existsSync(join(boards, 'juego', '.git')), 'sin repo propio');
      assert.equal(realpathSync(join(dir, 'compass')), realpathSync(join(boards, 'juego')));

      // Un commit nuevo con dos padres: el HEAD de antes y la historia partida de compass/.
      assert.equal(g('rev-list', '--count', '--merges', 'HEAD').trim(), '1');
      assert.match(g('log', '-1', '--format=%s'), /^Tablero .* \(juego\/\), con su historial/);
      assert.deepEqual(g('log', '--format=%s', '--', 'juego/tasks').trim().split('\n'), ['segundo', 'primero']);
      // Lo del otro tablero sigue sin commitear, y lo de este que no estaba commiteado también.
      const st = g('status', '--porcelain');
      assert.match(st, /^ M otro\/config\.json$/m);
      assert.match(st, new RegExp(`^ M juego/tasks/${id}\\.json$`, 'm'));

      // Desde el proyecto, el historial y el estado salen del repo de tableros, con rutas compass/….
      const h = JSON.parse((await cli('history', id, '--json')).out).entries;
      assert.deepEqual(h.map((e) => e.subject), ['Sin commitear', 'segundo', 'primero']);
      const info = await boardInfo(dir);
      assert.equal(info.shared, true);
      assert.equal(info.repoDir, realpathSync(boards));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('init: el tablero va a la carpeta de tableros (subcarpeta del repo compartido); --in-project y los temporales, adentro', async () => {
  await withSharedBoards(async (boards, g) => {
    const dir = await mkdtemp(join(tmpdir(), 'scompass-board-'));
    const cli = (cwd, ...argv) => { let out = ''; return run([...argv, '--json'], { cwd, out: { write: (s) => { out += s; } }, err: { write() {} } }).then((code) => ({ code, out })); };
    try {
      execFileSync('git', ['-C', dir, 'init', '-q']);
      // Un proyecto en /tmp crea adentro, salvo --board.
      const local = await mkdtemp(join(tmpdir(), 'scompass-board-'));
      assert.equal((await cli(local, 'init')).code, 0);
      assert.equal(boardKind(local), 'local');
      await rm(local, { recursive: true, force: true });

      const r = await cli(dir, 'init', '--board', 'nuevo', '--template', 'juego');
      assert.equal(r.code, 0);
      const res = JSON.parse(r.out);
      assert.equal(res.board, join(boards, 'nuevo'));
      assert.equal(res.shared, true);
      assert.equal(res.config.export_md, 'compass/tareas.md');
      assert.equal(boardKind(dir), 'linked');
      assert.ok(!existsSync(join(boards, 'nuevo', '.git')));
      assert.ok(existsSync(join(boards, 'nuevo', 'config.json')));
      assert.ok(existsSync(join(dir, 'docs', 'gdd.md')), 'los documentos de la plantilla van al proyecto');
      assert.match(readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf8'), /^\/compass$/m);
      assert.match(g('status', '--porcelain'), /^\?\? nuevo\/$/m);

      // El mismo nombre otra vez: conflicto, y no queda nada a medio armar en el proyecto.
      const other = await mkdtemp(join(tmpdir(), 'scompass-board-'));
      assert.equal((await cli(other, 'init', '--board', 'nuevo')).code, 1);
      assert.equal(boardKind(other), 'none');
      await rm(other, { recursive: true, force: true });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test('sin repo compartido, init --board crea el tablero con su propio git', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'scompass-board-'));
  const name = `propio-${Date.now()}`;
  try {
    assert.equal(await run(['init', '--board', name], { cwd: dir, out: { write() {} }, err: { write() {} } }), 0);
    assert.ok(existsSync(join(boardsDir(), name, '.git')));
    assert.equal((await boardInfo(dir)).shared, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(join(boardsDir(), name), { recursive: true, force: true });
  }
});
