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
const V = loadValidators();
const quiet = { out: { write() {} }, err: { write() {} } };

async function python(src, board, title) {
  const dir = await mkdtemp(join(tmpdir(), 'scompass-py-'));
  try {
    execFileSync('python3', [join(REPO, 'tools', 'artifact_to_md.py'), src, join(dir, 'out.md'), '--board', board, '--title', title]);
    return await readFile(join(dir, 'out.md'), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const dateOf = (md) => md.match(/^> Generado: (\S+)$/m)[1];

for (const [name, dir] of [['Scope Compass', join(REPO, 'compass')], ['Project Epiphany', join(REPO, '..', 'project-epiphany', 'compass')]]) {
  test(`misma salida que tools/artifact_to_md.py: ${name}`, { skip: !existsSync(dir) && 'no está el proyecto' }, async (t) => {
    const all = await loadCompass(dir, V);
    const board = all.config.board_url ?? 'https://claude.ai/artifact/x';
    const expected = await python(dir, board, name);
    if (expected === null) return t.skip('sin python3');
    assert.equal(renderMarkdown(all, { title: name, board, date: dateOf(expected) }), expected);
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
    await cp(join(REPO, 'compass'), join(dir, 'compass'), { recursive: true });
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
    await rm(dir, { recursive: true, force: true });
  }
});
