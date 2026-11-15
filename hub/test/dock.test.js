// Tests del dock de Godot (M5): lanza Godot sin ventana con hub/test/godot/runner.gd sobre una copia del fixture.
import './isolate.js';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical } from '../src/store/canonical.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = join(REPO, 'hub', 'test', 'fixtures', 'compass');
// El binario: GODOT, o godot en el PATH. Sin ninguno, los tests se saltean; si está pero no arranca (por ejemplo,
// el wrapper de godot-manager con una .godot-version que ya no está instalada) fallan con el motivo, en vez de
// saltearse en silencio como si no hubiera Godot.
const GODOT = process.env.GODOT || 'godot';
const godotError = (() => {
  try { execFileSync(GODOT, ['--version'], { stdio: 'pipe' }); return null; }
  catch (e) { return e.code === 'ENOENT' ? 'missing' : String(e.stderr || e.stdout || e.message).trim(); }
})();
const hasGodot = godotError === null;
const skip = godotError === 'missing' && `sin Godot: ${GODOT} no está (poné GODOT=<binario> o godot en el PATH)`;
let dir;
// Registro, config y datos propios aunque se corra sin npm test: con el registro real, el Inicio del usuario
// serviría los proyectos temporales (y los anotaría en su projects.json). Godot y scompass heredan process.env.
const ISOLATED = mkdtempSync(join(tmpdir(), 'scompass-dock-env-'));
Object.assign(process.env, { SCOMPASS_REGISTRY: join(ISOLATED, 'registry'), SCOMPASS_CONFIG: join(ISOLATED, 'config'), SCOMPASS_DATA: join(ISOLATED, 'data') });
// Los íconos del addon se usan con preload: en un clon nuevo Godot tiene que importarlos primero.
import { before, after } from 'node:test';
after(() => rmSync(ISOLATED, { recursive: true, force: true, maxRetries: 10 }));
// Con un reintento: con la suite entera en paralelo, Godot 4.8 a veces aborta al salir del --import. El hilo que
// carga la documentación deja diferido EditorHelp::load_script_doc_cache, que corre con el EditorNode ya borrado
// ("Parameter "singleton" is null" en is_cmdline_mode). Es del motor, de tiempos, y la importación ya terminó.
before(() => {
  if (godotError === 'missing') return;
  if (!hasGodot) throw new Error(`${GODOT} --version falló:\n${godotError}`);
  for (let i = 0; ; i++) {
    try { execFileSync(GODOT, ['--headless', '--path', REPO, '--import'], { stdio: 'pipe', timeout: 120000, maxBuffer: 16 << 20 }); return; }
    catch (e) {
      if (i === 0) continue;
      // 4.8-beta1 se cuelga en --import con un .godot/editor/editor_layout.cfg guardado por una versión anterior.
      const hint = /Message queue out of memory/.test(String(e.stdout) + String(e.stderr)) ? '\nProbá moviendo .godot/editor/editor_layout.cfg (layout de otra versión de Godot).' : '';
      throw new Error(`godot --import falló (${e.signal ?? e.status ?? e.code}):${hint}\n${String(e.stdout ?? '').split('\n').slice(-20).join('\n')}\n${String(e.stderr ?? '').slice(-3000)}`);
    }
  }
});

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'scompass-dock-'));
  await cp(FIXTURE, join(dir, 'compass'), { recursive: true });
  await setTask('m1-03', { status: 'doing' });
  await setTask('m1-05', { status: 'review' });
});
afterEach(() => rm(dir, { recursive: true, force: true, maxRetries: 10 }));

async function setConfig(changes) {
  const p = join(dir, 'compass', 'config.json');
  await writeFile(p, canonical({ ...JSON.parse(await readFile(p, 'utf8')), ...changes }));
}

async function setTask(id, changes) {
  const p = join(dir, 'compass', 'tasks', `${id}.json`);
  await writeFile(p, canonical({ ...JSON.parse(await readFile(p, 'utf8')), ...changes }));
}

function godot(...args) {
  return new Promise((resolve) => {
    execFile(GODOT, ['--headless', '--path', REPO, '--script', 'res://hub/test/godot/runner.gd', '--', ...args],
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
    const p = spawn(GODOT, ['--headless', '--path', REPO, '--script', 'res://hub/test/godot/runner.gd', '--', ...args]);
    let out = '', buf = '';
    const t = setTimeout(() => p.kill('SIGKILL'), 60000);
    const feed = (d) => {
      out += d; buf += d;
      let i;
      // Godot en Windows termina las líneas con \r\n.
      while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1); Promise.resolve(onLine(line)).catch((e) => { out += `\nnode: ${e.stack}`; }); }
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

test('§39: con un hub del mismo protocolo no hay aviso, aunque la versión sea otra', { skip }, async () => {
  const hub = await startHub();
  const r = await godotLive(['protocol_ok', dir]);
  await hub.app.close();
  expectOk(r, 'protocol_ok');
});

test('§39: un hub de otro protocolo no se usa: solo lectura y el aviso ofrece el scompass del addon', { skip }, async () => {
  // Un scompass anterior a §39: /api/health sin protocol.
  const { createServer: httpServer } = await import('node:http');
  const old = httpServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(req.url === '/api/health' ? JSON.stringify({ ok: true, name: 'scope-compass', version: '0.0.1', project: dir, pid: 1 }) : '{}');
  });
  await new Promise((r) => old.listen(0, '127.0.0.1', r));
  await setConfig({ port: old.address().port });
  const r = await godot('protocol_mismatch', dir);
  await new Promise((res) => old.close(res));
  expectOk(r, 'protocol_mismatch');
});

test('§39: el updater del addon elige el zip del release, valida la versión e instala', { skip }, async () => {
  expectOk(await godot('updater'), 'updater');
});

test('§39: el aviso de versión nueva del addon y Después; en el repo no busca', { skip }, async () => {
  expectOk(await godot('addon_update', dir), 'addon_update');
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

test('proyecto sin compass/: el dock no da errores y "Crear compass/" corre scompass init', { skip }, async () => {
  await rm(join(dir, 'compass'), { recursive: true });
  const r = await godotLive(['init_compass', dir, join(REPO, 'hub', 'bin', 'scompass.js')]);
  expectOk(r, 'init_compass');
  assert.doesNotMatch(r.out, /ERROR/);
  assert.equal(JSON.parse(await readFile(join(dir, 'compass', 'config.json'), 'utf8')).port, 4711);
  // Por defecto, la plantilla juego: el hito M0, las listas y el GDD.
  assert.equal(JSON.parse(await readFile(join(dir, 'compass', 'milestones', 'm00.json'), 'utf8')).title, 'Prototipo');
  assert.ok(existsSync(join(dir, 'compass', 'lists', 'assets-a-conseguir.json')));
  assert.ok(existsSync(join(dir, 'docs', 'gdd.md')));
});

test('"Crear compass/" con la plantilla vacío no trae datos', { skip }, async () => {
  await rm(join(dir, 'compass'), { recursive: true });
  expectOk(await godotLive(['init_compass', dir, join(REPO, 'hub', 'bin', 'scompass.js'), 'vacio']), 'init_compass');
  assert.ok(!existsSync(join(dir, 'compass', 'lists')));
  assert.ok(!existsSync(join(dir, 'docs', 'gdd.md')));
});

test('compass/ con el schema viejo: el dock avisa y "Actualizar" corre scompass update', { skip }, async () => {
  const schema = join(dir, 'compass', 'schema', 'task.schema.json');
  await writeFile(schema, '{}\n');
  await cp(join(REPO, 'hub', 'templates', 'compass-AGENTS.md'), join(dir, 'compass', 'AGENTS.md'));
  expectOk(await godotLive(['update_compass', dir, join(REPO, 'hub', 'bin', 'scompass.js')]), 'update_compass');
  assert.equal(await readFile(schema, 'utf8'), await readFile(join(REPO, 'schema', 'task.schema.json'), 'utf8'));
});

test('con el Inicio corriendo, el dock se conecta solo al Inicio (sin levantar otro proceso ni apretar "Iniciar hub") y escribe por ahí', { skip }, async () => {
  const bin = join(REPO, 'hub', 'bin', 'scompass.js');
  execFileSync(process.execPath, [bin, 'home', 'add', dir], { env: process.env });
  const home = spawn(process.execPath, [bin, 'home', '--port', '0', '--json'], { env: process.env });
  let out = '';
  home.stdout.on('data', (d) => { out += d; });
  try {
    for (let i = 0; i < 100 && !out.includes('url'); i++) await new Promise((r) => setTimeout(r, 50));
    const url = JSON.parse(out.split('\n')[0]).url;
    let id = '';
    const r = await godotLive(['start_hub_home', dir, bin], (line) => { const m = /^TASK (\S+)/.exec(line); if (m) id = m[1]; });
    expectOk(r, 'start_hub_home');
    assert.equal(JSON.parse(await readFile(join(dir, 'compass', 'tasks', `${id}.json`), 'utf8')).status, 'review');
    const p = (await (await fetch(url + 'api/projects')).json()).projects.find((x) => x.path === dir);
    assert.equal(p.served, 'home');
  } finally {
    home.kill('SIGKILL');
  }
});

test('"Iniciar hub" sin scompass encontrable no inventa un comando', { skip }, async () => {
  expectOk(await godotLive(['start_hub_missing', dir]), 'start_hub_missing');
});

test('sin scompass en el PATH, el dock usa la instalación que scompass anotó en la carpeta de datos (§37)', { skip }, async () => {
  const data = await mkdtemp(join(tmpdir(), 'scompass-data-'));
  try {
    expectOk(await godot('recorded_command', dir, data), 'recorded_command');
  } finally {
    await rm(data, { recursive: true, force: true });
  }
});

// --- El hub lanzado por el dock muere con el editor (5.8) ---
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const waitFor = async (cond, ms) => { const t0 = Date.now(); while (!cond() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 50)); return cond(); };

test('si matan a Godot con kill -9, el hub que abrió el dock se cierra solo', { skip }, async () => {
  const port = await freePort();
  const cfgPath = join(dir, 'compass', 'config.json');
  await writeFile(cfgPath, canonical({ ...JSON.parse(await readFile(cfgPath, 'utf8')), port }));
  let hubPid = 0;
  const p = spawn(GODOT, ['--headless', '--path', REPO, '--script', 'res://hub/test/godot/runner.gd', '--',
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
      const p = spawn(GODOT, ['--headless', '--path', REPO, '--script', 'res://hub/test/godot/runner.gd', '--',
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
    // El log del hub (sh en Linux, --log en Windows). En Linux, sin bus no hay ícono; en Windows la bandeja no usa D-Bus.
    const log = await readFile(join(dir, '.godot', 'scope_compass_hub.log'), 'utf8');
    assert.match(log, /Scope Compass en http:\/\/127\.0\.0\.1:\d+\//);
    if (process.platform !== 'win32') assert.match(log, /sin ícono en la bandeja/);
    else assert.doesNotMatch(log, /sin ícono/);
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
  await setTask('m1-04', { refs: [{ doc: 'gdd.md', section: 'ventanas-ataque' }, { doc: 'gdd.md', section: 'borrada' }, { doc: 'gdd.md' }, { doc: 'otro.md' }] });
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

test('dock sin hub: los patrones de documentos se expanden con las reglas del hub', { skip }, async () => {
  const { mkdir } = await import('node:fs/promises');
  const { loadDocs } = await import('../src/docs.js');
  for (const f of ['gdd.md', 'docs/tareas.md', 'docs/enemigos.md', 'docs/arte/paleta.md', 'docs/arte/notas.txt', 'docs/.oculto.md', 'docs/node_modules/x.md', 'docs/b (copia).md']) {
    await mkdir(dirname(join(dir, f)), { recursive: true });
    await writeFile(join(dir, f), '# ' + f + '\n');
  }
  const cfgPath = join(dir, 'compass', 'config.json');
  const config = { ...JSON.parse(await readFile(cfgPath, 'utf8')), export_md: 'docs/tareas.md',
    docs: [{ alias: 'gdd', path: 'gdd.md' }, { alias: 'docs', path: 'docs/**/*.md' }, { alias: 'enemigos', path: 'docs/enemigos.md' }, { alias: 'raiz', path: 'docs/*.md' }] };
  await writeFile(cfgPath, canonical(config));
  const expected = (await loadDocs(dir, config)).map((d) => [d.alias, d.path]);
  assert.deepEqual(expected.map((x) => x[0]), ['gdd', 'docs/arte/paleta', 'docs/b (copia)', 'enemigos', 'raiz/b (copia)']);
  expectOk(await godot('read_docs', dir, JSON.stringify(expected)), 'read_docs');
});

test('dock: tocar el texto de un paso despliega su detalle (no lo tilda)', { skip }, async () => {
  const p = join(dir, 'compass', 'tasks', 'm1-04.json');
  const t = JSON.parse(await readFile(p, 'utf8'));
  t.checklist[0].detail = 'Detalle con `código` largo';
  await writeFile(p, canonical(t));
  expectOk(await godot('step_detail', dir, 'm1-04', 'Detalle con código largo'), 'step_detail');
});

test('dock: la fecha límite se ve en la lista y en el detalle; vencida y de hoy se marcan', { skip }, async () => {
  const pad = (n) => String(n).padStart(2, '0');
  const d = new Date();
  await setTask('m1-04', { status: 'todo', due: '2020-01-01' });
  await setTask('m1-05', { status: 'todo', due: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T23:59` });
  await setTask('m1-03', { status: 'done', due: '2020-01-01' });
  expectOk(await godot('due', dir, 'm1-04', 'm1-05', 'm1-03', 'm1-07'), 'due');
});

test('dock: una tarea desbloqueada en revisión se marca, y el vínculo del detalle lleva a la otra tarea', { skip }, async () => {
  await setTask('m1-05', { links: [{ task: 'm1-03', type: 'blocks' }] });
  expectOk(await godot('links', dir, 'm1-03', 'm1-05'), 'links');
});

test('dock: "Reiniciar hub" vuelve a conectar, y el hub nuevo se cierra con el dock', { skip }, async () => {
  const port = await freePort();
  const cfgPath = join(dir, 'compass', 'config.json');
  await writeFile(cfgPath, canonical({ ...JSON.parse(await readFile(cfgPath, 'utf8')), port }));
  const env = { ...process.env };
  delete env.DBUS_SESSION_BUS_ADDRESS;
  let pids = [];
  try {
    const r = await new Promise((resolve) => {
      const p = spawn(GODOT, ['--headless', '--path', REPO, '--script', 'res://hub/test/godot/runner.gd', '--', 'restart_hub', dir, join(REPO, 'hub', 'bin', 'scompass.js')], { env });
      let out = '';
      p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
      p.on('exit', (code) => resolve({ code, out }));
    });
    pids = (/PIDS (\d+) (\d+)/.exec(r.out) ?? []).slice(1).map(Number);
    expectOk(r, 'restart_hub');
  } finally {
    for (const pid of pids) if (alive(pid)) process.kill(pid, 'SIGKILL');
  }
});

test('dock: el bloque de tareas se pliega y el divisor lista/detalle se recuerda', { skip }, async () => {
  expectOk(await godot('split', dir), 'split');
});

test('dock: los botones usan los íconos de assets/', { skip }, async () => {
  expectOk(await godot('icons', dir), 'icons');
});

test('dock: el aviso dice por qué no hay hub (otro proyecto) y "Reintentar" encuentra el correcto', { skip }, async () => {
  // En el puerto de la config corre el hub de OTRO proyecto.
  const other = await mkdtemp(join(tmpdir(), 'scompass-otro-'));
  await cp(FIXTURE, join(other, 'compass'), { recursive: true });
  const port = await freePort();
  const cfgPath = join(dir, 'compass', 'config.json');
  await writeFile(cfgPath, canonical({ ...JSON.parse(await readFile(cfgPath, 'utf8')), port }));
  const V2 = loadValidators();
  let app = createServer({ projectDir: other, store: createJsonFilesStore(join(other, 'compass'), { validators: V2 }) });
  await listen(app, port);
  try {
    const r = await godotLive(['detect_reason', dir, 'otro proyecto'], async (line) => {
      if (line !== 'READY') return;
      await app.close();
      app = createServer({ projectDir: dir, store: createJsonFilesStore(join(dir, 'compass'), { validators: V2 }), validators: V2, watch: true });
      await listen(app, port);
      await writeFile(join(dir, '.go'), '');
    });
    expectOk(r, 'detect_reason');
  } finally {
    await app.close();
    await rm(other, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('dock: encuentra el hub por el registro aunque no esté en el puerto de la config', { skip }, async () => {
  const { registerHub, unregisterHub } = await import('../src/registry.js');
  const hub = await startHub();
  // La config apunta a un puerto donde no hay nadie; el registro dice el puerto real.
  const cfgPath = join(dir, 'compass', 'config.json');
  await writeFile(cfgPath, canonical({ ...JSON.parse(await readFile(cfgPath, 'utf8')), port: 1 }));
  registerHub({ port: hub.port, project: dir });
  try {
    expectOk(await godotLive(['registry', dir, String(hub.port)]), 'registry');
  } finally {
    unregisterHub();
    await hub.app.close();
  }
});

test('dock: sin hub al abrir, el sondeo lo encuentra en otro puerto que la config y no vuelve al de la config', { skip }, async () => {
  const { registerHub, unregisterHub } = await import('../src/registry.js');
  const cfgPath = join(dir, 'compass', 'config.json');
  await writeFile(cfgPath, canonical({ ...JSON.parse(await readFile(cfgPath, 'utf8')), port: 1 }));
  const app = createServer({ projectDir: dir, store: createJsonFilesStore(join(dir, 'compass'), { validators: V }), validators: V });
  const { port } = await listen(app, 0);
  try {
    const r = await godotLive(['poll_registry', dir, String(port)], (line) => { if (line === 'READY') registerHub({ port, project: dir }); });
    expectOk(r, 'poll_registry');
  } finally {
    unregisterHub();
    await app.close();
  }
});

test('dock: etiquetas, prioridad y responsable en la lista y el detalle, la descripción, las capturas y el hito atrasado; el botón de Archivos según views', { skip }, async () => {
  await setTask('m1-04', { status: 'todo', priority: 'high', size: 'm', assignee: 'ana', tags: ['arte', 'audio'], description: 'Qué hacer y `por qué`', images: ['shot.png', 'falta.png'] });
  await writeFile(join(dir, 'shot.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
  await setTask('m1-05', { priority: 'low' });
  // Fecha objetivo del hito (18.2): m01 tiene m1-04 sin terminar, así que está atrasado.
  const mp = join(dir, 'compass', 'milestones', 'm01.json');
  await writeFile(mp, canonical({ ...JSON.parse(await readFile(mp, 'utf8')), due: '2020-01-01' }));
  expectOk(await godot('props', dir, 'm1-04', 'm1-05', 'm1-07'), 'props');
});

test('19.9: dock: las capturas se decodifican una vez, un GIF es un botón con el nombre y sin hub el poll no relee si nada cambió', { skip }, async () => {
  await setTask('m1-04', { status: 'todo', images: ['shot.png', 'anim.gif'] });
  await writeFile(join(dir, 'shot.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
  await writeFile(join(dir, 'anim.gif'), Buffer.from('R0lGODlhAQABAIAAAP///wAAACwAAAAAAQABAAACAkQBADs=', 'base64'));
  const r = await godot('thumbs', dir, 'm1-04');
  expectOk(r, 'thumbs');
  assert.doesNotMatch(r.out, /SCRIPT ERROR|ERROR: /);
});

test('19.9: con hub: mover el dock (sacarlo del árbol y volverlo a poner) lo reconecta', { skip }, async () => {
  const hub = await startHub();
  const r = await godotLive(['reparent', dir]);
  await hub.app.close();
  expectOk(r, 'reparent');
});

test('19.10: dock sin hub: links, pasos o referencias de otra forma van a los avisos sin romper el render', { skip }, async () => {
  await setTask('m1-04', { links: ['m0-01'] });
  await setTask('m1-05', { checklist: ['texto'] });
  await setTask('m1-06', { refs: ['spec'] });
  const r = await godot('bad_shapes', dir);
  expectOk(r, 'bad_shapes');
  assert.doesNotMatch(r.out, /SCRIPT ERROR/);
});

test('19.10: con hub: un guardado o una creación que fallan no mienten, y Reiniciar hub no se ofrece en el Inicio', { skip }, async () => {
  const hub = await startHub();
  const r = await godotLive(['failed_writes', dir, 'm1-04']);
  await hub.app.close();
  expectOk(r, 'failed_writes');
});

test('19.11: dock: entra en 300 px con un error largo y con hub; la tarea se abre en el navegador', { skip }, async () => {
  expectOk(await godot('narrow', dir, 'm1-04'), 'narrow');
});

test('dock: los archivos de la tarea se listan en el detalle y un clic los abre en el editor', { skip }, async () => {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(dir, 'src'));
  await mkdir(join(dir, 'docs'));
  await writeFile(join(dir, 'src', 'player.gd'), 'extends Node\n');
  await writeFile(join(dir, 'docs', 'notas.md'), '# Notas\n');
  await setTask('m1-04', { status: 'todo', files: ['src/player.gd', 'docs/notas.md', 'src/borrado.gd'] });
  expectOk(await godot('task_files', dir, 'm1-04', 'm1-05'), 'task_files');
});

test('con hub: el dock muestra las tareas del script abierto y vincula el abierto a la tarea elegida', { skip }, async () => {
  await setTask('m1-04', { status: 'todo', files: ['src/player.gd'] });
  await setTask('m1-06', { status: 'done', files: ['src/player.gd'] }); // terminada: no aparece
  const hub = await startHub();
  const r = await godotLive(['editing', dir, 'm1-04', 'm1-05']);
  await hub.app.close();
  expectOk(r, 'editing');
  assert.deepEqual((await task('m1-05')).files, ['src/player.gd']);
});

test('21.3: dock sin hub: la lista marca anda / falla y el detalle muestra el resultado y la nota del playtest', { skip }, async () => {
  await setTask('m1-05', { playtest: { result: 'fail', note: 'Se traba\nal saltar' } });
  await setTask('m1-04', { playtest: { result: 'pass' } });
  expectOk(await godot('playtest', dir, 'm1-05', 'm1-04', 'm1-03'), 'playtest');
});

test('24.9: dock sin hub: la lista marca las decisiones que esperan y el detalle las muestra', { skip }, async () => {
  await setTask('m1-05', { decisions: [{ text: 'Usar X', why: 'porque', at: '2026-10-01T00:00:00Z' }, { text: '¿A o B?', asked: true, at: '2026-10-01T00:00:01Z' }, { text: 'Y', review: 'ok', at: '2026-10-01T00:00:02Z' }] });
  expectOk(await godot('decisions', dir, 'm1-05', 'm1-04'), 'decisions');
});

test('24.9: con hub: Revertir en el dock marca la decisión a revertir', { skip }, async () => {
  await setTask('m1-05', { decisions: [{ text: 'Usar X', at: '2026-10-01T00:00:00Z' }, { text: '¿A o B?', asked: true, at: '2026-10-01T00:00:01Z' }] });
  const hub = await startHub();
  const r = await godotLive(['decisions_online', dir, 'm1-05']);
  await hub.app.close();
  expectOk(r, 'decisions_online');
  assert.deepEqual((await task('m1-05')).decisions.map((d) => d.review), ['revert', undefined]);
});

test('21.3: con hub: Anda / Falla del dock escriben en la tarea, conservan la nota y otro clic lo quita', { skip }, async () => {
  await setTask('m1-05', { playtest: { result: 'fail', note: 'Se traba' } });
  await setTask('m1-04', { playtest: { result: 'pass' } });
  const hub = await startHub();
  const r = await godotLive(['playtest_online', dir, 'm1-05', 'm1-04']);
  await hub.app.close();
  expectOk(r, 'playtest_online');
  assert.deepEqual((await task('m1-05')).playtest, { note: 'Se traba' });
  assert.equal((await task('m1-04')).playtest, undefined);
});

test('21.5: dock: la búsqueda filtra por código, título o id en todos los hitos, sin tildes', { skip }, async () => {
  await setTask('m1-05', { title: 'Menú de pausa' });
  expectOk(await godot('search', dir), 'search');
});

test('21.4: con hub: Bug desde el dock carga la tarea con la etiqueta bug, su plantilla y la captura en compass/images/', { skip }, async () => {
  const cfgPath = join(dir, 'compass', 'config.json');
  const template = 'Cómo reproducirlo:\n1. \n\nQué pasó:';
  await writeFile(cfgPath, canonical({ ...JSON.parse(await readFile(cfgPath, 'utf8')), description_templates: { bug: template } }));
  const hub = await startHub();
  const r = await godotLive(['bug', dir]);
  await hub.app.close();
  expectOk(r, 'bug');
  const t = await task(/BUG (\S+)/.exec(r.out)[1]);
  assert.deepEqual(t.tags, ['bug']);
  assert.equal(t.description, template);
  assert.equal(t.milestone, 'm02');
  assert.match(t.images[0], /^compass\/images\/.+\.png$/);
  const png = await readFile(join(dir, t.images[0]));
  assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG');
  const bare = await task(/NOSHOT (\S+)/.exec(r.out)[1]);
  assert.deepEqual(bare.tags, ['bug']);
  assert.equal(bare.images, undefined);
});

// La captura del juego va por un pedido interno del depurador de Godot (scene:rq_screenshot, el de la pestaña Game): si
// una versión nueva lo cambia, este test falla. Corre un editor de verdad en una pantalla virtual (Xvfb) sobre un
// proyecto con una escena roja; un plugin de prueba corre la escena y pide las capturas con game_shot.gd y el plugin.
const hasXvfb = process.platform === 'linux' && (() => { try { execFileSync('xvfb-run', ['--help'], { stdio: 'pipe' }); return true; } catch (e) { return e.code !== 'ENOENT'; } })();
const PROBE = `@tool
extends EditorPlugin
const GameShot := preload("res://addons/scope_compass/game_shot.gd")
var shots

func _enter_tree() -> void:
	shots = GameShot.new()
	add_debugger_plugin(shots)
	_run.call_deferred()

func _run() -> void:
	await get_tree().create_timer(2.0).timeout
	var plugin = load("res://addons/scope_compass/scope_compass.gd").new()
	EditorInterface.set_main_screen_editor("2D")
	var ed = await plugin._editor_image()
	print("PROBE editor ", ed.get_width() if ed else 0, " ", get_tree().root.size.x)
	print("PROBE before ", shots.running())
	EditorInterface.play_main_scene()
	for i in 100:
		await get_tree().create_timer(0.1).timeout
		if shots.running(): break
	await get_tree().create_timer(1.5).timeout
	var img = await shots.game_image()
	print("PROBE game ", img.get_width() if img else 0, " ", img.get_pixel(10, 10).to_html(false) if img else "")
	EditorInterface.stop_playing_scene()
	await get_tree().create_timer(0.5).timeout
	get_tree().quit()
`;

test('21.4: con Xvfb: el editor le pide la captura al juego que corre (game_shot.gd) y recorta el viewport 2D', { skip: skip || (!hasXvfb && 'sin xvfb-run') }, async () => {
  const { mkdir } = await import('node:fs/promises');
  const proj = await mkdtemp(join(tmpdir(), 'scompass-shot-'));
  try {
    await cp(join(REPO, 'addons', 'scope_compass'), join(proj, 'addons', 'scope_compass'), { recursive: true });
    await mkdir(join(proj, 'addons', 'probe'));
    await writeFile(join(proj, 'addons', 'probe', 'plugin.cfg'), '[plugin]\nname="probe"\ndescription=""\nauthor=""\nversion="0"\nscript="probe.gd"\n');
    await writeFile(join(proj, 'addons', 'probe', 'probe.gd'), PROBE);
    await writeFile(join(proj, 'project.godot'), 'config_version=5\n\n[application]\nconfig/name="probe"\nrun/main_scene="res://main.tscn"\n\n[editor_plugins]\nenabled=PackedStringArray("res://addons/probe/plugin.cfg")\n\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n');
    await writeFile(join(proj, 'main.tscn'), '[gd_scene format=3]\n\n[node name="Main" type="Node2D"]\n\n[node name="Red" type="ColorRect" parent="."]\noffset_right = 300.0\noffset_bottom = 200.0\ncolor = Color(1, 0, 0, 1)\n');
    // La misma versión de Godot que el repo (el wrapper de godot-manager la lee de .godot-version).
    await cp(join(REPO, '.godot-version'), join(proj, '.godot-version')).catch(() => {});
    execFileSync(GODOT, ['--headless', '--path', proj, '--import'], { stdio: 'pipe', timeout: 120000 });
    const out = await new Promise((resolve) => execFile('xvfb-run', ['-a', '-s', '-screen 0 1600x900x24', GODOT, '--path', proj, '--editor'],
      { cwd: proj, timeout: 90000, env: { ...process.env, SCOMPASS_REGISTRY: join(proj, 'registry') } }, (err, stdout, stderr) => resolve(stdout + stderr)));
    const editor = /PROBE editor (\d+) (\d+)/.exec(out);
    assert.ok(editor, out.slice(-3000));
    assert.ok(Number(editor[1]) > 0 && Number(editor[1]) < Number(editor[2]), `el recorte del viewport 2D: ${editor[0]}`);
    assert.match(out, /PROBE before false/);
    assert.match(out, /PROBE game [1-9]\d* ff0000/, out.split('\n').filter((l) => /PROBE|ERROR/.test(l)).join('\n'));
  } finally {
    await rm(proj, { recursive: true, force: true, maxRetries: 10 });
  }
});
