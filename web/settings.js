// Ajustes de la web (19.16): los bordes de fantasía y el idioma (§45). Se guardan en este navegador (localStorage), no en el
// repo: es una preferencia de quien mira. El tablero y el Inicio cargan este mismo archivo en el <head>, sin defer, así
// la clase está puesta antes de pintar; a través del Inicio (sus /p/…) es el mismo origen y comparten el ajuste.
(function () {
  const KEY = 'scompass.fantasy';
  const get = () => { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } };
  const set = (on) => { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) {} };
  const apply = (on) => document.documentElement.classList.toggle('fantasy', on);
  apply(get());
  // Cambiado en otra pestaña: se sigue acá también.
  addEventListener('storage', (e) => { if (e.key === KEY) apply(get()); });

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
    n.append(...kids);
    return n;
  }

  // Idioma (§45): Automático sigue al navegador. Se guarda para todo el equipo (la CLI, el Inicio y los tableros) con
  // PUT api/lang, relativo a la página: sirve igual en un hub suelto, en el Inicio y en un tablero dentro del Inicio.
  function langField() {
    const sel = el('select', { id: 'set-lang' },
      el('option', { value: '' }, T('Automático (el del navegador)')),
      el('option', { value: 'en' }, 'English'),
      el('option', { value: 'es' }, 'Español'));
    const note = el('span', { class: 'muted small' }, T('Para la web, el Inicio y la terminal de este equipo.'));
    sel.disabled = true;
    fetch('api/lang').then((r) => r.json()).then((x) => {
      sel.value = x.chosen || '';
      if (x.forced) note.textContent = T`Fijado por SCOMPASS_LANG=${x.forced}.`;
      else sel.disabled = false;
    }).catch(() => {});
    sel.addEventListener('change', () => {
      sel.disabled = true;
      fetch('api/lang', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lang: sel.value || null }) })
        .then((r) => { if (r.ok) location.reload(); else sel.disabled = false; })
        .catch(() => { sel.disabled = false; });
    });
    return el('div', { class: 'opt' }, el('label', { for: 'set-lang' }, el('strong', {}, T('Idioma'))), sel, note);
  }

  function open() {
    document.querySelector('dialog.settings')?.remove();
    const box = el('input', { type: 'checkbox', id: 'set-fantasy' });
    box.checked = get();
    box.addEventListener('change', () => { set(box.checked); apply(box.checked); });
    const d = el('dialog', { class: 'pick settings', 'aria-labelledby': 'set-title' },
      el('form', { method: 'dialog' },
        el('h2', { id: 'set-title' }, T('Ajustes')),
        el('label', { class: 'opt', for: 'set-fantasy' }, box,
          el('span', {}, el('strong', {}, T('Bordes de fantasía')), el('br'),
            el('span', { class: 'muted small' }, T('Marcos de pixel art en botones, tarjetas y paneles. Usa siempre el tema oscuro. Se guarda en este navegador.')))),
        langField(),
        el('div', { class: 'row' }, el('button', { class: 'btn', type: 'submit' }, T('Cerrar')))));
    d.addEventListener('close', () => { d.remove(); document.getElementById('settings-btn')?.focus(); });
    document.body.append(d);
    d.showModal();
  }

  document.addEventListener('DOMContentLoaded', () => document.getElementById('settings-btn')?.addEventListener('click', open));
})();
