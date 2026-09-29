// Tablero de Scope Compass: port del artifact (docs/reference/tablero-artifact.html, spec §7).
// El render es el mismo; los datos vienen de la API del hub en lugar de claude.use("db").
(function () {
  const STATUSES = [
    { id: 'todo', label: 'Pendiente', color: 'var(--s-todo)' },
    { id: 'doing', label: 'En curso', color: 'var(--s-doing)' },
    { id: 'review', label: 'Revisión', color: 'var(--s-review)' },
    { id: 'done', label: 'Hecho', color: 'var(--s-done)' }
  ];
  const S = { project: '', milestones: [], tasks: [], warnings: [], filter: pref('filter') || 'all', openId: null, confirmDelete: false, loaded: false, offline: false };

  // Cliente de la API (spec §5.2). Los errores llegan como { code, message } del hub.
  class ApiError extends Error {
    constructor(status, body) {
      super(body?.error?.message || 'HTTP ' + status);
      this.status = status;
      this.code = body?.error?.code || 'io_error';
      this.current = body?.error?.current;
    }
  }
  async function call(method, path, body) {
    let r;
    try {
      r = await fetch(path, {
        method,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
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
    update: (id, patch) => call('PATCH', '/api/tasks/' + encodeURIComponent(id), patch),
    remove: (id) => call('DELETE', '/api/tasks/' + encodeURIComponent(id))
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
  function applyTask(id, doc) {
    const i = S.tasks.findIndex((t) => t.id === id);
    if (doc === null) { if (i >= 0) S.tasks.splice(i, 1); }
    else if (i >= 0) S.tasks[i] = doc;
    else S.tasks.push(doc);
    if (S.openId && !S.tasks.some((t) => t.id === S.openId)) S.openId = null;
    render();
  }

  const MESSAGES = {
    offline: 'Sin conexión con el hub: el cambio no se guardó.',
    invalid_file: 'El archivo de la tarea está roto o tiene un conflicto de git: corregilo a mano.',
    not_found: 'La tarea ya no existe.'
  };
  async function write(fn, okMsg) {
    try { await fn(); if (okMsg) toast(okMsg); }
    catch (e) { toast(MESSAGES[e.code] || 'No se pudo guardar (' + (e.message || e.code) + ').'); }
  }
  const updateTask = (id, patch) => write(async () => applyTask(id, await api.update(id, patch)));

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
      onclick: () => openTask(t.id) },
      h('span', { class: 'meta' }, t.code ? h('span', null, t.code) : null, m && S.filter === 'all' ? h('span', { class: 'ms' }, m.code) : null),
      h('span', { class: 't' }, rich(t.title)),
      p.total ? h('span', { class: 'cl' }, h('span', { class: 'bar', role: 'img', 'aria-label': p.done + ' de ' + p.total + ' pasos' }, h('i', { style: 'width:' + pct + '%' })), p.done + '/' + p.total) : null);
  }

  function renderDetail() {
    const box = document.getElementById('detail');
    const t = S.tasks.find((x) => x.id === S.openId);
    if (!t) { box.hidden = true; box.replaceChildren(); return; }
    const m = msById(t.milestone);
    const cl = Array.isArray(t.checklist) ? t.checklist : [];
    const p = clProgress(t);
    const keepFocus = document.activeElement && box.contains(document.activeElement) ? document.activeElement.id : null;
    box.replaceChildren(
      h('div', { class: 'head' }, t.code || '', m ? h('span', null, '· ' + m.code + ' ' + m.title) : null,
        h('button', { class: 'btn ghost close', type: 'button', 'aria-label': 'Cerrar detalle', onclick: closeTask }, 'Cerrar')),
      h('label', { for: 'd-title', class: 'sr' }, 'Título'),
      h('input', { class: 'title', id: 'd-title', value: t.title || '', onchange: (e) => { const v = e.target.value.trim(); if (v && v !== t.title) updateTask(t.id, { title: v }); } }),
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
            h('input', { type: 'checkbox', id, checked: !!c.done, onchange: (e) => { const next = cl.map((x, j) => j === i ? { ...x, done: e.target.checked } : x); updateTask(t.id, { checklist: next }); } }),
            h('label', { for: id }, rich(c.text)),
            h('button', { class: 'rm', type: 'button', 'aria-label': 'Quitar paso', onclick: () => updateTask(t.id, { checklist: cl.filter((_, j) => j !== i) }) }, '×'));
        })) : h('p', { style: 'margin:0;color:var(--muted);font-size:14px' }, 'Sin pasos todavía.'),
        h('form', { class: 'addcl', onsubmit: (e) => { e.preventDefault(); const inp = e.target.querySelector('input'); const v = inp.value.trim(); if (!v) return; inp.value = ''; updateTask(t.id, { checklist: [...cl, { text: v, done: false }] }); } },
          h('label', { for: 'd-addcl', class: 'sr' }, 'Nuevo paso'),
          h('input', { id: 'd-addcl', placeholder: 'Agregar paso', autocomplete: 'off' }),
          h('button', { class: 'btn', type: 'submit' }, 'Agregar'))),
      h('div', { style: 'display:flex;flex-direction:column;gap:6px' },
        h('label', { class: 'label', for: 'd-test' }, 'Cómo probarlo'),
        h('textarea', { id: 'd-test', onchange: (e) => updateTask(t.id, { test: e.target.value }) }, t.test || '')),
      h('div', { style: 'display:flex;flex-direction:column;gap:6px' },
        h('label', { class: 'label', for: 'd-notes' }, 'Notas'),
        h('textarea', { id: 'd-notes', onchange: (e) => updateTask(t.id, { notes: e.target.value }) }, t.notes || '')),
      h('div', { class: 'footer-actions' },
        h('span', null, t.updated_at ? 'Actualizada ' + new Date(t.updated_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : ''),
        S.confirmDelete
          ? h('span', { class: 'confirm' }, '¿Borrar la tarea?',
              h('button', { class: 'btn danger', type: 'button', onclick: () => { const id = t.id; closeTask(); write(async () => { await api.remove(id); applyTask(id, null); }, 'Tarea borrada'); } }, 'Sí, borrar'),
              h('button', { class: 'btn', type: 'button', onclick: () => { S.confirmDelete = false; renderDetail(); } }, 'No'))
          : h('button', { class: 'btn ghost danger', type: 'button', onclick: () => { S.confirmDelete = true; renderDetail(); } }, 'Borrar tarea')));
    box.hidden = false;
    if (keepFocus) { const el = document.getElementById(keepFocus); if (el) el.focus(); }
  }

  function render() { renderMiles(); renderSummary(); renderBoard(); renderDetail(); }

  function setFilter(id) { S.filter = id; pref('filter', id); render(); }
  function openTask(id) { S.openId = id; S.confirmDelete = false; render(); const el = document.getElementById('d-title'); if (el) el.focus(); }
  function closeTask() { S.openId = null; S.confirmDelete = false; render(); }
  function setStatus(id, status) {
    const t = S.tasks.find((x) => x.id === id);
    if (!t || t.status === status) return;
    updateTask(id, { status });
  }

  document.getElementById('new-btn').addEventListener('click', () => {
    const f = document.getElementById('new-form');
    f.hidden = !f.hidden;
    if (!f.hidden) { if (S.filter !== 'all') document.getElementById('new-ms').value = S.filter; document.getElementById('new-title').focus(); }
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
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.openId && !e.defaultPrevented) closeTask(); });

  // Carga inicial desde el hub.
  async function load() {
    try {
      const [config, m, t] = await Promise.all([api.config(), api.milestones(), api.tasks()]);
      S.project = config.project || '';
      S.milestones = m.milestones;
      S.tasks = t.tasks;
      S.warnings = [...m.warnings, ...t.warnings];
      S.offline = false;
      document.getElementById('project').textContent = S.project || 'Scope Compass';
      document.title = S.project && S.project !== 'Scope Compass' ? S.project + ' · Scope Compass' : 'Scope Compass';
      if (S.filter !== 'all' && !S.milestones.some((x) => x.id === S.filter)) S.filter = 'all';
      if (S.openId && !S.tasks.some((x) => x.id === S.openId)) S.openId = null;
    } catch (e) {
      S.offline = true;
    }
    S.loaded = true;
    render();
  }

  render();
  load();
})();
