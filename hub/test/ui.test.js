// Tests de navegador de la UI (D18): Playwright como librería dentro de node:test.
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
let browser, dir, compass, app, port, url, pageErrors;

async function startHub(p = 0) {
  app = createServer({ projectDir: dir, store: createJsonFilesStore(compass, { validators: V }), validators: V, watch: true, exportMd: true });
  ({ port } = await listen(app, p));
  url = `http://127.0.0.1:${port}/`;
  const cfgPath = join(compass, 'config.json');
  await writeFile(cfgPath, canonical({ ...JSON.parse(await readFile(cfgPath, 'utf8')), port }));
}

before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'scompass-ui-'));
  compass = join(dir, 'compass');
  await cp(FIXTURE, compass, { recursive: true });
  await startHub();
  pageErrors = [];
});
afterEach(async () => {
  await app?.close();
  await rm(dir, { recursive: true, force: true });
  assert.deepEqual(pageErrors, [], 'errores en la página');
});

async function open(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ...opts });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(url);
  await page.waitForSelector('.card');
  return page;
}
const task = async (id) => JSON.parse(await readFile(join(compass, 'tasks', `${id}.json`), 'utf8'));
const column = (page, id) => page.locator(`.card[data-id="${id}"]`).evaluate((el) => el.closest('.col').getAttribute('aria-label'));
const cli = (argv) => run(argv, { cwd: dir, out: { write() {} }, err: { write() {} } });

test('dos pestañas: mover una tarjeta en una se ve en la otra en menos de 1 s', async () => {
  const a = await open();
  const b = await open();
  await a.click('.card[data-id="m1-07"]');
  await a.click('.seg button:has-text("En curso")');
  const t0 = Date.now();
  await b.waitForFunction(() => document.querySelector('.card[data-id="m1-07"]')?.closest('.col')?.getAttribute('aria-label') === 'En curso', null, { timeout: 1000 });
  assert.ok(Date.now() - t0 < 1000);
  assert.equal((await task('m1-07')).status, 'doing');
  await a.context().close();
  await b.context().close();
});

test('un cambio desde la CLI y una edición a mano llegan a la UI', async () => {
  const page = await open();
  assert.equal(await cli(['move', 'm1-04', 'review']), 0);
  await page.waitForFunction(() => document.querySelector('.card[data-id="m1-04"]')?.closest('.col')?.getAttribute('aria-label') === 'Revisión', null, { timeout: 1000 });
  const t = await task('m0-01');
  await writeFile(join(compass, 'tasks', 'm0-01.json'), JSON.stringify({ ...t, title: 'Editada a mano' }));
  await page.waitForSelector('.card[data-id="m0-01"]:has-text("Editada a mano")', { timeout: 1000 });
  await page.context().close();
});

test('409: una pestaña desactualizada recibe el documento actual y un aviso, sin pisar', async () => {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  // Esta pestaña solo recibe el hello: no se entera de los cambios de otros.
  await page.routeWebSocket(/\/ws$/, (ws) => {
    const server = ws.connectToServer();
    server.onMessage((m) => { if (JSON.parse(m).type === 'hello') ws.send(m); });
  });
  await page.goto(url);
  await page.waitForSelector('.card');
  assert.equal(await cli(['set', 'm1-07', '--notes', 'cambiado por la CLI']), 0);
  await page.click('.card[data-id="m1-07"]');
  await page.click('.seg button:has-text("Revisión")');
  await page.waitForSelector('#toast:has-text("cambió esta tarea")', { timeout: 2000 });
  assert.equal(await page.inputValue('#d-notes'), 'cambiado por la CLI', 'la UI tomó la versión actual');
  const t = await task('m1-07');
  assert.equal(t.notes, 'cambiado por la CLI');
  assert.equal(t.status, 'done', 'la escritura vieja no pisó nada');
  // Con la versión actual, el mismo cambio ahora sí se guarda.
  await page.click('.seg button:has-text("Revisión")');
  await page.waitForFunction(() => document.querySelector('.seg button[aria-pressed="true"]')?.textContent === 'Revisión');
  assert.equal((await task('m1-07')).status, 'review');
  await page.close();
});

test('destildar varios pasos seguidos: se guardan todos, sin 409', async () => {
  const page = await open();
  await page.click('.card[data-id="m0-01"]');
  const boxes = page.locator('.checklist input');
  const n = await boxes.count();
  assert.ok(n >= 3);
  for (let i = 0; i < n; i++) await boxes.nth(i).click({ noWaitAfter: true });
  await page.waitForFunction(() => document.querySelectorAll('.checklist input:checked').length === 0, null, { timeout: 2000 });
  await page.waitForTimeout(200);
  assert.deepEqual((await task('m0-01')).checklist.map((c) => c.done), Array(n).fill(false));
  assert.equal(await page.locator('#toast:not([hidden])').count(), 0, 'sin avisos de conflicto');
  await page.context().close();
});

test('reconexión: con el hub caído muestra el aviso; al volver recarga lo que cambió', async () => {
  const page = await open();
  assert.equal(await page.isHidden('#conn'), true);
  await app.close();
  await page.waitForSelector('#conn:not([hidden])', { timeout: 2000 });
  // Mientras el hub está caído, la CLI escribe al disco.
  assert.equal(await cli(['move', 'm1-04', 'review']), 0);
  await startHub(port);
  await page.waitForSelector('#conn[hidden]', { state: 'attached', timeout: 12000 });
  await page.waitForFunction(() => document.querySelector('.card[data-id="m1-04"]')?.closest('.col')?.getAttribute('aria-label') === 'Revisión', null, { timeout: 2000 });
  await page.context().close();
});

test('JSON roto con la UI abierta: aviso y la tarjeta se va; al arreglarlo, vuelve', async () => {
  const page = await open();
  assert.equal(await page.isHidden('#warnings'), true);
  const original = await readFile(join(compass, 'tasks', 'm1-04.json'), 'utf8');
  await writeFile(join(compass, 'tasks', 'm1-04.json'), original.replace('  "status": "done",\n', '<<<<<<< HEAD\n  "status": "done",\n=======\n  "status": "todo",\n>>>>>>> otra\n'));
  await page.waitForSelector('#warnings:has-text("compass/tasks/m1-04.json")', { timeout: 1000 });
  assert.match(await page.textContent('#warnings'), /conflicto de git/);
  assert.equal(await page.locator('.card[data-id="m1-04"]').count(), 0);
  await writeFile(join(compass, 'tasks', 'm1-04.json'), original);
  await page.waitForSelector('.card[data-id="m1-04"]', { timeout: 1000 });
  assert.equal(await page.isHidden('#warnings'), true);
  await page.context().close();
});

test('un archivo inválido al cargar se avisa desde el principio', async () => {
  await writeFile(join(compass, 'tasks', 'm0-02.json'), '{"title": ');
  const page = await open();
  assert.match(await page.textContent('#warnings'), /compass\/tasks\/m0-02\.json · JSON inválido/);
  assert.equal(await page.locator('.card[data-id="m0-02"]').count(), 0);
  await page.context().close();
});

test('sin internet: ninguna petición fuera de 127.0.0.1 y las tres fuentes cargan', async () => {
  const ctx = await browser.newContext();
  const external = [];
  await ctx.route((u) => u.hostname !== '127.0.0.1', (route) => { external.push(route.request().url()); return route.abort(); });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(url);
  await page.waitForSelector('.card');
  await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family.replace(/"/g, '')} ${f.weight}`).sort());
  assert.deepEqual(external, []);
  for (const f of ['Cinzel 700', 'Alegreya Sans 400', 'Alegreya Sans 700', 'JetBrains Mono 500']) assert.ok(loaded.includes(f), `${f} en ${loaded}`);
  await ctx.close();
});
