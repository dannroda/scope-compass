// Tests del dock de Godot (M5): lanza Godot sin ventana con hub/test/godot/runner.gd sobre una copia del fixture.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical } from '../src/store/canonical.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = join(REPO, 'hub', 'test', 'fixtures', 'compass');
const hasGodot = (() => { try { execFileSync('godot', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const skip = !hasGodot && 'sin godot en el PATH';
let dir;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'scompass-dock-'));
  await cp(FIXTURE, join(dir, 'compass'), { recursive: true });
  await setTask('m1-03', { status: 'doing' });
  await setTask('m1-05', { status: 'review' });
});
afterEach(() => rm(dir, { recursive: true, force: true }));

async function setTask(id, changes) {
  const p = join(dir, 'compass', 'tasks', `${id}.json`);
  await writeFile(p, canonical({ ...JSON.parse(await readFile(p, 'utf8')), ...changes }));
}

function godot(...args) {
  return new Promise((resolve) => {
    execFile('godot', ['--headless', '--path', REPO, '--script', 'res://hub/test/godot/runner.gd', '--', ...args],
      { timeout: 60000 }, (err, stdout, stderr) => resolve({ code: err ? err.code ?? 1 : 0, out: stdout + stderr }));
  });
}
const expectOk = (r, name) => assert.ok(r.code === 0 && r.out.includes(`OK ${name}`), r.out.split('\n').filter((l) => /FAIL|ERROR|OK /.test(l)).join('\n') || r.out);

test('sin hub: tareas del primer hito sin terminar, agrupadas por estado, en solo lectura', { skip }, async () => {
  const expected = ['doing:m1-03', 'review:m1-05', 'done:m1-01', 'done:m1-02', 'done:m1-04', 'done:m1-06', 'done:m1-07'];
  expectOk(await godot('offline', dir, 'm01', JSON.stringify(expected)), 'offline');
});

test('elegir un hito lo recuerda y cambia la lista', { skip }, async () => {
  const expected = ['done:m0-01', 'done:m0-02', 'done:m0-03', 'done:m0-04', 'done:m0-05', 'done:m0-06'];
  expectOk(await godot('pick_milestone', dir, 'm00', JSON.stringify(expected)), 'pick_milestone');
});

test('archivo con conflicto: aviso y fuera de la lista; corregido a mano, vuelve al recargar', { skip }, async () => {
  const p = join(dir, 'compass', 'tasks', 'm1-02.json');
  const valid = canonical({ ...JSON.parse(await readFile(p, 'utf8')), status: 'doing' });
  await writeFile(p, '<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> x\n');
  expectOk(await godot('invalid_and_reload', dir, valid), 'invalid_and_reload');
});

test('el pie cuenta los archivos de compass/ sin commitear', { skip }, async () => {
  const git = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]);
  git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'base');
  expectOk(await godot('uncommitted', dir, '0'), 'uncommitted');
  await setTask('m1-01', { status: 'todo' });
  await setTask('m1-02', { status: 'todo' });
  expectOk(await godot('uncommitted', dir, '2'), 'uncommitted');
});

// --- Con hub (5.3, 5.4) ---
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { loadValidators } from '../src/schema.js';
import { createJsonFilesStore } from '../src/store/json-files.js';
import { createServer, listen } from '../src/server.js';

const V = loadValidators();

async function startHub(port = 0) {
  const app = createServer({ projectDir: dir, store: createJsonFilesStore(join(dir, 'compass'), { validators: V }), validators: V, watch: true });
  const addr = await listen(app, port);
  const cfgPath = join(dir, 'compass', 'config.json');
  await writeFile(cfgPath, canonical({ ...JSON.parse(await readFile(cfgPath, 'utf8')), port: addr.port }));
  return { app, port: addr.port, base: `http://127.0.0.1:${addr.port}` };
}

// Godot en vivo: llama a onLine(línea) por cada línea de stdout; resuelve con { code, out } al terminar.
function godotLive(args, onLine = () => {}) {
  return new Promise((resolve) => {
    const p = spawn('godot', ['--headless', '--path', REPO, '--script', 'res://hub/test/godot/runner.gd', '--', ...args]);
    let out = '', buf = '';
    const t = setTimeout(() => p.kill('SIGKILL'), 60000);
    const feed = (d) => {
      out += d; buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); Promise.resolve(onLine(line)).catch((e) => { out += `\nnode: ${e.stack}`; }); }
    };
    p.stdout.on('data', feed);
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => { clearTimeout(t); resolve({ code, out }); });
  });
}
const task = async (id) => JSON.parse(await readFile(join(dir, 'compass', 'tasks', `${id}.json`), 'utf8'));

test('con hub: mover desde el dock escribe por la API y la UI web lo ve al instante', { skip }, async () => {
  const hub = await startHub();
  const events = [];
  hub.app.events.on('event', (e) => events.push(e));
  const r = await godotLive(['online_move', dir, 'm1-04', 'review']);
  await hub.app.close();
  expectOk(r, 'online_move');
  assert.equal((await task('m1-04')).status, 'review');
  assert.ok(events.some((e) => e.type === 'upsert' && e.id === 'm1-04' && e.doc.status === 'review'), 'se publicó a los clientes (la UI web)');
});

test('con hub: un cambio desde la UI web llega al dock en menos de 1 s', { skip }, async () => {
  const hub = await startHub();
  let t0 = 0;
  const r = await godotLive(['online_receive', dir, 'm1-04', 'doing'], async (line) => {
    if (line === 'READY') {
      t0 = Date.now();
      await fetch(`${hub.base}/api/tasks/m1-04`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"status":"doing"}' });
    }
  });
  await hub.app.close();
  expectOk(r, 'online_receive');
  const ms = Number(/ELAPSED (\d+)/.exec(r.out)?.[1]);
  assert.ok(ms < 1000, `tardó ${ms} ms`);
});

test('con hub: tildar varios pasos seguidos se guarda entero, sin 409', { skip }, async () => {
  const hub = await startHub();
  const before = (await task('m0-01')).checklist.map((c) => c.done);
  const r = await godotLive(['toggle_steps', dir, 'm0-01']);
  await hub.app.close();
  expectOk(r, 'toggle_steps');
  assert.deepEqual((await task('m0-01')).checklist.map((c) => c.done), before.map((d) => !d));
});

test('con hub: 409 si el dock estaba desactualizado; toma la versión actual y no pisa', { skip }, async () => {
  const hub = await startHub();
  const r = await godotLive(['conflict', dir, 'm1-04', 'todo', 'cambiado por la web'], async (line) => {
    if (line === 'READY') {
      await fetch(`${hub.base}/api/tasks/m1-04`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"notes":"cambiado por la web"}' });
      await writeFile(join(dir, '.go'), '');
    }
  });
  await hub.app.close();
  expectOk(r, 'conflict');
  const t = await task('m1-04');
  assert.equal(t.notes, 'cambiado por la web');
  assert.equal(t.status, 'done', 'la escritura vieja no pisó nada');
});

test('con hub: nueva tarea desde el dock', { skip }, async () => {
  const hub = await startHub();
  const r = await godotLive(['create', dir, 'm02', 'Desde el dock']);
  await hub.app.close();
  expectOk(r, 'create');
  const id = /CREATED (\S+)/.exec(r.out)?.[1];
  assert.ok(id && existsSync(join(dir, 'compass', 'tasks', `${id}.json`)));
  assert.equal((await task(id)).milestone, 'm02');
});

test('con hub: si el hub se cae pasa a solo lectura y al volver se reconecta solo', { skip }, async () => {
  let hub = await startHub();
  const port = hub.port;
  const r = await godotLive(['reconnect', dir, 'm1-04', 'review'], async (line) => {
    if (line === 'READY') await hub.app.close();
    if (line === 'STATE offline') {
      const p = join(dir, 'compass', 'tasks', 'm1-04.json');
      await writeFile(p, canonical({ ...JSON.parse(await readFile(p, 'utf8')), status: 'review' }));
      hub = await startHub(port);
    }
  });
  await hub.app.close();
  expectOk(r, 'reconnect');
});

// --- Iniciar el hub desde el dock (5.5) ---
import { createServer as netServer } from 'node:net';

const freePort = () => new Promise((res) => { const s = netServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });

test('"Iniciar hub" levanta scompass serve, el dock pasa a edición y al cerrarlo el hub se va', { skip }, async () => {
  const port = await freePort();
  const cfgPath = join(dir, 'compass', 'config.json');
  await writeFile(cfgPath, canonical({ ...JSON.parse(await readFile(cfgPath, 'utf8')), port }));
  let pid = 0;
  try {
    const r = await godotLive(['start_hub', dir, join(REPO, 'hub', 'bin', 'scompass.js')], (line) => {
      const m = /^PID (\d+)/.exec(line);
      if (m) pid = Number(m[1]);
    });
    expectOk(r, 'start_hub');
    assert.ok(pid > 0);
    await assert.rejects(fetch(`http://127.0.0.1:${port}/api/health`), 'el hub se cerró');
  } finally {
    if (pid) try { process.kill(pid, 'SIGKILL'); } catch {}
  }
});

test('"Iniciar hub" sin scompass encontrable no inventa un comando', { skip }, async () => {
  expectOk(await godotLive(['start_hub_missing', dir]), 'start_hub_missing');
});

// --- El hub lanzado por el dock muere con el editor (5.8) ---
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const waitFor = async (cond, ms) => { const t0 = Date.now(); while (!cond() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 50)); return cond(); };

test('si matan a Godot con kill -9, el hub que abrió el dock se cierra solo', { skip }, async () => {
  const port = await freePort();
  const cfgPath = join(dir, 'compass', 'config.json');
  await writeFile(cfgPath, canonical({ ...JSON.parse(await readFile(cfgPath, 'utf8')), port }));
  let hubPid = 0;
  const p = spawn('godot', ['--headless', '--path', REPO, '--script', 'res://hub/test/godot/runner.gd', '--',
    'start_hub_and_hang', dir, join(REPO, 'hub', 'bin', 'scompass.js')]);
  try {
    await new Promise((resolve, reject) => {
      let buf = '';
      const t = setTimeout(() => reject(new Error('Godot no llegó a READY: ' + buf)), 30000);
      p.stdout.on('data', (d) => {
        buf += d;
        const m = /PID (\d+)/.exec(buf);
        if (m) hubPid = Number(m[1]);
        if (buf.includes('READY')) { clearTimeout(t); resolve(); }
      });
    });
    assert.ok(alive(hubPid), 'el hub corre');
    p.kill('SIGKILL');
    assert.ok(await waitFor(() => !alive(hubPid), 3000), 'el hub sigue vivo 3 s después de matar a Godot');
    await assert.rejects(fetch(`http://127.0.0.1:${port}/api/health`));
  } finally {
    p.kill('SIGKILL');
    if (hubPid && alive(hubPid)) process.kill(hubPid, 'SIGKILL');
  }
});


test('modo "mantener": el hub sigue al cerrar el editor', { skip }, async () => {
  const port = await freePort();
  const cfgPath = join(dir, 'compass', 'config.json');
  await writeFile(cfgPath, canonical({ ...JSON.parse(await readFile(cfgPath, 'utf8')), port }));
  let hubPid = 0;
  try {
    // Sin bus de sesión: el hub no pone el ícono en la bandeja real mientras corren los tests.
    const env = { ...process.env };
    delete env.DBUS_SESSION_BUS_ADDRESS;
    const r = await new Promise((resolve) => {
      const p = spawn('godot', ['--headless', '--path', REPO, '--script', 'res://hub/test/godot/runner.gd', '--',
        'start_hub_keep', dir, join(REPO, 'hub', 'bin', 'scompass.js')], { env });
      let out = '';
      p.stdout.on('data', (d) => { out += d; });
      p.stderr.on('data', (d) => { out += d; });
      p.on('exit', (code) => resolve({ code, out }));
    });
    hubPid = Number(/PID (\d+)/.exec(r.out)?.[1] ?? 0);
    expectOk(r, 'start_hub_keep');
    await new Promise((res) => setTimeout(res, 500));
    assert.ok(alive(hubPid), 'el hub se cerró con Godot');
    assert.equal((await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()).ok, true);
    assert.match(await readFile(join(dir, '.godot', 'scope_compass_hub.log'), 'utf8'), /sin ícono en la bandeja/);
  } finally {
    if (hubPid && alive(hubPid)) process.kill(hubPid, 'SIGTERM');
  }
});

// --- Referencias a documentos en el dock (6.7) ---
const GDD = '# Juego\n<!-- id: juego -->\n\n### Ventanas de ataque\n<!-- id: ventanas-ataque -->\n\nLas ventanas de golpe son datos.\n\n```gdscript\nclass_name AttackData\nextends Resource\n```\n\n## Cámara\n<!-- id: camara -->\n';
async function withDocs() {
  await writeFile(join(dir, 'gdd.md'), GDD);
  const cfgPath = join(dir, 'compass', 'config.json');
  await writeFile(cfgPath, canonical({ ...JSON.parse(await readFile(cfgPath, 'utf8')), docs: [{ alias: 'gdd', path: 'gdd.md' }] }));
  await setTask('m1-04', { refs: [{ doc: 'gdd.md', section: 'ventanas-ataque' }, { doc: 'gdd.md', section: 'borrada' }] });
}

test('dock con hub: la referencia se despliega con el texto en BBCode y el snippet en un CodeEdit con resaltado', { skip }, async () => {
  await withDocs();
  const hub = await startHub();
  const r = await godotLive(['refs_online', dir, 'm1-04']);
  await hub.app.close();
  expectOk(r, 'refs_online');
});

test('dock sin hub: la referencia se arma con el markdown de disco, con el snippet en un CodeEdit', { skip }, async () => {
  await withDocs();
  expectOk(await godot('refs_offline', dir, 'm1-04'), 'refs_offline');
});

test('dock: un paso con detalle se despliega con ▸', { skip }, async () => {
  const p = join(dir, 'compass', 'tasks', 'm1-04.json');
  const t = JSON.parse(await readFile(p, 'utf8'));
  t.checklist[0].detail = 'Detalle con `código` largo';
  await writeFile(p, canonical(t));
  expectOk(await godot('step_detail', dir, 'm1-04', 'Detalle con código largo'), 'step_detail');
});
