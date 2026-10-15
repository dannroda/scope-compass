// Vista Playtest (D39, D40) y columna Pausado: crear una sesión con las tareas en Revisión, buscar y agregar, reordenar,
// marcar anda/falla con nota (en la tarea: igual en todas las sesiones), pasar la tarea a Hecho desde ahí, y la columna
// Pausado al lado de Pendiente.
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
  await until(async () => (await task('m1-04')).playtest?.result === 'fail');
  // Vive en la tarea (D40): la sesión solo ordena.
  assert.deepEqual((await session('revision')).items[1], { task: 'm1-04' });
  // La nota admite varios renglones (Enter es salto de línea) y se guarda al salir del campo.
  await page.click('#pt-note-m1-04');
  await page.keyboard.type('se traba al saltar');
  await page.keyboard.press('Enter');
  await page.keyboard.type('en la cueva');
  const h1 = await page.locator('#pt-note-m1-04').evaluate((e) => e.offsetHeight);
  await page.locator('#pt-note-m1-04').blur();
  await until(async () => (await task('m1-04')).playtest?.note === 'se traba al saltar\nen la cueva');
  assert.ok(h1 > 40, `el campo creció con el segundo renglón (${h1} px)`);
  await page.waitForSelector('.pt-item[data-task="m1-04"] button:has-text("Volver a En curso")');
  await page.click('.pt-item[data-task="m1-05"] .pt-result button.pass');
  await page.click('.pt-item[data-task="m1-05"] button:has-text("Pasar a Hecho")');
  await until(async () => (await task('m1-05')).status === 'done');
  await page.waitForSelector('#playtest .list-link:has-text("Revisión") .n:text-is("1")');
  if (process.env.SCOMPASS_SHOTS) await page.screenshot({ path: join(process.env.SCOMPASS_SHOTS, 'playtest.png'), fullPage: true });

  // Volver a marcar el mismo resultado lo quita.
  await page.click('.pt-item[data-task="m1-05"] .pt-result button.pass');
  await until(async () => !(await task('m1-05')).playtest);
});

test('abrir una tarea desde Playtest (o Listas) la abre encima, sin pasar al tablero; Cerrar y atrás vuelven ahí', async () => {
  await store.put('playtests', 'build', { title: 'Build', order: 1, items: [{ task: 'm1-04' }, { task: 'm1-05' }] }, { ifMatch: null });
  await store.patch('tasks', 'm1-05', { code: '11.145', title: 'Un título bien largo que no entra en un renglón cuando la sesión queda angosta al lado del panel' });
  const page = await open('#playtest/build');
  // Vista dividida: sin tarea abierta, el panel derecho invita a abrir la primera sin probar.
  await page.waitForSelector('#pt-empty:not([hidden])');
  await page.click('#pt-empty button:has-text("Abrir la primera sin probar")');
  await page.waitForFunction(() => document.getElementById('detail').dataset.task === 'm1-04' && !document.getElementById('detail').hidden);
  assert.equal(await page.isHidden('#pt-empty'), true);
  // Siguiente recorre la sesión; un clic en la sesión no cierra el panel.
  await page.click('#detail .pt-detail button:has-text("Siguiente")');
  await page.waitForFunction(() => document.getElementById('detail').dataset.task === 'm1-05');
  await page.click('.pt-panel h2');
  await page.waitForTimeout(150);
  assert.equal(await page.isVisible('#detail'), true, 'el panel sigue abierto');
  await page.click('#detail .pt-detail button[aria-label="Anterior de la sesión"]');
  await page.waitForFunction(() => document.getElementById('detail').dataset.task === 'm1-04');
  await page.click('.pt-item[data-task="m1-04"] .pt-task');
  await page.waitForFunction(() => document.getElementById('detail').dataset.task === 'm1-04' && !document.getElementById('detail').hidden);
  assert.equal(new URL(page.url()).hash, '#task/m1-04');
  assert.equal(await page.isVisible('#playtest .pt-panel'), true, 'la sesión sigue a la vista');
  assert.equal(await page.isVisible('#board'), false);
  // La sesión se achica al lado del panel: Anda/Falla y la nota de la fila no quedan tapados, y la fila abierta se marca.
  const detailLeft = await page.locator('#detail').evaluate((e) => e.getBoundingClientRect().left);
  for (const sel of ['.pt-item[data-task="m1-04"] .pt-result button.fail', '#pt-note-m1-04']) {
    const r = await page.locator(sel).evaluate((e) => e.getBoundingClientRect().right);
    assert.ok(r <= detailLeft, `${sel} visible (${r} <= ${detailLeft})`);
  }
  assert.equal(await page.getAttribute('.pt-item[data-task="m1-04"]', 'aria-current'), 'true');
  // En el detalle, el resultado y la nota de la sesión.
  await page.click('#detail .pt-detail button.fail');
  await until(async () => (await task('m1-04')).playtest?.result === 'fail');
  await page.fill('#d-ptnote', 'no abre la puerta');
  await page.press('#d-ptnote', 'Control+Enter');
  await until(async () => (await task('m1-04')).playtest?.note === 'no abre la puerta');
  await page.waitForFunction(() => document.getElementById('pt-note-m1-04').value === 'no abre la puerta');
  await page.waitForSelector('#detail .pt-detail button:has-text("Volver a En curso")');
  if (process.env.SCOMPASS_SHOTS) await page.screenshot({ path: join(process.env.SCOMPASS_SHOTS, 'playtest-detail.png') });

  // Con el panel muy ancho, en Playtest se limita: la sesión no se aplasta y los botones de la fila no quedan debajo.
  await page.evaluate(() => document.documentElement.style.setProperty('--detail-w', '1000px'));
  const w = await page.locator('#playtest .pt-panel').evaluate((e) => e.getBoundingClientRect().width);
  assert.ok(w >= 500, `ancho de la sesión: ${w}`);
  const left = await page.locator('#detail').evaluate((e) => e.getBoundingClientRect().left);
  // Angosta, se parte el título, no el código (antes salía un dígito por renglón).
  assert.ok(await page.locator('.pt-item[data-task="m1-05"] .pt-task .code').evaluate((e) => e.getBoundingClientRect().height) < 24, 'el código en un renglón');
  assert.ok(await page.locator('.pt-item[data-task="m1-05"] .pt-result button.fail').evaluate((e) => e.getBoundingClientRect().right) <= left, 'Falla de la fila a la vista');
  assert.ok(await page.locator('.pt-item[data-task="m1-04"] .pt-task').evaluate((e) => e.getBoundingClientRect().height) < 40, 'el título en un renglón');
  if (process.env.SCOMPASS_SHOTS) await page.screenshot({ path: join(process.env.SCOMPASS_SHOTS, 'playtest-wide.png') });
  await page.evaluate(() => document.documentElement.style.removeProperty('--detail-w'));
  // Otra tarea de la sesión reemplaza la abierta; Cerrar vuelve a la sesión.
  await page.click('.pt-item[data-task="m1-05"] .pt-task');
  await page.waitForFunction(() => document.getElementById('detail').dataset.task === 'm1-05');
  await page.click('#detail .close');
  await page.waitForFunction(() => document.getElementById('detail').hidden && location.hash === '#playtest/build');
  assert.equal(await page.isVisible('#playtest .pt-panel'), true);
  await page.waitForSelector('#pt-empty:not([hidden])');
  // Atrás también.
  await page.click('.pt-item[data-task="m1-04"] .pt-task');
  await page.waitForFunction(() => location.hash === '#task/m1-04');
  await page.goBack();
  await page.waitForFunction(() => document.getElementById('detail').hidden && location.hash === '#playtest/build');
});

test('una tarea en dos sesiones muestra lo mismo en las dos; Reiniciar la vuelve a «sin probar» en ambas', async () => {
  await store.put('playtests', 'a', { title: 'A', order: 1, items: [{ task: 'm1-04' }, { task: 'm1-05' }] }, { ifMatch: null });
  await store.put('playtests', 'b', { title: 'B', order: 2, items: [{ task: 'm1-04' }] }, { ifMatch: null });
  const page = await open('#playtest/a');
  await page.click('.pt-item[data-task="m1-04"] .pt-result button.fail');
  await page.fill('#pt-note-m1-04', 'no salta');
  await page.locator('#pt-note-m1-04').blur();
  await until(async () => (await task('m1-04')).playtest?.note === 'no salta');
  await page.click('.list-link:has-text("B")');
  await page.waitForSelector('.pt-panel h2:text-is("B")');
  await page.waitForSelector('.pt-item.fail[data-task="m1-04"] .pt-result button.fail[aria-pressed="true"]');
  assert.equal(await page.inputValue('#pt-note-m1-04'), 'no salta');
  await page.waitForSelector('.pt-panel .muted:has-text("1 de 1 probadas · 1 falla")');
  page.on('dialog', (d) => d.accept());
  await page.click('.pt-panel button:has-text("Reiniciar")');
  await until(async () => (await task('m1-04')).playtest?.result === undefined);
  assert.deepEqual((await task('m1-04')).playtest, { note: 'no salta' }, 'la nota queda');
  await page.click('.list-link:has-text("A")');
  await page.waitForSelector('.pt-item[data-task="m1-04"]:not(.fail) .pt-result button.fail[aria-pressed="false"]');
});

test('una sesión creada por la CLI (otro proceso) aparece sola, y su tarea borrada se avisa', async () => {
  const page = await open('#playtest');
  await createJsonFilesStore(compass, { validators: V }).put('playtests', 'build-0-3', { title: 'Build 0.3', order: 1, items: [{ task: 'm1-04' }, { task: 'zz-99' }] }, { ifMatch: null });
  await page.waitForSelector('.list-link:has-text("Build 0.3")');
  await page.waitForSelector('.pt-item[data-task="zz-99"] .text:has-text("ya no existe")');
});
