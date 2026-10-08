# web

UI del tablero, sin framework ni build step: `index.html`, `app.css`, `app.js` y `fonts/`. La sirve el hub (`scompass serve`) en `/`.

Es el port de `../docs/reference/tablero-artifact.html` (spec §7). El CSS y el render son los del artifact; la capa `claude.use("db")` se reemplazó por un cliente de la API del hub (`/api`).

- En vivo por WebSocket, con reconexión; escrituras con etag y recuperación ante `409`.
- Avisa de los archivos de `compass/` que el hub no pudo leer.
- `fonts/`: Cinzel, Alegreya Sans y JetBrains Mono (subconjunto latino de `@fontsource` 5.3.0, licencias OFL al lado). No hace ninguna petición fuera del hub.
- Lo que escribís en el detalle no se pierde cuando se redibuja. Soltar una tarjeta sobre otra del mismo hito la deja antes. Atajos: `N` nueva tarea, `1`–`4` estado de la tarea abierta, `Esc` cierra.
- Tablero o lista (una fila por tarea, ordenable por columna), con filtros por texto, estado, fecha, bloqueo, pasos, referencias, etiquetas, prioridad y responsable (spec §19). Los filtros y la vista se recuerdan por proyecto en el navegador. Atajo: `/` va al buscador.
