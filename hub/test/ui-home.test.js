// Página del Inicio en el navegador (8.10): Hoy, tarjetas, prender y apagar, importar y crear con plantilla.
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { loadValidators } from '../src/schema.js';
import { createJsonFilesStore } from '../src/store/json-files.js';
import { listen } from '../src/server.js';
import { createHomeServer } from '../src/home.js';
import { recordProject } from '../src/projects.js';
import { hubsOf } from '../src/registry.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'compass');
const V = loadValidators();
const pad = (n) => String(n).padStart(2, '0');
const d = new Date();
const TODAY = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
let browser, root, saved, home, url, vida, juego, pageErrors;

before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'scompass-ui-home-'));
  saved = { reg: process.env.SCOMPASS_REGISTRY, cfg: process.env.SCOMPASS_CONFIG };
  process.env.SCOMPASS_REGISTRY = join(root, 'registro');
  process.env.SCOMPASS_CONFIG = join(root, 'config');
  vida = join(root, 'vida');
  juego = join(root, 'juego');
  await cp(FIXTURE, join(vida, 'compass'), { recursive: true });
  await cp(FIXTURE, join(juego, 'compass'), { recursive: true });
  const store = createJsonFilesStore(join(vida, 'compass'), { validators: V });
  await store.put('lists', 'pendientes', { title: 'Pendientes', order: 1, items: [
    { text: 'Pagar la luz', done: false, due: TODAY, repeat: { every: 'month' } },
    { text: 'Comprar yerba', done: false, due: TODAY }
  ] }, { ifMatch: null });
  await recordProject(vida);
  await recordProject(juego);
  home = createHomeServer({ validators: V, pollMs: 100 });
  const { port } = await listen(home, 0);
  url = `http://127.0.0.1:${port}/`;
  pageErrors = [];
});
afterEach(async () => {
  for (const p of [vida, juego]) for (const h of hubsOf(p)) { try { process.kill(h.pid, 'SIGKILL'); } catch {} }
  await home.close();
  for (const [k, v] of [['SCOMPASS_REGISTRY', saved.reg], ['SCOMPASS_CONFIG', saved.cfg]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(root, { recursive: true, force: true });
  assert.deepEqual(pageErrors, [], 'errores en la página');
});

async function open(opts = {}) {
  const page = await (await browser.newContext({ viewport: { width: 1360, height: 900 }, ...opts })).newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('dialog', (dlg) => dlg.accept());
  await page.goto(url);
  await page.waitForSelector('.proj h3');
  return page;
}
const pendientes = async () => JSON.parse(await readFile(join(vida, 'compass', 'lists', 'pendientes.json'), 'utf8')).items;

test('Hoy: tildar un ítem lo guarda; uno que se repite avanza y sigue en la lista de su proyecto', async () => {
  const page = await open();
  await page.getByLabel('Comprar yerba').click(); // check() vuelve a buscarlo, y el ítem ya salió de Hoy
  await page.waitForFunction(() => ![...document.querySelectorAll('.hoy-row label')].some((l) => l.textContent === 'Comprar yerba'));
  assert.equal((await pendientes())[1].done, true);
  await page.getByLabel('Pagar la luz').click();
  await page.waitForFunction(() => /↻ la próxima vez es el/.test(document.getElementById('toast').textContent));
  const [luz] = await pendientes();
  assert.equal(luz.done, false);
  assert.notEqual(luz.due, TODAY);
});

test('tarjetas: prender muestra el puerto y el enlace al tablero; apagar vuelve a "leído de disco"', async () => {
  const page = await open();
  const card = page.locator('article.proj[aria-label="Scope Compass"]').first();
  assert.equal(await page.locator('article.proj').count(), 3, 'dos proyectos y la tarjeta de agregar');
  await card.getByRole('button', { name: /Prender/ }).click();
  await card.locator('.tag.live').waitFor({ timeout: 8000 });
  const href = await card.getByRole('link', { name: 'Abrir tablero' }).getAttribute('href');
  assert.match(href, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  assert.equal((await (await fetch(href + 'api/health')).json()).name, 'scope-compass');
  await card.getByRole('button', { name: /Apagar/ }).click();
  await card.getByText('hub apagado · leído de disco').waitFor({ timeout: 8000 });
});

test('agregar: importar una carpeta y crear un proyecto con plantilla', async () => {
  const otro = join(root, 'otro');
  await cp(FIXTURE, join(otro, 'compass'), { recursive: true });
  const page = await open();
  await page.click('#add-btn');
  await page.fill('#add-path', otro);
  await page.click('#add button[type="submit"]');
  await page.waitForFunction(() => document.querySelectorAll('article.proj').length === 4);
  // Una carpeta sin compass/ avisa en el formulario.
  await page.click('#add-btn');
  await page.fill('#add-path', join(root, 'nada'));
  await page.click('#add button[type="submit"]');
  await page.waitForFunction(() => document.querySelector('#add .err')?.textContent.length > 0);
  await page.click('#add .tabs button:has-text("Crear con plantilla")');
  const nueva = join(root, 'Vida2');
  await page.fill('#new-path', nueva);
  await page.fill('#new-name', 'Vida dos');
  await page.check('input[name="tpl"][value="personal"]');
  await page.click('#add button[type="submit"]');
  await page.waitForSelector('article.proj[aria-label="Vida dos"]');
  assert.ok(existsSync(join(nueva, 'compass', 'lists', 'pendientes.json')));
  assert.deepEqual(JSON.parse(await readFile(join(nueva, 'compass', 'config.json'), 'utf8')).views, ['lists', 'board']);
});

test('en el teléfono no hay scroll horizontal', async () => {
  const page = await open({ viewport: { width: 390, height: 844 } });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
});
