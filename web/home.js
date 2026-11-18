// Inicio de Scope Compass (spec §16.2): la franja
// "Hoy" y una tarjeta por proyecto del registro. Los datos vienen de la API del Inicio (hub/src/home.js).
(function () {
  const S = { projects: [], today: [], week: [], templates: [], dataDir: '', sep: '/', loaded: false, offline: false, connected: false,
    add: { open: false, mode: 'import', err: '', busy: false }, busy: new Set() };
  const EVERY = { day: T('cada día'), week: T('cada semana'), month: T('cada mes'), year: T('cada año') };
  // repeat con interval (31.6), como repeatLabel de hub/src/dates.js.
  const EVERY_N = { day: (n) => T`cada ${n} días`, week: (n) => T`cada ${n} semanas`, month: (n) => T`cada ${n} meses`, year: (n) => T`cada ${n} años` };
  const repeatLabel = (r) => ((r.interval ?? 1) > 1 ? EVERY_N[r.every](r.interval) : EVERY[r.every]);
  // Fechas con el idioma de la página (§45).
  const LOCALE = I18N.lang === 'es' ? 'es-AR' : 'en-US';
  // Preferencias de quien mira, en este navegador (nunca en compass/); sin almacenamiento, los valores por defecto.
  const pref = (key, value) => {
    try {
      if (value === undefined) return JSON.parse(localStorage.getItem('scompass.home.' + key) ?? 'null');
      localStorage.setItem('scompass.home.' + key, JSON.stringify(value));
    } catch { /* sin localStorage */ }
    return null;
  };
  // En este orden en el formulario; la primera queda elegida (Juego, como antes de que hubiera Sala limpia).
  const TPL_NAMES = { juego: T('Juego'), personal: T('Personal'), vacio: T('Vacío'), 'clean-room': T('Sala limpia') };
  const tplRank = (n) => { const i = Object.keys(TPL_NAMES).indexOf(n); return i < 0 ? 99 : i; };

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
      throw new ApiError(0, { error: { code: 'offline', message: T('sin conexión con el Inicio') } });
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

  // "2026-10-10T17:30" → "10/10 17:30" (con año si no es este; en inglés, mes/día).
  function showDue(due) {
    const [d, t] = String(due).split('T');
    const [y, m, day] = d.split('-');
    const dm = I18N.lang === 'es' ? `${day}/${m}` : `${m}/${day}`;
    return `${dm}${Number(y) !== new Date().getFullYear() ? '/' + y : ''}${t ? ' ' + t : ''}`;
  }
  const dueTag = (x) => x.due_state === 'overdue' ? h('span', { class: 'tag overdue' }, T`vencido · ${showDue(x.due)}`)
    : x.due_state === 'today' ? h('span', { class: 'tag today' }, x.due.includes('T') ? T`hoy ${x.due.split('T')[1]}` : T('hoy'))
    : x.due_state === 'later' && x.due.includes('T') ? h('span', { class: 'tag' }, x.due.split('T')[1]) : null;
  // El tablero de un proyecto vive dentro del Inicio, en /p/<clave>/ (D29).
  const boardUrl = (path) => S.projects.find((p) => p.path === path)?.url ?? null;

  async function act(key, fn, okMsg) {
    if (S.busy.has(key)) return;
    S.busy.add(key);
    render();
    try {
      const r = await fn();
      if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg);
    } catch (e) {
      toast(e.code === 'offline' ? T('Sin conexión con el Inicio: no se hizo el cambio.') : e.code === 'conflict' ? T('Ese ítem cambió en otro lado; se actualizó. Probá de nuevo.') : T`No se pudo: ${e.message}`);
    } finally {
      S.busy.delete(key);
      await load();
    }
  }

  // Las filas de Hoy y de Esta semana. Los worktrees de un repo (23.2) son un proyecto: lo mismo en varios (la misma
  // tarea, el mismo ítem) es una fila sola, la del worktree principal si está ahí, con los worktrees donde aparece si
  // no es en todos.
  function rowsOf(entries) {
    const members = new Map();
    for (const p of S.projects.filter((x) => x.found)) members.set(repoKey(p), (members.get(repoKey(p)) ?? 0) + 1);
    const rows = new Map();
    for (const x of entries) {
      const k = [repoKey(x.project), x.kind, x.kind === 'item' ? [x.list, x.text, x.due].join('\n') : x.kind === 'question' ? [x.id, x.at, x.text].join('\n') : x.id].join('\n');
      const r = rows.get(k);
      if (!r) rows.set(k, { x, in: [x.project.path] });
      else { r.in.push(x.project.path); if (x.project.worktree?.main) r.x = x; }
    }
    for (const r of rows.values()) r.only = members.get(repoKey(r.x.project)) > r.in.length ? r.in.map(folder) : null;
    return [...rows.values()];
  }
  // El área elegida (31.4): una etiqueta de tarea. Los ítems de lista no tienen área: con un filtro puesto no se ven.
  const areaOk = (x) => !S.area || (x.tags ?? []).includes(S.area);
  const urgentState = (x) => x.due_state === 'overdue' || x.due_state === 'today';

  function renderHoy() {
    const box = document.getElementById('hoy');
    if (!S.loaded) { box.replaceChildren(h('div', { class: 'hoy-empty' }, T('Cargando…'))); return; }
    const all = rowsOf(S.today);
    // Dos repos con el mismo nombre: se distinguen por la carpeta (en Hoy y en Esta semana).
    const keys = new Map();
    for (const r of [...all, ...rowsOf(S.week)]) keys.set(r.x.project.name, new Set([...(keys.get(r.x.project.name) ?? []), repoKey(r.x.project)]));
    hoyName = (pr) => (keys.get(pr.name)?.size > 1 ? `${pr.name} · ${folder(pr.path)}` : pr.name);
    if (!all.length) { box.replaceChildren(h('div', { class: 'hoy-empty' }, T('Nada vencido ni para hoy, y nada en curso.'))); return; }
    // 31.1: arriba lo mío (vencido y de hoy, sueltos), después lo que solo está en curso, en un grupo plegable por
    // proyecto (23.1), y al final las preguntas de los agentes, plegadas: con muchas no tapan lo demás.
    const rows = all.filter((r) => areaOk(r.x));
    const mine = rows.filter((r) => r.x.kind !== 'question' && (r.x.kind === 'item' || urgentState(r.x)));
    const questions = rows.filter((r) => r.x.kind === 'question');
    const groups = new Map();
    for (const r of rows.filter((y) => y.x.kind === 'task' && !urgentState(y.x))) {
      const k = repoKey(r.x.project);
      if (!groups.has(k)) groups.set(k, { name: hoyName(r.x.project), rows: [] });
      groups.get(k).rows.push(r);
    }
    const closed = foldedHoy();
    const qOpen = !!pref('questions-open');
    box.replaceChildren(
      ...(mine.length ? mine.map((r, i) => hoyRow(r, 'hoy-' + i, true)) : [h('div', { class: 'hoy-empty' }, S.area ? T`Nada vencido ni para hoy en ${S.area}.` : T('Nada vencido ni para hoy.'))]),
      ...[...groups].map(([k, g]) =>
        h('details', { class: 'hoy-group', open: !closed.has(k) },
          // Con el clic y no con toggle: toggle también salta al crear el grupo abierto, y un render lo pisaría.
          h('summary', { onclick: (e) => { const s = foldedHoy(); e.currentTarget.parentElement.open ? s.add(k) : s.delete(k); foldedHoy(s); } },
            h('span', { class: 'what' }, g.name), h('span', { class: 'tag doing' }, T`${g.rows.length} en curso`)),
          g.rows.map((r, i) => hoyRow(r, null, false)))),
      questions.length ? h('details', { class: 'hoy-group questions', open: qOpen },
        h('summary', { onclick: (e) => pref('questions-open', !e.currentTarget.parentElement.open) },
          h('span', { class: 'what' }, T`Esperan tu respuesta (${questions.length})`), h('span', { class: 'tag ask' }, T('preguntas de los agentes'))),
        questions.map((r) => hoyRow(r, null, true))) : null);
  }

  // Esta semana (31.3): lo que vence en los próximos 7 días, por día.
  function renderWeek() {
    const box = document.getElementById('semana');
    if (!S.loaded) { box.replaceChildren(); return; }
    const rows = rowsOf(S.week).filter((r) => areaOk(r.x));
    if (!rows.length) { box.replaceChildren(h('div', { class: 'hoy-empty' }, S.area ? T`Nada de ${S.area} vence en los próximos 7 días.` : T('Nada vence en los próximos 7 días.'))); return; }
    const days = new Map();
    for (const r of rows) { const d = r.x.due.slice(0, 10); days.set(d, [...(days.get(d) ?? []), r]); }
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    let n = 0;
    box.replaceChildren(...[...days].map(([d, rs]) => {
      const [y, m, day] = d.split('-').map(Number);
      const date = new Date(y, m - 1, day);
      const name = date.toLocaleDateString(LOCALE, { weekday: 'long' }) + (I18N.lang === 'es' ? ` ${day}/${m}` : ` ${m}/${day}`);
      return h('div', { class: 'sem-day' }, h('h3', null, date.getTime() === tomorrow.getTime() ? T`mañana · ${name}` : name), rs.map((r) => hoyRow(r, 'sem-' + n++, true)));
    }));
  }

  // Chips de área (31.4): las etiquetas de las tareas que hay en Hoy y en Esta semana.
  function renderAreas() {
    const box = document.getElementById('areas');
    const tags = [...new Set([...S.today, ...S.week].flatMap((x) => x.tags ?? []))].sort((a, b) => a.localeCompare(b, I18N.lang));
    // Un área guardada que ya no aparece no filtra (y queda guardada, por si vuelve).
    S.area = tags.includes(pref('area')) ? pref('area') : null;
    box.hidden = !tags.length;
    const chip = (tag, label) => h('button', { class: 'chip small', type: 'button', 'aria-pressed': String(S.area === tag),
      onclick: () => { pref('area', tag); render(); } }, label);
    box.replaceChildren(...(tags.length ? [chip(null, T('Todas')), ...tags.map((t) => chip(t, t))] : []));
  }

  // Captura rápida (31.2): las listas de todos los proyectos; por defecto la última usada o "Quiero hacer" de "Vida".
  const normName = (x) => String(x ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  function renderCapture() {
    const form = document.getElementById('capture');
    const sel = document.getElementById('cap-list');
    const groups = S.projects.filter((p) => p.found && p.summary?.lists?.length && !(p.worktree && !p.worktree.main && S.projects.some((q) => q !== p && q.found && repoKey(q) === repoKey(p))));
    form.hidden = !S.loaded || !groups.length;
    const sig = JSON.stringify(groups.map((p) => [p.path, p.name, p.summary.lists.map((l) => [l.id, l.title])]));
    if (sel.dataset.sig === sig) return;
    sel.dataset.sig = sig;
    const value = (path, list) => JSON.stringify([path, list]);
    const opts = groups.flatMap((p) => p.summary.lists.map((l) => value(p.path, l.id)));
    const last = pref('capture');
    const vida = groups.find((p) => normName(p.name) === 'vida');
    const quiero = vida?.summary.lists.find((l) => normName(l.title) === 'quiero hacer');
    const pick = [sel.value, last && value(last.path, last.list), quiero && value(vida.path, quiero.id), vida && value(vida.path, vida.summary.lists[0].id)].find((v) => v && opts.includes(v)) ?? opts[0];
    sel.replaceChildren(...groups.map((p) => h('optgroup', { label: p.name }, p.summary.lists.map((l) => h('option', { value: value(p.path, l.id), selected: value(p.path, l.id) === pick }, l.title)))));
    sel.value = pick;
  }
  function setupCapture() {
    const form = document.getElementById('capture');
    const sel = document.getElementById('cap-list');
    sel.addEventListener('change', () => { const [path, list] = JSON.parse(sel.value); pref('capture', { path, list }); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = form.elements.text.value.trim();
      if (!text || !sel.value) return;
      const [path, list] = JSON.parse(sel.value);
      const due = form.elements.due.value;
      const title = sel.selectedOptions[0]?.textContent ?? list;
      pref('capture', { path, list });
      act('capture', async () => {
        const r = await call('POST', '/api/projects/add-item', { path, list, text, ...(due && { due }) });
        // Solo si se guardó: si falla, el texto queda para reintentar.
        form.elements.text.value = ''; form.elements.due.value = '';
        form.elements.text.focus();
        return r;
      }, T`Anotado en ${title}`);
    });
  }

  // Un repo con varios worktrees se junta por su repo; sin git, cada carpeta es un proyecto.
  const repoKey = (p) => p.worktree?.repo ?? p.path;
  const folder = (path) => path.split(/[\\/]/).pop();
  let hoyName = (pr) => pr.name;
  // Los grupos de Hoy plegados (por repoKey), en este navegador; sin almacenamiento, todos abiertos.
  function foldedHoy(set) {
    try {
      if (set) localStorage.setItem('scompass.home.hoy-folded', JSON.stringify([...set]));
      else return new Set(JSON.parse(localStorage.getItem('scompass.home.hoy-folded') || '[]'));
    } catch { /* sin localStorage */ }
    return set ?? new Set();
  }
  // Una fila de Hoy o de Esta semana (id: el de la casilla de un ítem). Dentro del grupo de su proyecto no repite el
  // proyecto ni "en curso". Lo vencido y lo de hoy van marcados (urgent): solo eso va en dorado (31.5).
  function hoyRow({ x, only }, id, loose) {
    const where = [loose ? h('span', { class: 'tag' }, hoyName(x.project) + (x.kind === 'item' ? ' · ' + x.list_title : '')) : null,
      only ? h('span', { class: 'tag', title: T('Solo en estos worktrees') }, '⎇ ' + only.join(', ')) : null];
    const urgent = urgentState(x) ? ' urgent' : '';
    if (x.kind === 'item') {
      const key = 'item:' + x.project.path + ':' + x.list + ':' + x.n;
      return h('div', { class: 'hoy-row' + urgent },
        // Mientras se guarda queda tildado (re-renderizar no lo destilda).
        h('input', { type: 'checkbox', id, disabled: S.busy.has(key), checked: S.busy.has(key),
          onchange: () => act(key, () => call('POST', '/api/projects/check-item', { path: x.project.path, list: x.list, n: x.n, etag: x.etag }),
            (r) => (r.advanced ? T`${x.text}: ↻ la próxima vez es el ${showDue(r.list.items[x.n - 1].due)}` : T`${x.text}: hecho`)) }),
        h('label', { for: id, class: 'what' }, x.text),
        dueTag(x), x.repeat ? h('span', { class: 'tag' }, '↻ ' + repeatLabel(x.repeat)) : null, where);
    }
    const url = boardUrl(x.project.path);
    // Una pregunta de un agente: lleva a la tarea, donde se responde.
    if (x.kind === 'question') {
      return h('div', { class: 'hoy-row question' },
        h('span', { class: 'mark', 'aria-hidden': 'true' }, '?'),
        h('span', { class: 'what' }, url ? h('a', { href: url + '#task/' + encodeURIComponent(x.id), title: T('Responder en la tarea') }, rich(x.text)) : rich(x.text)),
        h('span', { class: 'tag ask', title: T`Pregunta abierta de la tarea ${x.task}` }, T`pregunta · ${x.task.split(' ')[0]}`), where);
    }
    const [code, ...rest] = x.text.split(' ');
    const title = /^\d/.test(code) ? h('span', null, h('span', { class: 'code' }, code), rich(rest.join(' '))) : rich(x.text);
    return h('div', { class: 'hoy-row' + urgent },
      h('span', { class: 'mark', 'aria-hidden': 'true' }, x.status === 'doing' ? '●' : '○'),
      h('span', { class: 'what' }, url ? h('a', { href: url }, title) : title),
      dueTag(x), loose && x.status === 'doing' ? h('span', { class: 'tag doing' }, T('en curso')) : null, where);
  }

  // Quién sirve el proyecto: el Inicio (lo normal, D29) o un hub suelto (el del dock, `scompass serve`).
  function hubTag(p) {
    if (!p.found) return h('span', { class: 'tag overdue' }, T('no encontrado'));
    if (p.served === 'hub') return h('span', { class: 'tag live', title: T('Lo sirve un hub suelto (el del dock o scompass serve); el Inicio le pasa los pedidos') }, h('span', { class: 'dot' }), T`hub suelto :${p.hubs.find((x) => !x.base)?.port}`);
    if (p.served === 'home') return h('span', { class: 'tag live' }, h('span', { class: 'dot' }), T('abierto'));
    return null;
  }

  // others: los otros worktrees del mismo repo (23.2), que van en la tarjeta del principal.
  function projectCard(p, others = []) {
    const s = p.summary;
    const kind = !p.found ? p.path : [p.godot ? 'Godot' : null, p.views?.[0] === 'lists' ? T('Personal') : null, others.length && p.worktree?.branch].filter(Boolean).join(' · ') || p.path;
    const key = 'hub:' + p.path;
    const head = h('div', { class: 'head' }, h('div', null, h('h3', null, p.name), h('div', { class: 'kind', title: p.path }, kind)), hubTag(p));
    const body = [];
    if (s?.milestone) {
      const m = s.milestone;
      const pct = (n) => (m.total ? Math.round(100 * n / m.total) : 0);
      body.push(h('div', { class: 'ms' },
        h('div', { class: 'row' }, h('span', null, h('b', null, m.code), ' · ', rich(m.title)),
          h('span', null, m.due_state === 'overdue' ? h('span', { class: 'tag overdue', title: T('Fecha objetivo del hito') }, T`atrasado · ${showDue(m.due)}`) : m.due_state === 'today' ? h('span', { class: 'tag today' }, T('objetivo hoy')) : null,
            ' ', h('span', { class: 'n', title: m.review ? T`${m.review} en revisión` : null }, m.done + '/' + m.total))),
        // m.done incluye las de Revisión (m.review), que van en su color al final de la barra.
        h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': m.total, 'aria-valuenow': m.done, 'aria-label': m.review ? T`Avance de ${m.code}, ${m.review} en revisión` : T`Avance de ${m.code}` },
          h('i', { style: 'width:' + pct(m.done - (m.review ?? 0)) + '%' }), m.review ? h('i', { class: 'rev', style: 'width:' + pct(m.review) + '%' }) : null)));
    }
    // Decisiones que esperan (§31): enlace a la vista Decisiones del proyecto.
    const dc = s?.decisions;
    if (dc && dc.open + dc.pending + dc.revert) {
      const parts = [dc.open && (dc.open === 1 ? T('1 pregunta abierta') : T`${dc.open} preguntas abiertas`), dc.pending && T`${dc.pending} sin revisar`, dc.revert && T`${dc.revert} a revertir`].filter(Boolean);
      const text = T`Decisiones: ${parts.join(' · ')}`;
      body.push(h('p', { class: 'decs', style: 'margin:0' }, p.url ? h('a', { href: p.url + '#decisions', class: 'tag ' + (dc.open ? 'ask' : 'today') }, text) : h('span', { class: 'tag today' }, text)));
    }
    if (s?.done_week) body.push(h('p', { class: 'muted week', style: 'margin:0' }, s.done_week === 1 ? T('1 tarea terminada en los últimos 7 días') : T`${s.done_week} tareas terminadas en los últimos 7 días`));
    const tasks = [...(s?.doing ?? []).map((t) => [T('en curso'), t, 'doing']), ...(s?.next ?? []).map((t) => [T('sigue'), t, ''])].slice(0, 4);
    if (tasks.length) body.push(h('ul', null, tasks.map(([k, t, cls]) => h('li', null, h('span', { class: 'k ' + cls }, k), h('span', { class: 'v' }, t.code ? t.code + ' ' : '', rich(t.title))))));
    if (s?.lists?.length) {
      body.push(h('ul', { class: 'lists' }, s.lists.map((l) => h('li', null, h('span', { class: 'v' }, l.title),
        h('span', null, l.overdue ? h('span', { class: 'tag overdue' }, l.overdue > 1 ? T`${l.overdue} vencidos` : T`${l.overdue} vencido`) : null, ' ',
          l.today ? h('span', { class: 'tag today' }, T`${l.today} hoy`) : null, ' ', h('span', { class: 'n' }, l.left ? String(l.left) : '✓'))))));
    }
    if (p.found && !s?.milestone && !s?.lists?.length) body.push(h('p', { class: 'muted', style: 'margin:0' }, T('Sin hitos ni listas todavía.')));
    if (p.outdated?.length) body.push(h('p', { style: 'margin:0', class: 'outdated' },
      h('span', { class: 'tag today', title: p.outdated.map((f) => 'compass/' + f).join('\n') }, p.outdated.length > 1 ? T`compass/ desactualizado (${p.outdated.length} archivos)` : T`compass/ desactualizado (${p.outdated.length} archivo)`), ' ',
      h('button', { class: 'btn small', type: 'button', onclick: () => act('upd:' + p.path, () => call('POST', '/api/projects/update', { path: p.path }), (r) => T`Actualizado: ${r.updated.join(', ')}`) }, T('Actualizar'))));
    if (p.warnings) body.push(h('p', { class: 'muted', style: 'margin:0' }, p.warnings > 1 ? T`⚠ ${p.warnings} archivos con problemas (abrí el tablero para verlos)` : T`⚠ ${p.warnings} archivo con problemas (abrí el tablero para verlos)`));

    if (others.length) {
      body.push(h('div', { class: 'wts' }, h('span', { class: 'k' }, others.length === 1 ? T('1 worktree') : T`${others.length} worktrees`),
        h('ul', null, others.map((w) => h('li', null,
          h('span', { class: 'v', title: w.path }, folder(w.path), w.worktree?.branch ? h('span', { class: 'n' }, ' ' + w.worktree.branch) : null),
          w.doing ? h('span', { class: 'tag doing' }, T`${w.doing} en curso`) : null, hubTag(w),
          w.git?.uncommitted ? h('span', { class: 'tag today', title: T('Archivos del tablero sin commitear en este worktree') }, T`${w.git.uncommitted} sin commitear`) : null,
          h('span', { class: 'acts' }, w.url ? h('a', { href: w.url }, T('Abrir')) : null, removeBtn(w, 'btn ghost small')))))));
    }
    if (p.git?.uncommitted) body.push(h('p', { style: 'margin:0' }, h('span', { class: 'tag today', title: T('La app no commitea sola: commiteá compass/ cuando quieras') }, p.git.uncommitted === 1 ? T('1 archivo sin commitear') : T`${p.git.uncommitted} archivos sin commitear`)));
    const foot = h('div', { class: 'foot' });
    // Solo un hub suelto se apaga desde acá; los proyectos que sirve el Inicio no tienen un proceso propio.
    if (p.found && p.served === 'hub') {
      foot.append(h('button', { class: 'btn', type: 'button', disabled: S.busy.has(key), 'aria-label': T`Apagar el hub suelto de ${p.name}`, onclick: () => stopHub(p) }, T('■ Apagar hub suelto')));
    }
    foot.append(removeBtn(p, 'btn ghost'));
    foot.append(h('span', { class: 'spacer' }));
    if (p.url) foot.append(h('a', { href: p.url, class: 'open' }, T('Abrir tablero')));
    return h('article', { class: 'proj' + (p.found ? '' : ' missing'), 'aria-label': p.name }, head, ...body, foot);
  }

  function removeBtn(p, cls) {
    const label = p.worktree && !p.worktree.main ? `${p.name} (${folder(p.path)})` : p.name;
    return h('button', { class: cls, type: 'button', 'aria-label': T`Quitar ${label} del Inicio`,
      onclick: () => { if (confirm(T`¿Quitar "${label}" del Inicio? No se borra nada de la carpeta; se puede volver a agregar.`)) act('rm:' + p.path, () => call('DELETE', '/api/projects?path=' + encodeURIComponent(p.path)), T('Quitado del Inicio')); } }, T('Quitar'));
  }

  async function stopHub(p) {
    const key = 'hub:' + p.path;
    try {
      await call('POST', '/api/projects/stop', { path: p.path });
      toast(T('Hub apagado'));
    } catch (e) {
      // Uno que abrió el dock: se confirma antes, porque el editor se queda sin hub.
      if (e.foreign && confirm(T`${e.message}. ¿Apagarlo igual?`)) return act(key, () => call('POST', '/api/projects/stop', { path: p.path, force: true }), T('Hub apagado'));
      if (!e.foreign) toast(T`No se pudo: ${e.message}`);
    }
    await load();
  }

  // Actualizar todos (§38): aparece con dos o más proyectos con compass/ de una versión anterior de Scope Compass.
  function renderUpdateAll() {
    const btn = document.getElementById('update-all');
    if (!btn) return;
    const stale = S.projects.filter((p) => p.outdated?.length);
    btn.hidden = !S.loaded || stale.length < 2;
    btn.disabled = S.busy.has('upd:all');
    btn.textContent = T`Actualizar todos (${stale.length})`;
    btn.title = T`Pone al día schema/ y AGENTS.md de:\n${stale.map((p) => p.name).join('\n')}`;
    btn.onclick = () => act('upd:all', () => call('POST', '/api/projects/update-all'),
      (r) => r.updated.length > 1 ? T`Actualizados ${r.updated.length} tableros` : r.updated.length ? T`Actualizado ${r.updated.length} tablero` : T('Ya estaban todos al día'));
  }

  function renderProjects() {
    renderUpdateAll();
    const box = document.getElementById('projects');
    if (!S.loaded) { box.replaceChildren(); return; }
    // Una tarjeta por repo: la del worktree principal (o la primera), con los otros adentro.
    const repos = new Map();
    for (const p of S.projects) { const k = p.found ? repoKey(p) : p.path; repos.set(k, [...(repos.get(k) ?? []), p]); }
    const cards = [...repos.values()].map((ps) => {
      const lead = ps.find((p) => p.worktree?.main) ?? ps[0];
      return projectCard(lead, ps.filter((p) => p !== lead).map((w) => ({ ...w, doing: w.summary?.doing?.length ?? 0 })));
    });
    cards.push(h('article', { class: 'proj', style: 'border-style:dashed;align-items:center;justify-content:center;text-align:center;min-height:200px' },
      h('h3', null, T('Agregar proyecto')),
      h('p', { class: 'muted', style: 'margin:0;max-width:300px' }, T('Los proyectos aparecen solos al abrir su hub. También se pueden agregar sin prenderlo, o crear uno nuevo.')),
      h('div', { class: 'foot', style: 'border:0;justify-content:center' },
        h('button', { class: 'btn', type: 'button', onclick: () => openAdd('import') }, T('Importar carpeta…')),
        h('button', { class: 'btn', type: 'button', onclick: () => openAdd('create') }, T('Crear con plantilla')))));
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
      form = h('form', { onsubmit: (e) => submit(e, async () => { const r = await call('POST', '/api/projects', { path: document.getElementById('add-path').value.trim() }); toast(r.added ? T`Agregado: ${r.project.name}` : T`${r.project.name} ya estaba en el Inicio`); }) },
        h('div', { class: 'field' }, h('label', { for: 'add-path' }, T('Carpeta del proyecto (ruta absoluta, con compass/ adentro)')),
          h('input', { type: 'text', id: 'add-path', required: true, placeholder: T('/home/…/mi-proyecto'), autocomplete: 'off', spellcheck: 'false' })),
        h('p', { class: 'hint' }, T('Se anota sin prender su hub. No se copia ni se cambia nada en la carpeta.')),
        h('p', { class: 'err', role: 'alert' }, S.add.err),
        h('div', { class: 'actions' }, h('button', { class: 'btn ghost', type: 'button', onclick: closeAdd }, T('Cancelar')), h('button', { class: 'btn primary', type: 'submit' }, T('Agregar'))));
    } else {
      const tpls = S.templates.length ? [...S.templates].sort((a, b) => tplRank(a.name) - tplRank(b.name)) : [{ name: 'vacio', description: '' }];
      // La carpeta es <dónde>/<nombre>; <dónde> es la carpeta de datos del usuario (D28) salvo que se elija otra.
      const where = h('p', { class: 'hint', id: 'new-where' });
      const showWhere = () => {
        const name = document.getElementById('new-name')?.value.trim() || T('Nombre');
        const parent = S.add.parent || S.dataDir;
        where.textContent = !parent ? '' : S.add.parent ? T`Se crea en ${parent}${S.sep}${name}.` : T`Se crea en ${parent}${S.sep}${name}, con su propio repo de git.`;
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
        toast(T`Creado: ${r.config.project} (plantilla ${TPL_NAMES[r.template] ?? r.template}) en ${r.path}`);
      }) },
        h('div', { class: 'fields' },
          h('div', { class: 'field' }, h('label', { for: 'new-name' }, T('Nombre (también es el nombre de la carpeta)')),
            h('input', { type: 'text', id: 'new-name', required: true, placeholder: T('Vida'), autocomplete: 'off', oninput: showWhere }))),
        h('fieldset', { class: 'tpls' }, h('legend', null, T('Plantilla')),
          tpls.map((t, i) => h('label', { class: 'tpl' }, h('input', { type: 'radio', name: 'tpl', value: t.name, checked: i === 0 }), h('span', null, h('b', null, TPL_NAMES[t.name] ?? t.name), t.description)))),
        h('div', { class: 'where-row' }, where,
          S.add.manual ? null : h('button', { class: 'btn', type: 'button', onclick: pick }, T('Elegir otra carpeta…')),
          h('button', { class: 'btn ghost', type: 'button', id: 'new-reset', hidden: true, onclick: () => { S.add.parent = ''; showWhere(); } }, T('Usar la de siempre'))),
        S.add.manual ? h('div', { class: 'field' }, h('label', { for: 'new-parent' }, T('Dónde crearla (ruta absoluta de la carpeta que la va a contener)')),
          h('input', { type: 'text', id: 'new-parent', placeholder: S.dataDir || '/home/…', autocomplete: 'off', spellcheck: 'false', 'data-keep': '1' })) : null,
        h('p', { class: 'err', role: 'alert' }, S.add.err),
        h('div', { class: 'actions' }, h('button', { class: 'btn ghost', type: 'button', onclick: closeAdd }, T('Cancelar')), h('button', { class: 'btn primary', type: 'submit' }, T('Crear proyecto'))));
    }
    box.replaceChildren(h('h2', null, T('Agregar proyecto')), h('div', { class: 'tabs' }, tab('import', T('Importar carpeta')), tab('create', T('Crear con plantilla'))), form);
    document.getElementById('new-name')?.dispatchEvent(new Event('input'));
  }

  function renderConn() {
    document.getElementById('conn').hidden = !(S.loaded && (S.offline || !S.connected));
  }
  function render() {
    document.getElementById('date').textContent = new Date().toLocaleDateString(LOCALE, { weekday: 'short', day: 'numeric', month: 'short' });
    renderAdd();
    renderCapture();
    renderAreas();
    renderHoy();
    renderWeek();
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
        S.week = t.week ?? [];
        S.templates = tp.templates;
        if (tp.data_dir) S.dataDir = tp.data_dir;
        if (tp.sep) S.sep = tp.sep;
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
      if (m.type === 'hello') { if (U.reload) { location.reload(); return; } load(); loadUpgrade(); }
      else if (m.type === 'upgrade') loadUpgrade();
      else if (m.type === 'changed' || m.type === 'hubs' || m.type === 'projects') reload();
      else if (m.type === 'devices' && P.dlg) phoneDevices();
    };
    ws.onopen = () => { retry = 500; S.connected = true; renderConn(); };
    ws.onclose = () => { S.connected = false; renderConn(); setTimeout(connect, retry); retry = Math.min(retry * 2, 10000); };
  }

  // Un binario más nuevo (§39, D62), solo en este equipo (desde el teléfono no se instala): Actualizar lo baja y lo pone
  // en lugar del que corre; el Inicio sigue con el anterior hasta Reiniciar, que vuelve en el mismo puerto.
  const U = { state: null, busy: false };
  async function loadUpgrade(force) {
    try { U.state = await call('GET', '/api/upgrade' + (force ? '?force=1' : '')); } catch { U.state = null; }
    renderUpgrade();
  }
  function renderUpgrade() {
    const box = document.getElementById('upgrade');
    const s = U.state;
    if (!LOCAL || !s || (!s.available && !s.installed)) { box.hidden = true; box.replaceChildren(); return; }
    box.hidden = false;
    if (s.installed) {
      box.replaceChildren(h('span', { class: 'what' }, T`Se instaló Scope Compass ${s.installed}. El Inicio sigue con la ${s.current} hasta reiniciarse.`),
        h('button', { class: 'btn small primary', type: 'button', disabled: U.busy, onclick: restartHome }, T('Reiniciar Inicio')));
      return;
    }
    const pre = s.release?.prerelease ? ' (beta)' : '';
    box.replaceChildren(h('span', { class: 'what' }, T`Hay una versión nueva de Scope Compass: ${s.latest}${pre} (esta es la ${s.current}).`),
      s.release?.html_url ? h('a', { class: 'btn small ghost', href: s.release.html_url, target: '_blank', rel: 'noopener' }, T('Qué cambió')) : null,
      h('button', { class: 'btn small primary', type: 'button', disabled: U.busy, onclick: installUpgrade }, U.busy ? T('Bajando…') : T('Actualizar')));
  }
  async function installUpgrade() {
    U.busy = true; renderUpgrade();
    try { U.state = await call('POST', '/api/upgrade'); toast(T`Instalada la ${U.state.installed}`); } catch (e) { toast(T`No se pudo actualizar: ${e.message}`); }
    U.busy = false; renderUpgrade();
  }
  async function restartHome() {
    U.busy = true; renderUpgrade();
    try { await call('POST', '/api/restart'); } catch (e) { toast(T`No se pudo: ${e.message}`); U.busy = false; renderUpgrade(); return; }
    // El WebSocket se corta y se reconecta solo; al volver (hello) la página se recarga con la versión nueva.
    U.reload = true;
  }

  // Vincular teléfono (§49): solo en este equipo. El diálogo muestra el QR con la dirección de la red y el código, el
  // enlace para copiar y los dispositivos vinculados, con Quitar. Se pone al día con el evento devices del WebSocket.
  const LOCAL = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
  const P = { dlg: null, code: null, expired: false, err: '', devices: [], before: null, paired: null, timer: null };
  const when = (iso) => new Date(iso).toLocaleString(LOCALE, { dateStyle: 'short', timeStyle: 'short' });
  async function phoneCode() {
    clearTimeout(P.timer);
    P.paired = null;
    P.expired = false;
    try {
      P.code = await call('POST', '/api/devices/code');
      P.err = '';
      P.before = new Set(P.devices.map((d) => d.id));
      P.timer = setTimeout(() => { P.expired = true; renderPhone(); }, Math.max(0, Date.parse(P.code.expires_at) - Date.now()));
    } catch (e) {
      P.code = null;
      P.err = e.message;
    }
    renderPhone();
  }
  async function phoneDevices() {
    try { P.devices = (await call('GET', '/api/devices')).devices; } catch (e) { P.err = e.message; }
    // Un dispositivo nuevo desde que se mostró el código: se usó.
    const fresh = P.code && P.before && P.devices.find((d) => !P.before.has(d.id));
    if (fresh) { P.paired = fresh; P.code = null; clearTimeout(P.timer); }
    renderPhone();
  }
  function renderPhone() {
    if (!P.dlg) return;
    const kids = [];
    if (P.err) kids.push(h('p', { class: 'phone-err', role: 'alert' }, P.err));
    if (P.paired) {
      kids.push(h('p', { class: 'phone-ok', role: 'status' }, T`Listo: ${P.paired.name} quedó vinculado. Ya puede usar el chat de los proyectos.`),
        h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: phoneCode }, T('Vincular otro'))));
    } else if (P.code && P.expired) {
      kids.push(h('p', { class: 'muted' }, T('El código venció.')),
        h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: phoneCode }, T('Otro código'))));
    } else if (P.code) {
      const qr = h('div', { class: 'phone-qr' });
      qr.innerHTML = QR.svg(P.code.url, { label: T('Código QR con la dirección para vincular el teléfono') });
      const url = h('input', { type: 'text', readonly: true, value: P.code.url, 'aria-label': T('Dirección para abrir en el teléfono'), onfocus: (e) => e.target.select() });
      const time = new Date(P.code.expires_at).toLocaleTimeString(LOCALE, { timeStyle: 'short' });
      kids.push(qr,
        h('p', { class: 'muted small' }, T`Escaneá el código con la cámara del teléfono, conectado a la misma red que este equipo. Vence a las ${time} y sirve una sola vez.`),
        h('div', { class: 'phone-url' }, url, h('button', { class: 'btn small', type: 'button', onclick: (e) => {
          navigator.clipboard?.writeText(P.code.url).then(() => { e.target.textContent = T('Copiado'); }, () => url.select());
        } }, T('Copiar'))));
      if (P.code.urls.length > 1) {
        kids.push(h('details', { class: 'small' }, h('summary', null, T('Otras direcciones de este equipo')),
          h('ul', null, P.code.urls.slice(1).map((u) => h('li', null, h('code', null, u))))));
      }
    }
    kids.push(h('h3', null, T('Dispositivos vinculados')));
    if (!P.devices.length) kids.push(h('p', { class: 'muted' }, T('Ninguno todavía.')));
    else {
      kids.push(h('ul', { class: 'devices' }, P.devices.map((d) => h('li', null,
        h('div', null, h('strong', null, d.name), h('br'), h('span', { class: 'muted small' }, T`Vinculado ${when(d.created_at)} · último uso ${when(d.last_seen)}`)),
        h('button', { class: 'btn small', type: 'button', 'aria-label': T`Quitar ${d.name}`, onclick: async () => {
          try { await call('DELETE', '/api/devices/' + encodeURIComponent(d.id)); } catch (e) { P.err = e.message; }
          phoneDevices();
        } }, T('Quitar'))))));
    }
    P.dlg.querySelector('.phone-body').replaceChildren(...kids);
  }
  function openPhone() {
    P.dlg?.remove();
    P.err = '';
    P.dlg = h('dialog', { class: 'pick phone', 'aria-labelledby': 'phone-t' },
      h('form', { method: 'dialog' },
        h('h2', { id: 'phone-t' }, T('Vincular teléfono')),
        h('p', { class: 'muted small' }, T('El teléfono vinculado puede usar el chat de los proyectos de este equipo, con tu cuenta de Claude. El tablero ya se ve desde la red con --lan.')),
        h('div', { class: 'phone-body' }),
        h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, T('Cerrar')))));
    P.dlg.addEventListener('close', () => { clearTimeout(P.timer); P.dlg.remove(); P.dlg = null; P.code = null; P.paired = null; document.getElementById('phone-btn').focus(); });
    document.body.append(P.dlg);
    P.dlg.showModal();
    phoneDevices().then(phoneCode);
  }
  if (LOCAL) {
    const btn = document.getElementById('phone-btn');
    btn.hidden = false;
    btn.addEventListener('click', openPhone);
  }

  // Los textos fijos de home.html (§45), antes del primer render.
  I18N.dom(document.body);
  setupCapture();
  document.getElementById('add-btn').addEventListener('click', () => (S.add.open ? closeAdd() : openAdd('import')));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.add.open) closeAdd(); });
  // Al pasar la medianoche, "hoy" cambia.
  setInterval(reload, 5 * 60 * 1000);
  render();
  connect();
})();
