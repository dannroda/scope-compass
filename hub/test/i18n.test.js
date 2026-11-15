// Idioma de la interfaz (§45, D56): cómo se elige, los .po, T`…` y que los catálogos estén completos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acceptLang, catalog, chosenLang, msgidOf, normalizeLang, parsePo, poEntry, processLang, requestLang, setChosenLang, systemLang, T, tr, withLang, webScript } from '../src/i18n.js';
import { report, extractJs, extractHtml, extractGd } from '../../tools/i18n.mjs';
import { createServer } from '../src/server.js';
import { createJsonFilesStore } from '../src/store/json-files.js';
import { loadValidators } from '../src/schema.js';
import { run } from '../src/cli.js';

// Sin SCOMPASS_LANG (run-tests.js lo fija en es): para probar cómo se elige.
async function unforced(fn) {
  const saved = process.env.SCOMPASS_LANG;
  delete process.env.SCOMPASS_LANG;
  try { return await fn(); } finally { process.env.SCOMPASS_LANG = saved; await setChosenLang(null); }
}

test('normalizeLang y acceptLang: es o en, cualquier otro idioma en inglés', () => {
  assert.equal(normalizeLang('es_AR.UTF-8'), 'es');
  assert.equal(normalizeLang('es-419'), 'es');
  assert.equal(normalizeLang('en_US'), 'en');
  assert.equal(normalizeLang('fr_FR'), 'en');
  assert.equal(normalizeLang('C'), null);
  assert.equal(normalizeLang(''), null);
  assert.equal(acceptLang('fr-FR,fr;q=0.9,es;q=0.8'), 'en');
  assert.equal(acceptLang('en;q=0.5,es-AR'), 'es');
  assert.equal(acceptLang(undefined), null);
});

test('el idioma del sistema sale de LC_ALL, LC_MESSAGES o LANG, en ese orden', () => {
  assert.equal(systemLang({ LANG: 'es_AR.UTF-8' }), 'es');
  assert.equal(systemLang({ LC_ALL: 'en_US.UTF-8', LANG: 'es_AR.UTF-8' }), 'en');
  assert.equal(systemLang({ LC_MESSAGES: 'es_ES', LANG: 'en_US' }), 'es');
});

test('SCOMPASS_LANG gana sobre el elegido, y el elegido sobre el sistema y el navegador', async () => {
  await unforced(async () => {
    assert.equal(processLang({ LANG: 'es_AR' }), 'es');
    assert.equal(requestLang({ 'accept-language': 'en-US' }, {}), 'en');
    await setChosenLang('es');
    assert.equal(chosenLang(), 'es');
    assert.equal(processLang({ LANG: 'en_US' }), 'es');
    assert.equal(requestLang({ 'accept-language': 'en-US' }, {}), 'es');
    assert.equal(processLang({ LANG: 'es_AR', SCOMPASS_LANG: 'en' }), 'en');
    await setChosenLang(null);
    assert.equal(chosenLang(), null);
  });
});

test('parsePo lee msgid y msgstr de varias líneas y saltea la cabecera y los vacíos', () => {
  const po = `# comentario\nmsgid ""\nmsgstr "Language: en\\n"\n\nmsgid "Hola {0}"\nmsgstr ""\n"Hello "\n"{0}"\n\nmsgid "Sin traducir"\nmsgstr ""\n\n${poEntry('Dos\nlíneas "x"', 'Two\nlines "x"')}`;
  assert.deepEqual(parsePo(po), { 'Hola {0}': 'Hello {0}', 'Dos\nlíneas "x"': 'Two\nlines "x"' });
});

test('T`…` arma la clave con {0}, {1}… y traduce en el idioma del pedido', async () => {
  assert.equal(msgidOf(['Tarea ', ' movida a ', '']), 'Tarea {0} movida a {1}');
  assert.equal(T`no existe ${'x'}`, 'no existe x');
  const id = Object.keys(catalog('en'))[0];
  assert.ok(id, 'hay al menos un texto traducido');
  assert.equal(withLang('en', () => tr(id)), catalog('en')[id]);
  assert.equal(withLang('es', () => tr(id)), id);
});

test('extraer los textos: T en JS (con templates adentro), el HTML y I18n.t en GDScript', () => {
  const src = "const t = 1; T`Tarea ${t.id} en ${x ? `a${y}` : 'b'}` + T('Hecho') + T(\"Dijo \\\"no\\\"\") // T`comentario`\nconst s = 'T`no`';";
  assert.deepEqual(extractJs(src).map((x) => x.id), ['Tarea {0} en {1}', 'Hecho', 'Dijo "no"']);
  assert.deepEqual(extractHtml('<button title="Cerrar">Guardar &amp; salir</button><script>x("no")</script><span>·</span>').map((x) => x.id).sort(), ['Cerrar', 'Guardar & salir']);
  assert.deepEqual(extractGd('label.text = I18n.t("Hub en %s") % url\nI18n.t("Listo")').map((x) => x.id), ['Hub en %s', 'Listo']);
});

test('los catálogos en inglés tienen cada texto que se usa, con los mismos huecos, y nada de más', () => {
  const problems = [];
  for (const r of report()) {
    for (const id of r.missing) problems.push(`${r.po}: falta ${JSON.stringify(id)} (${r.used.get(id)})`);
    for (const id of r.unused) problems.push(`${r.po}: sobra ${JSON.stringify(id)}`);
    for (const id of r.mismatch) problems.push(`${r.po}: huecos distintos en ${JSON.stringify(id)}`);
  }
  assert.deepEqual(problems.slice(0, 20), [], `${problems.length} problemas; node tools/i18n.mjs check`);
});

test('el hub sirve /i18n.js en el idioma del navegador y PUT /api/lang lo fija', async () => {
  await unforced(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'scompass-i18n-'));
    try {
      mkdirSync(join(dir, 'compass'));
      writeFileSync(join(dir, 'compass', 'config.json'), JSON.stringify({ project: 'P' }));
      const validators = loadValidators();
      const app = createServer({ projectDir: dir, store: createJsonFilesStore(join(dir, 'compass'), { validators }), validators });
      const js = (lang) => app.inject({ url: '/i18n.js', headers: { 'accept-language': lang } }).then((r) => r.body);
      assert.match(await js('en-US,en;q=0.9'), /var lang = "en"/);
      assert.match(await js('es-AR'), /var lang = "es";\s+var messages = \{\}/);
      const put = await app.inject({ method: 'PUT', url: '/api/lang', payload: { lang: 'es' } });
      assert.deepEqual(put.json(), { lang: 'es', chosen: 'es' });
      assert.match(await js('en-US'), /var lang = "es"/);
      assert.equal((await app.inject({ method: 'PUT', url: '/api/lang', payload: { lang: 'fr' } })).statusCode, 400);
      await app.inject({ method: 'PUT', url: '/api/lang', payload: { lang: null } });
      assert.equal((await app.inject({ url: '/api/lang', headers: { 'accept-language': 'en' } })).json().lang, 'en');
      // Un error del hub en el idioma del pedido.
      const missing = await app.inject({ url: '/api/nada', headers: { 'accept-language': 'en' } });
      assert.doesNotMatch(missing.json().error.message, /no existe/);
      await app.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

test('webScript: el catálogo de la web no trae los textos de la CLI', () => {
  const js = webScript('en');
  const cli = Object.keys(catalog('en', { areas: ['cli'] }));
  const web = catalog('en', { areas: ['web', 'home'] });
  const only = cli.find((id) => !(id in web));
  if (only) assert.ok(!js.includes(JSON.stringify(only)));
});

test('scompass lang: muestra, fija y vuelve a auto', async () => {
  await unforced(async () => {
    const out = [];
    const io = { out: { write: (s) => out.push(s) }, err: { write: (s) => out.push(s) }, cwd: tmpdir() };
    assert.equal(await run(['lang', 'en'], io), 0);
    assert.equal(chosenLang(), 'en');
    assert.equal(await run(['lang', '--json'], io), 0);
    assert.deepEqual(JSON.parse(out.at(-1)), { lang: 'en', chosen: 'en' });
    assert.equal(await run(['lang', 'auto'], io), 0);
    assert.equal(chosenLang(), null);
    assert.equal(await run(['lang', 'fr'], io), 2);
  });
});

test('init --lang en: el tablero en inglés (config.language, la guía, el README, el export y la plantilla); update la mantiene', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'scompass-i18n-init-'));
  try {
    const out = [];
    const io = { out: { write: (s) => out.push(s) }, err: { write: (s) => out.push(s) }, cwd: dir };
    assert.equal(await run(['--dir', dir, 'init', '--in-project', '--template', 'game', '--lang', 'en'], io), 0, out.join(''));
    const read = (f) => readFileSync(join(dir, f), 'utf8');
    const config = JSON.parse(read('compass/config.json'));
    assert.equal(config.language, 'en');
    assert.equal(config.export_md, 'docs/tasks.md');
    assert.equal(read('compass/AGENTS.md'), readFileSync(new URL('../templates/compass-AGENTS.en.md', import.meta.url), 'utf8'));
    assert.equal(read('compass/README.md'), readFileSync(new URL('../templates/compass-README.en.md', import.meta.url), 'utf8'));
    assert.equal(JSON.parse(read('compass/milestones/m00.json')).title, 'Prototype');
    assert.match(read('docs/gdd.md'), /^# Game design document/);
    assert.match(read('docs/tasks.md'), /Prototype/);
    // update no la vuelve a pasar al castellano.
    assert.equal(await run(['--dir', dir, 'update', '--check'], io), 0);
    assert.equal(await run(['--dir', join(dir, 'otro'), 'init', '--in-project', '--lang', 'fr'], io), 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('la guía en inglés tiene su copia igual en el addon, como la de castellano', () => {
  const tpl = readFileSync(new URL('../templates/compass-AGENTS.en.md', import.meta.url), 'utf8');
  assert.equal(readFileSync(new URL('../../addons/scope_compass/AGENTS.en.md', import.meta.url), 'utf8'), tpl);
});
