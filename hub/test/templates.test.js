// Plantillas de proyecto en `scompass init` (8.7, spec §16.6, D25).
import './isolate.js';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadValidators } from '../src/schema.js';
import { loadCompass } from '../src/store/load.js';
import { loadProjects } from '../src/projects.js';
import { viewsOf } from '../src/views.js';
import { listTemplates, run } from '../src/cli.js';

const V = loadValidators();
let dir, saved;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'scompass-tpl-'));
  saved = process.env.SCOMPASS_CONFIG;
  process.env.SCOMPASS_CONFIG = join(dir, 'config');
});
afterEach(async () => {
  if (saved === undefined) delete process.env.SCOMPASS_CONFIG; else process.env.SCOMPASS_CONFIG = saved;
  await rm(dir, { recursive: true, force: true, maxRetries: 10 });
});

async function init(name, ...args) {
  const p = join(dir, name);
  await mkdir(p, { recursive: true });
  let out = '', err = '';
  const code = await run(['--dir', p, 'init', ...args], { out: { write: (s) => { out += s; } }, err: { write: (s) => { err += s; } } });
  return { p, code, out, err };
}

test('hay tres plantillas y todas crean un compass/ sin avisos', async () => {
  assert.deepEqual(await listTemplates(), ['juego', 'personal', 'vacio']);
  for (const t of await listTemplates()) {
    const r = await init(t, '--template', t);
    assert.equal(r.code, 0, r.err);
    const all = await loadCompass(join(r.p, 'compass'), V);
    assert.deepEqual(all.warnings, [], t);
  }
});

test('personal: abre en Listas, con Pendientes, Compras y el hito General', async () => {
  const r = await init('vida', '--template', 'personal', '--project', 'Vida');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /plantilla personal/);
  const all = await loadCompass(join(r.p, 'compass'), V);
  assert.equal(all.config.project, 'Vida');
  assert.equal(viewsOf(all.config)[0], 'lists');
  assert.deepEqual([...all.lists.keys()].sort(), ['compras', 'pendientes']);
  assert.ok(all.lists.get('pendientes').created_at, 'el store completa las fechas');
  assert.deepEqual([...all.milestones.values()].map((m) => m.title), ['General']);
  assert.match(await readFile(join(r.p, 'docs', 'tareas.md'), 'utf8'), /### Pendientes\n\n### Compras\n$/);
  // Queda anotado para el Inicio.
  assert.deepEqual(loadProjects().map((x) => x.name), ['Vida']);
});

test('juego: crea docs/gdd.md con ids, pero no pisa uno que ya exista', async () => {
  let r = await init('juego', '--template', 'juego');
  assert.match(await readFile(join(r.p, 'docs', 'gdd.md'), 'utf8'), /<!-- id: mecanicas -->/);
  assert.match(r.out, /Creado docs\/gdd\.md/);
  // Declara docs/**/*.md además del GDD (12.2): no lista el GDD dos veces ni el export (docs/tareas.md).
  await writeFile(join(r.p, 'docs', 'enemigos.md'), '# Enemigos\n');
  let out = '';
  assert.equal(await run(['--dir', r.p, 'doc', 'list', '--json'], { out: { write: (x) => { out += x; } }, err: { write() {} } }), 0);
  assert.deepEqual(JSON.parse(out).docs.map((d) => [d.alias, d.path]), [['gdd', 'docs/gdd.md'], ['docs/enemigos', 'docs/enemigos.md']]);
  const p2 = join(dir, 'con-gdd');
  await mkdir(join(p2, 'docs'), { recursive: true });
  await writeFile(join(p2, 'docs', 'gdd.md'), '# Mi GDD\n');
  r = await init('con-gdd', '--template', 'juego');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Ya existía docs\/gdd\.md: no se tocó/);
  assert.equal(await readFile(join(p2, 'docs', 'gdd.md'), 'utf8'), '# Mi GDD\n');
});

test('vacio (por defecto): lo de siempre, sin datos ni export', async () => {
  const r = await init('nada');
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(await readFile(join(r.p, 'compass', 'config.json'), 'utf8')), { export_md: 'docs/tareas.md', port: 4711, project: 'nada' });
  assert.deepEqual(await readdir(join(r.p, 'compass', 'milestones')), []);
  assert.ok(!existsSync(join(r.p, 'compass', 'lists')));
  assert.ok(!existsSync(join(r.p, 'docs')));
});

test('una plantilla desconocida no crea nada', async () => {
  const r = await init('mal', '--template', 'kanban');
  assert.equal(r.code, 2);
  assert.match(r.err, /plantilla desconocida: kanban \(juego, personal, vacio\)/);
  assert.ok(!existsSync(join(r.p, 'compass')));
});
