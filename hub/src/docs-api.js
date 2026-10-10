// API de documentos (spec §10.4): índice, documento y sección renderizados, backlinks y referencias rotas.
// Solo lectura. Los documentos se releen en cada request: son archivos chicos y siempre están al día.
import { changeDocs, checkRefs, findDoc, findSection, LINK, loadDocs, refText, sectionMarkdown } from './docs.js';
import { renderBBCode, renderBlocks, renderMarkdown } from './render.js';
import { StoreError } from './store/json-files.js';

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
    const texts = [t.notes, t.test, ...(t.checklist ?? []).flatMap((c) => [c.text, c.detail])];
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
  if (!d) throw new StoreError('not_found', `no hay un documento "${alias}"`);
  return d;
}

const sectionInfo = (d, s, links) => ({
  id: s.id, title: s.title, level: s.level, explicit: s.explicit, lines: [s.start + 1, s.end],
  tasks: links.get(`${d.path}#${s.id}`) ?? []
});

export function registerDocsApi(app, { store, projectDir, validators, onDocsChanged = async () => {} }) {
  app.get('/api/docs', async () => {
    const { docs, links } = await context(store, projectDir);
    return { docs: docs.map((d) => ({ alias: d.alias, path: d.path, ...(d.missing && { missing: true }), warnings: d.warnings, tasks: links.get(d.path) ?? [], sections: d.sections.map((s) => sectionInfo(d, s, links)) })) };
  });

  app.get('/api/docs/:alias', async (req) => {
    const { docs, links } = await context(store, projectDir);
    const d = getDoc(docs, req.params.alias);
    return { alias: d.alias, path: d.path, warnings: d.warnings, tasks: links.get(d.path) ?? [], sections: d.sections.map((s) => sectionInfo(d, s, links)),
      html: renderMarkdown(d.lines.join('\n'), d.sections) };
  });

  app.get('/api/docs/:alias/sections/:id', async (req) => {
    const { docs, links } = await context(store, projectDir);
    const d = getDoc(docs, req.params.alias);
    const s = findSection(d, req.params.id);
    if (!s) throw new StoreError('not_found', `no hay una sección "${req.params.id}" en ${d.path}`);
    const inside = d.sections.filter((x) => x.start >= s.start && x.start < s.end);
    const markdown = sectionMarkdown(d, s);
    // ?format=bbcode: para el RichTextLabel del dock de Godot (6.7).
    if (req.query.format === 'bbcode') return { alias: d.alias, path: d.path, ...sectionInfo(d, s, links), bbcode: renderBBCode(markdown) };
    // ?format=blocks: texto en BBCode y código crudo, para mostrarlo en un CodeEdit.
    if (req.query.format === 'blocks') return { alias: d.alias, path: d.path, ...sectionInfo(d, s, links), blocks: renderBlocks(markdown) };
    return { alias: d.alias, path: d.path, ...sectionInfo(d, s, links), markdown, html: renderMarkdown(markdown, inside) };
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

  app.get('/api/refs/broken', async () => {
    const { docs, tasks } = await context(store, projectDir);
    const problems = checkRefs(docs, tasks);
    return { broken: problems.filter((p) => p.problem !== 'fragile'), fragile: problems.filter((p) => p.problem === 'fragile') };
  });
}
