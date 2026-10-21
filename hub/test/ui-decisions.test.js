// Decisiones en la web (§31, D42): la marca en la tarjeta, la sección del detalle con OK, Revertir (con qué hacer),
// Responder una pregunta abierta, Deshacer y Promover a D-n.
import './isolate.js';
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
  dir = await mkdtemp(join(tmpdir(), 'scompass-ui-decisions-'));
  compass = join(dir, 'compass');
  await cp(FIXTURE, compass, { recursive: true });
  await mkdir(join(dir, 'docs'));
  await writeFile(join(dir, 'docs', 'decisiones.md'), '# Decisiones\n\n## D1 · Algo\n');
  store = createJsonFilesStore(compass, { validators: V });
  await store.patch('tasks', 'm1-04', { decisions: [
    { text: 'Usar X', why: 'porque sí', alternatives: 'Y' },
    { text: '¿A o B?', asked: true },
    { text: 'Z' }] });
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

async function open(hash = '', selector = '.card') {
  const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(url + hash);
  await page.waitForSelector(selector);
  return page;
}
const task = async (id) => JSON.parse(await readFile(join(compass, 'tasks', `${id}.json`), 'utf8'));
const until = async (fn) => { for (let i = 0; i < 100; i++) { if (await fn()) return; await new Promise((r) => setTimeout(r, 30)); } assert.fail('no pasó a tiempo'); };
const item = (text) => `.decision:has(.dtext:text-is("${text}"))`;

test('la tarjeta marca lo que espera; el detalle revisa, responde, deshace y promueve', async () => {
  const page = await open('', '.card[data-id="m1-04"] .decmark');
  assert.equal(await page.textContent('.card[data-id="m1-04"] .decmark'), '? 3');
  assert.match(await page.getAttribute('.card[data-id="m1-04"] .decmark', 'title'), /1 pregunta abierta, 2 sin revisar/);
  await page.click('.card[data-id="m1-04"]');
  await page.waitForSelector('.decisions');
  assert.match(await page.textContent('#detail .label:has-text("Decisiones")'), /1 abiertas, 2 sin revisar/);
  assert.match(await page.textContent(item('Usar X')), /Sin revisar.*sin consultar/);

  await page.click(`${item('Usar X')} button:has-text("OK")`);
  await until(async () => (await task('m1-04')).decisions[0].review === 'ok');

  // Revertir pide qué hacer en su lugar.
  await page.click(`${item('Z')} button:has-text("Revertir")`);
  await page.fill('#d-dreply', 'hacer W');
  await page.click(`${item('Z')} button[type="submit"]`);
  await until(async () => (await task('m1-04')).decisions[2].review === 'revert');
  assert.equal((await task('m1-04')).decisions[2].reply, 'hacer W');
  await page.waitForSelector(`${item('Z')}.revert`);
  await page.click(`${item('Z')} button:has-text("Deshacer")`);
  await until(async () => !(await task('m1-04')).decisions[2].review);
  assert.equal((await task('m1-04')).decisions[2].reply, undefined);

  // La pregunta se responde.
  await page.click(`${item('¿A o B?')} button:has-text("Responder")`);
  await page.fill('#d-dreply', 'A');
  await page.click(`${item('¿A o B?')} button[type="submit"]`);
  await until(async () => (await task('m1-04')).decisions[1].reply === 'A');
  await page.waitForSelector(`${item('¿A o B?')}.resolved`);

  // Promover la revisada: D2 en el documento y en la tarea.
  await page.click(`${item('Usar X')} button:has-text("Promover")`);
  await until(async () => (await task('m1-04')).decisions[0].promoted === 'D2');
  assert.match(await readFile(join(dir, 'docs', 'decisiones.md'), 'utf8'), /## D2 · Usar X\n.*\n\n- \*\*Por qué:\*\* porque sí\n- \*\*Descartado:\*\* Y\n$/);
  await page.waitForSelector(`${item('Usar X')} .dmeta:has-text("D2")`);
  assert.equal(await page.$(`${item('Usar X')} button:has-text("Promover")`), null);
  assert.equal(await page.textContent('.card[data-id="m1-04"] .decmark'), '! 1');
});

test('vista Decisiones: la pestaña cuenta las que esperan; filtros, acciones y abrir la tarea', async () => {
  await store.patch('tasks', 'm1-05', { decisions: [{ text: 'Otra', review: 'ok' }] });
  const page = await open('#decisions', '#decisions .decision');
  assert.equal(await page.getAttribute('#tab-decisions', 'data-count'), '3');
  assert.equal(await page.getAttribute('#tab-decisions', 'aria-current'), 'page');
  // Por defecto, las que esperan: no la revisada.
  assert.deepEqual(await page.$$eval('#decisions .dtext', (els) => els.map((e) => e.textContent).sort()), ['Usar X', 'Z', '¿A o B?']);
  await page.click('#decisions .chip:has-text("Todas")');
  await page.waitForSelector('#decisions .dtext:text-is("Otra")');
  await page.click('#decisions .chip:has-text("Preguntas abiertas")');
  assert.deepEqual(await page.$$eval('#decisions .dtext', (els) => els.map((e) => e.textContent)), ['¿A o B?']);
  // Responder desde la vista: sale del filtro y la pestaña cuenta una menos.
  await page.click(`#decisions ${item('¿A o B?')} button:has-text("Responder")`);
  await page.fill('#d-dreply', 'B');
  await page.click(`#decisions ${item('¿A o B?')} button[type="submit"]`);
  await until(async () => (await task('m1-04')).decisions[1].reply === 'B');
  await page.waitForSelector('#decisions p.muted:has-text("Ninguna decisión")');
  assert.equal(await page.getAttribute('#tab-decisions', 'data-count'), '2');
  // El filtro se recuerda; el hito filtra; un clic en la tarea la abre encima de la vista.
  await page.click('#decisions .chip:has-text("Esperan")');
  await page.selectOption('#dec-ms', 'm01');
  await page.click(`#decisions ${item('Usar X')} .dtask`);
  await page.waitForSelector('#detail .decisions');
  assert.equal(await page.evaluate(() => location.hash), '#task/m1-04');
  assert.equal(await page.isVisible('#decisions'), true);
});

test('una tarea sin decisiones no muestra la sección (ni un "null" suelto)', async () => {
  const page = await open('#task/m1-01', '#detail:not([hidden])');
  assert.equal(await page.$$eval('#detail .decisions', (els) => els.length), 0);
  assert.equal(await page.$eval('#detail', (d) => [...d.childNodes].some((n) => n.nodeType === 3 && n.textContent === 'null')), false);
});

