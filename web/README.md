# web

UI del tablero, sin framework ni build step: `index.html`, `app.css`, `app.js` y `fonts/`. La sirve el hub (`scompass serve`) en `/`.

Es el port de `../docs/reference/tablero-artifact.html` (spec §7). El CSS y el render son los del artifact; la capa `claude.use("db")` se reemplazó por un cliente de la API del hub (`/api`).

- En vivo por WebSocket, con reconexión; escrituras con etag y recuperación ante `409`.
- Avisa de los archivos de `compass/` que el hub no pudo leer.
- `fonts/`: Cinzel, Alegreya Sans y JetBrains Mono (subconjunto latino de `@fontsource` 5.3.0, licencias OFL al lado). No hace ninguna petición fuera del hub.

Pendiente en M3: mejoras chicas (3.7).
