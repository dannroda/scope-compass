// Versiones de los documentos (spec §41, D51): el etag de un documento y qué cambió desde uno. El etag es el id de
// blob de git del texto, así que una versión commiteada se recupera de git; las demás, de una caché por contenido en
// la carpeta de datos (<datos>/doc-versions/<etag>.md), que se llena cada vez que se entrega un etag. Nada por sesión.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, unlink, utimes } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseSections } from './docs.js';
import { projectsDataDir } from './projects.js';
import { writeAtomic } from './store/atomic.js';

const ETAG = /^[0-9a-f]{40}$/;
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;
let pruned = false;

/** El texto de un documento de loadDocs, tal como está en el disco. */
export const docText = (doc) => doc.lines.join('\n');

/** Id de blob de git del texto: lo mismo que `git hash-object` del archivo. */
export function blobEtag(text) {
  const bytes = Buffer.from(text, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

export const versionsDir = () => join(projectsDataDir(), 'doc-versions');

/**
 * Guarda el texto en la caché, si no estaba, y devuelve su etag. Si ya estaba, le renueva la fecha: lo que se sigue
 * leyendo no vence. La primera vez de cada proceso borra las versiones de más de 30 días.
 */
export async function rememberVersion(text) {
  const etag = blobEtag(text);
  const file = join(versionsDir(), `${etag}.md`);
  try {
    await stat(file);
    const now = new Date();
    await utimes(file, now, now).catch(() => {});
  } catch {
    await mkdir(versionsDir(), { recursive: true });
    await writeAtomic(file, text);
  }
  if (!pruned) {
    pruned = true;
    pruneVersions().catch(() => {});
  }
  return etag;
}

export async function pruneVersions(now = Date.now()) {
  const dir = versionsDir();
  for (const name of await readdir(dir)) {
    if (!name.endsWith('.md')) continue;
    const s = await stat(join(dir, name)).catch(() => null);
    if (s && now - s.mtimeMs > MAX_AGE_MS) await unlink(join(dir, name)).catch(() => {});
  }
}

/** El texto de la versión `etag` del documento: de la caché o, si no está, de git. null si no aparece. */
export async function findVersion(projectDir, docPath, etag) {
  if (!ETAG.test(etag ?? '')) return null;
  const cached = await readFile(join(versionsDir(), `${etag}.md`), 'utf8').catch(() => null);
  if (cached !== null && blobEtag(cached) === etag) return cached;
  // El repo del documento (puede ser otro que el del proyecto, por ejemplo un submódulo).
  const text = await new Promise((done) => execFile('git', ['-C', dirname(join(projectDir, docPath)), 'cat-file', 'blob', etag],
    { timeout: 5000, windowsHide: true, maxBuffer: 32 << 20, encoding: 'buffer' }, (err, stdout) => done(err ? null : stdout.toString('utf8'))));
  return text !== null && blobEtag(text) === etag ? text : null;
}

const body = (parsed, s) => parsed.lines.slice(s.start, s.end).join('\n');
// La sección `id` y las de adentro, por id.
const scope = (parsed, id) => {
  const s = parsed.sections.find((x) => x.id === id);
  return s ? parsed.sections.filter((x) => x.start >= s.start && x.start < s.end).map((x) => x.id) : [];
};

/**
 * Qué secciones cambiaron entre `oldText` y el documento `doc` (de loadDocs), por id: changed (en las dos versiones,
 * con otro texto; una sección incluye a las de adentro, así que cambian también las que la contienen), added y
 * removed, en el orden del documento. Con `section`, solo esa sección y las de adentro.
 */
export function sectionChanges(doc, oldText, section = null) {
  const old = parseSections(oldText);
  const before = new Map(old.sections.map((s) => [s.id, body(old, s)]));
  const after = new Map(doc.sections.map((s) => [s.id, body(doc, s)]));
  const only = section ? new Set([...scope(doc, section), ...scope(old, section)]) : null;
  const keep = (id) => !only || only.has(id);
  return {
    changed: doc.sections.filter((s) => keep(s.id) && before.has(s.id) && before.get(s.id) !== after.get(s.id)).map((s) => s.id),
    added: doc.sections.filter((s) => keep(s.id) && !before.has(s.id)).map((s) => s.id),
    removed: old.sections.filter((s) => keep(s.id) && !after.has(s.id)).map((s) => s.id)
  };
}

/**
 * Qué cambió en el documento desde `since` (§41): { alias, path, etag, since, changed, known, sections }. known: false
 * si no se encontró el texto de esa versión; entonces sections es null y changed solo dice si el etag es otro.
 * Con `section`, changed es si cambió esa sección (o se agregó o se quitó).
 */
export async function docChanges(projectDir, doc, since, section = null) {
  const etag = blobEtag(docText(doc));
  const base = { alias: doc.alias, path: doc.path, etag, since, ...(section && { section }) };
  if (etag === since) return { ...base, changed: false, known: true, sections: { changed: [], added: [], removed: [] } };
  const old = await findVersion(projectDir, doc.path, since);
  if (old === null) return { ...base, changed: true, known: false, sections: null };
  const sections = sectionChanges(doc, old, section);
  const changed = section ? sections.changed.length + sections.added.length + sections.removed.length > 0 : true;
  return { ...base, changed, known: true, sections };
}
