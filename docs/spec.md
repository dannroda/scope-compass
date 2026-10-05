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

**Task** (`tasks/<id>.json`)

| Campo | Tipo | Notas |
|---|---|---|
| `milestone` | string | Id del hito (`"m00"`) |
| `code` | string | `"0.3"`; puede estar vacío |
| `order` | number | Orden dentro de la columna |
| `title` | string | |
| `status` | `"todo" \| "doing" \| "review" \| "done"` | |
| `checklist` | `{ text: string, done: boolean, detail?: string }[]` | `text`: el paso en una línea. `detail` (opcional): el cómo y el porqué; se muestra plegado debajo del paso |
| `due` | string | Opcional. Fecha límite, `YYYY-MM-DD` o `YYYY-MM-DDTHH:MM` en hora local (§16.5, D26) |
| `test` | string | "Cómo probarlo" |
| `notes` | string | |
| `refs` | `{ doc: string, section: string }[]` | Opcional. Referencias a secciones de documentos (§10). v1 las guarda y las muestra como texto; v2 las resuelve. |
| `links` | `{ type: "blocks" \| "related", task: string }[]` | Opcional. Vínculos con otras tareas (D22): `blocks` = esta tarea bloquea a `task`; `related` = relacionadas. El inverso ("bloqueada por") no se guarda, se calcula. |
| `created_at` / `updated_at` | ISO 8601 | `updated_at` es opcional en ediciones a mano; la app lo completa en su próxima escritura |

**Ids:** los hitos usan `m00`…`m99`. Las tareas importadas conservan su id (`m0-01`). Las tareas nuevas usan un id corto aleatorio (por ejemplo 8 caracteres base36), válido como nombre de archivo en Windows y Linux.

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

## 5. Servidor
<!-- id: servidor -->

### 5.1 Arranque
<!-- id: arranque -->

```
npx scompass serve [--dir <proyecto>] [--port 4711] [--open]
```

- Escucha **solo en `127.0.0.1`**. No hay autenticación porque no sale de la máquina.
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
scompass add "<título>" --milestone m00 [--code 0.11]
scompass move <id> <todo|doing|review|done>
scompass check <id> <n> [--undo]             # n desde 1, como lo muestra `show`
scompass set <id> --file task.json          # reemplazo completo, para cargas grandes
scompass set <id> [--title] [--notes] [--test] [--code] [--milestone] [--status]   # solo esos campos
scompass milestone list | show <id> | set <id> --file m.json
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
- **Enlaces en línea** dentro de `notes`, `test` y los pasos: `[[gdd#ventanas-ataque]]`. Se muestran como un enlace con el título actual de la sección. `gdd` es el alias del documento definido en `config.json`.

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
| **Referencias a `res://`** | Vincular tareas con escenas, scripts y recursos; desde el dock, abrir el archivo | Cierra el ciclo tarea ↔ código |
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
   - **Tareas del script abierto:** con la señal `editor_script_changed` del `ScriptEditor`, el dock muestra las tareas vinculadas a ese archivo (requiere las referencias a `res://` del módulo de la tabla).
   - **Abrir desde la tarea:** `EditorInterface.edit_script(script, línea)` o `EditorInterface.open_scene_from_path(path)` para saltar al archivo vinculado.
   - **Levantar el servidor desde el plugin:** `OS.create_process("node", [...])` al activar el plugin y `OS.kill(pid)` al desactivarlo, así no hace falta abrir una terminal.

**Desde el juego (debug):** en builds de debug, un atajo en el juego puede mandar un reporte a `POST /api/tasks` con captura de pantalla, escena y posición del player. Es la base del módulo de bugs y playtests.

**Riesgo conocido:** Godot 4.8 cambió el sistema de pantallas del editor (por eso hubo que parchear la UI de LimboAI). Hay que verificar que la API de docks funcione en la versión del proyecto antes de diseñar la UI del plugin, y preferir un dock a una pestaña de main screen.

**Regla para no desbordar el alcance:** cada módulo entra solo cuando el proyecto lo necesita de verdad, y después de que v1 esté en uso diario. Primero v1, después v2 (documentos). El resto queda como dirección, no como plan.

## 12. Hosting privado (más adelante)
<!-- id: hosting -->

**Objetivo:** ver y editar el tablero desde el teléfono sin tener la PC encendida, en un servidor privado.

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
- [x] Corre en Linux. Windows queda para después de v1 (D15).

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
  - `GET /ws`: `changed { path, collection, id }` (reenviado de los hubs o de una escritura directa), `hubs` (cambió el conjunto de hubs vivos) y `projects` (cambió el registro). El Inicio mira el registro de hubs cada segundo y se suscribe al WebSocket de cada hub vivo.
- Un segundo `scompass home` no levanta otro: dice dónde corre el primero (y lo abre con `--open`). Puerto 4700, o el siguiente libre.

### 16.3 Bandeja agrupada
<!-- id: v3-bandeja -->

Si el Inicio corre con `--tray`, **es el único ícono**: los hubs con `--tray` esconden el suyo y aparecen dentro del menú del Inicio, cada uno con Abrir, Actualizar compass/ (solo si su schema o su `AGENTS.md` quedaron viejos), Reiniciar y Detener, más "Abrir Inicio" y "Agregar proyecto…". Los hubs miran el registro de hubs vivos: cuando aparece un `home`, quitan su ícono; si el `home` muere, lo vuelven a poner. Así no se llena la bandeja.

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
- API y WebSocket: `GET/PUT/PATCH/DELETE /api/lists[/:id]`, y los mismos `upsert`/`delete` que las tareas con `collection: "lists"`. La web y el dock ignoran las colecciones que no muestran.

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

- **`views` en `config.json`:** las pestañas del proyecto, en orden; la primera es la que abre. Valores: `board`, `lists`, `docs`. Sin `views`, se ven las tres con el tablero primero (lo de hoy).
- **Plantillas:** `scompass init --template juego|personal|vacio`. Una plantilla es un `config.json` prearmado más datos iniciales; no tiene código propio. Cada una es un archivo `hub/templates/proyectos/<nombre>.json` con `{ description, config?, milestones?, lists?, files? }`: `config` se mezcla con la config base, hitos y listas se escriben con el Store, y `files` crea archivos del proyecto solo si no existen. Una plantilla desconocida no crea nada.
  - `juego`: `views` = board, lists, docs; hito M0 "Prototipo"; listas "Ideas sueltas" y "Assets a conseguir"; el documento `gdd` (`docs/gdd.md`, con un esqueleto con ids si no existe).
  - `personal`: `views` = lists, board; listas "Pendientes" y "Compras"; un hito "General" para el tablero (en vez de hacer opcionales los hitos).
  - `vacio` (por defecto): lo que hacía `scompass init`, sin datos ni export.
- `init` también anota el proyecto en el registro (§16.1).
- Más adelante: plantillas propias en `~/.config/scope-compass/templates/`.

### 16.7 Fuera de v3
<!-- id: v3-fuera -->

Notificaciones y recordatorios, repetición personalizada (cada x días), listas en el dock de Godot, un hub con varios proyectos, mirror always-on (§12).

### 16.8 Criterios de aceptación de v3
<!-- id: criterios-v3 -->

- [ ] Con el Inicio abierto, levantar un hub desde el dock lo muestra como activo en menos de 1 s, y el proyecto queda en `projects.json`.
- [ ] Importar una carpeta con `compass/` la muestra en el Inicio sin levantar su hub; prenderlo y apagarlo desde el Inicio funciona.
- [ ] Tildar un ítem en "Hoy" cambia una sola línea del JSON de la lista, con hub o sin hub.
- [ ] Un ítem mensual con `due` 2026-01-31 pasa a 2026-02-28 al tildarlo.
- [ ] `scompass init --template personal` crea un proyecto que abre en Listas.
- [ ] Con el Inicio en `--tray`, hay un solo ícono en la bandeja aunque haya tres hubs con `--tray`; al cerrar el Inicio vuelven los suyos.
- [ ] Borrar `~/.config/scope-compass/` no pierde ningún dato: solo hay que volver a importar los proyectos.
