// Inicio de Scope Compass (spec §16.2, mockups en https://claude.ai/artifact/H842sKGxHz1oGH7qgZhYvY): la franja
// "Hoy" y una tarjeta por proyecto del registro. Los datos vienen de la API del Inicio (hub/src/home.js).
(function () {
  const S = { projects: [], today: [], templates: [], dataDir: '', loaded: false, offline: false, connected: false,
    add: { open: false, mode: 'import', err: '', busy: false }, busy: new Set() };
  const EVERY = { day: 'cada día', week: 'cada semana', month: 'cada mes', year: 'cada año' };
  const TPL_NAMES = { juego: 'Juego', personal: 'Personal', vacio: 'Vacío' };

  class ApiError extends Error {
    constructor(status, body) {
      super(body?.error?.message || 'HTTP ' + status);
      this.status = status;
      this.code = body?.error?.code || 'io_error';
      this.foreign = !!body?.error?.foreign;
    }
  }
  async function call(method, path, body) {
    let r;
    try {
      r = await fetch(path, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
      throw new ApiError(0, { error: { code: 'offline', message: 'sin conexión con el Inicio' } });
    }
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new ApiError(r.status, data);
    return data;
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
  // `código` en los títulos, como en el tablero.
  function rich(str) {
    const frag = document.createDocumentFragment();
    String(str || '').split('`').forEach((part, i) => { if (part) frag.append(i % 2 ? h('code', null, part) : document.createTextNode(part)); });
    return frag;
  }
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 3600);
  }

  // "2026-10-10T17:30" → "10/10 17:30" (con año si no es este).
  function showDue(due) {
    const [d, t] = String(due).split('T');
    const [y, m, day] = d.split('-');
    return `${day}/${m}${Number(y) !== new Date().getFullYear() ? '/' + y : ''}${t ? ' ' + t : ''}`;
  }
  const dueTag = (x) => x.due_state === 'overdue' ? h('span', { class: 'tag overdue' }, 'vencido · ' + showDue(x.due))
    : x.due_state === 'today' ? h('span', { class: 'tag today' }, x.due.includes('T') ? 'hoy ' + x.due.split('T')[1] : 'hoy') : null;
  const hubUrl = (port) => `${location.protocol}//${location.hostname}:${port}/`;
  const liveHub = (path) => S.projects.find((p) => p.path === path)?.hubs?.[0] ?? null;

  async function act(key, fn, okMsg) {
    if (S.busy.has(key)) return;
    S.busy.add(key);
    render();
    try {
      const r = await fn();
      if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg);
    } catch (e) {
      toast(e.code === 'offline' ? 'Sin conexión con el Inicio: no se hizo el cambio.' : e.code === 'conflict' ? 'Ese ítem cambió en otro lado; se actualizó. Probá de nuevo.' : 'No se pudo: ' + e.message);
    } finally {
      S.busy.delete(key);
      await load();
    }
  }

  function renderHoy() {
    const box = document.getElementById('hoy');
    if (!S.loaded) { box.replaceChildren(h('div', { class: 'hoy-empty' }, 'Cargando…')); return; }
    if (!S.today.length) { box.replaceChildren(h('div', { class: 'hoy-empty' }, 'Nada vencido ni para hoy, y nada en curso.')); return; }
    box.replaceChildren(...S.today.map((x, i) => {
      const where = h('span', { class: 'tag' }, x.project.name + (x.kind === 'item' ? ' · ' + x.list_title : ''));
      if (x.kind === 'item') {
        const id = 'hoy-' + i;
        const key = 'item:' + x.project.path + ':' + x.list + ':' + x.n;
        return h('div', { class: 'hoy-row' },
          // Mientras se guarda queda tildado (re-renderizar no lo destilda).
          h('input', { type: 'checkbox', id, disabled: S.busy.has(key), checked: S.busy.has(key),
            onchange: () => act(key, () => call('POST', '/api/projects/check-item', { path: x.project.path, list: x.list, n: x.n, etag: x.etag }),
              (r) => (r.advanced ? `${x.text}: ↻ la próxima vez es el ${showDue(r.list.items[x.n - 1].due)}` : `${x.text}: hecho`)) }),
          h('label', { for: id, class: 'what' }, x.text),
          dueTag(x), x.repeat ? h('span', { class: 'tag' }, '↻ ' + EVERY[x.repeat.every]) : null, where);
      }
      const hub = liveHub(x.project.path);
      const [code, ...rest] = x.text.split(' ');
      const title = /^\d/.test(code) ? h('span', null, h('span', { class: 'code' }, code), rich(rest.join(' '))) : rich(x.text);
      return h('div', { class: 'hoy-row' },
        h('span', { class: 'mark', 'aria-hidden': 'true' }, x.status === 'doing' ? '●' : '○'),
        h('span', { class: 'what' }, hub ? h('a', { href: hubUrl(hub.port) + '#' }, title) : title),
        dueTag(x), x.status === 'doing' ? h('span', { class: 'tag doing' }, 'en curso') : null, where);
    }));
  }

  function hubTag(p) {
    if (!p.found) return h('span', { class: 'tag overdue' }, 'no encontrado');
    if (p.hubs.length) return h('span', { class: 'tag live' }, h('span', { class: 'dot' }), 'hub :' + p.hubs[0].port);
    return h('span', { class: 'tag' }, 'hub apagado · leído de disco');
  }

  function projectCard(p) {
    const s = p.summary;
    const kind = !p.found ? p.path : [p.godot ? 'Godot' : null, p.views?.[0] === 'lists' ? 'Personal' : null].filter(Boolean).join(' · ') || p.path;
    const key = 'hub:' + p.path;
    const head = h('div', { class: 'head' }, h('div', null, h('h3', null, p.name), h('div', { class: 'kind', title: p.path }, kind)), hubTag(p));
    const body = [];
    if (s?.milestone) {
      const m = s.milestone;
      body.push(h('div', { class: 'ms' },
        h('div', { class: 'row' }, h('span', null, h('b', null, m.code), ' · ', rich(m.title)), h('span', { class: 'n' }, m.done + '/' + m.total)),
        h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': m.total, 'aria-valuenow': m.done, 'aria-label': 'Avance de ' + m.code },
          h('i', { style: 'width:' + (m.total ? Math.round(100 * m.done / m.total) : 0) + '%' }))));
    }
    const tasks = [...(s?.doing ?? []).map((t) => ['en curso', t, 'doing']), ...(s?.next ?? []).map((t) => ['sigue', t, ''])].slice(0, 4);
    if (tasks.length) body.push(h('ul', null, tasks.map(([k, t, cls]) => h('li', null, h('span', { class: 'k ' + cls }, k), h('span', { class: 'v' }, t.code ? t.code + ' ' : '', rich(t.title))))));
    if (s?.lists?.length) {
      body.push(h('ul', { class: 'lists' }, s.lists.map((l) => h('li', null, h('span', { class: 'v' }, l.title),
        h('span', null, l.overdue ? h('span', { class: 'tag overdue' }, l.overdue + ' vencido' + (l.overdue > 1 ? 's' : '')) : null, ' ',
          l.today ? h('span', { class: 'tag today' }, l.today + ' hoy') : null, ' ', h('span', { class: 'n' }, l.left ? String(l.left) : '✓'))))));
    }
    if (p.found && !s?.milestone && !s?.lists?.length) body.push(h('p', { class: 'muted', style: 'margin:0' }, 'Sin hitos ni listas todavía.'));
    if (p.warnings) body.push(h('p', { class: 'muted', style: 'margin:0' }, `⚠ ${p.warnings} archivo${p.warnings > 1 ? 's' : ''} con problemas (abrí el tablero para verlos)`));

    if (p.git?.uncommitted) body.push(h('p', { style: 'margin:0' }, h('span', { class: 'tag today', title: 'La app no commitea sola: commiteá compass/ cuando quieras' }, p.git.uncommitted === 1 ? '1 archivo sin commitear' : p.git.uncommitted + ' archivos sin commitear')));
    const foot = h('div', { class: 'foot' });
    if (p.found) {
      if (p.hubs.length) {
        foot.append(h('button', { class: 'btn', type: 'button', disabled: S.busy.has(key), 'aria-label': 'Apagar el hub de ' + p.name, onclick: () => stopHub(p) }, '■ Apagar'));
      } else {
        foot.append(h('button', { class: 'btn', type: 'button', disabled: S.busy.has(key), 'aria-label': 'Prender el hub de ' + p.name,
          onclick: () => act(key, () => call('POST', '/api/projects/start', { path: p.path }), 'Hub prendido') }, S.busy.has(key) ? 'Prendiendo…' : '▶ Prender'));
      }
    }
    foot.append(h('button', { class: 'btn ghost', type: 'button', 'aria-label': 'Quitar ' + p.name + ' del Inicio',
      onclick: () => { if (confirm(`¿Quitar "${p.name}" del Inicio? No se borra nada de la carpeta; se puede volver a agregar.`)) act('rm:' + p.path, () => call('DELETE', '/api/projects?path=' + encodeURIComponent(p.path)), 'Quitado del Inicio'); } }, 'Quitar'));
    foot.append(h('span', { class: 'spacer' }));
    if (p.hubs.length) foot.append(h('a', { href: hubUrl(p.hubs[0].port) }, 'Abrir tablero'));
    return h('article', { class: 'proj' + (p.found ? '' : ' missing'), 'aria-label': p.name }, head, ...body, foot);
  }

  async function stopHub(p) {
    const key = 'hub:' + p.path;
    try {
      await call('POST', '/api/projects/stop', { path: p.path });
      toast('Hub apagado');
    } catch (e) {
      // Uno que abrió el dock: se confirma antes, porque el editor se queda sin hub.
      if (e.foreign && confirm(`${e.message}. ¿Apagarlo igual?`)) return act(key, () => call('POST', '/api/projects/stop', { path: p.path, force: true }), 'Hub apagado');
      if (!e.foreign) toast('No se pudo: ' + e.message);
    }
    await load();
  }

  function renderProjects() {
    const box = document.getElementById('projects');
    if (!S.loaded) { box.replaceChildren(); return; }
    const cards = S.projects.map(projectCard);
    cards.push(h('article', { class: 'proj', style: 'border-style:dashed;align-items:center;justify-content:center;text-align:center;min-height:200px' },
      h('h3', null, 'Agregar proyecto'),
      h('p', { class: 'muted', style: 'margin:0;max-width:300px' }, 'Los proyectos aparecen solos al abrir su hub. También se pueden agregar sin prenderlo, o crear uno nuevo.'),
      h('div', { class: 'foot', style: 'border:0;justify-content:center' },
        h('button', { class: 'btn', type: 'button', onclick: () => openAdd('import') }, 'Importar carpeta…'),
        h('button', { class: 'btn', type: 'button', onclick: () => openAdd('create') }, 'Crear con plantilla'))));
    box.replaceChildren(...cards);
  }

  function openAdd(mode) {
    S.add = { open: true, mode, err: '', busy: false, parent: '', manual: false };
    render();
    document.getElementById('add').scrollIntoView({ block: 'nearest' });
    document.getElementById(mode === 'import' ? 'add-path' : 'new-name')?.focus();
  }
  function closeAdd() { S.add.open = false; render(); document.getElementById('add-btn').focus(); }

  function renderAdd() {
    const box = document.getElementById('add');
    const btn = document.getElementById('add-btn');
    box.hidden = !S.add.open;
    btn.setAttribute('aria-expanded', String(S.add.open));
    if (!S.add.open) return;
    // Se arma una sola vez por apertura: re-renderizar con cada evento borraría lo que se está escribiendo.
    if (box.dataset.mode === S.add.mode && box.firstChild) { box.querySelector('.err').textContent = S.add.err; return; }
    box.dataset.mode = S.add.mode;
    const tab = (mode, label) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(S.add.mode === mode), onclick: () => { box.dataset.mode = ''; S.add.mode = mode; S.add.err = ''; render(); } }, label);
    const submit = async (e, fn) => {
      e.preventDefault();
      S.add.err = '';
      try { await fn(); S.add.open = false; box.dataset.mode = ''; await load(); }
      catch (err) { S.add.err = err.message; render(); }
    };
    let form;
    if (S.add.mode === 'import') {
      form = h('form', { onsubmit: (e) => submit(e, async () => { const r = await call('POST', '/api/projects', { path: document.getElementById('add-path').value.trim() }); toast(r.added ? `Agregado: ${r.project.name}` : `${r.project.name} ya estaba en el Inicio`); }) },
        h('div', { class: 'field' }, h('label', { for: 'add-path' }, 'Carpeta del proyecto (ruta absoluta, con compass/ adentro)'),
          h('input', { type: 'text', id: 'add-path', required: true, placeholder: '/home/…/mi-proyecto', autocomplete: 'off', spellcheck: 'false' })),
        h('p', { class: 'hint' }, 'Se anota sin prender su hub. No se copia ni se cambia nada en la carpeta.'),
        h('p', { class: 'err', role: 'alert' }, S.add.err),
        h('div', { class: 'actions' }, h('button', { class: 'btn ghost', type: 'button', onclick: closeAdd }, 'Cancelar'), h('button', { class: 'btn primary', type: 'submit' }, 'Agregar')));
    } else {
      const tpls = S.templates.length ? S.templates : [{ name: 'vacio', description: '' }];
      // La carpeta es <dónde>/<nombre>; <dónde> es la carpeta de datos del usuario (D28) salvo que se elija otra.
      const where = h('p', { class: 'hint', id: 'new-where' });
      const showWhere = () => {
        const name = document.getElementById('new-name')?.value.trim() || 'Nombre';
        const parent = S.add.parent || S.dataDir;
        where.textContent = parent ? `Se crea en ${parent}/${name}` + (S.add.parent ? '.' : ', con su propio repo de git.') : '';
        const reset = document.getElementById('new-reset');
        if (reset) reset.hidden = !S.add.parent;
      };
      const pick = async () => {
        try {
          const r = await call('POST', '/api/pick-folder', { start: S.add.parent || S.dataDir });
          if (r.path) { S.add.parent = r.path; showWhere(); }
        } catch (e) {
          // Sin selector en el escritorio: se escribe la ruta.
          S.add.manual = true; box.dataset.mode = ''; S.add.err = e.message; render();
        }
      };
      form = h('form', { onsubmit: (e) => submit(e, async () => {
        const template = box.querySelector('input[name="tpl"]:checked')?.value ?? 'vacio';
        const typed = document.getElementById('new-parent')?.value.trim();
        const parent = typed || S.add.parent;
        const r = await call('POST', '/api/projects/init', { name: document.getElementById('new-name').value.trim(), template, ...(parent && { parent }) });
        toast(`Creado: ${r.config.project} (plantilla ${r.template}) en ${r.path}`);
      }) },
        h('div', { class: 'fields' },
          h('div', { class: 'field' }, h('label', { for: 'new-name' }, 'Nombre (también es el nombre de la carpeta)'),
            h('input', { type: 'text', id: 'new-name', required: true, placeholder: 'Vida', autocomplete: 'off', oninput: showWhere }))),
        h('fieldset', { class: 'tpls' }, h('legend', null, 'Plantilla'),
          tpls.map((t, i) => h('label', { class: 'tpl' }, h('input', { type: 'radio', name: 'tpl', value: t.name, checked: i === 0 }), h('span', null, h('b', null, TPL_NAMES[t.name] ?? t.name), t.description)))),
        h('div', { class: 'where-row' }, where,
          S.add.manual ? null : h('button', { class: 'btn', type: 'button', onclick: pick }, 'Elegir otra carpeta…'),
          h('button', { class: 'btn ghost', type: 'button', id: 'new-reset', hidden: true, onclick: () => { S.add.parent = ''; showWhere(); } }, 'Usar la de siempre')),
        S.add.manual ? h('div', { class: 'field' }, h('label', { for: 'new-parent' }, 'Dónde crearla (ruta absoluta de la carpeta que la va a contener)'),
          h('input', { type: 'text', id: 'new-parent', placeholder: S.dataDir || '/home/…', autocomplete: 'off', spellcheck: 'false', 'data-keep': '1' })) : null,
        h('p', { class: 'err', role: 'alert' }, S.add.err),
        h('div', { class: 'actions' }, h('button', { class: 'btn ghost', type: 'button', onclick: closeAdd }, 'Cancelar'), h('button', { class: 'btn primary', type: 'submit' }, 'Crear proyecto')));
    }
    box.replaceChildren(h('h2', null, 'Agregar proyecto'), h('div', { class: 'tabs' }, tab('import', 'Importar carpeta'), tab('create', 'Crear con plantilla')), form);
    document.getElementById('new-name')?.dispatchEvent(new Event('input'));
  }

  function renderConn() {
    document.getElementById('conn').hidden = !(S.loaded && (S.offline || !S.connected));
  }
  function render() {
    document.getElementById('date').textContent = new Date().toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' });
    renderAdd();
    renderHoy();
    renderProjects();
    renderConn();
  }

  // Carga completa. Si llegan eventos mientras carga, se repite.
  let loading = false, again = false;
  async function load() {
    if (loading) { again = true; return; }
    loading = true;
    do {
      again = false;
      try {
        const [p, t, tp] = await Promise.all([call('GET', '/api/projects'), call('GET', '/api/today'), S.templates.length ? { templates: S.templates } : call('GET', '/api/templates')]);
        S.projects = p.projects;
        S.today = t.items;
        S.templates = tp.templates;
        if (tp.data_dir) S.dataDir = tp.data_dir;
        S.offline = false;
      } catch (e) {
        S.offline = true;
        break;
      }
    } while (again);
    loading = false;
    S.loaded = true;
    render();
  }
  // Varios cambios seguidos (tildar, un git pull) se juntan en una sola recarga.
  let pending = null;
  const reload = () => { clearTimeout(pending); pending = setTimeout(load, 150); };

  let retry = 500;
  function connect() {
    const ws = new WebSocket(new URL('/ws', location.href.replace(/^http/, 'ws')));
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'hello') load();
      else if (m.type === 'changed' || m.type === 'hubs' || m.type === 'projects') reload();
    };
    ws.onopen = () => { retry = 500; S.connected = true; renderConn(); };
    ws.onclose = () => { S.connected = false; renderConn(); setTimeout(connect, retry); retry = Math.min(retry * 2, 10000); };
  }

  document.getElementById('add-btn').addEventListener('click', () => (S.add.open ? closeAdd() : openAdd('import')));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.add.open) closeAdd(); });
  // Al pasar la medianoche, "hoy" cambia.
  setInterval(reload, 5 * 60 * 1000);
  render();
  connect();
})();
