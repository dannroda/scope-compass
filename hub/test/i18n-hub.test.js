// El hub y el MCP en inglés (§45): errores de la API por pedido, etiquetas que se arman al usarlas y las
// descripciones de las herramientas del MCP.
import './isolate.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { setLang, withLang } from '../src/i18n.js';
import { createServer } from '../src/server.js';
import { createJsonFilesStore } from '../src/store/json-files.js';
import { loadValidators } from '../src/schema.js';
import { PRIORITY_LABEL } from '../src/filters.js';
import { repeatLabel } from '../src/dates.js';
import { renderMarkdown } from '../src/export-md.js';
import { serveMcp } from '../src/mcp.js';

// Sin SCOMPASS_LANG (run-tests.js lo fija en es), así manda el Accept-Language.
async function unforced(fn) {
  const saved = process.env.SCOMPASS_LANG;
  delete process.env.SCOMPASS_LANG;
  try { return await fn(); } finally { process.env.SCOMPASS_LANG = saved; }
}

test('un error de la API sale en el idioma del pedido', async () => {
  await unforced(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scompass-i18n-hub-'));
    try {
      mkdirSync(join(dir, 'compass'));
      writeFileSync(join(dir, 'compass', 'config.json'), JSON.stringify({ project: 'P' }));
      const validators = loadValidators();
      const app = createServer({ projectDir: dir, store: createJsonFilesStore(join(dir, 'compass'), { validators }), validators });
      const get = (lang) => app.inject({ url: '/api/tasks/nada', headers: { 'accept-language': lang } }).then((r) => r.json().error.message);
      assert.equal(await get('en-US'), 'tasks/nada doesn\'t exist');
      assert.equal(await get('es-AR'), 'no existe tasks/nada');
      const body = await app.inject({ method: 'POST', url: '/api/tasks', headers: { 'accept-language': 'en' }, payload: [] });
      assert.equal(body.json().error.message, 'the body must be a JSON object');
      await app.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

test('las etiquetas se arman en el idioma de quien las pide, no al cargar el módulo', () => {
  assert.equal(withLang('en', () => PRIORITY_LABEL.high), 'high');
  assert.equal(withLang('es', () => PRIORITY_LABEL.high), 'alta');
  assert.equal(withLang('en', () => repeatLabel({ every: 'week', interval: 2 })), 'every 2 weeks');
  assert.equal(withLang('es', () => repeatLabel({ every: 'month' })), 'cada mes');
  const md = withLang('en', () => renderMarkdown({ milestones: [['m0', { code: 'M0', title: 'Uno', order: 0 }]], tasks: [['m0-01', { milestone: 'm0', title: 'A', status: 'doing', priority: 'low' }]] }, { title: 'P', date: '2026-01-01' }));
  assert.match(md, /^# Tasks — P/);
  assert.match(md, /### A · In progress/);
  assert.match(md, /\*\*Priority:\*\* low/);
});

test('el MCP describe sus herramientas en el idioma del proceso', async () => {
  const describe = async (lang) => {
    setLang(lang);
    try {
      const stdin = new PassThrough();
      let out = '';
      const done = serveMcp({ project: tmpdir(), stdin, out: { write: (s) => { out += s; } }, err: { write: () => {} } });
      stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');
      stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
      stdin.end();
      await done;
      const [init, list] = out.trim().split('\n').map((l) => JSON.parse(l));
      return { instructions: init.result.instructions, move: list.result.tools.find((t) => t.name === 'move_task') };
    } finally { setLang(null); }
  };
  const en = await describe('en');
  assert.equal(en.move.description, 'Changes a task\'s status.');
  assert.equal(en.move.inputSchema.properties.status.description, 'new status');
  assert.match(en.instructions, /^The project's task board/);
  const es = await describe('es');
  assert.equal(es.move.description, 'Cambia el estado de una tarea.');
});
