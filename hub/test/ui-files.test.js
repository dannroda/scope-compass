// Pestaña Archivos (14.2, spec §22): el árbol del repo con la marca de git, un archivo con su contenido y sus
// cambios, el filtro, Solo con cambios y el resumen del repo (rama, cambios, commits).
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { loadValidators } from '../src/schema.js';
import { createJsonFilesStore } from '../src/store/json-files.js';
import { createServer, listen } from '../src/server.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'compass');
const V = loadValidators();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
let browser, dir, app, url, pageErrors;
const git = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { stdio: 'ignore' });

before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'scompass-ui-files-'));
  await cp(FIXTURE, join(dir, 'compass'), { recursive: true });
  await mkdir(join(dir, 'src'));
  await mkdir(join(dir, 'art'));
  await writeFile(join(dir, 'src', 'player.gd'), 'extends Node\n\nfunc _ready():\n\tpass\n');
  await writeFile(join(dir, 'art', 'icon.png'), PNG);
  git('init', '-q', '-b', 'main'); git('add', '-A'); git('commit', '-qm', 'base');
  await writeFile(join(dir, 'src', 'player.gd'), 'extends Node\n\nfunc _ready():\n\tprint("hola")\n');
  await writeFile(join(dir, 'src', 'enemy.gd'), 'extends Node\n');
  app = createServer({ projectDir: dir, store: createJsonFilesStore(join(dir, 'compass'), { validators: V }), validators: V });
  url = `http://127.0.0.1:${(await listen(app, 0)).port}/`;
  pageErrors = [];
});
afterEach(async () => {
  await app?.close();
  await rm(dir, { recursive: true, force: true, maxRetries: 10 });
  assert.deepEqual(pageErrors, [], 'errores en la página');
});

async function open(hash = '#files', ready = '.file-tree') {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(url + hash);
  await page.waitForSelector(ready);
  return page;
}
const texts = (page, sel) => page.locator(sel).allTextContents();

test('árbol con la marca de git, resumen del repo, un archivo con sus cambios y su contenido', async () => {
  const page = await open();
  assert.equal(await page.getAttribute('#tab-files', 'aria-current'), 'page');
  // Resumen: la rama, los dos cambios y el commit.
  assert.equal(await page.textContent('.files-summary h2'), 'Rama main');
  assert.deepEqual(await texts(page, '.files-summary ul.changes .t'), ['src/enemy.gd', 'src/player.gd']);
  assert.match(await page.textContent('.files-summary ol.commits'), /base/);
  // Árbol: carpetas plegadas, con cuántos cambios tienen adentro.
  assert.deepEqual(await texts(page, '.file-tree > details > summary'), ['art/', 'compass/', 'src/2']);
  await page.click('.file-tree summary:has-text("src/")');
  await page.waitForSelector('.file-tree .tree-in a:has-text("player.gd")');
  assert.deepEqual(await texts(page, '.file-tree .tree-in a .gitflag'), ['N', 'M']);
  // Un archivo modificado abre en sus cambios; "Ver el archivo" muestra el código resaltado.
  await page.click('.file-tree a:has-text("player.gd")');
  await page.waitForSelector('.doc-diff .dl.add');
  assert.equal(new URL(page.url()).hash, '#files/src%2Fplayer.gd');
  assert.deepEqual(await texts(page, '.doc-diff .dl.add'), ['+\tprint("hola")']);
  assert.match(await page.textContent('.file-card'), /Modificado sin commitear/);
  await page.click('#file-diff-btn');
  await page.waitForSelector('.file-code .token.keyword');
  assert.equal(await page.textContent('.file-code .token.keyword'), 'extends');
  // Una imagen se ve.
  await page.click('.file-tree summary:has-text("art/")');
  await page.click('.file-tree a:has-text("icon.png")');
  await page.waitForFunction(() => document.querySelector('.file-image img')?.naturalWidth === 1);
  await page.context().close();
});

test('filtro por nombre y Solo con cambios; tras commitear, Actualizar saca las marcas', async () => {
  const page = await open();
  await page.fill('#file-q', 'enemy');
  assert.deepEqual(await texts(page, '.file-tree a .t'), ['src/enemy.gd']);
  await page.fill('#file-q', '');
  await page.click('#files-changed');
  assert.deepEqual(await texts(page, '.file-tree a .t'), ['src/enemy.gd', 'src/player.gd']);
  assert.equal(await page.getAttribute('#files-changed', 'aria-pressed'), 'true');
  git('add', '-A'); git('commit', '-qm', 'Saludo y enemigo');
  await page.click('#files-refresh');
  await page.waitForSelector('.file-tree p:has-text("Sin cambios: todo está commiteado.")');
  await page.click('#files-changed');
  await page.waitForSelector('.files-summary p:has-text("Ninguno: todo está commiteado.")');
  assert.equal(await page.locator('.files-summary ol.commits li').count(), 2);
  assert.match(await page.textContent('.files-summary ol.commits li:first-child'), /Saludo y enemigo/);
  assert.equal(await page.locator('.file-tree .gitflag').count(), 0);
  await page.context().close();
});

async function milestone(page, code) {
  if (!(await page.isVisible(`#miles > .chip:has-text("${code}")`))) await page.click('#ms-done');
  await page.click(`#miles .chip:has-text("${code}")`);
}

test('archivos de una tarea (15.2): llevan a Archivos, se agregan con el buscador, el que ya no está se marca, y la ficha muestra la tarea', async () => {
  // Por la API, como un agente: el campo pasa por el schema.
  const r = await fetch(url + 'api/tasks/m1-04', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files: ['src/player.gd', 'src/borrado.gd'] }) });
  assert.equal(r.status, 200);
  const page = await open('', '.card');
  await milestone(page, 'M1');
  await page.click('.card[data-id="m1-04"]');
  await page.click('#d-files-add'); // lee la lista del repo
  await page.waitForSelector('.task-files .file-row.broken');
  assert.deepEqual(await texts(page, '.task-files .file-row .link-task'), ['src/player.gdM', '⚠ src/borrado.gd ya no está en el repo']);
  // El buscador: todas las palabras, sin los que ya tiene.
  await page.fill('#d-fileq', 'src gd');
  assert.deepEqual(await texts(page, '.task-files .ref-matches .ref-id'), ['src/enemy.gd']);
  await page.click('.task-files .ref-matches button');
  await page.waitForFunction(() => document.querySelectorAll('.task-files .file-row').length === 3);
  await page.click('.task-files .file-row.broken .rm');
  await page.waitForFunction(() => document.querySelectorAll('.task-files .file-row').length === 2);
  assert.deepEqual((await (await fetch(url + 'api/tasks/m1-04')).json()).files, ['src/player.gd', 'src/enemy.gd']);
  // Del detalle a la ficha del archivo, y de la ficha a la tarea.
  await page.click('.task-files a:has-text("src/enemy.gd")');
  await page.waitForSelector('.file-tasks .bl-task');
  assert.equal(new URL(page.url()).hash, '#files/src%2Fenemy.gd');
  assert.match(await page.textContent('.file-tasks'), /Citado por · 1 tarea/);
  await page.click('.file-tasks .bl-task');
  await page.waitForSelector('#detail:not([hidden]) .task-files');
  assert.equal(await page.inputValue('#d-title'), (await (await fetch(url + 'api/tasks/m1-04')).json()).title);
  await page.context().close();
});
