// Catálogos de la interfaz (spec §45, D56). Junta los textos que se traducen y los compara con los .po en inglés.
//
//   node tools/i18n.mjs check    lista lo que falta traducir, lo que sobra y los {n} o %s que no coinciden (sale con 1)
//   node tools/i18n.mjs sync     agrega al .po de cada área los textos nuevos (con msgstr vacío) y quita los que
//                                ya no se usan; después se completan a mano los msgstr ""
//   check|sync <área>…           solo esas áreas: cli, mcp, hub, web, home o addon
//
// Qué se junta: en JS, T`…` y T('…'); en el HTML de la web, los textos y los atributos title, placeholder,
// aria-label y alt; en GDScript, I18n.t("…") y I18n.t("…" % …).
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePo, poEntry } from '../hub/src/i18n.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const HUB_PO = join(REPO, 'hub', 'locales', 'en');
const ADDON_PO = join(REPO, 'addons', 'scope_compass', 'i18n');

const js = (dir, filter = () => true) => readdirSync(join(REPO, dir)).filter((f) => f.endsWith('.js') && filter(f)).map((f) => join(dir, f));

/** Las áreas: qué archivos usan cada catálogo. */
export const AREAS = [
  { area: 'cli', po: join(HUB_PO, 'cli.po'), files: ['hub/src/cli.js'] },
  { area: 'mcp', po: join(HUB_PO, 'mcp.po'), files: ['hub/src/mcp.js'] },
  { area: 'hub', po: join(HUB_PO, 'hub.po'), files: [...js('hub/src', (f) => !['cli.js', 'mcp.js', 'i18n.js'].includes(f)), ...js('hub/src/store')] },
  { area: 'web', po: join(HUB_PO, 'web.po'), files: ['web/app.js', 'web/settings.js', 'web/index.html'] },
  { area: 'home', po: join(HUB_PO, 'home.po'), files: ['web/home.js', 'web/home.html'] },
  { area: 'addon', po: join(ADDON_PO, 'en.po'), files: readdirSync(join(REPO, 'addons', 'scope_compass')).filter((f) => f.endsWith('.gd') && f !== 'i18n.gd').map((f) => `addons/scope_compass/${f}`) }
];

// ---- JS ----

/** Los textos de T`…` y T('…') en un archivo JS, con su línea. */
export function extractJs(src) {
  const out = [];
  const line = (i) => src.slice(0, i).split('\n').length;
  let i = 0;
  // Saltea un string '…' o "…" desde i (en la comilla); devuelve el índice después del cierre.
  const skipQuoted = (j) => {
    const q = src[j];
    for (j++; j < src.length && src[j] !== q; j++) if (src[j] === '\\') j++;
    return j + 1;
  };
  // Lee un template desde i (en el `); devuelve [pedazos, fin]. Los ${…} se saltean contando llaves, con strings,
  // templates y comentarios adentro.
  const readTemplate = (j) => {
    const parts = [''];
    for (j++; j < src.length; j++) {
      const c = src[j];
      if (c === '\\') { parts[parts.length - 1] += unescapeJs(src.slice(j, j + 2)); j++; continue; }
      if (c === '`') return [parts, j + 1];
      if (c === '$' && src[j + 1] === '{') {
        j = skipExpr(j + 2);
        parts.push('');
        j--;
        continue;
      }
      parts[parts.length - 1] += c;
    }
    return [parts, j];
  };
  // Un / donde empieza una expresión abre una regex (/`/g no es un template).
  const regexAt = (j) => /(^|[(,=:[!&|?{};+]|\breturn)\s*$/.test(src.slice(Math.max(0, j - 20), j));
  const skipRegex = (j) => {
    let cls = false;
    for (j++; j < src.length; j++) {
      const d = src[j];
      if (d === '\\') { j++; continue; }
      if (d === '[') cls = true;
      else if (d === ']') cls = false;
      else if ((d === '/' && !cls) || d === '\n') break;
    }
    return j + 1;
  };
  // Un T`…` o T('…') en j (también dentro de un ${…}): lo anota y devuelve dónde termina; -1 si no hay.
  const callAt = (j) => {
    if (src[j] !== 'T' || /[\w$.]/.test(src[j - 1] ?? '')) return -1;
    if (src[j + 1] === '`') {
      const [parts, end] = readTemplate(j + 1);
      out.push({ id: parts.reduce((a, s, k) => (k === 0 ? s : `${a}{${k - 1}}${s}`), ''), line: line(j) });
      return end;
    }
    if (src[j + 1] === '(' && (src[j + 2] === '\'' || src[j + 2] === '"')) {
      const end = skipQuoted(j + 2);
      out.push({ id: unescapeJs(src.slice(j + 3, end - 1)), line: line(j) });
      return end;
    }
    return -1;
  };
  const skipExpr = (j) => {
    let depth = 1;
    while (j < src.length) {
      const c = src[j];
      const call = callAt(j);
      if (call >= 0) { j = call; continue; }
      if (c === '\'' || c === '"') { j = skipQuoted(j); continue; }
      if (c === '`') { j = readTemplate(j)[1]; continue; }
      if (c === '/' && src[j + 1] === '/') { j = src.indexOf('\n', j); continue; }
      if (c === '/' && src[j + 1] === '*') { j = src.indexOf('*/', j) + 2; continue; }
      if (c === '/' && regexAt(j)) { j = skipRegex(j); continue; }
      if (c === '{') depth++;
      if (c === '}' && --depth === 0) return j + 1;
      j++;
    }
    return j;
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 2; continue; }
    if (c === '\'' || c === '"') { i = skipQuoted(i); continue; }
    if (c === '/' && regexAt(i)) { i = skipRegex(i); continue; }
    const call = c === 'T' && !/[\w$.]/.test(src[i - 1] ?? '');
    if (call && src[i + 1] === '`') {
      const [parts, end] = readTemplate(i + 1);
      out.push({ id: parts.reduce((a, s, k) => (k === 0 ? s : `${a}{${k - 1}}${s}`), ''), line: line(i) });
      i = end;
      continue;
    }
    if (call && src[i + 1] === '(' && (src[i + 2] === '\'' || src[i + 2] === '"')) {
      const end = skipQuoted(i + 2);
      out.push({ id: unescapeJs(src.slice(i + 3, end - 1)), line: line(i) });
      i = end;
      continue;
    }
    if (c === '`') { i = readTemplate(i)[1]; continue; }
    i++;
  }
  return out;
}

const ESC = { n: '\n', t: '\t', r: '\r', '\\': '\\', '\'': '\'', '"': '"', '`': '`', $: '$' };
function unescapeJs(s) {
  return s.replace(/\\(u\{[\da-f]+\}|u[\da-f]{4}|x[\da-f]{2}|.)/gi, (m, e) => {
    if (/^u\{/i.test(e)) return String.fromCodePoint(parseInt(e.slice(2, -1), 16));
    if (/^[ux]/i.test(e) && e.length > 1) return String.fromCharCode(parseInt(e.slice(1), 16));
    return ESC[e] ?? e;
  });
}

// ---- HTML ----

/** Textos fijos de un .html: nodos de texto (sin script ni style) y atributos que se leen. */
export function extractHtml(src) {
  const out = [];
  const body = src.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
  const line = (i) => body.slice(0, i).split('\n').length;
  const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&nbsp;/g, ' ');
  for (const m of body.matchAll(/>([^<]+)</g)) {
    const s = decode(m[1]).trim();
    if (s && /\p{L}/u.test(s)) out.push({ id: s, line: line(m.index) });
  }
  for (const m of body.matchAll(/\s(?:title|placeholder|aria-label|alt)="([^"]*)"/g)) {
    const s = decode(m[1]);
    if (s && /\p{L}/u.test(s)) out.push({ id: s, line: line(m.index) });
  }
  return out;
}

// ---- GDScript ----

/** I18n.t("…") en GDScript (el texto puede tener %s, %d: se formatea después de traducir). */
export function extractGd(src) {
  const out = [];
  for (const m of src.matchAll(/\bI18n\.t\(\s*"((?:[^"\\]|\\.)*)"/g)) {
    out.push({ id: unescapeJs(m[1]), line: src.slice(0, m.index).split('\n').length });
  }
  return out;
}

const extract = (file) => {
  const src = readFileSync(join(REPO, file), 'utf8');
  if (file.endsWith('.html')) return extractHtml(src);
  if (file.endsWith('.gd')) return extractGd(src);
  return extractJs(src);
};

// ---- Comparar ----

const holes = (s) => (s.match(/\{\d+\}|%[sd%]/g) ?? []).sort().join(' ');

/** Por área: los textos usados (con dónde), los del .po, lo que falta, lo que sobra y lo que no coincide. */
export function report(only = []) {
  return AREAS.filter((a) => !only.length || only.includes(a.area)).map((a) => {
    const used = new Map();
    for (const f of a.files) for (const { id, line } of extract(f)) if (!used.has(id)) used.set(id, `${f}:${line}`);
    const po = existsSync(a.po) ? parsePo(readFileSync(a.po, 'utf8')) : {};
    const raw = existsSync(a.po) ? rawIds(readFileSync(a.po, 'utf8')) : [];
    const missing = [...used.keys()].filter((id) => !po[id]);
    const unused = raw.filter((id) => !used.has(id));
    const mismatch = [...used.keys()].filter((id) => po[id] && holes(id) !== holes(po[id]));
    return { ...a, used, tr: po, raw, missing, unused, mismatch };
  });
}

// Todos los msgid de un .po, también los que tienen msgstr vacío.
function rawIds(text) {
  const ids = [];
  const parts = text.split(/\r?\n\r?\n/);
  for (const p of parts) {
    const m = p.match(/^msgid ("(?:[^"\\]|\\.)*")((?:\n"(?:[^"\\]|\\.)*")*)/m);
    if (!m) continue;
    const id = JSON.parse(m[1]) + (m[2] ? m[2].split('\n').filter(Boolean).map((x) => JSON.parse(x)).join('') : '');
    if (id) ids.push(id);
  }
  return ids;
}

// La cabecera que Godot lee para saber la codificación y el idioma.
const PO_HEADER = 'msgid ""\nmsgstr ""\n"Content-Type: text/plain; charset=UTF-8\\n"\n"Language: en\\n"\n';

function sync(r) {
  const text = existsSync(r.po) ? readFileSync(r.po, 'utf8') : '';
  const header = text.match(/^(#[^\n]*\n)+/)?.[0] || `# ${relative(REPO, r.po)}: los textos de ${r.files.length === 1 ? r.files[0] : relative(REPO, dirname(r.files[0]))} en inglés (spec §45). msgid: el castellano del código.\n`;
  // Se mantiene el orden del código, así una traducción queda cerca de las de su pantalla.
  const ids = [...r.used.keys()];
  const body = ids.map((id) => poEntry(id, r.tr[id] ?? '')).join('\n');
  mkdirSync(dirname(r.po), { recursive: true });
  writeFileSync(r.po, `${header}${PO_HEADER}\n${body}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2] ?? 'check';
  const only = process.argv.slice(3);
  const reports = report(only);
  if (cmd === 'sync') {
    for (const r of reports) sync(r);
  }
  let bad = 0;
  for (const r of (cmd === 'sync' ? report(only) : reports)) {
    const name = relative(REPO, r.po);
    for (const id of r.missing) { bad++; console.log(`${name}: falta ${JSON.stringify(id)} (${r.used.get(id)})`); }
    for (const id of r.unused) { bad++; console.log(`${name}: sobra ${JSON.stringify(id)}`); }
    for (const id of r.mismatch) { bad++; console.log(`${name}: no coinciden los huecos de ${JSON.stringify(id)} → ${JSON.stringify(r.tr[id])}`); }
    console.log(`${name}: ${r.used.size} textos, ${r.missing.length} sin traducir`);
  }
  process.exit(bad ? 1 : 0);
}
