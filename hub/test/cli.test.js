import './isolate.js';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findProject, run } from '../src/cli.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = join(REPO, 'hub', 'test', 'fixtures', 'compass');
const NOW = '2026-10-01T12:00:00.000Z';
let dir;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'scompass-'));
  await cp(FIXTURE, join(dir, 'compass'), { recursive: true });
});
afterEach(() => rm(dir, { recursive: true, force: true, maxRetries: 10 }));

async function cli(argv, { cwd = dir, stdin = '' } = {}) {
  let out = '', err = '';
  const code = await run(argv, {
    cwd, now: () => NOW, stdin: Readable.from([stdin]),
    out: { write: (s) => { out += s; } }, err: { write: (s) => { err += s; } }
  });
  return { code, out, err, json: () => JSON.parse(out) };
}
const task = async (id) => JSON.parse(await readFile(join(dir, 'compass', 'tasks', `${id}.json`), 'utf8'));

test('findProject sube hasta la carpeta con compass/config.json; --dir manda', async () => {
  await mkdir(join(dir, 'a', 'b'), { recursive: true });
  assert.equal(findProject(join(dir, 'a', 'b')), dir);
  assert.equal(findProject(join(dir, 'a'), '..'), dir);
});

test('list --json: tareas con id y etag, filtros por hito y estado', async () => {
  const r = await cli(['list', '--json', '--milestone', 'm00', '--status', 'done']);
  assert.equal(r.code, 0);
  const { tasks, warnings } = r.json();
  assert.deepEqual(warnings, []);
  assert.ok(tasks.length > 0);
  for (const t of tasks) {
    assert.equal(t.milestone, 'm00');
    assert.equal(t.status, 'done');
    assert.match(t.etag, /^[0-9a-f]{16}$/);
  }
  assert.deepEqual(tasks.map((t) => t.id), [...tasks.map((t) => t.id)].sort());
  assert.equal((await cli(['list', '--status', 'wip'])).code, 2);
});

test('list en texto agrupa por hito', async () => {
  const r = await cli(['list']);
  assert.match(r.out, /M0 · Fundaciones del repo\n {2}m0-01 /);
  assert.ok(r.out.indexOf('M0 ·') < r.out.indexOf('M1 ·'));
});

test('add → move → check → show, escribiendo en compass/', async () => {
  const a = await cli(['add', 'Probar la CLI', '--milestone', 'm01', '--code', '1.8', '--json']);
  assert.equal(a.code, 0, a.err);
  const { id, order } = a.json();
  assert.equal(id, 'm1-08', 'el siguiente número del hito');
  assert.equal(order, 8);
  assert.equal((await task(id)).created_at, NOW);

  assert.equal((await cli(['move', id, 'doing'])).code, 0);
  assert.equal((await task(id)).status, 'doing');

  await cli(['set', id, '--file', '-'], { stdin: JSON.stringify({ ...(await task(id)), checklist: [{ text: 'uno', done: false }, { text: 'dos', done: false }] }) });
  assert.equal((await cli(['check', id, '2'])).code, 0);
  assert.deepEqual((await task(id)).checklist.map((c) => c.done), [false, true]);
  assert.equal((await cli(['check', id, '2', '--undo'])).code, 0);
  assert.deepEqual((await task(id)).checklist.map((c) => c.done), [false, false]);
  assert.equal((await cli(['check', id, '3'])).code, 1);

  const s = await cli(['show', id]);
  assert.match(s.out, /^1\.8 Probar la CLI {2}\[/);
  assert.match(s.out, / {3}2\. \[ \] dos/);

  // done_at (18.1): move a Hecho lo pone; show y el export dicen el día.
  assert.equal((await cli(['move', id, 'done'])).code, 0);
  assert.equal((await task(id)).done_at, NOW);
  assert.match((await cli(['show', id])).out, /Estado: Hecho el 2026-10-01 · /);
  assert.match(await readFile(join(dir, 'docs', 'tareas.md'), 'utf8'), /### 1\.8 Probar la CLI · Hecho\n\n\*\*Terminada:\*\* 2026-10-01\n/);
  assert.equal((await cli(['move', id, 'todo'])).code, 0);
  assert.equal('done_at' in (await task(id)), false);
});

test('--etag viejo: conflicto con el documento actual en --json y nada escrito', async () => {
  const { etag } = (await cli(['show', 'm1-04', '--json'])).json();
  assert.equal((await cli(['move', 'm1-04', 'doing', '--etag', etag])).code, 0);
  const r = await cli(['move', 'm1-04', 'review', '--etag', etag, '--json']);
  assert.equal(r.code, 1);
  const { error } = JSON.parse(r.err);
  assert.equal(error.code, 'conflict');
  assert.equal(error.current.doc.status, 'doing');
  assert.equal((await task('m1-04')).status, 'doing');
});

test('errores: tarea o hito inexistente, estado inválido, comando desconocido', async () => {
  assert.equal((await cli(['show', 'nada'])).code, 1);
  assert.equal((await cli(['add', 'x', '--milestone', 'm99'])).code, 1);
  assert.equal((await cli(['move', 'm0-01', 'wip'])).code, 2);
  assert.equal((await cli(['volar'])).code, 2);
});

test('set y milestone set validan y no pisan con un documento inválido', async () => {
  const before = await readFile(join(dir, 'compass', 'tasks', 'm0-01.json'), 'utf8');
  await writeFile(join(dir, 'bad.json'), JSON.stringify({ milestone: 'm00', title: 'x', status: 'wip' }));
  const r = await cli(['set', 'm0-01', '--file', 'bad.json']);
  assert.equal(r.code, 1);
  assert.match(r.err, /invalid_argument.*status/);
  assert.equal(await readFile(join(dir, 'compass', 'tasks', 'm0-01.json'), 'utf8'), before);

  await writeFile(join(dir, 'm.json'), JSON.stringify({ code: 'M8', order: 8, title: 'Extra' }));
  assert.equal((await cli(['milestone', 'set', 'm08', '--file', 'm.json'])).code, 0);
  assert.equal((await cli(['milestone', 'show', 'm08', '--json'])).json().title, 'Extra');
  assert.ok((await cli(['milestone', 'list'])).out.includes('m08'));
});

test('init crea un compass/ válido y no pisa uno existente', async () => {
  const p = join(dir, 'nuevo');
  await mkdir(p);
  const r = await cli(['--dir', p, 'init', '--project', 'Nuevo']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual((await readdir(join(p, 'compass'))).sort(), ['.gdignore', '.gitattributes', 'AGENTS.md', 'README.md', 'config.json', 'milestones', 'schema', 'tasks']);
  assert.deepEqual(JSON.parse(await readFile(join(p, 'compass', 'config.json'), 'utf8')), { export_md: 'docs/tareas.md', port: 4711, project: 'Nuevo' });
  assert.equal((await cli(['list', '--json'], { cwd: p })).json().tasks.length, 0);
  assert.equal((await cli(['--dir', p, 'init'])).code, 1);
  // update: recién creada está al día; con el schema y la guía viejos, --check avisa y update los repone
  // sin tocar los datos.
  assert.equal((await cli(['--dir', p, 'update', '--check'])).code, 0);
  await writeFile(join(p, 'compass', 'AGENTS.md'), 'vieja');
  await writeFile(join(p, 'compass', 'schema', 'task.schema.json'), '{}');
  const check = await cli(['--dir', p, 'update', '--check', '--json']);
  assert.equal(check.code, 1);
  assert.deepEqual(check.json().outdated, ['compass/schema/task.schema.json', 'compass/AGENTS.md']);
  assert.deepEqual((await cli(['--dir', p, 'update', '--json'])).json().updated, ['compass/schema/task.schema.json', 'compass/AGENTS.md']);
  assert.equal(await readFile(join(p, 'compass', 'schema', 'task.schema.json'), 'utf8'), await readFile(join(REPO, 'schema', 'task.schema.json'), 'utf8'));
  assert.deepEqual((await cli(['--dir', p, 'update', '--json'])).json().updated, []);
  // La guía para agentes nombra comandos que existen.
  const guide = await readFile(join(p, 'compass', 'AGENTS.md'), 'utf8');
  const help = (await cli(['--help'])).out;
  for (const m of guide.matchAll(/^scompass ([a-z]+)/gm)) assert.ok(help.includes(`\n  ${m[1]} `), `la guía usa un comando que no está en --help: ${m[1]}`);
  assert.equal((await cli(['--dir', join(dir, 'vacio'), 'update'])).code, 1);
  // El addon lleva la misma guía: en un proyecto que solo tiene el plugin, es lo que el agente encuentra.
  assert.equal(await readFile(new URL('../../addons/scope_compass/AGENTS.md', import.meta.url), 'utf8'), guide, 'addons/scope_compass/AGENTS.md no coincide con hub/templates/compass-AGENTS.md');
});

test('link: bloquea, bloqueada por y relacionada; sin ciclos; el inverso se calcula; rotos', async () => {
  const [a, b, c] = ['m1-01', 'm1-02', 'm1-03'];
  for (const id of [a, b, c]) assert.equal((await cli(['move', id, 'todo'])).code, 0);
  assert.equal((await cli(['link', 'add', a, 'blocks', b])).code, 0);
  assert.equal((await cli(['link', 'add', c, 'blocked-by', b])).code, 0);
  // Se guarda en la que bloquea.
  assert.deepEqual((await cli(['show', a, '--json'])).json().links, [{ task: b, type: 'blocks' }]);
  assert.deepEqual((await cli(['show', b, '--json'])).json().links, [{ task: c, type: 'blocks' }]);
  assert.equal((await cli(['show', c, '--json'])).json().links, undefined);
  // c → a cerraría el ciclo a → b → c.
  const cyc = await cli(['link', 'add', c, 'blocks', a]);
  assert.equal(cyc.code, 1);
  assert.match(cyc.err, /ciclo/);
  assert.equal((await cli(['link', 'add', a, 'blocks', a])).code, 1);
  assert.equal((await cli(['link', 'add', a, 'blocks', 'no-existe'])).code, 1);
  assert.equal((await cli(['link', 'add', a, 'related', c])).code, 0);
  assert.deepEqual((await cli(['link', 'list', b, '--json'])).json(), { links: [{ id: b, blocks: [c], blocked_by: [a], related: [] }], broken: [] });
  assert.deepEqual((await cli(['link', 'list', c, '--json'])).json().links[0], { id: c, blocks: [], blocked_by: [b], related: [a] });
  const shown = (await cli(['show', b])).out;
  assert.match(shown, /Bloquea a: m1-03 \(/);
  assert.match(shown, /Bloqueada por: m1-01 \(/);
  assert.match((await cli(['list', '--milestone', 'm01'])).out, /\[bloqueada por m1-01\]/);
  // Una tarea terminada ya no bloquea.
  await cli(['move', a, 'done']);
  assert.doesNotMatch((await cli(['list', '--milestone', 'm01'])).out, /\[bloqueada por m1-01\]/);
  const md = await readFile(join(dir, 'docs', 'tareas.md'), 'utf8');
  assert.match(md, /\*\*Bloqueada por:\*\* /);
  assert.match(md, /\*\*Relacionadas:\*\* /);
  // Un vínculo nuevo entre las mismas dos reemplaza al anterior, esté en la tarea que esté.
  assert.equal((await cli(['link', 'add', c, 'blocked-by', a])).code, 0);
  assert.deepEqual((await cli(['show', a, '--json'])).json().links, [{ task: b, type: 'blocks' }, { task: c, type: 'blocks' }]);
  assert.equal((await cli(['link', 'rm', a, c])).code, 0);
  assert.equal((await cli(['link', 'rm', a, c])).code, 1);
  // Vínculo a una tarea que ya no existe: link list lo avisa y sale con 1; rm lo limpia.
  await rm(join(dir, 'compass', 'tasks', `${c}.json`));
  const broken = await cli(['link', 'list', '--json']);
  assert.equal(broken.code, 1);
  assert.deepEqual(broken.json().broken, [{ id: b, type: 'blocks', task: c }]);
  assert.equal((await cli(['link', 'rm', b, c])).code, 0);
  assert.equal((await cli(['link', 'list'])).code, 0);
});

test('--etag none: set crea solo si no existe', async () => {
  await writeFile(join(dir, 't.json'), JSON.stringify({ milestone: 'm02', title: 'Nueva', status: 'todo' }));
  assert.equal((await cli(['set', 'm2-99', '--file', 't.json', '--etag', 'none'])).code, 0);
  const again = await cli(['set', 'm2-99', '--file', 't.json', '--etag', 'none']);
  assert.equal(again.code, 1);
  assert.match(again.err, /conflict/);
});

test('19.4: set --file acepta lo que da show --json; su etag es el If-Match y un id de otra tarea no pasa', async () => {
  const shown = (await cli(['show', 'm1-07', '--json'])).json();
  await writeFile(join(dir, 't.json'), JSON.stringify({ ...shown, notes: 'editada' }));
  const r = await cli(['set', 'm1-07', '--file', 't.json']);
  assert.equal(r.code, 0, r.err);
  assert.equal((await task('m1-07')).notes, 'editada');
  assert.equal((await task('m1-07')).id, undefined);
  // El mismo archivo otra vez: el etag ya no es el actual.
  assert.match((await cli(['set', 'm1-07', '--file', 't.json'])).err, /conflict/);
  assert.equal((await cli(['set', 'm1-06', '--file', 't.json', '--etag', 'x'])).code, 2);
  const ms = (await cli(['milestone', 'show', 'm01', '--json'])).json();
  await writeFile(join(dir, 'm.json'), JSON.stringify({ ...ms, goal: 'Otra meta' }));
  assert.equal((await cli(['milestone', 'set', 'm01', '--file', 'm.json'])).code, 0);
});

test('set con campos sueltos cambia solo esos campos', async () => {
  const before = await task('m1-07');
  const r = await cli(['set', 'm1-07', '--notes', 'nota nueva', '--title', 'Otro título', '--json']);
  assert.equal(r.code, 0, r.err);
  const after = await task('m1-07');
  assert.deepEqual({ ...after, updated_at: 0 }, { ...before, notes: 'nota nueva', title: 'Otro título', updated_at: 0 });
  assert.equal((await cli(['set', 'm1-07', '--status', 'wip'])).code, 2);
  assert.equal((await cli(['set', 'm1-07'])).code, 2, 'sin --file ni campos');
  assert.equal((await cli(['set', 'm1-07', '--file', 'x.json', '--notes', 'n'])).code, 2, 'no se combinan');
  assert.equal((await cli(['set', 'nada', '--notes', 'n'])).code, 1);
});

test('description (17.1): add y set la escriben, "" la quita; show y el export la ponen antes de los pasos', async () => {
  const a = await cli(['add', 'Con descripción', '--milestone', 'm01', '--description', 'Qué hacer y por qué', '--json']);
  assert.equal(a.code, 0, a.err);
  const { id } = a.json();
  assert.equal((await task(id)).description, 'Qué hacer y por qué');
  assert.equal((await task((await cli(['add', 'Sin', '--milestone', 'm01', '--description', ' ', '--json'])).json().id)).description, undefined);
  assert.equal((await cli(['step', 'add', id, 'Un paso'])).code, 0);
  assert.equal((await cli(['set', id, '--description', 'Línea uno\nLínea dos', '--notes', 'Lo que salió'])).code, 0);
  assert.match((await cli(['show', id])).out, /\nLínea uno\nLínea dos\n {3}1\. \[ \] Un paso\n[^]*Notas: Lo que salió/);
  const md = await readFile(join(dir, 'docs', 'tareas.md'), 'utf8');
  assert.match(md, new RegExp(`### Con descripción · Pendiente\\n\\nLínea uno\\nLínea dos\\n\\n- \\[ \\] Un paso\\n`));
  assert.equal((await cli(['set', id, '--description', ''])).code, 0);
  assert.equal('description' in (await task(id)), false);
});

test('fecha objetivo del hito (18.2): milestone set --due, atrasado si pasa con tareas sin terminar', async () => {
  assert.equal((await cli(['milestone', 'set', 'm01', '--due', '2020-01-01'])).code, 0);
  const file = JSON.parse(await readFile(join(dir, 'compass', 'milestones', 'm01.json'), 'utf8'));
  assert.equal(file.due, '2020-01-01');
  assert.ok(file.title && file.done_when, 'el resto del hito queda igual');
  // Todas hechas (el fixture): la fecha pasó, pero no está atrasado.
  assert.doesNotMatch((await cli(['milestone', 'list'])).out, /atrasado/);
  assert.equal((await cli(['move', 'm1-07', 'doing'])).code, 0);
  assert.match((await cli(['milestone', 'list'])).out, /m01 +M1 +.* · fecha objetivo 2020-01-01 \(atrasado\)/);
  assert.match((await cli(['milestone', 'show', 'm01'])).out, /\nFecha objetivo 2020-01-01 \(atrasado\)\n/);
  assert.match((await cli(['list', '--milestone', 'm01'])).out, /M1 · .* · fecha objetivo 2020-01-01 \(atrasado\)/);
  assert.match(await readFile(join(dir, 'docs', 'tareas.md'), 'utf8'), /\*\*Fecha objetivo:\*\* 2020-01-01 \(atrasado\)/);
  assert.equal((await cli(['milestone', 'set', 'm01', '--due', '31/12'])).code, 1, 'fecha inválida');
  assert.equal((await cli(['milestone', 'set', 'm01', '--due', '2020-01-01', '--file', 'x.json'])).code, 2);
  assert.equal((await cli(['milestone', 'set', 'm01', '--due', ''])).code, 0);
  assert.equal('due' in JSON.parse(await readFile(join(dir, 'compass', 'milestones', 'm01.json'), 'utf8')), false);
});

test('tamaño (18.3): add y set --size (sin distinguir mayúsculas), list --size, show y el export', async () => {
  const id = (await cli(['add', 'Grande', '--milestone', 'm01', '--size', 'L', '--json'])).json().id;
  assert.equal((await task(id)).size, 'l');
  assert.equal((await cli(['set', 'm1-07', '--size', 'm'])).code, 0);
  assert.equal((await cli(['set', 'm1-07', '--size', 'xl'])).code, 2);
  assert.deepEqual((await cli(['list', '--size', 'l,m', '--json'])).json().tasks.map((t) => t.id), ['m1-07', id]);
  assert.equal((await cli(['list', '--size', 'none', '--json'])).json().tasks.some((t) => t.size), false);
  assert.match((await cli(['show', id])).out, /tamaño L/);
  assert.match(await readFile(join(dir, 'docs', 'tareas.md'), 'utf8'), /### Grande · Pendiente\n\n\*\*Tamaño:\*\* L\n/);
  assert.equal((await cli(['set', id, '--size', ''])).code, 0);
  assert.equal('size' in (await task(id)), false);
});

test('capturas (18.4): image add copia una de afuera a compass/images/, cita una del repo; image rm; refs check', async () => {
  const { execFileSync } = await import('node:child_process');
  const { existsSync } = await import('node:fs');
  execFileSync('git', ['init', '-q', dir]);
  const outside = await mkdtemp(join(tmpdir(), 'shot-'));
  try {
    await writeFile(join(outside, 'captura.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
    const a = await cli(['image', 'add', 'm1-07', join(outside, 'captura.png'), '--json']);
    assert.equal(a.code, 0, a.err);
    const [copied] = a.json().images;
    assert.match(copied, /^compass\/images\/m1-07-.*\.png$/);
    assert.ok(existsSync(join(dir, copied)));
    await mkdir(join(dir, 'arte'));
    await writeFile(join(dir, 'arte', 'boceto.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
    assert.equal((await cli(['image', 'add', 'm1-07', 'arte/boceto.png'])).code, 0);
    assert.deepEqual((await task('m1-07')).images, [copied, 'arte/boceto.png']);
    assert.equal((await cli(['image', 'add', 'm1-07', 'compass/config.json'])).code, 1, 'no es una imagen');
    assert.equal((await cli(['image', 'add', 'm1-07', 'nada.png'])).code, 1, 'no está en el repo');
    assert.match(await readFile(join(dir, 'docs', 'tareas.md'), 'utf8'), /\*\*Capturas:\*\* `compass\/images\/m1-07-.*\.png`, `arte\/boceto\.png`/);
    assert.match((await cli(['image', 'rm', 'm1-07', copied])).out, /borrado el archivo/);
    assert.equal(existsSync(join(dir, copied)), false);
    await rm(join(dir, 'arte', 'boceto.png'));
    const check = await cli(['refs', 'check', '--json']);
    assert.deepEqual(check.json().broken.filter((b) => b.where === 'images').map((b) => [b.ref, b.problem]), [['arte/boceto.png', 'missing_file']]);
    assert.match((await cli(['image', 'rm', 'm1-07', 'arte/boceto.png'])).out, /quitada arte\/boceto\.png$/m);
    assert.equal('images' in (await task('m1-07')), false);
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

test('19.6: sin repo de git, las capturas andan: image add de una del proyecto, refs check y /api/files/raw', async () => {
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  await mkdir(join(dir, 'arte'));
  await writeFile(join(dir, 'arte', 'boceto.png'), PNG);
  await writeFile(join(dir, 'secreto.txt'), 'no');
  const r = await cli(['image', 'add', 'm1-07', 'arte/boceto.png']);
  assert.equal(r.code, 0, r.err);
  assert.equal((await cli(['image', 'add', 'm1-07', 'nada.png'])).code, 1);
  assert.deepEqual((await cli(['refs', 'check', '--json'])).json().broken.filter((b) => b.where === 'images'), []);
  const { createServer } = await import('../src/server.js');
  const { createJsonFilesStore } = await import('../src/store/json-files.js');
  const { loadValidators } = await import('../src/schema.js');
  const V = loadValidators();
  const app = createServer({ projectDir: dir, store: createJsonFilesStore(join(dir, 'compass'), { validators: V }), validators: V });
  try {
    const raw = await app.inject({ url: '/api/files/raw?path=arte/boceto.png' });
    assert.equal(raw.statusCode, 200);
    assert.equal(raw.headers['content-type'], 'image/png');
    // Sin repo no se sirve otra cosa que imágenes.
    assert.equal((await app.inject({ url: '/api/files/file?path=secreto.txt' })).statusCode, 404);
  } finally {
    await app.close();
  }
  await rm(join(dir, 'arte', 'boceto.png'));
  assert.deepEqual((await cli(['refs', 'check', '--json'])).json().broken.filter((b) => b.where === 'images').map((b) => b.ref), ['arte/boceto.png']);
});

test('plantilla de descripción por etiqueta (18.6): add y set --tags la ponen solo si no hay descripción', async () => {
  const cfg = join(dir, 'compass', 'config.json');
  await writeFile(cfg, JSON.stringify({ ...JSON.parse(await readFile(cfg, 'utf8')), description_templates: { bug: 'Cómo reproducirlo:' } }));
  const a = (await cli(['add', 'Se cuelga', '--milestone', 'm01', '--tags', 'ui,bug', '--json'])).json();
  assert.equal(a.description, 'Cómo reproducirlo:');
  const b = (await cli(['add', 'Con texto', '--milestone', 'm01', '--tags', 'bug', '--description', 'Ya dice qué', '--json'])).json();
  assert.equal(b.description, 'Ya dice qué', 'una descripción dada manda');
  assert.equal((await cli(['set', 'm1-07', '--tags', 'bug'])).code, 0);
  assert.equal((await task('m1-07')).description, 'Cómo reproducirlo:');
  assert.equal((await cli(['set', 'm1-07', '--description', 'Otra cosa'])).code, 0);
  assert.equal((await cli(['set', 'm1-07', '--tags', 'arte'])).code, 0);
  assert.equal((await cli(['set', 'm1-07', '--tags', 'bug'])).code, 0);
  assert.equal((await task('m1-07')).description, 'Otra cosa', 'con descripción, no la pisa');
});

test('serve --exit-on-stdin-close: se cierra cuando se corta la entrada; sin la opción, no', async () => {
  const { spawn } = await import('node:child_process');
  const bin = join(REPO, 'hub', 'bin', 'scompass.js');
  const start = (extra) => new Promise((resolve) => {
    const p = spawn(process.execPath, [bin, '--dir', dir, 'serve', '--port', '0', ...extra]);
    p.stdout.once('data', (d) => resolve({ p, url: /(http:\/\/127\.0\.0\.1:\d+\/)/.exec(String(d))[1] }));
  });
  const exit = (p) => new Promise((r) => (p.exitCode !== null ? r(p.exitCode) : p.on('exit', r)));
  const { p: withFlag } = await start(['--exit-on-stdin-close']);
  const t0 = Date.now();
  withFlag.stdin.end();
  assert.equal(await exit(withFlag), 0);
  assert.ok(Date.now() - t0 < 2000);

  const { p: without, url } = await start([]);
  without.stdin.end();
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(without.exitCode, null, 'sin la opción sigue corriendo');
  // Se apaga ordenado por la API, en todas las plataformas (§18).
  assert.equal((await fetch(url + 'api/shutdown', { method: 'POST' })).status, 202);
  assert.equal(await exit(without), 0);
});

test('serve --lan: escucha también en la red y dice en qué direcciones (D36)', async () => {
  const { spawn } = await import('node:child_process');
  const p = spawn(process.execPath, [join(REPO, 'hub', 'bin', 'scompass.js'), '--dir', dir, '--json', 'serve', '--port', '0', '--lan']);
  const out = JSON.parse(String(await new Promise((r) => p.stdout.once('data', r))));
  assert.match(out.url, /^http:\/\/127\.0\.0\.1:\d+\/$/, 'el dock y la CLI siguen por 127.0.0.1');
  assert.ok(Array.isArray(out.lan));
  for (const u of [out.url, ...out.lan]) assert.equal((await fetch(u + 'api/health')).status, 200, u);
  const exited = new Promise((r) => p.on('exit', r));
  await fetch(out.url + 'api/shutdown', { method: 'POST' });
  assert.equal(await exited, 0);
});

test('serve --log: la salida se agrega al archivo (el dock en Windows, sin sh)', async () => {
  const { spawn } = await import('node:child_process');
  const { readFile: rf, writeFile: wf } = await import('node:fs/promises');
  const log = join(dir, 'hub.log');
  await wf(log, 'antes\n');
  const p = spawn(process.execPath, [join(REPO, 'hub', 'bin', 'scompass.js'), '--dir', dir, 'serve', '--port', '0', '--log', log]);
  let text = '';
  for (let i = 0; i < 100 && !/http:\/\/127/.test(text); i++) { await new Promise((r) => setTimeout(r, 50)); text = await rf(log, 'utf8'); }
  assert.match(text, /^antes\nScope Compass en http:\/\/127\.0\.0\.1:\d+\//, 'agrega, no pisa');
  const exited = new Promise((r) => p.on('exit', r));
  await fetch(/(http:\/\/127\.0\.0\.1:\d+\/)/.exec(text)[1] + 'api/shutdown', { method: 'POST' });
  assert.equal(await exited, 0);
});

test('serve: SIGTERM lo cierra ordenado (Linux)', { skip: process.platform === 'win32' && 'Windows no tiene SIGTERM' }, async () => {
  const { spawn } = await import('node:child_process');
  const p = spawn(process.execPath, [join(REPO, 'hub', 'bin', 'scompass.js'), '--dir', dir, 'serve', '--port', '0']);
  const url = /(http:\/\/127\.0\.0\.1:\d+\/)/.exec(String(await new Promise((r) => p.stdout.once('data', r))))[1];
  // Que responda: el hub anuncia la URL un momento antes de instalar el manejador de SIGTERM.
  await fetch(url + 'api/health');
  p.kill('SIGTERM');
  assert.equal(await new Promise((r) => p.on('exit', r)), 0);
});

test('step add/set/rm: texto corto y detalle; show imprime el detalle sangrado', async () => {
  assert.equal((await cli(['step', 'add', 'm1-07', 'Acciones de juego', '--detail', 'interact (B / E)\ndodge (B / Espacio)'])).code, 0);
  let steps = (await task('m1-07')).checklist;
  assert.deepEqual(steps.at(-1), { text: 'Acciones de juego', done: false, detail: 'interact (B / E)\ndodge (B / Espacio)' });
  const n = String(steps.length);
  const show = await cli(['show', 'm1-07']);
  assert.match(show.out, new RegExp(`${n}\\. \\[ \\] Acciones de juego\\n {9}interact \\(B / E\\)\\n {9}dodge`));
  assert.equal((await cli(['step', 'set', 'm1-07', n, '--text', 'Acciones'])).code, 0);
  assert.equal((await task('m1-07')).checklist.at(-1).detail, 'interact (B / E)\ndodge (B / Espacio)', 'cambiar el texto conserva el detalle');
  assert.equal((await cli(['step', 'set', 'm1-07', n, '--detail', ''])).code, 0);
  assert.deepEqual((await task('m1-07')).checklist.at(-1), { text: 'Acciones', done: false }, '--detail "" lo quita');
  assert.equal((await cli(['step', 'set', 'm1-07', '99', '--text', 'x'])).code, 1);
  assert.equal((await cli(['step', 'set', 'm1-07', n])).code, 2);
  assert.equal((await cli(['step', 'rm', 'm1-07', n])).code, 0);
  assert.equal((await task('m1-07')).checklist.length, steps.length - 1);
});
