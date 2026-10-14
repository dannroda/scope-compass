import './isolate.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadValidators } from '../src/schema.js';
import { loadCompass } from '../src/store/load.js';
import { renderMarkdown } from '../src/export-md.js';
import { run } from '../src/cli.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = join(REPO, 'hub', 'test', 'fixtures', 'compass');
const V = loadValidators();
const quiet = { out: { write() {} }, err: { write() {} } };

async function python(src, board, title) {
  const dir = await mkdtemp(join(tmpdir(), 'scompass-py-'));
  try {
    execFileSync('python3', [join(REPO, 'tools', 'artifact_to_md.py'), src, join(dir, 'out.md'), '--board', board, '--title', title]);
    return await readFile(join(dir, 'out.md'), 'utf8');
  } catch (e) {
    // Sin Python: no está (ENOENT), o en Windows `python3` es el alias de la Store, que sale con 9009.
    if (e.code === 'ENOENT' || e.status === 9009) return null;
    throw e;
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10 });
  }
}
const dateOf = (md) => md.match(/^> Generado: (\S+)$/m)[1];

for (const [name, dir] of [['Scope Compass', join(REPO, 'compass')], ['Project Epiphany', join(REPO, '..', 'project-epiphany', 'compass')]]) {
  test(`misma salida que tools/artifact_to_md.py: ${name}`, { skip: !existsSync(dir) && 'no está el proyecto' }, async (t) => {
    const all = await loadCompass(dir, V);
    const board = all.config.board_url ?? 'https://claude.ai/artifact/x';
    const expected = await python(dir, board, name);
    if (expected === null) return t.skip('sin python3');
    // El prototipo de Python es anterior a los vínculos (D22), las listas (D25), las fechas (D26), a etiquetas, prioridad y
    // responsable (D32), a los archivos de la tarea (15.1), a la descripción (D37), a done_at (18.1), al tamaño (18.3), a las
    // capturas (D38) y al playtest (D39): la paridad se mide sin ellos.
    const noLinks = { ...all, lists: [], playtests: [], tasks: [...all.tasks].map(([id, { links, due, tags, priority, assignee, description, done_at, size, files, images, ...doc }]) => [id, doc]) };
    assert.equal(renderMarkdown(noLinks, { title: name, board, date: dateOf(expected) }), expected);
  });
}

test('orden: por order y después code como texto, como en Python', () => {
  const md = renderMarkdown({
    milestones: [['m01', { code: 'M1', order: 1, title: 'Uno' }], ['m00', { code: 'M0', order: 0, title: 'Cero', goal: 'g' }]],
    tasks: [
      ['b', { milestone: 'm00', title: 'B', code: '0.10', status: 'todo', order: 1 }],
      ['a', { milestone: 'm00', title: 'A', code: '0.9', status: 'done', order: 1 }],
      ['c', { milestone: 'm00', title: 'C', code: '0.2', status: 'doing', order: 0 }],
      ['x', { milestone: 'm99', title: 'Huérfana', status: 'todo' }]
    ]
  }, { title: 'P', date: '2026-01-01' });
  assert.deepEqual(md.match(/^###.*$/gm), ['### 0.2 C · En curso', '### 0.10 B · Pendiente', '### 0.9 A · Hecho']);
  assert.ok(md.indexOf('## M0 — Cero  (1/3)') < md.indexOf('## M1 — Uno'));
  assert.match(md, /Export de `compass\/`, que es la fuente de verdad/);
  assert.ok(!md.includes('Huérfana'));
  assert.ok(md.endsWith('## M1 — Uno\n'));
});

test('CLI: export md y export automático al escribir, salvo auto_export_md: false', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'scompass-'));
  try {
    await cp(FIXTURE, join(dir, 'compass'), { recursive: true });
    const md = join(dir, 'docs', 'tareas.md');
    assert.equal(await run(['export', 'md'], { cwd: dir, ...quiet }), 0);
    assert.match(await readFile(md, 'utf8'), /^# Tareas — Scope Compass\n/);

    assert.equal(await run(['export', 'md', '--out', 'otro.md'], { cwd: dir, ...quiet }), 0);
    assert.ok(existsSync(join(dir, 'otro.md')));

    assert.equal(await run(['move', 'm1-07', 'review'], { cwd: dir, ...quiet }), 0);
    assert.match(await readFile(md, 'utf8'), /### 1\.7 Tests de M1 · Revisión/);

    const cfgPath = join(dir, 'compass', 'config.json');
    await writeFile(cfgPath, JSON.stringify({ ...JSON.parse(await readFile(cfgPath, 'utf8')), auto_export_md: false }));
    assert.equal(await run(['move', 'm1-07', 'done'], { cwd: dir, ...quiet }), 0);
    assert.match(await readFile(md, 'utf8'), /### 1\.7 Tests de M1 · Revisión/);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('el detalle de un paso va sangrado debajo, igual que en tools/artifact_to_md.py', async (t) => {
  const d = await mkdtemp(join(tmpdir(), 'scompass-'));
  try {
    await cp(FIXTURE, join(d, 'compass'), { recursive: true });
    const p = join(d, 'compass', 'tasks', 'm1-07.json');
    const task = JSON.parse(await readFile(p, 'utf8'));
    task.checklist[0].detail = 'Primera línea con `código`\n\nTercera, tras una vacía';
    await writeFile(p, JSON.stringify(task, null, 2) + '\n');
    const all = await loadCompass(join(d, 'compass'), V);
    const md = renderMarkdown(all, { title: 'T', board: 'https://x', date: '2026-01-01' });
    assert.match(md, /- \[x\] [^\n]+\n {2}Primera línea con `código`\n\n {2}Tercera, tras una vacía\n/);
    const expected = await python(join(d, 'compass'), 'https://x', 'T');
    if (expected === null) return t.skip('sin python3');
    assert.equal(renderMarkdown(all, { title: 'T', board: 'https://x', date: dateOf(expected) }), expected);
  } finally {
    await rm(d, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('prioridad, responsable y etiquetas van en una línea debajo del título (M11)', () => {
  const md = renderMarkdown({
    milestones: [['m00', { code: 'M0', title: 'Hito', order: 0 }]],
    tasks: [['a', { milestone: 'm00', code: '0.1', title: 'Con todo', status: 'todo', priority: 'high', assignee: 'Dani', tags: ['arte', 'nivel'] }],
      ['b', { milestone: 'm00', code: '0.2', title: 'Sin nada', status: 'todo' }]]
  }, { title: 'T', date: '2026-10-08' });
  assert.match(md, /### 0\.1 Con todo · Pendiente\n\n\*\*Prioridad:\*\* alta · \*\*Responsable:\*\* Dani · \*\*Etiquetas:\*\* `arte`, `nivel`\n\n/);
  assert.doesNotMatch(md.split('### 0.2')[1], /Prioridad/);
});

test('19.7: un título o un paso con saltos de línea van en un renglón; un # al empezar un renglón no es un encabezado', () => {
  const md = renderMarkdown({
    milestones: [['m00', { code: 'M0', title: 'Hito\nroto', order: 0, goal: 'Meta\n# no' }]],
    tasks: [['a', { milestone: 'm00', code: '0.1', title: 'Dos\nrenglones', status: 'todo', description: 'Uno\n## Falso\n  # otro', notes: 'n\n# x',
      checklist: [{ text: 'paso\npartido', done: false }] }]]
  }, { title: 'T', date: '2026-10-08' });
  assert.deepEqual(md.split('\n').filter((l) => /^#/.test(l)), ['# Tareas — T', '## M0 — Hito roto  (0/1)', '### 0.1 Dos renglones · Pendiente']);
  assert.match(md, /^- \[ \] paso partido$/m);
  assert.match(md, /^\\## Falso$/m);
  assert.match(md, /^ {2}\\# otro$/m);
});

test('referencias: con sección "ruta#id"; al documento entero, solo la ruta (12.1)', () => {
  const md = renderMarkdown({
    milestones: [['m00', { code: 'M0', title: 'Hito', order: 0 }]],
    tasks: [['a', { milestone: 'm00', code: '0.1', title: 'Con refs', status: 'todo', refs: [{ doc: 'docs/gdd.md', section: 'combate' }, { doc: 'docs/enemigos.md' }] }]]
  }, { title: 'T', date: '2026-10-08' });
  assert.match(md, /\*\*Referencias:\*\* `docs\/gdd\.md#combate`, `docs\/enemigos\.md`/);
});
