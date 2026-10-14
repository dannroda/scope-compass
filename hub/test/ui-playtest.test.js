// Vista Playtest (D39) y columna Pausado: crear una sesión con las tareas en Revisión, buscar y agregar, reordenar,
// marcar anda/falla con nota, pasar la tarea a Hecho desde ahí, y la columna Pausado al lado de Pendiente.
import './isolate.js';
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { loadValidators } from '../src/schema.js';
import { createJsonFilesStore } from '../src/store/json-files.js';
import { createServer, listen } from '../src/server.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'compass');
const V = loadValidators();
let browser, dir, compass, store, app, url, pageErrors;

before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'scompass-ui-playtest-'));
  compass = join(dir, 'compass');
  await cp(FIXTURE, compass, { recursive: true });
  store = createJsonFilesStore(compass, { validators: V });
  for (const id of ['m1-04', 'm1-05']) await store.patch('tasks', id, { status: 'review' });
  await store.patch('tasks', 'm1-06', { status: 'paused' });
  app = createServer({ projectDir: dir, store, validators: V, watch: true, exportMd: true });
  const { port } = await listen(app, 0);
  url = `http://127.0.0.1:${port}/`;
  pageErrors = [];
});
afterEach(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true, maxRetries: 10 });
  assert.deepEqual(pageErrors, [], 'errores en la página');
});

async function open(hash = '', selector = '#playtest .lists-grid') {
  const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(url + hash);
  await page.waitForSelector(selector);
  return page;
}
const session = async (id) => JSON.parse(await readFile(join(compass, 'playtests', `${id}.json`), 'utf8'));
const task = async (id) => JSON.parse(await readFile(join(compass, 'tasks', `${id}.json`), 'utf8'));
const until = async (fn) => { for (let i = 0; i < 100; i++) { if (await fn()) return; await new Promise((r) => setTimeout(r, 30)); } assert.fail('no pasó a tiempo'); };

test('la columna Pausado va al lado de Pendiente', async () => {
  const page = await open('', '.card');
  const cols = await page.$$eval('main.board .col', (cs) => cs.map((c) => c.getAttribute('aria-label')));
  assert.deepEqual(cols, ['Pendiente', 'Pausado', 'En curso', 'Revisión', 'Hecho']);
  await page.waitForSelector('.col[aria-label="Pausado"] .card[data-id="m1-06"]');
});

test('sin sesiones, crea una con las de Revisión; agregar, reordenar, anda/falla con nota', async () => {
  const page = await open('#playtest');
  await page.click('button:has-text("Crear una con las 2 en Revisión")');
  await page.waitForSelector('.pt-panel h2:has-text("Revisión")');
  assert.deepEqual((await session('revision')).items, [{ task: 'm1-04' }, { task: 'm1-05' }]);
  assert.equal(await page.evaluate(() => location.hash), '#playtest/revision');

  // Buscar y agregar una que no está en Revisión.
  await page.fill('#pt-q', 'tests m1');
  await page.click('.ref-matches button:has-text("Tests de M1")');
  await until(async () => (await session('revision')).items.length === 3);
  assert.equal((await session('revision')).items[2].task, 'm1-07');

  // Subirla al primer lugar.
  await page.click('.pt-item[data-task="m1-07"] button[aria-label="Subir"]');
  await until(async () => (await session('revision')).items[1].task === 'm1-07');
  await page.click('.pt-item[data-task="m1-07"] button[aria-label="Subir"]');
  await until(async () => (await session('revision')).items[0].task === 'm1-07');

  // Falla con nota; anda y la pasa a Hecho desde la sesión.
  await page.click('.pt-item[data-task="m1-04"] .pt-result button.fail');
  await until(async () => (await session('revision')).items[1].result === 'fail');
  await page.fill('#pt-note-m1-04', 'se traba al saltar');
  await page.press('#pt-note-m1-04', 'Enter');
  await until(async () => (await session('revision')).items[1].note === 'se traba al saltar');
  await page.waitForSelector('.pt-item[data-task="m1-04"] button:has-text("Volver a En curso")');
  await page.click('.pt-item[data-task="m1-05"] .pt-result button.pass');
  await page.click('.pt-item[data-task="m1-05"] button:has-text("Pasar a Hecho")');
  await until(async () => (await task('m1-05')).status === 'done');
  await page.waitForSelector('#playtest .list-link:has-text("Revisión") .n:text-is("1")');
  if (process.env.SCOMPASS_SHOTS) await page.screenshot({ path: join(process.env.SCOMPASS_SHOTS, 'playtest.png'), fullPage: true });

  // Volver a marcar el mismo resultado lo quita.
  await page.click('.pt-item[data-task="m1-05"] .pt-result button.pass');
  await until(async () => !(await session('revision')).items[2].result);
});

test('abrir una tarea desde Playtest (o Listas) la abre encima, sin pasar al tablero; Cerrar y atrás vuelven ahí', async () => {
  await store.put('playtests', 'build', { title: 'Build', order: 1, items: [{ task: 'm1-04' }, { task: 'm1-05' }] }, { ifMatch: null });
  const page = await open('#playtest/build');
  await page.click('.pt-item[data-task="m1-04"] .pt-task');
  await page.waitForFunction(() => document.getElementById('detail').dataset.task === 'm1-04' && !document.getElementById('detail').hidden);
  assert.equal(new URL(page.url()).hash, '#task/m1-04');
  assert.equal(await page.isVisible('#playtest .pt-panel'), true, 'la sesión sigue a la vista');
  assert.equal(await page.isVisible('#board'), false);
  // Otra tarea de la sesión reemplaza la abierta; Cerrar vuelve a la sesión.
  await page.click('.pt-item[data-task="m1-05"] .pt-task');
  await page.waitForFunction(() => document.getElementById('detail').dataset.task === 'm1-05');
  await page.click('#detail .close');
  await page.waitForFunction(() => document.getElementById('detail').hidden && location.hash === '#playtest/build');
  assert.equal(await page.isVisible('#playtest .pt-panel'), true);
  // Atrás también.
  await page.click('.pt-item[data-task="m1-04"] .pt-task');
  await page.waitForFunction(() => location.hash === '#task/m1-04');
  await page.goBack();
  await page.waitForFunction(() => document.getElementById('detail').hidden && location.hash === '#playtest/build');
});

test('una sesión creada por la CLI (otro proceso) aparece sola, y su tarea borrada se avisa', async () => {
  const page = await open('#playtest');
  await createJsonFilesStore(compass, { validators: V }).put('playtests', 'build-0-3', { title: 'Build 0.3', order: 1, items: [{ task: 'm1-04' }, { task: 'zz-99' }] }, { ifMatch: null });
  await page.waitForSelector('.list-link:has-text("Build 0.3")');
  await page.waitForSelector('.pt-item[data-task="zz-99"] .text:has-text("ya no existe")');
});
