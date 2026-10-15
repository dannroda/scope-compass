// Tablero de Scope Compass: port del artifact (docs/reference/tablero-artifact.html, spec §7).
// El render es el mismo; los datos vienen de la API del hub en lugar de claude.use("db").
(function () {
  const STATUSES = [
    { id: 'todo', label: 'Pendiente', short: 'Pend.', color: 'var(--s-todo)' },
    { id: 'paused', label: 'Pausado', short: 'Paus.', color: 'var(--s-paused)' },
    { id: 'doing', label: 'En curso', short: 'Curso', color: 'var(--s-doing)' },
    { id: 'review', label: 'Revisión', short: 'Rev.', color: 'var(--s-review)' },
    { id: 'done', label: 'Hecho', short: 'Hecho', color: 'var(--s-done)' }
  ];
  const S = { descTemplates: {}, project: '', milestones: [], tasks: [], warnings: [], filter: pref('filter') || 'all', openId: null, confirmDelete: false, loaded: false, offline: false, connected: false,
    // Documentos (M6): índice de /api/docs, vista actual por el hash, referencias desplegadas, HTML en caché.
    docs: [], view: 'board', doc: '', sec: '', refsOpen: new Set(), refSearch: null,
    // Biblioteca (M12): entradas de config.json › docs, búsqueda de texto, carpetas plegadas, alta y baja.
    docEntries: [], docQ: '', docResults: null, foldersClosed: new Set(), docAdd: false, docRemove: null, docDiff: false,
    // Vínculos entre tareas: buscador abierto ({ type, q }) o null.
    linkSearch: null, fileSearch: null,
    // Pasos: detalles desplegados y el paso en edición ("tarea:índice").
    stepsOpen: new Set(), editStep: null,
    // Listas (D25): las del proyecto, la abierta, el ítem en edición ("lista:n") y las pestañas de config.views.
    lists: [], list: '', editItem: null, views: ['board', 'lists', 'playtest', 'docs', 'files'], viewsApplied: false,
    // Playtest (D39): las sesiones, la abierta y lo que se busca para agregarle.
    playtests: [], playtest: '', ptQ: '',
    // Archivos del repo (M14): lo de /api/files, el filtro, Solo con cambios, el archivo abierto, sus carpetas abiertas
    // y si se ven sus cambios en lugar del archivo.
    filesData: null, fileQ: '', filesChanged: false, file: '', fileShown: null, filesOpen: new Set(), fileDiff: false,
    // Cambios sin commitear en compass/ y el export (4.4), de /api/git y el evento `git`.
    git: null };
  const sectionCache = new Map(); // "alias#id" → html
  const docCache = new Map(); // alias → html
  // Git de un documento (12.6): alias → { log, diff } (undefined: sin pedir; null: pidiéndose). Se olvida al cambiar.
  const gitCache = new Map();
  // Archivos del repo (14.2): ruta → { info, diff }, igual que gitCache. Se olvida al volver a leer la lista.
  const fileCache = new Map();

  // Cliente de la API (spec §5.2). Los errores llegan como { code, message } del hub.
  class ApiError extends Error {
    constructor(status, body) {
      super(body?.error?.message || 'HTTP ' + status);
      this.status = status;
      this.code = body?.error?.code || 'io_error';
      this.current = body?.error?.current;
    }
  }
  // La carpeta de la página: "/" en un hub suelto, "/p/<clave>/" dentro del Inicio (D29). Las rutas de la API van
  // relativas a ella, así el mismo tablero sirve en los dos lugares.
  const BASE = location.pathname.replace(/[^/]*$/, '');
  const IN_HOME = /^\/p\/[^/]+\/$/.test(BASE);
  async function call(method, path, body, etag) {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (etag) headers['if-match'] = '"' + etag + '"';
    let r;
    try {
      r = await fetch(BASE + path.replace(/^\//, ''), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch (e) {
      throw new ApiError(0, { error: { code: 'offline', message: 'sin conexión con el hub' } });
    }
    if (r.status === 204) return null;
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new ApiError(r.status, data);
    return data;
  }
  const api = {
    config: () => call('GET', '/api/config'),
    milestones: () => call('GET', '/api/milestones'),
    tasks: () => call('GET', '/api/tasks'),
    create: (doc) => call('POST', '/api/tasks', doc),
    update: (id, patch, etag) => call('PATCH', '/api/tasks/' + encodeURIComponent(id), patch, etag),
    remove: (id, etag) => call('DELETE', '/api/tasks/' + encodeURIComponent(id), undefined, etag),
    history: (id) => call('GET', '/api/tasks/' + encodeURIComponent(id) + '/history'),
    imageAdd: (id, data, etag) => call('POST', '/api/tasks/' + encodeURIComponent(id) + '/images', { data }, etag),
    imageRemove: (id, path, etag) => call('DELETE', '/api/tasks/' + encodeURIComponent(id) + '/images?path=' + encodeURIComponent(path), undefined, etag),
    docs: () => call('GET', '/api/docs'),
    doc: (alias) => call('GET', '/api/docs/' + encodeURIComponent(alias)),
    docSearch: (q) => call('GET', '/api/docs/search?q=' + encodeURIComponent(q)),
    docAdd: (alias, path) => call('POST', '/api/docs', { alias, path }),
    docRemove: (alias) => call('DELETE', '/api/docs/' + encodeURIComponent(alias)),
    docDiff: (alias) => call('GET', '/api/docs/' + encodeURIComponent(alias) + '/diff'),
    docLog: (alias) => call('GET', '/api/docs/' + encodeURIComponent(alias) + '/log'),
    section: (alias, id) => call('GET', '/api/docs/' + encodeURIComponent(alias) + '/sections/' + encodeURIComponent(id)),
    lists: () => call('GET', '/api/lists'),
    git: () => call('GET', '/api/git'),
    files: () => call('GET', '/api/files'),
    file: (path) => call('GET', '/api/files/file?path=' + encodeURIComponent(path)),
    fileDiff: (path) => call('GET', '/api/files/diff?path=' + encodeURIComponent(path)),
    home: () => call('GET', '/api/home'),
    listCreate: (title) => call('POST', '/api/lists', { title }),
    listPatch: (id, patch, etag) => call('PATCH', '/api/lists/' + encodeURIComponent(id), patch, etag),
    listDelete: (id, etag) => call('DELETE', '/api/lists/' + encodeURIComponent(id), undefined, etag),
    listCheck: (id, n, etag) => call('POST', '/api/lists/' + encodeURIComponent(id) + '/check', { n }, etag),
    listTask: (id, n, milestone, etag) => call('POST', '/api/lists/' + encodeURIComponent(id) + '/task', { n, milestone }, etag),
    playtests: () => call('GET', '/api/playtests'),
    playtestCreate: (title, tasks) => call('POST', '/api/playtests', { title, tasks }),
    playtestPatch: (id, patch, etag) => call('PATCH', '/api/playtests/' + encodeURIComponent(id), patch, etag),
    playtestDelete: (id, etag) => call('DELETE', '/api/playtests/' + encodeURIComponent(id), undefined, etag)
  };

  function pref(k, v) {
    try {
      if (v === undefined) return localStorage.getItem('scompass.' + k);
      localStorage.setItem('scompass.' + k, v);
    } catch (e) { return null; }
  }

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }

  // [[alias#id]] es una sección; [[alias]], el documento entero (m[2] undefined). Como LINK de hub/src/docs.js.
  const LINK = /\[\[([^\]#\s]+)(?:#([a-z0-9][a-z0-9_-]*))?\]\]/g;
  // `código` inline -> <code>; [[alias#id]] fuera del código -> enlace con el título actual de la sección (6.6).
  // plain: sin enlaces (dentro de un botón, como las tarjetas, un <a> es inválido).
  function rich(str, plain) {
    const frag = document.createDocumentFragment();
    String(str || '').split('`').forEach((part, i) => {
      if (!part) return;
      if (i % 2) { frag.append(h('code', null, part)); return; }
      let last = 0;
      for (const m of part.matchAll(LINK)) {
        frag.append(document.createTextNode(part.slice(last, m.index).replace(/\*\*/g, '')));
        frag.append(plain ? document.createTextNode(linkTitle(m[1], m[2]) ?? m[0]) : docLink(m[1], m[2]));
        last = m.index + m[0].length;
      }
      frag.append(document.createTextNode(part.slice(last).replace(/\*\*/g, '')));
    });
    return frag;
  }
  // Título de un documento: su primer título de nivel 1, o la ruta.
  const docTitle = (d) => (d.sections.find((x) => x.level === 1)?.title ?? d.path).replace(/`/g, '');
  // Título actual de lo que apunta un enlace (la sección o el documento), o null si no existe.
  function linkTitle(key, id) {
    const d = docByKey(key);
    if (!d || d.missing) return null;
    if (!id) return docTitle(d);
    return sectionOf(d, id)?.title.replace(/`/g, '') ?? null;
  }
  // Enlace a una sección (o al documento entero, sin id): su título actual, o marcado como roto si ya no existe.
  function docLink(key, id) {
    const d = docByKey(key);
    const title = linkTitle(key, id);
    if (title === null) return h('span', { class: 'doclink broken', title: 'Referencia rota: ' + (id && d && !d.missing ? 'la sección ya no existe' : 'el documento no está') }, '⚠ ' + key + (id ? '#' + id : ''));
    const a = h('a', { class: 'doclink', href: '#docs/' + encodeURIComponent(d.alias) + (id ? '/' + encodeURIComponent(id) : ''), title: d.path + (id ? '#' + id : ''),
      onclick: (e) => e.stopPropagation() }, title);
    return a;
  }
  // Enlaces [[alias#id]] de un texto que se edita en un textarea: se listan debajo para poder abrirlos.
  function linksOf(text) {
    const found = [...String(text || '').replace(/`[^`]*`/g, '').matchAll(LINK)];
    if (!found.length) return null;
    return h('div', { class: 'doclinks' }, h('span', { class: 'muted' }, 'Enlaces:'), found.map((m) => docLink(m[1], m[2])));
  }

  function toast(msg) {
    const t = document.getElementById('toast');
    // Los mensajes del hub vienen en minúscula ("no existe el archivo…"): como frase (19.13).
    msg = String(msg);
    t.textContent = msg.charAt(0).toUpperCase() + msg.slice(1); t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 3200);
  }

  const msById = (id) => S.milestones.find((m) => m.id === id);
  const visibleTasks = () => S.tasks.filter((t) => S.filter === 'all' || t.milestone === S.filter);
  // Como `scompass list`: por hito (su order), después order y code dentro del hito.
  const msOrder = (id) => msById(id)?.order ?? Infinity;
  const sortTasks = (a, b) => msOrder(a.milestone) - msOrder(b.milestone) || (a.order ?? 0) - (b.order ?? 0) ||
    String(a.code || '').localeCompare(String(b.code || ''), 'es', { numeric: true });
  function clProgress(t) {
    const cl = Array.isArray(t.checklist) ? t.checklist : [];
    return { done: cl.filter((c) => c.done).length, total: cl.length };
  }

  // Aplica al estado un documento que devolvió el hub (o lo quita si doc es null).
  function apply(collection, id, doc) {
    if (collection === 'lists') { applyList(id, doc); return; }
    if (collection === 'playtests') { applyPlaytest(id, doc); return; }
    // Otras colecciones que esta versión no conoce: no se mezclan con las tareas.
    if (collection !== 'milestones' && collection !== 'tasks') return;
    const list = collection === 'milestones' ? S.milestones : S.tasks;
    const i = list.findIndex((t) => t.id === id);
    if (doc === null) { if (i >= 0) list.splice(i, 1); }
    else if (i >= 0) list[i] = doc;
    else list.push(doc);
    if (collection === 'milestones') list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    dropMissingTask();
    if (S.filter !== 'all' && !S.milestones.some((m) => m.id === S.filter)) S.filter = 'all';
    render();
  }
  const applyTask = (id, doc) => apply('tasks', id, doc);

  const MESSAGES = {
    offline: 'Sin conexión con el hub: el cambio no se guardó.',
    invalid_file: 'El archivo de la tarea está roto o tiene un conflicto de git: corregilo a mano.',
    not_found: 'La tarea ya no existe.'
  };
  async function write(fn, okMsg) {
    try { await fn(); if (okMsg) toast(okMsg); }
    catch (e) {
      // 409 por etag: alguien cambió la tarea. Se toma la versión actual y se avisa (spec §5.3).
      if (e.code === 'conflict' && e.current) {
        applyTask(e.current.id, { id: e.current.id, etag: e.current.etag, ...e.current.doc });
        toast('Otra pestaña o la CLI cambió esta tarea; se actualizó. Revisá y volvé a aplicar tu cambio.');
        return;
      }
      if (e.code === 'not_found') { applyTask(e.id, null); }
      toast(MESSAGES[e.code] || 'No se pudo guardar (' + (e.message || e.code) + ').');
    }
  }
  // Escrituras de una misma tarea, en fila. El cambio se calcula al enviarlo, sobre el estado más
  // reciente y con su etag: tildar dos pasos seguidos no da 409 ni pisa el primero.
  const queues = new Map();
  function updateTask(id, patch) {
    return queueTask(id, async (t) => {
      const body = typeof patch === 'function' ? patch(t) : patch;
      if (body) applyTask(id, await api.update(id, body, t.etag));
    });
  }
  // Cualquier escritura de la tarea en su fila: fn recibe la versión más reciente (con su etag).
  function queueTask(id, fn) {
    const run = () => write(async () => {
      const t = S.tasks.find((x) => x.id === id);
      if (!t) return;
      try { await fn(t); }
      catch (e) { e.id = id; throw e; }
    });
    const next = (queues.get(id) || Promise.resolve()).then(run);
    queues.set(id, next);
    next.finally(() => { if (queues.get(id) === next) queues.delete(id); });
    return next;
  }
  const checklistOf = (t) => (Array.isArray(t.checklist) ? t.checklist : []);

  // --- Filtros y vista de lista (M11, spec §19, D32) ----------------------------------------------
  // Las reglas son las de hub/src/filters.js (`scompass list`): si cambian allá, cambian acá.
  const PRIORITIES = [['high', 'Alta'], ['medium', 'Media'], ['low', 'Baja']];
  const PRIORITY_LABEL = Object.fromEntries(PRIORITIES);
  // Estimación (18.3): chica, mediana o grande; en pantalla, la letra.
  const SIZES = [['s', 'S'], ['m', 'M'], ['l', 'L']];
  const SIZE_NAME = { s: 'chica', m: 'mediana', l: 'grande' };
  const DUE_FILTERS = [['', 'Cualquier fecha'], ['overdue', 'Vencidas'], ['today', 'Vencen hoy'], ['week', 'Esta semana'], ['none', 'Sin fecha']];
  const BLOCK_FILTERS = [['', 'Con y sin bloqueo'], ['yes', 'Bloqueadas'], ['no', 'No bloqueadas']];
  const emptyFilter = () => ({ q: '', status: [], due: '', blocked: '', pendingSteps: false, withRefs: false, tags: [], priority: [], size: [], assignee: [] });
  // Se recuerdan por proyecto. Dentro del Inicio todos los tableros comparten el origen (D29): la clave lleva la ruta.
  const FILTER_KEY = 'taskFilter:' + BASE, MODE_KEY = 'boardMode:' + BASE, SORT_KEY = 'listSort:' + BASE, SUM_KEY = 'summaryOpen:' + BASE;
  function readJsonPref(key, fallback) { try { return JSON.parse(pref(key) || 'null') ?? fallback; } catch (e) { return fallback; } }
  S.f = { ...emptyFilter(), ...readJsonPref(FILTER_KEY, {}) };
  S.mode = pref(MODE_KEY) === 'list' ? 'list' : 'board';
  S.sort = readJsonPref(SORT_KEY, null); // { key, dir: 1 | -1 } o null: el orden del tablero
  function setF(changes) { S.f = { ...S.f, ...changes }; pref(FILTER_KEY, JSON.stringify(S.f)); render(); }
  function setMode(mode) { S.mode = mode; pref(MODE_KEY, mode); render(); }
  const filterActive = (f = S.f) => !!(f.q.trim() || f.status.length || f.due || f.blocked || f.pendingSteps || f.withRefs || f.tags.length || f.priority.length || f.size.length || f.assignee.length);

  const tagsOf = (t) => (Array.isArray(t.tags) ? t.tags : []);
  const normText = (x) => String(x ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const byText = (a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' });
  const allTags = () => [...new Set(S.tasks.flatMap(tagsOf))].sort(byText);
  const allAssignees = () => [...new Set(S.tasks.map((t) => t.assignee).filter(Boolean))].sort(byText);
  function dueMatches(t, which) {
    if (which === 'none') return !t.due;
    if (!t.due || t.status === 'done') return false;
    const g = dueGroup(t.due);
    return which === 'week' ? g === 'overdue' || g === 'today' || g === 'week' : g === which;
  }
  function taskMatches(t, f = S.f) {
    const words = normText(f.q).split(/\s+/).filter(Boolean);
    if (words.length && !words.every((w) => normText((t.code || '') + ' ' + (t.title || '') + ' ' + t.id).includes(w))) return false;
    if (f.status.length && !f.status.includes(t.status)) return false;
    if (f.due && !dueMatches(t, f.due)) return false;
    if (f.blocked && (openBlockers(t).length > 0) !== (f.blocked === 'yes')) return false;
    if (f.pendingSteps && !checklistOf(t).some((c) => !c.done)) return false;
    if (f.withRefs && !refsOf(t).length) return false;
    if (f.tags.length && !tagsOf(t).some((x) => f.tags.includes(x))) return false;
    if (f.priority.length && !f.priority.includes(t.priority || 'none')) return false;
    if (f.size.length && !f.size.includes(t.size || 'none')) return false;
    if (f.assignee.length && !f.assignee.map(normText).includes(t.assignee ? normText(t.assignee) : 'none')) return false;
    return true;
  }
  // Las del hito elegido que pasan los filtros: lo que muestran el tablero y la lista.
  const shownTasks = () => visibleTasks().filter((t) => taskMatches(t));

  // Barra de filtros. La parte de arriba (Tablero | Lista y el buscador) se arma una sola vez, para que el buscador no
  // pierda el foco cuando llega un cambio del hub; los desplegables se rearman, conservando cuál estaba abierto.
  function renderFilters() {
    const bar = document.getElementById('filters');
    if (!bar.firstChild) {
      const q = h('input', { type: 'search', id: 'f-q', placeholder: 'Buscar por título o código', autocomplete: 'off', value: S.f.q,
        oninput: (e) => setF({ q: e.target.value }),
        onkeydown: (e) => { if (e.key === 'Escape' && e.target.value) { e.preventDefault(); e.stopPropagation(); e.target.value = ''; setF({ q: '' }); } } });
      // Los filtros van en un panel que abre "Filtros (n)" (13.2); a la derecha, el orden.
      bar.append(h('div', { class: 'f-main' },
        h('div', { class: 'mode-switch', role: 'group', 'aria-label': 'Vista del tablero' },
          h('button', { type: 'button', id: 'mode-board', onclick: () => setMode('board') }, 'Tablero'),
          h('button', { type: 'button', id: 'mode-list', onclick: () => setMode('list') }, 'Lista')),
        h('label', { for: 'f-q', class: 'sr' }, 'Buscar tareas'), q,
        h('button', { type: 'button', class: 'chip small', id: 'f-panel', 'aria-controls': 'f-more', 'aria-expanded': 'false',
          onclick: () => { S.filtersOpen = !S.filtersOpen; renderFilters(); } }),
        h('div', { class: 'f-side' })),
      h('div', { class: 'f-more', id: 'f-more' }));
    }
    document.getElementById('mode-board').setAttribute('aria-pressed', S.mode === 'board' ? 'true' : 'false');
    document.getElementById('mode-list').setAttribute('aria-pressed', S.mode === 'list' ? 'true' : 'false');
    const q = document.getElementById('f-q');
    if (q.value !== S.f.q) q.value = S.f.q;
    const more = bar.querySelector('.f-more'), side = bar.querySelector('.f-side');
    const n = ['status', 'due', 'blocked', 'pendingSteps', 'withRefs', 'tags', 'priority', 'size', 'assignee'].filter((k) => Array.isArray(S.f[k]) ? S.f[k].length : S.f[k]).length;
    const panel = document.getElementById('f-panel');
    panel.replaceChildren(...['Filtros', n ? h('span', { class: 'n' }, n) : null, h('span', { class: 'caret', 'aria-hidden': 'true' }, S.filtersOpen ? '▴' : '▾')].filter(Boolean));
    panel.setAttribute('aria-expanded', S.filtersOpen ? 'true' : 'false');
    panel.classList.toggle('on', n > 0);
    more.hidden = !S.filtersOpen;
    const open = [...bar.querySelectorAll('details[open]')].map((d) => d.dataset.key);
    const focus = more.contains(document.activeElement) || side.contains(document.activeElement) ? document.activeElement.id : null;
    // Desplegable con casillas: el resumen dice cuántos valores hay elegidos.
    const multi = (key, label, options) => {
      const sel = S.f[key];
      return h('details', { class: 'fdrop' + (sel.length ? ' on' : ''), 'data-key': key, open: open.includes(key) },
        h('summary', null, label, sel.length ? h('span', { class: 'n' }, sel.length) : null),
        h('div', { class: 'fdrop-body' }, options.length ? options.map(([v, l]) => {
          const id = 'f-' + key + '-' + encodeURIComponent(v).replace(/%/g, '_');
          return h('label', { for: id }, h('input', { type: 'checkbox', id, checked: sel.includes(v),
            onchange: (e) => setF({ [key]: e.target.checked ? [...sel, v] : sel.filter((x) => x !== v) }) }), l);
        }) : h('p', { class: 'muted small' }, 'Ninguna tarea tiene ' + label.toLowerCase() + '.')));
    };
    // Desplegable de una sola opción, con el mismo aspecto que los de casillas (no un <select>, que abre la lista
    // del sistema). Sin valor, el resumen dice qué filtra; con valor, cuál se eligió. Elegir uno lo cierra.
    const single = (key, label, options) => {
      const cur = S.f[key];
      return h('details', { class: 'fdrop' + (cur ? ' on' : ''), 'data-key': key, open: open.includes(key) },
        h('summary', { id: 'f-' + key, 'aria-label': label + ': ' + options.find(([v]) => v === cur)[1] }, cur ? options.find(([v]) => v === cur)[1] : label),
        h('div', { class: 'fdrop-body', role: 'radiogroup', 'aria-label': label }, options.map(([v, l]) => {
          const id = 'f-' + key + '-' + (v || 'any');
          return h('label', { for: id }, h('input', { type: 'radio', name: 'f-' + key, id, checked: cur === v,
            onchange: (e) => { e.target.closest('details').open = false; setF({ [key]: v }); } }), l);
        })));
    };
    const toggle = (key, label) => h('button', { type: 'button', class: 'chip small', id: 'f-' + key, 'aria-pressed': S.f[key] ? 'true' : 'false', onclick: () => setF({ [key]: !S.f[key] }) }, label);
    // Los valores elegidos siguen en la lista aunque ninguna tarea los tenga ya (se pueden destildar).
    const values = (all, chosen) => [...new Set([...all, ...chosen.filter((x) => x !== 'none')])].map((x) => [x, x]);
    // Orden de las tarjetas (y de la lista): mismo aspecto que los filtros de una opción, más el sentido al lado.
    const sortKeys = ['', 'code', 'title', 'updated', 'created', 'done', 'due', 'priority', 'size'];
    if (S.sort && !sortKeys.includes(S.sort.key)) sortKeys.push(S.sort.key); // uno elegido en la lista (Estado, Pasos…)
    const sortDrop = h('details', { class: 'fdrop sort' + (S.sort ? ' on' : ''), 'data-key': 'sort', open: open.includes('sort') },
      h('summary', { id: 'f-sort', 'aria-label': 'Orden: ' + (S.sort ? sortLabel(S.sort.key) : 'Manual') }, 'Orden: ' + (S.sort ? sortLabel(S.sort.key) : 'Manual')),
      h('div', { class: 'fdrop-body', role: 'radiogroup', 'aria-label': 'Orden' }, sortKeys.map((k) => {
        const id = 'f-sort-' + (k || 'manual');
        return h('label', { for: id }, h('input', { type: 'radio', name: 'f-sort', id, checked: (S.sort?.key ?? '') === k,
          onchange: (e) => { e.target.closest('details').open = false; setSort(!k ? null : S.sort?.key === k ? S.sort : { key: k, dir: firstDir(k) }); } }), k ? sortLabel(k) : 'Manual');
      })));
    const sortDir = S.sort ? h('button', { type: 'button', class: 'chip small', id: 'f-sort-dir', 'aria-label': S.sort.dir === 1 ? 'Ascendente' : 'Descendente',
      title: 'Invertir el orden', onclick: () => setSort({ ...S.sort, dir: -S.sort.dir }) }, S.sort.dir === 1 ? '▲' : '▼') : null;
    const total = visibleTasks().length, shown = shownTasks().length;
    side.replaceChildren(...[
      filterActive() ? h('span', { class: 'f-count', role: 'status' }, shown + ' de ' + total + (total - shown ? ' · ' + (total - shown) + ' ocultas' : '')) : null,
      filterActive() ? h('button', { type: 'button', class: 'btn ghost small', id: 'f-clear', onclick: () => { setF(emptyFilter()); document.getElementById('f-q').focus(); } }, 'Limpiar filtros') : null,
      h('span', { class: 'f-sort' }, sortDrop, sortDir)
    ].filter(Boolean));
    more.replaceChildren(...[
      multi('status', 'Estado', STATUSES.map((s) => [s.id, s.label])),
      single('due', 'Fecha límite', DUE_FILTERS),
      single('blocked', 'Bloqueo', BLOCK_FILTERS),
      toggle('pendingSteps', 'Con pasos pendientes'),
      toggle('withRefs', 'Con referencias'),
      multi('tags', 'Etiquetas', values(allTags(), S.f.tags)),
      multi('priority', 'Prioridad', [...PRIORITIES, ['none', 'Sin prioridad']]),
      multi('size', 'Tamaño', [...SIZES, ['none', 'Sin estimar']]),
      multi('assignee', 'Responsable', [...values(allAssignees(), S.f.assignee), ['none', 'Sin responsable']])
    ]);
    if (focus) document.getElementById(focus)?.focus();
  }
  // Un clic afuera cierra los desplegables de los filtros.
  document.addEventListener('click', (e) => {
    for (const d of document.querySelectorAll('#filters details[open], #miles details[open]')) if (!d.contains(e.target)) d.open = false;
  });

  // Vista de lista: una fila por tarea, ordenable por columna. Sin orden elegido, el del tablero (sortTasks).
  // opt: columnas que se esconden en el teléfono.
  const naturalCmp = (a, b) => String(a).localeCompare(String(b), 'es', { numeric: true, sensitivity: 'base' });
  const COLUMNS = [
    { key: 'code', label: 'Código', val: (t) => t.code || '' },
    { key: 'title', label: 'Título', val: (t) => t.title || '' },
    { key: 'milestone', label: 'Hito', val: (t) => msOrder(t.milestone), opt: true },
    { key: 'status', label: 'Estado', val: (t) => STATUSES.findIndex((s) => s.id === t.status) },
    { key: 'steps', label: 'Pasos', val: (t) => { const p = clProgress(t); return p.total ? p.done / p.total : null; }, opt: true },
    { key: 'due', label: 'Fecha límite', val: (t) => t.due || null },
    { key: 'blocked', label: 'Bloqueo', val: (t) => (openBlockers(t).length ? 0 : null), opt: true },
    { key: 'priority', label: 'Prioridad', val: (t) => ({ high: 0, medium: 1, low: 2 })[t.priority] ?? null, opt: true },
    { key: 'size', label: 'Tamaño', val: (t) => ({ s: 0, m: 1, l: 2 })[t.size] ?? null, opt: true },
    { key: 'assignee', label: 'Responsable', val: (t) => t.assignee || null, opt: true },
    { key: 'tags', label: 'Etiquetas', val: (t) => tagsOf(t).join(', ') || null, opt: true },
    { key: 'updated', label: 'Actualizada', val: (t) => t.updated_at || null, opt: true, newestFirst: true },
    { key: 'created', label: 'Creada', val: (t) => t.created_at || null, opt: true, newestFirst: true },
    { key: 'done', label: 'Terminada', val: (t) => t.done_at || null, opt: true, newestFirst: true }
  ];
  // Fecha de edición o creación en la lista: relativa si es de la última semana ("hace un momento", "hace 3 h",
  // "ayer"); si no, corta ("8 oct", con el año si no es el actual). La completa, en el tooltip (13.5).
  const RTF = new Intl.RelativeTimeFormat('es', { numeric: 'auto', style: 'short' }), RTF_DAYS = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
  function stamp(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d)) return null;
    const now = new Date(), secs = (now - d) / 1000;
    const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
    const text = secs < 60 ? 'hace un momento' : secs < 3600 ? RTF.format(-Math.floor(secs / 60), 'minute') : secs < 86400 ? RTF.format(-Math.floor(secs / 3600), 'hour')
      : days < 7 ? RTF_DAYS.format(-days, 'day') : d.toLocaleDateString('es', { day: 'numeric', month: 'short', ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) });
    return h('time', { datetime: iso, title: d.toLocaleString('es') }, text);
  }
  const sortLabel = (key) => COLUMNS.find((c) => c.key === key)?.label ?? key;
  function sortedForList(ts) {
    const col = S.sort && COLUMNS.find((c) => c.key === S.sort.key);
    if (!col) return ts.slice().sort(sortTasks);
    // Las vacías van al final en los dos sentidos; a igual valor, el orden del tablero.
    return ts.slice().sort((a, b) => {
      const va = col.val(a), vb = col.val(b);
      if (va === null || va === '' || vb === null || vb === '') return (va === null || va === '') - (vb === null || vb === '') || sortTasks(a, b);
      const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : naturalCmp(va, vb);
      return c * S.sort.dir || sortTasks(a, b);
    });
  }
  function setSort(sort) { S.sort = sort; pref(SORT_KEY, sort ? JSON.stringify(sort) : ''); render(); }
  // Las fechas de edición y de creación empiezan por la más nueva; el resto, ascendente.
  const firstDir = (key) => (COLUMNS.find((c) => c.key === key)?.newestFirst ? -1 : 1);
  // Clic en un encabezado: un sentido, el otro y de vuelta al orden del tablero.
  function sortBy(key) {
    const d = firstDir(key);
    setSort(S.sort?.key !== key ? { key, dir: d } : S.sort.dir === d ? { key, dir: -d } : null);
  }
  function renderTaskList() {
    const box = document.getElementById('tasklist');
    if (S.view !== 'board' || S.mode !== 'list') { box.replaceChildren(); return; }
    const ts = sortedForList(shownTasks());
    if (!ts.length) {
      box.replaceChildren(h('div', { class: 'notice' }, S.loaded ? (filterActive() ? 'Ninguna tarea con estos filtros.' : 'Sin tareas.') : 'Cargando tareas…'));
      return;
    }
    // Sin las columnas que no tienen ningún valor en lo que se ve; la del orden elegido, siempre (13.5).
    const cols = COLUMNS.filter((c) => S.sort?.key === c.key || ts.some((t) => { const v = c.val(t); return v !== null && v !== ''; }));
    const head = h('tr', null, cols.map((c) => {
      const on = S.sort?.key === c.key;
      return h('th', { scope: 'col', class: c.opt ? 'opt' : null, 'aria-sort': on ? (S.sort.dir === 1 ? 'ascending' : 'descending') : null },
        h('button', { type: 'button', 'data-sort': c.key, onclick: () => sortBy(c.key), title: 'Ordenar por ' + c.label.toLowerCase() },
          c.label, h('span', { class: 'sort-mark', 'aria-hidden': 'true' }, on ? (S.sort.dir === 1 ? ' ▲' : ' ▼') : '')));
    }));
    const rows = ts.map((t) => {
      const s = STATUSES.find((x) => x.id === t.status) || STATUSES[0];
      const m = msById(t.milestone);
      const p = clProgress(t);
      const blockers = openBlockers(t);
      const cells = {
        code: h('td', { class: 'code' }, t.code || ''),
        title: h('td', { class: 'title' }, h('button', { type: 'button', class: 'row-open', onclick: () => openTask(t.id) }, rich(t.title, true))),
        milestone: h('td', { class: 'opt code' }, m ? h('span', { title: m.title }, m.code) : t.milestone),
        // En el teléfono, la etiqueta corta (19.13): solo el color no alcanza para distinguir el estado.
        status: h('td', null, h('span', { class: 'st', title: s.label, 'data-short': s.short }, h('span', { class: 'dot', style: 'background:' + s.color }), h('span', { class: 'st-l' }, s.label))),
        steps: h('td', { class: 'opt code' }, p.total ? p.done + '/' + p.total : ''),
        due: h('td', null, t.due ? dueMark(t) : null),
        blocked: h('td', { class: 'opt' }, blockers.length ? h('span', { class: 'blockmark', title: 'Bloqueada por: ' + blockers.map(taskName).join('; ') }, 'Bloqueada') : null),
        priority: h('td', { class: 'opt' }, t.priority ? h('span', { class: 'prio ' + t.priority }, PRIORITY_LABEL[t.priority] || t.priority) : null),
        size: h('td', { class: 'opt' }, t.size ? h('span', { class: 'size', title: 'Tamaño: ' + SIZE_NAME[t.size] }, t.size.toUpperCase()) : null),
        assignee: h('td', { class: 'opt' }, t.assignee || ''),
        tags: h('td', { class: 'opt' }, tagsOf(t).map((x) => h('span', { class: 'tag' }, x))),
        updated: h('td', { class: 'opt when' }, stamp(t.updated_at)),
        created: h('td', { class: 'opt when' }, stamp(t.created_at)),
        done: h('td', { class: 'opt when' }, stamp(t.done_at))
      };
      return h('tr', { 'data-id': t.id, 'aria-current': S.openId === t.id ? 'true' : null, onclick: (e) => { if (!e.target.closest('button')) openTask(t.id); } },
        cols.map((c) => cells[c.key]));
    });
    box.replaceChildren(h('div', { class: 'table-wrap' }, h('table', { class: 'tasks' }, h('thead', null, head), h('tbody', null, rows))));
  }

  function renderMiles() {
    const nav = document.getElementById('miles');
    const wasOpen = !!nav.querySelector('details[open]');
    const scrolled = nav.scrollLeft; // en el teléfono la fila se desplaza de costado (13.4)
    nav.replaceChildren();
    const all = S.tasks.length, allDone = S.tasks.filter((t) => t.status === 'done').length;
    nav.append(h('button', { class: 'chip', type: 'button', 'aria-pressed': S.filter === 'all' ? 'true' : 'false', onclick: () => setFilter('all') },
      'Todos', h('span', { class: 'n' }, allDone + '/' + all)));
    // Los hitos terminados van juntos en "Terminados (n)", salvo el elegido, que queda a la vista (13.2).
    const done = [];
    for (const m of S.milestones) {
      const ts = S.tasks.filter((t) => t.milestone === m.id);
      const d = ts.filter((t) => t.status === 'done').length;
      const complete = ts.length > 0 && d === ts.length;
      const late = !complete && dueGroup(m.due) === 'overdue';
      const chip = h('button', { class: 'chip' + (complete ? ' complete' : '') + (late ? ' late' : ''), type: 'button', title: m.title + (late ? ' · atrasado: la fecha objetivo era ' + showDue(m.due) : ''), 'aria-pressed': S.filter === m.id ? 'true' : 'false',
        onclick: (e) => { const dd = e.currentTarget.closest('details'); if (dd) dd.open = false; setFilter(m.id); } },
        m.code, h('span', { class: 'n' }, ts.length ? d + '/' + ts.length : '—'));
      if (complete && S.filter !== m.id) { chip.append(h('span', { class: 'ms-title' }, m.title)); done.push(chip); } else nav.append(chip);
    }
    if (done.length) nav.insertBefore(h('details', { class: 'fdrop ms-done', open: wasOpen },
      h('summary', { id: 'ms-done' }, 'Terminados', h('span', { class: 'n' }, done.length)),
      h('div', { class: 'fdrop-body' }, done)), nav.children[1] || null);
    nav.scrollLeft = scrolled;
    // La primera vez, el hito elegido (recordado) queda a la vista aunque esté al final de la fila.
    const chosen = !scrolled && nav.scrollWidth > nav.clientWidth && nav.querySelector(':scope > .chip[aria-pressed="true"]');
    if (chosen) nav.scrollLeft = chosen.offsetLeft - nav.offsetLeft - 16;
    const sel = document.getElementById('new-ms');
    const cur = sel.value;
    sel.replaceChildren(...S.milestones.map((m) => h('option', { value: m.id }, m.code + ' · ' + m.title)));
    // Lo que eligió el usuario en el formulario se respeta; si no, el hito que toca (19.12).
    sel.value = (sel.dataset.touched && cur) || defaultMilestone();
  }

  // Dónde va una tarea nueva (19.12): el hito elegido o, en "Todos", el primero sin terminar (uno sin tareas cuenta
  // como sin terminar), o el último si están todos terminados. Antes era M0, que se reabría.
  function defaultMilestone() {
    if (S.filter !== 'all' && msById(S.filter)) return S.filter;
    const open = S.milestones.find((m) => { const ts = S.tasks.filter((t) => t.milestone === m.id); return !ts.length || ts.some((t) => t.status !== 'done'); });
    return (open || S.milestones.at(-1))?.id || '';
  }

  function renderSummary() {
    const box = document.getElementById('summary');
    box.replaceChildren();
    if (S.offline) {
      box.hidden = false;
      box.append(h('div', { class: 'notice', style: 'grid-column: 1 / -1' }, 'No se pudo conectar con el hub. ¿Está corriendo ', h('code', null, 'scompass serve'), '? Sin el hub, las tareas están en ', h('code', null, 'compass/'), ' dentro del repo.'));
      return;
    }
    if (!S.loaded) { box.hidden = false; box.append(h('p', null, 'Cargando tareas…')); return; }
    if (!S.milestones.length && !S.tasks.length) {
      box.hidden = false;
      box.append(h('div', { style: 'grid-column: 1 / -1' }, h('h2', null, 'Tablero vacío'),
        h('p', null, 'Agregá los hitos con ', h('code', null, 'scompass milestone set'), ' y las tareas con “Nueva tarea”.')));
      return;
    }
    const ts = visibleTasks();
    const d = ts.filter((t) => t.status === 'done').length;
    const pct = ts.length ? Math.round((d / ts.length) * 100) : 0;
    const hidden = ts.length - ts.filter((t) => taskMatches(t)).length;
    const m = S.filter === 'all' ? null : msById(S.filter);
    // Una línea (13.2): título, barra y contador. El objetivo y "Hecho cuando" se despliegan, y eso se recuerda.
    const when = m && Array.isArray(m.done_when) ? m.done_when : [];
    const more = m && (m.goal || when.length);
    const open = more && pref(SUM_KEY) === '1';
    box.append(h('div', { class: 'sum-line' },
      h('h2', null, m ? m.code + ' · ' + m.title : 'Todos los hitos'),
      m && m.due ? msDueMark(m, ts) : null,
      sizeLoad(ts),
      h('div', { class: 'progress' }, h('div', { class: 'bar', role: 'img', 'aria-label': pct + '% hecho' }, h('i', { style: 'width:' + pct + '%' })), d + '/' + ts.length + ' tareas',
        hidden ? h('span', { class: 'hidden-n' }, '· ' + (hidden === 1 ? '1 oculta' : hidden + ' ocultas') + ' por los filtros') : null),
      more ? h('button', { type: 'button', class: 'sum-more', id: 'sum-more', 'aria-expanded': open ? 'true' : 'false', 'aria-controls': 'sum-body',
        onclick: () => { pref(SUM_KEY, open ? '' : '1'); renderSummary(); } }, when.length ? 'Hecho cuando' : 'Objetivo', h('span', { 'aria-hidden': 'true' }, open ? ' ▾' : ' ▸')) : null));
    if (open) box.append(h('div', { class: 'sum-body', id: 'sum-body' },
      m.goal ? h('p', null, rich(m.goal)) : null,
      when.length ? h('div', null, h('div', { class: 'label' }, 'Hecho cuando'), h('ul', null, when.map((x) => h('li', null, rich(x))))) : null));
    box.hidden = false;
  }

  function renderBoard() {
    const board = document.getElementById('board');
    board.replaceChildren();
    if (S.view !== 'board' || S.mode !== 'board') return;
    // Dentro de cada columna, el orden elegido (el mismo de la lista); sin elegir, el manual.
    const ts = sortedForList(shownTasks());
    for (const s of STATUSES) {
      const items = ts.filter((t) => (t.status || 'todo') === s.id);
      const col = h('section', { class: 'col', 'aria-label': s.label,
        ondragover: (e) => { e.preventDefault(); col.classList.add('over'); },
        ondragleave: () => col.classList.remove('over'),
        ondrop: (e) => { e.preventDefault(); col.classList.remove('over'); const id = e.dataTransfer.getData('text/plain'); if (id) setStatus(id, s.id); } },
        h('h3', null, h('span', { class: 'dot', style: 'background:' + s.color }), s.label, h('span', { class: 'n' }, items.length)));
      if (!items.length) col.append(h('div', { class: 'empty-col' }, S.loaded ? (filterActive() ? 'Ninguna con estos filtros' : 'Sin tareas') : ''));
      for (const t of items) col.append(cardFor(t, s));
      board.append(col);
    }
  }

  // Historial desde git (18.5), plegado: se pide al abrirlo y se vuelve a pedir cuando la tarea cambia (otro etag).
  const historyCache = new Map(); // id → { etag, data } | { etag, loading } | { etag, error }
  function renderHistory(t) {
    const open = S.historyOpen === t.id;
    const c = historyCache.get(t.id);
    if (open && (!c || c.etag !== t.etag)) {
      historyCache.set(t.id, { etag: t.etag, loading: true });
      api.history(t.id).then((data) => historyCache.set(t.id, { etag: t.etag, data }), (e) => historyCache.set(t.id, { etag: t.etag, error: e.message || e.code }))
        .finally(() => { if (S.openId === t.id) renderDetail(); });
    }
    const cur = historyCache.get(t.id);
    const when = (iso) => new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
    const body = !open ? null : !cur || cur.loading ? h('p', { class: 'muted small' }, 'Cargando…')
      : cur.error ? h('p', { class: 'muted small' }, 'No se pudo leer el historial (' + cur.error + ').')
        : !cur.data.repo ? h('p', { class: 'muted small' }, 'Sin historial: el proyecto no está en un repo de git.')
          : !cur.data.entries.length ? h('p', { class: 'muted small' }, 'Todavía no hay commits de esta tarea.')
            : h('ol', { class: 'history' }, cur.data.entries.map((e) => h('li', { class: e.hash ? null : 'pending' },
              h('div', { class: 'h-head' }, h('b', null, e.hash ? when(e.date) : 'Sin commitear'), e.hash ? h('code', { title: e.subject }, e.hash) : null, e.author ? h('span', { class: 'muted' }, e.author) : null),
              h('ul', null, (e.created ? ['Creada'] : e.deleted ? ['Borrada'] : e.changes).map((x) => h('li', null, x))))));
    return h('div', { class: 'refs history-box' },
      h('div', { class: 'refs-head' }, h('span', { class: 'label' }, 'Historial'),
        h('button', { class: 'btn ghost small', type: 'button', id: 'd-history', 'aria-expanded': open ? 'true' : 'false',
          onclick: () => { S.historyOpen = open ? null : t.id; renderDetail(); } }, open ? 'Ocultar' : 'Ver')), body);
  }

  // Capturas (18.4): miniaturas debajo de la descripción; un clic las abre grandes. Se agregan con + Captura (en el
  // teléfono abre la cámara o la galería), pegando una imagen con el detalle abierto o soltándola sobre el detalle.
  const imageUrl = (path) => BASE + 'api/files/raw?path=' + encodeURIComponent(path);
  const imagesOf = (t) => (Array.isArray(t.images) ? t.images : []);
  function renderImages(t) {
    const imgs = imagesOf(t);
    const pick = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', multiple: true, hidden: true, id: 'd-image-file',
      onchange: (e) => { addImages(t.id, [...e.target.files]); e.target.value = ''; } });
    return h('div', { class: 'shots', 'aria-label': 'Capturas' },
      imgs.map((p, i) => h('button', { type: 'button', class: 'shot', title: p, 'aria-label': 'Ver captura ' + (i + 1), onclick: () => openLightbox(t.id, i) },
        h('img', { src: imageUrl(p), alt: '', loading: 'lazy' }))),
      h('button', { type: 'button', class: 'btn ghost small add-shot', title: 'Agregar una captura (también se puede pegar o soltar sobre el detalle)', onclick: () => pick.click() }, '+ Captura'), pick);
  }
  const readAsDataUrl = (file) => new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => fail(r.error); r.readAsDataURL(file); });
  function addImages(id, files) {
    const imgs = files.filter((f) => /^image\/(png|jpeg|gif|webp)$/.test(f.type));
    if (!imgs.length) { if (files.length) toast('Solo imágenes PNG, JPEG, GIF o WebP.'); return; }
    for (const f of imgs) {
      if (f.size > 10 << 20) { toast(f.name + ' pesa más de 10 MB.'); continue; }
      queueTask(id, async (cur) => applyTask(id, await api.imageAdd(id, await readAsDataUrl(f), cur.etag)));
    }
  }
  function openLightbox(id, i, confirming = false) {
    const t = taskById(id), imgs = t ? imagesOf(t) : [];
    if (!imgs.length) return;
    i = (i + imgs.length) % imgs.length;
    document.querySelector('dialog.lightbox')?.remove();
    const close = () => d.remove();
    // Quitar pide confirmación (19.12), como Borrar tarea: si la guardó la app y nadie más la usa, se borra el archivo.
    const remove = () => {
      const path = imgs[i];
      close();
      queueTask(id, async (cur) => applyTask(id, await api.imageRemove(id, path, cur.etag)));
    };
    const ask = () => { openLightbox(id, i, true); document.querySelector('dialog.lightbox .lb-yes')?.focus(); };
    const d = h('dialog', { class: 'lightbox', 'aria-label': 'Captura ' + (i + 1) + ' de ' + imgs.length,
      onclick: (e) => { if (e.target === d) close(); },
      onkeydown: (e) => {
        if (e.key === 'Escape') { e.preventDefault(); close(); }
        else if (e.key === 'ArrowRight' && imgs.length > 1) { e.preventDefault(); openLightbox(id, i + 1); }
        else if (e.key === 'ArrowLeft' && imgs.length > 1) { e.preventDefault(); openLightbox(id, i - 1); }
      } },
      h('img', { src: imageUrl(imgs[i]), alt: imgs[i] }),
      h('div', { class: 'lb-bar' },
        h('span', { class: 'lb-path' }, imgs[i], imgs.length > 1 ? ' · ' + (i + 1) + '/' + imgs.length : ''),
        imgs.length > 1 ? h('button', { type: 'button', class: 'btn small', 'aria-label': 'Anterior', onclick: () => openLightbox(id, i - 1) }, '←') : null,
        imgs.length > 1 ? h('button', { type: 'button', class: 'btn small', 'aria-label': 'Siguiente', onclick: () => openLightbox(id, i + 1) }, '→') : null,
        confirming
          ? h('span', { class: 'confirm' }, '¿Quitar la captura?',
              h('button', { type: 'button', class: 'btn small danger lb-yes', onclick: remove }, 'Sí, quitar'),
              h('button', { type: 'button', class: 'btn small', onclick: () => openLightbox(id, i) }, 'No'))
          : h('button', { type: 'button', class: 'btn small danger', title: 'La saca de la tarea; si la había guardado la app (compass/images/) y nadie más la usa, borra el archivo', onclick: ask }, 'Quitar'),
        h('button', { type: 'button', class: 'btn small', onclick: close }, 'Cerrar')));
    document.body.append(d);
    d.showModal();
  }

  // Lo que falta, por tamaño (18.3): "Falta 2 S · 1 M · 1 L" sobre las tareas sin terminar; las sin estimar se cuentan aparte.
  function sizeLoad(ts) {
    const open = ts.filter((t) => t.status !== 'done');
    if (!open.some((t) => t.size)) return null;
    const parts = SIZES.map(([v, l]) => [open.filter((t) => t.size === v).length, l]).filter(([n]) => n).map(([n, l]) => n + ' ' + l);
    const none = open.filter((t) => !t.size).length;
    return h('span', { class: 'size-load', title: 'Tareas sin terminar, por tamaño' }, 'Falta ' + parts.join(' · ') + (none ? ' · ' + none + ' sin estimar' : ''));
  }

  // Fecha objetivo del hito (18.2): atrasado si pasó con tareas sin terminar; hoy, se marca; con todo hecho, apagada.
  function msDueMark(m, ts) {
    const complete = ts.length > 0 && ts.every((t) => t.status === 'done');
    const g = complete ? null : dueGroup(m.due);
    const cls = g === 'overdue' ? ' bad' : g === 'today' ? ' today' : '';
    return h('span', { class: 'duemark ms-due' + cls, title: 'Fecha objetivo del hito (scompass milestone set ' + m.id + ' --due …)' },
      (g === 'overdue' ? 'Atrasado · ' : g === 'today' ? 'Hoy · ' : 'Objetivo ') + showDue(m.due));
  }

  // Fecha límite de una tarea (8.13, D26): vencida u hoy se marcan, salvo en las hechas.
  function dueMark(t) {
    const g = t.status === 'done' ? null : dueGroup(t.due);
    const cls = g === 'overdue' ? ' bad' : g === 'today' ? ' today' : '';
    // "Vencida · " aparte: en la lista del teléfono se esconde y el recuadro rojo no se parte en dos renglones (19.13).
    return h('span', { class: 'duemark' + cls, title: g === 'overdue' ? 'Vencida' : g === 'today' ? 'Vence hoy' : 'Fecha límite' }, g === 'overdue' ? h('span', { class: 'dm-pre' }, 'Vencida · ') : null, showDue(t.due));
  }

  // Fecha y hora opcionales; vaciar la fecha la quita (null borra el campo en el PATCH). La hora aparece con la fecha.
  function dueField(t) {
    const [date, time] = t.due ? [t.due.slice(0, 10), t.due.slice(11)] : ['', ''];
    const save = () => {
      const d = document.getElementById('d-due').value, hm = document.getElementById('d-due-time')?.value ?? '';
      const next = d ? d + (hm ? 'T' + hm : '') : null;
      if (next !== (t.due ?? null)) updateTask(t.id, { due: next });
    };
    const g = t.due && t.status !== 'done' ? dueGroup(t.due) : null;
    return h('span', { class: 'pchip' + (t.due ? '' : ' empty') + (g === 'overdue' ? ' bad' : g === 'today' ? ' today' : ''), title: g === 'overdue' ? 'Vencida' : g === 'today' ? 'Vence hoy' : null },
      h('label', { class: 'pk', for: 'd-due' }, g === 'overdue' ? 'Vencida' : 'Vence'),
      h('input', { type: 'date', id: 'd-due', value: date, 'data-orig': date, onchange: save }),
      t.due ? [h('label', { for: 'd-due-time', class: 'sr' }, 'Hora'),
        h('input', { type: 'time', id: 'd-due-time', value: time, 'data-orig': time, onchange: save }),
        h('button', { class: 'rm', type: 'button', 'aria-label': 'Quitar fecha', title: 'Quitar fecha', onclick: () => updateTask(t.id, { due: null }) }, '×')] : null);
  }

  // Prioridad, responsable y etiquetas (D32), como chips de la fila de propiedades (13.3). Las sugerencias salen de lo que ya usan las otras tareas.
  // Una etiqueta no lleva comas: "arte, audio" son dos. Vaciar un campo lo quita (null en el PATCH).
  function metaFields(t) {
    const addTags = (raw) => {
      const add = String(raw).split(',').map((x) => x.trim()).filter((x) => x && x.length <= 40);
      if (!add.length) return;
      updateTask(t.id, (cur) => {
        const next = [...new Set([...tagsOf(cur), ...add])];
        if (next.length === tagsOf(cur).length) return null;
        // Plantilla de descripción de la etiqueta (18.6), si la tarea no tiene descripción: la misma regla que filters.js.
        const tpl = S.descTemplates;
        const tag = cur.description?.trim() ? null : next.find((x) => !tagsOf(cur).includes(x) && typeof tpl[x] === 'string' && tpl[x].trim());
        return tag ? { tags: next, description: tpl[tag] } : { tags: next };
      });
    };
    const takeTag = (el) => { const v = el.value; el.value = ''; el.dataset.orig = ''; addTags(v); };
    return [
      h('span', { class: 'pchip' + (t.priority ? ' prio-' + t.priority : ' empty') },
        h('label', { class: 'pk', for: 'd-priority' }, 'Prioridad'),
        h('select', { id: 'd-priority', onchange: (e) => updateTask(t.id, { priority: e.target.value || null }) },
          h('option', { value: '', selected: !t.priority }, '—'),
          PRIORITIES.map(([v, l]) => h('option', { value: v, selected: t.priority === v }, l)))),
      h('span', { class: 'pchip' + (t.size ? '' : ' empty') },
        h('label', { class: 'pk', for: 'd-size' }, 'Tamaño'),
        h('select', { id: 'd-size', title: 'Estimación: chica, mediana o grande', onchange: (e) => updateTask(t.id, { size: e.target.value || null }) },
          h('option', { value: '', selected: !t.size }, '—'),
          SIZES.map(([v, l]) => h('option', { value: v, selected: t.size === v }, l + ' · ' + SIZE_NAME[v])))),
      h('span', { class: 'pchip' + (t.assignee ? '' : ' empty') },
        h('label', { class: 'pk', for: 'd-assignee' }, 'Responsable'),
        h('input', { id: 'd-assignee', list: 'd-assignees', value: t.assignee || '', 'data-orig': t.assignee || '', placeholder: 'Nadie', autocomplete: 'off',
          onchange: (e) => { const v = e.target.value.trim(); if (v !== (t.assignee || '')) updateTask(t.id, { assignee: v || null }); } }),
        h('datalist', { id: 'd-assignees' }, allAssignees().map((x) => h('option', { value: x })))),
      h('span', { class: 'pchip tags-edit' + (tagsOf(t).length ? '' : ' empty') },
        h('label', { class: 'pk', for: 'd-tag' }, 'Etiquetas'),
        tagsOf(t).map((x) => h('span', { class: 'tag' }, x,
          h('button', { type: 'button', class: 'rm', 'aria-label': 'Quitar etiqueta ' + x,
            onclick: () => updateTask(t.id, (cur) => { const next = tagsOf(cur).filter((y) => y !== x); return { tags: next.length ? next : null }; }) }, '×'))),
        h('input', { id: 'd-tag', list: 'd-tags', placeholder: '+ etiqueta', autocomplete: 'off', 'data-orig': '',
          onkeydown: (e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); takeTag(e.target); } },
          onchange: (e) => { if (e.target.value.trim()) takeTag(e.target); } }),
        h('datalist', { id: 'd-tags' }, allTags().filter((x) => !tagsOf(t).includes(x)).map((x) => h('option', { value: x }))))
    ];
  }

  function cardFor(t, s) {
    const p = clProgress(t);
    const m = msById(t.milestone);
    const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
    return h('button', { class: 'card', type: 'button', draggable: 'true', style: 'border-left: 4px solid ' + s.color,
      'aria-current': S.openId === t.id ? 'true' : null, 'data-id': t.id,
      ondragstart: (e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; },
      title: S.sort ? 'Ordenadas por ' + sortLabel(S.sort.key).toLowerCase() + ': arrastrar solo cambia el estado (con orden manual, también reordena)' : null,
      // Con un orden elegido, soltar sobre una tarjeta es soltar en su columna: cambia el estado, no reordena.
      ondragover: (e) => { e.preventDefault(); if (!S.sort) e.currentTarget.classList.add('drop-before'); },
      ondragleave: (e) => e.currentTarget.classList.remove('drop-before'),
      ondrop: (e) => {
        if (S.sort) return;
        e.preventDefault(); e.stopPropagation();
        e.currentTarget.classList.remove('drop-before');
        e.currentTarget.closest('.col')?.classList.remove('over');
        const id = e.dataTransfer.getData('text/plain');
        if (id && id !== t.id) dropBefore(id, t);
      },
      onclick: () => openTask(t.id) },
      h('span', { class: 'meta' }, t.code ? h('span', null, t.code) : null, m && S.filter === 'all' ? h('span', { class: 'ms' }, m.code) : null,
        t.size ? h('span', { class: 'size', title: 'Tamaño: ' + SIZE_NAME[t.size] }, t.size.toUpperCase()) : null,
        t.assignee ? h('span', { class: 'who', title: 'Responsable' }, '@' + t.assignee) : null),
      h('span', { class: 't' }, rich(t.title, true)),
      t.priority === 'high' || tagsOf(t).length ? h('span', { class: 'marks' }, t.priority === 'high' ? h('span', { class: 'prio high', title: 'Prioridad alta' }, 'Alta') : null,
        tagsOf(t).map((x) => h('span', { class: 'tag' }, x))) : null,
      refsOf(t).length ? h('span', { class: 'refmark' + (brokenRefs(t).length ? ' bad' : ''), title: brokenRefs(t).length ? 'Tiene referencias rotas' : refsOf(t).length + ' referencias a documentos' },
        brokenRefs(t).length ? '⚠ ' : '§ ', refsOf(t).length) : null,
      openBlockers(t).length ? h('span', { class: 'blockmark', title: 'Bloqueada por: ' + openBlockers(t).map(taskName).join('; ') }, 'Bloqueada') : null,
      t.due ? dueMark(t) : null,
      p.total ? h('span', { class: 'cl' }, h('span', { class: 'bar', role: 'img', 'aria-label': p.done + ' de ' + p.total + ' pasos' }, h('i', { style: 'width:' + pct + '%' })), p.done + '/' + p.total) : null);
  }

  // Campos editables del detalle. Cada uno guarda en data-orig el valor con el que se dibujó:
  // si el usuario lo cambió y todavía no lo guardó, el valor escrito se conserva al redibujar.
  const EDITABLE = ['d-title', 'd-assignee', 'd-tag', 'd-addcl', 'd-refq', 'd-linkq', 'd-step-text', 'd-step-detail', 'd-description', 'd-test', 'd-notes', 'd-ptnote'];
  function captureEdits(box) {
    const active = box.contains(document.activeElement) ? document.activeElement : null;
    const dirty = {};
    for (const id of EDITABLE) {
      const el = document.getElementById(id);
      if (el && el.value !== el.dataset.orig) dirty[id] = el.value;
    }
    return {
      dirty,
      focus: active && active.id,
      sel: active && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null
    };
  }
  function restoreEdits({ dirty, focus, sel }) {
    for (const [id, value] of Object.entries(dirty)) {
      const el = document.getElementById(id);
      if (el) el.value = value;
    }
    const el = focus && document.getElementById(focus);
    if (!el) return;
    el.focus();
    if (sel && typeof el.setSelectionRange === 'function') { try { el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* checkbox, select */ } }
  }

  // Ancho del panel de detalle: se arrastra desde su borde izquierdo (o con las flechas) y se recuerda.
  const DETAIL_MIN = 360;
  const detailMax = () => Math.max(DETAIL_MIN, Math.round(window.innerWidth * 0.9));
  function setDetailWidth(w, save) {
    const px = Math.min(detailMax(), Math.max(DETAIL_MIN, Math.round(w)));
    document.documentElement.style.setProperty('--detail-w', px + 'px');
    if (save) pref('detailWidth', String(px));
    return px;
  }
  const detailWidth = () => document.getElementById('detail').getBoundingClientRect().width;
  function resizeHandle() {
    return h('div', {
      class: 'resize', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Ancho del panel', tabindex: '0',
      'aria-valuemin': String(DETAIL_MIN), 'aria-valuemax': String(detailMax()), 'aria-valuenow': String(Math.round(detailWidth())),
      title: 'Arrastrá para cambiar el ancho · doble clic: ancho original',
      onpointerdown: (e) => {
        e.preventDefault();
        const handle = e.currentTarget;
        handle.setPointerCapture(e.pointerId);
        document.body.classList.add('resizing');
        const move = (ev) => setDetailWidth(window.innerWidth - ev.clientX, false);
        const up = () => {
          handle.removeEventListener('pointermove', move);
          document.body.classList.remove('resizing');
          setDetailWidth(detailWidth(), true);
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up, { once: true });
        handle.addEventListener('pointercancel', up, { once: true });
      },
      onkeydown: (e) => {
        const step = e.shiftKey ? 96 : 24;
        if (e.key === 'ArrowLeft') setDetailWidth(detailWidth() + step, true);
        else if (e.key === 'ArrowRight') setDetailWidth(detailWidth() - step, true);
        else return;
        e.preventDefault();
        e.currentTarget.setAttribute('aria-valuenow', String(Math.round(detailWidth())));
      },
      ondblclick: () => { document.documentElement.style.removeProperty('--detail-w'); pref('detailWidth', ''); }
    });
  }
  { const w = Number(pref('detailWidth')); if (w) setDetailWidth(w, false); }

  // Un paso: texto corto, ▸ para desplegar el detalle si tiene, ✎ para editar texto y detalle, × para quitarlo.
  function stepItem(t, c, i) {
    const key = t.id + ':' + i;
    const id = 'cl-' + t.id + '-' + i;
    const check = h('input', { type: 'checkbox', id, 'aria-label': 'Hecho: ' + (c.text || ''), checked: !!c.done, onchange: (e) => { const done = e.target.checked; updateTask(t.id, (cur) => ({ checklist: checklistOf(cur).map((x, j) => j === i ? { ...x, done } : x) })); } });
    if (S.editStep === key) {
      const save = () => {
        const text = document.getElementById('d-step-text').value.trim();
        const detail = document.getElementById('d-step-detail').value.replace(/\s+$/, '');
        if (!text) return;
        S.editStep = null;
        updateTask(t.id, (cur) => ({ checklist: checklistOf(cur).map((x, j) => {
          if (j !== i) return x;
          const { detail: _old, ...rest } = x;
          return detail ? { ...rest, text, detail } : { ...rest, text };
        }) }));
      };
      const cancel = () => { S.editStep = null; renderDetail(); };
      return h('li', { class: 'editing' }, check,
        h('div', { class: 'step-edit' },
          h('label', { for: 'd-step-text', class: 'sr' }, 'Texto del paso'),
          h('input', { id: 'd-step-text', value: c.text || '', 'data-orig': c.text || '', placeholder: 'Texto corto del paso', autocomplete: 'off',
            onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } else if (e.key === 'Escape') { e.preventDefault(); cancel(); } } }),
          h('label', { for: 'd-step-detail', class: 'sr' }, 'Detalle del paso'),
          h('textarea', { id: 'd-step-detail', 'data-orig': c.detail || '', placeholder: 'Detalle (opcional): cómo, por qué, archivos, código…',
            onkeydown: (e) => { if (e.key === 'Escape') { e.preventDefault(); cancel(); } } }, c.detail || ''),
          h('div', { class: 'step-edit-actions' },
            h('button', { class: 'btn primary small', type: 'button', onclick: save }, 'Guardar'),
            h('button', { class: 'btn ghost small', type: 'button', onclick: cancel }, 'Cancelar'))));
    }
    const open = S.stepsOpen.has(key);
    const toggle = () => { open ? S.stepsOpen.delete(key) : S.stepsOpen.add(key); renderDetail(); };
    // El texto no marca el paso (eso es solo el checkbox): si tiene detalle, clickearlo lo despliega, como ▸.
    return h('li', { class: (c.done ? 'done' : '') + (c.detail ? ' has-detail' : '') }, check,
      h('div', { class: 'step-text', title: c.detail ? (open ? 'Ocultar detalle' : 'Ver detalle') : null,
        onclick: (e) => { if (c.detail && !e.target.closest('a') && !window.getSelection().toString()) toggle(); } }, rich(c.text)),
      c.detail ? h('button', { class: 'step-toggle', type: 'button', 'aria-expanded': open ? 'true' : 'false', 'aria-label': open ? 'Ocultar detalle' : 'Ver detalle',
        title: open ? 'Ocultar detalle' : 'Ver detalle', onclick: toggle }, open ? '▾' : '▸') : null,
      h('button', { class: 'rm', type: 'button', 'aria-label': 'Editar paso', title: 'Editar texto y detalle',
        onclick: () => { S.editStep = key; renderDetail(); document.getElementById('d-step-text')?.focus(); } }, '✎'),
      h('button', { class: 'rm', type: 'button', 'aria-label': 'Quitar paso', onclick: () => updateTask(t.id, (cur) => ({ checklist: checklistOf(cur).filter((_, j) => j !== i) })) }, '×'),
      c.detail && open ? h('div', { class: 'step-detail' }, rich(c.detail)) : null);
  }

  function renderDetail() {
    const box = document.getElementById('detail');
    const t = S.tasks.find((x) => x.id === S.openId);
    if (!t) { box.hidden = true; box.replaceChildren(); return; }
    const m = msById(t.milestone);
    const cl = Array.isArray(t.checklist) ? t.checklist : [];
    const p = clProgress(t);
    // Lo que el usuario está escribiendo en esta misma tarea sobrevive al redibujado (3.7).
    const edits = box.dataset.task === t.id ? captureEdits(box) : null;
    box.replaceChildren(
      resizeHandle(),
      h('div', { class: 'head' }, t.code || '', m ? h('span', { title: m.title }, (t.code ? '· ' : '') + m.code) : null,
        h('button', { class: 'btn ghost close', type: 'button', 'aria-label': 'Cerrar detalle', onclick: closeTask }, 'Cerrar')),
      h('label', { for: 'd-title', class: 'sr' }, 'Título'),
      h('input', { class: 'title', id: 'd-title', value: t.title || '', 'data-orig': t.title || '', onchange: (e) => { const v = e.target.value.trim(); if (v && v !== t.title) updateTask(t.id, { title: v }); } }),
      // Propiedades en una fila de chips que se editan en el lugar; los vacíos, apagados (13.3).
      h('div', { class: 'props', role: 'group', 'aria-label': 'Propiedades' },
        h('span', { class: 'pchip' },
          h('label', { class: 'pk', for: 'd-ms' }, 'Hito'),
          h('select', { id: 'd-ms', onchange: (e) => updateTask(t.id, { milestone: e.target.value }) },
            S.milestones.map((x) => h('option', { value: x.id, selected: x.id === t.milestone }, x.code + ' · ' + x.title)))),
        dueField(t),
        metaFields(t)),
      ptDetail(t) ?? '',
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Estado' }, STATUSES.map((s) =>
        h('button', { type: 'button', 'aria-pressed': (t.status || 'todo') === s.id ? 'true' : 'false', onclick: () => setStatus(t.id, s.id) }, s.label))),
      // Qué hay que hacer y por qué (D37), antes de los pasos. Vacía, el campo se quita.
      h('div', { style: 'display:flex;flex-direction:column;gap:6px' },
        h('label', { class: 'label', for: 'd-description' }, 'Descripción'),
        h('textarea', { id: 'd-description', 'data-orig': t.description || '', placeholder: 'Qué hay que hacer y por qué',
          onchange: (e) => updateTask(t.id, { description: e.target.value.trim() ? e.target.value : null }) }, t.description || ''),
        linksOf(t.description),
        renderImages(t)),
      h('div', { style: 'display:flex;flex-direction:column;gap:6px' },
        h('span', { class: 'label' }, 'Pasos ' + (p.total ? '(' + p.done + '/' + p.total + ')' : '')),
        cl.length ? h('ul', { class: 'checklist' }, cl.map((c, i) => stepItem(t, c, i))) : h('p', { style: 'margin:0;color:var(--muted);font-size:14px' }, 'Sin pasos todavía.'),
        h('form', { class: 'addcl', onsubmit: (e) => { e.preventDefault(); const inp = e.target.querySelector('input'); const v = inp.value.trim(); if (!v) return; inp.value = ''; updateTask(t.id, (cur) => ({ checklist: [...checklistOf(cur), { text: v, done: false }] })); } },
          h('label', { for: 'd-addcl', class: 'sr' }, 'Nuevo paso'),
          h('input', { id: 'd-addcl', placeholder: 'Agregar paso', autocomplete: 'off', 'data-orig': '' }),
          h('button', { class: 'btn', type: 'submit' }, 'Agregar'))),
      h('div', { style: 'display:flex;flex-direction:column;gap:6px' },
        h('label', { class: 'label', for: 'd-notes' }, 'Notas'),
        h('textarea', { id: 'd-notes', 'data-orig': t.notes || '', onchange: (e) => updateTask(t.id, { notes: e.target.value }) }, t.notes || ''),
        linksOf(t.notes)),
      renderRefs(t),
      renderTaskFiles(t),
      renderLinks(t),
      h('div', { style: 'display:flex;flex-direction:column;gap:6px' },
        h('label', { class: 'label', for: 'd-test' }, 'Cómo probarlo'),
        h('textarea', { id: 'd-test', 'data-orig': t.test || '', onchange: (e) => updateTask(t.id, { test: e.target.value }) }, t.test || ''),
        linksOf(t.test)),
      renderHistory(t),
      h('div', { class: 'footer-actions' },
        h('span', null, [t.done_at && 'Terminada ' + new Date(t.done_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }),
          t.updated_at && 'Actualizada ' + new Date(t.updated_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })].filter(Boolean).join(' · ')),
        S.confirmDelete
          ? h('span', { class: 'confirm' }, '¿Borrar la tarea?',
              h('button', { class: 'btn danger', type: 'button', onclick: () => { const id = t.id; closeTask(); const etag = t.etag; write(async () => { try { await api.remove(id, etag); } catch (e) { e.id = id; throw e; } applyTask(id, null); }, 'Tarea borrada'); } }, 'Sí, borrar'),
              h('button', { class: 'btn', type: 'button', onclick: () => { S.confirmDelete = false; renderDetail(); } }, 'No'))
          : h('button', { class: 'btn ghost danger', type: 'button', onclick: () => { S.confirmDelete = true; renderDetail(); } }, 'Borrar tarea')));
    box.hidden = false;
    box.dataset.task = t.id;
    // El separador se arma con el panel todavía oculto (ancho 0): el valor real, ya visible (19.12).
    box.querySelector('.resize')?.setAttribute('aria-valuenow', String(Math.round(detailWidth())));
    if (edits) restoreEdits(edits);
  }

  // Archivos que el hub no pudo leer: se ignoran hasta que alguien los corrija a mano (spec §4.3).
  const WARNING_TEXT = { invalid_json: 'JSON inválido', invalid_schema: 'no cumple el formato', conflict_markers: 'conflicto de git sin resolver', unknown_milestone: 'apunta a un hito que no existe', missing_config: 'falta', io_error: 'error de lectura' };
  function setWarning(w) {
    S.warnings = S.warnings.filter((x) => x.path !== w.path);
    S.warnings.push({ code: w.code, path: w.path, message: w.message });
  }
  const clearWarning = (collection, id) => { S.warnings = S.warnings.filter((x) => x.path !== 'compass/' + collection + '/' + id + '.json'); };
  function renderWarnings() {
    const box = document.getElementById('warnings');
    box.hidden = !S.warnings.length || S.offline;
    if (box.hidden) { box.replaceChildren(); return; }
    box.replaceChildren(
      h('h2', null, S.warnings.length === 1 ? 'Un archivo no se pudo leer' : S.warnings.length + ' archivos no se pudieron leer'),
      h('p', null, 'No se muestran ni se sobrescriben hasta que se corrijan a mano. Al arreglarlos, el aviso se va solo.'),
      h('ul', null, S.warnings.map((w) => h('li', null, h('code', null, w.path), ' · ' + (WARNING_TEXT[w.code] || w.code), h('span', { class: 'sr' }, ': ' + w.message)))));
  }

  // --- Documentos y referencias (M6) ------------------------------------------------------------

  const docByKey = (key) => S.docs.find((d) => d.alias === key) || S.docs.find((d) => d.path === key);
  const sectionOf = (d, id) => d && d.sections.find((x) => x.id === id);
  const refsOf = (t) => (Array.isArray(t.refs) ? t.refs : []);

  // Tareas que referencian una sección (o el documento entero, con id null): refs estructuradas y enlaces
  // [[alias#id]] o [[alias]] (los de dentro de `…` no cuentan).
  function tasksFor(d, id) {
    const hits = (key, sid) => (sid || null) === (id || null) && (key === d.alias || key === d.path);
    return S.tasks.filter((t) => refsOf(t).some((r) => hits(r.doc, r.section)) ||
      [t.description, t.notes, t.test, ...checklistOf(t).flatMap((c) => [c.text, c.detail])].some((txt) =>
        [...String(txt || '').replace(/`[^`]*`/g, '').matchAll(LINK)].some((m) => hits(m[1], m[2]))))
      .sort(sortTasks);
  }
  const brokenRefs = (t) => refsOf(t).filter((r) => linkTitle(r.doc, r.section) === null);
  const sameRef = (a, b) => (docByKey(a.doc)?.path || a.doc) === (docByKey(b.doc)?.path || b.doc) && (a.section || null) === (b.section || null);
  const allBroken = () => S.tasks.flatMap((t) => brokenRefs(t).map((r) => ({ t, r })));

  // HTML de una sección, pedido al desplegarla y guardado hasta que el documento cambie.
  function sectionHtml(d, id) {
    const key = d.alias + '#' + id;
    if (sectionCache.has(key)) return sectionCache.get(key);
    sectionCache.set(key, null);
    api.section(d.alias, id).then((r) => { sectionCache.set(key, r.html); renderDetail(); })
      .catch(() => { sectionCache.delete(key); });
    return null;
  }
  function htmlBox(cls, html, tag = 'div') {
    const el = h(tag, { class: cls });
    if (html === null || html === undefined) el.append(h('p', { class: 'muted' }, 'Cargando…'));
    else el.innerHTML = html; // HTML del hub: markdown-it sin HTML crudo del documento (D21)
    return el;
  }

  function renderRefs(t) {
    const refs = refsOf(t);
    const box = h('div', { class: 'refs' },
      h('div', { class: 'refs-head' }, h('span', { class: 'label' }, 'Referencias'),
        S.docs.length ? h('button', { class: 'btn ghost small', type: 'button', onclick: () => { S.refSearch = S.refSearch === null ? '' : null; renderDetail(); document.getElementById('d-refq')?.focus(); } }, S.refSearch !== null ? 'Cerrar' : '+ Agregar') : null));
    if (S.refSearch !== null) box.append(refSearch(t));
    if (!refs.length && S.refSearch === null) box.append(h('p', { class: 'muted small' }, S.docs.length ? 'Sin referencias.' : 'El proyecto no tiene documentos configurados (compass/config.json › docs).'));
    refs.forEach((r, i) => {
      const d = docByKey(r.doc);
      const sec = sectionOf(d, r.section);
      const key = t.id + '|' + r.doc + '#' + r.section;
      const remove = h('button', { class: 'rm', type: 'button', 'aria-label': 'Quitar referencia', onclick: () => updateTask(t.id, (cur) => ({ refs: refsOf(cur).filter((x) => !sameRef(x, r)) })) }, '×');
      // Al documento entero: no se despliega (puede ser largo), se abre en la vista Documentos.
      if (!r.section) {
        box.append(d && !d.missing
          ? h('div', { class: 'ref whole' }, h('div', { class: 'ref-head' },
            h('a', { class: 'ref-toggle', href: '#docs/' + encodeURIComponent(d.alias) }, h('span', { class: 'chev', 'aria-hidden': 'true' }, '▤'), docTitle(d)),
            h('span', { class: 'ref-id' }, d.path + ' · documento entero'),
            remove))
          : h('div', { class: 'ref broken' }, h('div', { class: 'ref-head' }, h('span', null, '⚠ Referencia rota: ', h('code', null, r.doc), ' no está'), remove)));
        return;
      }
      if (!sec) {
        box.append(h('div', { class: 'ref broken' }, h('div', { class: 'ref-head' },
          h('span', null, '⚠ Referencia rota: ', h('code', null, r.doc + '#' + r.section)),
          h('button', { class: 'btn ghost small', type: 'button', onclick: () => { S.refSearch = r.section.replace(/-/g, ' '); renderDetail(); document.getElementById('d-refq')?.focus(); } }, 'Buscar la sección nueva'),
          remove)));
        return;
      }
      const open = S.refsOpen.has(key) || (i === 0 && !S.refsOpen.has('closed:' + key));
      const toggle = () => { if (open) { S.refsOpen.delete(key); S.refsOpen.add('closed:' + key); } else { S.refsOpen.add(key); S.refsOpen.delete('closed:' + key); } renderDetail(); };
      box.append(h('div', { class: 'ref' + (open ? ' open' : '') },
        h('div', { class: 'ref-head' },
          h('button', { class: 'ref-toggle', type: 'button', 'aria-expanded': open ? 'true' : 'false', onclick: toggle },
            h('span', { class: 'chev', 'aria-hidden': 'true' }, open ? '▾' : '▸'), rich(sec.title)),
          h('span', { class: 'ref-id' }, d.alias + '#' + sec.id, sec.explicit ? null : ' · frágil'),
          h('a', { href: '#docs/' + encodeURIComponent(d.alias) + '/' + encodeURIComponent(sec.id) }, 'Abrir en el documento'),
          remove),
        open ? htmlBox('doc-body ref-body', sectionHtml(d, sec.id)) : null));
    });
    return box;
  }

  // --- Archivos del repo que toca la tarea (15.2) -----------------------------------------------
  // Cada uno lleva a la pestaña Archivos. Para marcar los que ya no están y para buscar se lee la lista del repo.
  const filesOf = (t) => (Array.isArray(t && t.files) ? t.files : []);
  function renderTaskFiles(t) {
    const data = S.filesData?.repo ? S.filesData : null;
    const box = h('div', { class: 'refs task-files' },
      h('div', { class: 'refs-head' }, h('span', { class: 'label' }, 'Archivos'),
        h('button', { class: 'btn ghost small', type: 'button', id: 'd-files-add', onclick: () => {
          S.fileSearch = S.fileSearch === null ? '' : null;
          if (!S.filesData) loadFiles();
          renderDetail(); document.getElementById('d-fileq')?.focus();
        } }, S.fileSearch !== null ? 'Cerrar' : '+ Agregar')));
    if (S.fileSearch !== null) box.append(fileSearch(t, data));
    if (!filesOf(t).length && S.fileSearch === null) box.append(h('p', { class: 'muted small' }, 'Sin archivos del repo.'));
    for (const f of filesOf(t)) {
      const gone = data && !data.files.includes(f);
      const state = data?.status[f];
      box.append(h('div', { class: 'link-row file-row' + (gone ? ' broken' : '') },
        gone ? h('span', { class: 'link-task' }, '⚠ ', h('code', null, f), ' ya no está en el repo')
          : h('a', { class: 'link-task', href: '#files/' + encodeURIComponent(f), title: 'Ver en Archivos' }, h('code', null, f),
            state ? h('span', { class: 'gitflag ' + state, title: GIT_FLAG[state]?.[1] }, GIT_FLAG[state]?.[0] ?? '•') : null),
        h('button', { class: 'rm', type: 'button', 'aria-label': 'Quitar archivo', onclick: () => updateTask(t.id, (cur) => {
          const next = filesOf(cur).filter((x) => x !== f);
          return next.length === filesOf(cur).length ? null : { files: next.length ? next : null };
        }) }, '×')));
    }
    return box;
  }
  // Buscador de archivos del repo por ruta (todas las palabras).
  function fileSearch(t, data) {
    const words = normText(S.fileSearch).split(/\s+/).filter(Boolean);
    const have = new Set(filesOf(t));
    const matches = data && words.length ? data.files.filter((p) => !have.has(p) && words.every((w) => normText(p).includes(w))).slice(0, 8) : [];
    return h('div', { class: 'ref-search' },
      h('label', { for: 'd-fileq', class: 'sr' }, 'Buscar archivo'),
      h('input', { id: 'd-fileq', placeholder: 'Buscar archivo del repo por nombre', autocomplete: 'off', value: S.fileSearch, 'data-orig': S.fileSearch,
        oninput: (e) => { S.fileSearch = e.target.value; renderDetail(); } }),
      !data ? h('p', { class: 'muted small' }, !S.filesData ? 'Leyendo los archivos…' : S.filesData.error || 'Este proyecto no está en un repo de git: no hay archivos que citar.')
        : h('ul', { class: 'ref-matches' }, matches.map((p) => h('li', null,
          h('button', { type: 'button', onclick: () => { S.fileSearch = null; updateTask(t.id, (cur) => (filesOf(cur).includes(p) ? null : { files: [...filesOf(cur), p] })); } },
            fileName(p), h('span', { class: 'ref-id' }, p))))),
      data && words.length && !matches.length ? h('p', { class: 'muted small' }, 'Ningún archivo coincide.') : null);
  }

  // --- Vínculos entre tareas (misma lógica que hub/src/links.js) ---------------------------------
  // Cada tarea guarda links: [{ type: 'blocks' | 'related', task }]; "bloqueada por" se calcula.

  const taskLinks = (t) => (Array.isArray(t && t.links) ? t.links : []);
  const taskById = (id) => S.tasks.find((x) => x.id === id);
  const taskName = (id) => { const t = taskById(id); return t ? [t.code, t.title].filter(Boolean).join(' ') : id + ' (no existe)'; };
  function linkView(id) {
    const out = { blocks: [], blockedBy: [], related: [] };
    const add = (list, x) => { if (x !== id && !list.includes(x)) list.push(x); };
    for (const l of taskLinks(taskById(id))) add(l.type === 'blocks' ? out.blocks : out.related, l.task);
    for (const t of S.tasks) for (const l of taskLinks(t)) if (l.task === id) add(l.type === 'blocks' ? out.blockedBy : out.related, t.id);
    return out;
  }
  // Tareas sin terminar que bloquean a esta (una tarea hecha no está bloqueada).
  const openBlockers = (t) => (t.status === 'done' ? [] : linkView(t.id).blockedBy.filter((b) => { const x = taskById(b); return x && x.status !== 'done'; }));
  // ¿from bloquea a to cerraría un ciclo? ignore: par cuyo vínculo actual se va a reemplazar.
  function wouldCycle(from, to) {
    const seen = new Set();
    const stack = [to];
    while (stack.length) {
      const cur = stack.pop();
      if (cur === from) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const l of taskLinks(taskById(cur))) if (l.type === 'blocks' && !(cur === to && l.task === from)) stack.push(l.task);
    }
    return false;
  }
  const unlinked = (cur, other) => { const next = taskLinks(cur).filter((l) => l.task !== other); return next.length === taskLinks(cur).length ? null : { links: next.length ? next : null }; };
  function removeLink(a, b) {
    updateTask(a, (cur) => unlinked(cur, b));
    if (taskById(b)) updateTask(b, (cur) => unlinked(cur, a));
  }
  // kind: 'blocks' (a bloquea a b), 'blockedBy' (b bloquea a a) o 'related'. Reemplaza el vínculo que hubiera.
  function setLink(a, kind, b) {
    const [from, to] = kind === 'blockedBy' ? [b, a] : [a, b];
    if (kind !== 'related' && wouldCycle(from, to)) { toast('No se puede: ' + taskName(to) + ' ya bloquea a ' + taskName(from) + '.'); return; }
    updateTask(to, (cur) => unlinked(cur, from));
    updateTask(from, (cur) => ({ links: [...taskLinks(cur).filter((l) => l.task !== to), { type: kind === 'related' ? 'related' : 'blocks', task: to }] }));
  }

  const LINK_KINDS = [['blockedBy', 'Bloqueada por'], ['blocks', 'Bloquea a'], ['related', 'Relacionada con']];
  function renderLinks(t) {
    const v = linkView(t.id);
    const total = v.blocks.length + v.blockedBy.length + v.related.length;
    const box = h('div', { class: 'refs links' },
      h('div', { class: 'refs-head' }, h('span', { class: 'label' }, 'Vínculos'),
        h('button', { class: 'btn ghost small', type: 'button', onclick: () => { S.linkSearch = S.linkSearch ? null : { type: 'blockedBy', q: '' }; renderDetail(); document.getElementById('d-linkq')?.focus(); } }, S.linkSearch ? 'Cerrar' : '+ Agregar')));
    if (S.linkSearch) box.append(linkSearch(t, v));
    if (!total && !S.linkSearch) box.append(h('p', { class: 'muted small' }, 'Sin vínculos con otras tareas.'));
    for (const [kind, label] of LINK_KINDS) {
      for (const id of v[kind]) {
        const other = taskById(id);
        const st = other && STATUSES.find((s) => s.id === (other.status || 'todo'));
        box.append(h('div', { class: 'link-row' + (other ? '' : ' broken') + (kind === 'blockedBy' && other && other.status !== 'done' && t.status !== 'done' ? ' blocking' : ''), 'data-kind': kind, 'data-task': id },
          h('span', { class: 'link-kind' }, label),
          other
            ? h('button', { class: 'link-task', type: 'button', title: 'Abrir la tarea', onclick: () => goToTask(id) }, rich(taskName(id), true))
            : h('span', { class: 'link-task' }, '⚠ ' + taskName(id)),
          st ? h('span', { class: 'link-status', style: 'color:' + st.color }, st.label) : null,
          h('button', { class: 'rm', type: 'button', 'aria-label': 'Quitar vínculo', onclick: () => removeLink(t.id, id) }, '×')));
      }
    }
    return box;
  }

  // Teclado en los buscadores de vínculos y referencias (19.12): Enter elige el primero, ↓ y ↑ recorren los resultados.
  function searchKeys(e) {
    const box = e.currentTarget.closest('.ref-search');
    const btns = [...box.querySelectorAll('.ref-matches button')];
    const at = btns.indexOf(document.activeElement);
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && btns.length) { e.preventDefault(); btns[0].click(); }
    else if (e.key === 'ArrowDown' && btns.length) { e.preventDefault(); btns[Math.min(at + 1, btns.length - 1)].focus(); }
    else if (e.key === 'ArrowUp' && at >= 0) { e.preventDefault(); (at === 0 ? box.querySelector('input') : btns[at - 1]).focus(); }
  }

  // Buscador de tareas para vincular: título, código o id.
  function linkSearch(t, v) {
    const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const words = norm(S.linkSearch.q).split(/\s+/).filter(Boolean);
    const have = new Set([t.id, ...v.blocks, ...v.blockedBy, ...v.related]);
    const matches = S.tasks.filter((x) => !have.has(x.id) && words.every((w) => norm(x.code + ' ' + x.title + ' ' + x.id).includes(w)))
      .sort((a, b) => (a.milestone === t.milestone ? 0 : 1) - (b.milestone === t.milestone ? 0 : 1) || sortTasks(a, b)).slice(0, 8);
    return h('div', { class: 'ref-search', onkeydown: searchKeys },
      h('div', { class: 'seg small', role: 'group', 'aria-label': 'Tipo de vínculo' }, LINK_KINDS.map(([kind, label]) =>
        h('button', { type: 'button', 'aria-pressed': S.linkSearch.type === kind ? 'true' : 'false', onclick: () => { S.linkSearch.type = kind; renderDetail(); document.getElementById('d-linkq')?.focus(); } }, label))),
      h('label', { for: 'd-linkq', class: 'sr' }, 'Buscar tarea'),
      h('input', { id: 'd-linkq', placeholder: 'Buscar tarea por título o código', autocomplete: 'off', value: S.linkSearch.q, 'data-orig': S.linkSearch.q,
        oninput: (e) => { S.linkSearch.q = e.target.value; renderDetail(); } }),
      h('ul', { class: 'ref-matches' }, matches.map((x) => h('li', null,
        h('button', { type: 'button', onclick: () => { const kind = S.linkSearch.type; S.linkSearch = null; setLink(t.id, kind, x.id); renderDetail(); } },
          rich(taskName(x.id), true), h('span', { class: 'ref-id' }, x.id))))),
      words.length && !matches.length ? h('p', { class: 'muted small' }, 'Ninguna tarea coincide.') : null);
  }

  // Buscador de secciones: título o id, en todos los documentos.
  function refSearch(t) {
    const q = String(S.refSearch || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const words = q.split(/\s+/).filter(Boolean);
    const norm = (x) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    // Cada documento entero (s: null) va antes que sus secciones; coincide por ruta, alias o su título.
    const matches = S.docs.filter((d) => !d.missing).flatMap((d) => [{ d, s: null }, ...d.sections.map((s) => ({ d, s }))])
      .filter(({ d, s }) => !refsOf(t).some((r) => sameRef(r, { doc: d.path, section: s?.id }))
        && words.every((w) => norm(s ? s.title + ' ' + s.id : d.path + ' ' + d.alias + ' ' + docTitle(d)).includes(w)))
      .slice(0, 8);
    return h('div', { class: 'ref-search', onkeydown: searchKeys },
      h('label', { for: 'd-refq', class: 'sr' }, 'Buscar sección'),
      h('input', { id: 'd-refq', placeholder: 'Buscar documento o sección', autocomplete: 'off', value: S.refSearch || '', 'data-orig': S.refSearch || '',
        oninput: (e) => { S.refSearch = e.target.value; renderDetail(); } }),
      h('ul', { class: 'ref-matches' }, matches.map(({ d, s }) => h('li', null,
        h('button', { type: 'button', onclick: () => {
          const ref = s ? { doc: d.path, section: s.id } : { doc: d.path };
          S.refSearch = null; updateTask(t.id, (cur) => refsOf(cur).some((x) => sameRef(x, ref)) ? null : ({ refs: [...refsOf(cur), ref] }));
        } },
          s ? rich(s.title) : h('span', null, '▤ ', docTitle(d)), h('span', { class: 'ref-id' }, s ? d.alias + '#' + s.id : d.path + ' · documento entero'))))),
      words.length && !matches.length ? h('p', { class: 'muted small' }, 'Ningún documento ni sección coincide.') : null);
  }

  // Vista Documentos: índice, documento y tareas que referencian la sección actual.
  const TASK_HASH = /^#task\/([^/]+)$/;
  function readHash() {
    const wasFiles = S.view === 'files';
    const f = /^#files(?:\/(.+))?$/.exec(location.hash);
    if (f) {
      S.view = 'files'; S.openId = null; S.confirmDelete = false; S.file = f[1] ? decodeURIComponent(f[1]) : '';
      if (!wasFiles && S.filesData) refreshFiles(); // al volver a la pestaña, la lista puede estar vieja
      return;
    }
    const l = /^#lists(?:\/([^/]+))?$/.exec(location.hash);
    if (l) { S.view = 'lists'; S.openId = null; S.confirmDelete = false; if (l[1]) S.list = decodeURIComponent(l[1]); return; }
    const pt = /^#playtest(?:\/([^/]+))?$/.exec(location.hash);
    if (pt) { S.view = 'playtest'; S.openId = null; S.confirmDelete = false; if (pt[1]) S.playtest = decodeURIComponent(pt[1]); return; }
    // La tarea se abre encima de la vista desde la que se abrió (taskFrom); un enlace directo, encima del tablero.
    const t = TASK_HASH.exec(location.hash);
    if (t) { S.view = viewOf(history.state?.taskFrom ?? ''); S.openId = decodeURIComponent(t[1]); return; }
    const m = /^#docs(?:\/([^/]+)(?:\/([^/]+))?)?$/.exec(location.hash);
    S.view = m ? 'docs' : 'board';
    S.openId = null; S.confirmDelete = false; // la tarea abierta tiene su ruta (#task/<id>, 16.7)
    if (m) { S.doc = m[1] ? decodeURIComponent(m[1]) : (S.doc || ''); S.sec = m[2] ? decodeURIComponent(m[2]) : ''; }
  }
  const viewOf = (hash) => /^#(lists|playtest|docs|files)\b/.exec(hash)?.[1] ?? 'board';
  function docHtml(alias) {
    if (docCache.has(alias)) return docCache.get(alias);
    docCache.set(alias, null);
    api.doc(alias).then((r) => { docCache.set(alias, r.html); renderDocs(true); scrollToSection(); }).catch(() => docCache.delete(alias));
    return null;
  }
  let docObserver = null;
  const backlinkTask = (t) => h('a', { href: '#', class: 'bl-task', onclick: (e) => { e.preventDefault(); goToTask(t.id); } },
    h('span', { class: 'dot', style: 'background:' + STATUSES.find((x) => x.id === t.status).color }), t.code ? h('span', { class: 'code' }, t.code) : null, h('span', { class: 't' }, rich(t.title)));
  // --- Biblioteca de documentos (M12, spec §20): árbol por carpetas, búsqueda, ficha del documento, alta y baja ---
  const fileName = (path) => path.replace(/^.*\//, '');
  const folderOf = (path) => (path.includes('/') ? path.replace(/[^/]*$/, '') : '');
  // Tareas que citan cada documento (ruta → Set de ids), enteras o por sección, en una sola pasada.
  function tasksByDoc() {
    const m = new Map();
    const add = (key, id) => { const d = docByKey(key); if (d) { if (!m.has(d.path)) m.set(d.path, new Set()); m.get(d.path).add(id); } };
    for (const t of S.tasks) {
      for (const r of refsOf(t)) add(r.doc, t.id);
      for (const txt of [t.description, t.notes, t.test, ...checklistOf(t).flatMap((c) => [c.text, c.detail])]) {
        for (const x of String(txt || '').replace(/`[^`]*`/g, '').matchAll(LINK)) add(x[1], t.id);
      }
    }
    return m;
  }
  // La entrada de config.json › docs que trae el documento: la suya, o el patrón que lo incluye.
  const entryOf = (d) => S.docEntries.find((e) => e.alias === d.alias) ||
    S.docEntries.find((e) => e.path.includes('*') && d.alias.startsWith(e.alias + '/'));

  function docTree(cur) {
    const counts = tasksByDoc();
    const folders = new Map();
    for (const d of S.docs) { const f = folderOf(d.path); if (!folders.has(f)) folders.set(f, []); folders.get(f).push(d); }
    return h('nav', { class: 'doc-tree', 'aria-label': 'Documentos del proyecto' }, [...folders.keys()].sort().map((f) => h('details', {
      class: 'folder', open: !S.foldersClosed.has(f),
      ontoggle: (e) => { if (e.target.open) S.foldersClosed.delete(f); else S.foldersClosed.add(f); } },
      h('summary', null, f || 'Raíz del proyecto'),
      folders.get(f).sort((a, b) => a.path.localeCompare(b.path)).map((d) => {
        const n = counts.get(d.path)?.size || 0;
        return h('a', { href: '#docs/' + encodeURIComponent(d.alias), class: 'tree-doc' + (d.missing ? ' missing' : ''), 'aria-current': d === cur ? 'page' : null,
          title: (d.missing ? 'No está: ' + d.path : docTitle(d)) + ' · ' + (n ? n + (n === 1 ? ' tarea' : ' tareas') : 'sin tareas: todavía no planificado') },
          h('span', { class: 'toc-dot' + (n ? ' has' : '') }), h('span', { class: 't' }, fileName(d.path)),
          changed(d) ? h('span', { class: 'gitflag ' + d.git, title: GIT_FLAG[d.git]?.[1] }, GIT_FLAG[d.git]?.[0] ?? '•') : null,
          n ? h('span', { class: 'n' }, n) : null);
      }))));
  }

  // Resultados de la búsqueda de texto (12.4), por documento. Las palabras buscadas se resaltan en el fragmento.
  function highlight(text, q) {
    const fold = (x) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const f = fold(text);
    const words = fold(q).split(/\s+/).filter(Boolean);
    if (f.length !== text.length) return text; // con caracteres que cambian de largo al plegarse, sin resaltar
    const marks = [];
    // Solo al empezar una palabra (19.13): "lan" no resalta "de-lan-te".
    const startsWord = (i) => i === 0 || !/[\p{L}\p{N}]/u.test(f[i - 1]);
    for (const w of words) for (let i = f.indexOf(w); i >= 0; i = f.indexOf(w, i + 1)) if (startsWord(i)) { marks.push([i, i + w.length]); }
    marks.sort((a, b) => a[0] - b[0]);
    const out = [];
    let last = 0;
    for (const [a, b] of marks) { if (a < last) continue; out.push(text.slice(last, a), h('mark', null, text.slice(a, b))); last = b; }
    out.push(text.slice(last));
    return out;
  }
  function docResults() {
    const r = S.docResults;
    if (!r || r.q !== S.docQ.trim()) return h('div', { class: 'doc-results' }, h('p', { class: 'muted' }, 'Buscando…'));
    const groups = new Map();
    for (const x of r.results) { if (!groups.has(x.alias)) groups.set(x.alias, []); groups.get(x.alias).push(x); }
    const go = (e) => { S.docQ = ''; S.docResults = null; const q = document.getElementById('doc-q'); if (q) q.value = ''; if (e.currentTarget.getAttribute('href') === location.hash) { e.preventDefault(); renderDocs(true); } };
    return h('div', { class: 'doc-results', role: 'region', 'aria-label': 'Resultados de la búsqueda' },
      h('p', { class: 'muted small' }, r.results.length ? r.results.length + (r.more ? '+' : '') + (r.results.length === 1 ? ' coincidencia' : ' coincidencias') + ' en ' + groups.size + (groups.size === 1 ? ' documento' : ' documentos') : 'Ninguna línea de los documentos tiene esas palabras.'),
      [...groups].map(([alias, xs]) => {
        const d = docByKey(alias);
        return h('section', { class: 'res-doc' }, h('h3', null, d ? docTitle(d) : alias, h('span', { class: 'ref-id' }, xs[0].path)),
          h('ul', null, xs.map((x) => h('li', null, h('a', { href: '#docs/' + encodeURIComponent(alias) + (x.section ? '/' + encodeURIComponent(x.section) : ''), onclick: go },
            h('span', { class: 'res-sec' }, x.title ? rich(x.title, true) : 'Antes del primer título'), h('span', { class: 'ref-id' }, 'línea ' + x.line),
            h('span', { class: 'snip' }, highlight(x.snippet, S.docQ)))))));
      }));
  }
  let searchTimer = null;
  function searchDocs(q) {
    S.docQ = q;
    clearTimeout(searchTimer);
    if (!q.trim()) { S.docResults = null; renderDocs(true); return; }
    renderDocs();
    searchTimer = setTimeout(() => api.docSearch(q.trim()).then((r) => { if (r.q === S.docQ.trim()) { S.docResults = r; renderDocs(); } }).catch(() => {}), 180);
  }

  // Agregar un documento (12.2): un archivo o un patrón; el hub reescribe config.json y avisa doc_changed.
  async function addDoc(e) {
    e.preventDefault();
    const alias = document.getElementById('doc-alias').value.trim(), path = document.getElementById('doc-path').value.trim();
    if (!alias || !path) return;
    try {
      const r = await api.docAdd(alias, path);
      [S.docs, S.docEntries] = await Promise.all([api.docs().then((x) => x.docs), api.config().then((c) => c.docs ?? [])]);
      S.docAdd = false;
      e.target.reset();
      toast('Agregado: ' + r.path);
      const first = S.docs.find((d) => d.alias === r.alias || d.alias.startsWith(r.alias + '/'));
      if (first) location.hash = '#docs/' + encodeURIComponent(first.alias); else render();
    } catch (err) { toast(err.message || 'No se pudo agregar.'); }
  }
  async function removeDoc(alias) {
    try {
      await api.docRemove(alias);
      [S.docs, S.docEntries] = await Promise.all([api.docs().then((x) => x.docs), api.config().then((c) => c.docs ?? [])]);
      S.docRemove = null;
      toast('Quitado de compass/config.json: ' + alias + ' (el archivo sigue ahí)');
      location.hash = '#docs';
      render();
    } catch (err) { toast(err.message || 'No se pudo quitar.'); }
  }

  // La barra de arriba se arma una sola vez (como la de filtros): el buscador y el formulario no pierden lo escrito
  // ni el foco cuando el hub manda un cambio.
  function docsBar(box) {
    if (box.querySelector('.docs-bar')) return;
    const q = h('input', { type: 'search', id: 'doc-q', placeholder: 'Buscar en los documentos', autocomplete: 'off', value: S.docQ,
      oninput: (e) => searchDocs(e.target.value),
      onkeydown: (e) => { if (e.key === 'Escape' && e.target.value) { e.preventDefault(); e.stopPropagation(); e.target.value = ''; searchDocs(''); } } });
    box.append(
      h('div', { class: 'docs-bar' }, h('label', { for: 'doc-q', class: 'sr' }, 'Buscar en los documentos'), q, h('span', { class: 'docs-info' }),
        h('button', { class: 'btn ghost small', type: 'button', id: 'doc-add-btn', 'aria-expanded': 'false',
          onclick: () => { S.docAdd = !S.docAdd; renderDocs(); if (S.docAdd) document.getElementById('doc-alias').focus(); } }, '+ Documento')),
      h('form', { class: 'doc-add', id: 'doc-add', hidden: true, onsubmit: addDoc },
        h('label', { for: 'doc-alias' }, 'Alias'), h('input', { id: 'doc-alias', placeholder: 'enemigos', autocomplete: 'off', required: true, pattern: '[a-z0-9][a-z0-9_\\-]*', title: 'Minúsculas, números, - y _',
          // El aviso del navegador sale en su idioma ("Please match…"): el nuestro (19.13).
          oninvalid: (e) => e.target.setCustomValidity(e.target.validity.valueMissing ? 'Falta el alias.' : 'Minúsculas, números, - y _; empieza con letra o número.'),
          oninput: (e) => e.target.setCustomValidity('') }),
        h('label', { for: 'doc-path' }, 'Archivo o patrón'), h('input', { id: 'doc-path', placeholder: 'docs/enemigos.md o docs/**/*.md', autocomplete: 'off', required: true }),
        h('button', { class: 'btn primary small', type: 'submit' }, 'Agregar'),
        h('button', { class: 'btn ghost small', type: 'button', onclick: () => { S.docAdd = false; renderDocs(); } }, 'Cancelar'),
        h('p', { class: 'muted small' }, 'Ruta desde la raíz del proyecto. Se anota en compass/config.json › docs; el archivo no se toca.')));
  }

  // Ficha del documento: de dónde sale, su estado de git y qué tareas lo citan (12.5).
  const GIT_TEXT = { clean: 'Sin cambios', modified: 'Modificado sin commitear', added: 'Nuevo (agregado a git)', untracked: 'Nuevo, sin seguir en git', deleted: 'Borrado', renamed: 'Renombrado' };
  function docCard(d) {
    const e = entryOf(d);
    const own = e && e.alias === d.alias;
    return h('div', { class: 'doc-card' },
      h('h2', null, d.missing ? fileName(d.path) : docTitle(d)),
      h('code', null, d.path),
      d.missing ? h('p', { class: 'small bad' }, 'El archivo no está.') : null,
      d.git ? h('p', { class: 'small doc-git ' + d.git }, h('span', { class: 'dot' }), GIT_TEXT[d.git] || d.git) : null,
      own ? (S.docRemove === d.alias
        ? h('p', { class: 'confirm small' }, '¿Dejar de mostrarlo? El archivo no se borra.',
          h('button', { class: 'btn danger small', type: 'button', onclick: () => removeDoc(d.alias) }, 'Quitar'),
          h('button', { class: 'btn small', type: 'button', onclick: () => { S.docRemove = null; renderDocs(); } }, 'No'))
        : h('button', { class: 'btn ghost small', type: 'button', id: 'doc-rm', onclick: () => { S.docRemove = d.alias; renderDocs(); } }, 'Quitar del proyecto'))
        : e ? h('p', { class: 'muted small' }, 'Incluido por el patrón ', h('code', null, e.path), '.') : null);
  }

  // --- Cambios de los documentos (12.6): marca en el árbol, diff contra HEAD, historial y secciones tocadas ---
  // docs_git llega al editar un documento o al commitear: el estado nuevo de cada uno, y el historial puede haber
  // cambiado aunque el estado no (un commit), así que se olvida todo lo pedido.
  function applyDocsGit(m) {
    for (const d of S.docs) { const g = m.repo ? m.docs?.[d.alias] : undefined; if (g) d.git = g; else delete d.git; }
    gitCache.clear();
    renderDocs();
  }
  function docGit(d, kind) {
    const c = gitCache.get(d.alias) || {};
    if (c[kind] === undefined) {
      gitCache.set(d.alias, { ...c, [kind]: null });
      (kind === 'log' ? api.docLog(d.alias) : api.docDiff(d.alias)).then((r) => {
        const cur = gitCache.get(d.alias);
        if (cur && cur[kind] === null) { cur[kind] = r; renderDocs(); }
      }).catch(() => { const cur = gitCache.get(d.alias); if (cur) delete cur[kind]; });
    }
    return c[kind] ?? null;
  }
  const changed = (d) => d.git && d.git !== 'clean';
  const GIT_FLAG = { modified: ['M', 'Modificado sin commitear'], added: ['N', 'Nuevo, agregado a git'], untracked: ['N', 'Nuevo, sin seguir en git'], deleted: ['B', 'Borrado'], renamed: ['R', 'Renombrado'] };
  const shortDate = (iso) => { const t = new Date(iso); return isNaN(t) ? iso : t.toLocaleDateString('es', { day: 'numeric', month: 'short', ...(t.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) }); };
  const commitLine = (c) => h('span', { class: 'commit', title: c.hash + ' · ' + new Date(c.date).toLocaleString('es') + ' · ' + c.author },
    h('code', null, c.hash), ' ', shortDate(c.date), ' · ', c.subject);

  // El diff contra HEAD, línea por línea, con el título de la sección donde empieza cada bloque.
  function diffView(d, info) {
    if (!info) return h('div', { class: 'doc-diff' }, h('p', { class: 'muted' }, 'Cargando los cambios…'));
    const rows = [];
    let plus = 0, minus = 0;
    for (const l of info.diff.split('\n')) {
      const hk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(l);
      if (hk) {
        // Las secciones de /api/docs traen lines: [primera, última], desde 1.
        const at = Number(hk[1]);
        const s = d.sections.findLast((x) => x.lines[0] <= at && at <= x.lines[1]);
        rows.push(h('div', { class: 'dl hunk' }, 'Línea ' + hk[1] + (s ? ' · ' : ''), s ? rich(s.title, true) : null));
      } else if (!rows.length || l.startsWith('\\')) continue; // encabezados de git (diff, index, ---, +++)
      else if (l.startsWith('+')) { plus++; rows.push(h('div', { class: 'dl add' }, h('span', { class: 'mk', 'aria-label': 'agregada' }, '+'), l.slice(1))); }
      else if (l.startsWith('-')) { minus++; rows.push(h('div', { class: 'dl del' }, h('span', { class: 'mk', 'aria-label': 'quitada' }, '−'), l.slice(1))); }
      else if (l) rows.push(h('div', { class: 'dl' }, h('span', { class: 'mk' }, ' '), l.slice(1)));
    }
    return h('div', { class: 'doc-diff', role: 'region', 'aria-label': 'Cambios sin commitear' },
      h('div', { class: 'diff-head' }, h('strong', null, 'Cambios sin commitear'), h('span', { class: 'ref-id' }, d.path + ' contra HEAD'),
        h('span', { class: 'diff-n' }, h('span', { class: 'add' }, '+' + plus), ' ', h('span', { class: 'del' }, '−' + minus))),
      rows.length ? h('div', { class: 'diff-body' }, rows) : h('p', { class: 'muted' }, 'Sin cambios contra HEAD.'));
  }

  // En la ficha: el último commit, los cambios (con las tareas de las secciones tocadas) y el historial.
  function docGitCard(d, info) {
    if (!d.git) return null;
    const log = docGit(d, 'log');
    const touched = info ? info.sections : [];
    const affected = [...new Set(touched.flatMap((id) => tasksFor(d, id)))];
    return h('div', { class: 'doc-gitcard' },
      log === null ? h('p', { class: 'muted small' }, 'Cargando el historial…')
        : log.commits.length ? h('p', { class: 'small' }, h('span', { class: 'muted' }, 'Último commit: '), commitLine(log.commits[0])) : h('p', { class: 'muted small' }, 'Todavía sin commits.'),
      changed(d) ? h('button', { class: 'btn small' + (S.docDiff ? ' primary' : ''), type: 'button', id: 'doc-diff-btn', 'aria-pressed': S.docDiff ? 'true' : 'false',
        onclick: () => { S.docDiff = !S.docDiff; renderDocs(true); } }, S.docDiff ? 'Ver el documento' : 'Ver los cambios') : null,
      changed(d) && touched.length ? h('div', { class: 'affected' }, h('div', { class: 'label' }, 'Pueden quedar afectadas · ' + (affected.length === 1 ? '1 tarea' : affected.length + ' tareas')),
        affected.length ? affected.map(backlinkTask) : h('p', { class: 'muted small' }, 'Ninguna tarea cita las secciones que cambiaron.')) : null,
      log && log.commits.length > 1 ? h('details', { class: 'history' }, h('summary', null, 'Historial · ' + log.commits.length + ' commits'),
        h('ol', null, log.commits.map((c) => h('li', null, commitLine(c), h('span', { class: 'muted' }, ' · ' + c.author))))) : null);
  }

  function renderDocs(rebuildArticle) {
    const box = document.getElementById('docs');
    if (S.view !== 'docs') { box.replaceChildren(); return; }
    docsBar(box);
    const form = document.getElementById('doc-add');
    form.hidden = !S.docAdd && S.docs.length > 0;
    document.getElementById('doc-add-btn').setAttribute('aria-expanded', String(!form.hidden));
    const q = document.getElementById('doc-q');
    q.hidden = !S.docs.length;
    const info = box.querySelector('.docs-info');
    let body = box.querySelector('.docs-body');
    if (!body) { body = h('div', { class: 'docs-body' }); box.append(body); }
    if (!S.docs.length) {
      info.replaceChildren();
      body.replaceChildren(h('div', { class: 'notice' }, 'Este proyecto no tiene documentos todavía. Agregá uno arriba (o con ', h('code', null, 'scompass doc add <alias> <ruta>'), ').'));
      return;
    }
    const d = docByKey(S.doc) || S.docs[0];
    S.doc = d.alias;
    const sec = sectionOf(d, S.sec);
    const broken = allBroken();
    const searching = !!S.docQ.trim();
    const existing = body.querySelector('article.doc-body');
    const keepArticle = existing && existing.dataset.alias === d.alias && existing.dataset.ready === '1' && docCache.get(d.alias) && !rebuildArticle;
    const article = keepArticle ? existing : htmlBox('doc-body', docHtml(d.alias), 'article');
    article.dataset.alias = d.alias;
    article.dataset.ready = docCache.get(d.alias) ? '1' : '0';
    article.classList.add('doc-article');
    const counts = new Map(d.sections.map((s) => [s.id, tasksFor(d, s.id).length]));
    const unplanned = d.sections.filter((s) => !counts.get(s.id));
    // Con cambios sin commitear se pide el diff: marca las secciones tocadas aunque no se esté mirando.
    const diff = changed(d) ? docGit(d, 'diff') : null;
    const touched = new Set(diff?.sections ?? []);
    const showDiff = S.docDiff && changed(d) && !searching;
    info.replaceChildren(...[
      h('span', { class: 'pill' + (broken.length ? ' bad' : '') }, h('span', { class: 'dot' }), broken.length === 1 ? '1 referencia rota' : broken.length + ' referencias rotas'),
      // Enlace [[alias#id]] a la sección actual, para pegarlo en notas o pasos (6.6).
      sec && !sec.explicit ? h('span', { class: 'fragile', title: 'Agregá <!-- id: … --> debajo del título en ' + d.path + ' (o scompass doc stamp-ids ' + d.alias + ')' },
        'Sin id: el enlace se rompe si cambiás el título') : null,
      // Sin sección elegida, el enlace es al documento entero: [[alias]].
      h('button', { class: 'btn ghost small copy-link', type: 'button', title: 'Copia [[' + d.alias + (sec ? '#' + sec.id : '') + ']] para pegar en notas o pasos',
        onclick: () => copy('[[' + d.alias + (sec ? '#' + sec.id : '') + ']]') }, sec ? 'Copiar enlace' : 'Copiar enlace al documento')].filter(Boolean));
    const whole = tasksFor(d, null);
    body.replaceChildren(h('div', { class: 'docs-grid' },
      h('div', { class: 'docs-side' },
        docTree(d),
        d.sections.length ? h('nav', { class: 'toc', 'aria-label': 'Índice de ' + d.path }, d.sections.map((s) => h('a', {
          href: '#docs/' + encodeURIComponent(d.alias) + '/' + encodeURIComponent(s.id), 'aria-current': s.id === S.sec ? 'true' : null,
          style: 'padding-left:' + (6 + (s.level - 1) * 12) + 'px', title: counts.get(s.id) ? counts.get(s.id) + ' tareas' : 'Sin tareas: todavía no planificada'
        }, h('span', { class: 'toc-dot' + (counts.get(s.id) ? ' has' : '') }), h('span', { class: 't' }, rich(s.title)),
          touched.has(s.id) ? h('span', { class: 'chg', title: 'Cambió sin commitear' }, '±') : null,
          counts.get(s.id) ? h('span', { class: 'n' }, counts.get(s.id)) : null))) : null),
      searching ? docResults() : showDiff ? diffView(d, diff) : article,
      h('aside', { class: 'backlinks', 'aria-label': 'Ficha del documento' },
        docCard(d),
        docGitCard(d, diff),
        sec ? [h('div', { class: 'label' }, 'Referenciada por · ' + (counts.get(sec.id) === 1 ? '1 tarea' : counts.get(sec.id) + ' tareas')),
          ...tasksFor(d, sec.id).map(backlinkTask),
          counts.get(sec.id) ? null : h('p', { class: 'muted small' }, 'Ninguna tarea referencia esta sección: parte del diseño todavía sin planificar.')]
          : [h('div', { class: 'label' }, 'Referencian el documento · ' + (whole.length === 1 ? '1 tarea' : whole.length + ' tareas')),
            ...whole.map(backlinkTask),
            h('p', { class: 'muted small' }, 'Elegí una sección del índice para ver qué tareas la referencian.')],
        // Diseño sin planificar: las secciones que ninguna tarea cita.
        !sec && unplanned.length ? h('details', { class: 'unplanned' }, h('summary', { class: 'label' }, 'Secciones sin tareas · ' + unplanned.length + ' de ' + d.sections.length),
          h('ul', null, unplanned.map((s) => h('li', null, h('a', { href: '#docs/' + encodeURIComponent(d.alias) + '/' + encodeURIComponent(s.id) }, rich(s.title)))))) : null)),
      // En el teléfono el índice y la ficha quedan lejos del texto: fijos abajo, el índice para saltar de sección (16.4)
      // y las tareas de la sección que se lee (16.2), que se deslizan al lado.
      d.sections.length && !searching && !showDiff ? h('nav', { class: 'sec-bar', 'aria-label': 'Índice y tareas de la sección' },
        h('select', { 'aria-label': 'Ir a una sección', onchange: (e) => { location.hash = '#docs/' + encodeURIComponent(d.alias) + '/' + encodeURIComponent(e.target.value); } },
          sec ? null : h('option', { value: '', selected: true, disabled: true }, 'Índice'),
          d.sections.map((s) => h('option', { value: s.id, selected: s.id === sec?.id }, '\u00a0\u00a0'.repeat(s.level - 1) + rich(s.title, true).textContent))),
        h('div', { class: 'sec-tasks' }, !sec ? null : counts.get(sec.id)
          ? [h('span', { class: 'label' }, counts.get(sec.id) === 1 ? '1 tarea' : counts.get(sec.id) + ' tareas'), ...tasksFor(d, sec.id).map(backlinkTask)]
          : h('span', { class: 'muted small' }, 'Sin tareas'))) : null);
    if (!searching && !showDiff) observeHeadings(article); else docObserver?.disconnect();
  }
  // Al bajar por el documento, el índice y los backlinks siguen a la sección visible.
  function observeHeadings(article) {
    docObserver?.disconnect();
    if (!('IntersectionObserver' in window)) return;
    // El primer aviso es el del armado, no de un scroll: abrir un documento sin sección deja la ficha del documento entero.
    let initial = true;
    docObserver = new IntersectionObserver((entries) => {
      if (initial) { initial = false; return; }
      const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      const id = top?.target.dataset.section;
      if (id && id !== S.sec && !scrollingTo) {
        S.sec = id;
        history.replaceState(null, '', '#docs/' + encodeURIComponent(S.doc) + '/' + encodeURIComponent(id));
        renderDocs();
      }
    }, { rootMargin: '0px 0px -70% 0px' });
    article.querySelectorAll('[data-section]').forEach((el) => docObserver.observe(el));
  }
  let scrollingTo = false;
  function scrollToSection() {
    if (S.view !== 'docs' || !S.sec) return;
    const el = document.getElementById('sec-' + S.sec);
    if (!el) return;
    scrollingTo = true;
    el.scrollIntoView({ block: 'start' });
    setTimeout(() => { scrollingTo = false; }, 300);
  }
  function goToTask(id) {
    const t = S.tasks.find((x) => x.id === id);
    if (!t) return;
    if (S.view === 'board' && S.filter !== 'all' && S.filter !== t.milestone) setFilter(t.milestone);
    openTask(id);
  }
  function docChanged(alias) {
    for (const k of [...sectionCache.keys()]) if (k.startsWith(alias + '#')) sectionCache.delete(k);
    docCache.delete(alias);
    gitCache.delete(alias);
    Promise.all([api.docs(), api.config()]).then(([r, c]) => { S.docs = r.docs; S.docEntries = c.docs ?? []; render(); }).catch(() => {});
  }

  // --- Archivos del repo (M14, spec §22) ---
  // Lo que git no ignora, con su estado. Se vuelve a leer al entrar a la pestaña, con cualquier evento del hub, al
  // volver a la ventana y con Actualizar: los cambios hechos en el editor no avisan solos.
  let filesLoading = false, filesTimer = null, filesStamp = 0;
  async function loadFiles() {
    if (filesLoading) return;
    filesLoading = true;
    try { S.filesData = await api.files(); } catch (e) { S.filesData = { error: e.message }; }
    filesLoading = false;
    fileCache.clear();
    filesStamp = Date.now();
    renderFiles();
    if (S.openId) renderDetail(); // el detalle marca los archivos que ya no están y busca en la lista
  }
  function refreshFiles() { clearTimeout(filesTimer); filesTimer = setTimeout(loadFiles, 300); }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.view === 'files') refreshFiles(); });
  // info (/api/files/file) o diff de un archivo: undefined sin pedir, null pidiéndose; al llegar, se redibuja.
  function fileGet(path, kind) {
    const c = fileCache.get(path) ?? {};
    if (c[kind] !== undefined) return c[kind];
    c[kind] = null;
    fileCache.set(path, c);
    (kind === 'info' ? api.file(path) : api.fileDiff(path)).then((r) => { c[kind] = r; }, (e) => { c[kind] = { error: e.message }; })
      .then(() => { if (S.view === 'files' && S.file === path) renderFiles(); });
    return null;
  }
  const fmtSize = (n) => (n < 1024 ? n + ' B' : n < 1 << 20 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
  const fileLink = (path, state, label) => h('a', { href: '#files/' + encodeURIComponent(path), class: 'tree-doc', 'aria-current': S.file === path ? 'page' : null,
    title: path + (state ? ' · ' + GIT_TEXT[state] : '') },
    h('span', { class: 't' }, label), state ? h('span', { class: 'gitflag ' + state, title: GIT_FLAG[state]?.[1] }, GIT_FLAG[state]?.[0] ?? '•') : null);

  // Barra de arriba: se arma una vez, como la de Documentos, para que el filtro no pierda el foco.
  function filesBar(box) {
    if (box.querySelector('.files-bar')) return;
    const q = h('input', { type: 'search', id: 'file-q', placeholder: 'Filtrar archivos por nombre', autocomplete: 'off', value: S.fileQ,
      oninput: (e) => { S.fileQ = e.target.value; renderFiles(); },
      onkeydown: (e) => { if (e.key === 'Escape' && e.target.value) { e.preventDefault(); e.stopPropagation(); e.target.value = ''; S.fileQ = ''; renderFiles(); } } });
    box.append(h('div', { class: 'docs-bar files-bar' }, h('label', { for: 'file-q', class: 'sr' }, 'Filtrar archivos por nombre'), q,
      h('button', { type: 'button', class: 'chip small', id: 'files-changed', onclick: () => { S.filesChanged = !S.filesChanged; renderFiles(); } }),
      h('span', { class: 'docs-info files-info' }),
      h('button', { class: 'btn ghost small', type: 'button', id: 'files-refresh', title: 'Volver a leer los archivos y el estado de git', onclick: loadFiles }, 'Actualizar')),
    h('div', { class: 'files-body' }));
  }

  // Árbol por carpetas (se arma una vez por lista). Cada carpeta cuenta los archivos con cambios que tiene adentro.
  function fileTreeOf(data) {
    if (data.tree) return data.tree;
    const root = { path: '', dirs: new Map(), files: [], changes: 0 };
    for (const p of data.files) {
      const parts = p.split('/');
      let node = root;
      if (data.status[p]) root.changes++;
      for (const name of parts.slice(0, -1)) {
        const path = node.path + name + '/';
        if (!node.dirs.has(name)) node.dirs.set(name, { path, name, dirs: new Map(), files: [], changes: 0 });
        node = node.dirs.get(name);
        if (data.status[p]) node.changes++;
      }
      node.files.push(p);
    }
    return (data.tree = root);
  }
  function fileTree(data) {
    const words = normText(S.fileQ).split(/\s+/).filter(Boolean);
    // Con filtro o "Solo con cambios", una lista plana de rutas.
    if (words.length || S.filesChanged) {
      const hits = data.files.filter((p) => (!S.filesChanged || data.status[p]) && words.every((w) => normText(p).includes(w)));
      return h('nav', { class: 'doc-tree file-tree', 'aria-label': 'Archivos encontrados' },
        hits.length ? hits.slice(0, 300).map((p) => fileLink(p, data.status[p], p)) : h('p', { class: 'muted small' }, S.filesChanged && !words.length ? 'Sin cambios: todo está commiteado.' : 'Ningún archivo coincide.'),
        hits.length > 300 ? h('p', { class: 'muted small' }, 'Y ' + (hits.length - 300) + ' más: afiná el filtro.') : null);
    }
    // Las carpetas se arman solo si están abiertas: un repo grande no dibuja miles de filas.
    const level = (node) => [
      ...[...node.dirs.values()].sort((a, b) => byText(a.name, b.name)).map((d) => h('details', { class: 'folder', open: S.filesOpen.has(d.path),
        ontoggle: (e) => {
          if (e.target.open === S.filesOpen.has(d.path)) return; // el aviso de cuando se dibuja abierta
          if (e.target.open) { S.filesOpen.add(d.path); renderFiles(); } else S.filesOpen.delete(d.path);
        } },
        h('summary', null, d.name + '/', d.changes ? h('span', { class: 'gitflag modified', title: d.changes === 1 ? '1 archivo con cambios' : d.changes + ' archivos con cambios' }, d.changes) : null),
        S.filesOpen.has(d.path) ? h('div', { class: 'tree-in' }, level(d)) : null)),
      ...node.files.map((p) => fileLink(p, data.status[p], fileName(p)))
    ];
    return h('nav', { class: 'doc-tree file-tree', 'aria-label': 'Archivos del repo' }, level(fileTreeOf(data)));
  }

  // Sin archivo elegido: la rama, los cambios sin commitear y los últimos commits.
  function repoSummary(data, changed) {
    const remote = data.ahead === undefined ? 'Sin rama remota que seguir.'
      : !data.ahead && !data.behind ? 'Al día con la rama remota.'
      : [data.ahead ? data.ahead + (data.ahead === 1 ? ' commit sin subir' : ' commits sin subir') : null, data.behind ? data.behind + ' por traer' : null].filter(Boolean).join(' · ') + '.';
    return h('div', { class: 'doc-article files-summary' },
      h('h2', null, data.branch ? 'Rama ' + data.branch : 'HEAD suelto, sin rama'),
      h('p', { class: 'muted small' }, remote),
      h('h3', null, 'Cambios sin commitear · ' + changed.length),
      changed.length ? h('ul', { class: 'changes' }, changed.map((p) => h('li', null, fileLink(p, data.status[p], p))))
        : h('p', { class: 'muted' }, 'Ninguno: todo está commiteado.'),
      h('h3', null, 'Últimos commits'),
      data.commits.length ? h('ol', { class: 'commits' }, data.commits.map((c) => h('li', null, commitLine(c), h('span', { class: 'muted' }, ' · ' + c.author))))
        : h('p', { class: 'muted' }, 'Todavía sin commits.'));
  }

  // Un archivo: su ficha (estado, último commit, historial) y su contenido o sus cambios contra HEAD.
  function fileView(data, path) {
    const state = data.status[path] ?? 'clean';
    if (!data.files.includes(path)) return h('div', { class: 'notice' }, 'No hay un archivo ', h('code', null, path), ' en el repo (o git lo ignora).');
    const info = fileGet(path, 'info');
    const showDiff = S.fileDiff && state !== 'clean';
    const diff = showDiff ? fileGet(path, 'diff') : null;
    const doc = S.docs.find((d) => d.path === path);
    const citing = S.tasks.filter((t) => filesOf(t).includes(path));
    const commits = info?.commits ?? [];
    const card = h('div', { class: 'doc-card file-card' },
      h('h2', null, fileName(path)), h('code', null, path),
      h('p', { class: 'small doc-git ' + state }, h('span', { class: 'dot' }), GIT_TEXT[state] || state, info?.size ? h('span', { class: 'muted' }, ' · ' + fmtSize(info.size)) : null),
      commits.length ? h('p', { class: 'small' }, h('span', { class: 'muted' }, 'Último commit: '), commitLine(commits[0])) : info ? h('p', { class: 'muted small' }, 'Todavía sin commits.') : null,
      h('div', { class: 'file-actions' },
        state !== 'clean' ? h('button', { class: 'btn small' + (showDiff ? ' primary' : ''), type: 'button', id: 'file-diff-btn', 'aria-pressed': showDiff ? 'true' : 'false',
          onclick: () => { S.fileDiff = !showDiff; renderFiles(); } }, showDiff ? 'Ver el archivo' : 'Ver los cambios') : null,
        doc ? h('a', { class: 'btn ghost small', href: '#docs/' + encodeURIComponent(doc.alias) }, 'Abrir en Documentos') : null),
      citing.length ? h('div', { class: 'affected file-tasks' }, h('div', { class: 'label' }, 'Citado por · ' + (citing.length === 1 ? '1 tarea' : citing.length + ' tareas')),
        citing.map(backlinkTask)) : null,
      commits.length > 1 ? h('details', { class: 'history' }, h('summary', null, 'Historial · ' + commits.length + ' commits'),
        h('ol', null, commits.map((c) => h('li', null, commitLine(c), h('span', { class: 'muted' }, ' · ' + c.author))))) : null);
    let body;
    if (showDiff) {
      body = diff?.error ? h('div', { class: 'notice' }, diff.error)
        : diff?.binary ? h('div', { class: 'notice' }, 'Archivo binario o muy grande: cambió, pero no hay un diff de texto para mostrar.')
        : h('div', null, diffView({ path, sections: [] }, diff), diff?.truncated ? h('p', { class: 'muted small' }, 'El diff es muy largo: se muestra el principio.') : null);
    } else if (!info) body = h('p', { class: 'muted' }, 'Cargando…');
    else if (info.error) body = h('div', { class: 'notice' }, info.error);
    else body = ({
      text: () => htmlBox('doc-body file-code', info.html),
      markdown: () => htmlBox('doc-body doc-article', info.html, 'article'),
      image: () => h('div', { class: 'file-image' }, h('img', { src: BASE + 'api/files/raw?path=' + encodeURIComponent(path) + '&t=' + filesStamp, alt: path })),
      binary: () => h('div', { class: 'notice' }, 'Archivo binario (' + fmtSize(info.size) + '): no se muestra.'),
      big: () => h('div', { class: 'notice' }, 'Archivo de ' + fmtSize(info.size) + ': es muy grande para mostrarlo acá.'),
      link: () => h('div', { class: 'notice' }, 'Enlace simbólico a ', h('code', null, info.target), ': no se sigue.'),
      missing: () => h('div', { class: 'notice' }, state === 'deleted' ? 'Borrado del disco sin commitear: Ver los cambios muestra lo que tenía.' : 'No está en el disco.')
    })[info.kind]?.() ?? h('div', { class: 'notice' }, 'No se puede mostrar.');
    return h('div', { class: 'file-view' }, card, body);
  }

  function renderFiles() {
    const box = document.getElementById('files');
    if (S.view !== 'files') { box.replaceChildren(); return; }
    filesBar(box);
    const data = S.filesData;
    const body = box.querySelector('.files-body');
    const info = box.querySelector('.files-info');
    const chip = document.getElementById('files-changed');
    if (!data || data.error || !data.repo) {
      if (!data) loadFiles();
      chip.hidden = true;
      info.replaceChildren();
      body.replaceChildren(h('div', { class: 'notice' }, !data ? 'Leyendo los archivos…' : data.error ? data.error : 'Este proyecto no está en un repo de git: no hay archivos ni cambios que mostrar.'));
      return;
    }
    const changed = data.files.filter((p) => data.status[p]);
    chip.hidden = false;
    chip.replaceChildren('Solo con cambios', h('span', { class: 'n' }, changed.length));
    chip.setAttribute('aria-pressed', S.filesChanged ? 'true' : 'false');
    info.replaceChildren(h('span', { class: 'muted small' }, (data.branch ? data.branch : 'HEAD suelto') + ' · ' + data.files.length + ' archivos'));
    // Un archivo recién abierto: sus carpetas se abren y, si cambió (no si es nuevo), se ven primero sus cambios.
    if (S.file !== S.fileShown) {
      S.fileShown = S.file;
      const parts = S.file.split('/');
      for (let i = 1; i < parts.length; i++) S.filesOpen.add(parts.slice(0, i).join('/') + '/');
      S.fileDiff = ['modified', 'deleted', 'renamed'].includes(data.status[S.file]);
    }
    const scroll = body.querySelector('.files-side')?.scrollTop ?? 0;
    const side = h('div', { class: 'files-side' }, fileTree(data));
    body.replaceChildren(h('div', { class: 'files-grid' }, side, S.file ? fileView(data, S.file) : repoSummary(data, changed)));
    side.scrollTop = scroll;
  }

  // Vista Listas (8.4, spec §16.4). La regla de tildar (lo que se repite avanza) y el id de una lista nueva los
  // pone el hub: la web solo muestra y manda.
  const EVERY = { day: 'cada día', week: 'cada semana', month: 'cada mes', year: 'cada año' };
  function applyList(id, doc) {
    const i = S.lists.findIndex((x) => x.id === id);
    if (doc === null) { if (i >= 0) S.lists.splice(i, 1); }
    else if (i >= 0) S.lists[i] = doc;
    else S.lists.push(doc);
    S.lists.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
    if (S.editItem && !S.lists.some((l) => S.editItem.startsWith(l.id + ':'))) S.editItem = null;
    render();
  }
  // Escrituras de una misma lista, en fila y con el etag más reciente (como updateTask).
  const listQueues = new Map();
  function listWrite(id, fn, okMsg) {
    const run = () => write(async () => {
      const l = S.lists.find((x) => x.id === id);
      if (!l) return;
      try {
        const r = await fn(l);
        if (r?.list) applyList(r.list.id, r.list); else if (r?.id) applyList(r.id, r);
        if (r?.task) applyTask(r.task.id, r.task);
        if (typeof okMsg === 'function') { const m = okMsg(r); if (m) toast(m); } else if (okMsg) toast(okMsg);
      } catch (e) {
        if (e.code === 'conflict' && e.current) { applyList(e.current.id, { id: e.current.id, etag: e.current.etag, ...e.current.doc }); toast('La lista cambió en otro lado; se actualizó. Probá de nuevo.'); return; }
        throw e;
      }
    });
    const next = (listQueues.get(id) || Promise.resolve()).then(run);
    listQueues.set(id, next);
    next.finally(() => { if (listQueues.get(id) === next) listQueues.delete(id); });
    return next;
  }
  // Fechas como en hub/src/dates.js (dueState): sin hora, vence al terminar el día. Solo para mostrar y agrupar.
  function dueDate(due) { const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(due || ''); return m ? new Date(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) : null; }
  const dayKey = (d) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  function dueGroup(due, now = new Date()) {
    const d = dueDate(due);
    if (!d) return 'none';
    if (due.includes('T') ? d < now : dayKey(d) < dayKey(now)) return 'overdue';
    if (dayKey(d) === dayKey(now)) return 'today';
    const week = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
    return d < week ? 'week' : 'later';
  }
  const GROUPS = [['overdue', 'Vencidos'], ['today', 'Hoy'], ['week', 'Esta semana'], ['later', 'Más adelante'], ['none', 'Sin fecha'], ['done', 'Tildados']];
  function showDue(due) {
    const d = dueDate(due);
    if (!d) return due;
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) }) + (due.includes('T') ? ' ' + due.slice(11) : '');
  }
  const listLeft = (l) => l.items.filter((x) => !x.done).length;

  function renderLists() {
    const box = document.getElementById('lists');
    if (S.view !== 'lists') { box.replaceChildren(); return; }
    // Lo que se está escribiendo (campos con data-keep) sobrevive al re-armado, con el foco y el cursor.
    const sameList = box.dataset.list === S.list;
    const kept = sameList ? [...box.querySelectorAll('[data-keep]')].map((el) => [el.id, el.value]) : [];
    const focus = sameList && box.contains(document.activeElement) ? { id: document.activeElement.id, start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd } : null;
    buildLists(box);
    for (const [id, v] of kept) { const el = id && document.getElementById(id); if (el && box.contains(el)) el.value = v; }
    const f = focus?.id && document.getElementById(focus.id);
    if (f && box.contains(f)) { f.focus(); try { if (focus.start != null) f.setSelectionRange(focus.start, focus.end); } catch (e) { /* date/select */ } }
  }

  function buildLists(box) {
    const l = S.lists.find((x) => x.id === S.list) || S.lists[0];
    if (l) S.list = l.id;
    box.dataset.list = S.list;
    const side = h('nav', { class: 'list-side', 'aria-label': 'Listas' },
      S.lists.map((x) => h('a', { href: '#lists/' + encodeURIComponent(x.id), class: 'list-link', 'aria-current': x.id === S.list ? 'page' : null },
        h('span', { class: 't' }, x.title), h('span', { class: 'n' }, listLeft(x) || '✓'))),
      h('form', { class: 'list-new', onsubmit: (e) => {
        e.preventDefault();
        const input = e.target.querySelector('input');
        const title = input.value.trim();
        if (!title) return;
        input.value = '';
        write(async () => { const r = await api.listCreate(title); applyList(r.id, r); location.hash = '#lists/' + encodeURIComponent(r.id); }, 'Lista creada');
      } }, h('label', { for: 'list-new', class: 'sr' }, 'Nueva lista'), h('input', { type: 'text', id: 'list-new', placeholder: '+ Nueva lista', autocomplete: 'off', 'data-keep': '1' })));
    if (!l) { box.replaceChildren(h('div', { class: 'lists-grid' }, side, h('div', { class: 'notice' }, 'Este proyecto no tiene listas todavía. Creá una con «+ Nueva lista» (pendientes, compras, ideas…).'))); return; }
    box.replaceChildren(h('div', { class: 'lists-grid' }, side, listPanel(l)));
  }

  function listPanel(l) {
    const dated = l.items.some((x) => x.due);
    const done = l.items.filter((x) => x.done).length;
    const rows = l.items.map((x, i) => ({ x, n: i + 1 }));
    let body;
    if (dated) {
      body = GROUPS.map(([g, label]) => {
        const inG = rows.filter((r) => (r.x.done ? 'done' : dueGroup(r.x.due)) === g)
          .sort((a, b) => String(a.x.due ?? '~').localeCompare(String(b.x.due ?? '~')));
        return inG.length ? h('div', { class: 'list-group' }, h('div', { class: 'label' + (g === 'overdue' ? ' bad' : '') }, label), h('ul', { class: 'items' }, inG.map((r) => itemRow(l, r)))) : null;
      });
    } else {
      body = rows.length ? h('ul', { class: 'items' }, rows.map((r) => itemRow(l, r))) : h('p', { class: 'muted' }, 'Vacía.');
    }
    return h('section', { class: 'list-panel', 'aria-label': l.title },
      h('div', { class: 'list-head' },
        h('h2', null, l.title),
        h('span', { class: 'muted small' }, dated ? 'agrupada por fecha' : 'lista simple'),
        h('span', { class: 'spacer' }),
        done ? h('button', { class: 'btn ghost small', type: 'button', onclick: () => listWrite(l.id, (cur) => api.listPatch(cur.id, { items: cur.items.filter((x) => !x.done) }, cur.etag), done === 1 ? 'Quitado 1 tildado' : `Quitados ${done} tildados`) }, 'Quitar tildados') : null,
        h('button', { class: 'btn ghost small', type: 'button', onclick: () => {
          const title = prompt('Nuevo nombre de la lista', l.title);
          if (title && title.trim() && title.trim() !== l.title) listWrite(l.id, (cur) => api.listPatch(cur.id, { title: title.trim() }, cur.etag));
        } }, 'Renombrar'),
        h('button', { class: 'btn ghost small danger', type: 'button', onclick: () => {
          if (!confirm(`¿Borrar la lista "${l.title}" con sus ${l.items.length} ítems? Se puede recuperar con git.`)) return;
          write(async () => { await api.listDelete(l.id, l.etag); applyList(l.id, null); location.hash = '#lists'; }, 'Lista borrada');
        } }, 'Borrar')),
      addItemForm(l),
      body);
  }

  function addItemForm(l) {
    return h('form', { class: 'item-add', onsubmit: (e) => {
      e.preventDefault();
      const f = e.target;
      const text = f.elements.text.value.trim();
      if (!text) return;
      const date = f.elements.date.value, time = f.elements.time.value, every = f.elements.repeat.value;
      if (every && !date) { toast('Para repetirlo hace falta una fecha.'); return; }
      const item = { text, done: false, created_at: new Date().toISOString(), ...(date ? { due: date + (time ? 'T' + time : '') } : {}), ...(every ? { repeat: { every } } : {}) };
      f.reset();
      f.elements.text.focus();
      listWrite(l.id, (cur) => api.listPatch(cur.id, { items: [...cur.items, item] }, cur.etag));
    } },
    h('label', { for: 'item-text', class: 'sr' }, 'Agregar a ' + l.title),
    h('input', { type: 'text', id: 'item-text', name: 'text', placeholder: 'Agregar…', autocomplete: 'off', 'data-keep': '1' }),
    h('label', { for: 'item-date', class: 'sr' }, 'Fecha límite'), h('input', { type: 'date', id: 'item-date', name: 'date', 'data-keep': '1' }),
    h('label', { for: 'item-time', class: 'sr' }, 'Hora'), h('input', { type: 'time', id: 'item-time', name: 'time', 'data-keep': '1' }),
    h('label', { for: 'item-repeat', class: 'sr' }, 'Repetir'),
    h('select', { id: 'item-repeat', name: 'repeat', 'data-keep': '1' }, h('option', { value: '' }, 'No se repite'), Object.entries(EVERY).map(([k, v]) => h('option', { value: k }, v))),
    h('button', { class: 'btn primary', type: 'submit' }, 'Agregar'));
  }

  function itemRow(l, { x, n }) {
    const key = l.id + ':' + n;
    const id = 'it-' + l.id + '-' + n;
    if (S.editItem === key) return itemEdit(l, x, n);
    const g = x.done ? null : dueGroup(x.due);
    const task = x.task ? S.tasks.find((t) => t.id === x.task) : null;
    return h('li', { class: 'item' + (x.done ? ' done' : ''), draggable: 'true', 'data-n': n,
      ondragstart: (e) => { e.dataTransfer.setData('text/x-item', key); e.dataTransfer.effectAllowed = 'move'; },
      ondragover: (e) => { if ([...e.dataTransfer.types].includes('text/x-item')) { e.preventDefault(); e.currentTarget.classList.add('drop-before'); } },
      ondragleave: (e) => e.currentTarget.classList.remove('drop-before'),
      ondrop: (e) => { e.preventDefault(); e.currentTarget.classList.remove('drop-before'); const [lid, from] = e.dataTransfer.getData('text/x-item').split(':'); if (lid === l.id) moveItem(l.id, Number(from), n); } },
      h('input', { type: 'checkbox', id, checked: x.done, onchange: (e) => {
        // Un ítem que se repite no se destilda (al tildarlo avanza la fecha): la casilla vuelve a como estaba (19.12).
        if (x.repeat && !e.target.checked) { e.target.checked = true; return; }
        listWrite(l.id, (cur) => (e.target.checked ? api.listCheck(cur.id, n, cur.etag) : api.listPatch(cur.id, { items: cur.items.map((y, i) => (i === n - 1 ? { ...y, done: false } : y)) }, cur.etag)),
          (r) => (r?.advanced ? `↻ ${x.text}: la próxima vez es el ${showDue(r.list.items[n - 1].due)}` : null));
      } }),
      h('label', { for: id, class: 'text' }, rich(x.text)),
      x.due ? h('span', { class: 'due' + (g === 'overdue' ? ' bad' : g === 'today' ? ' today' : '') }, showDue(x.due)) : null,
      x.repeat ? h('span', { class: 'rep', title: 'Al tildarlo, la fecha avanza ' + EVERY[x.repeat.every] }, '↻ ' + EVERY[x.repeat.every]) : null,
      task ? h('a', { href: '#', class: 'item-task', onclick: (e) => { e.preventDefault(); goToTask(task.id); } }, '→ ', task.code || task.id) : x.task ? h('span', { class: 'muted small' }, '→ ' + x.task) : null,
      h('span', { class: 'acts' },
        !x.task && S.milestones.length ? h('button', { class: 'btn ghost small', type: 'button', title: 'Crea una tarea con este texto y deja el ítem enlazado', onclick: () => toTask(l, n) }, 'Pasar a tarea') : null,
        h('button', { class: 'btn ghost small', type: 'button', 'aria-label': 'Editar ' + x.text, onclick: () => { S.editItem = key; render(); document.getElementById('ie-text')?.focus(); } }, '✎'),
        h('button', { class: 'btn ghost small', type: 'button', 'aria-label': 'Quitar ' + x.text, onclick: () => listWrite(l.id, (cur) => api.listPatch(cur.id, { items: cur.items.filter((_, i) => i !== n - 1) }, cur.etag)) }, '×')));
  }

  function itemEdit(l, x, n) {
    const [date, time] = x.due ? [x.due.slice(0, 10), x.due.slice(11)] : ['', ''];
    const close = () => { S.editItem = null; render(); };
    return h('li', { class: 'item editing' }, h('form', { class: 'item-add', onsubmit: (e) => {
      e.preventDefault();
      const f = e.target;
      const text = f.elements.text.value.trim();
      const d = f.elements.date.value, t = f.elements.time.value, every = f.elements.repeat.value;
      if (!text) return;
      if (every && !d) { toast('Para repetirlo hace falta una fecha.'); return; }
      S.editItem = null;
      listWrite(l.id, (cur) => api.listPatch(cur.id, { items: cur.items.map((y, i) => {
        if (i !== n - 1) return y;
        const { due, repeat, ...rest } = y;
        return { ...rest, text, ...(d ? { due: d + (t ? 'T' + t : '') } : {}), ...(every ? { repeat: { every } } : {}) };
      }) }, cur.etag));
    }, onkeydown: (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } } },
    h('label', { for: 'ie-text', class: 'sr' }, 'Texto'), h('input', { type: 'text', id: 'ie-text', name: 'text', value: x.text, 'data-keep': '1' }),
    h('label', { for: 'ie-date', class: 'sr' }, 'Fecha límite'), h('input', { type: 'date', id: 'ie-date', name: 'date', value: date, 'data-keep': '1' }),
    h('label', { for: 'ie-time', class: 'sr' }, 'Hora'), h('input', { type: 'time', id: 'ie-time', name: 'time', value: time, 'data-keep': '1' }),
    h('label', { for: 'ie-repeat', class: 'sr' }, 'Repetir'),
    h('select', { id: 'ie-repeat', name: 'repeat', 'data-keep': '1' }, h('option', { value: '' }, 'No se repite'), Object.entries(EVERY).map(([k, v]) => h('option', { value: k, selected: x.repeat?.every === k }, v))),
    h('button', { class: 'btn primary', type: 'submit' }, 'Guardar'), h('button', { class: 'btn ghost', type: 'button', onclick: close }, 'Cancelar')));
  }

  // Soltar el ítem from antes del ítem to (números desde 1, como en la CLI).
  function moveItem(id, from, to) {
    if (from === to) return;
    listWrite(id, (cur) => {
      const items = [...cur.items];
      const [it] = items.splice(from - 1, 1);
      items.splice(to - 1 - (from < to ? 1 : 0), 0, it);
      return api.listPatch(cur.id, { items }, cur.etag);
    });
  }

  async function toTask(l, n) {
    const ms = S.milestones;
    const pick = ms.length === 1 ? ms[0].id : await pickMilestone(l.items[n - 1]?.text || '');
    const m = msById(pick);
    if (!m) return;
    listWrite(l.id, (cur) => api.listTask(cur.id, n, m.id, cur.etag), (r) => `Tarea creada en ${m.code}: ${r.task.title}`);
  }

  // Elegir un hito (19.12): un diálogo con los hitos sin terminar primero, en vez de tipear un código en un prompt().
  // Resuelve con el id elegido, o null si se cancela.
  function pickMilestone(text) {
    return new Promise((resolve) => {
      const isDone = (m) => { const ts = S.tasks.filter((t) => t.milestone === m.id); return ts.length > 0 && ts.every((t) => t.status === 'done'); };
      const opt = (m) => h('option', { value: m.id }, m.code + ' · ' + m.title);
      const finished = S.milestones.filter(isDone);
      const sel = h('select', { id: 'pick-ms' }, S.milestones.filter((m) => !isDone(m)).map(opt),
        finished.length ? h('optgroup', { label: 'Terminados' }, finished.map(opt)) : null);
      sel.value = defaultMilestone();
      const end = (v) => { d.close(); d.remove(); resolve(v); };
      const d = h('dialog', { class: 'pick', 'aria-label': 'Pasar a tarea', onclose: () => { if (d.isConnected) end(null); } },
        h('form', { method: 'dialog', onsubmit: (e) => { e.preventDefault(); end(sel.value); } },
          h('p', null, 'Pasar a tarea ', h('strong', null, '«' + text + '»')),
          h('label', { for: 'pick-ms' }, 'Hito'), sel,
          h('div', { class: 'row' },
            h('button', { class: 'btn primary', type: 'submit' }, 'Crear tarea'),
            h('button', { class: 'btn', type: 'button', onclick: () => end(null) }, 'Cancelar'))));
      document.body.append(d);
      d.showModal();
      sel.focus();
    });
  }

  // Vista Playtest (D39): sesiones con tareas ya creadas en el orden en que se prueban. Cada una se marca anda o falla,
  // con una nota, y desde ahí se pasa la tarea a Hecho o se vuelve a En curso. La sesión se escribe entera (PATCH
  // items) con su etag, en fila como las listas.
  const RESULTS = [['pass', '✓ Anda'], ['fail', '✗ Falla']];
  function applyPlaytest(id, doc) {
    const i = S.playtests.findIndex((x) => x.id === id);
    if (doc === null) { if (i >= 0) S.playtests.splice(i, 1); }
    else if (i >= 0) S.playtests[i] = doc;
    else S.playtests.push(doc);
    S.playtests.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
    render();
  }
  const ptQueues = new Map();
  function ptWrite(id, fn, okMsg) {
    const run = () => write(async () => {
      const p = S.playtests.find((x) => x.id === id);
      if (!p) return;
      try {
        const r = await fn(p);
        if (r?.id) applyPlaytest(r.id, r);
        if (okMsg) toast(okMsg);
      } catch (e) {
        if (e.code === 'conflict' && e.current) { applyPlaytest(e.current.id, { id: e.current.id, etag: e.current.etag, ...e.current.doc }); toast('La sesión cambió en otro lado; se actualizó. Probá de nuevo.'); return; }
        throw e;
      }
    });
    const next = (ptQueues.get(id) || Promise.resolve()).then(run);
    ptQueues.set(id, next);
    next.finally(() => { if (ptQueues.get(id) === next) ptQueues.delete(id); });
    return next;
  }
  // Cambia los ítems de la sesión sobre su versión más reciente: fn(items) devuelve los nuevos (o null si no hay cambio).
  const ptItems = (id, fn, okMsg) => ptWrite(id, (cur) => { const items = fn(cur.items); return items ? api.playtestPatch(cur.id, { items }, cur.etag) : null; }, okMsg);
  const ptLeft = (p) => p.items.filter((x) => !x.result).length;
  // Vista dividida (escritorio): la sesión a la izquierda y la tarea a la derecha, con el panel siempre a la vista.
  const SPLIT = matchMedia('(min-width: 900px)');
  SPLIT.addEventListener('change', () => render());
  const ptSplit = () => S.view === 'playtest' && SPLIT.matches;
  // Resultado y nota de una tarea de la sesión, sobre la versión más reciente (los usan la fila y el detalle).
  const ptSetItem = (pid, task, fn) => ptItems(pid, (items) => { const i = items.findIndex((y) => y.task === task); return i < 0 ? null : items.with(i, fn(items[i])); });
  // Otro clic en el mismo resultado lo quita.
  const ptSetResult = (pid, task, r) => ptSetItem(pid, task, ({ result, ...rest }) => (result === r ? rest : { ...rest, result: r }));
  // La nota admite varios renglones: Enter hace un salto de línea; se guarda al salir del campo, o con Ctrl/⌘+Enter.
  const ptSetNote = (pid, task, v) => ptSetItem(pid, task, ({ note, ...rest }) => (v.trim() ? { ...rest, note: v.trim() } : rest));
  const ptNoteKeys = (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.target.blur(); } };
  const ptResultButtons = (pid, x) => h('span', { class: 'pt-result', role: 'group', 'aria-label': 'Resultado' }, RESULTS.map(([r, label]) =>
    h('button', { class: 'btn small ' + r, type: 'button', 'aria-pressed': x.result === r ? 'true' : 'false', onclick: () => ptSetResult(pid, x.task, r) }, label)));
  // Lo que conviene hacer con la tarea según cómo salió: anda → Hecho; falla → de vuelta a En curso. Se ofrece, no se hace solo.
  const ptFollow = (t, x) => (!t ? null : x.result === 'pass' && t.status !== 'done' ? ['done', 'Pasar a Hecho'] : x.result === 'fail' && (t.status === 'review' || t.status === 'done') ? ['doing', 'Volver a En curso'] : null);
  // En el detalle de una tarea abierta desde Playtest: su resultado y su nota en la sesión, sin volver a la lista.
  function ptDetail(t) {
    if (S.view !== 'playtest') return null;
    const p = S.playtests.find((x) => x.id === S.playtest);
    const n = p ? p.items.findIndex((x) => x.task === t.id) : -1;
    if (n < 0) return null;
    const x = p.items[n];
    const follow = ptFollow(t, x);
    // Recorrer la sesión en orden sin volver a la lista.
    const step = (d) => { const y = p.items[n + d]; return y && S.tasks.some((z) => z.id === y.task) ? y.task : null; };
    const [prev, next] = [step(-1), step(1)];
    return h('section', { class: 'pt-detail', 'aria-label': 'Playtest' },
      h('div', { class: 'pt-detail-head' }, h('span', { class: 'label' }, 'Playtest · ' + p.title),
        h('span', { class: 'pt-nav' },
          h('button', { class: 'btn ghost small', type: 'button', 'aria-label': 'Anterior de la sesión', disabled: !prev, onclick: () => goToTask(prev) }, '←'),
          h('span', { class: 'muted small' }, (n + 1) + ' de ' + p.items.length),
          h('button', { class: 'btn ghost small', type: 'button', disabled: !next, onclick: () => goToTask(next) }, 'Siguiente →'))),
      h('div', { class: 'pt-detail-row' }, ptResultButtons(p.id, x),
        follow ? h('button', { class: 'btn ghost small', type: 'button', onclick: () => updateTask(t.id, { status: follow[0] }) }, follow[1]) : null),
      h('label', { for: 'd-ptnote', class: 'sr' }, 'Nota de la prueba'),
      h('textarea', { id: 'd-ptnote', class: 'pt-note', placeholder: 'Qué se vio al probarla…', 'data-orig': x.note ?? '', rows: 3,
        onchange: (e) => ptSetNote(p.id, t.id, e.target.value), onkeydown: ptNoteKeys }, x.note ?? ''));
  }
  const inReview = () => S.tasks.filter((t) => t.status === 'review').sort(sortTasks);

  // El panel derecho de la vista dividida sin una tarea abierta: qué hacer, y abrir la primera sin probar.
  function renderPtEmpty() {
    const el = document.getElementById('pt-empty');
    const p = S.playtests.find((x) => x.id === S.playtest);
    el.hidden = !ptSplit() || !!S.openId || !p;
    if (el.hidden) { el.replaceChildren(); return; }
    const first = p.items.find((x) => !x.result && S.tasks.some((t) => t.id === x.task));
    el.replaceChildren(h('div', { class: 'pt-empty-body' },
      h('p', null, p.items.length ? 'Elegí una tarea de la sesión para verla acá.' : 'Agregá tareas a la sesión y elegí una para verla acá.'),
      first ? h('button', { class: 'btn primary', type: 'button', onclick: () => goToTask(first.task) }, 'Abrir la primera sin probar') : null));
  }

  function renderPlaytest() {
    renderPtEmpty();
    const box = document.getElementById('playtest');
    if (S.view !== 'playtest') { box.replaceChildren(); return; }
    // Como en Listas: lo que se está escribiendo sobrevive al re-armado, con el foco y el cursor. Una nota (data-orig)
    // solo si tiene cambios sin guardar: si no, vale la de la sesión (puede haber cambiado en el detalle u otra pestaña).
    const same = box.dataset.playtest === S.playtest;
    const kept = same ? [...box.querySelectorAll('[data-keep], [data-orig]')].filter((el) => !('orig' in el.dataset) || el.value !== el.dataset.orig).map((el) => [el.id, el.value]) : [];
    const focus = same && box.contains(document.activeElement) ? { id: document.activeElement.id, start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd } : null;
    buildPlaytest(box);
    for (const [id, v] of kept) { const el = id && document.getElementById(id); if (el && box.contains(el)) el.value = v; }
    const f = focus?.id && document.getElementById(focus.id);
    if (f && box.contains(f)) { f.focus(); try { if (focus.start != null) f.setSelectionRange(focus.start, focus.end); } catch (e) { /* select */ } }
  }

  function buildPlaytest(box) {
    const p = S.playtests.find((x) => x.id === S.playtest) || S.playtests[0];
    if (p) S.playtest = p.id;
    box.dataset.playtest = S.playtest;
    const side = h('nav', { class: 'list-side', 'aria-label': 'Sesiones de playtest' },
      S.playtests.map((x) => h('a', { href: '#playtest/' + encodeURIComponent(x.id), class: 'list-link', 'aria-current': x.id === S.playtest ? 'page' : null },
        h('span', { class: 't' }, x.title), h('span', { class: 'n', title: 'Sin probar' }, ptLeft(x) || '✓'))),
      h('form', { class: 'list-new', onsubmit: (e) => {
        e.preventDefault();
        const input = e.target.querySelector('input');
        const title = input.value.trim();
        if (!title) return;
        input.value = '';
        write(async () => { const r = await api.playtestCreate(title); applyPlaytest(r.id, r); location.hash = '#playtest/' + encodeURIComponent(r.id); }, 'Sesión creada');
      } }, h('label', { for: 'pt-new', class: 'sr' }, 'Nueva sesión'), h('input', { type: 'text', id: 'pt-new', placeholder: '+ Nueva sesión', autocomplete: 'off', 'data-keep': '1' })));
    if (!p) {
      const n = inReview().length;
      box.replaceChildren(h('div', { class: 'lists-grid' }, side, h('div', { class: 'notice' },
        'Todavía no hay sesiones de playtest. Creá una con «+ Nueva sesión» y cargale las tareas en el orden en que las vas a probar.',
        n ? h('p', null, h('button', { class: 'btn primary', type: 'button', onclick: () => write(async () => {
          const r = await api.playtestCreate('Revisión', inReview().map((t) => t.id)); applyPlaytest(r.id, r); location.hash = '#playtest/' + encodeURIComponent(r.id);
        }, 'Sesión creada') }, `Crear una con las ${n} en Revisión`)) : null)));
      return;
    }
    box.replaceChildren(h('div', { class: 'lists-grid' }, side, playtestPanel(p)));
  }

  function playtestPanel(p) {
    const tested = p.items.length - ptLeft(p);
    const fails = p.items.filter((x) => x.result === 'fail').length;
    const have = new Set(p.items.map((x) => x.task));
    const review = inReview().filter((t) => !have.has(t.id));
    return h('section', { class: 'list-panel pt-panel', 'aria-label': p.title },
      h('div', { class: 'list-head' },
        h('h2', null, p.title),
        h('span', { class: 'muted small' }, p.items.length ? `${tested} de ${p.items.length} probadas` + (fails ? ` · ${fails} ${fails === 1 ? 'falla' : 'fallan'}` : '') : 'vacía'),
        h('span', { class: 'spacer' }),
        tested ? h('button', { class: 'btn ghost small', type: 'button', title: 'Vuelve todas a «sin probar», para otra pasada', onclick: () => {
          if (confirm(`¿Volver las ${tested} probadas a «sin probar»? Las notas quedan.`)) ptItems(p.id, (items) => items.map(({ result, ...x }) => x), 'Sesión reiniciada');
        } }, 'Reiniciar') : null,
        h('button', { class: 'btn ghost small', type: 'button', onclick: () => {
          const title = prompt('Nuevo nombre de la sesión', p.title);
          if (title && title.trim() && title.trim() !== p.title) ptWrite(p.id, (cur) => api.playtestPatch(cur.id, { title: title.trim() }, cur.etag));
        } }, 'Renombrar'),
        h('button', { class: 'btn ghost small danger', type: 'button', onclick: () => {
          if (!confirm(`¿Borrar la sesión "${p.title}"? Las tareas no se tocan. Se puede recuperar con git.`)) return;
          write(async () => { await api.playtestDelete(p.id, p.etag); applyPlaytest(p.id, null); location.hash = '#playtest'; }, 'Sesión borrada');
        } }, 'Borrar')),
      ptSearch(p, have, review),
      p.items.length ? h('ol', { class: 'items pt-items' }, p.items.map((x, i) => ptRow(p, x, i + 1)))
        : h('p', { class: 'muted' }, 'Sin tareas. Buscalas arriba, o cargá las que están en Revisión.'));
  }

  // Agregar tareas: buscar por título, código o id (las de Revisión primero), o todas las de Revisión de una vez.
  function ptSearch(p, have, review) {
    const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const words = norm(S.ptQ).split(/\s+/).filter(Boolean);
    const rank = (t) => ['review', 'doing', 'paused', 'todo', 'done'].indexOf(t.status);
    const matches = words.length ? S.tasks.filter((t) => !have.has(t.id) && words.every((w) => norm(t.code + ' ' + t.title + ' ' + t.id).includes(w)))
      .sort((a, b) => rank(a) - rank(b) || sortTasks(a, b)).slice(0, 8) : [];
    const add = (ids, msg) => { S.ptQ = ''; ptItems(p.id, (items) => { const in_ = new Set(items.map((x) => x.task)); const fresh = ids.filter((id) => !in_.has(id)); return fresh.length ? [...items, ...fresh.map((task) => ({ task }))] : null; }, msg); };
    return h('div', { class: 'ref-search pt-add', onkeydown: searchKeys },
      h('div', { class: 'item-add' },
        h('label', { for: 'pt-q', class: 'sr' }, 'Agregar tarea a ' + p.title),
        h('input', { type: 'text', id: 'pt-q', placeholder: 'Agregar tarea: buscar por título o código', autocomplete: 'off', value: S.ptQ, 'data-orig': S.ptQ,
          oninput: (e) => { S.ptQ = e.target.value; renderPlaytest(); } }),
        review.length ? h('button', { class: 'btn', type: 'button', title: 'Agrega al final las tareas en Revisión que todavía no están, en el orden del tablero',
          onclick: () => add(review.map((t) => t.id), review.length === 1 ? 'Agregada 1 tarea' : `Agregadas ${review.length} tareas`) }, `+ Las de Revisión (${review.length})`) : null),
      matches.length ? h('ul', { class: 'ref-matches' }, matches.map((t) => {
        const s = STATUSES.find((x) => x.id === t.status) || STATUSES[0];
        return h('li', null, h('button', { type: 'button', onclick: () => add([t.id]) },
          h('span', { class: 'dot', style: 'background:' + s.color, title: s.label }), t.code ? h('span', { class: 'code' }, t.code) : null, rich(t.title, true),
          h('span', { class: 'ref-id' }, s.label + ' · ' + t.id)));
      })) : null,
      words.length && !matches.length ? h('p', { class: 'muted small' }, 'Ninguna tarea coincide (o ya están en la sesión).') : null);
  }

  function ptRow(p, x, n) {
    const t = S.tasks.find((y) => y.id === x.task);
    const s = t && (STATUSES.find((y) => y.id === t.status) || STATUSES[0]);
    const last = p.items.length;
    const move = (to) => ptItems(p.id, (items) => {
      const from = items.findIndex((y) => y.task === x.task);
      if (from < 0 || to < 0 || to >= items.length || from === to) return null;
      const next = [...items]; const [it] = next.splice(from, 1); next.splice(to, 0, it); return next;
    });
    const follow = ptFollow(t, x);
    const noteId = 'pt-note-' + x.task;
    return h('li', { class: 'item pt-item' + (x.result ? ' ' + x.result : ''), draggable: 'true', 'data-task': x.task, 'aria-current': S.openId === x.task ? 'true' : null,
      ondragstart: (e) => { e.dataTransfer.setData('text/x-pt', x.task); e.dataTransfer.effectAllowed = 'move'; },
      ondragover: (e) => { if ([...e.dataTransfer.types].includes('text/x-pt')) { e.preventDefault(); e.currentTarget.classList.add('drop-before'); } },
      ondragleave: (e) => e.currentTarget.classList.remove('drop-before'),
      ondrop: (e) => {
        e.preventDefault(); e.currentTarget.classList.remove('drop-before');
        const id = e.dataTransfer.getData('text/x-pt');
        if (!id || id === x.task) return;
        // Soltar antes de esta fila.
        ptItems(p.id, (items) => {
          const from = items.findIndex((y) => y.task === id);
          if (from < 0) return null;
          const next = [...items]; const [it] = next.splice(from, 1);
          next.splice(next.findIndex((y) => y.task === x.task), 0, it); return next;
        });
      } },
      h('span', { class: 'pt-n', 'aria-hidden': 'true' }, n),
      t ? h('a', { href: '#task/' + encodeURIComponent(t.id), class: 'text pt-task', onclick: (e) => { e.preventDefault(); goToTask(t.id); } },
        h('span', { class: 'dot', style: 'background:' + s.color }), t.code ? h('span', { class: 'code' }, t.code) : null, h('span', { class: 'pt-title' }, rich(t.title, true)))
        : h('span', { class: 'text pt-task muted' }, x.task + ' (la tarea ya no existe)'),
      // Lo que se hace con la fila, en un bloque: a la derecha del título, o debajo si la sesión es angosta.
      h('span', { class: 'pt-side' },
        t ? h('span', { class: 'pt-status', style: 'color:' + s.color }, s.label) : null,
        ptResultButtons(p.id, x),
        follow ? h('button', { class: 'btn ghost small', type: 'button', onclick: () => updateTask(t.id, { status: follow[0] }) }, follow[1]) : null,
        h('span', { class: 'acts' },
          h('button', { class: 'btn ghost small', type: 'button', 'aria-label': 'Subir', disabled: n === 1, onclick: () => move(n - 2) }, '↑'),
          h('button', { class: 'btn ghost small', type: 'button', 'aria-label': 'Bajar', disabled: n === last, onclick: () => move(n) }, '↓'),
          h('button', { class: 'btn ghost small', type: 'button', 'aria-label': 'Sacar de la sesión', onclick: () => ptItems(p.id, (items) => items.filter((y) => y.task !== x.task)) }, '×'))),
      h('label', { for: noteId, class: 'sr' }, 'Nota de la prueba'),
      h('textarea', { id: noteId, class: 'pt-note', placeholder: 'Qué se vio al probarla…', 'data-orig': x.note ?? '', rows: 1,
        onchange: (e) => ptSetNote(p.id, x.task, e.target.value), onkeydown: ptNoteKeys }, x.note ?? ''));
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('Copiado: ' + text); } catch (e) { toast(text); }
  }

  // "3 cambios sin commitear": la app nunca commitea en local (spec §4.5), solo lo recuerda.
  function renderGit() {
    const el = document.getElementById('git');
    const n = S.git?.repo ? S.git.uncommitted : 0;
    el.hidden = !n;
    // "del tablero" (19.13): cuenta compass/ y el export; Archivos cuenta todo el repo, y el número puede ser otro.
    el.textContent = n === 1 ? '1 cambio del tablero sin commitear' : n + ' cambios del tablero sin commitear';
    el.title = n ? 'Sin commitear en git:\n' + S.git.files.join('\n') : '';
  }

  function render() {
    renderGit();
    renderMiles(); renderFilters(); renderSummary(); renderWarnings(); renderBoard(); renderTaskList(); renderDetail(); renderDocs(); renderFiles(); renderLists(); renderPlaytest(); renderConn();
    // La vista se aplica al final: renderSummary muestra su caja por su cuenta.
    const boardView = S.view === 'board';
    for (const id of ['miles', 'filters', 'summary', 'new-btn']) document.getElementById(id).hidden = !boardView;
    document.getElementById('board').hidden = !boardView || S.mode !== 'board';
    document.getElementById('tasklist').hidden = !boardView || S.mode !== 'list';
    if (!boardView) document.getElementById('new-form').hidden = true;
    document.getElementById('docs').hidden = S.view !== 'docs';
    document.getElementById('files').hidden = S.view !== 'files';
    document.getElementById('lists').hidden = S.view !== 'lists';
    document.getElementById('playtest').hidden = S.view !== 'playtest';
    // Pestañas en el orden de config.views; las que no están se esconden (la del tablero, si es la actual, no).
    const nav = document.querySelector('nav.views');
    for (const v of ['board', 'lists', 'playtest', 'docs', 'files']) {
      const tab = document.getElementById('tab-' + v);
      tab.setAttribute('aria-current', S.view === v ? 'page' : 'false');
      tab.hidden = !S.views.includes(v) && S.view !== v;
      tab.style.order = String(S.views.includes(v) ? S.views.indexOf(v) : 9);
    }
    nav.hidden = [...nav.children].filter((a) => !a.hidden).length < 2;
  }

  function setFilter(id) { S.filter = id; pref('filter', id); render(); }
  // Cada tarea abierta tiene su ruta, #task/<id> (16.7): atrás la cierra y vuelve a la vista desde la que se abrió.
  // Cambiar de tarea con una abierta reemplaza la entrada: atrás no las recorre. La entrada guarda desde dónde se abrió
  // (taskFrom): el detalle se abre encima de esa vista (Listas, Playtest, Documentos, Archivos), sin pasar al tablero.
  function openTask(id) {
    const hash = '#task/' + encodeURIComponent(id);
    if (TASK_HASH.test(location.hash)) history.replaceState(history.state, '', hash);
    else history.pushState({ taskFrom: location.hash }, '', hash);
    S.openId = id; S.confirmDelete = false; S.linkSearch = null; S.fileSearch = null; render(); document.getElementById('detail').focus({ preventScroll: true });
  }
  // Cerrar vuelve a la vista desde la que se abrió, volviendo atrás (no deja dos entradas iguales); un enlace directo
  // cambia la ruta por la del tablero.
  function closeTask() {
    S.openId = null; S.confirmDelete = false;
    if (TASK_HASH.test(location.hash)) {
      if (history.state?.taskFrom !== undefined) history.back(); else history.replaceState(null, '', location.pathname + location.search);
    }
    render();
  }
  // La tarea abierta ya no existe (borrada en otro lado, o un enlace viejo): se cierra y su ruta se va.
  function dropMissingTask() {
    if (!S.openId || S.tasks.some((t) => t.id === S.openId)) return;
    S.openId = null;
    if (TASK_HASH.test(location.hash)) history.replaceState(null, '', history.state?.taskFrom || location.pathname + location.search);
  }
  // Un clic afuera del detalle lo cierra, salvo que ese clic abra otra tarea (una tarjeta, una fila, un enlace). Cuenta
  // dónde empezó: arrastrar una selección desde las notas hasta afuera no lo cierra, y un botón del detalle que se
  // redibuja (y queda fuera del documento) tampoco.
  let openAtDown = null;
  // En la vista dividida de Playtest el detalle es un panel fijo: un clic en la sesión no lo cierra.
  document.addEventListener('pointerdown', (e) => { openAtDown = S.openId && !ptSplit() && !e.target.closest('#detail, dialog.lightbox') ? S.openId : null; });
  // Pegar o soltar una imagen con la tarea abierta la agrega como captura (18.4).
  document.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files ?? [])];
    if (!S.openId || !files.some((f) => f.type.startsWith('image/'))) return;
    e.preventDefault();
    addImages(S.openId, files);
  });
  document.getElementById('detail').addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types ?? [])].includes('Files')) { e.preventDefault(); e.currentTarget.classList.add('dropping'); } });
  document.getElementById('detail').addEventListener('dragleave', (e) => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.classList.remove('dropping'); });
  document.getElementById('detail').addEventListener('drop', (e) => {
    e.currentTarget.classList.remove('dropping');
    const files = [...(e.dataTransfer?.files ?? [])];
    if (!S.openId || !files.length) return;
    e.preventDefault();
    addImages(S.openId, files);
  });
  document.addEventListener('click', () => { if (openAtDown && openAtDown === S.openId) closeTask(); openAtDown = null; });
  // Soltar una tarjeta sobre otra: toma el estado de esa columna y, si son del mismo hito, queda justo antes.
  function dropBefore(id, target) {
    const t = S.tasks.find((x) => x.id === id);
    if (!t) return;
    const patch = {};
    if (t.status !== target.status) patch.status = target.status;
    if (t.milestone === target.milestone) {
      const same = S.tasks.filter((x) => x.milestone === target.milestone && x.id !== id).sort(sortTasks);
      const i = same.findIndex((x) => x.id === target.id);
      const prev = i > 0 ? same[i - 1].order ?? 0 : (target.order ?? 0) - 2;
      patch.order = (prev + (target.order ?? 0)) / 2;
    }
    if (Object.keys(patch).length) updateTask(id, patch);
  }

  function setStatus(id, status) {
    const t = S.tasks.find((x) => x.id === id);
    if (!t || t.status === status) return;
    updateTask(id, { status });
  }

  function openNewForm() {
    const f = document.getElementById('new-form');
    f.hidden = false;
    const sel = document.getElementById('new-ms');
    delete sel.dataset.touched;
    sel.value = defaultMilestone();
    document.getElementById('new-title').focus();
  }
  document.getElementById('new-btn').addEventListener('click', () => {
    const f = document.getElementById('new-form');
    if (f.hidden) openNewForm(); else f.hidden = true;
  });
  document.getElementById('new-cancel').addEventListener('click', () => { document.getElementById('new-form').hidden = true; });
  document.getElementById('new-ms').addEventListener('change', (e) => { e.target.dataset.touched = '1'; });
  document.getElementById('new-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const title = document.getElementById('new-title').value.trim();
    const milestone = document.getElementById('new-ms').value;
    if (!title) return;
    if (!milestone) { toast('Primero hace falta al menos un hito.'); return; }
    document.getElementById('new-title').value = '';
    document.getElementById('new-form').hidden = true;
    // El hub pone el order (al final del hito), created_at y updated_at.
    write(async () => {
      const t = await api.create({ title, milestone, code: '', status: 'todo', checklist: [], test: '', notes: '', refs: [] });
      applyTask(t.id, t);
      // Se abre, para sumarle la descripción o los pasos sin buscarla en el tablero (19.12).
      openTask(t.id);
      toast(taskMatches(t) ? 'Tarea agregada' : 'Tarea agregada; los filtros la ocultan');
    });
  });
  // Atajos (3.7): N nueva tarea, 1–5 estado de la tarea abierta, Esc cierra. Nunca mientras se escribe.
  const typing = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    if (e.key === 'Escape') {
      const f = document.getElementById('new-form');
      if (!f.hidden && f.contains(document.activeElement)) { f.hidden = true; return; }
      if (S.openId) closeTask();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || typing(document.activeElement)) return;
    if ((e.key === 'n' || e.key === 'N') && S.view === 'board') { e.preventDefault(); openNewForm(); return; }
    if (e.key === '/' && S.view === 'board') { e.preventDefault(); document.getElementById('f-q').focus(); return; }
    const n = Number(e.key);
    if (S.openId && n >= 1 && n <= STATUSES.length) { e.preventDefault(); setStatus(S.openId, STATUSES[n - 1].id); }
  });

  // Carga completa desde el hub. Si llegan eventos mientras carga, se repite: un evento viejo nunca pisa datos nuevos.
  let loading = false, eventsDuringLoad = false;
  async function load() {
    if (loading) { eventsDuringLoad = true; return; }
    loading = true;
    do {
      eventsDuringLoad = false;
      try {
        const [config, m, t, d, l, p] = await Promise.all([api.config(), api.milestones(), api.tasks(), api.docs().catch(() => ({ docs: [] })),
          // Un hub de antes de las listas (o del playtest) no tiene /api/lists (/api/playtests).
          api.lists().catch(() => ({ lists: [], warnings: [] })), api.playtests().catch(() => ({ playtests: [], warnings: [] }))]);
        S.git = await api.git().catch(() => null);
        S.lists = l.lists;
        S.playtests = p.playtests;
        S.views = Array.isArray(config.views) && config.views.length ? config.views : ['board', 'lists', 'playtest', 'docs', 'files'];
        S.docs = d.docs;
        S.docEntries = config.docs ?? [];
        S.descTemplates = config.description_templates ?? {};
        sectionCache.clear();
        docCache.clear();
        S.project = config.project || '';
        S.milestones = m.milestones;
        S.tasks = t.tasks;
        S.warnings = [];
        for (const w of [...m.warnings, ...t.warnings, ...l.warnings, ...p.warnings]) setWarning(w);
        S.offline = false;
      } catch (e) {
        S.offline = true;
        break;
      }
    } while (eventsDuringLoad);
    loading = false;
    document.getElementById('project').textContent = S.project || 'Scope Compass';
    document.title = S.project && S.project !== 'Scope Compass' ? S.project + ' · Scope Compass' : 'Scope Compass';
    if (S.filter !== 'all' && !S.milestones.some((x) => x.id === S.filter)) S.filter = 'all';
    dropMissingTask();
    // config.views (§16.6): sin hash, se abre la primera; una pestaña que el proyecto no tiene no se muestra.
    if (!S.viewsApplied && !S.offline) {
      S.viewsApplied = true;
      if (!location.hash && S.views[0] !== 'board') { history.replaceState(null, '', '#' + S.views[0]); readHash(); }
    }
    S.loaded = true;
    render();
  }

  // Eventos del hub (spec §5.5). El hello llega al abrir y en cada reconexión: dispara una carga completa.
  function onEvent(m) {
    if (m.type === 'hello') { load(); return; }
    if (m.type === 'focus') { callAttention(); return; }
    if (loading) { eventsDuringLoad = true; return; }
    if (S.view === 'files') refreshFiles(); // cualquier cambio puede tocar el estado de git de algún archivo
    if (m.type === 'doc_changed') { docChanged(m.alias); return; }
    if (m.type === 'docs_git') { applyDocsGit(m); return; }
    if (m.type === 'git') { S.git = m; renderGit(); return; }
    if (m.type === 'upsert') { clearWarning(m.collection, m.id); apply(m.collection, m.id, m.doc); }
    else if (m.type === 'delete') { clearWarning(m.collection, m.id); apply(m.collection, m.id, null); }
    else if (m.type === 'warning') {
      setWarning(m);
      // Un archivo que pasó a inválido deja de mostrarse, igual que en la carga.
      const hit = /^compass\/(milestones|tasks)\/([^/]+)\.json$/.exec(m.path);
      if (hit && m.code !== 'unknown_milestone') apply(hit[1], hit[2], null); else render();
    }
  }

  // Clic en el ícono de la bandeja con el tablero ya abierto: el hub manda `focus` en lugar de abrir otra pestaña.
  // Una página no puede enfocarse sola, pero sí desde el clic en una notificación suya.
  const canNotify = () => 'Notification' in window && Notification.permission === 'granted';
  function callAttention() {
    if (!canNotify() || (document.visibilityState === 'visible' && document.hasFocus())) return;
    const n = new Notification('Scope Compass', { body: `${S.project || 'Tablero'} · tocá para volver al tablero`, tag: 'scompass-focus' });
    n.onclick = () => { window.focus(); n.close(); };
  }
  // El hub solo cuenta las pestañas que pueden notificar; sin permiso, la bandeja abre una pestaña como siempre.
  let socket = null;
  const sendPresence = () => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'presence', notify: canNotify() })); };
  // El permiso se pide en el primer clic (el navegador exige un gesto del usuario).
  if ('Notification' in window && Notification.permission === 'default') {
    document.addEventListener('click', () => { Promise.resolve(Notification.requestPermission()).then(sendPresence, () => {}); }, { once: true });
  }

  // WebSocket con reconexión: espera creciente de 0,5 s a 10 s, y vuelve a 0,5 s al conectar.
  let retry = 500;
  function connect() {
    const ws = new WebSocket(new URL(BASE + 'ws', location.href.replace(/^http/, 'ws')));
    // El handler se registra ya: el hello llega apenas se abre la conexión (spec §5.5).
    ws.onmessage = (e) => { try { onEvent(JSON.parse(e.data)); } catch (err) { console.error(err); } };
    ws.onopen = () => { retry = 500; S.connected = true; socket = ws; sendPresence(); renderConn(); };
    ws.onclose = () => {
      S.connected = false;
      renderConn();
      setTimeout(connect, retry);
      retry = Math.min(retry * 2, 10000);
    };
  }
  function renderConn() {
    const el = document.getElementById('conn');
    // Sin mostrarlo en el primer instante de la carga: solo si se perdió o nunca llegó.
    el.hidden = S.connected || !S.loaded;
  }

  // "← Inicio" solo si el Inicio está corriendo. Se revisa cada 10 s y al volver a la pestaña: puede abrirse o
  // cerrarse en cualquier momento.
  async function checkHome() {
    const r = await api.home().catch(() => null);
    const a = document.getElementById('home-link');
    a.hidden = !r?.url;
    if (r?.url) a.href = r.url;
  }
  // Dentro del Inicio: la barra con "Inicio" y el selector de proyecto (la lista sale de la API del Inicio, en /).
  async function homeBar() {
    const a = document.getElementById('home-link');
    a.href = '/';
    a.hidden = false;
    const sel = document.getElementById('project-switch');
    const r = await fetch('/api/projects').then((x) => x.json()).catch(() => null);
    const list = (r?.projects ?? []).filter((p) => p.url);
    if (list.length < 2) return;
    sel.replaceChildren(...list.map((p) => h('option', { value: p.url, selected: p.url === BASE }, p.name)));
    sel.hidden = false;
    sel.onchange = () => { location.href = sel.value; };
  }
  if (IN_HOME) homeBar();
  else {
    checkHome();
    setInterval(checkHome, 10000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkHome(); });
  }

  readHash();
  window.addEventListener('hashchange', () => { readHash(); if (S.loaded) dropMissingTask(); render(); scrollToSection(); });
  render();
  connect();
  // Si el WebSocket no conecta, igual se intenta la carga (muestra el aviso de hub caído).
  setTimeout(() => { if (!S.loaded) load(); }, 1500);
})();
