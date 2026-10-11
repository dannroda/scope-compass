// Documentos del proyecto (spec §10): índice de secciones con ids estables y resolución de referencias.
// Solo lectura: los documentos se editan donde siempre; acá se leen.
import { readFile, stat } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { canonical } from './store/canonical.js';
import { writeAtomic } from './store/atomic.js';
import { parseDoc } from './schema.js';
import { StoreError } from './store/json-files.js';
import { repoFiles } from './git.js';
import { projectRel, realInside } from './paths.js';

const HEADING = /^(#{1,6})[ \t]+(.+?)[ \t#]*$/;
const ID_COMMENT = /^<!--\s*id:\s*([a-z0-9][a-z0-9_-]*)\s*-->\s*$/;
const FENCE = /^\s{0,3}(```|~~~)/;

// Slug del título: minúsculas, sin tildes, sin `código` ni puntuación, espacios a guiones.
export function slugify(title) {
  return title.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/`/g, '').replace(/[^a-z0-9\s-]/g, '').trim().replace(/[\s-]+/g, '-');
}

/**
 * Índice de secciones de un markdown. Cada sección: { id, title, level, start, end, explicit }, con start y end
 * como líneas (0-based, end exclusiva). Una sección es su título más todo hasta el próximo título de nivel
 * igual o superior. explicit: false si el id sale del slug del título (referencia frágil).
 */
export function parseSections(text) {
  const lines = text.split('\n');
  const heads = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const f = FENCE.exec(lines[i]);
    if (f) { fence = fence === null ? f[1] : (f[1] === fence ? null : fence); continue; }
    if (fence) continue;
    const h = HEADING.exec(lines[i]);
    if (!h) continue;
    const title = h[2].trim();
    const idLine = lines[i + 1] !== undefined ? ID_COMMENT.exec(lines[i + 1].trim()) : null;
    heads.push({ title, level: h[1].length, start: i, explicit: !!idLine, id: idLine ? idLine[1] : slugify(title) });
  }
  const seen = new Map();
  const warnings = [];
  for (let k = 0; k < heads.length; k++) {
    const s = heads[k];
    let end = lines.length;
    for (let j = k + 1; j < heads.length; j++) if (heads[j].level <= s.level) { end = heads[j].start; break; }
    s.end = end;
    // Un id explícito repetido es un error del documento; un slug repetido se desambigua.
    if (seen.has(s.id)) {
      if (s.explicit && seen.get(s.id).explicit) warnings.push({ code: 'duplicate_id', message: `id repetido: ${s.id} (líneas ${seen.get(s.id).start + 1} y ${s.start + 1})` });
      let n = 2;
      while (seen.has(`${s.id}-${n}`)) n++;
      if (!s.explicit) s.id = `${s.id}-${n}`;
    }
    if (!seen.has(s.id)) seen.set(s.id, s);
  }
  return { sections: heads, lines, warnings };
}

// Carpeta fija del comienzo de un patrón ("docs/**/*.md" → "docs/"; "*.md" → "").
export const globBase = (pattern) => pattern.slice(0, pattern.indexOf('*')).replace(/[^/]*$/, '');
// Carpetas que un patrón nunca recorre: las ocultas (.git, .godot) y node_modules.
const SKIP_DIR = /(^|[\\/])(node_modules|\.[^\\/]+)$/;

/**
 * Archivos de config.json › docs: [{ alias, path }] (path relativo al proyecto, con "/"). Una entrada puede ser
 * un patrón (docs/**\/*.md): toma los archivos que no están declarados aparte ni son el export markdown, y cada
 * uno tiene como alias "<alias>/<ruta desde la carpeta fija, sin .md>" (D33).
 */
export async function docFiles(projectDir, config) {
  const entries = config?.docs ?? [];
  const taken = new Set([...entries.filter((e) => !e.path.includes('*')).map((e) => e.path), config?.export_md].filter(Boolean));
  const out = [];
  for (const entry of entries) {
    if (!entry.path.includes('*')) { out.push({ alias: entry.alias, path: entry.path }); continue; }
    // Un patrón que podría salir del proyecto ({..,x}, ../) no se recorre (19.2); el schema ya no lo deja pasar.
    if (!projectRel(entry.path)) continue;
    const base = globBase(entry.path);
    // Rutas dentro del proyecto siempre con "/", como en git: glob devuelve las de Windows con "\".
    const files = (await Array.fromAsync(glob(entry.path, { cwd: projectDir, exclude: (p) => SKIP_DIR.test(p) })))
      .map((f) => f.split(sep).join('/')).filter((f) => !taken.has(f) && f.endsWith('.md')).sort();
    for (const rel of files) {
      // Un enlace simbólico (o una carpeta enlazada) que lleva afuera no es un documento del proyecto.
      if (await realInside(projectDir, join(projectDir, rel))) out.push({ alias: `${entry.alias}/${rel.slice(base.length).replace(/\.md$/, '')}`, path: rel });
    }
  }
  return out;
}

/** Los documentos de docFiles, leídos: [{ alias, path, sections, lines, warnings, missing? }]. */
export async function loadDocs(projectDir, config) {
  const out = [];
  for (const { alias, path } of await docFiles(projectDir, config)) {
    const inside = projectRel(path) && (await realInside(projectDir, join(projectDir, path)));
    const text = inside ? await readFile(join(projectDir, path), 'utf8').catch(() => null) : null;
    if (text === null) {
      out.push({ alias, path, missing: true, sections: [], lines: [], warnings: [{ code: 'missing_doc', message: inside ? `no existe ${path}` : `${path} está fuera del proyecto` }] });
      continue;
    }
    out.push({ alias, path: relative(projectDir, join(projectDir, path)).split(sep).join('/'), ...parseSections(text) });
  }
  return out;
}

const ALIAS = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * Cambia config.json › docs (12.2): add { alias, path } o remove alias. path: relativa al proyecto (o absoluta
 * dentro de él), un .md que existe y git no ignora, o un patrón con * que termina en .md; nada que pueda salir del
 * proyecto (19.2: ni .., ni llaves, ni un enlace simbólico). Lee la config en el momento, valida y escribe atómico.
 * Devuelve la entrada agregada o quitada.
 */
export async function changeDocs(projectDir, validators, { add, remove }) {
  const file = join(projectDir, 'compass', 'config.json');
  const res = parseDoc(await readFile(file, 'utf8').catch(() => ''), 'config', validators);
  if (!res.ok) throw new StoreError('invalid_file', `compass/config.json: ${res.message}`);
  const config = res.doc;
  const docs = config.docs ?? [];
  let entry, next;
  if (remove !== undefined) {
    entry = docs.find((d) => d.alias === remove);
    if (!entry) {
      const glob = docs.find((d) => d.path.includes('*') && String(remove).startsWith(d.alias + '/'));
      throw new StoreError('not_found', glob ? `"${remove}" sale del patrón ${glob.path}: quitá "${glob.alias}" o sacá el archivo de ahí` : `no hay un documento "${remove}"`);
    }
    next = docs.filter((d) => d !== entry);
  } else {
    const alias = String(add?.alias ?? '');
    if (!ALIAS.test(alias)) throw new StoreError('invalid_argument', `alias inválido: "${alias}" (minúsculas, números, - y _; empieza con letra o número)`);
    const raw = String(add?.path ?? '');
    const abs = isAbsolute(raw) ? relative(projectDir, raw).split(sep).join('/') : raw;
    const rel = projectRel(abs);
    if (!raw || !rel || !(await realInside(projectDir, join(projectDir, globBase(rel) || '.')))) throw new StoreError('invalid_argument', `la ruta tiene que estar dentro del proyecto: ${raw}`);
    if (!rel.endsWith('.md')) throw new StoreError('invalid_argument', `un documento es un archivo .md (o un patrón que termina en .md): ${raw}`);
    if (rel === config.export_md) throw new StoreError('invalid_argument', `${rel} es el export markdown del tablero: no es un documento`);
    if (!rel.includes('*')) {
      if (!(await stat(join(projectDir, rel)).then((s) => s.isFile(), () => false)) || !(await realInside(projectDir, join(projectDir, rel)))) throw new StoreError('not_found', `no existe el archivo ${rel}`);
      // En un repo, un archivo que git ignora (un .env, un secreto) no se publica como documento.
      const listed = await repoFiles(projectDir, rel);
      if (listed && !listed.includes(rel)) throw new StoreError('invalid_argument', `git ignora ${rel}: no se puede declarar como documento`);
    }
    const same = docs.find((d) => d.alias === alias);
    if (same) throw new StoreError('conflict', `ya hay un documento "${alias}" (${same.path})`);
    const dup = docs.find((d) => d.path === rel);
    if (dup) throw new StoreError('conflict', `${rel} ya está declarado como "${dup.alias}"`);
    entry = { alias, path: rel };
    next = [...docs, entry];
  }
  const doc = { ...config, docs: next };
  if (!next.length) delete doc.docs;
  await writeAtomic(file, canonical(doc));
  return entry;
}

// Documento por alias o por ruta (las refs de las tareas usan la ruta; los enlaces [[alias#id]], el alias).
export const findDoc = (docs, key) => docs.find((d) => d.alias === key) ?? docs.find((d) => d.path === key);

export const findSection = (doc, id) => doc?.sections.find((s) => s.id === id) ?? null;

export const sectionMarkdown = (doc, s) => doc.lines.slice(s.start, s.end).join('\n').replace(/\s+$/, '') + '\n';

/**
 * "alias#id" o "alias" → { key, id, doc, section, whole } (doc o section null si no existen). Sin "#id" la
 * referencia es al documento entero: whole = true, id y section quedan null.
 */
export function resolveRef(docs, ref) {
  const [key, rawId] = typeof ref === 'string' ? ref.split('#') : [ref.doc, ref.section];
  const id = rawId || null;
  const doc = findDoc(docs, key) ?? null;
  return { key, id, doc, section: doc && id ? findSection(doc, id) : null, whole: !id };
}

/** Texto de una referencia: "ruta#id", o solo la ruta si es al documento entero. */
export const refText = (doc, section) => (section ? `${doc}#${section}` : doc);

// Enlaces en línea [[alias#id]] (una sección) o [[alias]] (el documento entero) dentro de un texto. m[2] es la
// sección, undefined en los de documento entero.
export const LINK = /\[\[([^\]#\s]+)(?:#([a-z0-9][a-z0-9_-]*))?\]\]/g;

/**
 * Referencias de las tareas que no resuelven: refs estructuradas y enlaces [[alias#id]] o [[alias]] en la descripción,
 * notas, prueba y pasos. Una referencia al documento entero solo se rompe si el documento no está.
 * tasks: [{ id, ...doc }]. Devuelve [{ task, ref, where, problem: 'missing_doc'|'missing_section'|'fragile' }].
 * 'fragile' = resuelve, pero contra una sección sin id explícito (se rompe si se renombra el título).
 */
export function checkRefs(docs, tasks) {
  const out = [];
  const check = (task, key, id, where) => {
    const r = resolveRef(docs, { doc: key, section: id });
    const problem = !r.doc || r.doc.missing ? 'missing_doc' : r.whole ? null : !r.section ? 'missing_section' : !r.section.explicit ? 'fragile' : null;
    if (problem) out.push({ task: task.id, ref: refText(key, r.id), where, problem });
  };
  for (const t of tasks) {
    for (const r of t.refs ?? []) check(t, r.doc, r.section, 'refs');
    const texts = [['description', t.description], ['notes', t.notes], ['test', t.test], ...(t.checklist ?? []).flatMap((c, i) => [[`paso ${i + 1}`, c.text], [`paso ${i + 1} (detalle)`, c.detail]])];
    // Lo que está entre `…` es código (un ejemplo), no un enlace.
    for (const [where, text] of texts) for (const m of String(text ?? '').replace(/`[^`]*`/g, '').matchAll(LINK)) check(t, m[1], m[2], where);
  }
  return out;
}

/**
 * Secciones que toca un diff unificado del documento (12.6): las que contienen una línea agregada o cambiada, o el
 * lugar de una quitada, del lado del archivo nuevo. Una sección incluye a las de adentro, así que también se marcan
 * las que la contienen. Devuelve los ids en el orden del documento.
 */
export function diffSections(doc, diff) {
  const touched = new Set(); // líneas del archivo nuevo, 0-based
  let line = null;
  for (const l of String(diff).split('\n')) {
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
    if (h) { line = Number(h[1]) - 1; continue; }
    if (line === null || l.startsWith('\\')) continue;
    if (l.startsWith('+')) touched.add(line++);
    else if (l.startsWith('-')) touched.add(Math.max(line - 1, 0));
    else line++;
  }
  return doc.sections.filter((s) => [...touched].some((n) => n >= s.start && n < s.end)).map((s) => s.id);
}

const fold = (x) => String(x).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Búsqueda de texto en los documentos (12.4): las líneas que tienen todas las palabras, sin distinguir mayúsculas ni
 * tildes, como los filtros de M11. Sin índice: recorre las líneas ya cargadas. Devuelve { results, more } con
 * results: [{ alias, path, section, title, line, snippet }] (line desde 1; section y title, los de la sección más
 * chica que contiene la línea, o null antes del primer título) y more: true si cortó en limit.
 */
export function searchDocs(docs, q, { limit = 200 } = {}) {
  const words = fold(q).split(/\s+/).filter(Boolean);
  const results = [];
  if (!words.length) return { results, more: false };
  for (const d of docs) {
    for (let i = 0; i < d.lines.length; i++) {
      const text = d.lines[i];
      const f = fold(text);
      if (!words.every((w) => f.includes(w)) || ID_COMMENT.test(text.trim())) continue;
      if (results.length === limit) return { results, more: true };
      const s = d.sections.findLast((x) => x.start <= i && i < x.end) ?? null;
      // Un fragmento de la línea alrededor de la primera palabra (las líneas de un párrafo pueden ser largas).
      const at = Math.max(0, f.indexOf(words[0]) - 60);
      const cut = text.slice(at, at + 180).trim();
      results.push({ alias: d.alias, path: d.path, section: s?.id ?? null, title: s?.title ?? null, line: i + 1,
        snippet: (at > 0 ? '…' : '') + cut + (at + 180 < text.length ? '…' : '') });
    }
  }
  return { results, more: false };
}

/** Agrega <!-- id: slug --> debajo de cada título sin id. Devuelve { text, stamped: [ids] }. */
export function stampIds(text) {
  const { sections, lines } = parseSections(text);
  const stamped = [];
  const out = [...lines];
  // De abajo hacia arriba, para que las líneas insertadas no corran los índices pendientes.
  for (const s of [...sections].reverse()) {
    if (s.explicit) continue;
    out.splice(s.start + 1, 0, `<!-- id: ${s.id} -->`);
    stamped.unshift(s.id);
  }
  return { text: out.join('\n'), stamped };
}

// Citas "Ver `gdd.md` §4.3", "gdd §4.3" o "en el GDD (§4.3)": documento por ruta o alias (sin distinguir
// mayúsculas), un paréntesis opcional, y el número de sección.
const CITE = /`?([\w./-]+?)`?\s*\(?\s*§\s*(\d+(?:\.\d+)*)/g;
const findDocLoose = (docs, key) => findDoc(docs, key) ?? findDoc(docs, key.replace(/\.md$/, '')) ??
  docs.find((d) => d.alias.toLowerCase() === key.toLowerCase().replace(/\.md$/, '') || d.path.toLowerCase() === key.toLowerCase());

/**
 * Propuestas de referencias a partir de citas por número en la descripción, notas, prueba y pasos (spec §10.5).
 * Una cita "§4.3" apunta a la sección cuyo título empieza con "4.3" (o "4."/"4 " para "§4").
 * Devuelve [{ task, where, cite, ref, title, already }]; nunca aplica nada.
 */
export function suggestRefs(docs, tasks) {
  const out = [];
  for (const t of tasks) {
    const texts = [['description', t.description], ['notes', t.notes], ['test', t.test], ...(t.checklist ?? []).flatMap((c, i) => [[`paso ${i + 1}`, c.text], [`paso ${i + 1} (detalle)`, c.detail]])];
    for (const [where, text] of texts) {
      for (const m of String(text ?? '').matchAll(CITE)) {
        const d = findDocLoose(docs, m[1]);
        if (!d) continue;
        const num = m[2];
        const s = d.sections.find((x) => new RegExp(`^${num.replace(/\./g, '\\.')}(\\.|\\s)`).test(x.title));
        if (!s) continue;
        const already = (t.refs ?? []).some((r) => (findDoc(docs, r.doc) === d) && r.section === s.id);
        out.push({ task: t.id, code: t.code ?? '', where, cite: m[0], ref: `${d.alias}#${s.id}`, title: s.title, already });
      }
    }
  }
  return out;
}
