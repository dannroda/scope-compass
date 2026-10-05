// Vista Listas del tablero (8.4): pestañas según config.views, agregar, tildar (lo que se repite avanza), editar,
// reordenar, pasar a tarea, quitar tildados y crear una lista.
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

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'compass');
const V = loadValidators();
let browser, dir, compass, app, url, pageErrors;

before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'scompass-ui-lists-'));
  compass = join(dir, 'compass');
  await cp(FIXTURE, compass, { recursive: true });
  const cfgPath = join(compass, 'config.json');
  await writeFile(cfgPath, canonical({ ...JSON.parse(await readFile(cfgPath, 'utf8')), views: ['lists', 'board'] }));
  const store = createJsonFilesStore(compass, { validators: V });
  await store.put('lists', 'pendientes', { title: 'Pendientes', order: 1, items: [
    { text: 'Yerba', done: false }, { text: 'Café', done: false }, { text: 'Pan', done: true }
  ] }, { ifMatch: null });
  app = createServer({ projectDir: dir, store, validators: V, watch: true, exportMd: true });
  const { port } = await listen(app, 0);
  url = `http://127.0.0.1:${port}/`;
  pageErrors = [];
});
afterEach(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
  assert.deepEqual(pageErrors, [], 'errores en la página');
});

async function open(hash = '') {
  const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(url + hash);
  await page.waitForSelector('.list-panel');
  return page;
}
const items = async (id = 'pendientes') => JSON.parse(await readFile(join(compass, 'lists', `${id}.json`), 'utf8')).items;
const until = async (fn) => { for (let i = 0; i < 100; i++) { if (await fn()) return; await new Promise((r) => setTimeout(r, 30)); } assert.fail('no pasó a tiempo'); };

test('config.views: abre en Listas, en ese orden, y sin Documentos', async () => {
  const page = await open();
  assert.equal(await page.evaluate(() => location.hash), '#lists');
  assert.equal(await page.isVisible('#tab-docs'), false);
  const order = await page.evaluate(() => ['tab-lists', 'tab-board'].map((id) => getComputedStyle(document.getElementById(id)).order));
  assert.deepEqual(order, ['0', '1']);
  await page.click('#tab-board');
  await page.waitForSelector('.card');
});

test('agregar con fecha y repetición; tildarlo avanza la fecha y sigue sin tildar', async () => {
  const page = await open();
  await page.fill('#item-text', 'Pagar la luz');
  await page.fill('#item-date', '2026-01-31');
  await page.selectOption('#item-repeat', 'month');
  await page.click('.item-add button[type="submit"]');
  await until(async () => (await items()).length === 4);
  assert.deepEqual((await items())[3].repeat, { every: 'month' });
  await page.waitForSelector('.list-group .label:has-text("Vencidos")');
  await page.getByLabel('Pagar la luz', { exact: true }).click();
  await until(async () => (await items())[3].due === '2026-02-28');
  assert.equal((await items())[3].done, false);
  await page.waitForFunction(() => /la próxima vez/.test(document.getElementById('toast').textContent));
});

test('tildar, editar, reordenar, quitar tildados', async () => {
  const page = await open();
  await page.getByLabel('Yerba', { exact: true }).check();
  await until(async () => (await items())[0].done);
  await page.click('button[aria-label="Editar Café"]');
  await page.fill('#ie-text', 'Café molido');
  await page.fill('#ie-date', '2026-12-01');
  await page.click('.item.editing button[type="submit"]');
  await until(async () => (await items())[1].text === 'Café molido');
  assert.equal((await items())[1].due, '2026-12-01');
  await page.click('.list-head button:has-text("Quitar tildados")');
  await until(async () => (await items()).length === 1);
  assert.deepEqual((await items()).map((x) => x.text), ['Café molido']);
});

test('reordenar arrastrando en una lista simple', async () => {
  const page = await open();
  await page.dragAndDrop('.item[data-n="3"]', '.item[data-n="1"]');
  await until(async () => (await items())[0].text === 'Pan');
  assert.deepEqual((await items()).map((x) => x.text), ['Pan', 'Yerba', 'Café']);
});

test('pasar a tarea y crear una lista nueva', async () => {
  const page = await open();
  page.on('dialog', (d) => d.accept('m01'));
  await page.locator('.item[data-n="2"] button:has-text("Pasar a tarea")').click();
  await until(async () => !!(await items())[1].task);
  const id = (await items())[1].task;
  const t = JSON.parse(await readFile(join(compass, 'tasks', `${id}.json`), 'utf8'));
  assert.deepEqual([t.title, t.milestone], ['Café', 'm01']);
  await page.waitForSelector('.item[data-n="2"] .item-task');
  await page.fill('#list-new', 'Libros para leer');
  await page.press('#list-new', 'Enter');
  await page.waitForFunction(() => location.hash === '#lists/libros-para-leer');
  await page.waitForSelector('.list-head h2:has-text("Libros para leer")');
});

test('un cambio hecho por la CLI (o a mano) se ve en vivo', async () => {
  const page = await open();
  await page.fill('#item-text', 'a medio escribir');
  const store = createJsonFilesStore(compass, { validators: V });
  const cur = await store.get('lists', 'pendientes');
  await store.patch('lists', 'pendientes', { items: [...cur.doc.items, { text: 'Fideos', done: false }] });
  await page.waitForSelector('.item label:has-text("Fideos")', { timeout: 3000 });
  // Lo que se estaba escribiendo sigue ahí, con el foco.
  assert.equal(await page.inputValue('#item-text'), 'a medio escribir');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'item-text');
});
