# web

UI del tablero, sin framework ni build step: `index.html`, `app.css`, `app.js`, `settings.js`, `fonts/` y `frames/`. La sirve el hub (`scompass serve`) en `/`.

Es el port de `../docs/reference/tablero-artifact.html` (spec §7). El CSS y el render son los del artifact; la capa `claude.use("db")` se reemplazó por un cliente de la API del hub (`/api`).

- En vivo por WebSocket, con reconexión; escrituras con etag y recuperación ante `409`.
- Avisa de los archivos de `compass/` que el hub no pudo leer.
- `favicon.svg`: el ícono de la bandeja (`node/compass.svg` de @icons, MIT; ver `hub/assets/icons/`), en el dorado de la interfaz.
- `settings.js` y `frames/`: el botón de Ajustes (tablero e Inicio) y los bordes de fantasía, que se prenden ahí y quedan guardados en el navegador. Los marcos son de Project Epiphany: *Fantasy UI Borders* de Kenney (CC0, `frames/License.txt`), recoloreados; van en 9-slice a tamaño 1:1 y con píxel nítido.
- `fonts/`: Cinzel, Alegreya Sans y JetBrains Mono (subconjunto latino de `@fontsource` 5.3.0, licencias OFL al lado). No hace ninguna petición fuera del hub.
- Cada tarea abierta tiene su ruta (`#task/<id>`): atrás la cierra y vuelve a la vista de antes, y el enlace la abre (spec §24).
- Lo que escribís en el detalle no se pierde cuando se redibuja. Soltar una tarjeta sobre otra del mismo hito la deja antes. Atajos: `N` nueva tarea, `1`–`4` estado de la tarea abierta, `Esc` cierra.
- Tablero o lista (una fila por tarea, ordenable por columna), con filtros por texto, estado, fecha, bloqueo, pasos, referencias, etiquetas, prioridad y responsable (spec §19). Los filtros y la vista se recuerdan por proyecto en el navegador. Atajo: `/` va al buscador.
- Compacta (spec §21): las vistas en la fila del título, los hitos terminados en *Terminados (n)*, los filtros detrás de *Filtros (n)*, el resumen del hito en una línea y, en el detalle, las propiedades en una fila de chips con los pasos arriba. En la lista, fechas relativas y sin columnas vacías. En el teléfono, los hitos en una fila que se desplaza y las columnas también: una por pantalla, deslizando de costado (M16).
- Pestaña Archivos (spec §22): el árbol de lo que git no ignora, con la marca de git; cada archivo con su contenido (código resaltado, markdown o imagen), su diff contra HEAD y su historial; sin archivo elegido, la rama, los cambios y los últimos commits. De lectura.
- Descripción de la tarea (spec §25): en el detalle, debajo del estado y antes de los pasos, qué hay que hacer y por qué. Vacía, el campo se quita.
- Fechas, capturas e historial (spec §26): *Terminada* en el pie del detalle y como columna de la lista; la fecha objetivo del hito en el resumen (*Atrasado* en rojo); *Tamaño* S/M/L en el detalle, la tarjeta, la lista y los filtros; capturas debajo de la descripción (pegar, soltar o *+ Captura*, con visor); *Historial* plegado al final del detalle; y la plantilla de descripción de una etiqueta (`description_templates`).
- Archivos de la tarea (spec §23): en el detalle, cada archivo del repo que cita la tarea lleva a la pestaña Archivos, y se agregan con un buscador; la ficha del archivo muestra las tareas que lo citan.
- Documentos como biblioteca (spec §20): árbol por carpetas con cuántas tareas citan cada uno, búsqueda de texto en todos, ficha con sus tareas y su estado de git, y el diff contra HEAD con las secciones que toca. Se agregan y se quitan sin editar `config.json`. En el teléfono, las tareas de la sección que se lee van fijas abajo (spec §24).
