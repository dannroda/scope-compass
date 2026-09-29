import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical } from '../src/store/canonical.js';
import { isTempFile, writeAtomic } from '../src/store/atomic.js';

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
    await rm(dir, { recursive: true, force: true });
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
    await rm(dir, { recursive: true, force: true });
  }
});

test('isTempFile reconoce solo los temporales de writeAtomic', () => {
  assert.ok(isTempFile('.m0-01.json.a1b2c3d4.tmp'));
  assert.ok(!isTempFile('m0-01.json'));
  assert.ok(!isTempFile('.gdignore'));
});
