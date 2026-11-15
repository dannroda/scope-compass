// El Inicio en inglés (§45): con un navegador en inglés y sin idioma forzado, la página sale en inglés.
import './isolate.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { loadValidators } from '../src/schema.js';
import { createJsonFilesStore } from '../src/store/json-files.js';
import { listen } from '../src/server.js';
import { createHomeServer } from '../src/home.js';
import { recordProject } from '../src/projects.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'compass');
const V = loadValidators();
const pad = (n) => String(n).padStart(2, '0');
const d = new Date();
const TODAY = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
let browser;

before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

test('con el navegador en inglés, el Inicio sale en inglés (HTML fijo, Hoy, tarjetas y fechas)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'scompass-ui-home-en-'));
  const saved = { lang: process.env.SCOMPASS_LANG, reg: process.env.SCOMPASS_REGISTRY, cfg: process.env.SCOMPASS_CONFIG, data: process.env.SCOMPASS_DATA };
  delete process.env.SCOMPASS_LANG;
  process.env.SCOMPASS_REGISTRY = join(root, 'registro');
  process.env.SCOMPASS_CONFIG = join(root, 'config');
  process.env.SCOMPASS_DATA = join(root, 'datos');
  let home;
  try {
    const vida = join(root, 'vida');
    await cp(FIXTURE, join(vida, 'compass'), { recursive: true });
    const store = createJsonFilesStore(join(vida, 'compass'), { validators: V });
    await store.put('lists', 'pendientes', { title: 'Pendientes', order: 1, items: [
      { text: 'Pagar la luz', done: false, due: TODAY, repeat: { every: 'month', interval: 2 } }
    ] }, { ifMatch: null });
    await recordProject(vida);
    home = createHomeServer({ validators: V, pollMs: 100 });
    const { port } = await listen(home, 0);
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'en-US' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForSelector('.proj h3');
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
    assert.equal(await page.title(), 'Home · Scope Compass');
    assert.equal(await page.textContent('#hoy-t'), 'Today');
    assert.equal(await page.textContent('#sem-t'), 'This week');
    assert.equal(await page.textContent('#add-btn'), 'Add project');
    assert.equal(await page.getAttribute('#cap-text', 'placeholder'), 'Jot down…');
    assert.match(await page.textContent('#hoy'), /every 2 months/);
    assert.match(await page.textContent('#projects'), /Open board/);
    // La fecha de arriba con el formato del idioma (día de la semana en inglés).
    assert.match(await page.textContent('#date'), /Mon|Tue|Wed|Thu|Fri|Sat|Sun/);
    const body = await page.textContent('body');
    for (const es of ['Esta semana', 'Agregar proyecto', 'Abrir tablero', 'cada 2 meses', 'Proyectos']) assert.ok(!body.includes(es), `queda en castellano: ${es}`);
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally {
    await home?.close();
    for (const [k, v] of [['SCOMPASS_LANG', saved.lang], ['SCOMPASS_REGISTRY', saved.reg], ['SCOMPASS_CONFIG', saved.cfg], ['SCOMPASS_DATA', saved.data]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    await rm(root, { recursive: true, force: true, maxRetries: 10 });
  }
});
