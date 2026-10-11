// Ajustes de la web (19.16): por ahora, los bordes de fantasía. Se guardan en este navegador (localStorage), no en el
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

  function open() {
    document.querySelector('dialog.settings')?.remove();
    const box = el('input', { type: 'checkbox', id: 'set-fantasy' });
    box.checked = get();
    box.addEventListener('change', () => { set(box.checked); apply(box.checked); });
    const d = el('dialog', { class: 'pick settings', 'aria-labelledby': 'set-title' },
      el('form', { method: 'dialog' },
        el('h2', { id: 'set-title' }, 'Ajustes'),
        el('label', { class: 'opt', for: 'set-fantasy' }, box,
          el('span', {}, el('strong', {}, 'Bordes de fantasía'), el('br'),
            el('span', { class: 'muted small' }, 'Marcos de pixel art en botones, tarjetas y paneles. Usa siempre el tema oscuro. Se guarda en este navegador.'))),
        el('div', { class: 'row' }, el('button', { class: 'btn', type: 'submit' }, 'Cerrar'))));
    d.addEventListener('close', () => { d.remove(); document.getElementById('settings-btn')?.focus(); });
    document.body.append(d);
    d.showModal();
  }

  document.addEventListener('DOMContentLoaded', () => document.getElementById('settings-btn')?.addEventListener('click', open));
})();
