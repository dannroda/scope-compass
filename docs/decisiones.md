# Decisiones

Registro de las decisiones de diseño de Scope Compass: qué se decidió, por qué y qué se descartó. El detalle técnico está en `spec.md`; acá queda el razonamiento para no volver a discutir lo mismo.

Formato: una entrada por decisión, la más reciente al final. Si una decisión cambia, se agrega una entrada nueva que la reemplaza (no se edita la vieja).

---

## D1 · Los datos viven en git; la app es opcional
**2026-09-29 · vigente** · spec §1, §4.4

Las tareas son archivos dentro del repo del proyecto. Si la app no existe, está rota o no está instalada, todo se puede leer, editar y versionar con git y un editor de texto.

- **Por qué:** el tablero no puede ser la única copia de nada, y el historial lo da git gratis.
- **Descartado:** base de datos (SQLite o similar). Sería una copia que git no ve bien, y en modo hosteado podría quedar como única copia.

## D2 · Un archivo JSON por hito y por tarea, en formato canónico
**2026-09-29 · vigente** · spec §4.1

2 espacios, claves ordenadas, UTF-8, salto de línea final. La app reescribe en ese formato sin cambiar el contenido.

- **Por qué:** mover una tarjeta cambia un solo archivo y el diff es mínimo; dos ramas que tocan tareas distintas no chocan.
- **Descartado:** un único archivo con todo el tablero (conflictos de merge constantes).

## D3 · Concurrencia por ETag (hash del contenido), sin número de versión en los archivos
**2026-09-29 · vigente** · spec §4.2, §5.3

- **Por qué:** una edición a mano o un merge de git no tienen que acordarse de incrementar un campo, y ese campo no genera conflictos en cada cambio.
- **Descartado:** `version` entero guardado en el archivo (era el diseño inicial, copiado del artifact).

## D4 · Stack: Node (Fastify) + UI web sin build step
**2026-09-29 · vigente** · spec §1.1, §3

Hub en Node con API REST y WebSocket; la UI es el código del artifact portado; la CLI `scompass` es la interfaz para agentes y scripts.

- **Por qué:** la UI del artifact ya existe y funciona en el navegador; el teléfono es requisito (§12) y una web liviana carga bien ahí; el markdown del GDD tiene librerías maduras.
- **Mantenimiento desde Godot:** el repo es un proyecto de Godot (D9) y los `.js`, `.html` y `.css` se editan como texto desde el editor.
- **Descartado por ahora: todo en Godot.** Un addon `core` en GDScript (modelo, store, parser de markdown), un hub con `TCPServer` + `WebSocketPeer.accept_stream()`, y las mismas escenas de UI en el dock, en una app de escritorio y en un export web. Tiene a favor una sola herramienta y lenguaje, y la integración con el editor como centro. En contra:
  - el export web pesa decenas de MB y carga lento en el teléfono;
  - el texto lo dibuja el engine: no se selecciona ni se busca como en un navegador, y la accesibilidad es peor;
  - el visor de markdown hay que construirlo (BBCode en `RichTextLabel`, `CodeEdit` para bloques de código, y `GDScriptSyntaxHighlighter` solo existe en el editor);
  - una web publicada conectándose a `ws://127.0.0.1` depende de permisos del navegador (Chrome está sumando un permiso de acceso a la red local), sin verificar.
- **Se reabre si** el teléfono deja de ser requisito.

## D5 · WebSocket para tiempo real (no SSE)
**2026-09-29 · vigente** · spec §5.5

- **Por qué:** lo hablan igual el navegador y Godot (`WebSocketPeer`). SSE es más simple para el navegador, pero en Godot habría que parsear el stream a mano con `HTTPClient`.

## D6 · Carpeta de datos `compass/`, visible, con `.gdignore`
**2026-09-29 · vigente** · spec §4.1

- **Por qué:** se ve en el explorador y en git sin configurar nada; el `.gdignore` evita que Godot la escanee.
- **Reemplaza:** `.tablero/` (carpeta oculta), el nombre provisorio de la primera versión del spec.
- **Consecuencia:** el dock de Godot la lee por ruta con `FileAccess`, no desde el FileSystem del editor.

## D7 · Referencias a documentos por id estable de sección
**2026-09-29 · vigente** · spec §10.1

Cada sección referenciable lleva `<!-- id: nombre -->` debajo del título. Las tareas guardan `refs: [{doc, section}]`.

- **Por qué:** "§11.3" cambia al insertar una sección y el título se renombra; el comentario es invisible en cualquier visor.
- **Estado:** `project-epiphany/gdd.md` ya tiene sus 28 ids estampados, y sus tareas de M0 ya tienen `refs`.

## D8 · Orden: v1 local → v1.5 dock de Godot → v2 documentos → hosting
**2026-09-29 · vigente** · spec §2, §11, §12

- **Por qué:** el valor inmediato es dejar de depender del artifact; el dock pone las tareas donde se trabaja; los documentos y el hosting suman menos y cuestan más.
- **Regla:** ningún módulo de la visión (§11) entra antes de que v1 se use a diario.

## D9 · Repo propio, hermano de los proyectos, abrible en Godot
**2026-09-29 · vigente** · spec §9

`dannroda/scope-compass`, clonado en `../scope-compass`. Tiene `project.godot` para editarlo desde el editor y desarrollar el addon ahí mismo.

- **Nombre:** Scope Compass (CLI `scompass`). Reemplaza el provisorio "tablero".
- **Consecuencia:** `hub/node_modules` necesita `.gdignore` (lo crea el `postinstall`).

## D10 · Licencia MIT
**2026-09-29 · vigente** · `LICENSE`

- **Por qué:** es corta y permisiva. Cualquiera puede usar Scope Compass en sus propios proyectos de Godot sin trámites.
- **Descartado:** repo privado sin licencia (`UNLICENSED`) y Apache-2.0 (más larga, sin una ventaja concreta para una herramienta local).

## D11 · Node 22 como versión mínima
**2026-09-29 · vigente** · `hub/package.json › engines`

- **Por qué:** es la versión instalada hoy y trae todo lo que v1 necesita: `node --test`, `fs.watch` recursivo y `fetch`. Tiene mantenimiento hasta abril de 2027. Es un mínimo, así que 24 también sirve.
- **Descartado:** exigir 24, que era la propuesta del spec: obligaba a actualizar antes de M1 sin necesitar nada de lo que agrega.

## D12 · Hitos: solo CLI en v1
**2026-09-29 · vigente** · spec §2

La UI muestra los hitos (pestañas, objetivo, "hecho cuando") pero no los edita. Se editan con `scompass milestone set` o a mano.

- **Por qué:** los hitos cambian poco, y dejar el formulario afuera acorta M3.
- **Revisar:** si en el uso diario (M4) editar hitos por CLI resulta molesto.

## D13 · Export markdown automático, desactivable
**2026-09-29 · vigente** · spec §6

Después de cada escritura, desde la CLI o desde el hub, se regenera `export_md`. Se desactiva con `"auto_export_md": false` en `config.json`; por defecto está activado.

- **Por qué:** `docs/tareas.md` nunca queda desfasado respecto de `compass/`, y quien lea el repo sin la app ve el estado real.
- **Costo aceptado:** cada cambio también toca `docs/tareas.md` en el diff.
- **Descartado:** solo a pedido (`scompass export md`), porque es fácil olvidarlo.

## D14 · Validación con ajv
**2026-09-29 · vigente** · spec §4.3 · `hub/src/schema.js`

`ajv` (draft 2020-12) + `ajv-formats` para `date-time` y `uri`. Son las primeras dependencias del hub.

- **Por qué:** es el validador de JSON Schema de referencia en Node, soporta 2020-12 completo y compila cada schema una sola vez. `strict: true` hace que un error en los propios schemas se note al arrancar.
- **Descartado:** validar a mano, porque duplicaría los schemas en código y se desincronizaría, y otras librerías más chicas con soporte parcial de 2020-12.
- **Detalle:** `npm install <paquete>` no corre el `postinstall` del proyecto. Después de agregar una dependencia hay que correr `npm install` sin argumentos para que se cree `node_modules/.gdignore`.

## D15 · Linux primero
**2026-09-29 · reemplazada por D30** · spec §14

v1 se desarrolla y se prueba solo en Linux. Windows no se prueba ni bloquea ningún hito.

- **Por qué:** es la única plataforma en uso hoy. Probar Windows sin usarlo cuesta tiempo (CI, rutas, fin de línea) sin que nadie se beneficie.
- **Se mantiene igual:** nada de lo que se escribe asume Linux a propósito (rutas con `node:path`, ids válidos como nombre de archivo en Windows, sin comandos del sistema), así que portar después debería ser barato.
- **Revisar:** cuando alguien lo use en Windows, o al hacer el hosting (M7).

## D16 · El tablero de Scope Compass vive en `compass/`
**2026-09-29 · vigente** · spec §8 · reemplaza el uso del artifact

Migrado con `scompass import artifact` desde el último export del artifact: 8 hitos y 13 tareas, todos sin cambios respecto de `compass/`. Se quitó `board_url` de `compass/config.json`.

- **Por qué:** M1 cerrado, la CLI ya alcanza para trabajar el tablero, y usar la herramienta en su propio desarrollo es la mejor forma de encontrar lo que falta antes de migrar Epiphany (M4).
- **Costo aceptado:** hasta M3 no hay UI; el tablero se ve en `docs/tareas.md` o con `scompass list`.
- **El artifact** queda archivado y sin sincronización. No se borra: tiene el historial de antes de la migración.

## D17 · Hub con Fastify y @fastify/websocket
**2026-09-29 · vigente** · spec §5 · `hub/src/server.js`

- **Por qué:** Fastify valida y serializa rápido, tiene `inject` para testear sin abrir puertos, y `@fastify/websocket` comparte el mismo servidor y puerto para `/ws`. Lo proponía D4.
- **Descartado:** `node:http` a mano (router, errores y WebSocket propios) y Express (sin `inject`, WebSocket aparte).
- **Detalle:** el hub escucha siempre en `127.0.0.1`; `createServer` acepta un `token` para el hosting (§12), que en local no se usa.

## D18 · Tests de la UI con Playwright
**2026-09-29 · vigente** · spec §14 · `hub/package.json › devDependencies`

- **Por qué:** los criterios de v1 que faltan son de navegador: dos pestañas sincronizadas en menos de 1 s, arrastrar tarjetas, claro y oscuro, pantalla angosta y sin internet. Con un navegador real se prueban tal como están escritos.
- **Costo aceptado:** Chromium sin ventana (unos 150 MB, se descarga una vez). Es solo de desarrollo; quien usa la app no lo necesita.
- **Descartado:** testear solo la lógica en Node y lo visual a mano. Es más liviano, pero deja sin probar justo lo que falta.

## D19 · El dock usa `EditorDock` (API de docks de Godot 4.8)
**2026-09-29 · vigente** · spec §11.1 · `addons/scope_compass/`

Godot 4.8 agrega la clase `EditorDock` con `EditorPlugin.add_dock()` / `remove_dock()`; `add_control_to_dock()` sigue existiendo. El dock usa la API nueva.

- **Por qué:** es la API de docks de la versión que usa el proyecto (4.8-dev6) y trae título, ícono, ranura por defecto y layout guardado. Se verificó con un proyecto descartable en el editor sin ventana: el dock queda en el panel lateral y se quita limpio.
- **Riesgo:** 4.8 todavía es dev; si la API cambia antes de la versión estable, el cambio queda en `scope_compass.gd`. La vista del dock es un `Control` aparte que no depende de `EditorDock`.
- **Descartado:** `add_control_to_dock()`, la API vieja.

## D20 · Bandeja del sistema por D-Bus con `@homebridge/dbus-native`
**2026-09-29 · vigente** · `hub/src/tray.js`

`scompass serve --tray` pone un ícono en la bandeja (StatusNotifierItem + menú `com.canonical.dbusmenu`), el mecanismo nativo de KDE Plasma. Lo usa el dock cuando el hub tiene que seguir corriendo al cerrar el editor (`scope_compass/keep_hub_running`).

- **Por qué:** JavaScript puro dentro del hub, sin binarios nativos ni otro lenguaje en tiempo de ejecución; se prueba en un bus D-Bus privado sin tocar la bandeja real.
- **Descartado:** `dbus-next` (abandonado desde 2022; trae `node-gyp`/`request` con avisos críticos sin arreglo). PySide6 con `QSystemTrayIcon` queda como alternativa si el menú por D-Bus da problemas: está instalado en el sistema, pero sería un segundo proceso en Python.
- **Límite:** en escritorios sin StatusNotifierWatcher (GNOME sin la extensión AppIndicator) no hay ícono; el hub avisa y sigue funcionando.

## D21 · Documentos renderizados en el hub con markdown-it + Prism
**2026-09-29 · vigente** · spec §10.4 · `hub/src/render.js`

- **Por qué:** Prism trae GDScript (y JSON, bash, GLSL…); markdown-it es el estándar en Node y con `html: false` muestra como texto cualquier HTML del documento (nada de `<script>`). Las dos salen con 0 avisos de `npm audit` y 11 paquetes en total. Renderizar en el hub deja la UI sin paso de build y permite que el dock pida la misma sección en BBCode.
- **Detalle:** los comentarios `<!-- id: … -->` se quitan antes de renderizar; cada título recibe `id="sec-<id>"` para enlazar desde el índice y las referencias.
- **Descartado:** highlight.js (GDScript no viene incluido) y Shiki (gramáticas de VS Code, mucho más pesado).

## D22 · Vínculos entre tareas: `links` en la tarea que bloquea, inverso calculado
**2026-10-01 · vigente** · spec §4.2 · `hub/src/links.js`

- **Qué:** cada tarea puede tener `links: [{ type, task }]` con `type` `blocks` (esta tarea bloquea a `task`) o `related`. "Bloqueada por" no se guarda: la CLI, la web y el dock lo calculan recorriendo las demás tareas.
- **Por qué:** guardar el vínculo en un solo lado evita que los dos archivos queden desincronizados tras una edición a mano o un merge de git. El tablero es chico: calcular el inverso es recorrer todas las tareas.
- **Reglas:** entre dos tareas hay a lo sumo un vínculo (agregar otro lo reemplaza); una tarea no se vincula consigo misma; un `blocks` que cerraría un ciclo se rechaza (CLI y web). Una tarea está **bloqueada** si la bloquea alguna tarea sin terminar y ella misma no está hecha: se marca en la lista de la CLI, en la tarjeta de la web y en el dock.
- **Límites:** la API valida la forma de `links` (JSON Schema), no que la otra tarea exista ni los ciclos; eso lo cuidan la CLI y la web. Un vínculo a una tarea borrada queda roto: se muestra como tal y `scompass link list` lo avisa y sale con 1. El dock los muestra y permite ir a la otra tarea, pero no los edita.
- **Descartado:** guardar los dos sentidos en ambas tareas (dos escrituras por vínculo y posibles inconsistencias) y un archivo aparte de vínculos (otra colección que versionar y validar).

## D23 · Registro persistente de proyectos en `~/.config/scope-compass/projects.json`
**2026-10-04 · vigente** · spec §16.1

Además del registro de hubs vivos (en `$XDG_RUNTIME_DIR`, se borra al reiniciar), un archivo persistente lista los proyectos que se abrieron o se importaron en el equipo. `scompass serve` se anota solo; `scompass home add` importa sin levantar el hub.

- **Por qué:** el Inicio tiene que conocer los proyectos aunque su hub esté apagado, y poder prenderlos. Un archivo en la carpeta de config del sistema se ve, se edita a mano y no vive en ningún repo. Linux primero (D15): `$XDG_CONFIG_HOME`, por defecto `~/.config`.
- **Regla:** el registro solo tiene rutas y nombres. Borrarlo no pierde datos: todo sigue en cada `compass/`.
- **Descartado:** escanear carpetas buscando `compass/` (lento e impredecible) y guardar la lista en un repo (es del equipo, no de un proyecto).

## D24 · El Inicio es un proceso aparte, `scompass home`; los hubs siguen siendo uno por proyecto
**2026-10-04 · vigente** · spec §16.2, §16.3

- **Qué:** `scompass home` lee los proyectos conocidos de disco, habla con los hubs vivos (WebSocket para cambios, API para escrituras) y puede prenderlos (como hijos suyos) y apagarlos (`SIGTERM`). Si corre con `--tray`, es el único ícono de la bandeja y los hubs se agrupan en su menú.
- **Por qué:** cada `compass/` es individual y el modelo de un hub por proyecto (registro, puertos, dock) ya funciona. El Inicio reutiliza el Store y la lógica de la CLI sin cambiarlo. Agrupar la bandeja evita un ícono por proyecto.
- **Descartado:** un solo hub con varios proyectos. Es más simple de usar, pero rompe el modelo actual, el registro y el dock. Se puede reconsiderar con el mirror always-on (§12), donde un servidor con todos los proyectos es más natural.

## D25 · Las listas y las vistas son de la base; un proyecto personal es una plantilla
**2026-10-04 · vigente** · spec §16.4, §16.6

- **Qué:** `compass/lists/<id>.json` existe en cualquier proyecto. `config.json › views` elige las pestañas y la que abre. `scompass init --template juego|personal|vacio` arma la config y los datos iniciales.
- **Por qué:** "Vida" es un hub normal, solo con otra configuración. Si las funciones fueran por tipo de proyecto, un proyecto de juego no podría tener una lista de assets ni uno personal un tablero. Una plantilla sin código propio no se desincroniza de la base.
- **Detalle:** la plantilla personal crea un hito "General" en vez de hacer opcionales los hitos: el schema de tareas no cambia.
- **Descartado:** listas como tareas sin hito (mezcla dos modelos en un schema) y un tipo de hub "personal" con código propio.

## D26 · Fechas: `created_at` y `due`; repetición simple solo en ítems de lista
**2026-10-04 · vigente** · spec §16.5

- **Qué:** `due` opcional (`YYYY-MM-DD` o con `THH:MM`, hora local) en tareas e ítems. `repeat: { every: day|week|month|year }` solo en ítems, con `due`. Tildar uno que se repite avanza `due` desde la fecha límite (31/01 mensual → 28/02).
- **Por qué:** de las fechas, solo importan cuándo se creó algo y para cuándo hay que tenerlo. Avanzar desde la fecha límite mantiene los vencimientos fijos (la luz vence el 10 aunque se pague el 12). `{ every }` deja lugar para `interval` (cada x días) sin migrar.
- **Descartado por ahora:** fecha de inicio, repetición personalizada y notificaciones (requieren coordinar todos los procesos).

## D27 · Ids de tareas legibles: `m<N>-<NN>` con el siguiente número del hito
**2026-10-04 · vigente** · spec §4.2 · `hub/src/store/json-files.js` (`taskIdFor`) · reemplaza el id aleatorio de §4.2

- **Qué:** una tarea nueva en `m05` recibe `m5-12` (el número más alto del hito + 1), igual que las importadas. El Store lo calcula dentro de su cola, así que la CLI, la web, el dock y el Inicio dan el mismo resultado. Un hito con otro tipo de id sigue usando uno aleatorio de 8 caracteres.
- **Por qué:** salió del primer uso en Epiphany (4.2): con ids al azar (`tagr1kge`) las tareas nuevas se leían mal en git y en la CLI al lado de las importadas (`m0-03`).
- **Costo aceptado:** dos ramas que crean una tarea en el mismo hito a la vez generan el mismo nombre de archivo y git lo marca como conflicto add/add; se resuelve renombrando una. Con un solo usuario trabajando en una rama a la vez es raro. Las tareas que ya tienen id aleatorio no se renombran (cambiaría su historial en git y las referencias).
- **Descartado:** renumerar ids al mover una tarea de hito (rompe `links`, referencias e historial).

## D28 · Los proyectos que se crean desde el Inicio van, por defecto, a la carpeta de datos del usuario
**2026-10-04 · vigente** · spec §16.2 · `hub/src/projects.js` (`projectsDataDir`, `folderName`), `hub/src/home.js`

- **Qué:** "Crear con plantilla" pide el nombre y la plantilla. El nombre es también el de la carpeta, tal cual: "Vida" queda en `$XDG_DATA_HOME/scope-compass/Vida` (`~/.local/share/scope-compass/Vida`, el equivalente de AppData en Linux). "Elegir otra carpeta…" abre el selector de carpetas del escritorio y el proyecto queda en `<elegida>/<nombre>`.
- **Por qué:** un proyecto personal no tiene una carpeta natural; pedir una ruta absoluta era fricción sin valor.
- **Selector:** el navegador no le da rutas al servidor, así que el diálogo lo abre el Inicio (kdialog en Plasma, zenity si no está). Sin ninguno, la página pide la ruta escrita.
- **Una carpeta que ya existe no se usa** (`409`): con el nombre como carpeta, sumarle `-2` daría un nombre que nadie eligió.
- **Git:** una carpeta nueva fuera de todo repo recibe `git init` (sin remoto ni commits), así los datos siguen en git (D1) y el aviso de cambios sin commitear funciona desde el principio. Dentro de un repo existente no se crea otro.
- **Descartado:** guardarlos en `~/.config` (es para configuración, no datos), o un slug del nombre como carpeta.

## D29 · Con el Inicio corriendo, el Inicio sirve los proyectos (multi-hub)
**2026-10-04 · vigente** · spec §17 · reemplaza la parte de D24 que pedía un hub aparte por proyecto con el Inicio

- **Qué:** el Inicio monta el servidor del hub de cada proyecto bajo `/p/<clave>/`, en su mismo proceso y puerto, y lo activa al primer pedido. Sin Inicio, el hub suelto (`scompass serve`, el dock) sigue como siempre.
- **Por qué:** el Inicio tiene que sentirse como una app: el tablero en otro puerto recargaba todo de cero, y prender un hub aparte agregaba una espera. Un proceso con todos los proyectos también es lo que necesita el mirror always-on (M7).
- **Regla:** un solo proceso escribe cada `compass/`. El registro de hubs dice quién sirve cada proyecto (un hub suelto, o el Inicio con `base`). Si hay un hub suelto, el Inicio le reenvía los pedidos.
- **Costo aceptado:** si el Inicio se cae, se caen todos sus proyectos a la vez (los datos están en disco y en git). El dock y la CLI aprenden a usar la `base` del registro.
- **Descartado:** el Inicio como proxy de hubs separados (cada proyecto seguía siendo un proceso y había que esperar que arrancara), y sacarles el puerto TCP a los hubs (Godot no se conecta a sockets locales).

## D30 · Linux es la plataforma principal; Windows, la segunda
**2026-10-06 · vigente** · spec §18 · reemplaza a D15

Se desarrolla en Linux y para Linux, pero Scope Compass tiene que funcionar en Windows: hay días en que el equipo arranca en Windows, y ahí se sigue trabajando en los mismos proyectos.

- **Por qué:** se cumplió lo que D15 dejaba para revisar: alguien lo usa en Windows. Cambiar de sistema no puede dejar el tablero afuera.
- **Qué significa:** lo nuevo se diseña en Linux. Antes de cerrar un hito, la suite corre también en Windows. Si algo no se puede hacer igual en las dos plataformas, gana Linux, y en Windows hay una alternativa o un aviso, nunca un error.
- **Cómo se prueba:** una VM con Windows 10 por SSH para el día a día, y el mismo Windows en la máquina real como prueba de uso. Godot es el mismo 4.8 que en Linux.
- **Datos entre sistemas:** por git (push en uno y pull en el otro), no por una partición compartida. `.gitattributes` fija LF, así que los JSON quedan iguales en las dos plataformas.
- **Descartado:** CI en Windows por ahora (un solo usuario; la VM alcanza), y macOS (nadie lo usa).

## D31 · Bandeja en Windows: `NotifyIcon` desde PowerShell, sin dependencias
**2026-10-06 · vigente** · spec §18 · complementa D20

- **Qué:** en Windows, el hub lanza un script de PowerShell (`powershell.exe -NoProfile -WindowStyle Hidden`) que muestra el ícono con `System.Windows.Forms.NotifyIcon`. El hub le manda el ícono, el tooltip y el menú como JSON por stdin, y el script devuelve los clics por stdout. Si el hub muere, se cierra el stdin y el ícono desaparece. En Linux sigue D20.
- **Por qué:** menos librerías externas. PowerShell 5.1 y .NET vienen con todo Windows 10/11, así que no hay que instalar nada. Es el mismo patrón que D20: el mecanismo nativo de cada escritorio, sin binarios propios.
- **Descartado:** paquetes de npm con un binario precompilado (`systray2` y similares), que son una dependencia más, con binarios que no se auditan. También un mismo mecanismo para las dos plataformas: Node no tiene bandeja, y el `StatusIndicator` de Godot sería un proceso de unos 100 MB solo para un ícono.

## D32 · Etiquetas, prioridad y responsable: campos opcionales de la tarea; los filtros son de la vista
**2026-10-08 · vigente** · spec §19

- **Qué:** la tarea suma tres campos opcionales: `tags` (lista de textos cortos), `priority` (`high`, `medium` o `low`) y `assignee` (texto libre: una persona o un agente). Sin el campo, la tarea no tiene ese dato; no hay valor por defecto. Los filtros (texto, estado, fecha, bloqueo, pasos, referencias y los tres campos) no se guardan en `compass/`: la UI web los recuerda por proyecto en el navegador, y `scompass list` los recibe como opciones.
- **Por qué:** con un tablero grande, el hito solo no alcanza para encontrar una tarea. Los tres campos son los que se usan para repartir y ordenar trabajo en un equipo chico. Son opcionales para que los proyectos que no los usen no cambien, y los datos viejos siguen siendo válidos.
- **Etiquetas libres:** no hay una lista de etiquetas del proyecto en `config.json`. Las sugerencias salen de las que ya usan las tareas. Una lista fija obligaría a editar la config antes de etiquetar, y un error de tipeo se ve en el filtro y se corrige igual.
- **Responsable como texto:** no hay usuarios en Scope Compass (local, un solo usuario por ahora). Un nombre o el de un agente alcanza para filtrar "lo mío".
- **Descartado:** prioridad numérica (1–5): tres niveles alcanzan y se leen sin pensar. Filtrar en el hub con parámetros de `/api/tasks`: el tablero ya tiene todas las tareas en memoria y filtra al instante.

## D33 · Biblioteca de documentos: la app declara documentos y lee git, pero no escribe documentos ni commitea
**2026-10-10 · vigente** · spec §20

- **Qué:** la app solo agrega y quita entradas de `config.json › docs`. Los documentos se siguen editando en el editor de cada uno. La búsqueda, el estado de git, el diff y la historia son de lectura: la app nunca hace `git add` ni `commit`.
- **Alias de un patrón:** cada archivo de un patrón toma el alias del patrón más su ruta bajo la carpeta base del patrón, sin `.md` (`docs/notas/arte`). Antes era el nombre del archivo, y dos `README.md` en carpetas distintas chocaban.
- **Qué saltea un patrón:** el export del tablero, los archivos que ya están declarados aparte (conservan su alias), las carpetas ocultas y `node_modules`.
- **Escritura de `config.json`:** `doc add` y `doc rm` aplican el cambio sobre la config tal como está en ese momento, con escritura atómica y sin etag. La config la toca una persona a mano muy de vez en cuando, y releerla justo antes de escribir alcanza.
- **Por qué:** el texto del diseño es de quien lo escribe, y git es la historia (D1). Si la app commiteara, mezclaría cambios del tablero con cambios del diseño en commits que nadie revisó. Ver qué cambió y qué tareas cita cada sección tocada alcanza para decidir qué revisar.
- **Descartado:**
  - Editar documentos desde la web: duplicaría el editor, y sin conflictos resueltos por git se perderían cambios.
  - Un índice de búsqueda: los documentos de un proyecto entran en memoria y recorrer sus líneas tarda milisegundos.
  - Un alias por nombre de archivo con sufijo numérico ante choques: cambiaría al agregar un archivo, y las referencias se romperían.

## D34 · Archivos del repo: de lectura, solo lo que git no ignora, y el hub solo atiende a 127.0.0.1
**2026-10-10 · vigente** · spec §22

- **Qué:** la pestaña Archivos muestra los archivos del repo, su estado de git, su diff contra HEAD, su historial y su contenido. No los edita, no los agrega a git y no commitea, igual que con los documentos (D33).
- **Solo lo que git no ignora:**
  - Lo ignorado suele ser secreto (`.env`), generado (`.godot/`) o pesado. Esa lista ya la mantiene el proyecto en `.gitignore`.
  - La API solo sirve una ruta si `git ls-files` la lista. Así no hace falta otra lista de carpetas a saltear ni otra regla contra `../`, y la ruta tiene que ser de un archivo que git ya conoce.
- **El hub solo atiende a 127.0.0.1 o localhost:**
  - El problema: el navegador no deja que otra página lea las respuestas del hub, salvo que esa página haga que su propio nombre apunte a 127.0.0.1 (DNS rebinding). Con los archivos del repo a la vista, eso ya no es solo el tablero.
  - La solución: un pedido con otro Host da 403, en el hub y en el Inicio.
  - Con token (hosting, §12), el token alcanza.
- **Sin vigilar el repo entero:** un proyecto de Godot tiene miles de archivos, más los que importa el editor. La lista se relee al entrar a la pestaña, con los eventos del hub, al volver a la ventana y con *Actualizar*. Es un `git ls-files` y un `git status`, que tardan milisegundos.
- **Por qué:** en un proyecto de juego, el tablero, el diseño y el código van juntos, y saber qué cambió sin abrir otra herramienta ayuda a revisar las tareas. Pero editar y commitear siguen siendo del editor y de git, para que nada entre al historial sin que alguien lo mire.
- **Descartado:**
  - Editar archivos desde la web: haría falta un editor de verdad, y se pisaría con el del editor de Godot.
  - Agregar a git o commitear desde la app: ver D33.
  - Recorrer el disco cuando no hay repo: los proyectos sin git son los personales del Inicio, que no tienen archivos propios que ver.
  - Mostrar un SVG como imagen: puede traer scripts, así que se muestra como texto.
  - Seguir enlaces simbólicos: uno puede apuntar fuera del proyecto.
