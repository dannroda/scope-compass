import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDocs, parseSections, resolveRef, sectionMarkdown, slugify } from '../src/docs.js';
import { run } from '../src/cli.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EPIPHANY = join(REPO, '..', 'project-epiphany');

const MD = `# Juego
<!-- id: juego -->

Intro.

## Combate
<!-- id: combate -->

### Ventanas de ataque: \`AttackData\`
<!-- id: ventanas-ataque -->

Texto.

\`\`\`gdscript
# esto no es un título
func _ready():
    pass
\`\`\`

### Sin id, con tildés
Más.

## Cámara
<!-- id: camara -->
Fin.
`;

test('secciones: niveles, fin en el próximo título igual o superior, código ignorado', () => {
  const { sections, warnings } = parseSections(MD);
  assert.deepEqual(warnings, []);
  assert.deepEqual(sections.map((s) => [s.id, s.level, s.explicit]), [
    ['juego', 1, true], ['combate', 2, true], ['ventanas-ataque', 3, true], ['sin-id-con-tildes', 3, false], ['camara', 2, true]
  ]);
  const byId = Object.fromEntries(sections.map((s) => [s.id, s]));
  const lines = MD.split('\n');
  assert.equal(lines[byId.combate.end], '## Cámara', 'combate llega hasta Cámara (incluye sus subsecciones)');
  assert.equal(lines[byId['ventanas-ataque'].end], '### Sin id, con tildés');
  assert.equal(byId.juego.end, lines.length, 'el título de nivel 1 llega al final');
});

test('slug: sin tildes, sin código ni puntuación', () => {
  assert.equal(slugify('Ventanas de ataque: `AttackData` + `AttackRunner`'), 'ventanas-de-ataque-attackdata-attackrunner');
  assert.equal(slugify('D15 · Linux primero'), 'd15-linux-primero');
  assert.equal(slugify('4.3 Mapa de input'), '43-mapa-de-input');
});

test('ids repetidos: aviso si son explícitos; los slugs se desambiguan', () => {
  const { sections, warnings } = parseSections('## A\n<!-- id: x -->\n## B\n<!-- id: x -->\n## Igual\n## Igual\n');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message, /id repetido: x/);
  assert.deepEqual(sections.slice(2).map((s) => s.id), ['igual', 'igual-2']);
});

test('resolver referencias por alias o por ruta; sectionMarkdown devuelve la sección entera', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'scompass-docs-'));
  try {
    await writeFile(join(dir, 'gdd.md'), MD);
    await mkdir(join(dir, 'docs', 'notas'), { recursive: true });
    await writeFile(join(dir, 'docs', 'notas', 'arte.md'), '# Arte\n<!-- id: arte -->\n');
    await writeFile(join(dir, 'docs', 'audio.md'), '# Audio\n');
    const docs = await loadDocs(dir, { docs: [{ alias: 'gdd', path: 'gdd.md' }, { alias: 'docs', path: 'docs/**/*.md' }, { alias: 'falta', path: 'no.md' }] });
    assert.deepEqual(docs.map((d) => [d.alias, d.path]), [['gdd', 'gdd.md'], ['docs/audio', 'docs/audio.md'], ['docs/arte', 'docs/notas/arte.md'], ['falta', 'no.md']]);
    assert.equal(docs[3].warnings[0].code, 'missing_doc');
    const a = resolveRef(docs, 'gdd#ventanas-ataque');
    const b = resolveRef(docs, { doc: 'gdd.md', section: 'ventanas-ataque' });
    assert.equal(a.section, b.section);
    assert.match(sectionMarkdown(a.doc, a.section), /^### Ventanas de ataque[\s\S]*func _ready\(\):\n {4}pass\n```\n$/);
    assert.equal(resolveRef(docs, 'gdd#nada').section, null);
    assert.equal(resolveRef(docs, 'otro#x').doc, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('las refs de las tareas de este repo resuelven contra sus documentos', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const config = JSON.parse(await readFile(join(REPO, 'compass', 'config.json'), 'utf8'));
  const docs = await loadDocs(REPO, config);
  const broken = [];
  for (const f of await readdir(join(REPO, 'compass', 'tasks'))) {
    const t = JSON.parse(await readFile(join(REPO, 'compass', 'tasks', f), 'utf8'));
    for (const r of t.refs ?? []) if (!resolveRef(docs, r).section) broken.push(`${f}: ${r.doc}#${r.section}`);
  }
  assert.deepEqual(broken, []);
});

test('doc list y doc show --raw con el GDD de Epiphany', { skip: !existsSync(join(EPIPHANY, 'gdd.md')) && 'no está project-epiphany' }, async () => {
  let out = '';
  const io = { out: { write: (s) => { out += s; } }, err: { write() {} }, cwd: REPO };
  assert.equal(await run(['--dir', EPIPHANY, '--direct', 'doc', 'list', '--json'], io), 0);
  const gdd = JSON.parse(out).docs.find((d) => d.alias === 'gdd');
  assert.ok(gdd.sections.length >= 28);
  out = '';
  assert.equal(await run(['--dir', EPIPHANY, '--direct', 'doc', 'show', 'gdd#ventanas-ataque', '--raw'], io), 0);
  assert.match(out, /^#### Ventanas de ataque/);
  assert.equal(await run(['--dir', EPIPHANY, '--direct', 'doc', 'show', 'gdd#no-existe'], io), 1);
});

// --- 6.2: refs check, ref add/rm, stamp-ids ---
import { cp, readFile } from 'node:fs/promises';
import { canonical } from '../src/store/canonical.js';
import { checkRefs, stampIds } from '../src/docs.js';

const FIXTURE = join(REPO, 'hub', 'test', 'fixtures', 'compass');

async function projectWithGdd() {
  const dir = await mkdtemp(join(tmpdir(), 'scompass-refs-'));
  await cp(FIXTURE, join(dir, 'compass'), { recursive: true });
  await writeFile(join(dir, 'gdd.md'), MD);
  const cfg = join(dir, 'compass', 'config.json');
  await writeFile(cfg, canonical({ ...JSON.parse(await readFile(cfg, 'utf8')), port: 1, docs: [{ alias: 'gdd', path: 'gdd.md' }] }));
  // Sin las refs del fixture (apuntan a docs/spec.md, que acá no está).
  const { readdir } = await import('node:fs/promises');
  for (const f of await readdir(join(dir, 'compass', 'tasks'))) {
    const p = join(dir, 'compass', 'tasks', f);
    await writeFile(p, canonical({ ...JSON.parse(await readFile(p, 'utf8')), refs: [] }));
  }
  return dir;
}
const cliIn = (dir) => async (...argv) => {
  let out = '', err = '';
  const code = await run(argv, { cwd: dir, out: { write: (s) => { out += s; } }, err: { write: (s) => { err += s; } } });
  return { code, out, err };
};

test('checkRefs: rotas, frágiles y enlaces en línea (los de dentro de `código` no cuentan)', async () => {
  const docs = await loadDocs('/', { docs: [] });
  docs.push({ alias: 'gdd', path: 'gdd.md', ...parseSections(MD) });
  const problems = checkRefs(docs, [{
    id: 't1', refs: [{ doc: 'gdd.md', section: 'combate' }, { doc: 'gdd.md', section: 'borrada' }, { doc: 'otro.md', section: 'x' }],
    notes: 'ver [[gdd#sin-id-con-tildes]] y `[[gdd#ejemplo]]`', test: '[[gdd#camara]]', checklist: [{ text: 'paso [[gdd#nada]]', done: false }]
  }]);
  assert.deepEqual(problems.map((p) => [p.ref, p.where, p.problem]), [
    ['gdd.md#borrada', 'refs', 'missing_section'], ['otro.md#x', 'refs', 'missing_doc'],
    ['gdd#sin-id-con-tildes', 'notes', 'fragile'], ['gdd#nada', 'paso 1', 'missing_section']
  ]);
});

test('ref add/rm y refs check: renombrar el título no rompe; borrar el id sí', async () => {
  const dir = await projectWithGdd();
  const cli = cliIn(dir);
  try {
    assert.equal((await cli('ref', 'add', 'm1-07', 'gdd#ventanas-ataque')).code, 0);
    assert.deepEqual(JSON.parse(await readFile(join(dir, 'compass', 'tasks', 'm1-07.json'), 'utf8')).refs, [{ doc: 'gdd.md', section: 'ventanas-ataque' }]);
    assert.match((await cli('ref', 'add', 'm1-07', 'gdd#ventanas-ataque')).out, /ya referencia/);
    assert.equal((await cli('ref', 'add', 'm1-07', 'gdd#nada')).code, 1);
    assert.equal((await cli('refs', 'check')).code, 0);

    await writeFile(join(dir, 'gdd.md'), MD.replace('### Ventanas de ataque: `AttackData`', '### 7.2 Golpes con ventanas'));
    assert.equal((await cli('refs', 'check')).code, 0, 'renombrar y renumerar no rompe');

    await writeFile(join(dir, 'gdd.md'), MD.replace('<!-- id: ventanas-ataque -->\n', ''));
    const r = await cli('refs', 'check', '--json');
    assert.equal(r.code, 1);
    assert.deepEqual(JSON.parse(r.out).broken.map((b) => [b.task, b.ref]), [['m1-07', 'gdd.md#ventanas-ataque']]);

    assert.equal((await cli('ref', 'rm', 'm1-07', 'gdd#ventanas-ataque')).code, 0);
    assert.equal((await cli('refs', 'check')).code, 0);
    assert.equal((await cli('ref', 'rm', 'm1-07', 'gdd#ventanas-ataque')).code, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('stamp-ids estampa el slug actual (las refs frágiles siguen resolviendo) y no toca lo demás', async () => {
  const { text, stamped } = stampIds(MD);
  assert.deepEqual(stamped, ['sin-id-con-tildes']);
  assert.equal(text, MD.replace('### Sin id, con tildés\n', '### Sin id, con tildés\n<!-- id: sin-id-con-tildes -->\n'));
  assert.deepEqual(stampIds(text).stamped, []);
  const dir = await projectWithGdd();
  try {
    const cli = cliIn(dir);
    assert.match((await cli('doc', 'stamp-ids', 'gdd', '--dry-run')).out, /Se estamparían 1/);
    assert.equal(await readFile(join(dir, 'gdd.md'), 'utf8'), MD);
    assert.equal((await cli('doc', 'stamp-ids', 'gdd')).code, 0);
    assert.equal(await readFile(join(dir, 'gdd.md'), 'utf8'), text);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('refs check en los proyectos reales: sin referencias rotas', async () => {
  for (const p of [REPO, EPIPHANY].filter((x) => existsSync(join(x, 'compass')))) {
    const r = await run(['--dir', p, '--direct', 'refs', 'check'], { out: { write() {} }, err: { write() {} } });
    assert.equal(r, 0, p);
  }
});
