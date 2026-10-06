// Página del Inicio en el navegador (8.10): Hoy, tarjetas, prender y apagar, importar y crear con plantilla.
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
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
  saved.data = process.env.SCOMPASS_DATA;
  process.env.SCOMPASS_DATA = join(root, 'datos');
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
  for (const p of [vida, juego]) for (const h of hubsOf(p)) if (h.pid !== process.pid) { try { process.kill(h.pid, 'SIGKILL'); } catch {} }
  await home.close();
  for (const [k, v] of [['SCOMPASS_REGISTRY', saved.reg], ['SCOMPASS_CONFIG', saved.cfg], ['SCOMPASS_DATA', saved.data]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
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

test('tarjetas: "Abrir tablero" abre el tablero dentro del Inicio (mismo puerto), con la barra y el selector', async () => {
  const page = await open();
  assert.equal(await page.locator('article.proj').count(), 3, 'dos proyectos y la tarjeta de agregar');
  const card = page.locator('article.proj[aria-label="Scope Compass"]').first();
  const href = await card.getByRole('link', { name: 'Abrir tablero' }).getAttribute('href');
  assert.match(href, /^\/p\/[a-z0-9-]+\/$/);
  await card.getByRole('link', { name: 'Abrir tablero' }).click();
  await page.waitForSelector('.card');
  assert.equal(new URL(page.url()).origin, new URL(url).origin, 'mismo origen');
  assert.equal(new URL(page.url()).pathname, href);
  // La barra: volver al Inicio y cambiar de proyecto.
  assert.equal(await page.getAttribute('#home-link', 'href'), '/');
  assert.equal(await page.isVisible('#project-switch'), true);
  assert.equal(await page.locator('#project-switch option').count(), 2);
  // Editar funciona por el Inicio (sin procesos aparte).
  await page.click('.card[data-id="m1-07"]');
  await page.click('.seg button:has-text("Revisión")');
  const file = join(href.includes('juego') ? juego : vida, 'compass', 'tasks', 'm1-07.json');
  for (let i = 0; i < 100 && JSON.parse(await readFile(file, 'utf8')).status !== 'review'; i++) await new Promise((r) => setTimeout(r, 30));
  assert.equal(JSON.parse(await readFile(file, 'utf8')).status, 'review');
  assert.equal(hubsOf(vida).filter((h) => !h.base).length + hubsOf(juego).filter((h) => !h.base).length, 0, 'ningún hub suelto');
  // Volver al Inicio: la tarjeta dice que está abierto.
  await page.click('#home-link');
  await page.waitForSelector('.proj h3');
  await page.locator('article.proj .tag.live:has-text("abierto")').first().waitFor();
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
  // Crear: sin carpeta va a la carpeta de datos del usuario, con su repo de git (D28).
  await page.click('#add .tabs button:has-text("Crear con plantilla")');
  await page.fill('#new-name', 'Vida dos');
  assert.equal(await page.textContent('#new-where'), `Se crea en ${join(process.env.SCOMPASS_DATA, 'Vida dos')}, con su propio repo de git.`);
  await page.check('input[name="tpl"][value="personal"]');
  await page.click('#add button[type="submit"]');
  await page.waitForSelector('article.proj[aria-label="Vida dos"]');
  const nueva = join(process.env.SCOMPASS_DATA, 'Vida dos');
  assert.ok(existsSync(join(nueva, 'compass', 'lists', 'pendientes.json')));
  assert.ok(existsSync(join(nueva, '.git')), 'git init');
  assert.deepEqual(JSON.parse(await readFile(join(nueva, 'compass', 'config.json'), 'utf8')).views, ['lists', 'board']);
  // Otra carpeta, con el selector del escritorio (acá, un script que "elige" una).
  const { writeFile: wf, chmod } = await import('node:fs/promises');
  const otra = join(root, 'Juegos');
  const picker = join(root, 'picker.sh');
  await wf(picker, `#!/bin/sh\necho "${otra}"\n`);
  await chmod(picker, 0o755);
  process.env.SCOMPASS_PICKER = picker;
  try {
    await page.click('#add-btn');
    await page.click('#add .tabs button:has-text("Crear con plantilla")');
    await page.fill('#new-name', 'Mi juego');
    await page.click('#add button:has-text("Elegir otra carpeta…")');
    await page.waitForFunction(([d, sep]) => document.getElementById('new-where').textContent === `Se crea en ${d}${sep}Mi juego.`, [otra, sep]);
    await page.click('#add button[type="submit"]');
    await page.waitForSelector('article.proj[aria-label="Mi juego"]');
    assert.ok(existsSync(join(otra, 'Mi juego', 'compass', 'milestones', 'm00.json')));
  } finally {
    delete process.env.SCOMPASS_PICKER;
  }
});

test('en el teléfono no hay scroll horizontal', async () => {
  const page = await open({ viewport: { width: 390, height: 844 } });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
});
