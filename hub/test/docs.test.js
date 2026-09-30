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
