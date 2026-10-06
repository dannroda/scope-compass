// Escritorio (§18): abrir el navegador y el selector de carpetas, con los reemplazos de los tests (que andan en
// Linux y en Windows). Los programas reales (xdg-open, kdialog, el diálogo de Windows) se prueban a mano.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openUrl, pickFolder } from '../src/desktop.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withEnv = async (vars, fn) => {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try { return await fn(); } finally { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; }
};

test('openUrl: le pasa la URL al programa; si no existe, avisa', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'scompass-desktop-'));
  try {
    const opener = join(dir, 'open.js');
    await writeFile(opener, `require('node:fs').writeFileSync(${JSON.stringify(join(dir, 'abierta'))}, process.argv[2]);`);
    await withEnv({ SCOMPASS_OPEN: opener }, () => openUrl('http://127.0.0.1:4700/p/vida/'));
    let got = null;
    for (let i = 0; i < 100 && got === null; i++) { got = await readFile(join(dir, 'abierta'), 'utf8').catch(() => null); if (got === null) await sleep(50); }
    assert.equal(got, 'http://127.0.0.1:4700/p/vida/');
    const failed = await withEnv({ SCOMPASS_OPEN: join(dir, 'no-existe') }, () => new Promise((r) => { openUrl('http://x/', { onError: () => r(true) }); setTimeout(() => r(false), 3000); }));
    assert.equal(failed, true);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('pickFolder: recibe la carpeta inicial; elegir, cancelar y sin selector', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'scompass-desktop-'));
  try {
    const picker = join(dir, 'pick.js');
    // Devuelve la inicial con una subcarpeta con tilde: que la ruta no se rompa en el camino.
    await writeFile(picker, `process.stdout.write(require('node:path').join(process.argv[2], 'Música'));`);
    assert.deepEqual(await withEnv({ SCOMPASS_PICKER: picker }, () => pickFolder(dir, 'Título')), { path: join(dir, 'Música') });
    await writeFile(picker, 'process.exit(1);');
    assert.deepEqual(await withEnv({ SCOMPASS_PICKER: picker }, () => pickFolder(dir, 'Título')), { cancelled: true });
    assert.equal(await withEnv({ SCOMPASS_PICKER: join(dir, 'no-existe') }, () => pickFolder(dir, 'Título')), null);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});
