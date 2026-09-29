# web

UI del tablero, sin framework ni build step: `index.html`, `app.css`, `app.js` y `fonts/`. La sirve el hub (`scompass serve`) en `/`.

Es el port de `../docs/reference/tablero-artifact.html` (spec §7). El CSS y el render son los del artifact; la capa `claude.use("db")` se reemplazó por un cliente de la API del hub (`/api`).

Pendiente en M3: WebSocket (3.3), etag y 409 (3.4), avisos de archivos inválidos (3.5), fuentes locales (3.6; hoy vienen de Google Fonts), mejoras chicas (3.7).
