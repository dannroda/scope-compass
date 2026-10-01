// Bandeja del sistema (5.9) en un bus D-Bus privado: el test hace de Plasma (StatusNotifierWatcher)
// y habla con el ícono como lo haría el escritorio. No toca la bandeja real.
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
  if (dir) await rm(dir, { recursive: true, force: true });
});

const call = (service, path, iface, member, signature, body) => new Promise((resolve, reject) =>
  watcherBus.invoke({ destination: service, path, interface: iface, member, signature, body }, (err, ...res) => (err ? reject(err) : resolve(res))));
// Un variant llega como [firma, [valor]]: devuelve el valor.
const prop = async (service, name) => (await call(service, '/StatusNotifierItem', 'org.freedesktop.DBus.Properties', 'Get', 'ss', ['org.kde.StatusNotifierItem', name]))[0][1][0];

test('serve --tray: se registra en la bandeja, muestra el proyecto y el menú cierra el hub', { skip }, async () => {
  const project = join(dir, 'proyecto');
  await cp(FIXTURE, join(project, 'compass'), { recursive: true });
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

    const [, layout] = await call(service, '/MenuBar', 'com.canonical.dbusmenu', 'GetLayout', 'iias', [0, -1, []]);
    const labels = layout[2].map((v) => v[1][0][1].find(([k]) => k === 'label')[1][1][0]);
    assert.deepEqual(labels, ['Abrir tablero', 'Reiniciar hub', 'Detener hub']);

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
    await call(service, '/MenuBar', 'com.canonical.dbusmenu', 'Event', 'isvu', [2, 'clicked', ['s', ''], 0]);
    assert.equal(await Promise.race([exited, sleep(3000).then(() => 'sigue vivo')]), 0, 'el viejo terminó');
    let again;
    for (let i = 0; i < 60 && !(again = registered.find((s) => !s.includes(String(hub.pid)))); i++) await sleep(50);
    assert.ok(again, 'el hub nuevo no se registró en la bandeja');
    const newPid = Number(/StatusNotifierItem-(\d+)-1/.exec(again)[1]);
    await sleep(300);
    const health = await fetch(url + 'api/health').then((r) => r.json()).catch((e) => { throw new Error(`sin hub tras reiniciar (${e.cause?.code}); salida: ${out}`); });
    assert.equal(health.pid, newPid, 'mismo puerto, otro PID');
    // "Detener hub" en el nuevo.
    await call(again, '/MenuBar', 'com.canonical.dbusmenu', 'Event', 'isvu', [3, 'clicked', ['s', ''], 0]);
    for (let i = 0; i < 60; i++) { try { process.kill(newPid, 0); await sleep(50); } catch { break; } }
    assert.throws(() => process.kill(newPid, 0), '"Detener hub" cierra el hub');
  } finally {
    hub.kill('SIGKILL');
  }
});

test('serve --tray sin bus de sesión: avisa y el hub funciona igual', async () => {
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
    hub.kill('SIGTERM');
    assert.equal(await new Promise((r) => hub.on('exit', r)), 0);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
