import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadValidators } from '../src/schema.js';
import { canonical } from '../src/store/canonical.js';
import { createJsonFilesStore } from '../src/store/json-files.js';
import { createServer } from '../src/server.js';
import { renderMarkdown } from '../src/render.js';
import { parseSections } from '../src/docs.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'compass');
const V = loadValidators();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GDD = `# Juego
<!-- id: juego -->

## Combate
<!-- id: combate -->

### Ventanas de ataque
<!-- id: ventanas-ataque -->

Ver [la doc](https://docs.godotengine.org).

\`\`\`gdscript
func _ready() -> void:
	var hp: int = 10 # vida
\`\`\`

<script>alert(1)</script>

## Cámara
<!-- id: camara -->
`;
let dir, app;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'scompass-docsapi-'));
  await cp(FIXTURE, join(dir, 'compass'), { recursive: true });
  await writeFile(join(dir, 'gdd.md'), GDD);
  const cfg = join(dir, 'compass', 'config.json');
  await writeFile(cfg, canonical({ ...JSON.parse(await readFile(cfg, 'utf8')), docs: [{ alias: 'gdd', path: 'gdd.md' }] }));
  const set = async (id, refs, notes) => {
    const p = join(dir, 'compass', 'tasks', `${id}.json`);
    await writeFile(p, canonical({ ...JSON.parse(await readFile(p, 'utf8')), refs, ...(notes !== undefined && { notes }) }));
  };
  for (const id of ['m0-01', 'm0-02', 'm0-03', 'm0-04', 'm0-05', 'm0-06', 'm1-01', 'm1-02', 'm1-03', 'm1-04', 'm1-05', 'm1-06', 'm1-07']) await set(id, []);
  await set('m1-03', [{ doc: 'gdd.md', section: 'ventanas-ataque' }]);
  await set('m1-04', [], 'ver [[gdd#ventanas-ataque]] y [[gdd#borrada]]');
  await set('m1-05', [{ doc: 'gdd.md', section: 'combate' }]);
  app = createServer({ projectDir: dir, store: createJsonFilesStore(join(dir, 'compass'), { validators: V }), validators: V, watch: true });
});
afterEach(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});
const get = async (url) => { const r = await app.inject(url); return { status: r.statusCode, body: r.json() }; };

test('render: sin los comentarios de id, títulos con ancla, GDScript resaltado, HTML del documento como texto', () => {
  const { sections } = parseSections(GDD);
  const html = renderMarkdown(GDD, sections);
  assert.ok(!html.includes('<!--'));
  assert.match(html, /<h3 id="sec-ventanas-ataque" data-section="ventanas-ataque">Ventanas de ataque<\/h3>/);
  assert.match(html, /<pre class="code language-gdscript"><code><span class="token keyword">func<\/span>/);
  assert.match(html, /<span class="token comment"># vida<\/span>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.ok(!html.includes('<script>'));
  assert.match(html, /<a href="https:\/\/docs.godotengine.org" target="_blank" rel="noopener noreferrer">la doc<\/a>/);
});

test('GET /api/docs: índice con las tareas que referencian cada sección', async () => {
  const { status, body } = await get('/api/docs');
  assert.equal(status, 200);
  const d = body.docs[0];
  assert.equal(d.alias, 'gdd');
  const tasksOf = Object.fromEntries(d.sections.map((s) => [s.id, s.tasks.map((t) => t.id)]));
  assert.deepEqual(tasksOf, { juego: [], combate: ['m1-05'], 'ventanas-ataque': ['m1-03', 'm1-04'], camara: [] });
});

test('GET /api/docs/:alias y /sections/:id: HTML y backlinks; 404 si no existe', async () => {
  const doc = await get('/api/docs/gdd');
  assert.equal(doc.status, 200);
  assert.match(doc.body.html, /id="sec-camara"/);
  const sec = await get('/api/docs/gdd/sections/ventanas-ataque');
  assert.equal(sec.status, 200);
  assert.equal(sec.body.title, 'Ventanas de ataque');
  assert.deepEqual(sec.body.tasks.map((t) => t.id), ['m1-03', 'm1-04']);
  assert.match(sec.body.markdown, /^### Ventanas de ataque\n<!-- id: ventanas-ataque -->/);
  assert.ok(!sec.body.html.includes('Cámara'), 'solo la sección');
  const combate = await get('/api/docs/gdd/sections/combate');
  assert.match(combate.body.html, /id="sec-ventanas-ataque"/, 'la sección incluye sus subsecciones');
  assert.equal((await get('/api/docs/otro')).status, 404);
  assert.equal((await get('/api/docs/gdd/sections/nada')).status, 404);
});

test('GET /api/refs/broken', async () => {
  const { body } = await get('/api/refs/broken');
  assert.deepEqual(body.broken.map((b) => [b.task, b.ref, b.where]), [['m1-04', 'gdd#borrada', 'notes']]);
});

test('editar el documento con el hub corriendo emite doc_changed en menos de 1 s', async () => {
  await app.ready();
  const events = [];
  app.events.on('event', (e) => events.push(e));
  await sleep(100);
  const t0 = Date.now();
  await writeFile(join(dir, 'gdd.md'), GDD.replace('Ventanas de ataque', 'Ventanas de golpe'));
  while (!events.some((e) => e.type === 'doc_changed') && Date.now() - t0 < 1000) await sleep(10);
  assert.deepEqual(events.filter((e) => e.type === 'doc_changed'), [{ type: 'doc_changed', alias: 'gdd' }]);
  assert.equal((await get('/api/docs/gdd/sections/ventanas-ataque')).body.title, 'Ventanas de golpe', 'se relee al pedirlo');
  await writeFile(join(dir, 'otro.md'), '# x\n');
  await sleep(300);
  assert.equal(events.filter((e) => e.type === 'doc_changed').length, 1, 'otros archivos no cuentan');
});
