# Spec — Scope Compass

Organizador de proyectos de videojuegos: tablero de tareas por hito, con los datos en git, una app local (CLI + hub + UI web) y un dock para el editor de Godot.

**Estado:** en diseño. Plan de implementación en el tablero del repo (`compass/`, ver `README.md`). Prioridad actual: que funcione **local**.
**Nombre:** Scope Compass. CLI: `scompass`. Carpeta de datos en cada proyecto: `compass/`.
**Origen:** el tablero en artifact de Project Epiphany, https://claude.ai/artifact/DPeQdjQUUsQv7zCz7Tu5aY (creado el 2026-09-29). Primer proyecto usuario: `../project-epiphany`.
**Referencias en este repo:**
- `docs/reference/tablero-artifact.html`: el código fuente completo del artifact (UI + lógica), base del port de §7.
- `tools/artifact_to_md.py`: prototipo del export a markdown (§6, `export md`).
- `tools/artifact_to_tablero.py`: prototipo del import desde el artifact (§8).
- `docs/decisiones.md`: registro de las decisiones tomadas y por qué.
- Mockups de la app web, el teléfono y el dock de Godot: https://claude.ai/artifact/6QSijARPwJtsRd1t6wJGJ9

---

## 1. Objetivo
<!-- id: objetivo -->

Recrear el tablero del artifact como **app local propia**: un servidor Node que corre en la máquina, sirve la misma UI en el navegador y guarda los datos **dentro del proyecto**, versionables con git. Sin depender de claude.ai.

**Principio no negociable: los datos viven en git, la app es opcional.** Si la app no está disponible (no instalada, rota, sin el servidor o sin el hosting), las tareas se tienen que poder leer, editar y versionar solo con git y un editor de texto. La app es una forma cómoda de manejar esos archivos, nunca el único lugar donde existen. Esto vale también cuando esté hosteada (§12).

**Requisitos que vienen de cómo se trabaja en este proyecto:**
- El trabajo es dentro del editor de Godot, sin IDE externo. La app tiene que abrirse y usarse sin tocar código.
- Tiene que existir una **copia legible local** de las tareas (hoy `docs/tareas.md`).
- Claude Code tiene que poder **leer y escribir tareas** desde la terminal, igual que hoy con el artifact.
- **Interoperabilidad con Godot:** el editor se conecta a la app (dock con tareas y secciones del GDD). Ver §11.1.
- A futuro, la base para una herramienta de organización de proyectos de videojuegos (ver §11).

### 1.1 Arquitectura: local primero, hosteable después
<!-- id: arquitectura -->

```
            ┌──────────── Hub (Node, en tu máquina) ────────────┐
            │  API REST + WebSocket · datos en compass/ (JSON)  │
            │  sirve la UI web · lee los docs (GDD) del proyecto │
            └──────▲───────────────▲───────────────▲─────────────┘
                   │ http/ws       │ ws            │ http
              Navegador         Plugin Godot     CLI (Claude Code,
              (UI del tablero)  (dock, v1.5)     scripts)
```

- **Ahora (v1):** todo corre en la máquina. El hub escucha en `127.0.0.1`, sin autenticación, y guarda los datos en el repo.
- **Después (§12):** el mismo hub se puede hostear en un servidor privado para verlo desde el teléfono. Para que eso no obligue a reescribir nada, v1 respeta cuatro reglas desde el principio:
  1. El acceso a datos pasa por una interfaz `Store`. Hay una sola implementación, archivos JSON en `compass/`, en local y hosteado. No hay base de datos que pueda quedar como única copia.
  2. Los docs del proyecto pasan por una interfaz `DocSource` (v1: leer del disco; hosteado: los sube el plugin de Godot).
  3. La UI usa URLs relativas y no asume que el hub está en `localhost`.
  4. El servidor tiene un punto de enganche para autenticación por token, apagado en local.

**Alternativas descartadas (por ahora):**
- **Todo en Godot** (hub headless + UI exportada, también a web): una sola herramienta y lenguaje, pero el export web pesa decenas de MB, carga lento en el teléfono, el texto no se selecciona ni se busca como en un navegador y el visor de markdown habría que construirlo. Se retoma si el teléfono deja de ser requisito.
- **Hosteado desde el día uno:** suma infraestructura (servidor, red privada, tokens) antes de que la app exista. Queda para §12.

**Mantenimiento desde Godot:** la parte Node/HTML/JS se puede editar desde el editor de Godot como texto, agregando `js,html,css` en *Editor Settings › Docks › FileSystem › TextFile Extensions*. El plugin de Godot (v1.5) es GDScript.

## 2. Alcance
<!-- id: alcance -->

### v1: paridad con el artifact
<!-- id: v1-paridad -->

- Hitos como pestañas, con objetivo, criterio de "Hecho cuando" y progreso (tareas hechas / total).
- Vista "Todos" con conteo por estado.
- Tablero de 4 columnas: Pendiente, En curso, Revisión, Hecho.
- Tarjetas con código, título, hito (en vista "Todos") y progreso de pasos.
- Arrastrar tarjetas entre columnas; también cambiar estado desde el detalle.
- Panel de detalle: título editable, estado, hito, pasos (tildar, agregar, quitar), "Cómo probarlo", notas, fecha de última actualización, borrar con confirmación.
- Crear tareas (título + hito).
- `` `código` `` en los textos se muestra como código.
- Tema claro y oscuro según el sistema; usable en pantalla angosta.
- Varias pestañas abiertas se mantienen sincronizadas en vivo.

### v1: además
<!-- id: v1-ademas -->

- **Exportar a markdown** (`docs/tareas.md`) desde la app y desde la CLI, con el mismo formato que genera hoy `tools/artifact_to_md.py`.
- **Importar** el export del artifact (§8), para migrar sin perder nada.
- **CLI** para Claude Code y scripts (§6).

### Fuera de v1
<!-- id: fuera-v1 -->

Usuarios y permisos, sincronización entre máquinas (eso lo hace git), adjuntos, comentarios, fechas límite, prioridades, etiquetas, filtros avanzados, historial de cambios dentro de la app (lo da git), editar los hitos desde la UI (se editan con la CLI o a mano en v1).

### v1.5: dock de Godot
<!-- id: v1-5-dock -->

Plugin `addons/scopecompass/` conectado al hub por WebSocket. Ver §11.1. Es el primer paso de interoperabilidad y se hace apenas v1 esté en uso.

### v2: documentos del proyecto
<!-- id: v2-docs -->

Visor de documentos (GDD y demás) y referencias entre tareas y secciones. Ver §10. v1 ya guarda el campo `refs` para no tener que migrar datos después.

### v3: inicio, listas y plantillas
<!-- id: v3-alcance -->

Una página de Inicio con todos los proyectos del equipo, listas con fecha límite y repetición, y plantillas para crear proyectos de juego o personales. Ver §16.

## 3. Stack
<!-- id: stack -->

| Pieza | Elección | Por qué |
|---|---|---|
| Runtime | Node LTS | Lo que se pidió; corre igual en Linux y Windows. |
| Servidor | Fastify | Liviano, validación de payloads por JSON Schema, archivos estáticos y WebSocket (`@fastify/websocket`) sin armar todo a mano. |
| Datos | Archivos JSON (§4) | Diffs legibles en git, se inspeccionan a mano, cero setup. El volumen es chico (decenas o cientos de tareas). |
| Tiempo real | WebSocket | Lo hablan igual el navegador y Godot (`WebSocketPeer`). SSE sería más simple para el navegador, pero en Godot habría que parsear el stream a mano con `HTTPClient`. |
| Frontend | HTML + CSS + JS sin framework | Es el código del artifact casi tal cual (§7). Sin build step. |
| Tests | `node:test` | Viene con Node. |

Dependencias previstas: `fastify`, `@fastify/static`, `@fastify/websocket`, y un watcher de archivos si `fs.watch` resulta poco confiable (por ejemplo `chokidar`). Nada más.

## 4. Datos
<!-- id: datos -->

### 4.1 Dónde se guardan
<!-- id: datos-ubicacion -->

Dentro del proyecto que se organiza, en la carpeta `compass/`:

```
<proyecto>/
  compass/
    .gdignore              # Godot ignora la carpeta
    README.md              # cómo editar los datos a mano, sin la app (§4.4)
    schema/                # JSON Schema de milestone y task, para validar sin la app
    config.json            # nombre del proyecto, puerto, ruta del export md
    milestones/m00.json
    milestones/m01.json
    tasks/m0-01.json
    tasks/<id>.json
  docs/tareas.md           # export legible (generado)
```

- **Un archivo por documento:** mover una tarjeta cambia un solo archivo y el diff en git queda mínimo.
- JSON con indentación de 2 espacios y **claves ordenadas**, para que los diffs sean estables.
- **No es una carpeta oculta,** a propósito: se ve en el explorador de archivos y en git sin configurar nada. El `.gdignore` evita que Godot la escanee o la importe. Consecuencia: el dock de Godot no la ve en su FileSystem, y la lee con `FileAccess` por ruta (§11.1).

### 4.2 Modelo
<!-- id: modelo -->

Es el mismo que el del artifact, más `created_at`. **Los archivos no guardan un número de versión:** el control de concurrencia usa un hash del contenido (§5.3). Así una edición a mano o un merge de git no tienen que acordarse de incrementar nada, y no hay un campo que genere conflictos de merge en cada cambio.

**Milestone** (`milestones/<id>.json`)

| Campo | Tipo | Notas |
|---|---|---|
| `code` | string | `"M0"` |
| `order` | number | Orden de las pestañas |
| `title` | string | |
| `goal` | string | Admite `` `código` `` |
| `done_when` | string[] | Criterios de hecho |
| `due` | string | Opcional. Fecha objetivo, `YYYY-MM-DD` o `YYYY-MM-DDTHH:MM`; pasada con tareas sin terminar, el hito está atrasado (§26) |

**Task** (`tasks/<id>.json`)

| Campo | Tipo | Notas |
|---|---|---|
| `milestone` | string | Id del hito (`"m00"`) |
| `code` | string | `"0.3"`; puede estar vacío |
| `order` | number | Orden dentro de la columna |
| `title` | string | |
| `description` | string | Opcional. Qué hay que hacer y por qué, el enunciado de la tarea (§25, D37) |
| `status` | `"todo" \| "doing" \| "review" \| "done"` | |
| `checklist` | `{ text: string, done: boolean, detail?: string }[]` | `text`: el paso en una línea. `detail` (opcional): el cómo y el porqué; se muestra plegado debajo del paso |
| `due` | string | Opcional. Fecha límite, `YYYY-MM-DD` o `YYYY-MM-DDTHH:MM` en hora local (§16.5, D26) |
| `priority` | `"high" \| "medium" \| "low"` | Opcional. Prioridad (§19, D32) |
| `size` | `"s" \| "m" \| "l"` | Opcional. Estimación: chica, mediana o grande (§26) |
| `assignee` | string | Opcional. Responsable: una persona o un agente, texto libre (§19, D32) |
| `tags` | string[] | Opcional. Etiquetas, sin repetir, sin comas ni espacios en los bordes, hasta 40 caracteres (§19, D32) |
| `test` | string | "Cómo probarlo" |
| `notes` | string | Lo que va saliendo al trabajarla: decisiones, hallazgos, lo que el siguiente necesita saber (D37) |
| `refs` | `{ doc: string, section: string }[]` | Opcional. Referencias a secciones de documentos (§10). v1 las guarda y las muestra como texto; v2 las resuelve. |
| `links` | `{ type: "blocks" \| "related", task: string }[]` | Opcional. Vínculos con otras tareas (D22): `blocks` = esta tarea bloquea a `task`; `related` = relacionadas. El inverso ("bloqueada por") no se guarda, se calcula. |
| `files` | string[] | Opcional. Archivos del repo que la tarea toca (§23, D35) |
| `images` | string[] | Opcional. Capturas: rutas del repo a imágenes PNG, JPEG, GIF o WebP; las pegadas van a `compass/images/` (§26, D38) |
| `done_at` | ISO 8601 | Opcional. Cuándo pasó a Hecho: el store lo pone al pasarla a `done` y lo quita si sale (§26) |
| `created_at` / `updated_at` | ISO 8601 | `updated_at` es opcional en ediciones a mano; la app lo completa en su próxima escritura |

**Ids:** los hitos usan `m00`…`m99`. Las tareas importadas conservan su id (`m0-01`). Las tareas nuevas usan el mismo formato con el siguiente número de su hito (`m0-12`; D27); si el hito tiene otro tipo de id, uno corto aleatorio (8 caracteres base36). Un id no cambia aunque la tarea pase a otro hito.

### 4.3 Validación
<!-- id: validacion -->

Un JSON Schema por tipo, guardado también en `compass/schema/` para poder validar sin la app. El servidor valida en cada escritura y al cargar desde disco. Un archivo inválido (por ejemplo, editado a mano con un error, o con marcadores de conflicto de git) **no tira el servidor**: se reporta en consola y en un aviso de la UI, y ese documento se ignora hasta que se corrija.

### 4.4 Manejo sin la app
<!-- id: sin-app -->

`compass/README.md` documenta esto para quien abra el repo sin la app:

| Quiero… | Sin la app |
|---|---|
| Ver las tareas | Abrir `docs/tareas.md` (último export) o los JSON de `compass/tasks/` |
| Mover una tarjeta | Cambiar `"status"` en `compass/tasks/<id>.json` a `todo`, `doing`, `review` o `done` |
| Tildar un paso | Cambiar `"done": false` a `true` en el `checklist` |
| Crear una tarea | Copiar un JSON existente con otro nombre de archivo (el nombre es el id) y editarlo |
| Borrar una tarea | Borrar el archivo |
| Ver el historial | `git log -p compass/tasks/<id>.json` |
| Recuperar algo borrado | `git checkout <commit> -- compass/tasks/<id>.json` |

Reglas que hacen esto posible:
- **Formato canónico:** 2 espacios, claves ordenadas, un salto de línea al final, UTF-8. La app reescribe cualquier archivo editado a mano en ese formato la próxima vez que lo guarda, sin cambiar el contenido.
- **Sin estado oculto:** todo lo que la app muestra sale de estos archivos, más `gdd.md` y `config.json`. No hay caché que sea la única copia de nada.
- **El markdown es solo lectura:** `docs/tareas.md` es un export; editarlo no cambia las tareas. Lo dice su encabezado.

### 4.5 Git: merges y conflictos
<!-- id: git-merges -->

- **Un archivo por tarea** hace que dos ramas que tocan tareas distintas nunca choquen.
- Si dos ramas cambian la misma tarea, el conflicto es de git y se resuelve como cualquier otro. Mientras el archivo tenga marcadores de conflicto, la app lo marca como inválido (§4.3) y no lo pisa.
- La app **nunca hace commits por su cuenta en local**: los cambios quedan en el working tree y se commitean cuando vos decidís, junto con el código si corresponde.
- Para que no se olviden, la app **recuerda** cuántos archivos del tablero (`compass/` y el export markdown) están sin commitear: `GET /api/git` y el evento `git` del hub (después de cada cambio, y cada 3 s mientras haya algo pendiente, porque un commit no toca `compass/`), un aviso en la cabecera de la web, el pie del dock, la tarjeta del Inicio y una línea al final de `scompass list` (4.4).

## 5. Servidor
<!-- id: servidor -->

### 5.1 Arranque
<!-- id: arranque -->

```
npx scompass serve [--dir <proyecto>] [--port 4711] [--open] [--lan]
```

- Escucha **solo en `127.0.0.1`**. No hay autenticación porque no sale de la máquina.
- `--lan` (también en `scompass home`) escucha además en la red, para abrirlo desde el teléfono en casa. No hay login, así que es solo para una red de confianza. Los pedidos con el `Origin` de otra página dan 403, también en local (D36).
- `--open` abre el navegador por defecto.
- Si `compass/` no existe, ofrece crearla (`scompass init`).

### 5.2 API REST
<!-- id: api-rest -->

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/api/health` | `{ok, name, version, project}`: la CLI lo usa para saber si hay un hub para este proyecto |
| `GET` | `/api/milestones` | Lista ordenada por `order` |
| `GET` | `/api/milestones/:id` | Un hito |
| `PUT` | `/api/milestones/:id` | Crea o reemplaza |
| `DELETE` | `/api/milestones/:id` | Borra; rechaza con `409` si tiene tareas |
| `GET` | `/api/tasks?milestone=&status=` | Lista, con filtros opcionales |
| `GET` | `/api/tasks/:id` | Una tarea |
| `POST` | `/api/tasks` | Crea; devuelve el documento con `id` y su `ETag` |
| `PUT` | `/api/tasks/:id` | Crea o reemplaza (lo usa `scompass set`) |
| `PATCH` | `/api/tasks/:id` | Merge de campos (los arrays se reemplazan enteros, igual que en el artifact) |
| `DELETE` | `/api/tasks/:id` | Borra |
| `GET` | `/ws` | WebSocket de eventos (§5.5) |
| `POST` | `/api/export/markdown` | Regenera `docs/tareas.md` |

Los documentos van planos, `{id, etag, ...campos}`, igual que en `scompass --json`, y las listas traen `warnings` con los archivos inválidos. Cada documento lleva la cabecera `ETag` (entre comillas). En escrituras, `If-Match` exige esa versión e `If-None-Match: *` exige que el documento no exista.

Las respuestas de error usan el formato `{error: {code, message}}` con los códigos `invalid_argument` (`400`), `not_found` (`404`), `conflict` (`409`), `invalid_file` e `io_error` (`500`), más `unauthenticated` (`401`) cuando el token está activado (§12). `invalid_file` (`409`) indica que el archivo en disco es inválido o tiene marcadores de conflicto: se rechaza cualquier escritura hasta que se corrija a mano (§4.3, §4.5). En un `PATCH`, un campo con valor `null` se borra del documento.

### 5.3 Concurrencia
<!-- id: concurrencia -->

- Cada documento tiene un `ETag`: un hash de su contenido canónico, calculado por el servidor, que no se guarda en el archivo.
- `PATCH`, `PUT` y `DELETE` aceptan `If-Match: <etag>`. Si no coincide (otra pestaña, la CLI, una edición a mano o un `git pull` lo cambiaron), se responde `409 conflict` con el documento actual.
- La UI siempre manda `If-Match`. Ante un `409`, recarga el documento y muestra un aviso ("Otra pestaña cambió esta tarea; se actualizó").
- Escritura atómica: se escribe un archivo temporal y después se renombra, así un corte a mitad de la escritura no deja JSON roto.

### 5.4 Cambios hechos fuera de la app
<!-- id: cambios-externos -->

Git pull, edición a mano o la CLI con el servidor corriendo: un watcher sobre `compass/` recarga el documento, lo valida y emite el evento por WebSocket. Así la UI refleja cualquier cambio sin recargar la página.

- `fs.watch` recursivo con debounce por archivo (50 ms); los temporales de la escritura atómica se ignoran. Si el evento no trae el nombre del archivo, se rescanea todo.
- El hub guarda el etag conocido de cada documento y solo emite si cambió: reformatear sin cambiar contenido no emite, y las escrituras del propio hub (que se publican al instante) no se repiten cuando llega el evento del disco.
- Un archivo que pasa a inválido emite un solo `warning`; cuando se corrige, un `upsert`.

### 5.5 Protocolo WebSocket
<!-- id: websocket -->

Mensajes JSON, un objeto por mensaje. Lo usan la UI web y el plugin de Godot.

Servidor → cliente:
```json
{"type": "hello", "server_version": "1.0.0"}
{"type": "upsert", "collection": "tasks", "id": "m0-03", "doc": { "...": "..." }}
{"type": "delete", "collection": "tasks", "id": "m0-03"}
{"type": "doc_changed", "alias": "gdd"}
{"type": "git", "repo": true, "uncommitted": 2, "files": ["compass/tasks/m0-03.json", "docs/tareas.md"]}
{"type": "docs_git", "repo": true, "docs": {"gdd": "modified"}}
{"type": "warning", "code": "invalid_file", "path": "compass/tasks/x.json", "message": "..."}
{"type": "focus"}
```

Cliente → servidor (opcional; las escrituras también se pueden hacer por REST):
```json
{"type": "update", "req": 7, "collection": "tasks", "id": "m0-03", "etag": "9f2c…", "patch": {"status": "doing"}}
{"type": "presence", "notify": true}
```
Respuesta: `{"type": "ack", "req": 7, "doc": {...}}` o `{"type": "error", "req": 7, "code": "conflict", "doc": {...}}`.

- `update` solo admite `tasks`, igual que la API (los hitos se editan por CLI, D12). Un `update` exitoso responde `ack` a quien lo mandó y además se publica como `upsert` para todos, incluido quien lo mandó.
- `presence` lo manda la UI web al conectar y cuando cambia el permiso de notificaciones; no tiene respuesta. Con `notify: true`, el clic en el ícono de la bandeja no abre otra pestaña: el hub le manda `focus` a la pestaña más reciente, que muestra una notificación de escritorio (al tocarla, el navegador enfoca esa pestaña). Sin ninguna pestaña así, la bandeja abre el tablero con `xdg-open`.
- Un mensaje inválido responde `error` (con `req: null` si no se pudo leer) y la conexión sigue abierta.
- **Para los clientes:** el `hello` llega apenas se abre la conexión. El handler de mensajes se registra antes de ceder el control (antes de cualquier `await`), o el `hello` se pierde.

- Al conectar, el cliente carga el estado inicial por REST y después aplica eventos.
- Reconexión con backoff; al reconectar, recarga el estado completo (es chico).
- Se valida con los mismos JSON Schema que la API REST.

## 6. CLI
<!-- id: cli -->

La usa Claude Code en lugar del `ArtifactData` de hoy, y sirve para scripts:

```
scompass init
scompass update [--check]                    # pone al día compass/schema/ y compass/AGENTS.md
scompass serve [--port] [--open]
scompass list [--milestone m00] [--status doing] [--json]
scompass show <id> [--json]
scompass add "<título>" --milestone m00 [--code 0.11] [--description "…"]
scompass move <id> <todo|doing|review|done>
scompass check <id> <n> [--undo]             # n desde 1, como lo muestra `show`
scompass set <id> --file task.json          # reemplazo completo, para cargas grandes
scompass set <id> [--title] [--description] [--notes] [--test] [--code] [--milestone] [--status]   # solo esos campos
scompass milestone list | show <id> | set <id> --file m.json
scompass milestone set <id> --due 2026-11-01   # fecha objetivo ("" la quita)
scompass link add <id> <blocks|blocked-by|related> <otra>   # vínculo entre tareas (D22)
scompass link rm <id> <otra>
scompass link list [<id>] [--json]          # sale con 1 si hay vínculos a tareas que no existen
scompass export md [--out docs/tareas.md]
scompass import artifact <carpeta-export>   # §8
```

- Si hay un servidor corriendo, la CLI **llama a la API**, que emite los eventos a la UI. Si no hay servidor, escribe los archivos directamente, con la misma validación y la misma escritura atómica. Para decidir, pide `GET /api/health` en el puerto de `config.json` (300 ms) y usa el hub solo si es del **mismo proyecto**. La salida, `--json` y los códigos de salida son iguales en los dos modos. `--direct` fuerza el disco.
- `--json` en todas las lecturas y escrituras, para que los agentes parseen sin adivinar. Cada documento sale con su `etag`.
- `--etag <e>` en las escrituras: falla con `conflict` (y el documento actual) si alguien lo cambió desde que se leyó. `--etag none` exige que el documento no exista.
- `add` no calcula el `order`: lo pone el store al crear, al final del hito, dentro de su cola de escritura. Con hub, dos `add` a la vez no repiten `order`.
- `serve` sin `--port` usa el puerto de `config.json`; si está ocupado (por ejemplo, por el hub de otro proyecto: todos nacen con 4711) usa el siguiente libre y lo avisa. La CLI y el dock encuentran el hub por el registro de hubs. Con `--port` explícito y ocupado, falla.
- Si el hub que responde es de otra versión que la CLI o el addon, se avisa (stderr en la CLI, una línea en el dock): suele ser un hub que quedó corriendo de antes de actualizar.
- `--dir <proyecto>`; sin él, busca `compass/config.json` subiendo desde la carpeta actual. `--file -` lee de stdin.
- Después de cada escritura se regenera el markdown. Se desactiva con `config.json › auto_export_md: false` (D13). Sin hub lo hace la CLI; con hub lo hace el hub, tras cualquier cambio (API, CLI o externo) con un debounce de 200 ms, y relee la config en cada export.

## 7. Frontend: portar el artifact
<!-- id: frontend -->

La UI actual (`docs/reference/tablero-artifact.html`) ya separa el render de los datos. El port consiste en:

1. **Sacar la capa `claude.use("db")`** y reemplazarla por un cliente chico:
   ```js
   const api = {
     list: (col) => fetch(`/api/${col}`).then(r => r.json()),
     create: (doc) => post('/api/tasks', doc),
     update: (id, patch, etag) => patch(`/api/tasks/${id}`, patch, { 'If-Match': etag }),
     remove: (id, etag) => del(`/api/tasks/${id}`, { 'If-Match': etag }),
     subscribe: (onEvent) => { const ws = new WebSocket(new URL('/ws', location.href.replace(/^http/, 'ws'))); ws.onmessage = e => onEvent(JSON.parse(e.data)); return () => ws.close(); },
   };
   ```
2. Las funciones `onSnapshot` que hoy llenan `S.milestones` y `S.tasks` pasan a hacer una carga inicial más la aplicación de eventos del WebSocket (upsert o delete sobre el array), con reconexión.
3. `updateTask` manda el `etag` que tiene la tarea en memoria y maneja el `409`.
4. Se mantienen tal cual: tokens de color (claro y oscuro), tipografías (Cinzel, Alegreya Sans, JetBrains Mono), `h()`, `rich()`, arrastrar y soltar, panel de detalle, confirmación de borrado y filtro recordado en `localStorage`.
5. Separar en `index.html`, `app.css` y `app.js` sin build step.
6. **Fuentes locales:** empaquetar las tres tipografías en `public/fonts/` para que la app funcione sin internet (el artifact las carga de Google Fonts).

**Mejoras chicas que conviene hacer en el port:**
- Mantener el texto sin guardar de "Notas" y "Cómo probarlo" cuando llega un evento de otra pestaña. Hoy el panel se re-renderiza y puede perder lo escrito si llega un cambio mientras escribís.
- Reordenar tarjetas dentro de una columna al arrastrar (el campo `order` ya existe).
- Atajos: `N` para nueva tarea, `Esc` para cerrar el detalle (ya existe), `1`–`4` para cambiar el estado de la tarea abierta.

## 8. Migración desde el artifact
<!-- id: migracion -->

1. Exportar los datos con `ArtifactData`, action `list` sobre `milestones` y `tasks`, con `out_dir`. Genera un JSON por documento.
2. `scompass init` y después `scompass import artifact <out_dir>`: copia cada documento a `compass/` en formato canónico, descarta los campos `version` e `id` del artifact, agrega `created_at` (el del documento que ya existía en `compass/`, si no `updated_at`) y valida. `--dry-run` muestra el reporte sin escribir. Un documento que ya existe con otro contenido no se pisa salvo con `--overwrite`, y uno inválido en disco nunca.
3. Comparar conteos: hitos y tareas importados contra los listados.
4. Regenerar `docs/tareas.md` y comparar con el existente. Solo debería cambiar la fecha.
5. Dejar el artifact como archivo de solo lectura. No hay sincronización bidireccional.

## 9. Estructura del repo
<!-- id: estructura-repo -->

Repo propio: `git@github.com:dannroda/scope-compass.git`, clonado como carpeta hermana de los proyectos que organiza (`../scope-compass`). Se apunta al proyecto con `--dir`.

```
scope-compass/
  project.godot           # el repo se abre en Godot: editar todo desde el editor y probar el addon
  README.md
  docs/
    spec.md               # este documento
    decisiones.md         # registro de decisiones
    tareas.md             # export legible del tablero propio (generado)
    reference/            # código del artifact original
  schema/                 # JSON Schemas fuente (milestone, task); `scompass init` los copia a <proyecto>/compass/schema/
  hub/                    # paquete Node: servidor + CLI
    package.json          # "bin": { "scompass": "bin/scompass.js" }
    bin/scompass.js       # CLI
    src/
      server.js           # Fastify: API REST, WebSocket, estáticos (sirve web/)
      store/              # interfaz Store + json-files.js (única implementación) + git-sync.js (hosteado, §12.1)
      docs/               # interfaz DocSource + disk.js (v2); upload.js (hosteado)
      schema.js           # carga los schemas de ../schema
      export-md.js        # port de tools/artifact_to_md.py
      import-artifact.js  # port de tools/artifact_to_tablero.py
    test/                 # node:test
  web/                    # UI sin build step: index.html, app.css, app.js, fonts/
  addons/scope_compass/   # plugin de Godot (dock, v1.5)
  tools/                  # prototipos en Python que el hub reemplaza
  compass/                # el tablero de Scope Compass mismo (se usa a sí mismo)
```

**Godot y `node_modules`:** como el repo es un proyecto de Godot, el editor escanearía `hub/node_modules`. El `postinstall` de `hub/package.json` crea `node_modules/.gdignore` después de cada `npm install`.

## 10. v2: documentos del proyecto y referencias
<!-- id: documentos -->

**Problema:** varias tareas dicen "ver `gdd.md` §11.3". Hoy eso obliga a abrir el GDD aparte, y desde Godot el markdown no se puede leer. La numeración además se rompe: si se inserta una sección, §11.3 pasa a ser §11.4 y la nota queda apuntando a otra cosa.

**Qué resuelve v2:**
1. La app es **el visor de los documentos del proyecto**. El GDD se lee formateado, con índice y snippets resaltados, en el mismo lugar que las tareas.
2. Las tareas **referencian secciones** con un id estable, y el detalle de la tarea muestra la sección ahí mismo.
3. Cada sección muestra **qué tareas la referencian** (backlinks). Así se ve qué parte del diseño ya está planificada y cuál no.

### 10.1 Ids estables de sección
<!-- id: ids-seccion -->

La referencia no puede depender del número (`11.3`) ni del texto del título (se renombra). Cada sección referenciable lleva un id explícito en un comentario HTML justo debajo del título:

```markdown
#### Ventanas de ataque: `AttackData` + `AttackRunner`
<!-- id: ventanas-ataque -->
```

- El comentario es invisible en cualquier visor de markdown (GitHub, VS Code, el propio tablero).
- Sin id explícito, la sección se puede referenciar igual por el slug del título. La app lo marca como "referencia frágil" y ofrece estampar el id (`scompass doc stamp-ids gdd.md`).
- **Una sección** es su título más todo el contenido hasta el próximo título de nivel igual o superior.

### 10.2 Cómo se referencia
<!-- id: referencias -->

- **Campo estructurado** `refs` en la tarea: `[{ doc: "gdd.md", section: "ventanas-ataque" }]`. Se edita desde el detalle con un buscador de secciones (título + documento).
- **Enlaces en línea** dentro de `description`, `notes`, `test` y los pasos: `[[gdd#ventanas-ataque]]`. Se muestran como un enlace con el título actual de la sección. `gdd` es el alias del documento definido en `config.json`.
- **Documento entero (12.1):** una ref sin `section` (`{ doc: "docs/enemigos.md" }`) y el enlace `[[enemigos]]` apuntan al documento completo, para tareas descritas por un archivo propio. Se muestran con el título de nivel 1 del documento (o su ruta) y no se despliegan en el detalle: se abren en la vista Documentos, que lista las tareas que referencian el documento cuando no hay una sección elegida. Solo se rompen si el documento no está (`missing_doc`). En la CLI, `ref add|rm <tarea> <alias>` sin `#<id>` y `doc show <alias>` devuelve el documento entero.

### 10.3 UI
<!-- id: documentos-ui -->

- **Detalle de la tarea:** una sección "Referencias" con cada sección referenciada plegable, renderizada en el lugar y con un botón "Abrir en el documento".
- **Vista Documentos:** una pestaña al lado de los hitos. Lista los documentos configurados; cada uno se abre con índice lateral, contenido renderizado y, junto a cada título, un contador de tareas que lo referencian ("3 tareas") que despliega la lista.
- **Tarjetas:** un indicador chico si la tarea tiene referencias, y una advertencia si alguna está rota.
- **Referencias rotas** (el id ya no existe): advertencia en la tarjeta y en el detalle, con la opción de buscar la sección nueva.

### 10.4 Servidor y datos
<!-- id: documentos-servidor -->

- `config.json` declara los documentos: `"docs": [{ "alias": "gdd", "path": "gdd.md" }]`, o un patrón como `docs/**/*.md`.
- El servidor parsea cada documento en un índice de secciones `{id, title, level, start, end}` y lo recalcula cuando el archivo cambia (el mismo watcher de §5.4). La UI recibe `doc_changed` por WebSocket y se actualiza.
- Los documentos son **de solo lectura** desde la app en v2. Se siguen editando donde se editan hoy.
- M12 suma agregar y quitar documentos, la búsqueda y el estado de git, con sus rutas y comandos (§20). Los demás archivos del repo se ven en la pestaña Archivos (§22).
- Render de markdown con una librería empaquetada localmente (por ejemplo markdown-it) y resaltado de sintaxis que cubra GDScript. Hay que verificar que la librería elegida lo soporte.

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/api/docs` | Documentos configurados con su índice de secciones |
| `GET` | `/api/docs/:alias` | Documento completo renderizado |
| `GET` | `/api/docs/:alias/sections/:id` | Una sección renderizada + tareas que la referencian |
| `GET` | `/api/refs/broken` | Referencias que no resuelven |

CLI:

```
scompass doc list
scompass doc show gdd#ventanas-ataque [--raw]
scompass doc stamp-ids gdd.md               # agrega <!-- id: ... --> a las secciones que no lo tienen
scompass refs check                         # lista referencias rotas; exit code != 0 si hay
scompass ref add <task-id> gdd#ventanas-ataque
```

`doc show --raw` le sirve a Claude Code para traer al contexto justo la sección que necesita, en lugar del GDD entero.

### 10.5 Migración de las notas actuales
<!-- id: migracion-notas -->

Las notas de hoy tienen la forma "Ver `gdd.md` §4.3". `scompass refs suggest` las detecta con un patrón (`gdd.md` o el alias + `§N.N`: la sección cuyo título empieza con ese número) y propone la referencia estructurada equivalente, con el `scompass ref add` listo para aplicarla; `import artifact` avisa si quedaron citas por revisar. Para eso el GDD tiene que tener sus ids estampados antes de importar. La propuesta se revisa a mano: no se aplica sola.

### 10.6 Criterios de aceptación de v2
<!-- id: criterios-v2 -->

- [x] Una tarea con `refs` muestra la sección renderizada en su detalle, con snippets de GDScript resaltados.
- [x] Renombrar o renumerar una sección con id explícito no rompe ninguna referencia.
- [x] Borrar una sección referenciada marca la tarea con una advertencia, y `scompass refs check` la lista.
- [x] La vista Documentos muestra los backlinks correctos por sección.
- [x] Editar `gdd.md` con la app abierta actualiza la vista en menos de 1 s.

## 11. Visión: organizador de proyectos de videojuegos
<!-- id: vision -->

Tareas + documentos es la base de una herramienta más grande para organizar un proyecto de videojuegos. Los mismos principios siguen sirviendo: datos en archivos dentro del repo, versionados con git, y accesibles para personas (UI), agentes (CLI) y el editor (API).

Módulos posibles, en el orden en que tendrían sentido para este proyecto:

| Módulo | Qué agrega | Por qué encaja |
|---|---|---|
| **Decisiones** | Las "decisiones abiertas" del GDD como entidades con estado (abierta, decidida), opciones, la decisión tomada y las tareas afectadas | Hoy son checkboxes sueltos al final del GDD |
| **Dock de Godot** | Ya planificado como v1.5 (§11.1) | Trabajar sin salir del editor, que es donde está el foco |
| **Referencias a `res://`** | Vincular tareas con escenas, scripts y recursos; desde el dock, abrir el archivo (hecho en M15, §23) | Cierra el ciclo tarea ↔ código |
| **Bugs y playtests** | Reportes de playtest con build, pasos, gravedad; se convierten en tareas | Llega en M10, cuando haya playtesters |
| **Assets** | Qué arte, audio y animaciones hacen falta, de dónde salen (KayKit, propio) y su estado | El proyecto mezcla packs y assets propios |
| **Builds** | Qué build tiene qué tareas cerradas; notas de versión generadas | Útil desde que haya exports para terceros |

### 11.1 Integración con Godot
<!-- id: godot -->

Un plugin de editor (`addons/scopecompass/`, GDScript) con tres niveles de integración, de menor a mayor esfuerzo:

1. **Leer y escribir los archivos directamente.** Como los datos son JSON dentro del proyecto, el plugin los puede leer con `FileAccess`/`JSON` aunque el servidor no esté corriendo. Como `compass/` tiene `.gdignore`, no aparece en el FileSystem del editor: el plugin la lee por ruta (`ProjectSettings.globalize_path("res://compass")` + `DirAccess`/`FileAccess`). Sirve para mostrar tareas. Para escribir conviene pasar por el hub (o respetar las mismas reglas de ETag y escritura atómica).
2. **Cliente del hub.** `HTTPRequest` para la carga inicial y las escrituras, y `WebSocketPeer` (con `poll()` en `_process`) para los cambios en vivo, con el protocolo de §5.5. **Esto es v1.5.**
3. **Integración con el editor:**
   - **Dock** con las tareas del hito actual (un `Tree` con columnas por estado, o una lista filtrada).
   - **Secciones del GDD dentro del editor:** `RichTextLabel` no entiende markdown pero sí BBCode, así que el servidor expone `GET /api/docs/:alias/sections/:id?format=blocks`: el texto en BBCode y cada bloque de código crudo. El dock muestra el texto en `RichTextLabel` y los snippets en un `CodeEdit` de solo lectura con el `GDScriptSyntaxHighlighter` del editor, así se ven como en el editor de scripts (colores, fuente y tema del usuario). Sin hub, el dock parte el markdown de disco de la misma forma. (`?format=bbcode` devuelve la sección entera en BBCode.)
   - **Tareas del script abierto:** con la señal `editor_script_changed` del `ScriptEditor`, el dock muestra las tareas vinculadas a ese archivo, y también a la escena abierta (hecho en M15, §23).
   - **Abrir desde la tarea:** `EditorInterface.edit_script(script)` o `EditorInterface.open_scene_from_path(path)` para saltar al archivo vinculado (hecho en M15, §23, sin línea).
   - **Levantar el servidor desde el plugin:** `OS.create_process("node", [...])` al activar el plugin y `OS.kill(pid)` al desactivarlo, así no hace falta abrir una terminal.

**Desde el juego (debug):** en builds de debug, un atajo en el juego puede mandar un reporte a `POST /api/tasks` con captura de pantalla, escena y posición del player. Es la base del módulo de bugs y playtests.

**Riesgo conocido:** Godot 4.8 cambió el sistema de pantallas del editor (por eso hubo que parchear la UI de LimboAI). Hay que verificar que la API de docks funcione en la versión del proyecto antes de diseñar la UI del plugin, y preferir un dock a una pestaña de main screen.

**Regla para no desbordar el alcance:** cada módulo entra solo cuando el proyecto lo necesita de verdad, y después de que v1 esté en uso diario. Primero v1, después v2 (documentos). El resto queda como dirección, no como plan.

## 12. Hosting privado (más adelante)
<!-- id: hosting -->

**Objetivo:** ver y editar el tablero desde el teléfono sin tener la PC encendida, en un servidor privado.

**Mientras tanto, en casa:** `scompass home --lan` abre el Inicio en la red local, con la PC encendida y sin login (§5.1). D36 compara las opciones para salir de casa: la recomendada es Tailscale.

- **Mismo hub, otro lugar:** una imagen Docker del mismo código, con `DocSource` en modo upload. **El `Store` sigue siendo archivos JSON**, dentro de un clon del repo en el servidor (§12.1).
- **Privacidad:** preferentemente sin exponerlo a internet, dentro de una red privada tipo Tailscale (teléfono y PC en la misma red). Alternativa: túnel con login delante (por ejemplo Cloudflare Tunnel + Access).
- **Autenticación:** se activa el token del hub. El plugin de Godot y la CLI lo mandan en cada request y al abrir el WebSocket (`wss://`).
- **Teléfono:** la misma UI web como PWA instalable, con caché del último estado para leer sin conexión.
- **Docs:** el plugin de Godot sube `gdd.md` al hub cada vez que se guarda.
- **Migración local → hosteado:** no hay migración de datos: el servidor clona el repo.

### 12.1 Sincronización con git en modo hosteado
<!-- id: git-sync -->

Para respetar el principio de §1 también hosteado, **git sigue siendo el almacenamiento**:
- El servidor trabaja sobre un clon del repo (hace falta un remoto privado: hoy el repo no tiene ninguno).
- Los cambios hechos desde el teléfono se escriben en `compass/` y se commitean solos, agrupados (por ejemplo, 30 s sin cambios → un commit `compass: m0-03 → doing, 2 pasos tildados`), y se hace push.
- El servidor hace `pull` periódico y antes de cada push. Si hay conflicto, **no hace push**: muestra un aviso en la UI y queda esperando a que se resuelva a mano. Nunca fuerza nada.
- En la PC, un `git pull` trae los cambios del teléfono; el hub local o el plugin los ven con el watcher.
- Si el servidor muere, no se pierde nada salvo lo que no llegó a pushear. El aviso de "cambios sin sincronizar" en la UI hace visible ese riesgo.
- Los commits automáticos del servidor van solo sobre `compass/` y con un autor propio (`scompass-bot`), para distinguirlos en el historial.

## 13. Futuro chico (sin módulo propio)
<!-- id: futuro -->

- Plantillas de hito.
- Métricas simples: tareas cerradas por semana.

## 14. Criterios de aceptación de v1
<!-- id: criterios-v1 -->

- [x] `scompass import artifact` migra los 11 hitos y las 10 tareas de M0 sin diferencias de contenido.
- [x] La UI hace todo lo de §2 (paridad) con el mismo aspecto que el artifact, en claro y oscuro, en escritorio y en pantalla angosta.
- [x] Dos pestañas abiertas: mover una tarjeta en una se refleja en la otra en menos de 1 s.
- [x] Editar a mano `compass/tasks/<id>.json` con el servidor corriendo se refleja en la UI. Un JSON inválido muestra un aviso y no rompe el servidor.
- [x] Escritura concurrente con un ETag viejo devuelve `409` y la UI se recupera sola.
- [x] `scompass move`, `check`, `add` y `export md` funcionan con y sin servidor corriendo.
- [x] `docs/tareas.md` generado es idéntico al de `tools/artifact_to_md.py` para los mismos datos.
- [x] Funciona sin conexión a internet.
- [x] Un cliente WebSocket mínimo (script de test) recibe `upsert` al mover una tarjeta desde la UI.
- [x] Mover una tarjeta cambia exactamente un archivo de `compass/` en `git status` (más `docs/tareas.md`, por D13), y el diff es solo la línea de `status` (más `updated_at`).
- [x] Con la app apagada: editar a mano un JSON, validar contra `compass/schema/` y, al levantar la app, verlo reflejado sin pérdidas.
- [x] Un archivo con marcadores de conflicto de git se marca como inválido y la app no lo sobrescribe.
- [x] Borrar la app por completo no pierde ningún dato: todo está en `compass/` y en git.
- [x] Corre en Linux. Windows queda para después de v1 (D15; ahora es la segunda plataforma, D30 y §18).

## 15. Decisiones abiertas
<!-- id: decisiones-abiertas -->

- [x] Nombre de la app: **Scope Compass** (CLI `scompass`, datos en `compass/`).
- [x] Repo propio: `dannroda/scope-compass`, carpeta hermana de los proyectos.
- [x] Licencia del repo: **MIT** (D10).
- [x] Versión mínima de Node: **22** (D11).
- [x] Editar hitos: **solo CLI en v1**; la UI los muestra (D12).
- [x] Export markdown: **automático en cada escritura**, desactivable (D13).

## 16. Inicio, listas y plantillas (v3)
<!-- id: v3 -->

**Objetivo:** que Scope Compass sirva para organizar todo, no solo proyectos de juego. Una página de **Inicio** junta todos los proyectos del equipo, y un proyecto puede usarse para cosas personales ("Vida") con **listas** además del tablero. Todo sigue siendo **local**. El mirror always-on queda para después (§12).

Mockups: https://claude.ai/artifact/H842sKGxHz1oGH7qgZhYvY

**Principio:** cada `compass/` sigue siendo individual y un hub sigue sirviendo un solo proyecto. El Inicio es un proceso aparte que los conoce y los coordina, no un hub que los reemplaza (D24). Un proyecto personal es un proyecto normal creado con otra plantilla (D25).

### 16.1 Registro de proyectos
<!-- id: v3-registro -->

Hay dos registros, con funciones distintas (D23):

| Registro | Dónde | Qué guarda | Vida |
|---|---|---|---|
| Hubs vivos (ya existe) | `$XDG_RUNTIME_DIR/scope-compass/hubs/<pid>.json` | `{ pid, port, project, startedAt }`, más `kind: "home"` para el Inicio | Se limpia solo; desaparece al reiniciar |
| Proyectos conocidos (nuevo) | `~/.config/scope-compass/projects.json` (`$XDG_CONFIG_HOME`) | `{ projects: [{ path, name, added_at, last_seen }] }` | Persistente; se edita a mano si hace falta |

- **Se anota solo:** cada `scompass serve` agrega o actualiza su proyecto (incluidos los hubs que levanta el dock).
- **Importar sin levantar:** `scompass home add <carpeta>` (o "Agregar proyecto" en el Inicio) anota una carpeta con `compass/` sin prender su hub. `home rm <carpeta>` la quita del registro; no toca sus datos. `home list` muestra cada proyecto con su estado: `hub :<puerto>`, apagado o no encontrado.
- El nombre sale de `config.json › project` y se actualiza cada vez que se anota. Un hub que no puede anotarse (registro inválido) avisa y levanta igual.
- Un proyecto cuya carpeta ya no existe se muestra como "no encontrado" y se puede quitar.
- Escritura atómica (tmp + rename), como el Store. Un `projects.json` inválido se avisa y no se pisa.

### 16.2 `scompass home`
<!-- id: v3-home -->

`scompass home [--port 4700] [--open] [--tray]`: un proceso aparte, uno solo por usuario (se registra con `kind: "home"`; un segundo `home` abre el que ya corre).

- **Lectura:** lee de disco el `compass/` de cada proyecto conocido con el mismo Store y las mismas vistas que la CLI. Cruza con el registro de hubs vivos para mostrar "hub :4712" o "leído de disco".
- **En vivo:** se suscribe por WebSocket a los hubs vivos. Los proyectos sin hub se releen al abrir o recargar el Inicio.
- **Escrituras** (tildar desde "Hoy"): por la API del hub del proyecto si está vivo; si no, directo al Store con etag, igual que la CLI.
- **Prender y apagar hubs:** el Inicio levanta `scompass serve --dir <proyecto>` como proceso hijo (muere con el Inicio, como los que levanta el dock, tarea 5.8) y apaga cualquier hub vivo con `SIGTERM` al pid del registro. Si el hub es del dock, avisa antes; el dock ya sabe pasar a modo sin hub y reintentar.
- **API** (`hub/src/home.js`). Los proyectos se nombran por su ruta, y solo se actúa sobre los del registro:
  - `GET /api/projects`: registro + estado del hub + resumen (hito actual con su avance, en curso, las 3 que siguen, listas con pendientes, de hoy y vencidos).
  - `POST /api/projects { path }` importa; `DELETE /api/projects?path=…` quita del registro.
  - `GET /api/today`: ítems y tareas vencidos o de hoy (sin terminar) y tareas en curso, de todos los proyectos; vencido primero.
  - `POST /api/projects/check-item { path, list, n, etag? }` (usa la misma regla que la CLI: lo que se repite avanza) y `POST /api/projects/move-task { path, id, status, etag? }`. Responden `via: "hub" | "disk"`.
  - `POST /api/projects/start { path }`: levanta `scompass serve --exit-on-stdin-close` como hijo del Inicio y espera a que se anote (si ya hay hub, lo devuelve). `POST /api/projects/stop { path, force? }`: `SIGTERM` y espera a que cierre. El registro marca `attached` y `parent` en los hubs atados a otro proceso; si no es un hijo del Inicio (el dock), `stop` responde `409` con `foreign: true` hasta que se confirme con `force`.
  - `GET /ws`: `changed { path, collection, id }` (reenviado de los hubs o de una escritura directa), `hubs` (cambió el conjunto de hubs vivos) y `projects` (cambió el registro). El Inicio mira el registro de hubs cada medio segundo y se suscribe al WebSocket de cada hub vivo.
- `GET /api/templates` (con `data_dir`) y `POST /api/projects/init { name, template, parent? }`: crear un proyecto desde el Inicio, con la misma `scompass init` (en otro proceso). La carpeta es `<parent>/<nombre>`, con el nombre tal cual; `parent` es por defecto `$XDG_DATA_HOME/scope-compass` (D28), así "Vida" queda en `~/.local/share/scope-compass/Vida`. Si esa carpeta ya existe, `409`. Fuera de todo repo, recibe `git init`.
- `POST /api/pick-folder { start? }`: el botón "Elegir otra carpeta…" de la página. El navegador no da rutas, así que el diálogo lo abre el Inicio (`kdialog` o `zenity`). Devuelve `{ path }` o `{ cancelled: true }`, o `404` si no hay selector (entonces la página muestra un campo para escribir la ruta).
- **Página** (`web/home.html`, `home.js`, `home.css`, con los tokens y las fuentes de `app.css`): la franja Hoy (tildar ítems; las tareas enlazan al tablero si su hub está vivo), una tarjeta por proyecto (hub, hito actual con su avance, en curso y lo que sigue, listas con vencidos y de hoy, Prender o Apagar, Quitar, Abrir tablero) y Agregar proyecto (importar carpeta o crear con plantilla). Se recarga con los eventos del WebSocket.
- **Volver al Inicio:** con el Inicio corriendo, el tablero de cada proyecto muestra "← Inicio" arriba del título (`GET /api/home` del hub, que lo busca en el registro; la web lo revisa cada 10 s y al volver a la pestaña).
- Un segundo `scompass home` no levanta otro: dice dónde corre el primero (y lo abre con `--open`). Puerto 4700, o el siguiente libre.

### 16.3 Bandeja agrupada
<!-- id: v3-bandeja -->

Si el Inicio corre con `--tray`, **es el único ícono**: los hubs con `--tray` esconden el suyo y aparecen dentro del menú del Inicio, cada uno con Abrir, Actualizar compass/ (solo si su schema o su `AGENTS.md` quedaron viejos), Reiniciar y Detener, más "Abrir Inicio" y "Agregar proyecto…". Los hubs miran el registro de hubs vivos cada segundo: cuando aparece un `home` con `tray: true`, quitan su ícono; si el `home` muere, lo vuelven a poner. Así no se llena la bandeja.

- Cada proyecto del registro es un submenú `Nombre · :puerto` (o `· apagado` con "Prender", o `· no encontrado` deshabilitado). La lista se arma de nuevo cada vez que se abre el menú.
- Desde el menú no hay forma de confirmar, así que "Detener hub" de un hub que abrió el dock lo dice en el label ("lo abrió el dock") y lo apaga igual.
- Un hub que prendió el Inicio queda anotado con `by: "home"` (variable `SCOMPASS_LAUNCHED_BY`, que se hereda al reiniciarlo): no cuenta como del dock.

### 16.4 Listas
<!-- id: v3-listas -->

Una entidad nueva de la base, disponible en **cualquier** proyecto (D25): `compass/lists/<id>.json`.

| Campo | Tipo | Notas |
|---|---|---|
| `title` | string | |
| `order` | number | Orden en la barra lateral |
| `items` | `{ text, done, created_at, due?, repeat?, task? }[]` | `text` en una línea; `task`: id de la tarea creada con "Pasar a tarea" |
| `created_at` / `updated_at` | ISO 8601 | |

- Los ítems van dentro del archivo, como los pasos de una tarea: tildar uno cambia una línea.
- Una lista sin fechas se ve como lista simple. Si algún ítem tiene `due`, la vista agrupa en Vencidos, Hoy, Esta semana, Más adelante y Sin fecha.
- **Pasar a tarea:** crea una tarea en el hito elegido con el texto del ítem y guarda su id en `task`.
- **Id legible:** sale del título (`"Libros para leer"` → `libros-para-leer`); si ya existe, `-2`, `-3`… Como lo elige el cliente, la API crea con `PUT /api/lists/:id` + `If-None-Match: *`.
- CLI: `scompass lists`, `lists show|add|set|rm`, `item add <lista> "<texto>" [--due 2026-10-10]`, `item check <lista> <n> [--undo]`, `item set <lista> <n> [--text …] [--due …]`, `item rm`, `item clear` (quita los tildados), `item task <lista> <n> --milestone m00` (y `--repeat` en 8.5).
- API y WebSocket: `GET/PUT/PATCH/DELETE /api/lists[/:id]`, y los mismos `upsert`/`delete` que las tareas con `collection: "lists"`. El dock ignora las colecciones que no muestra.
- Con las reglas de la CLI, para que la web no las repita: `POST /api/lists { title }` (id del título), `POST /api/lists/:id/check { n, undo? }` (lo que se repite avanza) y `POST /api/lists/:id/task { n, milestone, code? }`. Las tres aceptan `If-Match` con el etag de la lista.
- **Web:** pestaña Listas (`#lists/<id>`), con la barra lateral, "+ Nueva lista", agregar con fecha, hora y repetición, editar, quitar, arrastrar para reordenar, Quitar tildados, Renombrar, Borrar y Pasar a tarea. Si algún ítem tiene fecha, agrupa en Vencidos, Hoy, Esta semana, Más adelante, Sin fecha y Tildados. Las pestañas siguen `config.views`.

### 16.5 Fechas y repetición
<!-- id: v3-fechas -->

Solo dos fechas importan (D26): **cuándo se creó** (`created_at`, que ya existe) y, si tiene, **la fecha límite** (`due`).

- `due` es opcional en **tareas e ítems de lista**: `"2026-10-10"` o `"2026-10-10T17:30"` (hora local, sin zona).
- `repeat` es opcional **solo en ítems de lista**: `{ "every": "day" | "week" | "month" | "year" }`. Requiere `due`. Tildar un ítem que se repite no lo marca hecho: mueve `due` a la próxima fecha a partir de la fecha límite, no de cuando se tildó. Lo que se hizo queda en el historial de git.
  - Un mes o un año sin ese día usa el último (31/01 → 28/02). Desde ahí queda en ese día (28/02 → 28/03): no se guarda el día original.
  - Un ítem que se repite no se destilda (no hay una fecha anterior segura): se le cambia `due` a mano.
  - Atrasado varios períodos, cada tilde avanza uno: cada vez que se hace cuenta como una vez.
- La forma `{ every }` deja lugar para `{ every: "day", interval: 3 }` (cada x días) más adelante sin migrar.
- **Sin notificaciones** por ahora: involucran coordinar todos los procesos.

### 16.6 Vistas y plantillas
<!-- id: v3-plantillas -->

- **`views` en `config.json`:** las pestañas del proyecto, en orden; la primera es la que abre. Valores: `board`, `lists`, `docs` y, desde M14, `files` (§22). Sin `views`, se ven todas con el tablero primero.
- **Plantillas:** `scompass init --template juego|personal|vacio`. Una plantilla es un `config.json` prearmado más datos iniciales; no tiene código propio. Cada una es un archivo `hub/templates/proyectos/<nombre>.json` con `{ description, config?, milestones?, lists?, files? }`: `config` se mezcla con la config base, hitos y listas se escriben con el Store, y `files` crea archivos del proyecto solo si no existen. Una plantilla desconocida no crea nada.
  - `juego`: `views` = board, lists, docs, files; hito M0 "Prototipo"; listas "Ideas sueltas" y "Assets a conseguir"; el documento `gdd` (`docs/gdd.md`, con un esqueleto con ids si no existe).
  - `personal`: `views` = lists, board; listas "Pendientes" y "Compras"; un hito "General" para el tablero (en vez de hacer opcionales los hitos).
  - `vacio` (por defecto): lo que hacía `scompass init`, sin datos ni export.
- `init` también anota el proyecto en el registro (§16.1).
- Más adelante: plantillas propias en `~/.config/scope-compass/templates/`.

### 16.7 Fuera de v3
<!-- id: v3-fuera -->

Notificaciones y recordatorios, repetición personalizada (cada x días), listas en el dock de Godot, un hub con varios proyectos, mirror always-on (§12).

### 16.8 Criterios de aceptación de v3
<!-- id: criterios-v3 -->

Cada uno tiene su test en `hub/test/m8-criteria.test.js`, salvo el de la bandeja, que está en `hub/test/tray.test.js` (con un bus D-Bus de prueba).

- [x] Con el Inicio abierto, levantar un hub desde el dock lo muestra como activo en menos de 1 s, y el proyecto queda en `projects.json`.
- [x] Importar una carpeta con `compass/` la muestra en el Inicio sin levantar su hub; prenderlo y apagarlo desde el Inicio funciona.
- [x] Tildar un ítem en "Hoy" cambia una sola línea del JSON de la lista, con hub o sin hub.
- [x] Un ítem mensual con `due` 2026-01-31 pasa a 2026-02-28 al tildarlo.
- [x] `scompass init --template personal` crea un proyecto que abre en Listas.
- [x] Con el Inicio en `--tray`, hay un solo ícono en la bandeja aunque haya tres hubs con `--tray`; al cerrar el Inicio vuelven los suyos.
- [x] Borrar `~/.config/scope-compass/` no pierde ningún dato: solo hay que volver a importar los proyectos.

## 17. El Inicio como app: multi-hub (v4)
<!-- id: v4 -->

**Objetivo:** que el Inicio se sienta como una sola app. Un solo puerto, ningún proceso que esperar, y todo proyecto del registro editable al instante. Reemplaza la parte de D24 que pedía un hub aparte por proyecto aun con el Inicio corriendo (D29).

- **Con el Inicio corriendo, el Inicio sirve cada proyecto** en `/p/<clave>/`: tablero, API, WebSocket, detección de cambios y export. Es el mismo código del hub, montado bajo esa ruta, y se activa la primera vez que se lo pide. La clave sale del nombre de la carpeta (`vida`, `project-epiphany`), sin repetirse.
- **Sin Inicio, el hub suelto sigue igual** (`scompass serve`, el dock).
- **Un solo proceso escribe cada `compass/`.** El registro de hubs anota quién sirve cada proyecto: un hub suelto, o el Inicio con su ruta (`base: "/p/<clave>"`). Si ya hay un hub suelto de un proyecto, el Inicio le reenvía los pedidos (HTTP y WebSocket) en lugar de servirlo él.
- **CLI y dock** encuentran el proyecto en el registro y usan su `base`. El "Iniciar hub" del dock, con el Inicio corriendo, activa el proyecto en el Inicio en lugar de levantar otro proceso.
- **Tablero web:** llamadas relativas a su ruta, así funciona igual en un hub suelto (`/`) y en el Inicio (`/p/<clave>/`). Barra superior compartida con el Inicio (volver, cambiar de proyecto) y transiciones entre páginas (View Transitions).
- **Reiniciar el Inicio:** `POST /api/restart`, `scompass home restart` y la bandeja. Vuelve en el mismo puerto.
- **Actualizar `compass/` desde el Inicio,** sin hub: el schema y `AGENTS.md` de cualquier proyecto del registro, desde su tarjeta o desde la bandeja (`POST /api/projects/update`).
- **Lo que queda de 8.9:** prender y apagar hubs sueltos sigue para los que existan (por ejemplo, el del dock), pero el Inicio ya no los crea.

### 17.1 Criterios de aceptación de v4
<!-- id: criterios-v4 -->

Tests: el primero en `hub/test/m9-criteria.test.js`; los cambios en vivo y el hub suelto en `home-serve.test.js`; el dock con el Inicio en `dock.test.js`; reiniciar en `home-restart.test.js`; actualizar en `home.test.js`.

- [x] Con el Inicio corriendo, abrir un tablero desde una tarjeta no cambia de puerto ni levanta procesos, y se puede editar enseguida.
- [x] Un cambio hecho desde la CLI o el dock en un proyecto que sirve el Inicio se ve en vivo en su tablero del Inicio.
- [x] Con un hub suelto del dock corriendo, el tablero en el Inicio pasa por ese hub (un solo proceso escribe).
- [x] `scompass home restart` y "Reiniciar Inicio" de la bandeja vuelven en el mismo puerto, con los proyectos.
- [x] "Actualizar compass/" en la tarjeta de un proyecto sin hub copia el schema nuevo.

## 18. Windows como segunda plataforma (M10)
<!-- id: windows -->

**Objetivo:** el mismo Scope Compass en Windows 10/11: CLI, hub, Inicio, bandeja y dock, sobre los mismos proyectos que en Linux, sincronizados por git (D30). Lo nuevo se sigue diseñando en Linux; Windows no puede quedar con errores, a lo sumo con una alternativa o un aviso.

| Qué | Linux | Windows |
|---|---|---|
| Proyectos conocidos (D23) | `$XDG_CONFIG_HOME/scope-compass/projects.json` (`~/.config`) | `%APPDATA%\scope-compass\projects.json` |
| Carpeta de datos (D28) | `$XDG_DATA_HOME/scope-compass` (`~/.local/share`) | `%LOCALAPPDATA%\scope-compass` |
| Hubs vivos | `$XDG_RUNTIME_DIR/scope-compass/hubs` | `%TEMP%\scope-compass\hubs` (`%TEMP%` ya es de cada usuario) |
| Abrir el navegador | `xdg-open` | `explorer.exe <url>` |
| Selector de carpetas (D28) | `kdialog` o `zenity` | diálogo de carpetas de Windows, desde PowerShell |
| Bandeja (D20, D31) | StatusNotifierItem por D-Bus | `NotifyIcon` desde un script de PowerShell que el hub lanza y maneja por stdin/stdout |
| Apagar un hub o el Inicio | `POST /api/shutdown`, o cortarle la entrada (`--exit-on-stdin-close`); `SIGTERM` también cierra ordenado | Lo mismo, sin `SIGTERM`: Node no tiene señales en Windows y `kill` lo mata en seco, así que queda para cuando no responde |

- **Rutas:** se comparan y validan con `node:path` (`isAbsolute`, no `startsWith('/')`); en las dos plataformas, un nombre de proyecto no puede tener `\ / : * ? " < > |` ni ser un nombre reservado (`CON`, `NUL`, …), para que un proyecto creado en Linux se abra en Windows. Las rutas que muestra la UI usan el separador del sistema.
- **Procesos:** todo hijo (hub del Inicio, reinicio, `git`, `scompass init`) se lanza con `windowsHide`, para que no aparezcan consolas. Reiniciar el Inicio o un hub no abre una ventana nueva.
- **Escritura atómica:** en Windows, `rename` falla con `EPERM`/`EBUSY` si otro proceso tiene abierto el destino (el antivirus, el indexador o el watcher). Se reintenta unas veces con espera corta antes de dar error.
- **Dock:** en Windows no usa `sh`, `id` ni `kill`. Busca `scompass` con `where` (del shim de `npm link` toma el `.js` y lo corre con `node`), lanza `node` directo con `serve --log <archivo>` (el hub escribe su propio log), mira si el hub sigue vivo con `tasklist` (`OS.is_process_running` solo conoce los hijos de Godot) y como último recurso `OS.kill`. El registro de hubs lo busca en `%TEMP%`, como Node, y compara rutas sin distinguir `\` de `/` ni mayúsculas.
- **Tests:** `npm test` corre igual en las dos plataformas (sin sintaxis de `sh` en `package.json`). Los tests que dependen de Linux (D-Bus, `sh -c`) se saltan en Windows con un motivo; los demás tienen que pasar.

### 18.1 Criterios de aceptación de M10
<!-- id: criterios-windows -->

- [ ] `npm test` pasa en Windows (VM), salvo los tests marcados como solo Linux.
- [ ] `scompass home --tray` en Windows: el Inicio abre en el navegador, con ícono en la bandeja y sin ventanas de consola.
- [ ] Desde el Inicio en Windows se prende, se apaga y se reinicia un hub, y el registro queda limpio.
- [ ] El dock en Godot 4.8 sobre Windows encuentra el hub, lo prende y lo apaga.
- [ ] Un proyecto clonado en Windows y otro en Linux, sincronizados por git, no muestran cambios por fin de línea.

## 19. Lista y filtros (M11)
<!-- id: lista-y-filtros -->

**Objetivo:** encontrar tareas en un tablero grande. La UI web suma una vista de lista y una barra de filtros que comparten el tablero y la lista; la tarea suma etiquetas, prioridad y responsable (D32). El dock de Godot no filtra; desde la 14.4 muestra la prioridad, el responsable y las etiquetas (en la fila, la prioridad solo si es alta, como la tarjeta de la web).

**Filtros** (se combinan entre sí y con el hito elegido):

| Filtro | Qué deja | CLI (`scompass list`) |
|---|---|---|
| Texto | Tareas con todas las palabras en el código, el título o el id, sin distinguir mayúsculas ni tildes | `--q "texto"` |
| Estado | Los estados marcados (uno o varios) | `--status doing,review` |
| Fecha límite | `overdue` (vencidas), `today` (vencen hoy), `week` (vencen en los próximos 7 días, incluidas las vencidas y las de hoy) o `none` (sin fecha). Las hechas no cuentan como vencidas | `--due overdue` |
| Bloqueo | Bloqueadas (por una tarea sin terminar) o no bloqueadas | `--blocked` / `--unblocked` |
| Pasos | Con pasos sin tildar | `--pending-steps` |
| Referencias | Con referencias a documentos | `--with-refs` |
| Etiqueta | Las que tienen la etiqueta (varias: alguna de ellas) | `--tag arte,audio` |
| Prioridad | Las de esas prioridades; `none`: sin prioridad | `--priority high,medium` |
| Responsable | Las de ese responsable; `none`: sin responsable | `--assignee Dani` |

- **Web:** la barra de filtros está arriba del tablero y de la lista (desde M13, detrás de *Filtros (n)*: §21). Las etiquetas y los responsables ofrecen los valores que ya existen en el proyecto. Los filtros se recuerdan por proyecto en el navegador, nunca en `compass/`. Cuando hay filtros activos, la barra dice cuántas tareas quedan ocultas y tiene un botón para limpiarlos. `/` lleva al buscador.
- **Vista de lista:** dentro de la vista del tablero, un selector *Tablero | Lista* (la elección se recuerda). Una fila por tarea, con código, título, hito (con "Todos"), estado, pasos `x/y`, fecha límite, bloqueo, prioridad, responsable, etiquetas y las fechas de edición y de creación. Se ordena por columna con un clic en el encabezado (otro clic invierte el orden, un tercero vuelve al manual; las fechas de edición y creación empiezan por la más nueva); por defecto, el orden manual del tablero (hito, `order` y código).
- **Orden del tablero (12.8):** un desplegable *Orden* en la barra (manual, código, título, actualizada, creada, fecha límite, prioridad) y un botón ▲/▼ para el sentido ordenan las tarjetas dentro de cada columna. Es el mismo orden que la lista: elegirlo en una vista lo cambia en la otra, y se recuerda por proyecto como el filtro. Con un orden que no es el manual, arrastrar una tarjeta solo cambia su estado; reordenar a mano requiere el orden manual. No toca datos. Un clic en la fila abre el mismo detalle que el tablero. En el teléfono quedan solo las columnas principales.
- **Edición:** prioridad y responsable se cambian en el detalle; las etiquetas se agregan con sugerencias de las que ya existen y se quitan con ×. La tarjeta del tablero muestra el responsable, la prioridad alta y las etiquetas.
- **CLI:** `add` y `set` aceptan `--tags a,b`, `--priority high|medium|low` y `--assignee nombre` (`""` quita el campo). `list` y `show` muestran los tres campos, y `list` filtra con las opciones de la tabla. Con `--json`, las mismas tareas filtradas.

### 19.1 Criterios de aceptación de M11
<!-- id: criterios-lista-y-filtros -->

- [x] La vista de lista muestra las tareas del hito (o de todos), ordenables por columna, y abre el detalle al hacer clic.
- [x] Tablero y lista se filtran por texto, estado, fecha, bloqueo, pasos, referencias, etiqueta, prioridad y responsable, y el filtro se recuerda al recargar.
- [x] Etiquetas, prioridad y responsable se editan desde la web y desde la CLI, y se ven en `docs/tareas.md`.
- [x] `scompass list` filtra con las mismas reglas que la web.

## 20. Biblioteca de documentos (M12)
<!-- id: biblioteca-documentos -->

**Objetivo:** explorar los documentos del proyecto como una biblioteca: muchos archivos en carpetas, enlaces a documentos enteros (§10.2), búsqueda de texto y el estado de git de cada uno. La app sigue sin escribir documentos ni commitear (D33): lo único que cambia es `config.json › docs`.

- **Agregar y quitar:** `scompass doc add <alias> <ruta|patrón>` y `doc rm <alias>`, `POST` y `DELETE /api/docs`, y en la web *+ Documento* y *Quitar del proyecto*. La ruta se resuelve desde la carpeta actual y se guarda relativa al proyecto. Tiene que estar dentro del proyecto, existir (salvo un patrón) y no ser el export (`docs/tareas.md`). El alias es `[a-z0-9][a-z0-9_-]*`. Un alias o una ruta repetidos fallan con `conflict`. Quitar no toca el archivo. El hub vuelve a vigilar los documentos y avisa con `doc_changed`.
- **Patrones:** `docs/**/*.md` declara todos los markdown de la carpeta.
  - Cada archivo toma como alias el del patrón más su ruta bajo la carpeta base del patrón, sin `.md`. Con `{alias: "docs", path: "docs/**/*.md"}`, `docs/notas/arte.md` es `docs/notas/arte`. Así, dos `README.md` en carpetas distintas no chocan.
  - Un patrón saltea el export, los archivos declarados aparte, las carpetas ocultas y `node_modules`.
  - Un documento que sale de un patrón no se quita solo: se quita el patrón.
  - La plantilla *juego* declara `docs/**/*.md` además del GDD.
  - El dock de Godot expande los patrones con las mismas reglas, sin hub.
- **Búsqueda:** devuelve las líneas que tienen todas las palabras, sin distinguir mayúsculas ni tildes. Cada resultado trae el documento, la sección más chica que contiene la línea y un fragmento alrededor de la primera palabra. Las líneas `<!-- id: … -->` no cuentan. Hay hasta 200 resultados; si hay más, `more: true`.
- **Git:**
  - Cada documento tiene su estado contra HEAD: `clean`, `modified`, `added`, `untracked`, `deleted` o `renamed`. También su último commit y su historia (`git log --follow`).
  - El diff contra HEAD trae las secciones que toca. Una sección cuenta si el diff agrega o borra una línea suya, y con ella cuentan sus secciones padre. Un documento sin seguir se muestra entero como agregado.
  - Fuera de un repo no hay estado (`repo: false`).
  - El hub publica `docs_git` (`{repo, docs: {alias: estado}}`) cuando cambia el estado de algún documento, y siempre después de un `doc_changed`. Mientras haya documentos sin commitear, lo vuelve a mirar, para enterarse del commit.
- **Web:** la vista Documentos es una biblioteca.
  - **Izquierda:** el árbol por carpetas, plegables. Cada documento muestra cuántas tareas lo citan, entero o por sección, y una marca si tiene cambios sin commitear. Debajo, el índice del documento abierto, con una marca en las secciones que toca el diff.
  - **Arriba:** el buscador. Los resultados reemplazan al documento, agrupados por documento y con las palabras resaltadas; un clic lleva a la sección.
  - **Derecha:** la ficha del documento:
    - título y ruta, y de qué entrada sale;
    - estado de git, último commit e historia;
    - las tareas que lo citan y, sin sección elegida, las secciones sin tareas (diseño sin planificar);
    - *Quitar del proyecto*.
  - **Ver los cambios:** con cambios sin commitear, muestra el diff con la sección de cada bloque. Lista las tareas que citan las secciones tocadas, que pueden necesitar revisión.

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/api/docs` | `{repo, docs}`: cada documento con su índice y su estado de git (`git`) |
| `POST` | `/api/docs` | `{alias, path}`: declara un documento o un patrón; 201 con la entrada |
| `DELETE` | `/api/docs/:alias` | Deja de declararlo (204) |
| `GET` | `/api/docs/search?q=` | `{results: [{alias, path, section, title, line, snippet}], more}` |
| `GET` | `/api/docs/:alias/diff` | `{git, diff, sections}`: el diff contra HEAD y las secciones que toca |
| `GET` | `/api/docs/:alias/log` | `{commits: [{hash, date, author, subject}]}`, los últimos 20 |

El alias de un documento de un patrón lleva `/`: en la URL va codificado (`%2F`).

```
scompass doc add <alias> <ruta|patrón>      # "docs/**/*.md" declara la carpeta entera
scompass doc rm <alias>
scompass doc search "<texto>" [--json]
scompass doc status [--json]                # estado de git y último commit de cada documento
scompass doc diff <alias> [--json]          # diff contra HEAD y "Secciones tocadas: …"
```

### 20.1 Criterios de aceptación de M12
<!-- id: criterios-biblioteca -->

- [x] Una tarea puede referenciar un documento entero (ref sin sección o `[[alias]]`), y `refs check` la valida.
- [x] Los documentos se agregan y se quitan desde la CLI y desde la web sin editar `config.json`. La plantilla *juego* declara un patrón de `docs/`.
- [x] La web tiene una biblioteca con:
  - el árbol por carpetas;
  - la búsqueda de texto en todos los documentos;
  - por documento, sus tareas y su estado de git.
- [x] Cada documento muestra si tiene cambios sin commitear, su último commit y el diff contra HEAD.

## 21. UI más compacta (M13)
<!-- id: ui-compacta -->

**Objetivo:** llegar a las tareas sin bajar. Antes, a 1440×900 la primera tarjeta empezaba a ~600 px, y en el teléfono a ~1200 px. La revisión de diseño es del 2026-10-09. No cambia ningún dato ni la API: solo la UI web.

- **Encabezado:** el título del proyecto, "← Inicio" y las vistas (Tablero, Listas, Documentos) van en una sola fila, con la línea del encabezado debajo. Ya no dice "tareas".
- **Hitos:** los terminados van juntos en un desplegable *Terminados (n)*, después de *Todos*. Cada uno muestra su código, su título y su avance. El hito elegido queda en la fila aunque esté terminado.
- **Buscador y filtros:**
  - En la fila del buscador están *Tablero | Lista*, el buscador y el botón *Filtros (n)*. Ese botón abre un panel con los filtros de §19; *n* cuenta los activos del panel.
  - A la derecha están el orden y, con filtros, cuántas tareas quedan ocultas y *Limpiar filtros*.
  - Los filtros y el orden se recuerdan como antes. El panel se abre cerrado.
- **Resumen del hito:** una línea con el título, la barra y el contador. *Hecho cuando ▸* despliega el objetivo y la lista; se llama *Objetivo* si el hito no tiene lista. Abierto o cerrado se recuerda por proyecto en el navegador.
- **Detalle de la tarea:**
  - **Propiedades:** debajo del título, una fila de chips: hito, fecha límite (con hora si hay fecha, y × para quitarla), prioridad, responsable y etiquetas. Son los controles del navegador con forma de chip, así que un clic edita en el lugar. Los vacíos van con borde punteado y texto apagado. Una vencida va en rojo, y una de hoy en ámbar.
  - **Orden:** el estado, los pasos, las notas, las referencias, los vínculos y *Cómo probarlo*.
  - **Al abrir:** el foco va al panel, no al título. El título no tiene borde hasta que se lo enfoca o se le pasa el mouse, y 1–4 cambian el estado enseguida.
  - **Cabecera:** el código de la tarea y el del hito; el nombre del hito queda en el chip.
- **Pasos:** en escritorio, ✎ y × aparecen al pasar el mouse o con el foco. En el teléfono, o sin mouse, se ven siempre y miden 36 px o más.
- **Teléfono (≤ 560 px):**
  - **Encabezado:** dos filas: el título y las vistas. *Nueva tarea* flota abajo a la derecha (desde M14: con cuatro pestañas no entra en la fila).
  - **Hitos:** van en una fila que se desplaza de costado, y la primera vez deja a la vista el elegido.
  - **Arriba del tablero:** el título del hito va en una línea con puntos suspensivos.
  - **Columnas:** se deslizan de costado, una por pantalla con la siguiente asomando, y al soltar encajan en una (M16). Las vacías son angostas: solo el título.
- **Lista:**
  - *Actualizada* y *Creada* dicen la fecha relativa si es de la última semana ("hace un momento", "hace 3 h", "ayer"). Si es más vieja, dicen la fecha corta. La fecha completa va en el tooltip.
  - Las columnas sin ningún valor en las filas que se ven se esconden. La del orden elegido se ve siempre.
- **Código sin ligaduras (13.1):** `code` y `pre` usan `font-variant-ligatures: none`. Si no, JetBrains Mono mostraría `<!--` como una flecha y `!=` como ≠.

### 21.1 Criterios de aceptación de M13
<!-- id: criterios-ui-compacta -->

- [x] En escritorio, a 1440×900, la primera tarjeta empieza antes de los 320 px. En el teléfono, a 390×844, empieza antes de los 450 px.
- [x] En el detalle, los pasos aparecen sin bajar, y las propiedades van en una fila de chips.
- [x] El código de los documentos se ve sin ligaduras, y las acciones de los pasos miden 36 px o más en el teléfono.

## 22. Archivos del repo (M14)
<!-- id: archivos-repo -->

**Objetivo:** ver los archivos del repo y su estado de git desde la web, sin salir del tablero. Es de lectura, como la biblioteca (§20): la app no edita archivos, no agrega a git y no commitea (D34).

- **Qué archivos:** los que git no ignora: los seguidos, incluidos los borrados del disco sin commitear, y los nuevos (`git ls-files --cached --others --exclude-standard`). Lo ignorado no aparece ni se puede pedir. Fuera de un repo, la pestaña lo dice y no muestra archivos.
- **Pestaña Archivos:** va después de Documentos. `config.views` acepta `files`; sin `views` se ven las cuatro (§16.6).
  - **Arriba:** el filtro por nombre y *Solo con cambios (n)*, que muestran una lista plana. También la rama, cuántos archivos hay y *Actualizar*.
  - **Izquierda:** el árbol por carpetas. Las carpetas están plegadas y solo se arman al abrirlas. Cada carpeta dice cuántos archivos con cambios tiene adentro, y cada archivo lleva la marca de git de Documentos (M, N, B, R).
  - **Sin archivo elegido:**
    - la rama, y cuántos commits faltan subir o traer si sigue a una remota;
    - los cambios sin commitear;
    - los últimos 20 commits.
  - **Un archivo:**
    - **Ficha:** el estado, el tamaño, el último commit y el historial. Si es un documento declarado, *Abrir en Documentos*.
    - **Contenido:**
      - el código, resaltado por extensión (`.gd`; `.tscn`, `.tres`, `.godot` e `.import` como ini; json, js, py, cs, glsl, yaml, html, css);
      - el markdown, renderizado;
      - las imágenes (png, jpg, gif, webp).
      - Un binario, un archivo de más de 1 MB o un enlace simbólico no se muestran: se dice qué son. Un enlace no se sigue.
    - **Cambios:** con cambios, *Ver los cambios* muestra el diff contra HEAD. Un archivo modificado abre directamente ahí.
  - **Cuándo se actualiza:** la lista se vuelve a leer al entrar a la pestaña, con cualquier evento del hub, al volver a la ventana y con *Actualizar*. Los cambios hechos en el editor no avisan solos: el hub no vigila el repo entero.
- **Desde el dock:** un botón al lado de *Abrir el tablero* abre la pestaña Archivos en el navegador (si `views` la incluye).
- **Solo local:** el hub y el Inicio atienden solo pedidos dirigidos a `127.0.0.1` o `localhost` (403 si no). Así, una página de otro sitio que hace que su nombre apunte a 127.0.0.1 (DNS rebinding) no puede leer el tablero ni los archivos. Con token (§12), manda el token.

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/api/files` | Devuelve `{repo, branch, ahead?, behind?, files, status, commits}`. Sin repo: `{repo: false, files: []}` |
| `GET` | `/api/files/file?path=` | Devuelve `{path, git, size, commits, kind}`, con `kind` en `text`, `markdown`, `image`, `binary`, `big`, `link` o `missing`. Para `text` y `markdown` trae también `html` |
| `GET` | `/api/files/diff?path=` | Devuelve `{path, git, diff}` contra HEAD; para un nuevo, el archivo entero. Suma `binary` o `truncated` si no hay texto para mostrar |
| `GET` | `/api/files/raw?path=` | La imagen, con `nosniff` y una CSP `sandbox`. Lo que no es imagen da 400 |

Una ruta que git no lista, con `..`, absoluta o de una carpeta da 404.

### 22.1 Criterios de aceptación de M14
<!-- id: criterios-archivos-repo -->

- [x] La web tiene una pestaña Archivos, al lado de Documentos, con el árbol de los archivos del repo y la marca de git de cada uno.
- [x] Un archivo se ve en la web (texto resaltado, markdown renderizado o imagen), con su estado de git, su diff contra HEAD y su historial.
- [x] Sin archivo elegido, la pestaña muestra la rama, los cambios sin commitear y los últimos commits.
- [x] Solo se ven los archivos que git no ignora, y la app sigue sin escribir archivos ni commitear.

## 23. Tareas y archivos del repo (M15)
<!-- id: tareas-archivos -->

**Objetivo:** vincular tareas con los scripts, escenas y demás archivos del repo que tocan, y llegar de una a la otra desde la web y desde el editor de Godot. Es el módulo "Referencias a `res://`" de §11 y el nivel 3 de §11.1 (D35).

- **El dato:** `files` en la tarea, opcional: rutas desde la raíz del proyecto (la carpeta de `compass/`, que es la de `res://`), como las lista la pestaña Archivos (§22): `["player/player.gd", "niveles/nivel1.tscn"]`. Sin repetir; el schema rechaza rutas absolutas, con `..` o con `\`. Sin archivos, el campo no está.
- **CLI:**
  - `scompass file add <tarea> <ruta>` acepta `res://` y `./`, y solo agrega un archivo que la pestaña Archivos sirve: lo que git lista, no lo ignorado.
  - `scompass file rm <tarea> <ruta>` lo quita.
  - `show` y el export markdown los listan.
  - `refs check` marca `missing_file` cuando git ya no lista un archivo citado (se borró o se movió) y sale con 1, como con una sección que ya no existe.
- **Web:**
  - **Detalle:** la sección *Archivos*, entre *Referencias* y *Vínculos*.
    - Cada archivo lleva a la pestaña Archivos con su marca de git.
    - El que git ya no lista se marca *ya no está en el repo*.
    - *×* lo quita, y *+ Agregar* busca por ruta en la lista del repo.
  - **Pestaña Archivos:** la ficha de un archivo suma *Citado por · n tareas*; cada una lleva al tablero con la tarea abierta. Se calcula en la web, que ya tiene todas las tareas: la API no cambia.
- **Dock:**
  - **Detalle:** los archivos de la tarea, en rojo el que no está en el disco. Un clic hace lo mismo que un doble clic en el FileSystem:
    - el script va al editor de scripts (`edit_script`);
    - la escena se abre (`open_scene_from_path`);
    - otro recurso va al inspector.
    - Lo que Godot no abre como recurso (markdown, JSON, o lo que no ve: `compass/` y las carpetas con `.gdignore`) se abre en la pestaña Archivos del navegador; sin hub, el dock lo avisa.
  - **Lo que se edita:** el plugin le avisa al dock qué script (`editor_script_changed`) y qué escena (`scene_changed`) están abiertos.
    - Arriba de la lista van las tareas sin terminar que los citan, de cualquier hito. Un clic lleva a la tarea.
    - Con hub, el detalle ofrece *+ Vincular player.gd* para sumar el script o la escena abiertos a la tarea elegida.
    - Un script incorporado a una escena no es un archivo propio y no cuenta.

### 23.1 Criterios de aceptación de M15
<!-- id: criterios-tareas-archivos -->

- [x] Una tarea puede citar archivos del repo (campo `files`) desde la CLI, la web y el dock; `refs check` avisa los que ya no están.
- [x] En la web, el detalle de la tarea lleva a cada archivo en la pestaña Archivos, y la ficha del archivo muestra las tareas que lo citan.
- [x] En el dock, un archivo de la tarea se abre en el editor de Godot (script, escena o recurso); lo que Godot no ve se abre en la pestaña Archivos.
- [x] Con un script o una escena abiertos en el editor, el dock muestra las tareas que los citan y vincula el abierto a la tarea elegida.

Tests: `docs.test.js` (CLI), `ui-files.test.js` (web) y `dock.test.js` (`task_files`, `editing`). La parte del editor (abrir con `edit_script` y `open_scene_from_path`, y las señales del script y la escena) se comprobó en un editor real sin ventana, con un proyecto de prueba; los tests del dock la simulan.

## 24. Uso en el teléfono (M16)
<!-- id: telefono -->

Con `--lan` (D36) el tablero se abre en el teléfono. Lo que se ajustó al usarlo ahí. Un teléfono puede medir más de 560 px (el primero en que se probó, unos 600), así que además del ancho cuenta que la pantalla sea táctil (`hover: none`):

- **Tablero (≤ 560 px, o táctil hasta 980 px):** las columnas, de hasta 360 px, van lado a lado y se deslizan de costado, una por pantalla con la siguiente asomando, y al soltar encajan en una (`scroll-snap`). Apiladas, quedaban interminables. Las vacías son angostas: solo el título. El desplazamiento se mantiene con los cambios en vivo.
- **Documentos (≤ 760 px, o táctil hasta 1180 px):** el índice y la ficha del documento quedan lejos del texto, así que van en una barra fija abajo. A la izquierda, el índice como desplegable: muestra la sección que se lee y elegir otra salta a ella (16.4). Al lado, las tareas de esa sección: cuántas son y un enlace a cada una, que se deslizan de costado si no entran (o *Sin tareas*). La sección es la que sigue el índice al bajar (§20). No hay barra en un documento sin secciones, en la búsqueda ni en el diff.

- **Campos de texto del detalle** (notas, *Cómo probarlo* y el detalle de un paso): crecen con lo que se escribe (`field-sizing: content`), así no hace falta arrastrar la esquina, que en el teléfono es chica. En los navegadores sin `field-sizing` la esquina sigue estando.

- **Detalle de la tarea:** hasta 760 px ocupa toda la pantalla, porque al lado quedarían menos de 300 px de tablero; más ancho, es el panel de siempre al costado (16.6). Un clic afuera del panel lo cierra (16.5); a pantalla completa se cierra con *Cerrar* o Esc. Si ese clic abre otra tarea (una tarjeta, una fila de la lista), cambia de tarea en vez de cerrar. Cuenta dónde empieza el clic: arrastrar una selección desde las notas hasta afuera no lo cierra.

- **Atrás cierra la tarea (16.7, también en escritorio):** la tarea abierta tiene su ruta, `#task/<id>`. Atrás la cierra y vuelve a la vista desde la que se abrió: el tablero, o Documentos en su sección. Cambiar de tarea con una abierta reemplaza la entrada, así atrás no recorre todas. *Cerrar* deja el tablero sin sumar una entrada igual. Al recargar sigue abierta, y el enlace sirve para abrir una tarea directo. Uno a una tarea que no existe se descarta.

### 24.1 Criterios de aceptación de M16
<!-- id: criterios-telefono -->

- [x] En el teléfono, el tablero se desliza de costado, una columna por pantalla, en vez de apilar las columnas.
- [x] En el teléfono, Documentos muestra fijos abajo el índice, para saltar de sección, y las tareas de la sección que se está leyendo.
- [x] Las notas y los demás campos de texto del detalle crecen con el texto, sin arrastrar la esquina.
- [x] Un clic afuera del detalle de la tarea lo cierra.
- [x] En el teléfono el detalle de la tarea ocupa toda la pantalla; desde 761 px es un panel al costado.
- [x] Atrás cierra la tarea abierta y vuelve a la vista de antes; cada tarea tiene su enlace (`#task/<id>`).

Tests: `ui-filters.test.js` (13.4, a 390×844; 16.1, táctil a 602 px y con mouse a 900), `ui-docs.test.js` (16.2 y 16.4, a 390 y táctil a 900) y `ui.test.js` (16.3, 16.5, 16.6 y 16.7; la vuelta a Documentos, en `ui-docs.test.js`).

## 25. Descripción de las tareas (M17)
<!-- id: descripcion -->

Hasta acá la tarea no tenía dónde decir qué hay que hacer: el pedido iba en las notas, mezclado con lo que salía al trabajarla ("Pedido del usuario … Hecho: …"). Ahora son dos campos (D37):

- **`description`:** qué hay que hacer y por qué. Se escribe al crear la tarea y casi no cambia. Es opcional; sin descripción, el campo no está.
- **`notes`:** lo que va saliendo al trabajarla: decisiones, hallazgos, lo que el siguiente necesita saber.
- **CLI:** `add` y `set` aceptan `--description`; en `set`, `""` la quita. `show` la imprime debajo del título, antes de los pasos.
- **Export markdown:** va como párrafo debajo del título (y de vence, prioridad, responsable y etiquetas), antes de los pasos.
- **Enlaces:** `[[alias#id]]` en la descripción cuenta como en las notas: `refs check`, `refs suggest` y las tareas de cada sección la miran.
- **Web (17.2):** en el detalle, *Descripción* va debajo del estado y antes de los pasos, así la tarea arranca por lo que hay que hacer. Crece con el texto, como las notas, y muestra sus enlaces. Borrada entera, el campo se quita.
- **Dock (17.2):** la descripción en el mismo lugar, de solo lectura, como la fecha y las propiedades.
- **Migración (17.3):** en las tareas de este repo, lo que las notas decían antes de "Hecho:" pasó a la descripción, y las notas quedaron desde "Hecho:". Las que arrancaban con el pedido sin "Hecho:" se cortaron en la primera oración, y las que eran solo un plan (12.1, 10.10, 7.2, 8.15) pasaron enteras. Las notas que son solo registro de lo hecho (casi todo M1–M9) quedaron como estaban, sin descripción.

### 25.1 Criterios de aceptación de M17
<!-- id: criterios-descripcion -->

- [x] Una tarea tiene una descripción opcional (campo `description`), separada de las notas, que la CLI escribe y el export muestra antes de los pasos.
- [x] El detalle de la tarea muestra la descripción antes de los pasos: en la web se edita; en el dock se lee.
- [x] Las tareas de este repo que tenían el pedido en las notas lo tienen en la descripción.

Tests: `cli.test.js` y `docs.test.js` (17.1), `ui.test.js` y `dock.test.js` (`props`) (17.2).

## 26. Fechas, capturas e historial (M18)
<!-- id: fechas-capturas-historial -->

- **`done_at` (18.1):** cuándo pasó la tarea a Hecho. Lo pone el store al escribir, así vale igual para la CLI, la API, la web y el dock:
  - al pasar a `done`, la hora de la escritura (o la que traiga el documento, para importar);
  - mientras sigue hecha, se conserva aunque se edite, y un `put` sin el campo no lo pierde;
  - al salir de `done`, se quita; si vuelve, la fecha es la nueva.
  - Una tarea hecha de antes del campo no lo recibe al editarla: no se inventa. En este repo se completaron desde git: el `updated_at` de la tarea en el commit que la dejó hecha (exacto si la app la pasó a Hecho; aproximado si se creó y terminó en el mismo commit).
  - Se ve en `show` (*Hecho el 2026-10-10*), en el export (**Terminada:**), en el pie del detalle, en la columna y el orden *Terminada* de la lista, y en el Inicio: *n tareas terminadas en los últimos 7 días*.
- **Fecha objetivo del hito (18.2):** `due` opcional en el hito, con el formato de las tareas. El hito está *atrasado* si la fecha pasó y le quedan tareas sin terminar; con todas hechas, la fecha queda como dato. Un hito sin tareas cuenta como pendiente.
  - CLI: `milestone set <id> --due …` (`""` la quita). Por el hub el hito se reescribe entero con su etag, porque la API no tiene PATCH de hitos (D12). `milestone list`, `milestone show` y los encabezados de `list` dicen *fecha objetivo … (atrasado)*; el export, **Fecha objetivo:**.
  - Web: el resumen del hito dice *Objetivo 01/11*, *Hoy · …* o, en rojo, *Atrasado · …*; el chip de un hito atrasado tiene el borde rojo. Se edita con la CLI, como el resto del hito.
  - Dock: el selector de hito suma *· atrasado 01/11*.
  - Inicio: la tarjeta del proyecto marca *atrasado* (u *objetivo hoy*) junto al hito actual.
- **Estimación (18.3):** `size` opcional en la tarea: `s`, `m` o `l` (en pantalla, S, M y L). Es para ver cuánto queda en un hito, no para medir horas.
  - CLI: `add` y `set --size` (sin distinguir mayúsculas; `""` la quita), `list --size s,m,l,none`; `show` y `list` dicen *tamaño M*; el export, **Tamaño:**.
  - Web: chip *Tamaño* en el detalle, la letra en la tarjeta y en la columna *Tamaño* de la lista (con su orden), y el filtro *Tamaño* (con *Sin estimar*). El resumen del hito dice lo que falta: *Falta 2 S · 1 M · 3 sin estimar*, solo si alguna tarea sin terminar está estimada.
  - Dock: *Tamaño M* en las propiedades del detalle.
- **Capturas (18.4, D38):** `images` en la tarea: rutas desde la raíz del proyecto a imágenes PNG, JPEG, GIF o WebP, sin repetir. Son aparte de `files` (lo que la tarea toca): una captura muestra el bug o el efecto.
  - **Dónde quedan:** una imagen del repo se cita tal cual. Una pegada, subida o traída de fuera del proyecto se guarda en `compass/images/<tarea>-<AAAAMMDD-HHMMSS>.<ext>`, después de verificar por su contenido que es una imagen (hasta 10 MB). `compass/.gitattributes` las marca binarias (sin eso, `eol=lf` les cambiaría los bytes).
  - **Al quitarla:** sale de la tarea; si está en `compass/images/` y ninguna otra tarea la cita, se borra el archivo, así las pegadas no se acumulan. Una imagen del repo citada a mano nunca se borra.
  - **CLI:** `image add <tarea> <ruta>` (del repo, con `res://` o `./`, o de afuera: se copia) e `image rm`. `refs check` marca `missing_file` la que ya no está; el export, **Capturas:**.
  - **API:** `POST /api/tasks/:id/images` con `{ data }` (base64, con o sin el prefijo `data:`) y `DELETE /api/tasks/:id/images?path=…`; las dos aceptan `If-Match`. Se sirven con `/api/files/raw`, así que hace falta un repo de git, como en Archivos.
  - **Web:** miniaturas debajo de la descripción y *+ Captura* (en el teléfono abre la cámara o la galería). Con una tarea abierta, pegar una imagen o soltarla sobre el detalle también la agrega. Un clic abre el visor: ← y → recorren, Esc lo cierra sin cerrar la tarea, *Quitar* la saca.
  - **Dock:** miniaturas en el detalle; un clic la abre con el visor del sistema. La que no está en el disco se ve como *⚠ nombre*.
- **Historial (18.5):** lo que cambió en la tarea en cada commit, sacado de git; la app no guarda otro registro.
  - Por commit: fecha, autor, hash y un renglón por campo que cambió (*Estado: Pendiente → En curso*, *Pasos: +«x», tildado «y»*, *Etiquetas: +arte −audio*, *Notas: editadas*). No cuentan `order` ni los sellos de fecha; un commit que solo cambió eso no aparece. Arriba, lo que hay sin commitear contra HEAD.
  - Todas las versiones del JSON se leen con un solo `git cat-file --batch`; hasta 30 commits.
  - CLI: `scompass history <id>` (`--json`). API: `GET /api/tasks/:id/history` → `{ repo, entries: [{ hash, date, author, subject, created?, deleted?, changes }] }`; sin repo, `{ repo: false, entries: [] }`.
  - Web: *Historial* plegado al final del detalle; se pide al abrirlo y otra vez cuando la tarea cambia.
- **Plantilla de descripción por etiqueta (18.6):** `config.json` › `description_templates`: `{ "<etiqueta>": "<texto>" }`. Al sumarle a una tarea sin descripción una etiqueta con plantilla, la descripción arranca con ese texto; con descripción, no se toca. Vale para `scompass add --tags` (sin `--description`), `set --tags` y las etiquetas que se agregan en el detalle de la web. La plantilla *juego* trae una para `bug`: *Cómo reproducirlo / Qué se esperaba / Qué pasó*. Se edita en `config.json`.
- **Vínculos entre hitos (18.7):** un vínculo del detalle a una tarea de otro hito la abre y lleva el tablero a ese hito, como los enlaces de Documentos.

### 26.1 Criterios de aceptación de M18
<!-- id: criterios-fechas-capturas-historial -->

- [x] Cada tarea hecha dice cuándo se terminó (done_at), y el Inicio cuenta las terminadas en los últimos 7 días.
- [x] Un hito puede tener fecha objetivo; pasada con tareas sin terminar, la CLI, la web, el dock y el Inicio lo marcan atrasado.
- [x] Una tarea se puede estimar (S, M o L); la lista la filtra y ordena, y el resumen del hito dice cuánto falta por tamaño.
- [x] Una tarea tiene capturas: en la web se pegan, se sueltan o se suben (en el teléfono, con la cámara), se ven en miniatura y en un visor; la CLI y el dock también las manejan.
- [x] El detalle de la tarea y scompass history muestran qué cambió en cada commit, sacado de git.
- [x] Etiquetar una tarea sin descripción con una etiqueta que tiene plantilla (como bug) arranca la descripción con esa plantilla.

Tests: `store.test.js` y `home.test.js` (18.1, 18.2), `cli.test.js` (18.1–18.4, 18.6), `api.test.js` (18.4), `history.test.js` (18.5), `ui.test.js` (18.1–18.7) y `dock.test.js` (`props`: 18.2–18.4).


## 27. Auditoría (M19)
<!-- id: auditoria -->

Lo que encontró la auditoría completa después de M18 (seguridad, backend, web y dock), arreglado por partes.

- **Watcher (19.1):** en Linux, `fs.watch` recursivo deja de avisar de un archivo después de que se lo reemplaza con un rename (`writeAtomic`, `git checkout`, `sed -i`, muchos editores), así que los cambios hechos fuera del hub dejaban de llegar a la web y al dock. `watch-tree.js` mira cada carpeta por separado, sin recursión, y suma las que aparecen (una carpeta de colección vuelta a crear al cambiar de rama dispara un rescan). Lo usan el watcher de `compass/` y el de los documentos con patrón. En macOS y Windows sigue el recursivo nativo.
- **Rutas dentro del proyecto (19.2):** `config.json` viene con el repo y la API se puede abrir en la LAN, así que nada de lo que dicen puede leer ni escribir fuera del proyecto (`paths.js`):
  - `export_md` y la ruta de cada documento tienen que ser un `.md` relativo, sin `..`, llaves, `\` ni rutas absolutas (el `pattern` del schema de config); el export, además, no escribe a través de una carpeta que es un enlace afuera. `scompass export --out` queda libre: lo elige quien lo corre.
  - `POST /api/docs` rechaza lo que git ignora (un `.env`) y lo que no es `.md`; un patrón no toma un archivo enlazado afuera, y un documento declarado a mano que lleva afuera queda como `missing_doc` (*fuera del proyecto*).
  - `compass/images` como enlace simbólico afuera no recibe capturas, y quitar una no borra nada de afuera.
  - `repoFile` no deja pasar una ruta con el nombre de una clave heredada (`constructor`).
- **Historial en una subcarpeta (19.3):** si el proyecto no está en la raíz del repo, `git cat-file` con `<hash>:compass/tasks/…` no encontraba nada y el historial quedaba vacío; ahora pide `<hash>:./compass/tasks/…`, relativo a la carpeta del proyecto. `scompass history` muestra todas las horas en hora local (lo sin commitear venía en UTC).
