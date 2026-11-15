// Idioma de la interfaz (spec §45, D56). El texto fuente es el castellano del código y es la clave: T`Tarea ${id}`
// busca "Tarea {0}" en el catálogo del idioma y, si no está (o el idioma es es), devuelve el castellano. Los catálogos
// son .po en hub/locales/<idioma>/*.po, uno por área (cli, hub, web, home…), sin librerías.
//
// El idioma: SCOMPASS_LANG, si no el que el usuario eligió (<config>/settings.json › language, `scompass lang`, el
// selector de la web), si no el del sistema (LC_ALL, LC_MESSAGES, LANG o el de Intl) en la CLI y el MCP, y el del
// navegador (Accept-Language) en cada pedido al hub o al Inicio. Un pedido corre con su idioma (withLang).
import { AsyncLocalStorage } from 'node:async_hooks';
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { writeAtomic } from './store/atomic.js';
import { configDir } from './projects.js';
import { resourceDir } from './schema.js';

export const LANGS = ['en', 'es'];
// Se calcula al usarlo: schema.js importa este módulo (sus mensajes), y resourceDir todavía no existe al cargarlo.
const localesDir = () => resourceDir('locales');

/** 'es' o 'en' para un código como es_AR.UTF-8, es-419 o en-US; null si no hay nada. Otro idioma, en. */
export function normalizeLang(code) {
  if (!code || typeof code !== 'string') return null;
  const c = code.trim().toLowerCase();
  if (!c || c === 'c' || c === 'posix' || c === 'auto') return null;
  return c.startsWith('es') ? 'es' : 'en';
}

/** El primer idioma de un Accept-Language ("es-AR,es;q=0.9,en;q=0.8"), por su q. */
export function acceptLang(header) {
  if (!header) return null;
  const ranked = String(header).split(',').map((part, i) => {
    const [tag, ...params] = part.trim().split(';');
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    return { tag: tag.trim(), q: q ? Number(q.slice(2)) : 1, i };
  }).filter((x) => x.tag && x.tag !== '*' && x.q > 0).sort((a, b) => b.q - a.q || a.i - b.i);
  return normalizeLang(ranked[0]?.tag);
}

// ---- Lo que eligió el usuario ----

export const settingsFile = () => join(configDir(), 'settings.json');

function readSettings() {
  try {
    return JSON.parse(readFileSync(settingsFile(), 'utf8'));
  } catch {
    return {};
  }
}

/** El idioma elegido ('es' | 'en') o null si sigue al sistema o al navegador. */
export function chosenLang() {
  const v = readSettings().language;
  return LANGS.includes(v) ? v : null;
}

/** Guarda el idioma elegido; null (o 'auto') vuelve a seguir al sistema. */
export async function setChosenLang(lang) {
  const s = readSettings();
  if (LANGS.includes(lang)) s.language = lang;
  else delete s.language;
  mkdirSync(dirname(settingsFile()), { recursive: true });
  await writeAtomic(settingsFile(), `${JSON.stringify(s, null, 2)}\n`);
}

/** El idioma del sistema, para la CLI y el MCP. */
export function systemLang(env = process.env) {
  for (const k of ['LC_ALL', 'LC_MESSAGES', 'LANG']) {
    const l = normalizeLang(env[k]);
    if (l) return l;
  }
  // Windows no pone LANG: el formato regional del sistema.
  try {
    return normalizeLang(Intl.DateTimeFormat().resolvedOptions().locale) ?? 'en';
  } catch {
    return 'en';
  }
}

/** El idioma de este proceso: SCOMPASS_LANG, el elegido o el del sistema. */
export function processLang(env = process.env) {
  return normalizeLang(env.SCOMPASS_LANG) ?? chosenLang() ?? systemLang(env);
}

/** El idioma de un pedido HTTP: SCOMPASS_LANG, el elegido o el del navegador (o el del proceso). */
export function requestLang(headers = {}, env = process.env) {
  return normalizeLang(env.SCOMPASS_LANG) ?? chosenLang() ?? acceptLang(headers['accept-language']) ?? processLang(env);
}

// ---- Catálogos ----

/** Entradas de un .po: { msgid: msgstr }, sin la cabecera ni las vacías. */
export function parsePo(text) {
  const out = {};
  let id = null;
  let str = null;
  let field = null;
  const unq = (s) => JSON.parse(s);
  const flush = () => {
    if (id && str) out[id] = str;
    id = str = field = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) {
      if (!line) flush();
      continue;
    }
    if (line.startsWith('msgid ')) {
      flush();
      id = unq(line.slice(6));
      field = 'id';
    } else if (line.startsWith('msgstr ')) {
      str = unq(line.slice(7));
      field = 'str';
    } else if (line.startsWith('"')) {
      if (field === 'id') id += unq(line);
      else if (field === 'str') str += unq(line);
    }
  }
  flush();
  return out;
}

/** Una entrada de .po (para escribir catálogos desde los tests o a mano). */
export const poEntry = (id, str) => `msgid ${JSON.stringify(id)}\nmsgstr ${JSON.stringify(str)}\n`;

const catalogs = new Map();
/**
 * El catálogo de un idioma: todas sus áreas juntas, o solo las de areas (la web no necesita los textos de la CLI).
 * Castellano: vacío.
 */
export function catalog(lang, { dir = localesDir(), areas = null } = {}) {
  if (lang === 'es') return {};
  const key = `${dir}\0${lang}\0${areas ?? '*'}`;
  if (!catalogs.has(key)) {
    const all = {};
    let files = [];
    try {
      files = readdirSync(join(dir, lang)).filter((f) => f.endsWith('.po') && (!areas || areas.includes(f.slice(0, -3)))).sort();
    } catch { /* sin catálogo */ }
    for (const f of files) Object.assign(all, parsePo(readFileSync(join(dir, lang, f), 'utf8')));
    catalogs.set(key, all);
  }
  return catalogs.get(key);
}

// ---- Traducir ----

const als = new AsyncLocalStorage();
let fixedLang = null;

/** El idioma en que se traduce ahora: el del pedido en curso o el del proceso. */
export function currentLang() {
  return als.getStore() ?? (fixedLang ??= processLang());
}

/** Fija el idioma del proceso (la CLI después de leer --lang, los tests). null: volver a calcularlo. */
export function setLang(lang) {
  fixedLang = lang ? normalizeLang(lang) : null;
}

/** Corre fn con este idioma (cada pedido al hub o al Inicio). */
export const withLang = (lang, fn) => als.run(normalizeLang(lang) ?? currentLang(), fn);

/** Reemplaza {0}, {1}… por los valores. */
export const fill = (s, args) => s.replace(/\{(\d+)\}/g, (m, n) => (Number(n) < args.length ? String(args[n]) : m));

/** La traducción de un texto con {0}, {1}…, en el idioma de ahora (o en lang). */
export function tr(msgid, args = [], lang = currentLang()) {
  return fill(catalog(lang)[msgid] ?? msgid, args);
}

/**
 * T`Tarea ${id} movida` o T('Hecho'). Con un template, la clave es el texto con {0}, {1}… en el lugar de cada valor.
 * Se llama T y no t porque t es un nombre común de variable (una tarea) y la taparía.
 */
export function T(strings, ...args) {
  if (typeof strings === 'string') return tr(strings, args);
  return tr(msgidOf(strings), args);
}

/** La clave de un template: los pedazos unidos con {0}, {1}… */
export const msgidOf = (strings) => strings.reduce((acc, s, i) => (i === 0 ? s : `${acc}{${i - 1}}${s}`), '');

/** Hook de Fastify: cada pedido corre con el idioma del navegador (o el elegido). */
export function langHook(app) {
  app.addHook('onRequest', (req, reply, done) => {
    req.lang = requestLang(req.headers);
    als.run(req.lang, done);
  });
}

/**
 * El idioma en el hub y el Inicio: el hook de cada pedido, /i18n.js para la web y GET/PUT /api/lang para el selector
 * de Ajustes ({ lang, chosen }; PUT { lang: 'es' | 'en' | null }).
 */
export function langRoutes(app) {
  langHook(app);
  app.get('/i18n.js', async (req, reply) => reply.type('text/javascript; charset=utf-8').header('cache-control', 'no-cache').send(webScript(req.lang)));
  app.get('/api/lang', async (req) => ({ lang: req.lang, chosen: chosenLang(), forced: normalizeLang(process.env.SCOMPASS_LANG) }));
  app.put('/api/lang', async (req, reply) => {
    const lang = req.body?.lang ?? null;
    if (lang !== null && lang !== 'auto' && !LANGS.includes(lang)) {
      return reply.code(400).send({ error: { code: 'invalid_argument', message: T`idioma inválido: ${lang} (es, en o null)` } });
    }
    await setChosenLang(lang);
    return { lang: requestLang(req.headers), chosen: chosenLang() };
  });
}

/** El JS que la web carga antes de app.js o home.js (/i18n.js): el idioma, el catálogo y t(). */
export function webScript(lang, areas = ['web', 'home']) {
  const messages = catalog(lang, { areas });
  return `// Generado por el hub (hub/src/i18n.js): el idioma de la página y su catálogo.
(function () {
  var lang = ${JSON.stringify(lang)};
  var messages = ${JSON.stringify(messages)};
  var fill = function (s, args) { return s.replace(/\\{(\\d+)\\}/g, function (m, n) { return n < args.length ? String(args[n]) : m; }); };
  function tr(id, args) { return fill(Object.prototype.hasOwnProperty.call(messages, id) ? messages[id] : id, args || []); }
  // T\`Tarea \${id}\` o T('Hecho').
  function T(strings) {
    var args = Array.prototype.slice.call(arguments, 1);
    if (typeof strings === 'string') return tr(strings, args);
    var id = strings[0];
    for (var i = 1; i < strings.length; i++) id += '{' + (i - 1) + '}' + strings[i];
    return tr(id, args);
  }
  // Los textos fijos del HTML: nodos de texto y los atributos que se leen (title, placeholder, aria-label, alt).
  var ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];
  function dom(root) {
    if (lang === 'es') return;
    var w = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT);
    for (var n = w.nextNode(); n; n = w.nextNode()) {
      var p = n.parentNode && n.parentNode.nodeName;
      if (p === 'SCRIPT' || p === 'STYLE') continue;
      var s = n.nodeValue, k = s.trim();
      if (k && Object.prototype.hasOwnProperty.call(messages, k)) n.nodeValue = s.replace(k, messages[k]);
    }
    var els = (root || document).querySelectorAll('[title],[placeholder],[aria-label],[alt]');
    for (var i = 0; i < els.length; i++) {
      for (var j = 0; j < ATTRS.length; j++) {
        var v = els[i].getAttribute(ATTRS[j]);
        if (v && Object.prototype.hasOwnProperty.call(messages, v)) els[i].setAttribute(ATTRS[j], messages[v]);
      }
    }
    if (document.title && Object.prototype.hasOwnProperty.call(messages, document.title)) document.title = messages[document.title];
  }
  document.documentElement.lang = lang;
  window.I18N = { lang: lang, T: T, dom: dom };
  window.T = T;
})();
`;
}
