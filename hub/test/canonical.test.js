import './isolate.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical } from '../src/store/canonical.js';
import { isTempFile, renameRetrying, writeAtomic } from '../src/store/atomic.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

async function compassFiles(dir) {
  const out = [join(dir, 'config.json')];
  for (const sub of ['milestones', 'tasks']) {
    for (const name of await readdir(join(dir, sub))) if (name.endsWith('.json')) out.push(join(dir, sub, name));
  }
  return out;
}

test('ordena claves en todos los niveles, 2 espacios y salto de línea final', () => {
  const doc = { title: 'x', checklist: [{ text: 'a', done: false }], code: '0.1', refs: [] };
  assert.equal(canonical(doc), [
    '{',
    '  "checklist": [',
    '    {',
    '      "done": false,',
    '      "text": "a"',
    '    }',
    '  ],',
    '  "code": "0.1",',
    '  "refs": [],',
    '  "title": "x"',
    '}',
    ''
  ].join('\n'));
});

test('UTF-8 sin escapar y control escapado como en Python', () => {
  assert.equal(canonical({ t: 'Revisión «ñ» 🧭' }), '{\n  "t": "Revisión «ñ» 🧭"\n}\n');
  assert.equal(canonical({ t: 'a\nb\t\u0001' }), '{\n  "t": "a\\nb\\t\\u0001"\n}\n');
});

test('los arrays conservan su orden y se omiten claves undefined', () => {
  assert.equal(canonical({ b: [3, 1, 2], a: undefined }), '{\n  "b": [\n    3,\n    1,\n    2\n  ]\n}\n');
});

test('ida y vuelta: los JSON de compass/ ya están en formato canónico', async () => {
  const files = await compassFiles(join(REPO, 'compass'));
  assert.ok(files.length > 10);
  for (const f of files) {
    const text = await readFile(f, 'utf8');
    assert.equal(canonical(JSON.parse(text)), text, f);
  }
});

test('reescribir un archivo editado a mano cambia el formato, no el contenido', () => {
  const hand = '{"title": "Schemas",    "status":"doing",\n"checklist":[ {"text":"á","done":true} ],"milestone":"m00"}';
  const out = canonical(JSON.parse(hand));
  assert.deepEqual(JSON.parse(out), JSON.parse(hand));
  assert.equal(canonical(JSON.parse(out)), out);
});

test('writeAtomic reemplaza el archivo y no deja temporales', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'scompass-'));
  try {
    const f = join(dir, 'm0-01.json');
    await writeFile(f, 'viejo');
    await writeAtomic(f, canonical({ status: 'done' }));
    assert.equal(await readFile(f, 'utf8'), '{\n  "status": "done"\n}\n');
    assert.deepEqual(await readdir(dir), ['m0-01.json']);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('writeAtomic que falla al renombrar no deja temporales', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'scompass-'));
  try {
    // El destino es una carpeta: el temporal se escribe y el rename falla.
    await mkdir(join(dir, 'x.json'));
    await writeFile(join(dir, 'keep.json'), 'viejo');
    await assert.rejects(writeAtomic(join(dir, 'x.json'), '{}'));
    assert.equal(await readFile(join(dir, 'keep.json'), 'utf8'), 'viejo');
    assert.deepEqual((await readdir(dir)).sort(), ['keep.json', 'x.json']);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('renameRetrying: reintenta si el destino está ocupado (Windows), no con otros errores ni sin retry', async () => {
  const failing = (n, code) => { let calls = 0; const fn = async () => { calls++; if (calls <= n) throw Object.assign(new Error(code), { code }); }; fn.calls = () => calls; return fn; };
  let r = failing(2, 'EBUSY');
  await renameRetrying('a', 'b', { rename: r, retry: true });
  assert.equal(r.calls(), 3, 'dos fallas y anda');
  r = failing(2, 'EPERM');
  await assert.rejects(renameRetrying('a', 'b', { rename: r, retry: false }), { code: 'EPERM' });
  assert.equal(r.calls(), 1, 'sin retry (Linux), el error sale enseguida');
  r = failing(5, 'ENOENT');
  await assert.rejects(renameRetrying('a', 'b', { rename: r, retry: true }), { code: 'ENOENT' });
  assert.equal(r.calls(), 1, 'un error que no es de ocupado no se reintenta');
  r = failing(99, 'EACCES');
  await assert.rejects(renameRetrying('a', 'b', { rename: r, retry: true, tries: 3 }), { code: 'EACCES' });
  assert.equal(r.calls(), 3, 'se rinde después de los intentos');
});

test('writeAtomic en Windows: el destino abierto sin compartir por otro proceso no hace fallar la escritura', { skip: process.platform !== 'win32' && 'solo Windows' }, async () => {
  const { spawn } = await import('node:child_process');
  const dir = await mkdtemp(join(tmpdir(), 'scompass-'));
  try {
    const f = join(dir, 'm0-01.json');
    await writeFile(f, 'viejo');
    // Como el antivirus: abre el archivo sin compartir y lo suelta un rato después.
    const ps = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      `$f = [IO.File]::Open('${f}', 'Open', 'Read', 'None'); 'bloqueado'; Start-Sleep -Milliseconds 400; $f.Close()`], { windowsHide: true });
    await new Promise((r) => ps.stdout.once('data', r));
    await writeAtomic(f, canonical({ status: 'done' }));
    assert.equal(await readFile(f, 'utf8'), '{\n  "status": "done"\n}\n');
    assert.deepEqual(await readdir(dir), ['m0-01.json'], 'sin temporales');
    await new Promise((r) => (ps.exitCode !== null ? r() : ps.on('exit', r)));
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('isTempFile reconoce solo los temporales de writeAtomic', () => {
  assert.ok(isTempFile('.m0-01.json.a1b2c3d4.tmp'));
  assert.ok(!isTempFile('m0-01.json'));
  assert.ok(!isTempFile('.gdignore'));
});
