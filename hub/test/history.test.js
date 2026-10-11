// Historial de una tarea desde git (18.5): un repo real con unos commits que la cambian.
import './isolate.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../src/cli.js';
import { taskChanges, taskHistory } from '../src/history.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'compass');

test('taskChanges: un renglón por campo, con los pasos y las listas por elemento', () => {
  const a = { title: 'Uno', status: 'todo', notes: '', checklist: [{ text: 'a', done: false }, { text: 'b', done: false }], tags: ['arte'], order: 1, updated_at: 'x' };
  const b = { title: 'Dos', status: 'doing', notes: 'algo', priority: 'high', checklist: [{ text: 'a', done: true }, { text: 'c', done: false }], tags: ['audio'], order: 2, updated_at: 'y' };
  assert.deepEqual(taskChanges(a, b), [
    'Título: «Uno» → «Dos»', 'Estado: Pendiente → En curso', 'Notas: agregadas',
    'Pasos: +«c», −«b», tildado «a»', 'Etiquetas: +audio −arte', 'Prioridad: — → alta'
  ]);
  assert.deepEqual(taskChanges({ description: 'x' }, {}), ['Descripción: quitada']);
});

test('taskHistory y scompass history: commits del más nuevo al más viejo, lo sin commitear arriba; sin repo, nada', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'scompass-hist-'));
  const git = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=Ana', '-c', 'user.email=a@a', ...a], { stdio: 'ignore' });
  let out = '';
  const cli = (...argv) => run(['--direct', ...argv], { cwd: dir, out: { write: (s) => { out += s; } }, err: { write() {} } });
  try {
    await cp(FIXTURE, join(dir, 'compass'), { recursive: true });
    assert.deepEqual(await taskHistory(dir, 'm1-07'), { repo: false, entries: [] });
    git('init', '-q');
    git('add', '.');
    git('commit', '-qm', 'Inicial');
    assert.equal(await cli('move', 'm1-07', 'doing'), 0);
    git('commit', '-qam', 'Empiezo 1.7');
    assert.equal(await cli('set', 'm1-07', '--size', 'm', '--notes', 'otra'), 0);
    const h = await taskHistory(dir, 'm1-07');
    assert.equal(h.repo, true);
    assert.deepEqual(h.entries.map((e) => [e.hash === null ? 'disco' : e.subject, e.created ?? false, e.changes]), [
      ['disco', false, ['Notas: editadas', 'Tamaño: — → M']],
      ['Empiezo 1.7', false, ['Estado: Hecho → En curso']],
      ['Inicial', true, []]
    ]);
    assert.equal(h.entries[1].author, 'Ana');
    out = '';
    assert.equal(await cli('history', 'm1-07'), 0);
    assert.match(out, /^sin commitear.*\n {4}Notas: editadas\n {4}Tamaño: — → M\n[0-9a-f]{7} .* Ana {2}Empiezo 1\.7\n {4}Estado: Hecho → En curso\n[0-9a-f]{7} .*Inicial\n {4}Creada\n$/);
    assert.equal(await cli('history', 'nada'), 1);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});

test('19.3: con el proyecto en una subcarpeta del repo, el historial ve los cambios; la CLI da la hora local', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'scompass-hist-'));
  const dir = join(repo, 'juegos', 'uno');
  const git = (...a) => execFileSync('git', ['-C', repo, '-c', 'user.name=Ana', '-c', 'user.email=a@a', ...a], { stdio: 'ignore' });
  let out = '';
  const cli = (...argv) => run(['--direct', ...argv], { cwd: dir, out: { write: (s) => { out += s; } }, err: { write() {} } });
  try {
    await cp(FIXTURE, join(dir, 'compass'), { recursive: true });
    git('init', '-q');
    git('add', '.');
    git('commit', '-qm', 'Inicial', '--date', '2026-03-01T12:00:00Z');
    assert.equal(await cli('move', 'm1-07', 'doing'), 0);
    git('commit', '-qam', 'Empiezo 1.7');
    const h = await taskHistory(dir, 'm1-07');
    assert.deepEqual(h.entries.map((e) => [e.subject, e.changes]), [['Empiezo 1.7', ['Estado: Hecho → En curso']], ['Inicial', []]]);
    out = '';
    await cli('history', 'm1-07');
    const d = new Date('2026-03-01T12:00:00Z'), p = (n) => String(n).padStart(2, '0');
    assert.ok(out.includes(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`), out);
  } finally {
    await rm(repo, { recursive: true, force: true, maxRetries: 10 });
  }
});
