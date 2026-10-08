import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadValidators, parseDoc } from '../src/schema.js';
import { loadCompass } from '../src/store/load.js';
import { canonical } from '../src/store/canonical.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = join(REPO, 'hub', 'test', 'fixtures', 'compass');
const V = loadValidators();
const task = { milestone: 'm00', title: 'x', status: 'todo' };

test('una tarea mínima es válida', () => {
  assert.deepEqual(parseDoc(JSON.stringify(task), 'task', V), { ok: true, doc: task });
});

test('campo desconocido, estado inválido y fecha rota se reportan', () => {
  const res = parseDoc(JSON.stringify({ ...task, extra: 1, status: 'wip', created_at: 'ayer' }), 'task', V);
  assert.equal(res.ok, false);
  assert.equal(res.code, 'invalid_schema');
  assert.equal(res.details.length, 3);
  assert.match(res.message, /extra/);
  assert.match(res.message, /\/status.*todo, doing, review, done/);
  assert.match(res.message, /\/created_at.*date-time/);
});

test('etiquetas, prioridad y responsable (M11): válidos, y los valores rotos se reportan', () => {
  const ok = { ...task, tags: ['arte', 'nivel 2'], priority: 'high', assignee: 'Claude' };
  assert.equal(parseDoc(JSON.stringify(ok), 'task', V).ok, true);
  for (const bad of [{ priority: 'urgente' }, { assignee: '' }, { tags: ['a,b'] }, { tags: [' arte'] }, { tags: ['arte', 'arte'] }, { tags: [''] }, { tags: 'arte' }]) {
    const res = parseDoc(JSON.stringify({ ...task, ...bad }), 'task', V);
    assert.equal(res.code, 'invalid_schema', JSON.stringify(bad));
  }
});

test('JSON roto y marcadores de conflicto se distinguen', () => {
  assert.equal(parseDoc('{"title": ', 'task', V).code, 'invalid_json');
  const merged = '{\n<<<<<<< HEAD\n  "status": "done",\n=======\n  "status": "doing",\n>>>>>>> otra\n}\n';
  assert.equal(parseDoc(merged, 'task', V).code, 'conflict_markers');
  // Un texto que solo contiene "=======" en medio de una línea no es un conflicto.
  assert.equal(parseDoc(JSON.stringify({ ...task, notes: 'a ======= b' }), 'task', V).ok, true);
});

test('config: puerto fuera de rango y alias inválido', () => {
  const res = parseDoc(JSON.stringify({ project: 'P', port: 70000, docs: [{ alias: 'GDD!', path: 'gdd.md' }] }), 'config', V);
  assert.equal(res.code, 'invalid_schema');
  assert.equal(res.details.length, 2);
});

test('los datos reales de compass/ cargan sin avisos', async () => {
  const c = await loadCompass(join(REPO, 'compass'), V);
  assert.deepEqual(c.warnings, []);
  assert.equal(c.config.project, 'Scope Compass');
  assert.ok(c.milestones.has('m00'));
  assert.ok(c.tasks.has('m0-01'));
});

test('un archivo inválido se reporta, no se carga y queda sin tocar', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'scompass-'));
  try {
    const compass = join(dir, 'compass');
    await cp(FIXTURE, compass, { recursive: true });
    const bad = join(compass, 'tasks', 'm0-01.json');
    const conflict = join(compass, 'tasks', 'm0-02.json');
    const orphan = join(compass, 'tasks', 'zz.json');
    const badText = canonical({ ...task, extra: true });
    const conflictText = '<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> x\n';
    await writeFile(bad, badText);
    await writeFile(conflict, conflictText);
    await writeFile(orphan, canonical({ ...task, milestone: 'm99' }));
    await writeFile(join(compass, 'tasks', '.m0-03.json.abcd1234.tmp'), 'basura');

    const c = await loadCompass(compass, V);
    assert.deepEqual(c.warnings.map((w) => [w.path, w.code]), [
      ['compass/tasks/m0-01.json', 'invalid_schema'],
      ['compass/tasks/m0-02.json', 'conflict_markers'],
      ['compass/tasks/zz.json', 'unknown_milestone']
    ]);
    assert.ok(!c.tasks.has('m0-01'));
    assert.ok(!c.tasks.has('m0-02'));
    assert.ok(c.tasks.has('m0-03'));
    assert.equal(await readFile(bad, 'utf8'), badText);
    assert.equal(await readFile(conflict, 'utf8'), conflictText);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('config.views: pestañas conocidas, sin repetir, y por defecto las tres con el tablero primero', async () => {
  const { viewsOf } = await import('../src/views.js');
  const V = loadValidators();
  const cfg = (views) => JSON.stringify({ project: 'P', ...(views && { views }) });
  assert.ok(parseDoc(cfg(['lists', 'board']), 'config', V).ok);
  for (const bad of [[], ['lists', 'lists'], ['kanban']]) assert.equal(parseDoc(cfg(bad), 'config', V).ok, false, JSON.stringify(bad));
  assert.deepEqual(viewsOf({ project: 'P' }), ['board', 'lists', 'docs']);
  assert.deepEqual(viewsOf({ project: 'P', views: ['lists', 'board'] }), ['lists', 'board']);
  assert.deepEqual(viewsOf(null), ['board', 'lists', 'docs']);
});
