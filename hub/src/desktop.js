// Lo que el hub le pide al escritorio (§18): abrir una URL en el navegador y el selector de carpetas. Cada
// plataforma con lo que trae de fábrica: xdg-open y kdialog/zenity en Linux; explorer.exe y un diálogo de
// Windows Forms desde PowerShell en Windows (sin dependencias, como la bandeja, D31).
import { execFile, spawn } from 'node:child_process';

const WIN = process.platform === 'win32';

// Los reemplazos de los tests (SCOMPASS_OPEN, SCOMPASS_PICKER): un programa, o un .js que se corre con Node, que
// anda igual en Linux y en Windows.
const command = (cmd, args) => (/\.m?js$/.test(cmd) ? [process.execPath, [cmd, ...args]] : [cmd, args]);

/** Abre la URL en el navegador por defecto. SCOMPASS_OPEN reemplaza al programa (los tests lo usan). */
export function openUrl(url, { onError = () => {} } = {}) {
  const [cmd, args] = command(process.env.SCOMPASS_OPEN || (WIN ? 'explorer.exe' : 'xdg-open'), [url]);
  spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).on('error', onError).unref();
}

// El diálogo de carpetas de Windows. PowerShell 5.1 trae .NET y corre en STA, que es lo que pide el diálogo. La
// carpeta inicial llega por variable de entorno (sin problemas de comillas) y la elegida sale en UTF-8 por stdout.
// El formulario dueño, invisible y siempre arriba, hace que el diálogo aparezca delante del navegador.
const WIN_PICKER = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
[Windows.Forms.Application]::EnableVisualStyles()
$d = New-Object Windows.Forms.FolderBrowserDialog
$d.Description = $env:SCOMPASS_PICK_TITLE
$d.ShowNewFolderButton = $true
if ($env:SCOMPASS_PICK_START -and (Test-Path -LiteralPath $env:SCOMPASS_PICK_START)) { $d.SelectedPath = $env:SCOMPASS_PICK_START }
$owner = New-Object Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false; Opacity = 0 }
$owner.Show()
if ($d.ShowDialog($owner) -eq 'OK') { [Console]::Out.Write($d.SelectedPath) }
$owner.Close()
`;

/**
 * Abre el selector de carpetas del escritorio. Devuelve { path }, { cancelled: true } o null si no hay selector.
 * SCOMPASS_PICKER lo reemplaza en los tests: recibe la carpeta inicial y escribe la elegida.
 */
export async function pickFolder(start, title) {
  const fake = process.env.SCOMPASS_PICKER;
  const tries = fake ? [command(fake, [start])]
    : WIN ? [['powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WIN_PICKER], { SCOMPASS_PICK_START: start, SCOMPASS_PICK_TITLE: title }]]
    : [['kdialog', ['--getexistingdirectory', start, '--title', title]],
      ['zenity', ['--file-selection', '--directory', `--title=${title}`, `--filename=${start}/`]]];
  for (const [cmd, args, env] of tries) {
    // windowsHide: sin consola de PowerShell; el diálogo se ve igual (lo muestra el formulario dueño).
    const r = await new Promise((done) => execFile(cmd, args, { timeout: 10 * 60 * 1000, windowsHide: true, encoding: 'utf8', env: { ...process.env, ...env } },
      (err, stdout) => done({ err, out: stdout.trim() })));
    if (r.err?.code === 'ENOENT') continue;
    // Cancelar sale con código 1 (kdialog, zenity) o sin salida (Windows).
    return r.out ? { path: r.out } : { cancelled: true };
  }
  return null;
}
