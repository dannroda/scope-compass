// Tablero de Scope Compass: port del artifact (docs/reference/tablero-artifact.html, spec §7).
// El render es el mismo; los datos vienen de la API del hub en lugar de claude.use("db").
(function () {
  const STATUSES = [
    { id: 'todo', label: 'Pendiente', color: 'var(--s-todo)' },
    { id: 'doing', label: 'En curso', color: 'var(--s-doing)' },
    { id: 'review', label: 'Revisión', color: 'var(--s-review)' },
    { id: 'done', label: 'Hecho', color: 'var(--s-done)' }
  ];
  const S = { project: '', milestones: [], tasks: [], warnings: [], filter: pref('filter') || 'all', openId: null, confirmDelete: false, loaded: false, offline: false, connected: false };

  // Cliente de la API (spec §5.2). Los errores llegan como { code, message } del hub.
  class ApiError extends Error {
    constructor(status, body) {
      super(body?.error?.message || 'HTTP ' + status);
      this.status = status;
      this.code = body?.error?.code || 'io_error';
      this.current = body?.error?.current;
    }
  }
  async function call(method, path, body, etag) {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (etag) headers['if-match'] = '"' + etag + '"';
    let r;
    try {
      r = await fetch(path, {
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
    remove: (id, etag) => call('DELETE', '/api/tasks/' + encodeURIComponent(id), undefined, etag)
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

  // `código` inline -> <code>, el resto como texto plano
  function rich(str) {
    const frag = document.createDocumentFragment();
    String(str || '').split('`').forEach((part, i) => {
      if (!part) return;
      frag.append(i % 2 ? h('code', null, part) : document.createTextNode(part.replace(/\*\*/g, '')));
    });
    return frag;
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
    const m = S.filter === 'all' ? null : msById(S.filter);
    const left = h('div', null,
      h('h2', null, m ? m.code + ' · ' + m.title : 'Todos los hitos'),
      h('p', null, rich(m ? m.goal : 'Todas las tareas de ' + (S.project || 'este proyecto') + '. Elegí un hito para ver su objetivo.')),
      h('div', { class: 'progress' }, h('div', { class: 'bar', role: 'img', 'aria-label': pct + '% hecho' }, h('i', { style: 'width:' + pct + '%' })), d + '/' + ts.length + ' tareas'));
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
    const ts = visibleTasks().slice().sort(sortTasks);
    for (const s of STATUSES) {
      const items = ts.filter((t) => (t.status || 'todo') === s.id);
      const col = h('section', { class: 'col', 'aria-label': s.label,
        ondragover: (e) => { e.preventDefault(); col.classList.add('over'); },
        ondragleave: () => col.classList.remove('over'),
        ondrop: (e) => { e.preventDefault(); col.classList.remove('over'); const id = e.dataTransfer.getData('text/plain'); if (id) setStatus(id, s.id); } },
        h('h3', null, h('span', { class: 'dot', style: 'background:' + s.color }), s.label, h('span', { class: 'n' }, items.length)));
      if (!items.length) col.append(h('div', { class: 'empty-col' }, S.loaded ? 'Sin tareas' : ''));
      for (const t of items) col.append(cardFor(t, s));
      board.append(col);
    }
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
      h('span', { class: 'meta' }, t.code ? h('span', null, t.code) : null, m && S.filter === 'all' ? h('span', { class: 'ms' }, m.code) : null),
      h('span', { class: 't' }, rich(t.title)),
      p.total ? h('span', { class: 'cl' }, h('span', { class: 'bar', role: 'img', 'aria-label': p.done + ' de ' + p.total + ' pasos' }, h('i', { style: 'width:' + pct + '%' })), p.done + '/' + p.total) : null);
  }

  // Campos editables del detalle. Cada uno guarda en data-orig el valor con el que se dibujó:
  // si el usuario lo cambió y todavía no lo guardó, el valor escrito se conserva al redibujar.
  const EDITABLE = ['d-title', 'd-addcl', 'd-test', 'd-notes'];
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
      h('div', { style: 'display:flex;flex-direction:column;gap:6px' },
        h('span', { class: 'label' }, 'Pasos ' + (p.total ? '(' + p.done + '/' + p.total + ')' : '')),
        cl.length ? h('ul', { class: 'checklist' }, cl.map((c, i) => {
          const id = 'cl-' + t.id + '-' + i;
          return h('li', { class: c.done ? 'done' : '' },
            h('input', { type: 'checkbox', id, checked: !!c.done, onchange: (e) => { const done = e.target.checked; updateTask(t.id, (cur) => ({ checklist: checklistOf(cur).map((x, j) => j === i ? { ...x, done } : x) })); } }),
            h('label', { for: id }, rich(c.text)),
            h('button', { class: 'rm', type: 'button', 'aria-label': 'Quitar paso', onclick: () => updateTask(t.id, (cur) => ({ checklist: checklistOf(cur).filter((_, j) => j !== i) })) }, '×'));
        })) : h('p', { style: 'margin:0;color:var(--muted);font-size:14px' }, 'Sin pasos todavía.'),
        h('form', { class: 'addcl', onsubmit: (e) => { e.preventDefault(); const inp = e.target.querySelector('input'); const v = inp.value.trim(); if (!v) return; inp.value = ''; updateTask(t.id, (cur) => ({ checklist: [...checklistOf(cur), { text: v, done: false }] })); } },
          h('label', { for: 'd-addcl', class: 'sr' }, 'Nuevo paso'),
          h('input', { id: 'd-addcl', placeholder: 'Agregar paso', autocomplete: 'off', 'data-orig': '' }),
          h('button', { class: 'btn', type: 'submit' }, 'Agregar'))),
      h('div', { style: 'display:flex;flex-direction:column;gap:6px' },
        h('label', { class: 'label', for: 'd-test' }, 'Cómo probarlo'),
        h('textarea', { id: 'd-test', 'data-orig': t.test || '', onchange: (e) => updateTask(t.id, { test: e.target.value }) }, t.test || '')),
      h('div', { style: 'display:flex;flex-direction:column;gap:6px' },
        h('label', { class: 'label', for: 'd-notes' }, 'Notas'),
        h('textarea', { id: 'd-notes', 'data-orig': t.notes || '', onchange: (e) => updateTask(t.id, { notes: e.target.value }) }, t.notes || '')),
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

  function render() { renderMiles(); renderSummary(); renderWarnings(); renderBoard(); renderDetail(); renderConn(); }

  function setFilter(id) { S.filter = id; pref('filter', id); render(); }
  function openTask(id) { S.openId = id; S.confirmDelete = false; render(); const el = document.getElementById('d-title'); if (el) el.focus(); }
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
    write(async () => { const t = await api.create({ title, milestone, code: '', status: 'todo', checklist: [], test: '', notes: '', refs: [] }); applyTask(t.id, t); }, 'Tarea agregada');
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
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openNewForm(); return; }
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
        const [config, m, t] = await Promise.all([api.config(), api.milestones(), api.tasks()]);
        S.project = config.project || '';
        S.milestones = m.milestones;
        S.tasks = t.tasks;
        S.warnings = [];
        for (const w of [...m.warnings, ...t.warnings]) setWarning(w);
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
    S.loaded = true;
    render();
  }

  // Eventos del hub (spec §5.5). El hello llega al abrir y en cada reconexión: dispara una carga completa.
  function onEvent(m) {
    if (m.type === 'hello') { load(); return; }
    if (loading) { eventsDuringLoad = true; return; }
    if (m.type === 'upsert') { clearWarning(m.collection, m.id); apply(m.collection, m.id, m.doc); }
    else if (m.type === 'delete') { clearWarning(m.collection, m.id); apply(m.collection, m.id, null); }
    else if (m.type === 'warning') {
      setWarning(m);
      // Un archivo que pasó a inválido deja de mostrarse, igual que en la carga.
      const hit = /^compass\/(milestones|tasks)\/([^/]+)\.json$/.exec(m.path);
      if (hit && m.code !== 'unknown_milestone') apply(hit[1], hit[2], null); else render();
    }
  }

  // WebSocket con reconexión: espera creciente de 0,5 s a 10 s, y vuelve a 0,5 s al conectar.
  let retry = 500;
  function connect() {
    const ws = new WebSocket(new URL('/ws', location.href.replace(/^http/, 'ws')));
    // El handler se registra ya: el hello llega apenas se abre la conexión (spec §5.5).
    ws.onmessage = (e) => { try { onEvent(JSON.parse(e.data)); } catch (err) { console.error(err); } };
    ws.onopen = () => { retry = 500; S.connected = true; renderConn(); };
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

  render();
  connect();
  // Si el WebSocket no conecta, igual se intenta la carga (muestra el aviso de hub caído).
  setTimeout(() => { if (!S.loaded) load(); }, 1500);
})();
