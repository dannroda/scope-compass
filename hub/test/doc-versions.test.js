// Documentos al día (spec §41, m26-02): el etag de un documento y qué cambió desde uno, por la CLI y por la API.
import './isolate.js';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadValidators } from '../src/schema.js';
import { canonical } from '../src/store/canonical.js';
import { createJsonFilesStore } from '../src/store/json-files.js';
import { createServer } from '../src/server.js';
import { run } from '../src/cli.js';
import { blobEtag, pruneVersions, rememberVersion, versionsDir } from '../src/doc-versions.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'compass');
const V = loadValidators();
const hasGit = (() => { try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const GDD = `# Juego
<!-- id: juego -->

Intro.

## Combate
<!-- id: combate -->

### Ventanas de ataque
<!-- id: ventanas-ataque -->

Tres frames.

## Cámara
<!-- id: camara -->

Fija.

## Audio
<!-- id: audio -->

Sin música.
`;
let dir;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'scompass-docver-'));
  await cp(FIXTURE, join(dir, 'compass'), { recursive: true });
  await writeFile(join(dir, 'gdd.md'), GDD);
  const cfg = join(dir, 'compass', 'config.json');
  await writeFile(cfg, canonical({ ...JSON.parse(await readFile(cfg, 'utf8')), port: 1, docs: [{ alias: 'gdd', path: 'gdd.md' }] }));
});
afterEach(() => rm(dir, { recursive: true, force: true, maxRetries: 10 }));

async function cli(...argv) {
  let out = '', err = '';
  const code = await run(argv, { cwd: dir, out: { write: (s) => { out += s; } }, err: { write: (s) => { err += s; } } });
  return { code, out, err, json: (() => { try { return JSON.parse(out); } catch { return null; } })() };
}
// Cambia la ventana de ataque, agrega Red y quita Cámara; Audio queda igual.
const edit = () => writeFile(join(dir, 'gdd.md'), GDD.replace('Tres frames.', 'Cuatro frames.').replace(/## Cámara[\s\S]*?(?=## Audio)/, '## Red\n<!-- id: red -->\n\nLocal.\n\n'));

test('el etag es el id de blob de git del texto', { skip: !hasGit && 'sin git' }, async () => {
  const text = 'hola\nñandú\n';
  assert.equal(blobEtag(text), execFileSync('git', ['hash-object', '--stdin'], { input: text }).toString().trim());
  const { json } = await cli('doc', 'show', 'gdd', '--json');
  assert.equal(json.etag, execFileSync('git', ['hash-object', join(dir, 'gdd.md')]).toString().trim());
  assert.equal((await cli('doc', 'show', 'gdd#camara', '--json')).json.etag, json.etag, 'una sección da el etag del documento');
  assert.equal((await cli('doc', 'list', '--json')).json.docs[0].etag, json.etag);
  assert.match((await cli('doc', 'show', 'gdd')).out, new RegExp(`etag ${json.etag}`));
});

test('doc changed: secciones cambiadas, nuevas y quitadas desde el etag que dio doc show', async () => {
  const { etag } = (await cli('doc', 'show', 'gdd', '--json')).json;
  let r = await cli('doc', 'changed', 'gdd', '--since', etag, '--json');
  assert.equal(r.code, 0);
  assert.deepEqual([r.json.changed, r.json.known], [false, true]);
  await edit();
  r = await cli('doc', 'changed', 'gdd', '--since', etag, '--json');
  assert.equal(r.code, 1, 'sale con 1 si cambió');
  assert.equal(r.json.known, true);
  assert.notEqual(r.json.etag, etag);
  // Una sección incluye a las de adentro: Juego y Combate cambian con la ventana de ataque.
  assert.deepEqual(r.json.sections, { changed: ['juego', 'combate', 'ventanas-ataque'], added: ['red'], removed: ['camara'] });
  // Por sección: Audio no cambió; Cámara se quitó; Combate cambió por la de adentro.
  assert.equal((await cli('doc', 'changed', 'gdd#audio', '--since', etag, '--json')).json.changed, false);
  r = await cli('doc', 'changed', 'gdd#camara', '--since', etag, '--json');
  assert.deepEqual([r.code, r.json.changed, r.json.sections.removed], [1, true, ['camara']]);
  assert.deepEqual((await cli('doc', 'changed', 'gdd#combate', '--since', etag, '--json')).json.sections.changed, ['combate', 'ventanas-ataque']);
  assert.equal((await cli('doc', 'changed', 'gdd#nada', '--since', etag)).code, 1);
  // El texto para leer en la terminal.
  const text = (await cli('doc', 'changed', 'gdd', '--since', etag)).out;
  assert.match(text, /Cambiaron: juego, combate, ventanas-ataque\nNuevas: red\nQuitadas: camara/);
});

test('doc changed sin el texto viejo: known false y sin secciones', async () => {
  await rm(versionsDir(), { recursive: true, force: true });
  const r = await cli('doc', 'changed', 'gdd', '--since', 'a'.repeat(40), '--json');
  assert.deepEqual([r.code, r.json.changed, r.json.known, r.json.sections], [1, true, false, null]);
  assert.match((await cli('doc', 'changed', 'gdd', '--since', 'a'.repeat(40))).out, /no está en la caché ni en git/);
  assert.notEqual((await cli('doc', 'changed', 'gdd')).code, 0, 'falta --since');
});

test('doc changed encuentra en git una versión commiteada que no está en la caché', { skip: !hasGit && 'sin git' }, async () => {
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'pipe' });
  git('init', '-q');
  git('add', 'gdd.md');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'gdd');
  const etag = blobEtag(GDD);
  await rm(versionsDir(), { recursive: true, force: true });
  await edit();
  const r = await cli('doc', 'changed', 'gdd', '--since', etag, '--json');
  assert.equal(r.json.known, true);
  assert.deepEqual(r.json.sections.removed, ['camara']);
});

test('la caché: una versión entregada queda guardada, y las de más de 30 días se borran', async () => {
  // Una carpeta de datos propia: con npm test los demás archivos de test (otros procesos) comparten la de la corrida
  // y entregan versiones en la misma caché mientras este test la cuenta.
  const saved = process.env.SCOMPASS_DATA;
  process.env.SCOMPASS_DATA = join(dir, 'datos');
  try {
    await cacheTest();
  } finally {
    if (saved === undefined) delete process.env.SCOMPASS_DATA; else process.env.SCOMPASS_DATA = saved;
  }
});

async function cacheTest() {
  await rm(versionsDir(), { recursive: true, force: true });
  const { etag } = (await cli('doc', 'show', 'gdd', '--json')).json;
  assert.equal(await readFile(join(versionsDir(), `${etag}.md`), 'utf8'), GDD);
  const old = await rememberVersion('vieja\n');
  const t = new Date(Date.now() - 31 * 24 * 3600 * 1000);
  await utimes(join(versionsDir(), `${old}.md`), t, t);
  await pruneVersions();
  assert.deepEqual(await readdir(versionsDir()), [`${etag}.md`]);
}

test('API: etag en el documento y en la sección, y /changes', async () => {
  const app = createServer({ projectDir: dir, store: createJsonFilesStore(join(dir, 'compass'), { validators: V }), validators: V });
  try {
    const get = async (url) => { const r = await app.inject(url); return { status: r.statusCode, body: r.json() }; };
    const { body: doc } = await get('/api/docs/gdd');
    assert.equal(doc.etag, blobEtag(GDD));
    assert.equal((await get('/api/docs/gdd/sections/combate')).body.etag, doc.etag);
    assert.equal((await get('/api/docs/gdd/sections/combate?format=bbcode')).body.etag, doc.etag);
    await edit();
    const { status, body } = await get(`/api/docs/gdd/changes?since=${doc.etag}`);
    assert.equal(status, 200);
    assert.deepEqual([body.changed, body.known, body.sections.added, body.sections.removed], [true, true, ['red'], ['camara']]);
    assert.equal((await get(`/api/docs/gdd/changes?since=${doc.etag}&section=audio`)).body.changed, false);
    assert.equal((await get(`/api/docs/gdd/changes?since=${doc.etag}&section=nada`)).status, 404);
    assert.equal((await get('/api/docs/gdd/changes')).status, 400);
  } finally {
    await app.close();
  }
});
