// Chat en la web (M25, §32, 25.7): el panel con la conversación en vivo, las herramientas, Cortar, la lista de
// conversaciones y la tarea abierta como contexto, con el claude falso de fake-claude.js. Fuera de 127.0.0.1 no aparece.
import './isolate.js';
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { networkInterfaces, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { loadValidators } from '../src/schema.js';
import { createJsonFilesStore } from '../src/store/json-files.js';
import { createServer, listen } from '../src/server.js';
import { chatDir } from '../src/chat.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const V = loadValidators();
let browser, root, dir, app, port, env, pageErrors, contexts;

before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'scompass-ui-chat-'));
  dir = join(root, 'p');
  await cp(join(HERE, 'fixtures', 'compass'), join(dir, 'compass'), { recursive: true });
  env = { ...process.env, SCOMPASS_CLAUDE: join(HERE, 'fake-claude.js'), FAKE_CLAUDE_STATE: join(root, 'sessions') };
  pageErrors = [];
  contexts = [];
});
afterEach(async () => {
  for (const c of contexts) await c.close();
  await app?.close();
  app = null;
  await rm(chatDir(dir), { recursive: true, force: true });
  await rm(root, { recursive: true, force: true, maxRetries: 10 });
  assert.deepEqual(pageErrors, [], 'errores en la página');
});

async function serve(opts = {}) {
  app = createServer({ projectDir: dir, store: createJsonFilesStore(join(dir, 'compass'), { validators: V }), validators: V, watch: true, chatEnv: env });
  ({ port } = await listen(app, 0, opts));
}
async function open(host = '127.0.0.1', hash = '', context = null) {
  if (!context) {
    context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    contexts.push(context);
  }
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto(`http://${host}:${port}/${hash}`);
  await page.waitForSelector('.card');
  return page;
}
async function send(page, text) {
  await page.fill('#chat-input', text);
  await page.press('#chat-input', 'Enter');
}
const lanIp = () => Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;

test('conversar: el panel se abre, la respuesta llega en vivo, queda en la lista y vuelve al recargar', async () => {
  await serve();
  const page = await open();
  await page.click('#chat-btn');
  assert.equal(await page.isVisible('#chat'), true);
  assert.match(await page.textContent('#chat .chat-empty'), /no edita ni corre comandos/);
  await send(page, 'hola');
  await page.waitForSelector('#chat .msg.bot .msg-text:text-is("eco: hola")');
  assert.equal(await page.textContent('#chat .msg.user .msg-text'), 'hola');
  assert.equal(await page.inputValue('#chat-input'), '');
  assert.equal(await page.textContent('#chat .chat-head h2'), 'hola');
  // Herramientas: plegadas, con su nombre y si anduvieron.
  await send(page, 'herramienta');
  await page.waitForSelector('#chat .msg.bot .msg-text:text-is("listo")');
  const tools = '#chat .msg.bot:last-child .chat-tools';
  assert.equal(await page.textContent(`${tools} summary`), '1 herramienta');
  assert.equal(await page.$eval(tools, (d) => d.open), false);
  assert.match(await page.textContent(`${tools} li`), /✓ show_task m1-01/);
  // Panel y conversación se recuerdan.
  await page.reload();
  await page.waitForSelector('#chat .msg.bot .msg-text:text-is("listo")');
  assert.equal(await page.$$eval('#chat .msg', (els) => els.length), 4);
  await page.click('#chat .chat-head button:has-text("Conversaciones")');
  assert.equal(await page.$$eval('#chat .chat-list li', (els) => els.length), 1);
  assert.equal(await page.textContent('#chat .chat-list .ctitle'), 'hola');
  // Nueva empieza otra; la lista tiene las dos.
  await page.click('#chat .chat-head button:has-text("Nueva")');
  await send(page, 'otra');
  await page.waitForSelector('#chat .msg.bot .msg-text:text-is("eco: otra")');
  await page.click('#chat .chat-head button:has-text("Conversaciones")');
  assert.deepEqual(await page.$$eval('#chat .chat-list .ctitle', (els) => els.map((e) => e.textContent)), ['otra', 'hola']);
  await page.click('#chat .chat-list .pick:has-text("hola")');
  await page.waitForSelector('#chat .msg.bot .msg-text:text-is("listo")');
  // Borrar pide confirmación.
  await page.click('#chat .chat-head button:has-text("Conversaciones")');
  await page.click('#chat .chat-list li:has-text("otra") .rm');
  await page.click('#chat .chat-list li:has-text("otra") button:has-text("¿Borrar?")');
  await page.waitForFunction(() => document.querySelectorAll('#chat .chat-list li').length === 1);
  await page.click('#chat .chat-head .close');
  assert.equal(await page.isVisible('#chat'), false);
});

test('Cortar durante un turno; otra pestaña ve la misma conversación en vivo', async () => {
  await serve();
  const page = await open();
  await page.click('#chat-btn');
  await send(page, 'hola');
  await page.waitForSelector('#chat .msg.bot .msg-text:text-is("eco: hola")');
  // Otra pestaña del mismo navegador: recuerda el panel abierto y la conversación.
  const other = await open('127.0.0.1', '', page.context());
  await other.waitForSelector('#chat .msg.bot .msg-text:text-is("eco: hola")');
  await send(page, 'lento');
  await page.waitForSelector('#chat .chat-actions button:has-text("Cortar")');
  await page.waitForFunction(() => document.querySelector('#chat .msg.live .msg-text')?.textContent.length > 4);
  await other.waitForFunction(() => document.querySelector('#chat .msg.live .msg-text')?.textContent.length > 4);
  assert.equal(await other.$$eval('#chat .msg.user .msg-text', (els) => els.at(-1).textContent), 'lento');
  await page.click('#chat .chat-actions button:has-text("Cortar")');
  await page.waitForSelector('#chat .msg.bot:last-child .msg-note:text-is("Cortado")');
  await other.waitForSelector('#chat .msg.bot:last-child .msg-note:text-is("Cortado")');
  await page.waitForSelector('#chat .chat-actions button:has-text("Enviar")');
});

test('con una tarea abierta, el mensaje la lleva; se puede sacar', async () => {
  await serve();
  const page = await open('127.0.0.1', '#task/m1-01');
  await page.waitForSelector('#detail:not([hidden])');
  await page.click('#chat-btn');
  assert.match(await page.textContent('#chat .chat-attach'), /Con la tarea/);
  assert.equal(await page.isVisible('#detail'), true, 'abrir el chat no cierra la tarea');
  await send(page, 'qué falta');
  await page.waitForSelector('#chat .msg.bot:not(.live) .msg-text');
  assert.match(await page.textContent('#chat .msg.bot .msg-text'), /Tarea abierta: .*compass:\/\/task\/m1-01/);
  assert.match(await page.textContent('#chat .msg.user .msg-task'), /con la tarea/);
  assert.equal(await page.textContent('#chat .msg.user .msg-text'), 'qué falta');
  await page.click('#chat .chat-attach .rm');
  assert.equal(await page.isVisible('#chat .chat-attach'), false);
  await send(page, 'sin tarea');
  await page.waitForSelector('#chat .msg.bot .msg-text:text-is("eco: sin tarea")');
  // Escape en el chat no cierra la tarea.
  await page.press('#chat-input', 'Escape');
  assert.equal(await page.isVisible('#detail'), true);
});

test('sin claude: el panel dice cómo instalarlo', async () => {
  env.SCOMPASS_CLAUDE = join(root, 'no-está');
  await serve();
  const page = await open();
  await page.click('#chat-btn');
  assert.match(await page.textContent('#chat .chat-empty'), /npm i -g @anthropic-ai\/claude-code/);
  assert.equal(await page.isDisabled('#chat-input'), true);
});

test('desde la red (--lan) no hay chat', { skip: !lanIp() && 'sin una IP de red' }, async () => {
  await serve({ lan: true });
  const page = await open(lanIp());
  await page.waitForTimeout(300);
  assert.equal(await page.isVisible('#chat-btn'), false);
  assert.equal(await page.isVisible('#chat'), false);
});

test('una pregunta respondida con su sesión: Seguir en el chat la retoma con la respuesta', async () => {
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(env.FAKE_CLAUDE_STATE, { recursive: true });
  await writeFile(join(env.FAKE_CLAUDE_STATE, '6f0c4c1e-1111-4222-8333-444455556666'), '');
  await createJsonFilesStore(join(dir, 'compass'), { validators: V }).patch('tasks', 'm1-04', { decisions: [
    { text: '¿A o B?', asked: true, reply: 'A', session: '6f0c4c1e-1111-4222-8333-444455556666' }, { text: '¿C?', asked: true, reply: 'sí' }] });
  await serve();
  const page = await open('127.0.0.1', '#task/m1-04');
  await page.waitForSelector('.decision');
  assert.equal(await page.$$eval('.decision button', (bs) => bs.filter((b) => b.textContent === 'Seguir en el chat').length), 1);
  await page.click('.decision:has-text("¿A o B?") button:has-text("Seguir en el chat")');
  await page.waitForSelector('#chat .msg.bot:not(.live) .msg-text');
  assert.match(await page.textContent('#chat .msg.user .msg-text'), /^Respuesta a tu pregunta en la tarea .*«¿A o B\?»\n\nA$/);
  assert.match(await page.textContent('#chat .msg.bot .msg-text'), /^eco: Respuesta a tu pregunta/);
});
