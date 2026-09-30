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
