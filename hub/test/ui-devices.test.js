// Vincular teléfono en el navegador (§49, m29-03): el Inicio de este equipo muestra el QR y la lista; el "teléfono"
// (otro contexto del navegador, por la IP de la red y en tamaño de teléfono) abre la dirección, queda vinculado y ve
// el botón Chat en un tablero; al quitarlo, deja de verlo.
import './isolate.js';
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { networkInterfaces, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { loadValidators } from '../src/schema.js';
import { listen } from '../src/server.js';
import { createHomeServer } from '../src/home.js';
import { recordProject } from '../src/projects.js';
import { devicesFile } from '../src/devices.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'compass');
const V = loadValidators();
const ip = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
let browser, root, home, port, proj, pageErrors, saved;

before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'scompass-ui-devices-'));
  // Config y registro propios: con npm test los archivos corren en paralelo con la misma config, y otro test podría
  // borrar devices.json o sumar proyectos a projects.json en el medio.
  saved = { reg: process.env.SCOMPASS_REGISTRY, cfg: process.env.SCOMPASS_CONFIG };
  process.env.SCOMPASS_REGISTRY = join(root, 'registro');
  process.env.SCOMPASS_CONFIG = join(root, 'config');
  proj = join(root, 'vida');
  await cp(FIXTURE, join(proj, 'compass'), { recursive: true });
  await recordProject(proj);
  await rm(devicesFile(), { force: true });
  home = createHomeServer({ validators: V, pollMs: 100, lan: () => [`http://${ip}:${port}/`], devices: { watchMs: 100 } });
  ({ port } = await listen(home, 0, { lan: true }));
  pageErrors = [];
});
afterEach(async () => {
  await home.close();
  for (const [k, v] of [['SCOMPASS_REGISTRY', saved.reg], ['SCOMPASS_CONFIG', saved.cfg]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  await rm(root, { recursive: true, force: true, maxRetries: 10 });
  assert.deepEqual(pageErrors, [], 'errores en la página');
});

async function page(base, opts = {}) {
  const ctx = await browser.newContext(opts);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => pageErrors.push(e.message));
  return p;
}
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
// El botón Chat del tablero, una vez que el tablero preguntó por el chat.
async function chatButton(p, url) {
  const asked = p.waitForResponse((r) => /\/api\/chats$/.test(r.url()));
  await p.goto(url);
  await asked;
  await p.waitForTimeout(100);
  return p.locator('#chat-btn').isVisible();
}

test('vincular un teléfono con el QR, usar el chat y quitarlo', { skip: !ip && 'sin IP de red' }, async () => {
  const pc = await page();
  await pc.goto(`http://127.0.0.1:${port}/`);
  await pc.waitForSelector('.proj h3');
  const key = (await (await fetch(`http://127.0.0.1:${port}/api/projects`)).json()).projects.find((p) => p.path === proj).key;
  const board = `http://${ip}:${port}/p/${key}/`;

  const phone = await page(null, PHONE);
  assert.equal(await chatButton(phone, board), false, 'sin vincular, el tablero no muestra Chat');
  // Desde la red, el Inicio no ofrece vincular.
  await phone.goto(`http://${ip}:${port}/`);
  await phone.waitForSelector('.proj h3');
  assert.equal(await phone.locator('#phone-btn').isVisible(), false);

  await pc.click('#phone-btn');
  await pc.waitForSelector('dialog.phone .phone-qr svg');
  assert.equal(await pc.locator('dialog.phone .phone-qr svg').getAttribute('aria-label'), 'Código QR con la dirección para vincular el teléfono');
  const link = await pc.locator('dialog.phone .phone-url input').inputValue();
  assert.match(link, new RegExp(`^http://${ip.replace(/\./g, '\\.')}:${port}/vincular#[\\w-]{16}$`));
  assert.match(await pc.locator('dialog.phone').innerText(), /Ninguno todavía/);

  await phone.goto(link);
  assert.equal(new URL(phone.url()).hash, '', 'el código sale de la dirección');
  assert.equal(await phone.locator('#pair-name').inputValue(), 'Teléfono');
  await phone.fill('#pair-name', 'Mi teléfono');
  await phone.click('#pair button[type=submit]');
  await phone.waitForSelector('.pair-msg.ok');
  const [cookie] = (await phone.context().cookies()).filter((c) => c.name === 'scompass_device');
  assert.deepEqual([cookie.httpOnly, cookie.sameSite], [true, 'Strict']);

  // El Inicio se entera solo (evento devices) y lista el dispositivo.
  await pc.waitForSelector('dialog.phone .phone-ok');
  assert.match(await pc.locator('dialog.phone ul.devices').innerText(), /Mi teléfono/);

  assert.equal(await chatButton(phone, board), true, 'vinculado, el tablero muestra Chat');
  // El mismo código no sirve dos veces.
  const again = await page(null, PHONE);
  await again.goto(link);
  await again.click('#pair button[type=submit]');
  await again.waitForSelector('.pair-msg.bad');

  await pc.click('dialog.phone ul.devices button');
  await pc.waitForSelector('dialog.phone >> text=Ninguno todavía.');
  assert.equal(await chatButton(phone, board), false, 'quitado, el tablero ya no muestra Chat');
});

test('sin código en la dirección, la página lo dice y no muestra el formulario', { skip: !ip && 'sin IP de red' }, async () => {
  const phone = await page(null, PHONE);
  await phone.goto(`http://${ip}:${port}/vincular`);
  await phone.waitForSelector('.pair-msg.bad');
  assert.equal(await phone.locator('#pair').isVisible(), false);
});

test('sin --lan, el diálogo dice que hace falta y no muestra QR', async () => {
  await home.close();
  home = createHomeServer({ validators: V, pollMs: 100, lan: () => null, devices: { watchMs: 0 } });
  ({ port } = await listen(home, 0));
  const pc = await page();
  await pc.goto(`http://127.0.0.1:${port}/`);
  await pc.waitForSelector('.proj h3');
  await pc.click('#phone-btn');
  await pc.waitForSelector('dialog.phone .phone-err');
  assert.match(await pc.locator('dialog.phone .phone-err').innerText(), /--lan/);
  assert.equal(await pc.locator('dialog.phone .phone-qr').count(), 0);
});
