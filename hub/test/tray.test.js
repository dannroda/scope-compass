// Bandeja del sistema (5.9) en un bus D-Bus privado: el test hace de Plasma (StatusNotifierWatcher)
// y habla con el ícono como lo haría el escritorio. No toca la bandeja real.
import './isolate.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmod, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dbus from '@homebridge/dbus-native';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = join(REPO, 'hub', 'test', 'fixtures', 'compass');
const hasDaemon = (() => { try { execFileSync('dbus-daemon', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const skip = !hasDaemon && 'sin dbus-daemon';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let dir, daemon, address, watcherBus, registered;

before(async () => {
  if (!hasDaemon) return;
  dir = await mkdtemp(join(tmpdir(), 'scompass-tray-'));
  daemon = spawn('dbus-daemon', ['--session', '--nofork', '--print-address=1', `--address=unix:path=${join(dir, 'bus')}`]);
  address = await new Promise((resolve) => daemon.stdout.once('data', (d) => resolve(String(d).trim())));
  // Plasma de mentira: registra los ícones que se anuncian.
  watcherBus = dbus.sessionBus({ busAddress: address });
  await new Promise((r) => watcherBus.connection.once('connect', r));
  await new Promise((r, j) => watcherBus.requestName('org.kde.StatusNotifierWatcher', 0x4, (e) => (e ? j(e) : r())));
  registered = [];
  watcherBus.exportInterface({ RegisterStatusNotifierItem: (s) => { registered.push(s); } }, '/StatusNotifierWatcher', {
    name: 'org.kde.StatusNotifierWatcher', methods: { RegisterStatusNotifierItem: ['s', ''] }, properties: {}, signals: {}
  });
});
after(async () => {
  watcherBus?.connection.end();
  daemon?.kill();
  if (dir) await rm(dir, { recursive: true, force: true, maxRetries: 10 });
});

const call = (service, path, iface, member, signature, body) => new Promise((resolve, reject) =>
  watcherBus.invoke({ destination: service, path, interface: iface, member, signature, body }, (err, ...res) => (err ? reject(err) : resolve(res))));
// Un variant llega como [firma, [valor]]: devuelve el valor.
const prop = async (service, name) => (await call(service, '/StatusNotifierItem', 'org.freedesktop.DBus.Properties', 'Get', 'ss', ['org.kde.StatusNotifierItem', name]))[0][1][0];
// Los ítems visibles del menú, como los mostraría el escritorio: [{ id, label }].
async function menuItems(service) {
  const [, layout] = await call(service, '/MenuBar', 'com.canonical.dbusmenu', 'GetLayout', 'iias', [0, -1, []]);
  const get = (v, k) => v[1][0][1].find(([x]) => x === k)[1][1][0];
  return layout[2].filter((v) => get(v, 'visible')).map((v) => ({ id: v[1][0][0], label: get(v, 'label') }));
}

test('serve --tray: se registra en la bandeja, muestra el proyecto y el menú cierra el hub', { skip }, async () => {
  const project = join(dir, 'proyecto');
  await cp(FIXTURE, join(project, 'compass'), { recursive: true });
  await cp(join(REPO, 'hub', 'templates', 'compass-AGENTS.md'), join(project, 'compass', 'AGENTS.md'));
  const opener = join(dir, 'open.sh');
  await writeFile(opener, `#!/bin/sh\necho "$1" > "${join(dir, 'opened')}"\n`);
  await chmod(opener, 0o755);
  const hub = spawn(process.execPath, [join(REPO, 'hub', 'bin', 'scompass.js'), '--dir', project, 'serve', '--port', '0', '--tray'], {
    env: { ...process.env, DBUS_SESSION_BUS_ADDRESS: address, SCOMPASS_OPEN: opener }
  });
  let out = '';
  hub.stdout.on('data', (d) => { out += d; });
  hub.stderr.on('data', (d) => { out += d; });
  const exited = new Promise((r) => hub.on('exit', r));
  try {
    for (let i = 0; i < 60 && !registered.some((s) => s.includes(String(hub.pid))); i++) await sleep(50);
    const service = registered.find((s) => s.includes(String(hub.pid)));
    assert.ok(service, `no se registró en la bandeja: ${out}`);
    const url = /(http:\/\/127\.0\.0\.1:\d+\/)/.exec(out)[1];

    const tip = await prop(service, 'ToolTip');
    assert.equal(tip[2], 'Scope Compass');
    assert.equal(tip[3], `Scope Compass · ${url}`);
    const pixmaps = await prop(service, 'IconPixmap');
    assert.deepEqual(pixmaps.map((p) => [p[0], p[1], p[2].length]), [[22, 22, 22 * 22 * 4], [44, 44, 44 * 44 * 4]]);

    // Con compass/ al día, "Actualizar compass/" no se ve.
    assert.deepEqual(await menuItems(service), [{ id: 1, label: 'Abrir tablero' }, { id: 3, label: 'Reiniciar hub' }, { id: 4, label: 'Detener hub' }]);

    await call(service, '/StatusNotifierItem', 'org.kde.StatusNotifierItem', 'Activate', 'ii', [0, 0]);
    for (let i = 0; i < 40 && !existsSync(join(dir, 'opened')); i++) await sleep(50);
    assert.equal((await readFile(join(dir, 'opened'), 'utf8')).trim(), url, 'clic en el ícono abre el tablero');

    // Con un tablero abierto que puede notificar: el clic no abre otra pestaña, le manda `focus` a esa.
    await rm(join(dir, 'opened'));
    const tab = new WebSocket(url.replace('http', 'ws') + 'ws');
    const focused = new Promise((r) => tab.addEventListener('message', (e) => { if (JSON.parse(e.data).type === 'focus') r(true); }));
    await new Promise((r) => tab.addEventListener('open', r));
    tab.send(JSON.stringify({ type: 'presence', notify: true }));
    await sleep(100);
    await call(service, '/StatusNotifierItem', 'org.kde.StatusNotifierItem', 'Activate', 'ii', [0, 0]);
    assert.equal(await Promise.race([focused, sleep(2000).then(() => false)]), true, 'la pestaña abierta no recibió focus');
    await sleep(200);
    assert.ok(!existsSync(join(dir, 'opened')), 'abrió otra pestaña con el tablero ya abierto');
    // Cerrada esa pestaña, vuelve a abrir el navegador.
    tab.close();
    await sleep(200);
    await call(service, '/StatusNotifierItem', 'org.kde.StatusNotifierItem', 'Activate', 'ii', [0, 0]);
    for (let i = 0; i < 40 && !existsSync(join(dir, 'opened')); i++) await sleep(50);
    assert.ok(existsSync(join(dir, 'opened')), 'sin tablero abierto no abrió el navegador');

    // "Reiniciar hub": el proceso termina y vuelve otro, que se registra de nuevo en la bandeja.
    await call(service, '/MenuBar', 'com.canonical.dbusmenu', 'Event', 'isvu', [3, 'clicked', ['s', ''], 0]);
    assert.equal(await Promise.race([exited, sleep(3000).then(() => 'sigue vivo')]), 0, 'el viejo terminó');
    let again;
    for (let i = 0; i < 60 && !(again = registered.find((s) => !s.includes(String(hub.pid)))); i++) await sleep(50);
    assert.ok(again, 'el hub nuevo no se registró en la bandeja');
    const newPid = Number(/StatusNotifierItem-(\d+)-1/.exec(again)[1]);
    await sleep(300);
    const health = await fetch(url + 'api/health').then((r) => r.json()).catch((e) => { throw new Error(`sin hub tras reiniciar (${e.cause?.code}); salida: ${out}`); });
    assert.equal(health.pid, newPid, 'mismo puerto, otro PID');
    // "Detener hub" en el nuevo.
    await call(again, '/MenuBar', 'com.canonical.dbusmenu', 'Event', 'isvu', [4, 'clicked', ['s', ''], 0]);
    for (let i = 0; i < 60; i++) { try { process.kill(newPid, 0); await sleep(50); } catch { break; } }
    assert.throws(() => process.kill(newPid, 0), '"Detener hub" cierra el hub');
  } finally {
    hub.kill('SIGKILL');
  }
});

test('serve --tray: "Actualizar compass/" aparece con el schema viejo y lo pone al día', { skip }, async () => {
  const project = join(dir, 'viejo');
  await cp(FIXTURE, join(project, 'compass'), { recursive: true });
  await cp(join(REPO, 'hub', 'templates', 'compass-AGENTS.md'), join(project, 'compass', 'AGENTS.md'));
  const schema = join(project, 'compass', 'schema', 'task.schema.json');
  await writeFile(schema, '{}\n');
  const hub = spawn(process.execPath, [join(REPO, 'hub', 'bin', 'scompass.js'), '--dir', project, 'serve', '--port', '0', '--tray'], {
    env: { ...process.env, DBUS_SESSION_BUS_ADDRESS: address }
  });
  let out = '';
  hub.stdout.on('data', (d) => { out += d; });
  hub.stderr.on('data', (d) => { out += d; });
  try {
    let service;
    for (let i = 0; i < 60 && !(service = registered.find((s) => s.includes(String(hub.pid)))); i++) await sleep(50);
    assert.ok(service, `no se registró en la bandeja: ${out}`);
    assert.deepEqual((await menuItems(service)).map((x) => x.label), ['Abrir tablero', 'Actualizar compass/ (1 archivo)', 'Reiniciar hub', 'Detener hub']);
    await call(service, '/MenuBar', 'com.canonical.dbusmenu', 'Event', 'isvu', [2, 'clicked', ['s', ''], 0]);
    // Espera el archivo entero: a mitad de la copia se lee vacío.
    const fresh = await readFile(join(REPO, 'schema', 'task.schema.json'), 'utf8');
    for (let i = 0; i < 40 && (await readFile(schema, 'utf8')) !== fresh; i++) await sleep(50);
    assert.equal(await readFile(schema, 'utf8'), fresh);
    // La línea sale después de copiar y de registrar el merge driver (§44, un git que tarda con la máquina cargada).
    for (let i = 0; i < 40 && !/compass\/ actualizado/.test(out); i++) await sleep(50);
    assert.match(out, /compass\/ actualizado: schema\/task\.schema\.json/);
    assert.deepEqual((await menuItems(service)).map((x) => x.label), ['Abrir tablero', 'Reiniciar hub', 'Detener hub'], 'el ítem se oculta');
    // Si vuelve a quedar viejo (otra versión de Scope Compass, o a mano), aparece al abrir el menú otra vez.
    await writeFile(schema, '{}\n');
    const [changed] = await call(service, '/MenuBar', 'com.canonical.dbusmenu', 'AboutToShow', 'i', [0]);
    assert.equal(changed, true);
    assert.equal((await menuItems(service)).length, 4);
  } finally {
    hub.kill('SIGKILL');
  }
});

// Esperas generosas: con la suite entera en paralelo, arrancar tres hubs y que miren el registro (cada 1 s) tarda.
test('§16.8 home --tray: con tres hubs con --tray hay un solo ícono; al cerrar el Inicio vuelven los tres', { skip, timeout: 60000 }, async () => {
  const env = { ...process.env, DBUS_SESSION_BUS_ADDRESS: address, SCOMPASS_REGISTRY: join(dir, 'reg-agrupado'), SCOMPASS_CONFIG: join(dir, 'cfg-agrupado') };
  const bin = join(REPO, 'hub', 'bin', 'scompass.js');
  const owns = async (name) => (await call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'NameHasOwner', 's', [name]))[0];
  const hubs = [];
  let home = null;
  let out = '';
  try {
    for (const name of ['uno', 'dos', 'tres']) {
      const project = join(dir, 'agrupado-' + name);
      await cp(FIXTURE, join(project, 'compass'), { recursive: true });
      await cp(join(REPO, 'hub', 'templates', 'compass-AGENTS.md'), join(project, 'compass', 'AGENTS.md'));
      const hub = spawn(process.execPath, [bin, '--dir', project, 'serve', '--port', '0', '--tray'], { env });
      hub.stdout.on('data', (d) => { out += d; });
      hub.stderr.on('data', (d) => { out += d; });
      hubs.push(hub);
    }
    const services = hubs.map((h) => `org.kde.StatusNotifierItem-${h.pid}-1`);
    for (let i = 0; i < 200 && !services.every((s) => registered.includes(s)); i++) await sleep(50);
    assert.ok(services.every((s) => registered.includes(s)), `los hubs no pusieron su ícono: ${out}`);
    const ports = [...out.matchAll(/127\.0\.0\.1:(\d+)/g)].map((m) => Number(m[1]));

    home = spawn(process.execPath, [bin, 'home', '--port', '0', '--tray'], { env });
    home.stderr.on('data', (d) => { out += d; });
    const homeService = `org.kde.StatusNotifierItem-${home.pid}-1`;
    for (let i = 0; i < 160 && !registered.includes(homeService); i++) await sleep(50);
    assert.ok(registered.includes(homeService), `el Inicio no puso su ícono: ${out}`);
    // Los hubs quitan el suyo (lo revisan cada segundo): queda uno solo, el del Inicio.
    for (let i = 0; i < 160 && (await Promise.all(services.map(owns))).some(Boolean); i++) await sleep(50);
    assert.deepEqual(await Promise.all(services.map(owns)), [false, false, false], 'algún hub sigue con su ícono');

    // El menú del Inicio: los tres proyectos con su submenú.
    const [, layout] = await call(homeService, '/MenuBar', 'com.canonical.dbusmenu', 'GetLayout', 'iias', [0, -1, []]);
    const label = (v) => v[1][0][1].find(([k]) => k === 'label')?.[1][1][0];
    const visible = (v) => v[1][0][1].find(([k]) => k === 'visible')?.[1][1][0] !== false;
    const top = layout[2];
    assert.equal(label(top[0]), 'Abrir Inicio');
    const entries = top.filter((v) => /^Scope Compass · hub suelto :\d+$/.test(label(v) ?? ''));
    assert.deepEqual(entries.map((v) => Number(label(v).split(':')[1])).sort(), ports.sort(), `proyectos en el menú: ${top.map(label).join(' | ')}`);
    assert.deepEqual(entries[0][1][0][2].filter(visible).map(label), ['Abrir tablero', 'Detener hub suelto']);
    assert.deepEqual(top.filter((v) => label(v)).slice(-4).map(label), ['Agregar proyecto…', 'Activar acceso en la red (teléfono)', 'Reiniciar Inicio', 'Cerrar Inicio']);

    // Al cerrar el Inicio, los tres vuelven a la bandeja.
    home.kill('SIGTERM');
    await new Promise((r) => home.on('exit', r));
    for (let i = 0; i < 160 && !(await Promise.all(services.map(owns))).every(Boolean); i++) await sleep(50);
    assert.deepEqual(await Promise.all(services.map(owns)), [true, true, true], 'no volvieron todos');
  } finally {
    home?.kill('SIGKILL');
    for (const h of hubs) h.kill('SIGKILL');
  }
});

test('home --tray: un hub que se prende desde la web (API del Inicio) cambia el menú y avisa con LayoutUpdated', { skip }, async () => {
  const env = { ...process.env, DBUS_SESSION_BUS_ADDRESS: address, SCOMPASS_REGISTRY: join(dir, 'reg-web'), SCOMPASS_CONFIG: join(dir, 'cfg-web') };
  const bin = join(REPO, 'hub', 'bin', 'scompass.js');
  const project = join(dir, 'desde-web');
  await cp(FIXTURE, join(project, 'compass'), { recursive: true });
  execFileSync(process.execPath, [bin, 'home', 'add', project], { env });
  const home = spawn(process.execPath, [bin, 'home', '--port', '0', '--tray', '--json'], { env });
  let out = '';
  home.stdout.on('data', (d) => { out += d; });
  home.stderr.on('data', (d) => { out += d; });
  const updates = [];
  const onSignal = (m) => { if (m.member === 'LayoutUpdated') updates.push(m.body); };
  watcherBus.connection.on('message', onSignal);
  try {
    const service = `org.kde.StatusNotifierItem-${home.pid}-1`;
    for (let i = 0; i < 60 && !registered.includes(service); i++) await sleep(50);
    assert.ok(registered.includes(service), `el Inicio no puso su ícono: ${out}`);
    await new Promise((r, j) => watcherBus.addMatch(`type='signal',sender='${service}',member='LayoutUpdated'`, (e) => (e ? j(e) : r())));
    const label = (v) => v[1][0][1].find(([k]) => k === 'label')?.[1][1][0];
    const labels = async () => (await call(service, '/MenuBar', 'com.canonical.dbusmenu', 'GetLayout', 'iias', [0, -1, []]))[1][2].map(label);
    assert.ok((await labels()).includes('Scope Compass'), (await labels()).join(' | '));
    const url = JSON.parse(out.split('\n')[0]).url;
    const r = await fetch(url + 'api/projects/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: project }) });
    const { hub } = await r.json();
    for (let i = 0; i < 60 && !updates.length; i++) await sleep(50);
    assert.ok(updates.length, 'no avisó LayoutUpdated');
    // Un escritorio que no hizo caso del LayoutUpdated pregunta al abrir el menú: tiene que oír que cambió.
    const [changed] = await call(service, '/MenuBar', 'com.canonical.dbusmenu', 'AboutToShow', 'i', [0]);
    assert.equal(changed, true, 'AboutToShow dijo que no cambió');
    assert.ok((await labels()).includes(`Scope Compass · hub suelto :${hub.port}`), (await labels()).join(' | '));
    const [again] = await call(service, '/MenuBar', 'com.canonical.dbusmenu', 'AboutToShow', 'i', [0]);
    assert.equal(again, false, 'ya lo pidió: no cambió');
  } finally {
    watcherBus.connection.off('message', onSignal);
    home.kill('SIGKILL');
  }
});

test('serve --tray sin bus de sesión: avisa y el hub funciona igual', { skip: process.platform === 'win32' && 'en Windows la bandeja no usa D-Bus (tray-win.test.js)' }, async () => {
  const project = await mkdtemp(join(tmpdir(), 'scompass-tray-nobus-'));
  try {
    await cp(FIXTURE, join(project, 'compass'), { recursive: true });
    const env = { ...process.env };
    delete env.DBUS_SESSION_BUS_ADDRESS;
    const hub = spawn(process.execPath, [join(REPO, 'hub', 'bin', 'scompass.js'), '--dir', project, 'serve', '--port', '0', '--tray'], { env });
    let out = '';
    hub.stdout.on('data', (d) => { out += d; });
    hub.stderr.on('data', (d) => { out += d; });
    for (let i = 0; i < 60 && !out.includes('sin ícono'); i++) await sleep(50);
    assert.match(out, /sin ícono en la bandeja: no hay bus de sesión/);
    const url = /(http:\/\/127\.0\.0\.1:\d+\/)/.exec(out)[1];
    assert.equal((await (await fetch(url + 'api/health')).json()).ok, true);
    const exited = new Promise((r) => hub.on('exit', r));
    await fetch(url + 'api/shutdown', { method: 'POST' });
    assert.equal(await exited, 0);
  } finally {
    await rm(project, { recursive: true, force: true, maxRetries: 10 });
  }
});
