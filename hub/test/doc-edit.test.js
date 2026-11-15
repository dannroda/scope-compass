// Editar una sección desde la web (spec §50, D61, m26-06): PUT /api/docs/:alias/sections/:id con el etag del documento.
import './isolate.js';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadValidators } from '../src/schema.js';
import { canonical } from '../src/store/canonical.js';
import { createJsonFilesStore } from '../src/store/json-files.js';
import { createServer } from '../src/server.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'compass');
const V = loadValidators();
const hasGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const GDD = `# Juego
<!-- id: juego -->

Intro.

## Combate
<!-- id: combate -->

Golpes.

### Ventanas de ataque

Tres frames.

## Cámara

Fija.

## Audio
<!-- id: audio -->

Sin música.
`;
let dir;
let app;

async function setup(text = GDD, extra = {}) {
  await writeFile(join(dir, 'gdd.md'), text);
  const cfg = join(dir, 'compass', 'config.json');
  await writeFile(cfg, canonical({ ...JSON.parse(await readFile(cfg, 'utf8')), port: 1, docs: [{ alias: 'gdd', path: 'gdd.md' }], ...extra }));
  app = createServer({ projectDir: dir, store: createJsonFilesStore(join(dir, 'compass'), { validators: V }), validators: V });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'scompass-docedit-'));
  await cp(FIXTURE, join(dir, 'compass'), { recursive: true });
});
afterEach(async () => {
  await app?.close();
  app = null;
  await rm(dir, { recursive: true, force: true, maxRetries: 10 });
});

const file = () => readFile(join(dir, 'gdd.md'), 'utf8');
const get = async (id) => (await app.inject(`/api/docs/gdd/sections/${id}`)).json();
const put = async (id, body) => {
  const r = await app.inject({ method: 'PUT', url: `/api/docs/gdd/sections/${id}`, payload: body });
  return { status: r.statusCode, body: r.json() };
};

test('con el etag actual reemplaza la sección y deja el resto del archivo igual', async () => {
  await setup();
  const s = await get('camara');
  assert.equal(s.markdown, '## Cámara\n\nFija.\n');
  const r = await put('camara', { markdown: '## Cámara\n\nSigue al jugador.\n', etag: s.etag });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(await file(), GDD.replace('Fija.', 'Sigue al jugador.'));
  assert.equal(r.body.previous, s.etag);
  assert.notEqual(r.body.etag, s.etag);
  assert.equal(r.body.markdown, '## Cámara\n\nSigue al jugador.\n');
  // La sección con secciones adentro: el rango entero.
  const c = await get('combate');
  const r2 = await put('combate', { markdown: '## Combate\n<!-- id: combate -->\n\nGolpes y patadas.\n', etag: c.etag });
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
  assert.equal(await file(), GDD.replace('Fija.', 'Sigue al jugador.').replace('Golpes.\n\n### Ventanas de ataque\n\nTres frames.', 'Golpes y patadas.'));
});

test('respeta el fin de línea CRLF y un archivo sin salto final', async () => {
  const crlf = GDD.replace(/\n/g, '\r\n').replace(/\r\n$/, '');
  await setup(crlf);
  const a = await get('audio');
  const r = await put('audio', { markdown: '## Audio\n<!-- id: audio -->\n\nMúsica tranquila.\nDos pistas.', etag: a.etag });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(await file(), crlf.replace('Sin música.', 'Música tranquila.\r\nDos pistas.'));
  const c = await get('camara');
  const r2 = await put('camara', { markdown: '## Cámara\r\n\r\nLibre.\r\n', etag: c.etag });
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
  assert.equal(await file(), crlf.replace('Sin música.', 'Música tranquila.\r\nDos pistas.').replace('Fija.', 'Libre.'));
});

test('con un etag viejo se aplica si la sección no cambió y da 409 si cambió o si no aparece la versión', async () => {
  await setup();
  const old = (await get('camara')).etag;
  // Alguien cambia otra sección en el editor: no bloquea.
  await writeFile(join(dir, 'gdd.md'), GDD.replace('Sin música.', 'Con música.'));
  const r = await put('camara', { markdown: '## Cámara\n\nLibre.\n', etag: old });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(await file(), GDD.replace('Sin música.', 'Con música.').replace('Fija.', 'Libre.'));
  // La misma sección cambió en el editor: 409 con el texto actual.
  const before = (await get('combate')).etag;
  const now = (await file()).replace('Tres frames.', 'Cuatro frames.');
  await writeFile(join(dir, 'gdd.md'), now);
  const c = await put('combate', { markdown: '## Combate\n<!-- id: combate -->\n\nOtro.\n', etag: before });
  assert.equal(c.status, 409);
  assert.equal(c.body.error.code, 'conflict');
  assert.match(c.body.error.current.markdown, /Cuatro frames\./);
  assert.equal(c.body.error.current.etag, (await get('combate')).etag);
  assert.equal(await file(), now);
  // Un etag que no está en la caché ni en git.
  const u = await put('audio', { markdown: '## Audio\n\nX.\n', etag: 'f'.repeat(40) });
  assert.equal(u.status, 409);
  assert.equal(await file(), now);
});

test('un texto que no es una sola sección del mismo nivel da 422', async () => {
  await setup();
  const { etag } = await get('camara');
  for (const markdown of ['Fija.\n', '### Cámara\n\nFija.\n', '# Cámara\n', '## Cámara\n\nFija.\n\n## Red\n\nLocal.\n', '## Cámara\n\n# Otro\n']) {
    const r = await put('camara', { markdown, etag });
    assert.equal(r.status, 422, markdown);
    assert.equal(r.body.error.code, 'invalid_section');
  }
  // Un título de nivel más bajo adentro sí, y un ## dentro de un bloque de código no cuenta.
  const ok = await put('camara', { markdown: '## Cámara\n\n### Zoom\n\nNo.\n\n```md\n## no es título\n```\n', etag });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await put('camara', { etag })).status, 400);
  assert.equal((await put('nada', { markdown: '## Nada\n', etag: ok.body.etag })).status, 404);
  assert.equal(await file(), GDD.replace('Fija.', '### Zoom\n\nNo.\n\n```md\n## no es título\n```'));
});

test('el id se conserva: cambiar el título le pone el de antes y uno explícito vuelve a ponerse', async () => {
  await setup();
  let { etag } = await get('camara');
  let r = await put('camara', { markdown: '## Cámara y encuadre\n\nFija.\n', etag });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(await file(), /## Cámara y encuadre\n<!-- id: camara -->\n\nFija\./);
  assert.equal((await get('camara')).title, 'Cámara y encuadre');
  // El mismo título sin id: no hace falta ponerle uno.
  ({ etag } = await get('ventanas-de-ataque'));
  r = await put('ventanas-de-ataque', { markdown: '### Ventanas de ataque\n\nDos frames.\n', etag });
  assert.equal(r.status, 200);
  assert.match(await file(), /### Ventanas de ataque\n\nDos frames\./);
  // Uno explícito que se quita o se cambia.
  ({ etag } = await get('audio'));
  r = await put('audio', { markdown: '## Sonido\n\nSin música.\n', etag });
  assert.equal(r.status, 200);
  assert.match(await file(), /## Sonido\n<!-- id: audio -->\n/);
  r = await put('audio', { markdown: '## Sonido\n<!-- id: sonido -->\n\nSin música.\n', etag: r.body.etag });
  assert.equal(r.status, 200);
  assert.match(await file(), /## Sonido\n<!-- id: audio -->\n/);
  assert.doesNotMatch(await file(), /id: sonido/);
});

test('Deshacer con previous deja el archivo como estaba', async () => {
  await setup();
  const s = await get('combate');
  const r = await put('combate', { markdown: '## Combate nuevo\n\nNada.\n', etag: s.etag });
  assert.equal(r.status, 200);
  const undo = await put('combate', { markdown: s.markdown, etag: r.body.etag });
  assert.equal(undo.status, 200, JSON.stringify(undo.body));
  assert.equal(await file(), GDD);
  assert.equal(undo.body.etag, s.etag);
});

test('un patrón prohibido en el texto nuevo da 422 y no escribe', async () => {
  await setup(GDD, { forbidden: [{ pattern: 'Zelda', note: 'nombre de otro juego' }] });
  const { etag } = await get('camara');
  const r = await put('camara', { markdown: '## Cámara\n\nComo en Zelda.\n', etag });
  assert.equal(r.status, 422);
  assert.equal(r.body.error.code, 'forbidden_pattern');
  assert.equal(r.body.error.matches[0].match, 'Zelda');
  assert.equal(await file(), GDD);
});

test('no commitea', { skip: !hasGit }, async () => {
  await setup();
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  git('init', '-q');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base');
  const head = git('rev-parse', 'HEAD');
  const { etag } = await get('camara');
  assert.equal((await put('camara', { markdown: '## Cámara\n\nLibre.\n', etag })).status, 200);
  assert.equal(git('rev-parse', 'HEAD'), head);
  assert.match(git('status', '--porcelain'), /^ M gdd\.md$/m);
});
