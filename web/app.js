// Tablero de Scope Compass: port del artifact (docs/reference/tablero-artifact.html, spec §7).
// El render es el mismo; los datos vienen de la API del hub en lugar de claude.use("db").
(function () {
  const STATUSES = [
    { id: 'todo', label: 'Pendiente', color: 'var(--s-todo)' },
    { id: 'doing', label: 'En curso', color: 'var(--s-doing)' },
    { id: 'review', label: 'Revisión', color: 'var(--s-review)' },
    { id: 'done', label: 'Hecho', color: 'var(--s-done)' }
  ];
  const S = { project: '', milestones: [], tasks: [], warnings: [], filter: pref('filter') || 'all', openId: null, confirmDelete: false, loaded: false, offline: false, connected: false,
    // Documentos (M6): índice de /api/docs, vista actual por el hash, referencias desplegadas, HTML en caché.
    docs: [], view: 'board', doc: '', sec: '', refsOpen: new Set(), refSearch: null,
    // Vínculos entre tareas: buscador abierto ({ type, q }) o null.
    linkSearch: null,
    // Pasos: detalles desplegados y el paso en edición ("tarea:índice").
    stepsOpen: new Set(), editStep: null,
    // Listas (D25): las del proyecto, la abierta, el ítem en edición ("lista:n") y las pestañas de config.views.
    lists: [], list: '', editItem: null, views: ['board', 'lists', 'docs'], viewsApplied: false,
    // Cambios sin commitear en compass/ y el export (4.4), de /api/git y el evento `git`.
    git: null };
  const sectionCache = new Map(); // "alias#id" → html
  const docCache = new Map(); // alias → html

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
    docs: () => call('GET', '/api/docs'),
    doc: (alias) => call('GET', '/api/docs/' + encodeURIComponent(alias)),
    section: (alias, id) => call('GET', '/api/docs/' + encodeURIComponent(alias) + '/sections/' + encodeURIComponent(id)),
    lists: () => call('GET', '/api/lists'),
    git: () => call('GET', '/api/git'),
    home: () => call('GET', '/api/home'),
    listCreate: (title) => call('POST', '/api/lists', { title }),
    listPatch: (id, patch, etag) => call('PATCH', '/api/lists/' + encodeURIComponent(id), patch, etag),
    listDelete: (id, etag) => call('DELETE', '/api/lists/' + encodeURIComponent(id), undefined, etag),
    listCheck: (id, n, etag) => call('POST', '/api/lists/' + encodeURIComponent(id) + '/check', { n }, etag),
    listTask: (id, n, milestone, etag) => call('POST', '/api/lists/' + encodeURIComponent(id) + '/task', { n, milestone }, etag)
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

  const LINK = /\[\[([^\]#\s]+)#([a-z0-9][a-z0-9_-]*)\]\]/g;
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
        frag.append(plain ? document.createTextNode(sectionOf(docByKey(m[1]), m[2])?.title.replace(/`/g, '') ?? m[0]) : docLink(m[1], m[2]));
        last = m.index + m[0].length;
      }
      frag.append(document.createTextNode(part.slice(last).replace(/\*\*/g, '')));
    });
    return frag;
  }
  // Enlace a una sección: su título actual, o marcado como roto si ya no existe.
  function docLink(key, id) {
    const d = docByKey(key);
    const sec = sectionOf(d, id);
    if (!sec) return h('span', { class: 'doclink broken', title: 'Referencia rota: la sección ya no existe' }, '⚠ ' + key + '#' + id);
    const a = h('a', { class: 'doclink', href: '#docs/' + encodeURIComponent(d.alias) + '/' + encodeURIComponent(sec.id), title: d.path + '#' + sec.id,
      onclick: (e) => e.stopPropagation() }, sec.title.replace(/`/g, ''));
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
    t.textContent = msg; t.hidden = false;
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
    // Otras colecciones que esta versión no conoce: no se mezclan con las tareas.
    if (collection !== 'milestones' && collection !== 'tasks') return;
    const list = collection === 'milestones' ? S.milestones : S.tasks;
    const i = list.findIndex((t) => t.id === id);
    if (doc === null) { if (i >= 0) list.splice(i, 1); }
    else if (i >= 0) list[i] = doc;
    else list.push(doc);
    if (collection === 'milestones') list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    if (S.openId && !S.tasks.some((t) => t.id === S.openId)) S.openId = null;
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
    const run = () => write(async () => {
      const t = S.tasks.find((x) => x.id === id);
      if (!t) return;
      const body = typeof patch === 'function' ? patch(t) : patch;
      if (!body) return;
      try { applyTask(id, await api.update(id, body, t.etag)); }
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
  const DUE_FILTERS = [['', 'Cualquier fecha'], ['overdue', 'Vencidas'], ['today', 'Vencen hoy'], ['week', 'Esta semana'], ['none', 'Sin fecha']];
  const BLOCK_FILTERS = [['', 'Con y sin bloqueo'], ['yes', 'Bloqueadas'], ['no', 'No bloqueadas']];
  const emptyFilter = () => ({ q: '', status: [], due: '', blocked: '', pendingSteps: false, withRefs: false, tags: [], priority: [], assignee: [] });
  // Se recuerdan por proyecto. Dentro del Inicio todos los tableros comparten el origen (D29): la clave lleva la ruta.
  const FILTER_KEY = 'taskFilter:' + BASE, MODE_KEY = 'boardMode:' + BASE, SORT_KEY = 'listSort:' + BASE;
  function readJsonPref(key, fallback) { try { return JSON.parse(pref(key) || 'null') ?? fallback; } catch (e) { return fallback; } }
  S.f = { ...emptyFilter(), ...readJsonPref(FILTER_KEY, {}) };
  S.mode = pref(MODE_KEY) === 'list' ? 'list' : 'board';
  S.sort = readJsonPref(SORT_KEY, null); // { key, dir: 1 | -1 } o null: el orden del tablero
  function setF(changes) { S.f = { ...S.f, ...changes }; pref(FILTER_KEY, JSON.stringify(S.f)); render(); }
  function setMode(mode) { S.mode = mode; pref(MODE_KEY, mode); render(); }
  const filterActive = (f = S.f) => !!(f.q.trim() || f.status.length || f.due || f.blocked || f.pendingSteps || f.withRefs || f.tags.length || f.priority.length || f.assignee.length);

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
      bar.append(h('div', { class: 'f-main' },
        h('div', { class: 'mode-switch', role: 'group', 'aria-label': 'Vista del tablero' },
          h('button', { type: 'button', id: 'mode-board', onclick: () => setMode('board') }, 'Tablero'),
          h('button', { type: 'button', id: 'mode-list', onclick: () => setMode('list') }, 'Lista')),
        h('label', { for: 'f-q', class: 'sr' }, 'Buscar tareas'), q),
      h('div', { class: 'f-more' }));
    }
    document.getElementById('mode-board').setAttribute('aria-pressed', S.mode === 'board' ? 'true' : 'false');
    document.getElementById('mode-list').setAttribute('aria-pressed', S.mode === 'list' ? 'true' : 'false');
    const q = document.getElementById('f-q');
    if (q.value !== S.f.q) q.value = S.f.q;
    const more = bar.querySelector('.f-more');
    const open = [...more.querySelectorAll('details[open]')].map((d) => d.dataset.key);
    const focus = more.contains(document.activeElement) ? document.activeElement.id : null;
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
    const single = (key, label, options) => h('select', { id: 'f-' + key, 'aria-label': label, class: S.f[key] ? 'on' : null, onchange: (e) => setF({ [key]: e.target.value }) },
      options.map(([v, l]) => h('option', { value: v, selected: S.f[key] === v }, l)));
    const toggle = (key, label) => h('button', { type: 'button', class: 'chip small', id: 'f-' + key, 'aria-pressed': S.f[key] ? 'true' : 'false', onclick: () => setF({ [key]: !S.f[key] }) }, label);
    // Los valores elegidos siguen en la lista aunque ninguna tarea los tenga ya (se pueden destildar).
    const values = (all, chosen) => [...new Set([...all, ...chosen.filter((x) => x !== 'none')])].map((x) => [x, x]);
    const total = visibleTasks().length, shown = shownTasks().length;
    more.replaceChildren(...[
      multi('status', 'Estado', STATUSES.map((s) => [s.id, s.label])),
      single('due', 'Fecha límite', DUE_FILTERS),
      single('blocked', 'Bloqueo', BLOCK_FILTERS),
      toggle('pendingSteps', 'Con pasos pendientes'),
      toggle('withRefs', 'Con referencias'),
      multi('tags', 'Etiquetas', values(allTags(), S.f.tags)),
      multi('priority', 'Prioridad', [...PRIORITIES, ['none', 'Sin prioridad']]),
      multi('assignee', 'Responsable', [...values(allAssignees(), S.f.assignee), ['none', 'Sin responsable']]),
      filterActive() ? h('span', { class: 'f-count', role: 'status' }, shown + ' de ' + total + (total - shown ? ' · ' + (total - shown) + ' ocultas' : '')) : null,
      filterActive() ? h('button', { type: 'button', class: 'btn ghost small', id: 'f-clear', onclick: () => { setF(emptyFilter()); document.getElementById('f-q').focus(); } }, 'Limpiar filtros') : null
    ].filter(Boolean));
    if (focus) document.getElementById(focus)?.focus();
  }
  // Un clic afuera cierra los desplegables de los filtros.
  document.addEventListener('click', (e) => {
    for (const d of document.querySelectorAll('#filters details[open]')) if (!d.contains(e.target)) d.open = false;
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
    { key: 'assignee', label: 'Responsable', val: (t) => t.assignee || null, opt: true },
    { key: 'tags', label: 'Etiquetas', val: (t) => tagsOf(t).join(', ') || null, opt: true }
  ];
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
  // Clic en un encabezado: ascendente, descendente y de vuelta al orden del tablero.
  function sortBy(key) {
    S.sort = S.sort?.key !== key ? { key, dir: 1 } : S.sort.dir === 1 ? { key, dir: -1 } : null;
    pref(SORT_KEY, S.sort ? JSON.stringify(S.sort) : '');
    render();
  }
  function renderTaskList() {
    const box = document.getElementById('tasklist');
    if (S.view !== 'board' || S.mode !== 'list') { box.replaceChildren(); return; }
    const ts = sortedForList(shownTasks());
    if (!ts.length) {
      box.replaceChildren(h('div', { class: 'notice' }, S.loaded ? (filterActive() ? 'Ninguna tarea con estos filtros.' : 'Sin tareas.') : 'Cargando tareas…'));
      return;
    }
    const head = h('tr', null, COLUMNS.map((c) => {
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
      return h('tr', { 'data-id': t.id, 'aria-current': S.openId === t.id ? 'true' : null, onclick: (e) => { if (!e.target.closest('button')) openTask(t.id); } },
        h('td', { class: 'code' }, t.code || ''),
        h('td', { class: 'title' }, h('button', { type: 'button', class: 'row-open', onclick: () => openTask(t.id) }, rich(t.title, true))),
        h('td', { class: 'opt code' }, m ? h('span', { title: m.title }, m.code) : t.milestone),
        h('td', null, h('span', { class: 'st', title: s.label }, h('span', { class: 'dot', style: 'background:' + s.color }), h('span', { class: 'st-l' }, s.label))),
        h('td', { class: 'opt code' }, p.total ? p.done + '/' + p.total : ''),
        h('td', null, t.due ? dueMark(t) : null),
        h('td', { class: 'opt' }, blockers.length ? h('span', { class: 'blockmark', title: 'Bloqueada por: ' + blockers.map(taskName).join('; ') }, 'Bloqueada') : null),
        h('td', { class: 'opt' }, t.priority ? h('span', { class: 'prio ' + t.priority }, PRIORITY_LABEL[t.priority] || t.priority) : null),
        h('td', { class: 'opt' }, t.assignee || ''),
        h('td', { class: 'opt' }, tagsOf(t).map((x) => h('span', { class: 'tag' }, x))));
    });
    box.replaceChildren(h('div', { class: 'table-wrap' }, h('table', { class: 'tasks' }, h('thead', null, head), h('tbody', null, rows))));
  }

  function renderMiles() {
    const nav = document.getElementById('miles');
    nav.replaceChildren();
    const all = S.tasks.length, allDone = S.tasks.filter((t) => t.status === 'done').length;
    nav.append(h('button', { class: 'chip', type: 'button', 'aria-pressed': S.filter === 'all' ? 'true' : 'false', onclick: () => setFilter('all') },
      'Todos', h('span', { class: 'n' }, allDone + '/' + all)));
    for (const m of S.milestones) {
      const ts = S.tasks.filter((t) => t.milestone === m.id);
      const d = ts.filter((t) => t.status === 'done').length;
      const complete = ts.length > 0 && d === ts.length;
      nav.append(h('button', { class: 'chip' + (complete ? ' complete' : ''), type: 'button', title: m.title, 'aria-pressed': S.filter === m.id ? 'true' : 'false', onclick: () => setFilter(m.id) },
        m.code, h('span', { class: 'n' }, ts.length ? d + '/' + ts.length : '—')));
    }
    const sel = document.getElementById('new-ms');
    const cur = sel.value;
    sel.replaceChildren(...S.milestones.map((m) => h('option', { value: m.id }, m.code + ' · ' + m.title)));
    sel.value = cur || (S.filter !== 'all' ? S.filter : (S.milestones[0] && S.milestones[0].id) || '');
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
    const left = h('div', null,
      h('h2', null, m ? m.code + ' · ' + m.title : 'Todos los hitos'),
      h('p', null, rich(m ? m.goal : 'Todas las tareas de ' + (S.project || 'este proyecto') + '. Elegí un hito para ver su objetivo.')),
      h('div', { class: 'progress' }, h('div', { class: 'bar', role: 'img', 'aria-label': pct + '% hecho' }, h('i', { style: 'width:' + pct + '%' })), d + '/' + ts.length + ' tareas',
        hidden ? h('span', { class: 'hidden-n' }, '· ' + (hidden === 1 ? '1 oculta' : hidden + ' ocultas') + ' por los filtros') : null));
    const right = h('div', null);
    if (m && Array.isArray(m.done_when) && m.done_when.length) {
      right.append(h('div', { class: 'label' }, 'Hecho cuando'), h('ul', null, m.done_when.map((x) => h('li', null, rich(x)))));
    } else if (!m) {
      right.append(h('div', { class: 'label' }, 'Por estado'),
        h('ul', null, STATUSES.map((s) => h('li', null, s.label + ': ' + S.tasks.filter((t) => t.status === s.id).length))));
    }
    box.hidden = false;
    box.append(left, right);
  }

  function renderBoard() {
    const board = document.getElementById('board');
    board.replaceChildren();
    if (S.view !== 'board' || S.mode !== 'board') return;
    const ts = shownTasks().sort(sortTasks);
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

  // Fecha límite de una tarea (8.13, D26): vencida u hoy se marcan, salvo en las hechas.
  function dueMark(t) {
    const g = t.status === 'done' ? null : dueGroup(t.due);
    const cls = g === 'overdue' ? ' bad' : g === 'today' ? ' today' : '';
    return h('span', { class: 'duemark' + cls, title: g === 'overdue' ? 'Vencida' : g === 'today' ? 'Vence hoy' : 'Fecha límite' }, (g === 'overdue' ? 'Vencida · ' : '') + showDue(t.due));
  }

  // Fecha y hora opcionales; vaciar la fecha la quita (null borra el campo en el PATCH).
  function dueField(t) {
    const [date, time] = t.due ? [t.due.slice(0, 10), t.due.slice(11)] : ['', ''];
    const save = () => {
      const d = document.getElementById('d-due').value, hm = document.getElementById('d-due-time').value;
      const next = d ? d + (hm ? 'T' + hm : '') : null;
      if (next !== (t.due ?? null)) updateTask(t.id, { due: next });
    };
    return h('div', { style: 'display:flex;flex-direction:column;gap:6px' },
      h('label', { class: 'label', for: 'd-due' }, 'Fecha límite'),
      h('div', { class: 'due-row' },
        h('input', { type: 'date', id: 'd-due', value: date, 'data-orig': date, onchange: save }),
        h('label', { for: 'd-due-time', class: 'sr' }, 'Hora'),
        h('input', { type: 'time', id: 'd-due-time', value: time, 'data-orig': time, disabled: !date, onchange: save }),
        t.due ? dueMark(t) : null,
        t.due ? h('button', { class: 'btn ghost small', type: 'button', onclick: () => updateTask(t.id, { due: null }) }, 'Quitar') : null));
  }

  // Prioridad, responsable y etiquetas (D32). Las sugerencias salen de lo que ya usan las otras tareas.
  // Una etiqueta no lleva comas: "arte, audio" son dos. Vaciar un campo lo quita (null en el PATCH).
  function metaFields(t) {
    const addTags = (raw) => {
      const add = String(raw).split(',').map((x) => x.trim()).filter((x) => x && x.length <= 40);
      if (!add.length) return;
      updateTask(t.id, (cur) => { const next = [...new Set([...tagsOf(cur), ...add])]; return next.length === tagsOf(cur).length ? null : { tags: next }; });
    };
    const takeTag = (el) => { const v = el.value; el.value = ''; el.dataset.orig = ''; addTags(v); };
    return h('div', { class: 'meta-fields' },
      h('div', { class: 'field' },
        h('label', { class: 'label', for: 'd-priority' }, 'Prioridad'),
        h('select', { id: 'd-priority', onchange: (e) => updateTask(t.id, { priority: e.target.value || null }) },
          h('option', { value: '', selected: !t.priority }, 'Sin prioridad'),
          PRIORITIES.map(([v, l]) => h('option', { value: v, selected: t.priority === v }, l)))),
      h('div', { class: 'field' },
        h('label', { class: 'label', for: 'd-assignee' }, 'Responsable'),
        h('input', { id: 'd-assignee', list: 'd-assignees', value: t.assignee || '', 'data-orig': t.assignee || '', placeholder: 'Nadie', autocomplete: 'off',
          onchange: (e) => { const v = e.target.value.trim(); if (v !== (t.assignee || '')) updateTask(t.id, { assignee: v || null }); } }),
        h('datalist', { id: 'd-assignees' }, allAssignees().map((x) => h('option', { value: x })))),
      h('div', { class: 'field wide' },
        h('label', { class: 'label', for: 'd-tag' }, 'Etiquetas'),
        h('div', { class: 'tags-edit' },
          tagsOf(t).map((x) => h('span', { class: 'tag' }, x,
            h('button', { type: 'button', class: 'rm', 'aria-label': 'Quitar etiqueta ' + x,
              onclick: () => updateTask(t.id, (cur) => { const next = tagsOf(cur).filter((y) => y !== x); return { tags: next.length ? next : null }; }) }, '×'))),
          h('input', { id: 'd-tag', list: 'd-tags', placeholder: tagsOf(t).length ? 'Otra etiqueta' : 'Agregar etiqueta', autocomplete: 'off', 'data-orig': '',
            onkeydown: (e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); takeTag(e.target); } },
            onchange: (e) => { if (e.target.value.trim()) takeTag(e.target); } }),
          h('datalist', { id: 'd-tags' }, allTags().filter((x) => !tagsOf(t).includes(x)).map((x) => h('option', { value: x }))))));
  }

  function cardFor(t, s) {
    const p = clProgress(t);
    const m = msById(t.milestone);
    const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
    return h('button', { class: 'card', type: 'button', draggable: 'true', style: 'border-left: 4px solid ' + s.color,
      'aria-current': S.openId === t.id ? 'true' : null, 'data-id': t.id,
      ondragstart: (e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; },
      ondragover: (e) => { e.preventDefault(); e.currentTarget.classList.add('drop-before'); },
      ondragleave: (e) => e.currentTarget.classList.remove('drop-before'),
      ondrop: (e) => {
        e.preventDefault(); e.stopPropagation();
        e.currentTarget.classList.remove('drop-before');
        e.currentTarget.closest('.col')?.classList.remove('over');
        const id = e.dataTransfer.getData('text/plain');
        if (id && id !== t.id) dropBefore(id, t);
      },
      onclick: () => openTask(t.id) },
      h('span', { class: 'meta' }, t.code ? h('span', null, t.code) : null, m && S.filter === 'all' ? h('span', { class: 'ms' }, m.code) : null,
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
  const EDITABLE = ['d-title', 'd-assignee', 'd-tag', 'd-addcl', 'd-refq', 'd-linkq', 'd-step-text', 'd-step-detail', 'd-test', 'd-notes'];
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
      h('div', { class: 'head' }, t.code || '', m ? h('span', null, '· ' + m.code + ' ' + m.title) : null,
        h('button', { class: 'btn ghost close', type: 'button', 'aria-label': 'Cerrar detalle', onclick: closeTask }, 'Cerrar')),
      h('label', { for: 'd-title', class: 'sr' }, 'Título'),
      h('input', { class: 'title', id: 'd-title', value: t.title || '', 'data-orig': t.title || '', onchange: (e) => { const v = e.target.value.trim(); if (v && v !== t.title) updateTask(t.id, { title: v }); } }),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Estado' }, STATUSES.map((s) =>
        h('button', { type: 'button', 'aria-pressed': (t.status || 'todo') === s.id ? 'true' : 'false', onclick: () => setStatus(t.id, s.id) }, s.label))),
      h('div', { style: 'display:flex;flex-direction:column;gap:6px' },
        h('label', { class: 'label', for: 'd-ms' }, 'Hito'),
        h('select', { id: 'd-ms', onchange: (e) => updateTask(t.id, { milestone: e.target.value }) },
          S.milestones.map((x) => h('option', { value: x.id, selected: x.id === t.milestone }, x.code + ' · ' + x.title)))),
      dueField(t),
      metaFields(t),
      h('div', { style: 'display:flex;flex-direction:column;gap:6px' },
        h('span', { class: 'label' }, 'Pasos ' + (p.total ? '(' + p.done + '/' + p.total + ')' : '')),
        cl.length ? h('ul', { class: 'checklist' }, cl.map((c, i) => stepItem(t, c, i))) : h('p', { style: 'margin:0;color:var(--muted);font-size:14px' }, 'Sin pasos todavía.'),
        h('form', { class: 'addcl', onsubmit: (e) => { e.preventDefault(); const inp = e.target.querySelector('input'); const v = inp.value.trim(); if (!v) return; inp.value = ''; updateTask(t.id, (cur) => ({ checklist: [...checklistOf(cur), { text: v, done: false }] })); } },
          h('label', { for: 'd-addcl', class: 'sr' }, 'Nuevo paso'),
          h('input', { id: 'd-addcl', placeholder: 'Agregar paso', autocomplete: 'off', 'data-orig': '' }),
          h('button', { class: 'btn', type: 'submit' }, 'Agregar'))),
      renderRefs(t),
      renderLinks(t),
      h('div', { style: 'display:flex;flex-direction:column;gap:6px' },
        h('label', { class: 'label', for: 'd-test' }, 'Cómo probarlo'),
        h('textarea', { id: 'd-test', 'data-orig': t.test || '', onchange: (e) => updateTask(t.id, { test: e.target.value }) }, t.test || ''),
        linksOf(t.test)),
      h('div', { style: 'display:flex;flex-direction:column;gap:6px' },
        h('label', { class: 'label', for: 'd-notes' }, 'Notas'),
        h('textarea', { id: 'd-notes', 'data-orig': t.notes || '', onchange: (e) => updateTask(t.id, { notes: e.target.value }) }, t.notes || ''),
        linksOf(t.notes)),
      h('div', { class: 'footer-actions' },
        h('span', null, t.updated_at ? 'Actualizada ' + new Date(t.updated_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : ''),
        S.confirmDelete
          ? h('span', { class: 'confirm' }, '¿Borrar la tarea?',
              h('button', { class: 'btn danger', type: 'button', onclick: () => { const id = t.id; closeTask(); const etag = t.etag; write(async () => { try { await api.remove(id, etag); } catch (e) { e.id = id; throw e; } applyTask(id, null); }, 'Tarea borrada'); } }, 'Sí, borrar'),
              h('button', { class: 'btn', type: 'button', onclick: () => { S.confirmDelete = false; renderDetail(); } }, 'No'))
          : h('button', { class: 'btn ghost danger', type: 'button', onclick: () => { S.confirmDelete = true; renderDetail(); } }, 'Borrar tarea')));
    box.hidden = false;
    box.dataset.task = t.id;
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

  // Tareas que referencian una sección: refs estructuradas y enlaces [[alias#id]] (los de dentro de `…` no cuentan).
  function tasksFor(d, id) {
    const hits = (key, sid) => sid === id && (key === d.alias || key === d.path);
    return S.tasks.filter((t) => refsOf(t).some((r) => hits(r.doc, r.section)) ||
      [t.notes, t.test, ...checklistOf(t).flatMap((c) => [c.text, c.detail])].some((txt) =>
        [...String(txt || '').replace(/`[^`]*`/g, '').matchAll(LINK)].some((m) => hits(m[1], m[2]))))
      .sort(sortTasks);
  }
  const brokenRefs = (t) => refsOf(t).filter((r) => !sectionOf(docByKey(r.doc), r.section));
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
      const remove = h('button', { class: 'rm', type: 'button', 'aria-label': 'Quitar referencia', onclick: () => updateTask(t.id, (cur) => ({ refs: refsOf(cur).filter((x) => !(x.doc === r.doc && x.section === r.section)) })) }, '×');
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
            ? h('button', { class: 'link-task', type: 'button', title: 'Abrir la tarea', onclick: () => openTask(id) }, rich(taskName(id), true))
            : h('span', { class: 'link-task' }, '⚠ ' + taskName(id)),
          st ? h('span', { class: 'link-status', style: 'color:' + st.color }, st.label) : null,
          h('button', { class: 'rm', type: 'button', 'aria-label': 'Quitar vínculo', onclick: () => removeLink(t.id, id) }, '×')));
      }
    }
    return box;
  }

  // Buscador de tareas para vincular: título, código o id.
  function linkSearch(t, v) {
    const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const words = norm(S.linkSearch.q).split(/\s+/).filter(Boolean);
    const have = new Set([t.id, ...v.blocks, ...v.blockedBy, ...v.related]);
    const matches = S.tasks.filter((x) => !have.has(x.id) && words.every((w) => norm(x.code + ' ' + x.title + ' ' + x.id).includes(w)))
      .sort((a, b) => (a.milestone === t.milestone ? 0 : 1) - (b.milestone === t.milestone ? 0 : 1) || sortTasks(a, b)).slice(0, 8);
    return h('div', { class: 'ref-search' },
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
    const have = new Set(refsOf(t).map((r) => (docByKey(r.doc)?.path || r.doc) + '#' + r.section));
    const matches = S.docs.flatMap((d) => d.sections.map((s) => ({ d, s })))
      .filter(({ d, s }) => !have.has(d.path + '#' + s.id) && words.every((w) => norm(s.title + ' ' + s.id).includes(w)))
      .slice(0, 8);
    return h('div', { class: 'ref-search' },
      h('label', { for: 'd-refq', class: 'sr' }, 'Buscar sección'),
      h('input', { id: 'd-refq', placeholder: 'Buscar sección por título', autocomplete: 'off', value: S.refSearch || '', 'data-orig': S.refSearch || '',
        oninput: (e) => { S.refSearch = e.target.value; renderDetail(); } }),
      h('ul', { class: 'ref-matches' }, matches.map(({ d, s }) => h('li', null,
        h('button', { type: 'button', onclick: () => { S.refSearch = null; updateTask(t.id, (cur) => refsOf(cur).some((x) => (docByKey(x.doc)?.path || x.doc) === d.path && x.section === s.id) ? null : ({ refs: [...refsOf(cur), { doc: d.path, section: s.id }] })); } },
          rich(s.title), h('span', { class: 'ref-id' }, d.alias + '#' + s.id))))),
      words.length && !matches.length ? h('p', { class: 'muted small' }, 'Ninguna sección coincide.') : null);
  }

  // Vista Documentos: índice, documento y tareas que referencian la sección actual.
  function readHash() {
    const l = /^#lists(?:\/([^/]+))?$/.exec(location.hash);
    if (l) { S.view = 'lists'; S.openId = null; S.confirmDelete = false; if (l[1]) S.list = decodeURIComponent(l[1]); return; }
    const m = /^#docs(?:\/([^/]+)(?:\/([^/]+))?)?$/.exec(location.hash);
    S.view = m ? 'docs' : 'board';
    if (m) { S.openId = null; S.confirmDelete = false; } // el detalle de una tarea es del tablero
    if (m) { S.doc = m[1] ? decodeURIComponent(m[1]) : (S.doc || ''); S.sec = m[2] ? decodeURIComponent(m[2]) : ''; }
  }
  function docHtml(alias) {
    if (docCache.has(alias)) return docCache.get(alias);
    docCache.set(alias, null);
    api.doc(alias).then((r) => { docCache.set(alias, r.html); renderDocs(true); scrollToSection(); }).catch(() => docCache.delete(alias));
    return null;
  }
  let docObserver = null;
  function renderDocs(rebuildArticle) {
    const box = document.getElementById('docs');
    if (S.view !== 'docs') { box.replaceChildren(); return; }
    if (!S.docs.length) { box.replaceChildren(h('div', { class: 'notice' }, 'Este proyecto no tiene documentos configurados. Agregalos en ', h('code', null, 'compass/config.json › docs'), '.')); return; }
    const d = docByKey(S.doc) || S.docs[0];
    S.doc = d.alias;
    const sec = sectionOf(d, S.sec);
    const broken = allBroken();
    const existing = box.querySelector('article.doc-body');
    const keepArticle = existing && existing.dataset.alias === d.alias && existing.dataset.ready === '1' && docCache.get(d.alias) && !rebuildArticle;
    const article = keepArticle ? existing : htmlBox('doc-body', docHtml(d.alias), 'article');
    article.dataset.alias = d.alias;
    article.dataset.ready = docCache.get(d.alias) ? '1' : '0';
    article.classList.add('doc-article');
    const counts = new Map(d.sections.map((s) => [s.id, tasksFor(d, s.id).length]));
    box.replaceChildren(
      h('div', { class: 'docs-bar' },
        S.docs.length > 1 ? h('select', { 'aria-label': 'Documento', onchange: (e) => { location.hash = '#docs/' + encodeURIComponent(e.target.value); } },
          S.docs.map((x) => h('option', { value: x.alias, selected: x.alias === d.alias }, x.path))) : h('code', null, d.path),
        h('span', { class: 'pill' + (broken.length ? ' bad' : '') }, h('span', { class: 'dot' }), broken.length === 1 ? '1 referencia rota' : broken.length + ' referencias rotas'),
        // Enlace [[alias#id]] a la sección actual, para pegarlo en notas o pasos (6.6).
        sec && !sec.explicit ? h('span', { class: 'fragile', title: 'Agregá <!-- id: … --> debajo del título en ' + d.path + ' (o scompass doc stamp-ids ' + d.alias + ')' },
          'Sin id: el enlace se rompe si cambiás el título') : null,
        sec ? h('button', { class: 'btn ghost small copy-link', type: 'button', title: 'Copia [[' + d.alias + '#' + sec.id + ']] para pegar en notas o pasos',
          onclick: () => copy('[[' + d.alias + '#' + sec.id + ']]') }, 'Copiar enlace') : null),
      h('div', { class: 'docs-grid' },
        h('nav', { class: 'toc', 'aria-label': 'Índice de ' + d.path }, d.sections.map((s) => h('a', {
          href: '#docs/' + encodeURIComponent(d.alias) + '/' + encodeURIComponent(s.id), 'aria-current': s.id === S.sec ? 'true' : null,
          style: 'padding-left:' + (6 + (s.level - 1) * 12) + 'px', title: counts.get(s.id) ? counts.get(s.id) + ' tareas' : 'Sin tareas: todavía no planificada'
        }, h('span', { class: 'toc-dot' + (counts.get(s.id) ? ' has' : '') }), h('span', { class: 't' }, rich(s.title)),
          counts.get(s.id) ? h('span', { class: 'n' }, counts.get(s.id)) : null))),
        article,
        h('aside', { class: 'backlinks', 'aria-label': 'Tareas que referencian esta sección' },
          sec ? [h('div', { class: 'label' }, 'Referenciada por · ' + (counts.get(sec.id) === 1 ? '1 tarea' : counts.get(sec.id) + ' tareas')),
            ...tasksFor(d, sec.id).map((t) => h('a', { href: '#', class: 'bl-task', onclick: (e) => { e.preventDefault(); goToTask(t.id); } },
              h('span', { class: 'dot', style: 'background:' + STATUSES.find((x) => x.id === t.status).color }), t.code ? h('span', { class: 'code' }, t.code) : null, h('span', { class: 't' }, rich(t.title)))),
            counts.get(sec.id) ? null : h('p', { class: 'muted small' }, 'Ninguna tarea referencia esta sección: parte del diseño todavía sin planificar.')]
            : h('p', { class: 'muted small' }, 'Elegí una sección del índice para ver qué tareas la referencian.'))));
    observeHeadings(article);
  }
  // Al bajar por el documento, el índice y los backlinks siguen a la sección visible.
  function observeHeadings(article) {
    docObserver?.disconnect();
    if (!('IntersectionObserver' in window)) return;
    docObserver = new IntersectionObserver((entries) => {
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
    if (S.filter !== 'all' && S.filter !== t.milestone) setFilter(t.milestone);
    location.hash = '';
    S.view = 'board';
    openTask(id);
  }
  function docChanged(alias) {
    for (const k of [...sectionCache.keys()]) if (k.startsWith(alias + '#')) sectionCache.delete(k);
    docCache.delete(alias);
    api.docs().then((r) => { S.docs = r.docs; render(); }).catch(() => {});
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
    if (!l) { box.replaceChildren(h('div', { class: 'lists-grid' }, side, h('div', { class: 'notice' }, 'Este proyecto no tiene listas todavía. Creá una a la izquierda (pendientes, compras, ideas…).'))); return; }
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
        if (x.repeat && !e.target.checked) return;
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

  function toTask(l, n) {
    const ms = S.milestones;
    const pick = ms.length === 1 ? ms[0].id : prompt('¿En qué hito? ' + ms.map((m) => m.code + ' (' + m.id + ')').join(', '), (S.filter !== 'all' ? S.filter : ms[0].id));
    const m = ms.find((x) => x.id === pick || x.code === pick);
    if (!pick) return;
    if (!m) { toast('No hay un hito "' + pick + '".'); return; }
    listWrite(l.id, (cur) => api.listTask(cur.id, n, m.id, cur.etag), (r) => `Tarea creada en ${m.code}: ${r.task.title}`);
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('Copiado: ' + text); } catch (e) { toast(text); }
  }

  // "3 cambios sin commitear": la app nunca commitea en local (spec §4.5), solo lo recuerda.
  function renderGit() {
    const el = document.getElementById('git');
    const n = S.git?.repo ? S.git.uncommitted : 0;
    el.hidden = !n;
    el.textContent = n === 1 ? '1 cambio sin commitear' : n + ' cambios sin commitear';
    el.title = n ? 'Sin commitear en git:\n' + S.git.files.join('\n') : '';
  }

  function render() {
    renderGit();
    renderMiles(); renderFilters(); renderSummary(); renderWarnings(); renderBoard(); renderTaskList(); renderDetail(); renderDocs(); renderLists(); renderConn();
    // La vista se aplica al final: renderSummary muestra su caja por su cuenta.
    const boardView = S.view === 'board';
    for (const id of ['miles', 'filters', 'summary', 'new-btn']) document.getElementById(id).hidden = !boardView;
    document.getElementById('board').hidden = !boardView || S.mode !== 'board';
    document.getElementById('tasklist').hidden = !boardView || S.mode !== 'list';
    if (!boardView) document.getElementById('new-form').hidden = true;
    document.getElementById('docs').hidden = S.view !== 'docs';
    document.getElementById('lists').hidden = S.view !== 'lists';
    // Pestañas en el orden de config.views; las que no están se esconden (la del tablero, si es la actual, no).
    const nav = document.querySelector('nav.views');
    for (const v of ['board', 'lists', 'docs']) {
      const tab = document.getElementById('tab-' + v);
      tab.setAttribute('aria-current', S.view === v ? 'page' : 'false');
      tab.hidden = !S.views.includes(v) && S.view !== v;
      tab.style.order = String(S.views.includes(v) ? S.views.indexOf(v) : 9);
    }
    nav.hidden = [...nav.children].filter((a) => !a.hidden).length < 2;
  }

  function setFilter(id) { S.filter = id; pref('filter', id); render(); }
  function openTask(id) { S.openId = id; S.confirmDelete = false; S.linkSearch = null; render(); const el = document.getElementById('d-title'); if (el) el.focus(); }
  function closeTask() { S.openId = null; S.confirmDelete = false; render(); }
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
    if (S.filter !== 'all') document.getElementById('new-ms').value = S.filter;
    document.getElementById('new-title').focus();
  }
  document.getElementById('new-btn').addEventListener('click', () => {
    const f = document.getElementById('new-form');
    if (f.hidden) openNewForm(); else f.hidden = true;
  });
  document.getElementById('new-cancel').addEventListener('click', () => { document.getElementById('new-form').hidden = true; });
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
      toast(taskMatches(t) ? 'Tarea agregada' : 'Tarea agregada; los filtros la ocultan');
    });
  });
  // Atajos (3.7): N nueva tarea, 1–4 estado de la tarea abierta, Esc cierra. Nunca mientras se escribe.
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
        const [config, m, t, d, l] = await Promise.all([api.config(), api.milestones(), api.tasks(), api.docs().catch(() => ({ docs: [] })),
          // Un hub de antes de las listas no tiene /api/lists.
          api.lists().catch(() => ({ lists: [], warnings: [] }))]);
        S.git = await api.git().catch(() => null);
        S.lists = l.lists;
        S.views = Array.isArray(config.views) && config.views.length ? config.views : ['board', 'lists', 'docs'];
        S.docs = d.docs;
        sectionCache.clear();
        docCache.clear();
        S.project = config.project || '';
        S.milestones = m.milestones;
        S.tasks = t.tasks;
        S.warnings = [];
        for (const w of [...m.warnings, ...t.warnings, ...l.warnings]) setWarning(w);
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
    if (S.openId && !S.tasks.some((x) => x.id === S.openId)) S.openId = null;
    // config.views (§16.6): sin hash, se abre la primera; una pestaña que el proyecto no tiene no se muestra.
    if (!S.viewsApplied && !S.offline) {
      S.viewsApplied = true;
      if (!location.hash && S.views[0] !== 'board') { history.replaceState(null, '', S.views[0] === 'lists' ? '#lists' : '#docs'); readHash(); }
    }
    S.loaded = true;
    render();
  }

  // Eventos del hub (spec §5.5). El hello llega al abrir y en cada reconexión: dispara una carga completa.
  function onEvent(m) {
    if (m.type === 'hello') { load(); return; }
    if (m.type === 'focus') { callAttention(); return; }
    if (loading) { eventsDuringLoad = true; return; }
    if (m.type === 'doc_changed') { docChanged(m.alias); return; }
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
  window.addEventListener('hashchange', () => { readHash(); render(); scrollToSection(); });
  render();
  connect();
  // Si el WebSocket no conecta, igual se intenta la carga (muestra el aviso de hub caído).
  setTimeout(() => { if (!S.loaded) load(); }, 1500);
})();
