// Criterios de aceptación de M31 (spec §34, el Inicio para la vida), uno por test: Hoy en secciones, captura rápida,
// Esta semana, áreas, estilo de los enlaces y repeat cada N.
import './isolate.js';
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { loadValidators } from '../src/schema.js';
import { createJsonFilesStore } from '../src/store/json-files.js';
import { listen } from '../src/server.js';
import { createHomeServer } from '../src/home.js';
import { recordProject } from '../src/projects.js';
import { run } from '../src/cli.js';

const V = loadValidators();
const pad = (n) => String(n).padStart(2, '0');
const day = (k) => { const d = new Date(); d.setDate(d.getDate() + k); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const quiet = { out: { write() {} }, err: { write() {} } };
let browser, root, saved, home, url, vida, juego, pageErrors;

before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

// Vida (plantilla personal) con listas con fechas y repeticiones y tareas por área; un juego con 7 preguntas abiertas.
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'scompass-m31-'));
  saved = Object.fromEntries(['SCOMPASS_REGISTRY', 'SCOMPASS_CONFIG', 'SCOMPASS_DATA'].map((k) => [k, process.env[k]]));
  process.env.SCOMPASS_REGISTRY = join(root, 'registro');
  process.env.SCOMPASS_CONFIG = join(root, 'config');
  process.env.SCOMPASS_DATA = join(root, 'datos');
  vida = join(root, 'Vida');
  juego = join(root, 'Juego');
  await run(['--dir', vida, '--direct', 'init', '--template', 'personal', '--project=Vida'], quiet);
  await run(['--dir', juego, '--direct', 'init', '--template', 'juego', '--project=Project Epiphany'], quiet);
  const sv = createJsonFilesStore(join(vida, 'compass'), { validators: V });
  await sv.put('lists', 'rutina', { title: 'Rutina', order: 0, items: [
    { text: 'Meditar', done: false, due: day(-1), repeat: { every: 'day' } },
    { text: 'Regar las plantas', done: false, due: day(0), repeat: { every: 'day', interval: 2 } },
    { text: 'Gimnasio', done: false, due: day(1) + 'T19:00', repeat: { every: 'day', interval: 2 } }] }, { ifMatch: null });
  await sv.put('lists', 'quiero-hacer', { title: 'Quiero hacer', order: 1, items: [
    { text: 'Ir al museo', done: false, due: day(3) }, { text: 'Renovar el DNI', done: false, due: day(8) }] }, { ifMatch: null });
  const m = (await sv.list('milestones')).items[0].id;
  const task = (title, extra) => sv.create('tasks', { milestone: m, title, status: 'todo', checklist: [], test: '', notes: '', refs: [], ...extra });
  await task('Informe trimestral', { tags: ['trabajo'], due: day(0) });
  await task('Mudar el estudio', { tags: ['casa'], status: 'doing' });
  await task('Curso de inglés', { tags: ['aprender'], due: day(5) });
  const sj = createJsonFilesStore(join(juego, 'compass'), { validators: V });
  const mj = (await sj.list('milestones')).items[0].id;
  await sj.create('tasks', { milestone: mj, code: '0.1', title: 'Movimiento', status: 'doing', checklist: [], test: '', notes: '', refs: [],
    decisions: Array.from({ length: 7 }, (_, i) => ({ text: `¿Pregunta ${i + 1}?`, asked: true, at: `2026-11-01T1${i}:00:00Z` })) });
  await recordProject(vida);
  await recordProject(juego);
  home = createHomeServer({ validators: V, pollMs: 100 });
  url = `http://127.0.0.1:${(await listen(home, 0)).port}/`;
  pageErrors = [];
});
afterEach(async () => {
  await home.close();
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(root, { recursive: true, force: true, maxRetries: 10 });
  assert.deepEqual(pageErrors, [], 'errores en la página');
});

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
async function open(opts = {}, ctx = null) {
  const page = await (ctx ?? await browser.newContext({ viewport: { width: 1440, height: 900 }, ...opts })).newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(url);
  await page.waitForSelector('.proj h3');
  await page.waitForSelector('#hoy .hoy-row');
  return page;
}
const listOf = async (id) => JSON.parse(await readFile(join(vida, 'compass', 'lists', `${id}.json`), 'utf8')).items;
const texts = (page, sel) => page.$$eval(sel, (els) => els.map((e) => e.textContent));

test('31.1 Hoy: lo mío se ve sin scrollear en 1440×900 y en 390×844; las 7 preguntas, plegadas y recordadas', async () => {
  for (const opts of [{}, PHONE]) {
    const page = await open(opts);
    const bottoms = await page.$$eval('#hoy > .hoy-row, #hoy > .hoy-group:not(.questions)', (els) => els.map((e) => e.getBoundingClientRect().bottom));
    assert.ok(bottoms.length >= 4, 'vencido, de hoy y en curso');
    const h = opts.viewport?.height ?? 900;
    assert.ok(Math.max(...bottoms) <= h, `${opts.viewport?.width ?? 1440}: lo mío termina en ${Math.max(...bottoms)} > ${h}`);
    assert.match(await page.textContent('#hoy > details.questions > summary'), /Esperan tu respuesta \(7\)/);
    assert.equal(await page.getAttribute('#hoy > details.questions', 'open'), null);
    await page.context().close();
  }
  const page = await open();
  await page.click('#hoy > details.questions > summary');
  await page.reload();
  await page.waitForSelector('#hoy > details.questions[open]');
  assert.equal((await texts(page, '#hoy .hoy-row.question .what')).length, 7);
});

test('31.2 Anotar: va por defecto a Vida › Quiero hacer, con fecha; recuerda la última lista', async () => {
  const page = await open();
  assert.equal(await page.$eval('#cap-list', (s) => s.selectedOptions[0].textContent), 'Quiero hacer');
  await page.fill('#cap-text', 'Llamar al dentista');
  await page.fill('#cap-due', day(2));
  await page.press('#cap-text', 'Enter');
  await page.waitForFunction(() => document.getElementById('cap-text').value === '');
  assert.deepEqual((await listOf('quiero-hacer')).at(-1), { text: 'Llamar al dentista', done: false, due: day(2), created_at: (await listOf('quiero-hacer')).at(-1).created_at });
  await page.waitForFunction(() => document.getElementById('semana').textContent.includes('Llamar al dentista'));
  // Otra lista: se recuerda al recargar.
  await page.selectOption('#cap-list', { label: 'Rutina' });
  await page.fill('#cap-text', 'Estirar');
  await page.click('#capture button[type="submit"]');
  await page.waitForFunction(() => document.getElementById('cap-text').value === '');
  assert.equal((await listOf('rutina')).at(-1).text, 'Estirar');
  await page.reload();
  await page.waitForSelector('#capture:not([hidden])');
  assert.equal(await page.$eval('#cap-list', (s) => s.selectedOptions[0].textContent), 'Rutina');
  // Agregar proyecto ya no es el botón principal.
  assert.equal(await page.getAttribute('#add-btn', 'class'), 'btn small add-btn');
});

test('31.3 Esta semana: lo que vence en los próximos 7 días, de todos los proyectos, por día', async () => {
  const page = await open();
  const days = await texts(page, '#semana .sem-day > h3');
  assert.equal(days.length, 3, days.join(' | '));
  assert.match(days[0], /^mañana · /);
  const rows = await texts(page, '#semana .hoy-row .what');
  assert.deepEqual(rows, ['Gimnasio', 'Ir al museo', 'Curso de inglés']);
  assert.ok(!(await page.textContent('#semana')).includes('Renovar el DNI'), 'en 8 días no entra');
  // Tildar desde la franja: lo que se repite cada 2 días avanza dos.
  await page.getByLabel('Gimnasio').click();
  await page.waitForFunction(() => /↻ la próxima vez/.test(document.getElementById('toast').textContent));
  assert.equal((await listOf('rutina'))[2].due, day(3) + 'T19:00');
});

test('31.4 Áreas: el chip filtra Hoy y Esta semana, y se recuerda en el navegador, no en compass/', async () => {
  const before = await readFile(join(vida, 'compass', 'config.json'), 'utf8');
  const page = await open();
  assert.deepEqual(await texts(page, '#areas .chip'), ['Todas', 'aprender', 'casa', 'trabajo']);
  await page.click('#areas .chip:has-text("casa")');
  await page.waitForFunction(() => document.querySelector('#areas .chip[aria-pressed="true"]').textContent === 'casa');
  assert.deepEqual(await texts(page, '#hoy .hoy-row .what'), ['Mudar el estudio']);
  assert.match(await page.textContent('#semana'), /Nada de casa vence/);
  await page.reload();
  await page.waitForSelector('#areas .chip[aria-pressed="true"]:has-text("casa")');
  await page.click('#areas .chip:has-text("aprender")');
  await page.waitForFunction(() => document.querySelector('#areas .chip[aria-pressed="true"]').textContent === 'aprender');
  assert.deepEqual(await texts(page, '#semana .hoy-row .what'), ['Curso de inglés']);
  await page.click('#areas .chip:has-text("Todas")');
  await page.waitForFunction(() => document.querySelectorAll('#semana .hoy-row').length === 3);
  assert.equal(await readFile(join(vida, 'compass', 'config.json'), 'utf8'), before);
});

test('31.5 Estilo: los enlaces de Hoy sin subrayado salvo en hover; dorado solo lo vencido o de hoy', async () => {
  const page = await open();
  const style = (sel) => page.$eval(sel, (e) => { const s = getComputedStyle(e); return { line: s.textDecorationLine, color: s.color }; });
  const accent = await page.evaluate(() => { const e = document.createElement('i'); e.style.color = 'var(--accent)'; document.body.append(e); const c = getComputedStyle(e).color; e.remove(); return c; });
  const urgent = await style('#hoy > .hoy-row.urgent a');
  assert.deepEqual(urgent, { line: 'none', color: accent }, 'Informe trimestral vence hoy');
  const calm = await style('#hoy .hoy-group:not(.questions) .hoy-row a');
  assert.equal(calm.line, 'none');
  assert.notEqual(calm.color, accent);
  await page.hover('#hoy .hoy-group:not(.questions) .hoy-row a');
  assert.equal((await style('#hoy .hoy-group:not(.questions) .hoy-row a')).line, 'underline');
});

test('31.6 repeat cada N: tildar desde Hoy avanza el intervalo', async () => {
  const page = await open();
  await page.getByLabel('Regar las plantas').click();
  await page.waitForFunction(() => /↻ la próxima vez/.test(document.getElementById('toast').textContent));
  assert.deepEqual((await listOf('rutina'))[1], { text: 'Regar las plantas', done: false, due: day(2), repeat: { every: 'day', interval: 2 } });
});
