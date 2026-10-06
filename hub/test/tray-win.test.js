// Bandeja de Windows (D31): el PowerShell de verdad, sin escritorio (el ícono no se ve por SSH, pero el menú se arma
// igual). `dump` devuelve lo que armó PowerShell e `invoke` hace clic por el handler del ítem.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const skip = process.platform !== 'win32' && 'solo Windows';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Los PowerShell de bandeja vivos (sin contar el que cuenta, que también tiene -EncodedCommand en su línea).
const trayProcesses = () => new Promise((r) => execFile('powershell.exe', ['-NoProfile', '-Command',
  "@(Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -match '-EncodedCommand' }).Count"], (e, out) => r(Number(out.trim()))));

test('NotifyIcon: el menú que arma PowerShell es el de Node; clics, refresh y cierre', { skip }, async () => {
  const { startTray } = await import('../src/tray.js');
  let n = 1;
  const clicks = [];
  const tray = await startTray({ title: 'Scope Compass', tooltip: 'Inicio · http://127.0.0.1:4700/', onActivate: () => clicks.push('activate'),
    items: () => [
      { label: 'Abrir Inicio', onClick: () => clicks.push('abrir') },
      { separator: true },
      { label: `Vida · :${4711 + n}`, children: [{ label: 'Abrir', onClick: () => clicks.push('vida') }, { label: 'Detener' }] },
      { label: 'Oculto', visible: false },
      { label: 'Configuración · no encontrado', enabled: false }
    ] });
  try {
    const d = await tray.dump();
    assert.equal(d.visible, true);
    assert.equal(d.tooltip, 'Scope Compass\nInicio · http://127.0.0.1:4700/');
    const labels = (items) => items.map((x) => (x.separator ? '---' : x.children.length ? [x.label, labels(x.children)] : x.label));
    assert.deepEqual(labels(d.menu), ['Abrir Inicio', '---', ['Vida · :4712', ['Abrir', 'Detener']], 'Configuración · no encontrado'], 'sin el oculto, con tildes');
    assert.equal(d.menu[3].enabled, false);
    tray.invoke(d.menu[2].children[0].id);
    tray.invoke(d.menu[0].id);
    for (let i = 0; i < 40 && clicks.length < 2; i++) await sleep(50);
    assert.deepEqual(clicks, ['vida', 'abrir']);
    n = 2;
    assert.equal(tray.refresh(), true);
    assert.equal((await tray.dump()).menu[2].label, 'Vida · :4713');
    assert.equal(tray.refresh(), false, 'sin cambios no se manda nada');
  } finally {
    tray.close();
  }
  for (let i = 0; i < 60 && (await trayProcesses()) > 0; i++) await sleep(100);
  assert.equal(await trayProcesses(), 0, 'al cerrar, PowerShell se va');
});

test('home --tray en Windows: el ícono se pone, y al apagar el Inicio PowerShell se va con él', { skip }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'scompass-traywin-'));
  const env = { ...process.env, SCOMPASS_REGISTRY: join(root, 'registro'), SCOMPASS_CONFIG: join(root, 'config') };
  await cp(join(REPO, 'hub', 'test', 'fixtures', 'compass'), join(root, 'Vida', 'compass'), { recursive: true });
  const home = spawn(process.execPath, [join(REPO, 'hub', 'bin', 'scompass.js'), 'home', '--port', '0', '--tray'], { env });
  let out = '';
  home.stdout.on('data', (d) => { out += d; });
  home.stderr.on('data', (d) => { out += d; });
  const exited = new Promise((r) => home.on('exit', r));
  try {
    for (let i = 0; i < 200 && (await trayProcesses()) === 0; i++) await sleep(100);
    assert.equal(await trayProcesses(), 1, out);
    await sleep(500);
    assert.doesNotMatch(out, /sin ícono/);
    const url = /(http:\/\/127\.0\.0\.1:\d+\/)/.exec(out)[1];
    await fetch(url + 'api/shutdown', { method: 'POST' });
    assert.equal(await exited, 0);
    for (let i = 0; i < 60 && (await trayProcesses()) > 0; i++) await sleep(100);
    assert.equal(await trayProcesses(), 0);
  } finally {
    home.kill();
    await rm(root, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('si el hub muere de golpe, PowerShell se entera (se corta stdin) y saca el ícono', { skip }, async () => {
  const code = `import(${JSON.stringify(new URL('../src/tray.js', import.meta.url).href)}).then(({ startTray }) =>
    startTray({ title: 'T', tooltip: 't', items: [{ label: 'x' }] })).then(() => console.log('listo'));`;
  const child = spawn(process.execPath, ['-e', code]);
  await new Promise((r, j) => { child.stdout.once('data', r); child.once('exit', () => j(new Error('el proceso se cerró antes'))); });
  assert.equal(await trayProcesses(), 1);
  child.kill(); // en Windows, en seco: sin close()
  for (let i = 0; i < 60 && (await trayProcesses()) > 0; i++) await sleep(100);
  assert.equal(await trayProcesses(), 0);
});
