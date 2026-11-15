// Página del Inicio en el navegador (8.10): Hoy, tarjetas, prender y apagar, importar y crear con plantilla.
import './isolate.js';
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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
  await rm(root, { recursive: true, force: true, maxRetries: 10 });
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

test('Hoy: lo que solo está en curso va en un grupo plegable por proyecto, y el pliegue se recuerda', async () => {
  const cfg = join(juego, 'compass', 'config.json');
  await writeFile(cfg, JSON.stringify({ ...JSON.parse(await readFile(cfg, 'utf8')), project: 'Juego' }));
  const sv = createJsonFilesStore(join(vida, 'compass'), { validators: V });
  const sj = createJsonFilesStore(join(juego, 'compass'), { validators: V });
  await sv.patch('tasks', 'm1-04', { status: 'doing' });
  await sj.patch('tasks', 'm1-04', { status: 'doing' });
  await sj.patch('tasks', 'm0-01', { status: 'doing' });
  // En curso y para hoy: va suelto, arriba, con su proyecto.
  await sj.patch('tasks', 'm0-02', { status: 'doing', due: TODAY });
  const page = await open();
  await page.waitForSelector('.hoy-group');
  const groups = () => page.$$eval('.hoy-group', (gs) => gs.map((g) => [g.querySelector('summary .what').textContent, g.querySelector('summary .tag').textContent, g.open, g.querySelectorAll('.hoy-row').length]));
  assert.deepEqual((await groups()).sort(), [['Juego', '2 en curso', true, 2], ['Scope Compass', '1 en curso', true, 1]]);
  const loose = await page.$$eval('#hoy > .hoy-row', (rs) => rs.map((r) => r.textContent));
  assert.equal(loose.filter((x) => /Juego/.test(x) && /en curso/.test(x) && /hoy/.test(x)).length, 1, 'la de hoy queda suelta');
  // Dentro del grupo no se repite el proyecto ni "en curso".
  assert.equal(await page.locator('.hoy-group .hoy-row .tag').count(), 0);
  await page.locator('.hoy-group summary', { hasText: 'Juego' }).click();
  assert.deepEqual((await groups()).find((g) => g[0] === 'Juego').slice(2), [false, 2]);
  // Al recargar (o con un evento que re-renderiza) sigue plegado.
  await page.reload();
  await page.waitForSelector('.hoy-group');
  assert.equal((await groups()).find((g) => g[0] === 'Juego')[2], false);
  assert.equal((await groups()).find((g) => g[0] === 'Scope Compass')[2], true);
});

test('decisiones (§31, 31.1): las preguntas abiertas van plegadas en Esperan tu respuesta y llevan a la tarea; la tarjeta cuenta las que esperan', async () => {
  const sv = createJsonFilesStore(join(vida, 'compass'), { validators: V });
  await sv.patch('tasks', 'm1-04', { decisions: [{ text: '¿Lo hago en JSON?', asked: true }, { text: 'Usé X' }, { text: 'Usé Y' }] });
  const page = await open();
  await page.waitForSelector('#hoy > details.questions');
  assert.match(await page.textContent('#hoy > details.questions > summary'), /Esperan tu respuesta \(1\)/);
  assert.equal(await page.getAttribute('#hoy > details.questions', 'open'), null, 'plegada');
  assert.match(await page.textContent('#hoy .hoy-row.question'), /¿Lo hago en JSON\?.*pregunta · 1\.4/);
  assert.match(await page.getAttribute('#hoy .hoy-row.question a', 'href'), /#task\/m1-04$/);
  const tag = page.locator('.proj .decs a');
  assert.equal(await tag.textContent(), 'Decisiones: 1 pregunta abierta · 2 sin revisar');
  assert.match(await tag.getAttribute('href'), /#decisions$/);
});

test('worktrees (23.2): una tarjeta por repo con los worktrees adentro, y en Hoy cada tarea una vez', async () => {
  const git = (cwd, ...x) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...x], { stdio: 'ignore' });
  const cfg = join(juego, 'compass', 'config.json');
  await writeFile(cfg, JSON.stringify({ ...JSON.parse(await readFile(cfg, 'utf8')), project: 'Juego' }));
  const sj = createJsonFilesStore(join(juego, 'compass'), { validators: V });
  await sj.patch('tasks', 'm1-04', { status: 'doing' });
  git(juego, 'init', '-q', '-b', 'main'); git(juego, 'add', '-A'); git(juego, 'commit', '-qm', 'base');
  const arte = join(root, 'juego-arte');
  git(juego, 'worktree', 'add', '-q', '-b', 'wt/arte', arte);
  // En el worktree hay una tarea más en curso, que el principal no tiene.
  await createJsonFilesStore(join(arte, 'compass'), { validators: V }).patch('tasks', 'm0-01', { status: 'doing' });
  await recordProject(arte);
  const page = await open();
  await page.waitForSelector('.hoy-group');
  assert.equal(await page.locator('article.proj[aria-label="Juego"]').count(), 1, 'una tarjeta para el repo');
  const card = page.locator('article.proj[aria-label="Juego"]');
  assert.match(await card.locator('.kind').textContent(), /main/);
  assert.match(await card.locator('.wts').textContent(), /1 worktree.*juego-arte wt\/arte.*2 en curso/s);
  assert.equal(await card.locator('.wts a', { hasText: 'Abrir' }).count(), 1);
  const juegoGroup = page.locator('.hoy-group', { hasText: 'Juego' });
  assert.equal(await page.locator('.hoy-group').count(), 1);
  assert.match(await juegoGroup.locator('summary').textContent(), /2 en curso/);
  // m1-04 está en curso en los dos: una fila, sin marca; m0-01 solo en el worktree.
  const rows = await juegoGroup.locator('.hoy-row').allTextContents();
  assert.equal(rows.length, 2);
  assert.ok(rows.some((r) => /^●1\.\d/.test(r) && !/⎇/.test(r)), rows.join(' | '));
  assert.ok(rows.some((r) => /⎇ juego-arte/.test(r)), rows.join(' | '));
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
  // Juego queda elegida por defecto; Sala limpia va al final (m30-04).
  assert.deepEqual(await page.$$eval('input[name="tpl"]', (is) => is.map((i) => [i.value, i.checked])), [['juego', true], ['personal', false], ['vacio', false], ['clean-room', false]]);
  assert.match(await page.textContent('label.tpl:has(input[value="clean-room"])'), /^Sala limpia/);
  await page.check('input[name="tpl"][value="personal"]');
  await page.click('#add button[type="submit"]');
  await page.waitForSelector('article.proj[aria-label="Vida dos"]');
  const nueva = join(process.env.SCOMPASS_DATA, 'Vida dos');
  assert.ok(existsSync(join(nueva, 'compass', 'lists', 'pendientes.json')));
  assert.ok(existsSync(join(nueva, '.git')), 'git init');
  assert.deepEqual(JSON.parse(await readFile(join(nueva, 'compass', 'config.json'), 'utf8')).views, ['lists', 'board']);
  // Otra carpeta, con el selector del escritorio (acá, un script que "elige" una).
  const { writeFile: wf } = await import('node:fs/promises');
  const otra = join(root, 'Juegos');
  const picker = join(root, 'picker.js');
  await wf(picker, `process.stdout.write(${JSON.stringify(otra)});`);
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

test('Actualizar todos (§38): con dos o más tableros desactualizados, un botón los pone al día a todos', async () => {
  for (const p of [vida, juego]) await writeFile(join(p, 'compass', 'AGENTS.md'), 'viejo\n');
  const page = await open();
  const btn = page.locator('#update-all');
  await btn.waitFor({ state: 'visible' });
  assert.equal(await btn.textContent(), 'Actualizar todos (2)');
  await btn.click();
  await btn.waitFor({ state: 'hidden' });
  for (const p of [vida, juego]) assert.notEqual(await readFile(join(p, 'compass', 'AGENTS.md'), 'utf8'), 'viejo\n');
  assert.equal(await page.locator('.outdated').count(), 0);
});

test('en el teléfono no hay scroll horizontal', async () => {
  const page = await open({ viewport: { width: 390, height: 844 } });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
});
