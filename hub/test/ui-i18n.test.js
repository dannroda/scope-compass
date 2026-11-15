// El tablero en inglés (§45): sigue al navegador y Ajustes › Idioma lo cambia para todo el equipo.
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
import { createServer, listen } from '../src/server.js';
import { setChosenLang } from '../src/i18n.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'compass');
const V = loadValidators();
let browser;

before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

test('con el navegador en inglés el tablero sale en inglés, y elegir Español en Ajustes lo cambia', async () => {
  const saved = process.env.SCOMPASS_LANG;
  delete process.env.SCOMPASS_LANG;
  const dir = await mkdtemp(join(tmpdir(), 'scompass-ui-i18n-'));
  await cp(FIXTURE, join(dir, 'compass'), { recursive: true });
  const app = createServer({ projectDir: dir, store: createJsonFilesStore(join(dir, 'compass'), { validators: V }), validators: V });
  try {
    const { port } = await listen(app, 0);
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'en-US' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForSelector('.card');
    // Una columna (de app.js) y un botón fijo de index.html.
    assert.ok(await page.locator('.col[aria-label="In progress"]').count());
    assert.equal((await page.textContent('#new-btn')).trim(), 'New task');
    assert.equal(await page.getAttribute('html', 'lang'), 'en');

    await page.click('#settings-btn');
    await page.waitForSelector('#set-lang:not([disabled])');
    await Promise.all([page.waitForEvent('load'), page.selectOption('#set-lang', 'es')]);
    await page.waitForSelector('.card');
    assert.ok(await page.locator('.col[aria-label="En curso"]').count());
    assert.equal((await page.textContent('#new-btn')).trim(), 'Nueva tarea');
    assert.deepEqual(errors, []);
    await ctx.close();
  } finally {
    await app.close();
    await setChosenLang(null);
    process.env.SCOMPASS_LANG = saved;
    await rm(dir, { recursive: true, force: true, maxRetries: 10 });
  }
});
