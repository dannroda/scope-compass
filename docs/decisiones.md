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
**2026-09-29 · vigente** · spec §14

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
