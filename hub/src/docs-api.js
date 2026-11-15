// API de documentos (spec §10.4, §20): índice, documento y sección renderizados, backlinks, referencias rotas y el
// estado de git de cada documento. Los documentos se releen en cada request: son archivos chicos y siempre están al día.
// Lo único que escribe es config.json › docs (agregar o quitar un documento).
import { changeDocs, checkRefs, diffSections, docCoverage, findDoc, findSection, LINK, loadDocs, refText, searchDocs, sectionMarkdown } from './docs.js';
import { docDiff, docLog, docsStatus } from './git.js';
import { renderBBCode, renderBlocks, renderMarkdown } from './render.js';
import { docChanges, docText, rememberVersion } from './doc-versions.js';
import { editSection } from './doc-edit.js';
import { StoreError } from './store/json-files.js';
import { T } from './i18n.js';

// Tareas que referencian cada sección, "<ruta>#<id>", o el documento entero, "<ruta>" → [{ id, code, title, status, milestone }].
function backlinks(docs, tasks) {
  const map = new Map();
  const add = (key, id, t) => {
    const d = findDoc(docs, key);
    if (!d || (id && !findSection(d, id))) return;
    const k = refText(d.path, id);
    const list = map.get(k) ?? [];
    if (!list.some((x) => x.id === t.id)) list.push({ id: t.id, code: t.code ?? '', title: t.title, status: t.status, milestone: t.milestone });
    map.set(k, list);
  };
  for (const t of tasks) {
    for (const r of t.refs ?? []) add(r.doc, r.section, t);
    const texts = [t.description, t.notes, t.test, ...(t.checklist ?? []).flatMap((c) => [c.text, c.detail])];
    for (const text of texts) for (const m of String(text ?? '').replace(/`[^`]*`/g, '').matchAll(LINK)) add(m[1], m[2], t);
  }
  return map;
}

async function context(store, projectDir) {
  const all = await store.loadAll();
  const docs = await loadDocs(projectDir, all.config);
  const tasks = [...all.tasks].map(([id, doc]) => ({ id, ...doc }));
  return { docs, tasks, links: backlinks(docs, tasks) };
}

function getDoc(docs, alias) {
  const d = docs.find((x) => x.alias === alias);
  if (!d) throw new StoreError('not_found', T`no hay un documento "${alias}"`);
  return d;
}

const sectionInfo = (d, s, links) => ({
  id: s.id, title: s.title, level: s.level, explicit: s.explicit, lines: [s.start + 1, s.end],
  tasks: links.get(`${d.path}#${s.id}`) ?? []
});

// Estado de git de un documento (12.3): clean, modified, added, untracked, deleted o renamed; sin repo, no va.
const gitOf = (g, d) => (g.repo ? { git: g.status[d.path] ?? 'clean' } : {});

export function registerDocsApi(app, { store, projectDir, validators, onDocsChanged = async () => {} }) {
  app.get('/api/docs', async () => {
    const [{ docs, links }, g] = await Promise.all([context(store, projectDir), docsStatus(projectDir)]);
    return { repo: g.repo, docs: docs.map((d) => ({ alias: d.alias, path: d.path, ...(d.missing && { missing: true }), ...gitOf(g, d), warnings: d.warnings, tasks: links.get(d.path) ?? [], sections: d.sections.map((s) => sectionInfo(d, s, links)) })) };
  });

  // Búsqueda de texto en todos los documentos (12.4). Ruta fija: gana sobre /api/docs/:alias.
  app.get('/api/docs/search', async (req) => {
    const { docs } = await context(store, projectDir);
    const q = String(req.query.q ?? '');
    return { q, ...searchDocs(docs.filter((d) => !d.missing), q) };
  });

  app.get('/api/docs/:alias', async (req) => {
    const [{ docs, links }, g] = await Promise.all([context(store, projectDir), docsStatus(projectDir)]);
    const d = getDoc(docs, req.params.alias);
    const etag = d.missing ? null : await rememberVersion(docText(d));
    return { alias: d.alias, path: d.path, etag, ...gitOf(g, d), warnings: d.warnings, tasks: links.get(d.path) ?? [], sections: d.sections.map((s) => sectionInfo(d, s, links)),
      html: renderMarkdown(d.lines.join('\n'), d.sections) };
  });

  // Diff contra HEAD (12.3) y las secciones que toca (12.6), para ver qué tareas pueden quedar afectadas.
  app.get('/api/docs/:alias/diff', async (req) => {
    const [{ docs }, g] = await Promise.all([context(store, projectDir), docsStatus(projectDir)]);
    const d = getDoc(docs, req.params.alias);
    if (!g.repo) return { alias: d.alias, path: d.path, repo: false, diff: '', sections: [] };
    const git = g.status[d.path] ?? 'clean';
    const diff = git === 'clean' ? '' : await docDiff(projectDir, d.path, { untracked: git === 'untracked', text: d.lines.join('\n') });
    return { alias: d.alias, path: d.path, repo: true, git, diff, sections: diffSections(d, diff) };
  });

  // Qué cambió desde un etag (§41): secciones cambiadas, nuevas y quitadas, contra la versión de la caché o de git.
  app.get('/api/docs/:alias/changes', async (req) => {
    const { docs } = await context(store, projectDir);
    const d = getDoc(docs, req.params.alias);
    if (d.missing) throw new StoreError('not_found', T`no existe ${d.path}`);
    const since = String(req.query.since ?? '');
    if (!since) throw new StoreError('invalid_argument', T('falta since: el etag que se leyó'));
    const section = req.query.section ? String(req.query.section) : null;
    const c = await docChanges(projectDir, d, since, section);
    if (section && !findSection(d, section) && !c.sections?.removed.includes(section)) throw new StoreError('not_found', T`no hay una sección "${section}" en ${d.path}`);
    return c;
  });

  // Historial del documento, del commit más nuevo al más viejo (siguiendo renombres).
  app.get('/api/docs/:alias/log', async (req) => {
    const [{ docs }, g] = await Promise.all([context(store, projectDir), docsStatus(projectDir)]);
    const d = getDoc(docs, req.params.alias);
    return { alias: d.alias, path: d.path, repo: g.repo, commits: g.repo ? await docLog(projectDir, d.path) : [] };
  });

  app.get('/api/docs/:alias/sections/:id', async (req) => {
    const { docs, links } = await context(store, projectDir);
    const d = getDoc(docs, req.params.alias);
    const s = findSection(d, req.params.id);
    if (!s) throw new StoreError('not_found', T`no hay una sección "${req.params.id}" en ${d.path}`);
    const inside = d.sections.filter((x) => x.start >= s.start && x.start < s.end);
    const markdown = sectionMarkdown(d, s);
    const etag = await rememberVersion(docText(d));
    // ?format=bbcode: para el RichTextLabel del dock de Godot (6.7).
    if (req.query.format === 'bbcode') return { alias: d.alias, path: d.path, etag, ...sectionInfo(d, s, links), bbcode: renderBBCode(markdown) };
    // ?format=blocks: texto en BBCode y código crudo, para mostrarlo en un CodeEdit.
    if (req.query.format === 'blocks') return { alias: d.alias, path: d.path, etag, ...sectionInfo(d, s, links), blocks: renderBlocks(markdown) };
    return { alias: d.alias, path: d.path, etag, ...sectionInfo(d, s, links), markdown, html: renderMarkdown(markdown, inside) };
  });

  // Editar una sección (§50, D61): { markdown, etag } → { etag, previous, id, markdown }. 409 con error.current
  // ({ etag, markdown } de la sección como está) si cambió desde el etag; 422 si el texto se sale de la sección o
  // tiene un patrón prohibido. Sin commit; el watcher de documentos avisa a las demás pestañas.
  app.put('/api/docs/:alias/sections/:id', async (req) => {
    const all = await store.loadAll();
    const d = getDoc(await loadDocs(projectDir, all.config), req.params.alias);
    return editSection(projectDir, all.config, d, req.params.id, req.body ?? {});
  });

  // Agregar o quitar un documento (12.2): reescribe config.json › docs. path: un archivo o un patrón con *.
  app.post('/api/docs', async (req, reply) => {
    const { alias, path } = req.body ?? {};
    const entry = await changeDocs(projectDir, validators, { add: { alias, path } });
    await onDocsChanged(entry.alias);
    return reply.code(201).send(entry);
  });

  app.delete('/api/docs/:alias', async (req, reply) => {
    const entry = await changeDocs(projectDir, validators, { remove: req.params.alias });
    await onDocsChanged(entry.alias);
    return reply.code(204).send();
  });

  // Cobertura (§43): por sección, qué tareas la cubren. ?doc=<alias> uno solo; ?uncovered=1 solo las que no tiene ninguna.
  app.get('/api/refs/coverage', async (req) => {
    const { docs, tasks } = await context(store, projectDir);
    const alias = req.query.doc || null;
    if (alias && !docs.some((d) => d.alias === alias)) throw new StoreError('not_found', T`no hay un documento "${alias}"`);
    const cov = docCoverage(docs, tasks, { alias });
    if (req.query.uncovered === '1' || req.query.uncovered === 'true') for (const d of cov) d.sections = d.sections.filter((s) => s.state === 'none');
    return { docs: cov };
  });

  app.get('/api/refs/broken', async () => {
    const { docs, tasks } = await context(store, projectDir);
    const problems = checkRefs(docs, tasks);
    return { broken: problems.filter((p) => p.problem !== 'fragile'), fragile: problems.filter((p) => p.problem === 'fragile') };
  });
}
