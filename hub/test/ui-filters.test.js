// Tests de navegador de M11 (spec §19, D32): filtros del tablero, vista de lista y prioridad/responsable/etiquetas.
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { loadValidators } from '../src/schema.js';
import { canonical } from '../src/store/canonical.js';
import { createJsonFilesStore } from '../src/store/json-files.js';
import { createServer, listen } from '../src/server.js';
import { run } from '../src/cli.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'compass');
const V = loadValidators();
let browser, dir, compass, app, url, pageErrors;

before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'scompass-ui-filters-'));
  compass = join(dir, 'compass');
  await cp(FIXTURE, compass, { recursive: true });
  const cli = (argv) => run(argv, { cwd: dir, out: { write() {} }, err: { write() {} } });
  // m1-03: en curso, alta, de Dani, vencida. m1-04: pendiente, media, de Claude, bloqueada por m1-03, con un paso sin tildar.
  await cli(['set', 'm1-03', '--status', 'doing', '--tags', 'store,core', '--priority', 'high', '--assignee', 'Dani', '--due', '2020-01-01']);
  await cli(['set', 'm1-04', '--status', 'todo', '--tags', 'cli', '--priority', 'medium', '--assignee', 'Claude']);
  await cli(['step', 'add', 'm1-04', 'Falta algo']);
  await cli(['link', 'add', 'm1-03', 'blocks', 'm1-04']);
  app = createServer({ projectDir: dir, store: createJsonFilesStore(compass, { validators: V }), validators: V, watch: true });
  const { port } = await listen(app, 0);
  url = `http://127.0.0.1:${port}/`;
  const cfgPath = join(compass, 'config.json');
  await writeFile(cfgPath, canonical({ ...JSON.parse(await readFile(cfgPath, 'utf8')), port }));
  pageErrors = [];
});
afterEach(async () => {
  await app?.close();
  await rm(dir, { recursive: true, force: true, maxRetries: 10 });
  assert.deepEqual(pageErrors, [], 'errores en la página');
});

async function open(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ...opts });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(url);
  await page.waitForSelector('.card');
  await page.click('#miles .chip:has-text("M1")');
  return page;
}
const task = async (id) => JSON.parse(await readFile(join(compass, 'tasks', `${id}.json`), 'utf8'));
const cards = (page) => page.locator('#board .card').evaluateAll((els) => els.map((e) => e.dataset.id).sort());
const rows = (page) => page.locator('#tasklist tbody tr').evaluateAll((els) => els.map((e) => e.dataset.id));

test('filtros del tablero: texto, etiquetas, prioridad, fecha, bloqueo y pasos; contador y limpiar', async () => {
  const page = await open();
  assert.equal((await cards(page)).length, 7);
  await page.fill('#f-q', 'json');
  assert.deepEqual(await cards(page), ['m1-03']);
  await expectText(page, '.f-count', '1 de 7 · 6 ocultas');
  await expectText(page, '#summary .hidden-n', '· 6 ocultas por los filtros');
  await page.fill('#f-q', '');
  await page.click('details[data-key="tags"] summary');
  await page.check('#f-tags-cli');
  assert.deepEqual(await cards(page), ['m1-04']);
  await page.check('#f-tags-store');
  assert.deepEqual(await cards(page), ['m1-03', 'm1-04'], 'varias etiquetas: alguna de ellas');
  await page.click('h1'); // un clic afuera cierra el desplegable
  assert.equal(await page.locator('details[data-key="tags"][open]').count(), 0);
  await page.click('#f-clear');
  await page.click('details[data-key="priority"] summary');
  await page.check('#f-priority-none');
  assert.equal((await cards(page)).length, 5, 'sin prioridad');
  await page.click('#f-clear');
  await pick(page, 'due', 'overdue');
  assert.deepEqual(await cards(page), ['m1-03']);
  assert.equal(await page.textContent('#f-due'), 'Vencidas', 'el resumen dice qué se eligió');
  await pick(page, 'due', 'any');
  await pick(page, 'blocked', 'yes');
  assert.deepEqual(await cards(page), ['m1-04']);
  await pick(page, 'blocked', 'any');
  await page.click('#f-pendingSteps');
  assert.deepEqual(await cards(page), ['m1-04']);
  await page.click('#f-clear');
  assert.equal((await cards(page)).length, 7);
  assert.equal(await page.locator('#f-clear').count(), 0);
  await page.context().close();
});

test('el filtro y la vista se recuerdan al recargar; un cambio del hub no saca el foco del buscador', async () => {
  const page = await open();
  await page.click('details[data-key="assignee"] summary');
  await page.check('#f-assignee-Claude');
  await page.click('#mode-list');
  await page.reload();
  await page.waitForSelector('#tasklist tbody tr');
  assert.deepEqual(await rows(page), ['m1-04']);
  assert.equal(await page.locator('#mode-list').getAttribute('aria-pressed'), 'true');
  assert.ok(await page.locator('#board').isHidden());
  await page.click('#f-clear');
  await page.focus('#f-q');
  await page.keyboard.type('val');
  await run(['set', 'm1-02', '--title', 'Validación de todo'], { cwd: dir, out: { write() {} }, err: { write() {} } });
  await page.waitForSelector('#tasklist tr[data-id="m1-02"]:has-text("Validación de todo")');
  await page.keyboard.type('ida');
  assert.equal(await page.inputValue('#f-q'), 'valida');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'f-q');
  await page.context().close();
});

test('vista de lista: columnas, orden por encabezado (asc, desc, tablero) y clic abre el detalle', async () => {
  const page = await open();
  await page.click('#mode-list');
  const heads = await page.locator('#tasklist th').allTextContents();
  assert.deepEqual(heads, ['Código', 'Título', 'Hito', 'Estado', 'Pasos', 'Fecha límite', 'Bloqueo', 'Prioridad', 'Responsable', 'Etiquetas']);
  const board = await rows(page);
  assert.deepEqual(board, ['m1-01', 'm1-02', 'm1-03', 'm1-04', 'm1-05', 'm1-06', 'm1-07']);
  await page.click('button[data-sort="priority"]');
  assert.deepEqual((await rows(page)).slice(0, 2), ['m1-03', 'm1-04'], 'alta, media; las sin prioridad al final');
  assert.equal(await page.locator('th[aria-sort="ascending"]').count(), 1);
  await page.click('button[data-sort="priority"]');
  assert.deepEqual((await rows(page)).slice(0, 2), ['m1-04', 'm1-03'], 'descendente: las vacías siguen al final');
  await page.click('button[data-sort="priority"]');
  assert.deepEqual(await rows(page), board, 'el tercer clic vuelve al orden del tablero');
  await page.click('#tasklist tr[data-id="m1-04"] td:nth-child(4)');
  await page.waitForSelector('#detail:not([hidden])');
  assert.equal(await page.inputValue('#d-title'), 'CLI básica');
  assert.equal(await page.locator('#tasklist tr[data-id="m1-04"]').getAttribute('aria-current'), 'true');
  const row = await page.locator('#tasklist tr[data-id="m1-03"]').innerText();
  for (const s of ['1.3', 'En curso', 'Vencida', 'Alta', 'Dani', 'store', 'core']) assert.ok(row.includes(s), `${s} en «${row}»`);
  assert.match(await page.locator('#tasklist tr[data-id="m1-04"]').innerText(), /Bloqueada/);
  await page.context().close();
});

test('en el teléfono la lista deja código, título, estado y fecha, sin scroll horizontal de la página', async () => {
  const page = await open({ viewport: { width: 390, height: 844 } });
  await page.click('#mode-list');
  const visible = await page.locator('#tasklist th').evaluateAll((els) => els.filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.textContent));
  assert.deepEqual(visible, ['Código', 'Título', 'Estado', 'Fecha límite']);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.context().close();
});

test('detalle: prioridad, responsable y etiquetas se guardan en compass/ y la tarjeta los muestra', async () => {
  const page = await open();
  await page.click('.card[data-id="m1-05"]');
  await page.selectOption('#d-priority', 'high');
  await waitTask('m1-05', (t) => t.priority === 'high');
  await page.fill('#d-assignee', 'Ana');
  await page.press('#d-assignee', 'Tab');
  await waitTask('m1-05', (t) => t.assignee === 'Ana');
  await page.fill('#d-tag', 'docs, export');
  await page.press('#d-tag', 'Enter');
  await waitTask('m1-05', (t) => JSON.stringify(t.tags) === '["docs","export"]');
  await page.waitForSelector('.card[data-id="m1-05"] .prio.high');
  await page.waitForSelector('.card[data-id="m1-05"] .who:has-text("@Ana")');
  assert.deepEqual(await page.locator('.card[data-id="m1-05"] .tag').allTextContents(), ['docs', 'export']);
  // Las sugerencias salen de las etiquetas que ya existen.
  const suggested = await page.locator('#d-tags option').evaluateAll((els) => els.map((e) => e.value));
  assert.deepEqual(suggested, ['cli', 'core', 'store']);
  await page.click('button[aria-label="Quitar etiqueta docs"]');
  await waitTask('m1-05', (t) => JSON.stringify(t.tags) === '["export"]');
  await page.click('button[aria-label="Quitar etiqueta export"]');
  await page.selectOption('#d-priority', '');
  await page.fill('#d-assignee', '');
  await page.press('#d-assignee', 'Tab');
  await waitTask('m1-05', (t) => !('tags' in t) && !('priority' in t) && !('assignee' in t));
  await page.context().close();
});

test('una tarea nueva que los filtros ocultan lo avisa', async () => {
  const page = await open();
  await page.fill('#f-q', 'nada que coincida');
  await page.click('#new-btn');
  await page.fill('#new-title', 'Tarea nueva');
  await page.click('#new-form button[type="submit"]');
  await page.waitForSelector('#toast:has-text("los filtros la ocultan")');
  await page.context().close();
});

// Elige una opción de un desplegable de una sola opción (fecha, bloqueo): se cierra solo.
async function pick(page, key, value) {
  await page.click(`#f-${key}`);
  await page.check(`#f-${key}-${value}`);
  assert.equal(await page.locator(`details[data-key="${key}"][open]`).count(), 0, 'elegir cierra el desplegable');
}
async function expectText(page, sel, text) {
  await page.waitForFunction(([s, t]) => document.querySelector(s)?.textContent === t, [sel, text], { timeout: 2000 })
    .catch(async () => assert.fail(`${sel}: «${await page.locator(sel).textContent().catch(() => '(no está)')}», esperado «${text}»`));
}
async function waitTask(id, cond, ms = 3000) {
  const t0 = Date.now();
  for (;;) {
    const t = await task(id);
    if (cond(t)) return t;
    if (Date.now() - t0 > ms) assert.fail(`${id} no llegó al estado esperado: ${JSON.stringify(t)}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}
