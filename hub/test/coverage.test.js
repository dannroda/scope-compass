// Cobertura de los documentos (spec §43, m30-03): por sección, qué tareas la cubren y si están hechas.
import './isolate.js';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadValidators } from '../src/schema.js';
import { canonical } from '../src/store/canonical.js';
import { createJsonFilesStore } from '../src/store/json-files.js';
import { createServer } from '../src/server.js';
import { run } from '../src/cli.js';
import { docCoverage, parseSections } from '../src/docs.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'compass');
const V = loadValidators();
const GDD = '# Juego\n<!-- id: juego -->\n\n## Combate\n<!-- id: combate -->\n\n### Ventanas\n<!-- id: ventanas -->\n\nTres frames.\n\n## Cámara\n<!-- id: camara -->\n\n## Audio\n<!-- id: audio -->\n';
let dir;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'scompass-coverage-'));
  await cp(FIXTURE, join(dir, 'compass'), { recursive: true });
  await writeFile(join(dir, 'gdd.md'), GDD);
  const cfg = join(dir, 'compass', 'config.json');
  await writeFile(cfg, canonical({ ...JSON.parse(await readFile(cfg, 'utf8')), port: 1, docs: [{ alias: 'gdd', path: 'gdd.md' }] }));
  // Combate: 1.4 hecha. Ventanas: 1.5 en curso (y 1.4 por Combate). Cámara: un enlace en las notas de 1.3, hecha.
  // Audio: nada. El documento entero: 1.2.
  const set = async (id, changes) => {
    const p = join(dir, 'compass', 'tasks', `${id}.json`);
    await writeFile(p, canonical({ ...JSON.parse(await readFile(p, 'utf8')), refs: [], ...changes }));
  };
  for (const id of ['m0-01', 'm0-02', 'm0-03', 'm0-04', 'm0-05', 'm0-06', 'm1-01', 'm1-06', 'm1-07']) await set(id, {});
  await set('m1-02', { refs: [{ doc: 'gdd.md' }] });
  await set('m1-03', { status: 'done', notes: 'como dice [[gdd#camara]]; `[[gdd#audio]]` es un ejemplo' });
  await set('m1-04', { status: 'done', refs: [{ doc: 'gdd.md', section: 'combate' }] });
  await set('m1-05', { status: 'doing', refs: [{ doc: 'gdd.md', section: 'ventanas' }] });
});
afterEach(() => rm(dir, { recursive: true, force: true, maxRetries: 10 }));

async function cli(...argv) {
  let out = '', err = '';
  const code = await run(argv, { cwd: dir, out: { write: (s) => { out += s; } }, err: { write: (s) => { err += s; } } });
  return { code, out, err, json: (() => { try { return JSON.parse(out); } catch { return null; } })() };
}
const shape = (d) => Object.fromEntries(d.sections.map((s) => [s.id, [s.state, s.tasks.map((t) => t.id + (t.from ? '<' + t.from : '')).join(' ')]]));
const EXPECTED = { juego: ['inside', ''], combate: ['done', 'm1-04'], ventanas: ['open', 'm1-05 m1-04<combate'], camara: ['done', 'm1-03'], audio: ['none', ''] };

test('docCoverage: estados, herencia de la sección de afuera, enlaces y documento entero', () => {
  const doc = { alias: 'gdd', path: 'gdd.md', ...parseSections(GDD) };
  const tasks = [{ id: 'a', status: 'todo', refs: [{ doc: 'gdd', section: 'juego' }] }, { id: 'b', status: 'done', checklist: [{ text: 'ver [[gdd#audio]]' }] }];
  const [d] = docCoverage([doc], tasks);
  assert.deepEqual(Object.fromEntries(d.sections.map((s) => [s.id, s.state])), { juego: 'open', combate: 'open', ventanas: 'open', camara: 'open', audio: 'open' });
  assert.deepEqual(d.sections.find((s) => s.id === 'audio').tasks.map((t) => [t.id, t.from]), [['b', undefined], ['a', 'juego']]);
  assert.deepEqual(d.counts, { done: 0, open: 5, inside: 0, none: 0 });
  assert.deepEqual(docCoverage([doc], [], { alias: 'otro' }), []);
});

test('CLI refs coverage: por sección, --uncovered, un alias que no existe', async () => {
  let r = await cli('refs', 'coverage', '--json');
  assert.equal(r.code, 0);
  const [d] = r.json.docs;
  assert.deepEqual(shape(d), EXPECTED);
  assert.deepEqual(d.whole.map((t) => t.id), ['m1-02']);
  assert.deepEqual(d.counts, { done: 2, open: 1, inside: 1, none: 1 });
  r = await cli('refs', 'coverage');
  assert.match(r.out, /gdd \(gdd\.md\): 2 hechas · 1 abiertas · 1 con tareas adentro · 1 sin tareas/);
  assert.match(r.out, /abierta +ventanas: 1\.5, 1\.4 ✓ \(por combate\)/);
  assert.match(r.out, /sin tareas +audio\n/);
  r = await cli('refs', 'coverage', 'gdd', '--uncovered', '--json');
  assert.deepEqual(r.json.docs[0].sections.map((s) => s.id), ['audio']);
  r = await cli('refs', 'coverage', 'nada');
  assert.notEqual(r.code, 0);
  assert.match(r.err, /no hay un documento "nada"/);
});

test('API /api/refs/coverage: lo mismo que la CLI, con ?doc y ?uncovered', async () => {
  const app = createServer({ projectDir: dir, store: createJsonFilesStore(join(dir, 'compass'), { validators: V }), validators: V });
  try {
    const get = async (u) => { const r = await app.inject(u); return { status: r.statusCode, body: r.json() }; };
    const { body } = await get('/api/refs/coverage');
    assert.deepEqual(body, (await cli('refs', 'coverage', '--json')).json);
    assert.deepEqual(shape(body.docs[0]), EXPECTED);
    assert.deepEqual((await get('/api/refs/coverage?doc=gdd&uncovered=1')).body.docs[0].sections.map((s) => s.id), ['audio']);
    assert.equal((await get('/api/refs/coverage?doc=nada')).status, 404);
  } finally {
    await app.close();
  }
});
