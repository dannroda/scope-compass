// 19.2: nada se lee ni se escribe fuera del proyecto, venga de config.json o de la API.
import './isolate.js';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadValidators } from '../src/schema.js';
import { createJsonFilesStore } from '../src/store/json-files.js';
import { createServer } from '../src/server.js';
import { exportMarkdown } from '../src/export-md.js';
import { dropImage, saveImage } from '../src/images.js';
import { repoFile } from '../src/files-api.js';
import { loadDocs } from '../src/docs.js';
import { projectRel } from '../src/paths.js';
import { link, NO_FILE_LINKS } from './links.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'compass');
const V = loadValidators();
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c50000000049454e44ae426082', 'hex');
let root, dir, outside, app;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'scompass-paths-'));
  dir = join(root, 'proyecto');
  outside = join(root, 'afuera');
  await mkdir(outside);
  await cp(FIXTURE, join(dir, 'compass'), { recursive: true });
  await writeFile(join(outside, 'secreto.md'), '# Secreto\n');
  await writeFile(join(dir, '.env'), 'CLAVE=1\n');
  await writeFile(join(dir, '.gitignore'), '.env\nignorado.md\n');
  await writeFile(join(dir, 'ignorado.md'), '# Ignorado\n');
  await writeFile(join(dir, 'gdd.md'), '# GDD\n');
  execFileSync('git', ['-C', dir, 'init', '-q']);
  app = createServer({ projectDir: dir, store: createJsonFilesStore(join(dir, 'compass'), { validators: V }), validators: V });
  await app.ready();
});
afterEach(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true, maxRetries: 10 });
});

test('projectRel: ni absolutas, ni .., ni llaves, ni \\', () => {
  assert.equal(projectRel('./docs/a.md'), 'docs/a.md');
  assert.equal(projectRel('docs/**/*.md'), 'docs/**/*.md');
  for (const p of ['/etc/a.md', 'C:/a.md', '../a.md', 'docs/../../a.md', 'docs/{..,x}/*.md', 'a\\b.md', '', 'a\0.md']) assert.equal(projectRel(p), null, p);
});

test('export_md: tiene que ser un .md dentro del proyecto, también siguiendo enlaces simbólicos; --out queda libre', async () => {
  const all = await createJsonFilesStore(join(dir, 'compass'), { validators: V }).loadAll();
  for (const bad of ['../afuera/x.md', '/tmp/x.md', 'docs/x.txt']) {
    await assert.rejects(exportMarkdown(dir, { ...all, config: { ...all.config, export_md: bad } }), /export_md/, bad);
  }
  // Una carpeta del proyecto que es un enlace a otra parte.
  await link(outside, join(dir, 'enlace'));
  await assert.rejects(exportMarkdown(dir, { ...all, config: { ...all.config, export_md: 'enlace/tareas.md' } }), /enlace simbólico/);
  assert.equal(await stat(join(outside, 'tareas.md')).catch(() => null), null);
  // El schema tampoco deja pasar una config así.
  const cfg = JSON.parse(await readFile(join(dir, 'compass', 'config.json'), 'utf8'));
  await writeFile(join(dir, 'compass', 'config.json'), JSON.stringify({ ...cfg, export_md: '../afuera/x.md' }));
  await app.inject({ method: 'POST', url: '/api/export/markdown' });
  assert.equal(await stat(join(outside, 'x.md')).catch(() => null), null);
  // Lo que elige quien corre scompass export --out sí puede ir afuera.
  assert.equal(await exportMarkdown(dir, all, { out: join(outside, 'mio.md') }), join(outside, 'mio.md'));
});

test('POST /api/docs: ni llaves, ni .., ni enlaces afuera, ni lo que git ignora, ni algo que no sea .md', async () => {
  const post = (path) => app.inject({ method: 'POST', url: '/api/docs', payload: { alias: 'x', path } });
  // Sin enlaces a archivos (Windows sin permiso), enlace.md no existe y da 404 igual.
  await link(join(outside, 'secreto.md'), join(dir, 'enlace.md'));
  await link(outside, join(dir, 'carpeta'));
  for (const p of ['{..,x}/*.md', '../afuera/secreto.md', join(outside, 'secreto.md'), 'enlace.md', 'carpeta/*.md', '.env', 'ignorado.md']) {
    const r = await post(p);
    assert.ok([400, 404].includes(r.statusCode), `${p}: ${r.statusCode}`);
  }
  assert.equal((await post('gdd.md')).statusCode, 201);
});

test('loadDocs: un patrón no sigue un enlace que lleva afuera, ni un documento declarado a mano', async (t) => {
  await mkdir(join(dir, 'docs'));
  await writeFile(join(dir, 'docs', 'uno.md'), '# Uno\n');
  if (!(await link(join(outside, 'secreto.md'), join(dir, 'docs', 'secreto.md')))) return t.skip(NO_FILE_LINKS);
  await link(join(outside, 'secreto.md'), join(dir, 'fijo.md'));
  const docs = await loadDocs(dir, { docs: [{ alias: 'd', path: 'docs/*.md' }, { alias: 'f', path: 'fijo.md' }] });
  assert.deepEqual(docs.map((d) => [d.alias, d.missing ?? false]), [['d/uno', false], ['f', true]]);
  assert.match(docs[1].warnings[0].message, /fuera del proyecto/);
});

test('compass/images como enlace afuera: no se guarda ni se borra nada ahí', async () => {
  await link(outside, join(dir, 'compass', 'images'));
  await assert.rejects(saveImage(dir, 'm1-07', PNG), /fuera del proyecto/);
  await writeFile(join(outside, 'm1-07-1.png'), PNG);
  assert.equal(await dropImage(dir, 'compass/images/m1-07-1.png', []), false);
  assert.ok(await stat(join(outside, 'm1-07-1.png')));
});

test('repoFile: una ruta con el nombre de una clave heredada no pasa', async () => {
  for (const p of ['constructor', '__proto__', 'toString']) await assert.rejects(repoFile(dir, p), /no hay un archivo/, p);
});
