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
- **Estado:** el `gdd.md` del primer proyecto de juego ya tiene sus 28 ids estampados, y sus tareas de M0 ya tienen `refs`.

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

- **Por qué:** M1 cerrado, la CLI ya alcanza para trabajar el tablero, y usar la herramienta en su propio desarrollo es la mejor forma de encontrar lo que falta antes de migrar el primer proyecto de juego (M4).
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
- **Reglas:** entre dos tareas hay a lo sumo un vínculo (agregar otro lo reemplaza); una tarea no se vincula consigo misma; un `blocks` que cerraría un ciclo se rechaza (CLI y web). Una tarea está **bloqueada** si la bloquea alguna tarea sin terminar (ni en Revisión ni Hecha) y ella misma no está hecha: se marca en la lista de la CLI, en la tarjeta de la web y en el dock.
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
- **Por qué:** salió del primer uso en un proyecto de juego (4.2): con ids al azar (`tagr1kge`) las tareas nuevas se leían mal en git y en la CLI al lado de las importadas (`m0-03`).
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
  - D36 suma una IP como Host (para `--lan`) y corta los pedidos con el `Origin` de otra página.
- **Sin vigilar el repo entero:** un proyecto de Godot tiene miles de archivos, más los que importa el editor. La lista se relee al entrar a la pestaña, con los eventos del hub, al volver a la ventana y con *Actualizar*. Es un `git ls-files` y un `git status`, que tardan milisegundos.
- **Por qué:** en un proyecto de juego, el tablero, el diseño y el código van juntos, y saber qué cambió sin abrir otra herramienta ayuda a revisar las tareas. Pero editar y commitear siguen siendo del editor y de git, para que nada entre al historial sin que alguien lo mire.
- **Descartado:**
  - Editar archivos desde la web: haría falta un editor de verdad, y se pisaría con el del editor de Godot.
  - Agregar a git o commitear desde la app: ver D33.
  - Recorrer el disco cuando no hay repo: los proyectos sin git son los personales del Inicio, que no tienen archivos propios que ver.
  - Mostrar un SVG como imagen: puede traer scripts, así que se muestra como texto.
  - Seguir enlaces simbólicos: uno puede apuntar fuera del proyecto.

## D35 · Tareas con archivos: un campo files con rutas del repo, aparte de las referencias a documentos
**2026-10-10 · vigente** · spec §23

- **Qué:** la tarea cita los archivos que toca en un campo propio, `files`, con rutas desde la raíz del proyecto. No usa `refs`, que sigue siendo de documentos y secciones.
- **Por qué aparte:**
  - Una referencia a un documento tiene secciones, ids estables, backlinks por sección y texto renderizado en el detalle.
  - Un archivo del repo es solo una ruta que se abre en otro lado: en la pestaña Archivos o en el editor de Godot.
  - Mezclarlos complicaba `refs check` y la búsqueda de secciones, sin ganar nada.
- **Rutas y no uid:// de Godot:**
  - La ruta se lee en el JSON y en los diffs, y la CLI, la web y un agente la entienden sin Godot.
  - El costo es que mover un archivo rompe la cita. `refs check` lo avisa (`missing_file`), igual que una sección borrada.
  - Resolver uid:// en Node obligaría a leer los `.uid` y los encabezados de cada recurso.
- **Solo archivos que git lista:** son los mismos que muestra la pestaña Archivos (D34). Así una tarea no cita algo ignorado (`.godot/`, secretos) que nadie más ve. El dock vincula el script o la escena abiertos sin esa verificación: están en el disco y, en la práctica, en el repo.
- **Las tareas de un archivo se calculan en el cliente:** la web y el dock ya tienen todas las tareas, así que la API no cambia.
- **Descartado:**
  - Una línea dentro del archivo (`player.gd:42`): se corre con cada cambio.
  - Enlaces en línea a archivos dentro de las notas.
  - Mostrar las tareas terminadas de un archivo arriba de la lista: es lo pendiente lo que sirve mientras se edita.

## D36 · Teléfono en casa: `--lan` sin login; para salir de casa, Tailscale
**2026-10-10 · vigente** · spec §5.1, §12

- **Qué:** `scompass home --lan` (y `serve --lan`) escucha en todas las interfaces, además de 127.0.0.1, y dice en qué direcciones de la red se abre. No hay login: cualquiera en esa red ve y edita todos los proyectos del Inicio y lee los archivos del repo. Es para la red de casa.
- **`--lan` y no `--host <ip>`:** el dock, la CLI y el Inicio hablan con los hubs por 127.0.0.1. Si el hub escuchara solo en la IP de la red, dejarían de encontrarlo.
- **Lo que cambia en el chequeo de D34:**
  - Acepta un Host que sea una IP, además de localhost. Un nombre sigue dando 403, así que el DNS rebinding sigue cortado.
  - Un pedido con el `Origin` de otra página da 403, en el hub y en el Inicio: ni escrituras (CSRF) ni WebSocket. Esto faltaba también en local: cualquier página podía apagar el hub con un POST a `/api/shutdown`, o abrir el WebSocket y leer el tablero. El dock y la CLI no mandan `Origin`.
- **Las cuatro opciones, para cuando la red de casa no alcance:**

| | (a) Token por link que queda en una cookie, con QR | (b) Usuario y contraseña, o passkey | (c) Tailscale | (d) Proxy con login delante (Caddy con basic auth, Cloudflare Tunnel + Access) |
|---|---|---|---|---|
| **En un wifi compartido** | Débil sin TLS: el token y la cookie viajan en claro | Igual que (a) sin TLS; la passkey ni anda sin HTTPS | Buena: cifrado de punta a punta y solo tus dispositivos | Basic auth en HTTP viaja en claro; Access es buena |
| **En el teléfono** | Escanear el QR una vez | Entrar en cada dispositivo | Instalar la app y tener la VPN prendida (en Android, una VPN a la vez) | El navegador pide la clave y la recuerda; Access pide un código por mail cada tanto |
| **Trabajo en el hub** | Chico: el link que deja la cookie y chequearla también en el WebSocket | El más grande: usuarios, hash, sesiones, login y revocar | Ninguno por la IP de Tailscale con `--lan`; con HTTPS (`tailscale serve`), aceptar su nombre en el chequeo de Host | Aceptar el nombre del proxy en el chequeo de Host |
| **Fuera de casa** | No | Solo exponiéndolo a internet | Sí | Con Cloudflare, sí |
| **HTTPS (PWA instalable)** | No | No | Sí, con `tailscale serve` | Sí |
| **Para el hosting de §12** | Detrás de TLS | Sí, y es lo que haría falta con varias personas | Sí: es lo que §12 prefiere | Sí: es la alternativa de §12 |

- **Para después:** (c). Cubre fuera de casa y da HTTPS, que la PWA necesita, sin escribir autenticación. (a) si hace falta algo intermedio en una red con invitados. (b) recién con varias personas.
- **Riesgos de `--lan`, aceptados para casa:**
  - HTTP en claro: el tablero y los archivos viajan sin cifrar por el wifi.
  - Toda la API queda abierta a la red: apagar y reiniciar, prender y apagar hubs desde el Inicio, y el selector de carpetas, que se abre en la PC.
  - El Inicio muestra todos los proyectos registrados. Los hubs sueltos siguen en 127.0.0.1, y el Inicio los reenvía.
  - No hay acceso que revocar: se corta reiniciando sin `--lan`.
- **Descartado:**
  - `--host <ip>`: ver arriba.
  - Dejar `/api/shutdown` y `restart` solo para 127.0.0.1: el Inicio igual deja apagar hubs desde la red, así que no cerraba nada.
  - Un QR en la terminal: sería una dependencia para no tipear una IP una vez (después queda en favoritos).
  - Que la PWA se pueda instalar: sin HTTPS el navegador no la instala. Queda para (c).

## D37 · La tarea tiene descripción: qué y por qué, aparte de las notas
**2026-10-11 · vigente** · spec §4.2, §25

- **Qué:** un campo opcional `description` con el enunciado de la tarea: qué hay que hacer y por qué. `notes` queda para lo que va saliendo al trabajarla.
- **Por qué:** el modelo, que viene del artifact, tenía notas y *Cómo probarlo*, pero no un enunciado. Las notas terminaron haciendo de las dos cosas ("Pedido del usuario … Hecho: …"), y el pedido quedaba enterrado debajo de lo hecho. Separados, el detalle arranca por lo que hay que hacer, y quien la toma no tiene que buscarlo.
- **Opcional, y sin `""` por defecto:** una tarea vieja, o una cuyo título alcanza, no tiene descripción. `add` no la escribe vacía, a diferencia de `test` y `notes`, que vienen del artifact.
- **Descartado:**
  - Usar las notas como descripción y agregar un campo para lo hecho: las notas ya se usan así en todos los proyectos, y la CLI y la guía dicen que lo del final va en `notes`.
  - Markdown con formato en la descripción: los demás textos tampoco lo tienen (solo `` `código` `` y `[[enlaces]]`).

## D38 · Capturas en la tarea: un campo images, y la app guarda las pegadas en compass/images/
**2026-10-11 · vigente** · spec §26 · cambia D34 en un punto

- **Qué:** `images` en la tarea, con rutas del repo a imágenes. Lo que se pega o se sube desde la web, o se trae de fuera del proyecto con la CLI, el hub lo guarda en `compass/images/`.
- **Por qué un campo y no `files`:** `files` es lo que la tarea toca (D35), y la web y el dock lo abren como código o escena. Una captura se mira: va en miniatura y en un visor.
- **Lo que cambia de D34:** la app ya no es solo de lectura sobre los archivos. Escribe imágenes, pero solo:
  - en `compass/images/`, con un nombre que arma ella;
  - después de verificar por los primeros bytes que es PNG, JPEG, GIF o WebP, y hasta 10 MB;
  - y borra solo lo que guardó ahí, cuando ninguna tarea lo cita.
  - El resto del repo sigue siendo de lectura, y la app sigue sin commitear.
- **Por qué pegar:** sin eso, agregar una captura es guardarla a mano en el repo y escribir la ruta. En el teléfono, *+ Captura* abre la cámara.
- **Descartado:**
  - Guardarlas fuera del repo o en un servicio: no viajarían con git (D1).
  - Una carpeta configurable: una sola carpeta conocida se encuentra y se ignora fácil.
  - SVG: puede llevar scripts, y con la miniatura alcanza.

## D39 · Playtest: sesiones con tareas en orden, en una colección aparte; y un estado Pausado
**2026-10-13 · vigente** · spec §28

- **Qué:** `compass/playtests/<id>.json`, sesiones con ids de tareas ya creadas en el orden en que se prueban, con `result` (`pass`/`fail`) y `note` por tarea. Y un quinto estado, `paused`, al lado de Pendiente.
- **Por qué una colección y no una lista:** un ítem de lista es un texto que se tilda; acá cada fila es una tarea que ya existe y lo que importa es el orden y cómo salió la prueba. Con la forma de las listas (título, orden, ítems adentro) se reusan el store, el watcher, la API y la vista; con su propio schema, `result` y `note` se validan.
- **Por qué no un campo en la tarea (orden de prueba):** una tarea puede entrar en varias sesiones (una por build), y reordenar sería escribir en muchas tareas. La sesión es un archivo: reordenar cambia un solo archivo.
- **Probar no mueve la tarea:** se ofrece *Pasar a Hecho* / *Volver a En curso*, pero lo decide quien prueba; una sesión se puede repetir (*Reiniciar*).
- **Pausado:** lo empezado y dejado de lado se mezclaba con Pendiente (parecía sin empezar) o se quedaba en En curso (parecía activo). Va al lado de Pendiente porque es trabajo que espera, como Pendiente.
- **Descartado:**
  - Una etiqueta `playtest` con un número de orden: no da sesiones separadas ni resultado por prueba.
  - Pausado como etiqueta: no tendría columna ni entraría en los filtros por estado.

## D40 · Playtest: cómo salió la prueba vive en la tarea, no en la sesión
**2026-10-15 · vigente** · spec §28 · cambia D39 en un punto

- **Qué:** el resultado (`pass`/`fail`) y la nota de una prueba van en la tarea, en `playtest: { result?, note? }`. Las sesiones de `compass/playtests/` quedan como `{ task }` en orden: solo ordenan.
- **Por qué:** con el resultado en cada sesión, una tarea que está en dos (una sesión por zona y otra con todo lo de Revisión, por ejemplo) mostraba datos distintos en cada una: anda en una, falla con una nota en la otra. Lo que importa es cómo está la tarea, no en qué lista se marcó.
- **Lo que cambia de D39:** D39 ponía `result` y `note` en la sesión. El orden sigue en la sesión, por la misma razón que daba D39: reordenar cambia un solo archivo.
- **Cosas que siguen de esto:**
  - *Reiniciar* una sesión quita el resultado de sus tareas, y eso se ve también en las otras sesiones que las tienen (lo avisa la confirmación). Las notas quedan.
  - El historial de la tarea muestra los cambios de playtest (*Playtest: anda → falla, nota agregada*).
- **Migración:** `scompass playtest migrate` pasa las sesiones del formato anterior a las tareas. Si una tarea estaba en varias, gana el resultado de la sesión más reciente (`updated_at`) que la probó, y las notas distintas se juntan, de la más vieja a la más nueva. Lo que la tarea ya tenía se respeta. Hasta migrarlas, esas sesiones no validan y la CLI avisa.
- **Descartado:**
  - Sincronizar el resultado entre las sesiones que tienen la tarea: varias copias del mismo dato que hay que mantener iguales.
  - Un resultado por sesión con un "último resultado" calculado: dos fuentes para lo mismo, y la nota seguiría repartida.

## D41 · MCP: solo stdio, escrito a mano, sobre la CLI
**2026-10-19 · vigente** · spec §30

- **Qué:** `scompass mcp`, un servidor MCP por stdio para Claude Code. Cada herramienta llama a `run()` de la CLI con `--json`.
- **Por qué MCP:** con la CLI el agente arma comandos de Bash a partir de AGENTS.md; con herramientas tipadas ve los parámetros y los valores válidos, y no pide permiso de Bash por cada comando.
- **Por qué solo stdio:** por ahora lo usa Claude Code en el mismo equipo, que lanza el servidor como un proceso. HTTP solo haría falta para clientes sin shell (Desktop, el teléfono), y sumaría autenticación.
- **Por qué sin el SDK:** el transporte stdio es JSON-RPC con un mensaje por línea y pocos métodos; a mano son unas cien líneas, y el SDK traería dependencias (zod, entre otras) para eso. Las herramientas no cambian si un día se pasa al SDK.
- **Por qué sobre la CLI y no sobre el store:** la CLI ya valida, encuentra el hub, regenera el export y da los mensajes de error. Llamarla en el mismo proceso hace que las dos no se separen y que lo nuevo en la CLI llegue al MCP con solo describir el parámetro.
- **Descartado:**
  - Lanzar `scompass` como proceso aparte por cada llamada: más lento y lo mismo que llamar a `run()`.
  - Un servidor MCP dentro del hub: haría falta un hub corriendo, y la CLI anda sin él.

## D42 · Decisiones de las tareas: un campo en la tarea, revisable; y la app puede escribir documentos
**2026-10-21 · vigente** · spec §31 · cambia D33 en un punto

- **Qué:** las decisiones que se toman al trabajar una tarea van en la tarea, `decisions: [{ text, why?, alternatives?, asked?, reply?, review?, promoted?, at }]`. Lo que el agente decide sin preguntar queda *sin revisar* hasta que el usuario dice *OK* o *Revertir*; lo que pregunta queda como *pregunta abierta* hasta la respuesta.
- **Por qué:** el tablero ya es de agentes primero. Lo que el agente pregunta, el usuario ya lo vio; lo que decide solo se pierde en `notes`, mezclado con hallazgos, y no se puede filtrar ni contar. Separar *sola* de *consultada* es lo que dice qué revisar.
- **Por qué en la tarea y no en una colección aparte:** la decisión nace de una tarea, viaja con ella en git, en el export y en `history`, y se escribe como los pasos (`PATCH` con `If-Match`). Una colección aparte (como las sesiones de playtest, D39) serviría para ordenar cosas de varias tareas, y acá no hay orden que mantener: la vista del proyecto junta las de todas las tareas.
- **Por qué `asked` y no `by: agent | user`:** lo que importa es si el usuario participó. Una decisión que el usuario tomó por su cuenta es una pregunta respondida.
- **Revertir no deshace nada solo:** marca la decisión; el agente la deshace y la marca `reverted`. La decisión vieja no se borra, porque es la historia de por qué la tarea quedó como quedó.
- **Lo que cambia de D33:** la app ya puede escribir documentos. El primer uso es *Promover*, que agrega una entrada al final del documento de decisiones; editar documentos desde la web queda para después. Sigue sin commitear: el cambio queda en el árbol de trabajo, a la vista en la biblioteca, como un cambio del tablero. Que el agente se entere de que un documento cambió desde que lo leyó es un problema aparte y viene después.
- **Descartado:**
  - Escribirlas en `notes` con una convención (`Decisión: …`): no se puede revisar una por una ni contar las pendientes.
  - Una colección `compass/decisions/`: más archivos, más API y un vínculo a la tarea que mantener, sin ganar nada.
  - Que *Promover* devuelva solo el texto para pegar: con un clic alcanza, y la app ya vigila y muestra los cambios de los documentos.

## D43 · Chat: el `claude` instalado en stream-json, con permisos fijos y solo en el equipo
**2026-10-21 · vigente** · spec §32

- **Qué:** el hub lanza el Claude Code instalado con `-p --input-format stream-json --output-format stream-json`, un proceso por conversación, en la carpeta del proyecto, con el MCP `scompass` y permisos fijados de antemano (el tablero y las herramientas de lectura). La web muestra la conversación; el hub solo guarda qué conversaciones hay y una copia para mostrarlas.
- **Por qué el `claude` instalado:** usa el login, la suscripción, el modelo y la config que el usuario ya tiene, y no suma dependencias: es un proceso hijo que habla JSON por línea, como el MCP (D41). Las conversaciones son sesiones normales de Claude Code, que se pueden seguir en la terminal con `claude --resume`.
- **Por qué permisos fijos:** con `-p` no hay forma de pedir permiso a la web sin un servidor de permisos propio. Con el tablero y la lectura alcanza para preguntar, cargar tareas y responder decisiones; editar y correr comandos siguen en la terminal, donde el usuario mira cada paso.
- **Por qué solo 127.0.0.1:** el chat corre un agente con la cuenta del usuario y lee el repo. Sin login, abrirlo a la red (`--lan`, D36) sería darle eso a cualquiera en la casa. Se mira la dirección del socket y no el Host, que lo pone el cliente.
- **Por qué una copia propia de la conversación:** los archivos donde Claude Code guarda las sesiones son internos y pueden cambiar; la copia es lo que la web mostró y alcanza para volver a mostrarlo.
- **Descartado:**
  - ACP con `@agentclientprotocol/claude-agent-acp`: trae el Agent SDK, zod y otro Claude Code aparte del instalado. Su ventaja era pedir permisos al cliente, pero el `claude` instalado también los manda por stream-json con `--permission-prompts host` (según `claude --help`, 25.2): si el chat crece a consola de trabajo con edición desde la web, se hace sobre el mismo proceso.
  - El Agent SDK directo: las mismas dependencias, para lo que ya hace el `claude` instalado.
  - La API de mensajes con una clave propia: otra cuenta, otro costo, y habría que rehacer las herramientas y el contexto que Claude Code ya tiene.
  - Leer las sesiones de Claude Code (`~/.claude/projects/…`) para mostrar el historial: formato interno, sin garantías.

## D44 · Chat: perfiles de Claude Code por conversación, y la cuenta y el uso a la vista
**2026-10-21 · vigente** · spec §33

- **Qué:** el chat puede usar cualquier perfil de Claude Code del equipo (`~/.claude` y las carpetas de `~/.claude-profiles/`), elegido al crear cada conversación. El panel muestra la cuenta del perfil, el uso de sus límites y los tokens de cada respuesta.
- **Por qué:** el hub lanza `claude` con su propio entorno, que puede no ser el de la terminal: el chat usaba otra cuenta que la sesión del agente sin que se viera. Con varias cuentas (personal, trabajo, un proveedor propio), saber cuál gasta es lo primero.
- **Por qué el perfil es de la conversación:** la sesión de Claude Code vive en la carpeta del perfil; retomarla desde otro no la encuentra.
- **Por qué el predeterminado es siempre `~/.claude`:** si fuera el `CLAUDE_CONFIG_DIR` del hub, cambiaría según desde dónde se levantó (el Inicio desde la bandeja o un `serve` desde una sesión de agente).
- **Por qué `~/.claude-profiles`:** es la carpeta que usa el usuario para sus perfiles; Claude Code no tiene una lista de perfiles. `SCOMPASS_CLAUDE_PROFILES` apunta a otra.
- **Por qué mirar si existe el archivo de la sesión:** es la única forma de saber en qué perfil está una pregunta sin guardar rutas de la máquina en `compass/`. Solo se mira el nombre, no el contenido (D43).
- **Descartado:**
  - Guardar el perfil en la decisión: es una ruta de la máquina dentro de git.
  - Leer el uso de la cuenta con otra llamada: Claude Code no tiene un comando para eso; el `rate_limit_event` llega gratis con cada turno.
  - Iniciar sesión desde la web: `claude auth login` abre el navegador y es de la terminal.

## D45 · scompass como binario: Node SEA que extrae el paquete a una caché
**2026-11-12 · vigente** · spec §35

- **Qué:** la release trae `scompass-v<versión>-<so>-<arq>`, un ejecutable de Node SEA (`node --build-sea`) que no necesita Node instalado. Adentro lleva el paquete de npm entero (src, web, schema, templates, assets y node_modules de producción) en un solo bloque comprimido. La primera vez que corre una versión lo extrae a `~/.cache/scope-compass/runtime/<versión>-<hash>/` (`%LOCALAPPDATA%` en Windows) y desde ahí lo carga. El `.tgz` de npm sigue saliendo.
- **Por qué:** el usuario pidió que no haya que instalar Node u otras dependencias para usarlo. SEA es de Node mismo: no agrega un runtime nuevo ni dependencias para armarlo.
- **Por qué extraer en lugar de empaquetar con un bundler:** el código sigue usando rutas de archivo de verdad (la web que sirve fastify, las plantillas que copia init, los íconos de la bandeja, el .ps1 de Windows) sin cambios, y no hace falta esbuild. El costo es unos 30 MB en la caché por versión y unos 0,3 s la primera vez.
- **Por qué `require()` y no `import()`:** en el script principal de un SEA, `import()` solo resuelve módulos internos de Node. `require()` de un módulo ES anda si no tiene `await` en el nivel superior: por eso el cuerpo de `bin/scompass.js` pasó a `src/main.js`.
- **Para relanzarse,** el binario se llama a sí mismo sin script (`src/self.js`).
- **Descartado:**
  - `bun build --compile`: un paso solo, pero cambia el runtime. Queda para revisar si el tamaño o el arranque molestan.
  - Leer los archivos desde los assets del SEA sin extraerlos: obliga a cambiar cada lectura de archivo y fastify no sirve estáticos desde ahí.
  - Borrar las versiones viejas de la caché: un Inicio que sigue corriendo con la versión anterior carga módulos de a poco y se rompería.

## D46 · Los tableros son del usuario: compass/ como enlace a la carpeta de tableros, o submódulo
**2026-11-14 · vigente** · spec §36

- **Qué:** los tableros viven en la carpeta del usuario, `<datos>/boards/<nombre>/`, y `<proyecto>/compass` es un enlace a esa carpeta, excluido en `.git/info/exclude`. `init` los crea ahí (`--in-project` para adentro). El git es uno para todos los tableros (si la carpeta de tableros es la raíz de un repo) o uno por tablero. Para trabajar con otros, `compass/` es un submódulo. `scompass board move` pasa un tablero de los de antes con su historial.
- **Por qué:** el usuario va a hacer públicos sus proyectos (scope-compass, godot-manager), y el tablero commiteado con el código publica notas internas, nombres de otros proyectos y links privados. Quiere sus tableros en un repo privado aparte.
- **Por qué un enlace y no un registro proyecto → tablero:** `<proyecto>/compass` está fijo en unos 100 lugares, incluidas las rutas `compass/images/…` guardadas en las tareas y el addon, que lee `res://compass`. Con el enlace todo eso sigue igual, el submódulo es el mismo caso, y solo cambian el git del tablero y los chequeos de rutas. Un registro habría que volver a llenarlo en cada equipo igual que el enlace.
- **Por qué `info/exclude` y no `.gitignore`:** `.gitignore` se commitea y deja dicho en el repo público que hay un tablero aparte.
- **Por qué la carpeta de datos y no la de config:** un tablero son datos (XDG), y es la carpeta donde el Inicio ya crea los proyectos nuevos.
- **Por qué el export pasa adentro del tablero:** `docs/tareas.md` en el proyecto es una copia entera del tablero.
- **Un repo por tablero o uno con todos:** los dos andan, porque `git -C compass` encuentra el repo que corresponda. El usuario usa uno para todos. Con uno por tablero, compartir uno es agregarlo como submódulo.
- **Por qué `board move` commitea con el repo de todos:** el historial solo entra con un commit, y el usuario lo prefirió a perderlo. Se arma a mano (índice aparte, `commit-tree`, `update-ref`) y no con `git subtree add`, que pide el árbol limpio y deja el historial de cada archivo cortado en el commit que lo trae; por eso además la historia se reescribe con `<nombre>/` adelante.
- **Por qué un proyecto en `/tmp` crea adentro:** un tablero de prueba no tiene que quedar en la carpeta de tableros del usuario (es lo mismo que hace el registro del Inicio).
- **Descartado:**
  - Un registro proyecto → tablero en `projects.json` que resuelvan el hub, la CLI, el MCP y el addon: toca casi todo.
  - Un archivo puntero en el proyecto: deja rastro en el repo público.
  - Commitear el tablero nuevo al moverlo con un repo por tablero: no hace falta para conservar el historial (es un clon), y la app no commitea (§4.5).
  - `git subtree add`: pide el árbol limpio y corta el historial de cada archivo.

## D47 · Releases: a mano desde Actions, el commit y el tag recién con todo armado
**2026-11-14 · vigente** · spec §35.1

- **Qué:** `.github/workflows/release.yml` se lanza a mano (Run workflow sobre main, con `bump` = patch, minor, major o X.Y.Z) o con un tag `vX.Y.Z` pusheado a mano. Corre el CI, arma el binario de Linux y el de Windows, cada uno en su runner, y el zip del addon; commitea «Release vX.Y.Z» con el tag y publica con `gh release create`, con las notas de la sección del CHANGELOG (en inglés, Keep a Changelog) y `SHA256SUMS`. La lógica (versión, CHANGELOG, notas, chequeo de versiones, sumas) está en `tools/release.mjs`.
- **Por qué así:** es la convención del proyecto hermano godot-agent (bump a mano, Unreleased → versión, la release falla si Unreleased está vacía, notas desde el CHANGELOG). El tag pusheado a mano queda como alternativa para cuando el `GITHUB_TOKEN` no puede pushear a main.
- **Por qué el commit va al final y no al principio:** en godot-agent el commit y el tag se pushean antes de empaquetar. Acá el build tarda más y corre en dos sistemas: si el de Windows falla después del push, la versión queda quemada (el tag existe y Unreleased ya se vació). Por eso cada job aplica la versión nueva sobre el mismo commit (es determinística: versión y fecha salen del job `prepare`) y el push (`--atomic`, commit y tag juntos) es el anteúltimo paso. Si main avanzó durante la corrida, el push falla y no se publica nada.
- **Por qué Node y no sh o Python:** los pasos corren en Windows también, y Node ya está en todos los runners del proyecto. Sin dependencias.
- **Por qué `upload-artifact` y `download-artifact`:** son acciones oficiales de GitHub (`actions/`), igual que checkout y setup-node; pasan los binarios de cada runner al job que publica, y así la release se crea entera en un solo `gh release create`, sin borradores a medio subir.
- **Por qué el `.tgz` no va en la release:** README e instalar.md ofrecen el binario como camino principal y el `.tgz` como alternativa para quien ya tiene Node y clona el repo (`node tools/build.mjs`). Subirlo es una línea en el workflow si hace falta.
- **Por qué `install.sh` no va en la release:** el README lo nombra desde el repo (`sh tools/install.sh <ruta al binario>`), y acepta la ruta como argumento.
- **El zip del addon** lleva `addons/scope_compass/` desde la raíz, solo lo versionado, y adentro los README, el CHANGELOG y la LICENSE; los links relativos de los README pasan a GitHub en el tag, porque esos archivos no viajan en el zip.
- **Descartado:**
  - Release solo por tag (sin workflow_dispatch): obliga a subir las versiones y el CHANGELOG a mano antes, que es lo que el bump automatiza.
  - Commit y tag al principio, como godot-agent: un build que falla deja una versión quemada.
  - Acciones de terceros para el changelog o la release: `gh` ya viene en los runners.
  - Un borrador de release al que cada runner sube su binario: deja borradores colgados cuando un build falla.
