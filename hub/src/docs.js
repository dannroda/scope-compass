// Documentos del proyecto (spec §10): índice de secciones con ids estables y resolución de referencias.
// Solo lectura: los documentos se editan donde siempre; acá se leen.
import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import { join, relative } from 'node:path';

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

/**
 * Documentos declarados en config.json › docs: [{ alias, path }], path puede ser un patrón (docs/**\/*.md);
 * en ese caso cada archivo toma como alias "<alias>/<nombre sin .md>".
 * Devuelve [{ alias, path, sections, lines, warnings }] (path relativo al proyecto).
 */
export async function loadDocs(projectDir, config) {
  const out = [];
  for (const entry of config?.docs ?? []) {
    const files = entry.path.includes('*')
      ? (await Array.fromAsync(glob(entry.path, { cwd: projectDir }))).sort()
      : [entry.path];
    for (const rel of files) {
      const text = await readFile(join(projectDir, rel), 'utf8').catch(() => null);
      const alias = entry.path.includes('*') ? `${entry.alias}/${rel.replace(/^.*\//, '').replace(/\.md$/, '')}` : entry.alias;
      if (text === null) {
        out.push({ alias, path: rel, sections: [], lines: [], warnings: [{ code: 'missing_doc', message: `no existe ${rel}` }] });
        continue;
      }
      out.push({ alias, path: relative(projectDir, join(projectDir, rel)), ...parseSections(text) });
    }
  }
  return out;
}

// Documento por alias o por ruta (las refs de las tareas usan la ruta; los enlaces [[alias#id]], el alias).
export const findDoc = (docs, key) => docs.find((d) => d.alias === key) ?? docs.find((d) => d.path === key);

export const findSection = (doc, id) => doc?.sections.find((s) => s.id === id) ?? null;

export const sectionMarkdown = (doc, s) => doc.lines.slice(s.start, s.end).join('\n').replace(/\s+$/, '') + '\n';

/** "alias#id" → { doc, section } (o null en cada parte si no existe). */
export function resolveRef(docs, ref) {
  const [key, id] = typeof ref === 'string' ? ref.split('#') : [ref.doc, ref.section];
  const doc = findDoc(docs, key) ?? null;
  return { key, id, doc, section: doc ? findSection(doc, id) : null };
}

// Enlaces en línea [[alias#id]] dentro de un texto.
export const LINK = /\[\[([^\]#\s]+)#([a-z0-9][a-z0-9_-]*)\]\]/g;

/**
 * Referencias de las tareas que no resuelven: refs estructuradas y enlaces [[alias#id]] en notas, prueba y pasos.
 * tasks: [{ id, ...doc }]. Devuelve [{ task, ref, where, problem: 'missing_doc'|'missing_section'|'fragile' }].
 * 'fragile' = resuelve, pero contra una sección sin id explícito (se rompe si se renombra el título).
 */
export function checkRefs(docs, tasks) {
  const out = [];
  const check = (task, key, id, where) => {
    const r = resolveRef(docs, { doc: key, section: id });
    const problem = !r.doc ? 'missing_doc' : !r.section ? 'missing_section' : !r.section.explicit ? 'fragile' : null;
    if (problem) out.push({ task: task.id, ref: `${key}#${id}`, where, problem });
  };
  for (const t of tasks) {
    for (const r of t.refs ?? []) check(t, r.doc, r.section, 'refs');
    const texts = [['notes', t.notes], ['test', t.test], ...(t.checklist ?? []).map((c, i) => [`paso ${i + 1}`, c.text])];
    // Lo que está entre `…` es código (un ejemplo), no un enlace.
    for (const [where, text] of texts) for (const m of String(text ?? '').replace(/`[^`]*`/g, '').matchAll(LINK)) check(t, m[1], m[2], where);
  }
  return out;
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

// Citas "Ver `gdd.md` §4.3" (o "gdd §4.3"): documento por ruta o alias, y número de sección.
const CITE = /`?([\w./-]+?)`?\s*§\s*(\d+(?:\.\d+)*)/g;

/**
 * Propuestas de referencias a partir de citas por número en notas, prueba y pasos (spec §10.5).
 * Una cita "§4.3" apunta a la sección cuyo título empieza con "4.3" (o "4."/"4 " para "§4").
 * Devuelve [{ task, where, cite, ref, title, already }]; nunca aplica nada.
 */
export function suggestRefs(docs, tasks) {
  const out = [];
  for (const t of tasks) {
    const texts = [['notes', t.notes], ['test', t.test], ...(t.checklist ?? []).map((c, i) => [`paso ${i + 1}`, c.text])];
    for (const [where, text] of texts) {
      for (const m of String(text ?? '').matchAll(CITE)) {
        const d = findDoc(docs, m[1]) ?? findDoc(docs, m[1].replace(/\.md$/, ''));
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
