// UI de documentos y referencias (6.4, 6.5) en el navegador.
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
const GDD = `# Juego
<!-- id: juego -->

## Combate
<!-- id: combate -->

### Ventanas de ataque
<!-- id: ventanas-ataque -->

Las ventanas de golpe son datos.

\`\`\`gdscript
class_name AttackData
extends Resource
\`\`\`

## Cámara
<!-- id: camara -->

Cámara cenital.
`;
let browser, dir, app, url, pageErrors;

before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'scompass-uidocs-'));
  await cp(FIXTURE, join(dir, 'compass'), { recursive: true });
  await writeFile(join(dir, 'gdd.md'), GDD);
  const cfg = join(dir, 'compass', 'config.json');
  await writeFile(cfg, canonical({ ...JSON.parse(await readFile(cfg, 'utf8')), docs: [{ alias: 'gdd', path: 'gdd.md' }] }));
  // Sin las refs del fixture (apuntan a docs/spec.md, que acá no está).
  for (const id of ['m0-01', 'm0-02', 'm0-03', 'm0-04', 'm0-05', 'm0-06']) await setTask(id, { refs: [] });
  for (const [id, refs] of Object.entries({ 'm1-01': [], 'm1-02': [], 'm1-03': [{ doc: 'gdd.md', section: 'ventanas-ataque' }], 'm1-04': [{ doc: 'gdd.md', section: 'ventanas-ataque' }], 'm1-05': [{ doc: 'gdd.md', section: 'borrada' }], 'm1-06': [], 'm1-07': [] })) {
    await setTask(id, { refs });
  }
  app = createServer({ projectDir: dir, store: createJsonFilesStore(join(dir, 'compass'), { validators: V }), validators: V, watch: true });
  const { port } = await listen(app, 0);
  url = `http://127.0.0.1:${port}/`;
  pageErrors = [];
});
afterEach(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
  assert.deepEqual(pageErrors, [], 'errores en la página');
});
async function setTask(id, changes) {
  const p = join(dir, 'compass', 'tasks', `${id}.json`);
  await writeFile(p, canonical({ ...JSON.parse(await readFile(p, 'utf8')), ...changes }));
}
const task = async (id) => JSON.parse(await readFile(join(dir, 'compass', 'tasks', `${id}.json`), 'utf8'));
async function open(hash = '') {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(url + hash);
  await page.waitForSelector(hash ? '.toc a' : '.card');
  return page;
}

test('§10.6: una tarea con refs muestra la sección renderizada en su detalle, con GDScript resaltado', async () => {
  const page = await open();
  await page.click('.chip:has-text("M1")');
  await page.click('.card[data-id="m1-03"]');
  await page.waitForSelector('.ref-body pre.code.language-gdscript .token.keyword');
  assert.match(await page.textContent('.ref-toggle'), /Ventanas de ataque/);
  assert.match(await page.textContent('.ref-body'), /Las ventanas de golpe son datos/);
  assert.equal(await page.getAttribute('.ref-head a', 'href'), '#docs/gdd/ventanas-ataque');
  assert.match(await page.textContent('.card[data-id="m1-03"] .refmark'), /§ 1/);
  await page.close();
});

test('agregar una referencia con el buscador y quitarla', async () => {
  const page = await open();
  await page.click('.chip:has-text("M1")');
  await page.click('.card[data-id="m1-07"]');
  await page.click('.refs-head button:has-text("Agregar")');
  await page.fill('#d-refq', 'camar');
  await page.click('.ref-matches button:has-text("Cámara")');
  await page.waitForSelector('.ref-toggle:has-text("Cámara")');
  assert.deepEqual((await task('m1-07')).refs, [{ doc: 'gdd.md', section: 'camara' }]);
  await page.click('.ref .rm');
  await page.waitForFunction(() => !document.querySelector('.ref-toggle'));
  assert.deepEqual((await task('m1-07')).refs, []);
  await page.close();
});

test('referencia rota: aviso en el detalle y en la tarjeta', async () => {
  const page = await open();
  await page.click('.chip:has-text("M1")');
  assert.match(await page.getAttribute('.card[data-id="m1-05"] .refmark', 'class'), /bad/);
  await page.click('.card[data-id="m1-05"]');
  assert.match(await page.textContent('.ref.broken'), /Referencia rota: gdd\.md#borrada/);
  await page.close();
});

test('§10.6: la vista Documentos muestra los backlinks correctos por sección', async () => {
  const page = await open('#docs/gdd/ventanas-ataque');
  await page.waitForSelector('article.doc-body h3#sec-ventanas-ataque');
  const counts = await page.$$eval('.toc a', (as) => as.map((a) => [a.getAttribute('href').split('/').pop(), a.querySelector('.n')?.textContent ?? '0']));
  assert.deepEqual(counts, [['juego', '0'], ['combate', '0'], ['ventanas-ataque', '2'], ['camara', '0']]);
  const bl = await page.$$eval('.backlinks .bl-task', (as) => as.map((a) => a.textContent));
  assert.equal(bl.length, 2);
  assert.match(bl.join(' '), /1\.3/);
  assert.match(bl.join(' '), /1\.4/);
  assert.match(await page.textContent('.pill'), /1 referencia rota/);
  // Otra sección desde el índice: cambia el hash y los backlinks.
  await page.click('.toc a[href="#docs/gdd/camara"]');
  await page.waitForFunction(() => document.querySelector('.backlinks')?.textContent.includes('Ninguna tarea'));
  // Ir a una tarea desde los backlinks.
  await page.click('.toc a[href="#docs/gdd/ventanas-ataque"]');
  await page.waitForSelector('.backlinks .bl-task');
  await page.click('.backlinks .bl-task >> nth=0');
  await page.waitForSelector('#detail:not([hidden]) #d-title');
  assert.equal(await page.isHidden('#docs'), true);
  await page.close();
});

test('editar el documento con la UI abierta la actualiza sola', async () => {
  const page = await open('#docs/gdd/ventanas-ataque');
  await page.waitForSelector('article.doc-body h3#sec-ventanas-ataque');
  await writeFile(join(dir, 'gdd.md'), GDD.replace('### Ventanas de ataque', '### Ventanas de golpe'));
  await page.waitForSelector('.toc a:has-text("Ventanas de golpe")', { timeout: 2000 });
  await page.waitForSelector('article.doc-body h3:has-text("Ventanas de golpe")', { timeout: 2000 });
  await page.close();
});

test('6.6: [[gdd#id]] en pasos y notas se ve con el título actual; roto, marcado; en `código`, literal', async () => {
  await setTask('m1-06', {
    notes: 'Ver [[gdd#ventanas-ataque]] y [[gdd#borrada]]; ejemplo: `[[gdd#camara]]`',
    checklist: [{ text: 'Revisar [[gdd#camara]] antes', done: false }],
    title: 'Tarea con [[gdd#combate]]'
  });
  const page = await open();
  await page.click('.chip:has-text("M1")');
  assert.match(await page.textContent('.card[data-id="m1-06"] .t'), /^Tarea con Combate$/, 'en la tarjeta, texto sin enlace');
  assert.equal(await page.locator('.card[data-id="m1-06"] a').count(), 0);
  await page.click('.card[data-id="m1-06"]');
  assert.equal(await page.getAttribute('.checklist label a.doclink', 'href'), '#docs/gdd/camara');
  assert.equal(await page.textContent('.checklist label a.doclink'), 'Cámara');
  const notes = await page.$$eval('#d-notes ~ .doclinks > *', (els) => els.map((e) => e.textContent));
  assert.deepEqual(notes, ['Enlaces:', 'Ventanas de ataque', '⚠ gdd#borrada']);
  // El enlace lleva a la sección en la vista Documentos.
  await page.click('#d-notes ~ .doclinks a');
  await page.waitForSelector('article.doc-body h3#sec-ventanas-ataque');
  assert.match(page.url(), /#docs\/gdd\/ventanas-ataque$/);
  await page.close();
});

// --- 6.9: criterios de §10.6 medidos ---

test('§10.6: editar gdd.md con la app abierta actualiza la vista en menos de 1 s', async () => {
  const page = await open('#docs/gdd/ventanas-ataque');
  await page.waitForSelector('article.doc-body h3#sec-ventanas-ataque');
  const times = [];
  for (const name of ['Ventanas de golpe', 'Ventanas de impacto', 'Ventanas de ataque']) {
    const t0 = Date.now();
    await writeFile(join(dir, 'gdd.md'), GDD.replace('### Ventanas de ataque', `### ${name}`));
    await page.waitForSelector(`article.doc-body h3:has-text("${name}")`, { timeout: 3000 });
    times.push(Date.now() - t0);
  }
  assert.ok(Math.max(...times) < 1000, `tardó ${times.join(', ')} ms`);
  await page.close();
});

test('§10.6: borrar una sección referenciada marca la tarea en vivo, y refs check la lista', async () => {
  const page = await open();
  await page.click('.chip:has-text("M1")');
  assert.doesNotMatch(await page.getAttribute('.card[data-id="m1-03"] .refmark', 'class'), /bad/);
  await writeFile(join(dir, 'gdd.md'), GDD.replace(/### Ventanas de ataque[\s\S]*?(?=## Cámara)/, ''));
  await page.waitForFunction(() => /bad/.test(document.querySelector('.card[data-id="m1-03"] .refmark')?.className), null, { timeout: 2000 });
  const { run } = await import('../src/cli.js');
  let out = '';
  const code = await run(['--dir', dir, '--direct', 'refs', 'check', '--json'], { out: { write: (s) => { out += s; } }, err: { write() {} } });
  assert.equal(code, 1);
  assert.deepEqual(JSON.parse(out).broken.map((b) => [b.task, b.ref]).sort(), [['m1-03', 'gdd.md#ventanas-ataque'], ['m1-04', 'gdd.md#ventanas-ataque'], ['m1-05', 'gdd.md#borrada']]);
  await page.close();
});

// --- Arreglos pedidos: "Cerrar" del buscador y ancho del panel ---

test('"+ Agregar" abre el buscador y "Cerrar" lo cierra', async () => {
  const page = await open();
  await page.click('.chip:has-text("M1")');
  await page.click('.card[data-id="m1-07"]');
  await page.click('.refs-head button:has-text("Agregar")');
  assert.equal(await page.isVisible('#d-refq'), true);
  await page.click('.refs-head button:has-text("Cerrar")');
  await page.waitForFunction(() => !document.getElementById('d-refq'));
  assert.equal(await page.textContent('.refs-head button'), '+ Agregar');
  // También cerrando después de escribir.
  await page.click('.refs-head button:has-text("Agregar")');
  await page.fill('#d-refq', 'cam');
  await page.click('.refs-head button:has-text("Cerrar")');
  await page.waitForFunction(() => !document.getElementById('d-refq'));
  await page.close();
});

test('el panel de detalle se agranda arrastrando su borde, con el teclado, y se recuerda', async () => {
  const page = await open();
  await page.click('.chip:has-text("M1")');
  await page.click('.card[data-id="m1-03"]');
  const width = () => page.$eval('#detail', (el) => Math.round(el.getBoundingClientRect().width));
  assert.equal(await width(), 460);
  const box = await page.locator('#detail .resize').boundingBox();
  await page.mouse.move(box.x + 4, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(1440 - 800, box.y + 300, { steps: 5 });
  await page.mouse.up();
  assert.ok(Math.abs(await width() - 800) <= 2, `ancho ${await width()}`);
  // Tope: 90 % de la ventana; mínimo 360.
  await page.mouse.move(1440 - 800, 300); await page.mouse.down(); await page.mouse.move(10, 300, { steps: 3 }); await page.mouse.up();
  assert.equal(await width(), 1296);
  await page.focus('#detail .resize');
  for (let i = 0; i < 60; i++) await page.keyboard.press('ArrowRight');
  assert.equal(await width(), 360);
  await page.keyboard.press('Shift+ArrowLeft');
  assert.equal(await width(), 456);
  // Se recuerda al recargar; doble clic vuelve al ancho original.
  await page.reload();
  await page.waitForSelector('.card');
  await page.click('.card[data-id="m1-03"]');
  assert.equal(await width(), 456);
  await page.dblclick('#detail .resize');
  assert.equal(await width(), 460);
  await page.close();
});

test('"Copiar enlace": copia [[alias#id]] de la sección actual y avisa si la sección no tiene id', async () => {
  await writeFile(join(dir, 'gdd.md'), GDD + '\n## Sin id propio\nTexto.\n');
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(url + '#docs/gdd/camara');
  await page.waitForSelector('.copy-link');
  assert.equal(await page.textContent('.copy-link'), 'Copiar enlace');
  assert.equal(await page.locator('.docs-bar .fragile').count(), 0);
  await page.click('.copy-link');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '[[gdd#camara]]');
  await page.waitForSelector('#toast:has-text("Copiado: [[gdd#camara]]")');
  await page.click('.toc a[href="#docs/gdd/sin-id-propio"]');
  await page.waitForSelector('.docs-bar .fragile');
  assert.match(await page.textContent('.docs-bar .fragile'), /Sin id/);
  await ctx.close();
});
