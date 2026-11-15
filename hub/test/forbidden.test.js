// Patrones prohibidos (spec §42, m30-01): config.json › forbidden rechaza escrituras y scompass lint los encuentra.
// Los ejemplos imitan la forma de los de una clean-room real (archivos .c y prefijos de funciones del motor), con
// nombres inventados.
import './isolate.js';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadValidators } from '../src/schema.js';
import { canonical } from '../src/store/canonical.js';
import { createJsonFilesStore } from '../src/store/json-files.js';
import { createServer } from '../src/server.js';
import { run } from '../src/cli.js';
import { compileForbidden, findForbidden } from '../src/forbidden.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'compass');
const V = loadValidators();
const FORBIDDEN = [
  { pattern: '\\b[A-Za-z0-9_]+\\.c\\b', note: 'archivo .c del fuente original' },
  { pattern: '\\b[A-Z][A-Z0-9]{1,3}[rgi][A-Z]\\w*', note: 'prefijo de función del motor' }
];
const BAD = ['Game_Character.c:15983', 'Core_Timer.c:2140', 'Env_OctTree2.c', '(AB2rKnowledge_Sound, Game_AB2_Knowledge.c:536)', 'XYrCollection_Lookup',
  'QRiCharacter_TestAndSetHit', 'ZZrPowerup_Give', 'KLrMachineTime_Sixtieths', '(Core_Script_\nExpr.c:159)'];
const GOOD = ['ai.current', 'r.collider', 'PhysicsRayQueryParameters3D.create', 'TRAM', 'ABCD Health', '<AKEV>', 'ai2_spawn', 'ai2_doalarm', 'AB2 alarm state',
  'GameSplit', 'Game_Weapon', 'GameMoveTable', 'AnimationTree', 'CharacterBody3D', 'HTTPRequest', 'AABB', 'GDScript'];
let dir;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'scompass-forbidden-'));
  await cp(FIXTURE, join(dir, 'compass'), { recursive: true });
  await writeFile(join(dir, 'gdd.md'), '# GDD\n\n## IA\n<!-- id: ia -->\n\nLa IA reacciona al ruido.\n');
  await setConfig({ port: 1, docs: [{ alias: 'gdd', path: 'gdd.md' }], forbidden: FORBIDDEN });
});
afterEach(() => rm(dir, { recursive: true, force: true, maxRetries: 10 }));

async function setConfig(changes) {
  const p = join(dir, 'compass', 'config.json');
  const cfg = { ...JSON.parse(await readFile(p, 'utf8')), ...changes };
  for (const [k, v] of Object.entries(changes)) if (v === undefined) delete cfg[k];
  await writeFile(p, canonical(cfg));
}
async function cli(...argv) {
  let out = '', err = '';
  const code = await run(argv, { cwd: dir, out: { write: (s) => { out += s; } }, err: { write: (s) => { err += s; } } });
  return { code, out, err };
}
const task = async (id) => JSON.parse(await readFile(join(dir, 'compass', 'tasks', `${id}.json`), 'utf8'));

test('los patrones atrapan los ejemplos prohibidos y dejan pasar los permitidos', () => {
  const { patterns, errors } = compileForbidden({ forbidden: FORBIDDEN });
  assert.deepEqual(errors, []);
  for (const t of BAD) assert.ok(findForbidden(t, patterns).length, `no atrapó: ${t}`);
  for (const t of GOOD) assert.deepEqual(findForbidden(t, patterns), [], `atrapó: ${t}`);
  const hits = findForbidden({ title: 'ok', checklist: [{ text: 'ok' }, { text: 'ver XYrCollection_Lookup' }] }, patterns);
  assert.deepEqual(hits.map((h) => [h.where, h.match]), [['checklist[1].text', 'XYrCollection_Lookup']]);
  // Texto o objeto; ignore_case; un patrón inválido es un error, no una excepción.
  const c = compileForbidden({ forbidden: ['secreto', { pattern: 'clave', ignore_case: true }, '(roto'] });
  assert.equal(c.patterns.length, 2);
  assert.deepEqual(c.errors.map((e) => e.index), [2]);
  assert.equal(findForbidden('SECRETO y CLAVE', c.patterns).map((h) => h.match).join(), 'CLAVE');
});

test('el schema acepta forbidden como texto u objeto y rechaza campos de más', async () => {
  assert.equal((await cli('list', '--json')).code, 0);
  await setConfig({ forbidden: ['a', { pattern: 'b', ignore_case: true, note: 'n' }] });
  assert.equal((await cli('list', '--json')).code, 0);
  await setConfig({ forbidden: [{ pattern: 'b', otra: 1 }] });
  assert.match((await cli('list')).err, /config\.json/);
});

test('CLI: una escritura con una coincidencia se rechaza entera, con el patrón y el campo', async () => {
  const before = await readFile(join(dir, 'compass', 'tasks', 'm1-04.json'), 'utf8');
  let r = await cli('set', 'm1-04', '--notes', 'Mirar Game_Character.c:15983 para el golpe');
  assert.notEqual(r.code, 0);
  assert.match(r.err, /compass\/tasks\/m1-04\.json › notes: «Game_Character\.c» coincide con el patrón prohibido .* \(archivo \.c del fuente original\)/);
  assert.equal(await readFile(join(dir, 'compass', 'tasks', 'm1-04.json'), 'utf8'), before, 'no se escribió nada');
  r = await cli('add', 'Portar ZZrPowerup_Give', '--milestone', 'm01', '--json');
  assert.notEqual(r.code, 0);
  assert.match(r.err, /forbidden_pattern/);
  r = await cli('step', 'add', 'm1-04', 'Revisar', '--detail', 'Core_Script_\nExpr.c:159');
  assert.match(r.err, /checklist\[\d+\]\.detail: «Expr\.c»/);
  assert.equal((await cli('set', 'm1-04', '--notes', 'La IA reacciona al ruido (ai2_spawn).')).code, 0, 'lo permitido pasa');
  assert.match((await task('m1-04')).notes, /ai2_spawn/);
  // Un patrón inválido en la config frena las escrituras con un mensaje claro.
  await setConfig({ forbidden: ['(roto'] });
  assert.match((await cli('move', 'm1-04', 'doing')).err, /forbidden\[0\]: \/\(roto\/ no es una expresión regular válida/);
});

test('API: 422 con las coincidencias; la web y el dock escriben por acá', async () => {
  const app = createServer({ projectDir: dir, store: createJsonFilesStore(join(dir, 'compass'), { validators: V }), validators: V });
  try {
    const r = await app.inject({ method: 'PATCH', url: '/api/tasks/m1-04', payload: { description: 'Ver QRiCharacter_TestAndSetHit' }, headers: { 'if-match': '*' } });
    assert.equal(r.statusCode, 422);
    const { error } = r.json();
    assert.equal(error.code, 'forbidden_pattern');
    assert.deepEqual(error.matches.map((m) => [m.where, m.match]), [['description', 'QRiCharacter_TestAndSetHit']]);
  } finally {
    await app.close();
  }
});

test('lint: encuentra lo editado a mano en compass/ y en los documentos, y sale con 1', async () => {
  let r = await cli('lint');
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /Sin coincidencias: 2 patrones/);
  // A mano: una tarea (aunque no pase el schema) y el GDD, con un nombre partido por el ajuste de línea.
  const t = await task('m1-05');
  await writeFile(join(dir, 'compass', 'tasks', 'm1-05.json'), JSON.stringify({ ...t, notes: 'ver XYrCollection_Lookup', raro: true }));
  await writeFile(join(dir, 'gdd.md'), '# GDD\n\n## IA\n<!-- id: ia -->\n\nComo en (Core_Script_\nExpr.c:159).\n');
  r = await cli('lint', '--json');
  assert.equal(r.code, 1);
  const { findings, patterns } = JSON.parse(r.out);
  assert.equal(patterns, 2);
  assert.deepEqual(findings.map((f) => [f.file, f.where ?? f.line, f.match]), [['compass/tasks/m1-05.json', 'notes', 'XYrCollection_Lookup'], ['gdd.md', 7, 'Expr.c']]);
  assert.match((await cli('lint')).out, /2 coincidencias en 2 archivos/);
  // Sin patrones no hay nada que revisar.
  await setConfig({ forbidden: undefined });
  r = await cli('lint');
  assert.deepEqual([r.code, r.out.trim()], [0, 'Sin patrones prohibidos en compass/config.json › forbidden.']);
  assert.ok(existsSync(join(dir, 'compass', 'tasks', 'm1-05.json')));
});
