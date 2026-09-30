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
    // Pasos: detalles desplegados y el paso en edición ("tarea:índice").
    stepsOpen: new Set(), editStep: null };
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
    remove: (id, etag) => call('DELETE', '/api/tasks/' + encodeURIComponent(id), undefined, etag),
    docs: () => call('GET', '/api/docs'),
    doc: (alias) => call('GET', '/api/docs/' + encodeURIComponent(alias)),
    section: (alias, id) => call('GET', '/api/docs/' + encodeURIComponent(alias) + '/sections/' + encodeURIComponent(id))
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
      h('span', { class: 't' }, rich(t.title, true)),
      refsOf(t).length ? h('span', { class: 'refmark' + (brokenRefs(t).length ? ' bad' : ''), title: brokenRefs(t).length ? 'Tiene referencias rotas' : refsOf(t).length + ' referencias a documentos' },
        brokenRefs(t).length ? '⚠ ' : '§ ', refsOf(t).length) : null,
      p.total ? h('span', { class: 'cl' }, h('span', { class: 'bar', role: 'img', 'aria-label': p.done + ' de ' + p.total + ' pasos' }, h('i', { style: 'width:' + pct + '%' })), p.done + '/' + p.total) : null);
  }

  // Campos editables del detalle. Cada uno guarda en data-orig el valor con el que se dibujó:
  // si el usuario lo cambió y todavía no lo guardó, el valor escrito se conserva al redibujar.
  const EDITABLE = ['d-title', 'd-addcl', 'd-refq', 'd-step-text', 'd-step-detail', 'd-test', 'd-notes'];
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
      h('div', { style: 'display:flex;flex-direction:column;gap:6px' },
        h('span', { class: 'label' }, 'Pasos ' + (p.total ? '(' + p.done + '/' + p.total + ')' : '')),
        cl.length ? h('ul', { class: 'checklist' }, cl.map((c, i) => stepItem(t, c, i))) : h('p', { style: 'margin:0;color:var(--muted);font-size:14px' }, 'Sin pasos todavía.'),
        h('form', { class: 'addcl', onsubmit: (e) => { e.preventDefault(); const inp = e.target.querySelector('input'); const v = inp.value.trim(); if (!v) return; inp.value = ''; updateTask(t.id, (cur) => ({ checklist: [...checklistOf(cur), { text: v, done: false }] })); } },
          h('label', { for: 'd-addcl', class: 'sr' }, 'Nuevo paso'),
          h('input', { id: 'd-addcl', placeholder: 'Agregar paso', autocomplete: 'off', 'data-orig': '' }),
          h('button', { class: 'btn', type: 'submit' }, 'Agregar'))),
      renderRefs(t),
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
              h('span', { class: 'dot', style: 'background:' + STATUSES.find((x) => x.id === t.status).color }), t.code ? h('span', { class: 'code' }, t.code) : null, rich(t.title))),
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
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast('Copiado: ' + text); } catch (e) { toast(text); }
  }

  function render() {
    renderMiles(); renderSummary(); renderWarnings(); renderBoard(); renderDetail(); renderDocs(); renderConn();
    // La vista se aplica al final: renderSummary muestra su caja por su cuenta.
    const docsView = S.view === 'docs';
    for (const id of ['miles', 'summary', 'board', 'new-btn']) document.getElementById(id).hidden = docsView;
    if (docsView) document.getElementById('new-form').hidden = true;
    document.getElementById('docs').hidden = !docsView;
    document.getElementById('tab-board').setAttribute('aria-current', docsView ? 'false' : 'page');
    document.getElementById('tab-docs').setAttribute('aria-current', docsView ? 'page' : 'false');
  }

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
        const [config, m, t, d] = await Promise.all([api.config(), api.milestones(), api.tasks(), api.docs().catch(() => ({ docs: [] }))]);
        S.docs = d.docs;
        sectionCache.clear();
        docCache.clear();
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
    if (m.type === 'doc_changed') { docChanged(m.alias); return; }
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

  readHash();
  window.addEventListener('hashchange', () => { readHash(); render(); scrollToSection(); });
  render();
  connect();
  // Si el WebSocket no conecta, igual se intenta la carga (muestra el aviso de hub caído).
  setTimeout(() => { if (!S.loaded) load(); }, 1500);
})();
