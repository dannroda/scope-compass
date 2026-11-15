// Ícono en la bandeja de Windows (D31): tray-win.ps1 con NotifyIcon, en un PowerShell sin consola. El hub le manda
// el ícono, el tooltip y el menú por stdin (JSON por líneas) y recibe los clics por stdout. Si el hub se cierra o
// muere, se corta stdin y el ícono se va. Misma interfaz que la bandeja de D-Bus (tray.js).
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { buildMenu, compassIco } from './tray-menu.js';
import { T } from './i18n.js';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'tray-win.ps1');

// Lo que viaja: solo lo visible, con su id, label, si está habilitado y sus hijos.
const wire = (nodes) => nodes.filter((n) => n.visible).map((n) => (n.separator ? { id: n.id, separator: true }
  : { id: n.id, label: n.label, enabled: n.enabled, children: wire(n.children) }));

export async function startWinTray({ title, tooltip, items, onActivate, timeoutMs = 20000 }) {
  // -EncodedCommand (UTF-16LE en base64): el script entero, sin problemas de comillas ni de política de ejecución.
  const encoded = Buffer.from(readFileSync(SCRIPT, 'utf8'), 'utf16le').toString('base64');
  const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', encoded],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  ps.stdin.on('error', () => {}); // si PowerShell ya se fue, escribir falla: no es un error del hub
  const send = (m) => { if (ps.stdin.writable) ps.stdin.write(JSON.stringify(m) + '\n'); };
  let err = '';
  ps.stderr.on('data', (d) => { err += d; });

  let menu = buildMenu(items);
  const waiting = new Map(); // tipo de respuesta → resolve (dump, para los tests)
  const lines = createInterface({ input: ps.stdout });
  const refresh = () => {
    const next = buildMenu(items);
    if (next.shape === menu.shape) { menu = next; return false; }
    menu = next;
    send({ type: 'set', menu: wire(menu.root.children) });
    return true;
  };
  await new Promise((resolve, reject) => {
    const fail = (why) => { clearTimeout(timer); reject(new Error(why)); };
    const timer = setTimeout(() => { ps.kill(); fail(T('PowerShell no mostró el ícono a tiempo')); }, timeoutMs);
    ps.once('error', (e) => fail(e.code === 'ENOENT' ? T('no está powershell.exe') : e.message));
    ps.once('exit', () => fail(T`PowerShell se cerró${err.trim() ? `: ${err.trim().split('\n').at(-1)}` : ''}`));
    lines.on('line', (line) => {
      let m;
      try { m = JSON.parse(line); } catch { return; }
      if (m.type === 'ready') { clearTimeout(timer); ps.removeAllListeners('exit'); resolve(); }
      else if (m.type === 'click') { const n = menu.map.get(m.id); if (n?.item.onClick) setImmediate(() => n.item.onClick()); }
      else if (m.type === 'activate') onActivate?.();
      // Antes de abrir el menú se reevalúan labels y visibles, como el AboutToShow de D-Bus.
      else if (m.type === 'opening') refresh();
      else waiting.get(m.type)?.(m);
    });
    send({ type: 'set', icon: compassIco().toString('base64'), tooltip: `${title}\n${tooltip}`, menu: wire(menu.root.children) });
  });

  return {
    refresh,
    // Para los tests: lo que armó PowerShell, y un clic en un ítem (por su handler de verdad).
    dump: () => new Promise((resolve) => { waiting.set('dump', resolve); send({ type: 'dump' }); }),
    invoke: (id) => send({ type: 'invoke', id }),
    showMenu: () => send({ type: 'show-menu' }),
    close: () => {
      ps.stdin.end();
      setTimeout(() => { if (ps.exitCode === null) ps.kill(); }, 3000).unref();
    }
  };
}
