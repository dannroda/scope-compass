// Editar una sección de un documento desde la web (spec §50, D61). Reemplaza el rango entero de la sección (título,
// línea del id, texto y las secciones de adentro) con el etag del documento (§41): con un etag viejo se aplica igual
// si esa sección no cambió desde entonces. Conserva el id y el fin de línea del archivo, deja el texto de antes en la
// caché de versiones (para Deshacer) y nunca commitea.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { findSection, parseSections, sectionMarkdown } from './docs.js';
import { blobEtag, findVersion, rememberVersion, sectionChanges } from './doc-versions.js';
import { compileForbidden, describeMatch, matchText } from './forbidden.js';
import { writeAtomic } from './store/atomic.js';
import { StoreError } from './store/json-files.js';
import { T } from './i18n.js';

const ID_COMMENT = /^<!--\s*id:\s*([a-z0-9][a-z0-9_-]*)\s*-->\s*$/;

/**
 * Las líneas nuevas de la sección `s` a partir del Markdown que mandó la web, o un StoreError invalid_section si el
 * texto no es una sola sección del mismo nivel. Sin fin de línea (se pone después).
 */
export function sectionLines(markdown, s) {
  const text = String(markdown).replace(/\r\n?/g, '\n').replace(/^(\s*\n)+/, '').replace(/\s+$/, '');
  const parsed = parseSections(text);
  const first = parsed.sections[0];
  if (!first || first.start !== 0 || first.level !== s.level) {
    throw new StoreError('invalid_section', T`el texto tiene que empezar con un título de nivel ${s.level} (${'#'.repeat(s.level)} …)`);
  }
  const extra = parsed.sections.slice(1).find((x) => x.level <= s.level);
  if (extra) throw new StoreError('invalid_section', T`«${extra.title}» (línea ${extra.start + 1}) crearía otra sección: dentro de la sección, los títulos van de nivel ${s.level + 1} o más`);
  const lines = parsed.lines;
  // El id de la sección no cambia desde la web (§50): uno explícito que se quitó o se cambió vuelve a ponerse.
  const idLine = lines.length > 1 ? ID_COMMENT.exec(lines[1].trim()) : null;
  if (idLine && idLine[1] !== s.id) lines[1] = `<!-- id: ${s.id} -->`;
  else if (!idLine && s.explicit) lines.splice(1, 0, `<!-- id: ${s.id} -->`);
  return lines;
}

/** El texto del documento con la sección `s` (de parseSections(text)) reemplazada por `newLines`. */
export function replaceSection(text, s, newLines) {
  const lines = text.split('\n');
  const crlf = text.includes('\r\n');
  // Las líneas en blanco del final del rango (la separación con lo que sigue) se quedan como estaban.
  let k = s.end;
  while (k > s.start + 1 && lines[k - 1].trim() === '') k--;
  const tail = lines.slice(k, s.end);
  const atEnd = s.end === lines.length && tail.length === 0;
  const body = newLines.map((l, i) => (crlf && !(atEnd && i === newLines.length - 1) ? `${l}\r` : l));
  return [...lines.slice(0, s.start), ...body, ...tail, ...lines.slice(s.end)].join('\n');
}

/**
 * Guarda `markdown` como la sección `id` del documento `doc` (de loadDocs), leído con el etag `etag`.
 * Devuelve { etag, previous, id, markdown }: el etag nuevo, el de antes (Deshacer guarda el texto de antes con el
 * etag nuevo) y la sección como quedó. Errores: conflict (409, con current: { etag, markdown } de la sección como
 * está ahora), invalid_section y forbidden_pattern (422), not_found, invalid_argument.
 */
export async function editSection(projectDir, config, doc, id, { markdown, etag } = {}) {
  if (typeof markdown !== 'string') throw new StoreError('invalid_argument', T('falta markdown: el texto de la sección'));
  if (typeof etag !== 'string' || !etag) throw new StoreError('invalid_argument', T('falta etag: el del documento que se leyó'));
  if (doc.missing) throw new StoreError('not_found', T`no existe ${doc.path}`);
  const file = join(projectDir, doc.path);
  // Se relee justo antes de escribir: lo de loadDocs puede tener unos milisegundos.
  const text = await readFile(file, 'utf8').catch(() => { throw new StoreError('not_found', T`no existe ${doc.path}`); });
  const parsed = parseSections(text);
  const s = findSection(parsed, id);
  const current = blobEtag(text);
  const conflict = (why) => new StoreError('conflict', why, { current: { etag: current, markdown: s ? sectionMarkdown(parsed, s) : null } });
  if (etag !== current) {
    const old = await findVersion(projectDir, doc.path, etag);
    if (old === null) throw conflict(T`${doc.path} cambió desde que se leyó y no se encontró esa versión para comparar la sección`);
    const c = sectionChanges(parsed, old, id);
    if (c.changed.length || c.added.length || c.removed.length) throw conflict(T`la sección «${id}» cambió en ${doc.path} desde que se leyó`);
  }
  if (!s) throw new StoreError('not_found', T`no hay una sección "${id}" en ${doc.path}`);
  let newLines = sectionLines(markdown, s);
  // Patrones prohibidos (§42) en el texto nuevo, como en el store.
  const { patterns, errors } = compileForbidden(config);
  if (errors.length) {
    const e = errors[0];
    throw new StoreError('invalid_file', T`compass/config.json › forbidden[${e.index}]: /${e.source}/ no es una expresión regular válida (${e.message})`);
  }
  const hits = matchText(newLines.join('\n'), patterns).map(({ index, ...m }) => ({ where: `#${id}`, ...m }));
  if (hits.length) {
    throw new StoreError('forbidden_pattern', T`no se guardó: ${hits.slice(0, 3).map((m) => describeMatch(doc.path, m)).join('; ')}${hits.length > 3 ? T`; y ${hits.length - 3} más` : ''}`, { matches: hits });
  }
  let next = replaceSection(text, s, newLines);
  // Un título nuevo sin id explícito cambiaría el id (el slug): se le pone el de antes, como doc stamp-ids.
  if (!s.explicit && parseSections(next).sections.find((x) => x.start === s.start)?.id !== s.id) {
    newLines = [newLines[0], `<!-- id: ${s.id} -->`, ...newLines.slice(1)];
    next = replaceSection(text, s, newLines);
  }
  const previous = await rememberVersion(text);
  if (next !== text) await writeAtomic(file, next);
  const saved = parseSections(next);
  return { etag: await rememberVersion(next), previous, id, markdown: sectionMarkdown(saved, findSection(saved, id)) };
}
