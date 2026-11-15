// Vincular teléfono (§49): la página que abre el QR del Inicio. El código viene en el fragmento (#código), que el
// navegador no manda al servidor; se saca de la dirección enseguida, y se canjea con POST /api/devices/pair, que deja
// la cookie del dispositivo.
(function () {
  I18N.dom(document.body);
  const code = decodeURIComponent(location.hash.slice(1));
  history.replaceState(null, '', location.pathname);
  const form = document.getElementById('pair');
  const name = document.getElementById('pair-name');
  const msg = document.getElementById('pair-msg');
  const next = document.getElementById('pair-next');
  const say = (text, cls) => { msg.textContent = text; msg.className = 'pair-msg' + (cls ? ' ' + cls : ''); };
  if (!code) {
    say(T('Falta el código. Abrí la dirección entera que muestra Vincular teléfono en el Inicio de la computadora, o escaneá su QR.'), 'bad');
    return;
  }
  name.value = T('Teléfono');
  form.hidden = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button');
    btn.disabled = true;
    say(T('Vinculando…'));
    try {
      const r = await fetch('/api/devices/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, name: name.value }) });
      const data = await r.json().catch(() => null);
      if (!r.ok) throw new Error(data?.error?.message || 'HTTP ' + r.status);
      form.hidden = true;
      say(T`Listo: ${data.device.name} quedó vinculado. En cada proyecto vas a ver el botón Chat.`, 'ok');
      next.hidden = false;
    } catch (err) {
      btn.disabled = false;
      say(err.message, 'bad');
    }
  });
})();
