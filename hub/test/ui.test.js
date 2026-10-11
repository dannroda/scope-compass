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
  await rm(dir, { recursive: true, force: true, maxRetries: 10 });
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

test('lo escrito en Notas sobrevive a un cambio de otra pestaña y se guarda sin pisarlo', async () => {
  const a = await open();
  const b = await open();
  await a.click('.card[data-id="m1-07"]');
  await a.click('#d-notes');
  await a.keyboard.press('Control+End');
  await a.keyboard.type(' y lo que escribo');
  // Otra pestaña mueve la misma tarea mientras escribo.
  await b.click('.card[data-id="m1-07"]');
  await b.click('.seg button:has-text("Revisión")');
  await a.waitForFunction(() => document.querySelector('.seg button[aria-pressed="true"]')?.textContent === 'Revisión', null, { timeout: 1000 });
  assert.match(await a.inputValue('#d-notes'), /y lo que escribo$/);
  assert.equal(await a.evaluate(() => document.activeElement.id), 'd-notes', 'mantiene el foco');
  await a.keyboard.type('!');
  await a.click('#d-title'); // blur: se guarda
  await a.waitForTimeout(300);
  const t = await task('m1-07');
  assert.match(t.notes, /y lo que escribo!$/);
  assert.equal(t.status, 'review', 'el cambio de la otra pestaña sigue ahí');
  await a.context().close();
  await b.context().close();
});

test('"Agregar paso" no pierde lo escrito mientras vuelve la respuesta de otro cambio', async () => {
  const page = await open();
  await page.click('.card[data-id="m1-07"]');
  await page.click('.seg button:has-text("En curso")');
  await page.fill('#d-addcl', 'Paso escrito enseguida');
  await page.waitForFunction(() => document.querySelector('.seg button[aria-pressed="true"]')?.textContent === 'En curso');
  assert.equal(await page.inputValue('#d-addcl'), 'Paso escrito enseguida');
  await page.click('.addcl button');
  await page.waitForSelector('.checklist .step-text:has-text("Paso escrito enseguida")');
  assert.equal((await task('m1-07')).checklist.at(-1).text, 'Paso escrito enseguida');
  await page.context().close();
});

test('arrastrar una tarjeta sobre otra del mismo hito la deja justo antes', async () => {
  const page = await open();
  await milestone(page, 'M1');
  const ids = () => page.$$eval('.col[aria-label="Hecho"] .card', (els) => els.map((e) => e.dataset.id));
  const before = await ids();
  assert.deepEqual(before.slice(0, 3), ['m1-01', 'm1-02', 'm1-03']);
  await page.dragAndDrop('.card[data-id="m1-07"]', '.card[data-id="m1-02"]');
  await page.waitForFunction(() => [...document.querySelectorAll('.col[aria-label="Hecho"] .card')].map((e) => e.dataset.id)[1] === 'm1-07');
  assert.deepEqual((await ids()).slice(0, 3), ['m1-01', 'm1-07', 'm1-02']);
  const [o1, o7, o2] = await Promise.all(['m1-01', 'm1-07', 'm1-02'].map(async (id) => (await task(id)).order));
  assert.ok(o1 < o7 && o7 < o2, `${o1} < ${o7} < ${o2}`);
  // Sobre una tarjeta de otra columna: cambia de estado y queda antes de ella.
  await page.dragAndDrop('.card[data-id="m1-03"]', '.card[data-id="m1-07"]');
  await page.waitForTimeout(300);
  assert.equal((await ids())[1], 'm1-03');
  await page.context().close();
});

test('atajos: N abre nueva tarea, 1–4 cambian el estado, y no se activan escribiendo', async () => {
  const page = await open();
  await page.keyboard.press('n');
  assert.equal(await page.isVisible('#new-form'), true);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'new-title');
  await page.keyboard.type('nada');
  assert.equal(await page.inputValue('#new-title'), 'nada', 'la n escrita es texto');
  await page.keyboard.press('Escape');
  assert.equal(await page.isHidden('#new-form'), true);

  await page.click('.card[data-id="m1-07"]');
  await page.locator('.detail .close').focus();
  await page.keyboard.press('2');
  await page.waitForFunction(() => document.querySelector('.seg button[aria-pressed="true"]')?.textContent === 'En curso');
  assert.equal((await task('m1-07')).status, 'doing');
  await page.click('#d-notes');
  await page.keyboard.type('3');
  await page.waitForTimeout(200);
  assert.equal((await task('m1-07')).status, 'doing', 'un 3 escrito en Notas no cambia el estado');
  await page.locator('.detail .close').focus();
  await page.keyboard.press('Escape');
  assert.equal(await page.isHidden('#detail'), true);
  await page.context().close();
});

test('notas y "cómo probarlo" crecen con el texto, sin arrastrar la esquina (16.3)', async () => {
  const page = await open({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await page.click('.card[data-id="m1-07"]');
  const height = () => page.locator('#d-notes').evaluate((e) => e.offsetHeight);
  await page.fill('#d-notes', '');
  const before = await height();
  await page.fill('#d-notes', 'una\ndos\ntres\ncuatro\ncinco\nseis\nsiete');
  assert.ok(await height() > before + 60, `creció de ${before} a ${await height()} px`);
  assert.equal(await page.locator('#d-notes').evaluate((e) => e.scrollHeight <= e.clientHeight), true, 'se ve todo, sin scroll adentro');
  await page.context().close();
});

test('descripción en el detalle, antes de los pasos: se guarda, la CLI la actualiza y vacía se quita (17.2)', async () => {
  const page = await open();
  await page.click('.card[data-id="m1-07"]');
  assert.equal(await page.inputValue('#d-description'), '');
  assert.equal(await page.getAttribute('#d-description', 'placeholder'), 'Qué hay que hacer y por qué');
  await page.fill('#d-description', 'Qué hacer\ny por qué');
  await page.locator('#d-description').blur();
  for (let i = 0; i < 100 && !(await task('m1-07')).description; i++) await new Promise((r) => setTimeout(r, 30));
  assert.equal((await task('m1-07')).description, 'Qué hacer\ny por qué');
  assert.equal(await cli(['set', 'm1-07', '--description', 'Desde la CLI']), 0);
  await page.waitForFunction(() => document.getElementById('d-description')?.value === 'Desde la CLI');
  await page.fill('#d-description', '  ');
  await page.locator('#d-description').blur();
  for (let i = 0; i < 100 && 'description' in (await task('m1-07')); i++) await new Promise((r) => setTimeout(r, 30));
  assert.equal('description' in (await task('m1-07')), false, 'en blanco, el campo se quita');
  await page.context().close();
});

test('done_at (18.1): pasar a Hecho desde el detalle lo anota en el pie y en la columna Terminada de la lista', async () => {
  const page = await open();
  await page.click('.card[data-id="m1-07"]');
  await page.click('.seg button:has-text("Pendiente")');
  await page.waitForFunction(() => !/Terminada/.test(document.querySelector('#detail .footer-actions')?.textContent));
  await page.click('.seg button:has-text("Hecho")');
  await page.waitForFunction(() => /Terminada .* · Actualizada/.test(document.querySelector('#detail .footer-actions')?.textContent));
  assert.ok((await task('m1-07')).done_at);
  await page.locator('.detail .close').click();
  await page.click('#mode-list');
  assert.ok((await page.locator('#tasklist th').allTextContents()).includes('Terminada'));
  await page.click('button[data-sort="done"]');
  assert.equal(await page.locator('#tasklist tbody tr').first().getAttribute('data-id'), 'm1-07', 'la más reciente arriba');
  await page.context().close();
});

test('fecha objetivo del hito (18.2): el chip se marca atrasado y el resumen dice la fecha', async () => {
  assert.equal(await cli(['milestone', 'set', 'm01', '--due', '2020-01-01']), 0);
  const page = await open();
  await page.click('.ms-done summary').catch(() => {});
  await page.click('.chip:has-text("M1")');
  await page.waitForSelector('.sum-line .ms-due');
  assert.match(await page.textContent('.sum-line .ms-due'), /^Objetivo /, 'todo hecho: sin atraso');
  assert.equal(await cli(['move', 'm1-07', 'doing']), 0);
  await page.waitForSelector('.sum-line .ms-due.bad');
  assert.match(await page.textContent('.sum-line .ms-due'), /^Atrasado · /);
  assert.equal(await page.locator('#miles .chip.late').count(), 1);
  await page.context().close();
});

test('un clic afuera del detalle lo cierra; otra tarjeta cambia de tarea; adentro o arrastrando una selección, no (16.5)', async () => {
  const page = await open();
  const openId = () => page.evaluate(() => (document.getElementById('detail').hidden ? null : document.querySelector('#detail #d-title')?.value));
  await page.click('.card[data-id="m1-07"]');
  const title = await openId();
  assert.ok(title);
  // Adentro: tildar un paso redibuja el detalle, y sigue abierto.
  await page.locator('#detail .checklist input').first().click();
  await page.waitForTimeout(300);
  assert.equal(await openId(), title, 'un clic adentro no lo cierra');
  // Una selección que empieza en las notas y termina afuera.
  const notes = await page.locator('#d-notes').boundingBox();
  await page.mouse.move(notes.x + notes.width - 10, notes.y + 10);
  await page.mouse.down();
  await page.mouse.move(40, notes.y + 10, { steps: 5 });
  await page.mouse.up();
  assert.equal(await openId(), title, 'arrastrar hasta afuera no lo cierra');
  // Otra tarjeta: cambia de tarea.
  // Una tarjeta que el detalle no tape: m1-06 pasa a Pendiente, la primera columna.
  assert.equal(await cli(['move', 'm1-06', 'todo']), 0);
  await page.waitForSelector('.col[aria-label="Pendiente"] .card[data-id="m1-06"]');
  await page.click('.card[data-id="m1-06"]');
  const other = await openId();
  assert.ok(other && other !== title, 'otra tarjeta abre otra tarea');
  // Afuera, en el título del proyecto: se cierra.
  await page.click('h1');
  assert.equal(await page.isHidden('#detail'), true);
  await page.context().close();
  assert.equal(await cli(['move', 'm1-06', 'done']), 0);
});

test('el detalle ocupa toda la pantalla hasta 760 px; más ancho, es un panel al costado (16.6)', async () => {
  for (const [opts, full] of [[{ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, true],
    [{ viewport: { width: 602, height: 1120 }, hasTouch: true, isMobile: true }, true], [{ viewport: { width: 900, height: 900 } }, false]]) {
    const page = await open(opts);
    await page.click('.card[data-id="m1-07"]');
    const [w, vw] = await page.locator('#detail').evaluate((e) => [e.getBoundingClientRect().width, innerWidth]);
    full ? assert.equal(w, vw, `${vw} px: toda la pantalla`) : assert.equal(w, 460, `${vw} px: panel de 460`);
    await page.context().close();
  }
});

test('la tarea abierta tiene su ruta: atrás la cierra, el enlace la abre, cambiar de tarea no apila (16.7)', async () => {
  const page = await open();
  const shown = () => page.evaluate(() => (document.getElementById('detail').hidden ? null : document.getElementById('detail').dataset.task));
  // Desde el tablero: #task/<id>; atrás la cierra y queda el tablero.
  await page.click('.card[data-id="m1-07"]');
  assert.equal(new URL(page.url()).hash, '#task/m1-07');
  await page.goBack();
  await page.waitForFunction(() => document.getElementById('detail').hidden);
  assert.equal(new URL(page.url()).hash, '');
  assert.equal(await page.isVisible('#board'), true);
  // Adelante la vuelve a abrir; Cerrar vuelve al tablero sin dejar otra entrada igual.
  await page.goForward();
  await page.waitForFunction(() => document.getElementById('detail').dataset.task === 'm1-07' && !document.getElementById('detail').hidden);
  const before = await page.evaluate(() => history.length);
  await page.click('#detail .close');
  await page.waitForFunction(() => document.getElementById('detail').hidden && !location.hash);
  assert.equal(await page.evaluate(() => history.length), before, 'Cerrar no suma entradas');
  // Cambiar de tarea con una abierta reemplaza la entrada: atrás va al tablero, no a la anterior.
  assert.equal(await cli(['move', 'm1-06', 'todo']), 0);
  await page.waitForSelector('.col[aria-label="Pendiente"] .card[data-id="m1-06"]');
  await page.click('.card[data-id="m1-07"]');
  await page.click('.card[data-id="m1-06"]');
  assert.equal(new URL(page.url()).hash, '#task/m1-06');
  await page.goBack();
  await page.waitForFunction(() => document.getElementById('detail').hidden);
  assert.equal(new URL(page.url()).hash, '');
  assert.equal(await cli(['move', 'm1-06', 'done']), 0);
  // El enlace directo abre la tarea; uno a una tarea que no existe, no, y se va de la barra de direcciones.
  await page.goto(url + '#task/m1-07');
  await page.waitForFunction(() => document.getElementById('detail').dataset.task === 'm1-07' && !document.getElementById('detail').hidden);
  await page.click('#detail .close');
  await page.waitForFunction(() => document.getElementById('detail').hidden && !location.hash);
  await page.goto(url + '#task/nada');
  await page.waitForSelector('.card');
  await page.waitForFunction(() => !location.hash);
  assert.equal(await shown(), null);
  await page.context().close();
});

// --- Criterios de §14 con UI (3.8) ---

const REFERENCE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'reference', 'tablero-artifact.html');
const TOKENS = ['--bg', '--surface', '--surface-2', '--line', '--fg', '--muted', '--accent', '--accent-soft', '--on-accent',
  '--s-todo', '--s-doing', '--s-review', '--s-done', '--danger', '--font-display', '--font-body', '--font-mono', '--shadow'];

// Estilos que definen el aspecto: tokens, tipografía y la forma de los bloques principales.
async function looks(page) {
  return page.evaluate((tokens) => {
    const cs = (sel, props) => { const el = document.querySelector(sel); if (!el) return null; const s = getComputedStyle(el); return Object.fromEntries(props.map((p) => [p, s[p]])); };
    const root = getComputedStyle(document.documentElement);
    return {
      tokens: Object.fromEntries(tokens.map((t) => [t, root.getPropertyValue(t).trim()])),
      body: cs('body', ['backgroundColor', 'color', 'fontFamily', 'fontSize', 'lineHeight']),
      h1: cs('h1', ['fontFamily', 'fontSize', 'letterSpacing']),
      primary: cs('.btn.primary', ['backgroundColor', 'color', 'borderRadius', 'fontWeight', 'minHeight']),
      // El resumen del hito ya no es el del artifact: es una línea (13.2).
      summary: cs('section.summary', ['backgroundColor', 'borderRadius']),
      // En el teléfono el tablero se desliza de costado (16.1); el artifact apilaba las columnas.
      board: innerWidth > 560 ? cs('main.board', ['gridTemplateColumns', 'gap']) : null,
      // Una columna con tarjetas si hay (el artifact de referencia no tiene): en el teléfono, las vacías son de una línea (13.4).
      col: cs(document.querySelector('.col:not(:has(> .empty-col))') ? '.col:not(:has(> .empty-col))' : '.col', ['backgroundColor', 'borderRadius', 'padding', 'minHeight']),
      colTitle: cs('.col h3', ['fontSize', 'textTransform', 'letterSpacing'])
    };
  }, TOKENS);
}

test('§14: mismo aspecto que el artifact en claro, oscuro, escritorio y pantalla angosta', async () => {
  const html = await readFile(REFERENCE, 'utf8');
  for (const colorScheme of ['light', 'dark']) {
    for (const width of [1400, 900, 390]) {
      const ctx = await browser.newContext({ colorScheme, viewport: { width, height: 900 } });
      await ctx.route((u) => u.hostname !== '127.0.0.1', (r) => r.abort());
      const ref = await ctx.newPage();
      await ref.setContent(html);
      // Lo que ponía el contenedor del artifact (el mismo body { margin: 0 } de app.css).
      await ref.addStyleTag({ content: 'body { margin: 0; }' });
      const ours = await ctx.newPage();
      ours.on('pageerror', (e) => pageErrors.push(e.message));
      await ours.goto(url);
      await ours.waitForSelector('.card');
      const [a, b] = [await looks(ref), await looks(ours)];
      for (const k of Object.keys(a)) assert.deepEqual(b[k], a[k], `${colorScheme} ${width}px: ${k}`);
      await ctx.close();
    }
  }
});

test('§14: un cliente WebSocket mínimo recibe upsert al mover una tarjeta desde la UI', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const got = [];
  ws.onmessage = (e) => got.push(JSON.parse(e.data));
  await new Promise((r) => { ws.onopen = r; });
  const page = await open();
  // Una tarjeta visible sin scroll: arrastrar tras un scroll puede levantar otra tarjeta.
  await page.dragAndDrop('.card[data-id="m0-01"]', '.col[aria-label="En curso"]');
  const t0 = Date.now();
  while (!got.some((m) => m.type === 'upsert' && m.id === 'm0-01') && Date.now() - t0 < 1000) await new Promise((r) => setTimeout(r, 10));
  const m = got.find((x) => x.type === 'upsert' && x.id === 'm0-01');
  assert.ok(m, `llegó el upsert (recibidos: ${JSON.stringify(got.map((x) => [x.type, x.id]))}, en disco: ${(await task('m0-01')).status})`);
  assert.equal(m.doc.status, 'doing');
  ws.close();
  await page.context().close();
});

test('§14: sin la app, todo lo hecho en la UI está en compass/ y en docs/tareas.md', async () => {
  const page = await open();
  await page.keyboard.press('n');
  await page.fill('#new-title', 'Hecha en la UI');
  await page.selectOption('#new-ms', 'm02');
  await page.click('#new-form button[type=submit]');
  await page.waitForSelector('.card:has-text("Hecha en la UI")');
  await page.context().close();
  await app.close(); // exporta lo pendiente al cerrar
  app = null;
  // Nada del código de la app: JSON.parse, el schema que vive en compass/schema/ y el markdown.
  const { readdir } = await import('node:fs/promises');
  const Ajv = (await import('ajv/dist/2020.js')).default;
  const ajv = new Ajv({ allErrors: true });
  (await import('ajv-formats')).default(ajv);
  const validate = ajv.compile(JSON.parse(await readFile(join(compass, 'schema', 'task.schema.json'), 'utf8')));
  const tasks = [];
  for (const f of await readdir(join(compass, 'tasks'))) {
    const t = JSON.parse(await readFile(join(compass, 'tasks', f), 'utf8'));
    assert.ok(validate(t), f);
    tasks.push(t);
  }
  assert.ok(tasks.some((t) => t.title === 'Hecha en la UI' && t.milestone === 'm02'));
  assert.match(await readFile(join(dir, 'docs', 'tareas.md'), 'utf8'), /### Hecha en la UI · Pendiente/);
});

test('fecha límite (8.13): se elige en el detalle, la tarjeta la marca vencida y "Quitar" la saca', async () => {
  const page = await open();
  await page.click('.card[data-id="m1-07"]');
  await page.click('.seg button:has-text("Pendiente")');
  for (let i = 0; i < 100 && (await task('m1-07')).status !== 'todo'; i++) await new Promise((r) => setTimeout(r, 30));
  await page.fill('#d-due', '2020-01-01');
  await page.dispatchEvent('#d-due', 'change');
  for (let i = 0; i < 100 && (await task('m1-07')).due !== '2020-01-01'; i++) await new Promise((r) => setTimeout(r, 30));
  assert.equal((await task('m1-07')).due, '2020-01-01');
  await page.waitForSelector('.card[data-id="m1-07"] .duemark.bad');
  // Hecha, ya no se marca vencida.
  await page.click('.seg button:has-text("Hecho")');
  await page.waitForSelector('.card[data-id="m1-07"] .duemark:not(.bad)');
  await page.fill('#d-due-time', '09:30');
  await page.dispatchEvent('#d-due-time', 'change');
  for (let i = 0; i < 100 && (await task('m1-07')).due !== '2020-01-01T09:30'; i++) await new Promise((r) => setTimeout(r, 30));
  assert.equal((await task('m1-07')).due, '2020-01-01T09:30');
  await page.click('button[aria-label="Quitar fecha"]');
  for (let i = 0; i < 100 && (await task('m1-07')).due !== undefined; i++) await new Promise((r) => setTimeout(r, 30));
  assert.equal((await task('m1-07')).due, undefined);
  await page.waitForFunction(() => !document.querySelector('.card[data-id="m1-07"] .duemark'));
});

test('detalle (13.3): pasos sin bajar a 1440×900, título sin borde en reposo, propiedades en chips que se editan en el lugar', async () => {
  const page = await open({ viewport: { width: 1440, height: 900 } });
  await page.click('.card[data-id="m1-03"]');
  await page.waitForSelector('#detail .checklist li');
  // Los pasos (5) se ven enteros sin bajar el panel.
  const last = await page.locator('#detail .checklist li').last().evaluate((e) => e.getBoundingClientRect().bottom);
  assert.ok(last < 900, `último paso hasta ${last} px`);
  assert.equal(await page.locator('#detail').evaluate((e) => e.scrollTop), 0);
  // Abrir no enfoca el título: sin borde hasta que se lo enfoca.
  const border = () => page.locator('#d-title').evaluate((e) => getComputedStyle(e).borderTopColor);
  assert.equal(await border(), 'rgba(0, 0, 0, 0)');
  await page.focus('#d-title');
  assert.notEqual(await border(), 'rgba(0, 0, 0, 0)');
  await page.locator('.detail .close').focus();
  // Una fila de chips: hito, fecha, prioridad, responsable y etiquetas; los vacíos, apagados.
  assert.deepEqual(await page.locator('#detail .props .pk').allTextContents(), ['Hito', 'Vence', 'Prioridad', 'Responsable', 'Etiquetas']);
  assert.equal(await page.locator('#detail .props .pchip.empty').count(), 4);
  await page.selectOption('#d-ms', 'm02');
  for (let i = 0; i < 100 && (await task('m1-03')).milestone !== 'm02'; i++) await new Promise((r) => setTimeout(r, 30));
  assert.equal((await task('m1-03')).milestone, 'm02');
  await page.selectOption('#d-priority', 'low');
  await page.waitForSelector('#detail .pchip.prio-low');
  assert.equal(await page.locator('#detail .props .pchip.empty').count(), 3);
  // El orden: estado, descripción, pasos y notas antes que referencias y "Cómo probarlo".
  const order = await page.locator('#detail > *').evaluateAll((els) => els.map((e) => e.matches('.seg') ? 'estado' : e.querySelector('#d-description') ? 'descripción' : e.querySelector('.checklist, .addcl') ? 'pasos' : e.querySelector('#d-notes') ? 'notas' : e.querySelector('#d-test') ? 'prueba' : e.matches('.refs') ? 'refs' : null).filter(Boolean));
  assert.deepEqual([...new Set(order)], ['estado', 'descripción', 'pasos', 'notas', 'refs', 'prueba']); // vínculos también es .refs
  await page.context().close();
});

test('"← Inicio": aparece solo si el Inicio está corriendo, y apunta a él', async () => {
  const { registerHub, unregisterHub } = await import('../src/registry.js');
  const page = await open();
  assert.equal(await page.isVisible('#home-link'), false);
  registerHub({ port: 4999, kind: 'home', pid: process.ppid });
  try {
    await page.reload();
    await page.waitForSelector('#home-link:not([hidden])');
    assert.equal(await page.getAttribute('#home-link', 'href'), 'http://127.0.0.1:4999/');
  } finally {
    unregisterHub(process.ppid);
  }
});

// Elige un hito por su código; los terminados están dentro de "Terminados" (13.2).
async function milestone(page, code) {
  if (!(await page.isVisible(`#miles > .chip:has-text("${code}")`))) await page.click('#ms-done');
  await page.click(`#miles .chip:has-text("${code}")`);
}
