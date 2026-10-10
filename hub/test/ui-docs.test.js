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
  await rm(dir, { recursive: true, force: true, maxRetries: 10 });
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

test('12.1: referencia al documento entero desde el buscador, [[gdd]] en notas y backlinks del documento', async () => {
  await setTask('m1-06', { notes: 'todo el [[gdd]], no `[[gdd]]`' });
  const page = await open();
  await page.click('.chip:has-text("M1")');
  await page.click('.card[data-id="m1-07"]');
  await page.click('.refs-head button:has-text("Agregar")');
  await page.fill('#d-refq', 'gdd');
  assert.match(await page.textContent('.ref-matches li:first-child'), /Juego.*gdd\.md · documento entero/);
  await page.click('.ref-matches li:first-child button');
  await page.waitForSelector('.ref.whole');
  assert.deepEqual((await task('m1-07')).refs, [{ doc: 'gdd.md' }]);
  assert.equal(await page.getAttribute('.ref.whole a.ref-toggle', 'href'), '#docs/gdd');
  assert.equal(await page.locator('.card[data-id="m1-07"] .refmark.bad').count(), 0, 'no es una referencia rota');
  // Ya referenciado, el documento no vuelve a ofrecerse.
  await page.click('.refs-head button:has-text("Agregar")');
  await page.fill('#d-refq', 'gdd');
  assert.doesNotMatch(await page.textContent('.ref-matches'), /documento entero/);
  await page.click('h1'); // fuera del buscador
  await page.keyboard.press('Escape');
  await page.waitForSelector('#detail[hidden]', { state: 'attached' });
  await page.click('.card[data-id="m1-06"]');
  await page.waitForSelector('.doclinks a.doclink');
  assert.equal(await page.textContent('.doclinks a.doclink'), 'Juego', 'el enlace muestra el título del documento');
  assert.equal(await page.getAttribute('.doclinks a.doclink', 'href'), '#docs/gdd');
  await page.goto(url + '#docs/gdd');
  await page.waitForSelector('.backlinks .bl-task');
  assert.match(await page.textContent('.backlinks .label'), /Referencian el documento · 2 tareas/);
  assert.equal(await page.textContent('.copy-link'), 'Copiar enlace al documento');
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
  // El título es un solo bloque (con `código` adentro no se parte en columnas).
  assert.deepEqual(await page.$$eval('.backlinks .bl-task', (as) => as.map((a) => a.querySelectorAll(':scope > .t').length)), bl.map(() => 1));
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

test('tablas del documento: una columna corta no se aplasta ni parte sus palabras al lado de una de texto largo', async () => {
  const long = 'Lista de partidas guardadas con fecha, duración y nivel; al elegir una se ve un resumen y se puede cargar o borrar. '.repeat(4);
  await writeFile(join(dir, 'gdd.md'), GDD + `\n## UI\n<!-- id: ui -->\n\n| Pantalla | Contenido |\n|---|---|\n| Selección | ${long} |\n`);
  const page = await open('#docs/gdd/ui');
  // Se espera la condición (y no se mide una vez): el doc_changed de la escritura de arriba puede rearmar el artículo.
  const oneLine = await page.waitForFunction(() => {
    const td = document.querySelector('article.doc-body tbody td');
    if (!td) return false;
    const r = document.createRange();
    r.selectNodeContents(td);
    return r.getClientRects().length === 1;
  }, null, { timeout: 5000 }).then(() => true, () => false);
  assert.ok(oneLine, '"Selección" entra en una línea');
  await page.close();
});

// Las ligaduras de JetBrains Mono conservan el ancho de cada carácter, así que se mira el estilo, no el ancho.
test('13.1: el código se ve sin ligaduras (<!-- no se vuelve flecha ni != un ≠)', async () => {
  await writeFile(join(dir, 'gdd.md'), GDD + '\n## Código\n<!-- id: codigo -->\n\n`!=`\n\n```\n<!-- id: x -->\n```\n');
  const page = await open('#docs/gdd/codigo');
  const lig = await page.waitForFunction(() => {
    const els = ['p code', 'pre', 'pre code'].map((q) => document.querySelector('article.doc-body ' + q));
    return els.every(Boolean) && els.map((e) => getComputedStyle(e).fontVariantLigatures);
  }, null, { timeout: 5000 }).then((x) => x.jsonValue());
  assert.deepEqual(lig, ['none', 'none', 'none']);
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
  assert.equal(await page.getAttribute('.checklist .step-text a.doclink', 'href'), '#docs/gdd/camara');
  assert.equal(await page.textContent('.checklist .step-text a.doclink'), 'Cámara');
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

// --- Vínculos entre tareas ---

test('vínculos: "bloqueada por" con el buscador, marca en la tarjeta, se ve desde la otra tarea y se quita', async () => {
  await setTask('m1-03', { status: 'todo' });
  await setTask('m1-05', { status: 'doing' });
  const page = await open();
  await page.click('.chip:has-text("M1")');
  await page.click('.card[data-id="m1-03"]');
  assert.match(await page.textContent('.links'), /Sin vínculos/);
  await page.click('.links .refs-head button:has-text("Agregar")');
  await page.fill('#d-linkq', 'm1-05');
  await page.click('.links .ref-matches button');
  await page.waitForSelector('.link-row.blocking[data-kind="blockedBy"][data-task="m1-05"]');
  // Se guarda en la tarea que bloquea; la bloqueada no cambia.
  assert.deepEqual((await task('m1-05')).links, [{ task: 'm1-03', type: 'blocks' }]);
  assert.equal((await task('m1-03')).links, undefined);
  assert.equal(await page.textContent('.card[data-id="m1-03"] .blockmark'), 'Bloqueada');
  // Desde la otra tarea se ve el inverso; el contrario (ciclo) no se puede agregar: la tarea ya no se ofrece.
  await page.click('.link-row .link-task');
  await page.waitForSelector('.link-row[data-kind="blocks"][data-task="m1-03"]');
  assert.equal(await page.$('.card[data-id="m1-05"] .blockmark'), null);
  // Terminada la que bloquea, la otra deja de estar bloqueada.
  await page.click('.seg:not(.small) button:has-text("Hecho")');
  await page.waitForFunction(() => !document.querySelector('.card[data-id="m1-03"] .blockmark'), null, { timeout: 2000 });
  await page.click('.link-row .rm');
  await page.waitForFunction(() => !document.querySelector('.link-row'), null, { timeout: 2000 });
  assert.equal((await task('m1-05')).links, undefined);
  assert.deepEqual(pageErrors, []);
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

test('pasos: ▸ despliega el detalle; ✎ edita texto y detalle (vacío lo quita); un [[enlace]] en el detalle cuenta', async () => {
  await setTask('m1-06', { checklist: [{ text: 'Acciones de juego', done: false, detail: 'interact (B / E), ver [[gdd#camara]]' }, { text: 'Sin detalle', done: false }] });
  const page = await open();
  await page.click('.chip:has-text("M1")');
  await page.click('.card[data-id="m1-06"]');
  assert.equal(await page.locator('.checklist li').nth(1).locator('.step-toggle').count(), 0);
  assert.equal(await page.locator('.step-detail').count(), 0);
  // Clickear el texto despliega el detalle y no marca el paso.
  await page.click('.checklist li >> nth=0 >> .step-text');
  assert.match(await page.textContent('.step-detail'), /interact \(B \/ E\), ver Cámara/);
  assert.equal(await page.isChecked('.checklist li >> nth=0 >> input[type=checkbox]'), false);
  assert.equal((await task('m1-06')).checklist[0].done, false);
  await page.click('.step-toggle');
  assert.equal(await page.locator('.step-detail').count(), 0);
  await page.click('.step-toggle');
  assert.match(await page.textContent('.step-detail'), /interact \(B \/ E\), ver Cámara/);
  // Editar: texto nuevo y detalle nuevo.
  await page.click('.checklist li >> nth=0 >> button[aria-label="Editar paso"]');
  await page.fill('#d-step-text', 'Acciones');
  await page.fill('#d-step-detail', 'solo interact');
  await page.click('.step-edit-actions button:has-text("Guardar")');
  await page.waitForFunction(() => !document.getElementById('d-step-text'));
  assert.deepEqual((await task('m1-06')).checklist[0], { text: 'Acciones', done: false, detail: 'solo interact' });
  // Detalle vacío lo quita; Escape cancela sin guardar.
  await page.click('.checklist li >> nth=0 >> button[aria-label="Editar paso"]');
  await page.fill('#d-step-detail', '');
  await page.press('#d-step-text', 'Enter');
  await page.waitForFunction(() => !document.getElementById('d-step-text'));
  assert.deepEqual((await task('m1-06')).checklist[0], { text: 'Acciones', done: false });
  await page.click('.checklist li >> nth=0 >> button[aria-label="Editar paso"]');
  await page.fill('#d-step-text', 'No se guarda');
  await page.press('#d-step-text', 'Escape');
  assert.equal((await task('m1-06')).checklist[0].text, 'Acciones');
  await page.close();
});

test('refs check cuenta los enlaces del detalle de un paso', async () => {
  await setTask('m1-06', { checklist: [{ text: 'x', done: false, detail: 'ver [[gdd#no-existe]]' }] });
  const { run } = await import('../src/cli.js');
  let out = '';
  assert.equal(await run(['--dir', dir, '--direct', 'refs', 'check', '--json'], { out: { write: (s) => { out += s; } }, err: { write() {} } }), 1);
  assert.deepEqual(JSON.parse(out).broken.filter((b) => b.task === 'm1-06').map((b) => [b.ref, b.where]), [['gdd#no-existe', 'paso 1 (detalle)']]);
});

// --- Biblioteca (M12): árbol por carpetas, búsqueda, ficha del documento, alta y baja ---
async function library() {
  const { mkdir } = await import('node:fs/promises');
  const files = {
    'docs/enemigos.md': '# Enemigos\n<!-- id: enemigos -->\n\n## Slime\n<!-- id: slime -->\n\nEl slime se divide al recibir un golpe.\n\n## Murciélago\n<!-- id: murcielago -->\n\nVuela en círculos.\n',
    'docs/arte/paleta.md': '# Paleta\n<!-- id: paleta -->\n\nColores cálidos.\n',
    'docs/arte/sonido.md': '# Sonido\n<!-- id: sonido -->\n\nEl slime hace blop.\n',
    'docs/notas/ideas.md': '# Ideas\n<!-- id: ideas -->\n',
    'docs/tareas.md': '# Export\n'
  };
  for (const [f, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, f)), { recursive: true });
    await writeFile(join(dir, f), text);
  }
  const cfg = join(dir, 'compass', 'config.json');
  await writeFile(cfg, canonical({ ...JSON.parse(await readFile(cfg, 'utf8')), docs: [{ alias: 'gdd', path: 'gdd.md' }, { alias: 'docs', path: 'docs/**/*.md' }] }));
  await setTask('m1-06', { refs: [{ doc: 'docs/enemigos.md' }], notes: 'el [[docs/enemigos#slime]] se divide' });
}

test('12.5: la biblioteca agrupa los documentos por carpeta con sus tareas; navegar el árbol y la ficha', async () => {
  await library();
  const page = await open('#docs/docs%2Fenemigos');
  await page.waitForSelector('.doc-tree .tree-doc');
  const tree = await page.$$eval('.doc-tree details', (ds) => ds.map((d) => [d.querySelector('summary').textContent, [...d.querySelectorAll('.tree-doc')].map((a) => a.querySelector('.t').textContent + (a.querySelector('.n') ? ' ' + a.querySelector('.n').textContent : ''))]));
  // El export (docs/tareas.md) no es un documento; enemigos.md lo citan m1-06 (ref y enlace).
  assert.deepEqual(tree, [['Raíz del proyecto', ['gdd.md 3']], ['docs/', ['enemigos.md 1']], ['docs/arte/', ['paleta.md', 'sonido.md']], ['docs/notas/', ['ideas.md']]]);
  assert.equal(await page.getAttribute('.tree-doc[aria-current="page"]', 'href'), '#docs/docs%2Fenemigos');
  // Ficha: título, ruta, de dónde sale, tareas y secciones sin tareas.
  assert.match(await page.textContent('.doc-card'), /Enemigos.*docs\/enemigos\.md.*Incluido por el patrón docs\/\*\*\/\*\.md/);
  assert.equal(await page.locator('.doc-card #doc-rm').count(), 0, 'un documento de un patrón no se quita solo');
  await page.waitForSelector('.backlinks .bl-task');
  assert.match(await page.textContent('.backlinks .label'), /Referencian el documento · 1 tarea/);
  assert.equal(await page.textContent('.unplanned summary'), 'Secciones sin tareas · 2 de 3');
  // Navegar por el árbol; las carpetas se pliegan.
  await page.click('.tree-doc:has-text("paleta.md")');
  await page.waitForSelector('article.doc-body[data-ready="1"][data-alias="docs/arte/paleta"]');
  assert.match(await page.textContent('article.doc-body'), /Colores cálidos/);
  await page.click('.doc-tree summary:has-text("docs/arte/")');
  assert.equal(await page.isVisible('.tree-doc:has-text("sonido.md")'), false);
  await page.close();
});

test('12.5: buscar un término en todos los documentos y saltar a la sección', async () => {
  await library();
  const page = await open('#docs/gdd');
  await page.fill('#doc-q', 'SLIME');
  await page.waitForSelector('.doc-results .res-doc');
  assert.match(await page.textContent('.doc-results > p'), /3 coincidencias en 2 documentos/);
  assert.deepEqual(await page.$$eval('.res-doc h3', (hs) => hs.map((x) => x.firstChild.textContent)), ['Sonido', 'Enemigos'], 'en el orden de los documentos');
  assert.deepEqual(await page.$$eval('.res-doc mark', (ms) => ms.map((m) => m.textContent)), ['slime', 'Slime', 'slime'], 'resalta sin importar mayúsculas');
  // La caja no pierde lo escrito si llega un cambio del hub.
  await setTask('m1-02', { title: 'Cambiada mientras se busca' });
  await page.waitForTimeout(300);
  assert.equal(await page.inputValue('#doc-q'), 'SLIME');
  await page.click('.res-doc a:has-text("se divide")');
  await page.waitForSelector('article.doc-body[data-ready="1"][data-alias="docs/enemigos"]');
  assert.match(page.url(), /#docs\/docs%2Fenemigos\/slime$/);
  assert.equal(await page.inputValue('#doc-q'), '', 'ir a un resultado limpia la búsqueda');
  assert.equal(await page.locator('.doc-results').count(), 0);
  await page.close();
});

test('12.5: agregar un documento desde la web y quitarlo', async () => {
  await writeFile(join(dir, 'guion.md'), '# Guion\n<!-- id: guion -->\n');
  const page = await open('#docs/gdd');
  const cfgDocs = async () => JSON.parse(await readFile(join(dir, 'compass', 'config.json'), 'utf8')).docs;
  await page.click('#doc-add-btn');
  await page.fill('#doc-alias', 'guion');
  await page.fill('#doc-path', 'nada.md');
  await page.click('#doc-add button[type="submit"]');
  await page.waitForSelector('.toast:has-text("no existe el archivo nada.md")');
  await page.fill('#doc-path', 'guion.md');
  await page.click('#doc-add button[type="submit"]');
  await page.waitForSelector('.tree-doc[aria-current="page"]:has-text("guion.md")');
  assert.equal(await page.isHidden('#doc-add'), true);
  assert.deepEqual(await cfgDocs(), [{ alias: 'gdd', path: 'gdd.md' }, { alias: 'guion', path: 'guion.md' }]);
  await page.click('#doc-rm');
  await page.click('.doc-card button:has-text("Quitar")');
  await page.waitForFunction(() => !document.querySelector('.tree-doc[href="#docs/guion"]'));
  assert.deepEqual(await cfgDocs(), [{ alias: 'gdd', path: 'gdd.md' }]);
  await page.close();
});

test('12.6: editar un documento con el hub abierto: marca sin recargar, diff, tareas de la sección tocada; al commitear se va', async () => {
  const { execFileSync } = await import('node:child_process');
  const git = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { stdio: 'ignore' });
  git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'Primer GDD');
  const page = await open('#docs/gdd');
  await page.waitForSelector('.doc-card .doc-git.clean');
  await page.waitForSelector('.doc-gitcard .commit:has-text("Primer GDD")');
  assert.equal(await page.locator('#doc-diff-btn').count(), 0, 'sin cambios no hay diff');
  // Se edita la sección de las ventanas de ataque, que citan m1-03 y m1-04.
  await writeFile(join(dir, 'gdd.md'), GDD.replace('Las ventanas de golpe son datos.', 'Las ventanas de golpe son datos y curvas.'));
  await page.waitForSelector('.tree-doc .gitflag.modified', { timeout: 3000 });
  await page.waitForSelector('.toc a[href="#docs/gdd/ventanas-ataque"] .chg');
  assert.deepEqual(await page.$$eval('.toc a:has(.chg)', (as) => as.map((a) => a.getAttribute('href').split('/').pop())), ['juego', 'combate', 'ventanas-ataque']);
  assert.match(await page.textContent('.affected .label'), /Pueden quedar afectadas · 2 tareas/);
  assert.deepEqual(await page.$$eval('.affected .bl-task .code', (xs) => xs.map((x) => x.textContent)), ['1.3', '1.4']);
  await page.click('#doc-diff-btn');
  await page.waitForSelector('.doc-diff .dl.add');
  assert.equal(await page.textContent('.doc-diff .dl.add'), '+Las ventanas de golpe son datos y curvas.');
  assert.equal(await page.textContent('.doc-diff .dl.del'), '−Las ventanas de golpe son datos.');
  assert.match(await page.textContent('.doc-diff .dl.hunk'), /Ventanas de ataque/);
  // Commitear: la marca se va sola y el historial suma el commit (aunque se commitee antes de que el hub mire).
  git('commit', '-qam', 'Curvas de golpe');
  await page.waitForFunction(() => !document.querySelector('.tree-doc .gitflag'), null, { timeout: 6000 });
  assert.equal(await page.locator('.doc-diff').count(), 0, 'sin cambios vuelve al documento');
  await page.waitForSelector('.history summary:has-text("2 commits")');
  await page.close();
});
