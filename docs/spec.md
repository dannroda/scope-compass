# Spec — Scope Compass

Organizador de proyectos de videojuegos: tablero de tareas por hito, con los datos en git, una app local (CLI + hub + UI web) y un dock para el editor de Godot.

**Estado:** en diseño. Plan de implementación en el tablero del repo (`compass/`, ver `README.md`). Prioridad actual: que funcione **local**.
**Nombre:** Scope Compass. CLI: `scompass`. Carpeta de datos en cada proyecto: `compass/`.
**Origen:** un tablero hecho como artifact de Claude para un proyecto de juego (creado el 2026-09-29), que fue también el primer proyecto usuario.
**Referencias en este repo:**
- `docs/reference/tablero-artifact.html`: el código fuente completo del artifact (UI + lógica), base del port de §7.
- `tools/artifact_to_md.py`: prototipo del export a markdown (§6, `export md`).
- `tools/artifact_to_tablero.py`: prototipo del import desde el artifact (§8).
- `docs/decisiones.md`: registro de las decisiones tomadas y por qué.
- Mockups de la app web, el teléfono y el dock de Godot: se hicieron como artifact, fuera del repo.

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

- Hitos como pestañas, con objetivo, criterio de "Hecho cuando" y progreso (tareas hechas / total). Las de Revisión cuentan como hechas en el progreso, porque ya están hechas y solo falta comprobarlas; se dice cuántas son y van en ámbar al final de la barra. Un hito está terminado cuando todas están en Hecho.
- Vista "Todos" con conteo por estado.
- Tablero de 4 columnas: Pendiente, En curso, Revisión, Hecho (5 desde M20, con Pausado al lado de Pendiente: §28).
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
| `status` | `"todo" \| "paused" \| "doing" \| "review" \| "done"` | `paused` (Pausado) desde M20 (§28) |
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
| `playtest` | `{ result?: "pass" \| "fail", note?: string }` | Opcional. Cómo salió al probarla en una sesión de playtest; el mismo en todas las sesiones que la tienen (§28, D40) |
| `decisions` | `{ text, why?, alternatives?, asked?: true, reply?, review?: "ok" \| "revert" \| "reverted", promoted?, session?, at }[]` | Opcional. Decisiones tomadas al trabajarla, en orden; el store pone `at` a las nuevas (§31, D42) |
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
- Si dos ramas cambian la misma tarea, el merge driver de Scope Compass (§44) junta los cambios campo por campo; solo queda un conflicto de git si los dos lados cambiaron lo mismo, y se resuelve como cualquier otro. Mientras el archivo tenga marcadores de conflicto, la app lo marca como inválido (§4.3) y no lo pisa.
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
{"type": "hello", "server_version": "1.0.0", "protocol": 1}
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
scompass rm <id>                              # borra la tarea y sus capturas que nadie más cita; los vínculos hacia ella quedan rotos
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

- **Mismo hub, otro lugar:** el mismo `scompass home` (el binario o el paquete de npm), sirviendo los tableros de un clon del repo de tableros (§12.1). **El `Store` sigue siendo archivos JSON.** Corre como un servicio de usuario de systemd, igual que en este equipo y sin Docker (D57).
- **Privacidad:** sin exponerlo a internet: dentro de Tailscale, con el teléfono y este equipo en la misma red privada (D36). Alternativa, si algún día hace falta: un túnel con login delante (por ejemplo Cloudflare Tunnel + Access).
- **Autenticación:** se activa el token del hub. El plugin de Godot y la CLI lo mandan en cada request y al abrir el WebSocket (`wss://`).
- **Teléfono:** la misma UI web como PWA instalable, con caché del último estado para leer sin conexión.
- **Chat:** solo en este equipo. El servidor no tiene una cuenta de Claude, y el chat solo atiende a `127.0.0.1` y se apaga con token (§32).
- **Migración local → hosteado:** no hay migración de datos: el servidor clona el repo de tableros.

### 12.1 Espejo de los tableros entre este equipo y el servidor (M7)
<!-- id: git-sync -->

Pedido: revisar tareas y decisiones desde el teléfono con este equipo apagado, con lo de acá y lo del servidor como espejos. Desde §36 los tableros viven en el repo de tableros del usuario (`<datos>/boards`, con `origin` en GitHub), separado del código de los proyectos, así que lo que se espeja es ese repo, no los proyectos. **Git sigue siendo el almacenamiento** (§1), y el merge driver (§44) junta los cambios de los dos lados a la misma tarea.

- **Qué se espeja:**
  - El repo de tableros entero: un solo clon en el servidor alcanza para todos los proyectos. Antes, cuando el tablero vivía en el repo de cada proyecto, hacía falta un clon por proyecto, con el código adentro.
  - Un tablero con su propio repo (un repo por tablero) es un clon más.
  - Un tablero local (dentro del repo del proyecto) no se espeja: primero `scompass board move`.
- **Documentos:** viven en el repo de cada proyecto, no en el de tableros. Sin un clon del proyecto, el servidor muestra el tablero sin la vista Documentos, y las referencias se ven como texto (sin desplegar la sección). Un proyecto cuyos documentos se quieran leer en el teléfono se clona además, de solo lectura (`pull`, nunca `push`).
- **Ramas:** el servidor no escribe en la rama de trabajo (`main`).
  - Escribe en una rama propia, `compass-sync`, y cada vez que sincroniza junta `origin/main` en ella. Así, lo que se pushea desde acá le llega.
  - Acá, la rama del servidor se trae con aviso (m7-05): el Inicio y el dock muestran «hay cambios del servidor» y un botón la junta en `main`, con el merge driver.
  - Nada se commitea solo en la rama de trabajo de este equipo: commitear el tablero sigue siendo una decisión del usuario (§4.5). Si hay cambios sin commitear en los mismos archivos, el botón pide commitearlos antes, porque git no junta sobre un archivo modificado.
- **Commits del servidor:** solo en la carpeta de tableros. Van agrupados (por ejemplo, 30 s sin cambios hacen un commit «compass: m0-03 → doing, 2 pasos tildados»), con un autor propio (`scompass-bot`) para distinguirlos en el historial, y con push enseguida.
- **Conflictos:** el servidor hace `fetch` periódico y antes de cada push. Junta `origin/main` en `compass-sync` con el merge driver.
  - Si queda un conflicto (los dos lados cambiaron el mismo campo), **no hace push ni fuerza nada**: deja el merge sin hacer, muestra un aviso en la UI y sigue sirviendo su versión.
  - El conflicto se resuelve acá, al traer la rama, como cualquier otro de git.
- **Pérdida:** si el servidor muere, solo se pierde lo que no llegó a pushear. El aviso de «cambios sin sincronizar» en la UI del servidor hace visible ese riesgo.
- **Cómo corre:** un servicio de usuario de systemd con `scompass home` (D57). Es lo nativo, igual que en este equipo, sin Docker.
- **Dónde corre:** todavía sin decidir. Puede ser un equipo de casa siempre prendido o un VPS chico, siempre dentro de Tailscale. m7-05 y m7-06 quedan para cuando se decida.

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

Mockups: se hicieron como artifact, fuera del repo.

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
  - `GET /api/projects`: registro + estado del hub + resumen (hito actual con su avance, en curso, las 3 que siguen, listas con pendientes, de hoy y vencidos). Cada proyecto con repo trae `worktree: { repo, main, branch }` (23.2): `repo` es el mismo en todos los worktrees de un repo (el `.git` común, más la carpeta del proyecto dentro del repo) y `main` marca el worktree principal; `GET /api/today` lo pone en `project.worktree`.
  - `POST /api/projects { path }` importa; `DELETE /api/projects?path=…` quita del registro.
  - `GET /api/today`: ítems y tareas vencidos o de hoy (sin terminar) y tareas en curso, de todos los proyectos; vencido primero.
  - `POST /api/projects/check-item { path, list, n, etag? }` (usa la misma regla que la CLI: lo que se repite avanza) y `POST /api/projects/move-task { path, id, status, etag? }`. Responden `via: "hub" | "disk"`.
  - `POST /api/projects/start { path }`: levanta `scompass serve --exit-on-stdin-close` como hijo del Inicio y espera a que se anote (si ya hay hub, lo devuelve). `POST /api/projects/stop { path, force? }`: `SIGTERM` y espera a que cierre. El registro marca `attached` y `parent` en los hubs atados a otro proceso; si no es un hijo del Inicio (el dock), `stop` responde `409` con `foreign: true` hasta que se confirme con `force`.
  - `GET /ws`: `changed { path, collection, id }` (reenviado de los hubs o de una escritura directa), `hubs` (cambió el conjunto de hubs vivos) y `projects` (cambió el registro). El Inicio mira el registro de hubs cada medio segundo y se suscribe al WebSocket de cada hub vivo.
- `GET /api/templates` (con `data_dir`) y `POST /api/projects/init { name, template, parent? }`: crear un proyecto desde el Inicio, con la misma `scompass init` (en otro proceso). La carpeta es `<parent>/<nombre>`, con el nombre tal cual; `parent` es por defecto `$XDG_DATA_HOME/scope-compass` (D28), así "Vida" queda en `~/.local/share/scope-compass/Vida`. Si esa carpeta ya existe, `409`. Fuera de todo repo, recibe `git init`.
- `POST /api/pick-folder { start? }`: el botón "Elegir otra carpeta…" de la página. El navegador no da rutas, así que el diálogo lo abre el Inicio (`kdialog` o `zenity`). Devuelve `{ path }` o `{ cancelled: true }`, o `404` si no hay selector (entonces la página muestra un campo para escribir la ruta).
- **Página** (`web/home.html`, `home.js`, `home.css`, con los tokens y las fuentes de `app.css`; desde M31, ordenada para el uso personal, §34): la franja Hoy (tildar ítems; las tareas enlazan al tablero si su hub está vivo; lo vencido y lo de hoy van sueltos arriba, y lo que solo está en curso en un grupo plegable por proyecto, 23.1, que se recuerda en el navegador; los worktrees de un repo son un solo proyecto: una tarea o un ítem que está en varios es una fila, la del worktree principal, con `⎇ <carpetas>` si no está en todos; dos repos con el mismo nombre se distinguen por la carpeta), una tarjeta por repo (la del worktree principal, con la rama y los otros worktrees adentro: carpeta, rama, cuántas en curso, Abrir y Quitar; 23.2) con (hub, hito actual con su avance, en curso y lo que sigue, listas con vencidos y de hoy, Prender o Apagar, Quitar, Abrir tablero) y Agregar proyecto (importar carpeta o crear con plantilla). Se recarga con los eventos del WebSocket.
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
- `interval` (desde M31, §34): `{ "every": "day", "interval": 3 }` es cada 3 días. Entero desde 1; sin él vale 1 y no se escribe, así los archivos de antes siguen igual. Tildar avanza `interval` períodos con la misma regla.
- **Sin notificaciones** por ahora: involucran coordinar todos los procesos.

### 16.6 Vistas y plantillas
<!-- id: v3-plantillas -->

- **`views` en `config.json`:** las pestañas del proyecto, en orden; la primera es la que abre. Valores: `board`, `lists`, `docs`, desde M14 `files` (§22), desde M20 `playtest` (§28) y desde M24 `decisions` (§31). Sin `views`, se ven todas con el tablero primero.
- **Plantillas:** `scompass init --template clean-room|juego|personal|vacio`. Una plantilla es un `config.json` prearmado más datos iniciales; no tiene código propio. Cada una es un archivo `hub/templates/proyectos/<nombre>.json` con `{ description, config?, milestones?, lists?, files?, kept_hint? }`: `config` se mezcla con la config base, hitos y listas se escriben con el Store, y `files` crea archivos del proyecto solo si no existen. `kept_hint` da, por archivo, el mensaje de `init` cuando ya existía (en lugar de «no se tocó»), para decir qué agregarle a mano. Una plantilla desconocida no crea nada.
  - `juego`: `views` = board, lists, docs, files; hito M0 "Prototipo"; listas "Ideas sueltas" y "Assets a conseguir"; el documento `gdd` (`docs/gdd.md`, con un esqueleto con ids si no existe).
  - `personal`: `views` = lists, board; listas "Pendientes" y "Compras"; un hito "General" para el tablero (en vez de hacer opcionales los hitos).
  - `vacio` (por defecto): lo que hacía `scompass init`, sin datos ni export.
  - `clean-room` (M30, D54): reimplementación a sala limpia.
    - `views`: board, docs, decisions, files. Hito M0 "Observación".
    - Documentos: `clean-room` (`docs/clean-room.md`, las reglas), `comportamiento` (lo observado del original, que es la especificación) y `preguntas` (lo que falta observar, contestado solo con lo que se vio).
    - Las reglas: qué no se lee (el fuente original, sus repos, la memoria de sesiones que lo leyeron), qué se escribe (comportamiento observable, datos, nombres propios) y qué nunca (código, pseudocódigo traducido, nombres internos aunque sean camelCase genéricos, direcciones). También dicen que eso último lo revisa una persona, con git como rastro, porque ningún patrón lo atrapa.
    - Crea un `AGENTS.md` en la raíz del proyecto, que los agentes cargan solos, apuntando a las reglas y a `compass/AGENTS.md`. Si ya existe, no lo toca: `init` dice qué agregarle.
    - `forbidden` (§42) de ejemplo, genérico: nombres de archivos de C/C++/asm y nombres que genera un descompilador (`FUN_…`, `sub_…`, `DAT_…`). Las direcciones en hexadecimal no van porque se escriben igual que un color.
    - En el Inicio aparece al final ("Sala limpia"); Juego sigue elegida por defecto.
- `init` también anota el proyecto en el registro (§16.1).
- Más adelante: plantillas propias en `~/.config/scope-compass/templates/`.

### 16.7 Fuera de v3
<!-- id: v3-fuera -->

Notificaciones y recordatorios, repetición en días fijos de la semana (cada x días llegó en M31, §34), listas en el dock de Godot, un hub con varios proyectos, mirror always-on (§12).

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

- **Con el Inicio corriendo, el Inicio sirve cada proyecto** en `/p/<clave>/`: tablero, API, WebSocket, detección de cambios y export. Es el mismo código del hub, montado bajo esa ruta, y se activa la primera vez que se lo pide. La clave sale del nombre de la carpeta (`vida`, `mi-juego`), sin repetirse.
- **Sin Inicio, el hub suelto sigue igual** (`scompass serve`, el dock).
- **Un solo proceso escribe cada `compass/`.** El registro de hubs anota quién sirve cada proyecto: un hub suelto, o el Inicio con su ruta (`base: "/p/<clave>"`). Si ya hay un hub suelto de un proyecto, el Inicio le reenvía los pedidos (HTTP y WebSocket) en lugar de servirlo él.
- **CLI y dock** encuentran el proyecto en el registro y usan su `base`. El "Iniciar hub" del dock, con el Inicio corriendo, activa el proyecto en el Inicio en lugar de levantar otro proceso. Desde 21.1 el dock lo hace solo al abrirse, en Reintentar y en el sondeo sin hub; si el Inicio se niega, no insiste hasta Reintentar.
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
scompass doc changed <alias>[#<id>] --since <etag> [--json]   # qué cambió desde una versión (§41)
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
  - **Al abrir:** el foco va al panel, no al título. El título no tiene borde hasta que se lo enfoca o se le pasa el mouse, y 1–5 cambian el estado enseguida (en el orden de las columnas).
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
  - **API:** `POST /api/tasks/:id/images` con `{ data }` (base64, con o sin el prefijo `data:`) y `DELETE /api/tasks/:id/images?path=…`; las dos aceptan `If-Match`. Se sirven con `/api/files/raw`; sin repo de git, solo las imágenes que están en el disco dentro del proyecto (19.6).
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
- **`--file` con la salida de `show --json` (19.4):** `set --file` y `milestone set --file` ignoran `id` y `etag` del archivo (sin hub fallaban por el schema); el `etag`, si no se pasa `--etag`, va como `If-Match`, así que reescribir un `show` viejo es un conflicto y no pisa lo que cambió después. Un `id` de otro documento es un error de uso. En la API, `If-Match: *` es *cualquier versión*, como no mandar la cabecera (antes daba 409).
- **Registro y claves del Inicio (19.5):** cada entrada del registro se escribe en un temporal y se renombra, así otro proceso nunca lee una a medio escribir; y `listHubs` borra una entrada solo si murió el proceso de su nombre (antes borraba la de un hub vivo si la leía rota). Las claves `/p/<clave>/` del Inicio no se corren al quitar un proyecto: el que ya tenía `vida-2` la conserva mientras viva el Inicio, así una pestaña abierta o la base anotada en el registro no pasan a otro proyecto.
- **Capturas sin git (19.6):** en un proyecto sin repo, `/api/files/raw` y `scompass image add` aceptan una imagen que está en el disco dentro del proyecto (sin enlaces que lleven afuera), y `refs check` mira el disco en vez de lo que lista git. Sin repo no se sirve ningún otro archivo.
- **Export con textos de varias líneas (19.7):** un título (de tarea, hito o lista), un paso, un *hecho cuando* o un ítem con saltos de línea van en un renglón; en la descripción, la meta, la prueba y las notas, un renglón que empieza con `#` se escapa (`\#`) para no volverse un encabezado que rompa la estructura de `docs/tareas.md`. Para los datos de siempre el texto es el mismo (la paridad con `tools/artifact_to_md.py` sigue).
- **Detalles del backend (19.8):**
  - Una fecha que no existe (`2026-02-30`) ya no cae en `--due week`, y el store la rechaza al ponerla (una que ya estaba en el archivo no impide editar otra cosa).
  - `scompass restart` en un proyecto que sirve el Inicio dice que se reinicia con `scompass home restart`, en vez de *HTTP 400*.
  - Borrar una tarea (`DELETE /api/tasks/:id`) borra sus capturas de `compass/images/` que nadie más cita, como al quitarlas.
  - `file` e `image add|rm` pasan `\` a `/`: en Windows la terminal completa las rutas con `\`.
  - Un proyecto nuevo del Inicio con un nombre que empieza con `-` se crea con ese nombre (`--project=<nombre>`), y si `scompass init` falla no queda la carpeta a medio armar.
  - El proxy del Inicio pasa `X-Content-Type-Options` y `Content-Security-Policy` del hub del proyecto (las de `/api/files/raw`).
- **Dock: reconexión y capturas (19.9):**
  - Mover el dock de lugar o hacerlo flotante lo saca del árbol y lo vuelve a poner; `_exit_tree` cierra el WebSocket, así que al volver (`_enter_tree`) pasa a *sin hub* y el poll lo reconecta. Antes quedaba "conectado" sin recibir cambios.
  - Las miniaturas se decodifican una vez por archivo (se recuerdan por fecha y tamaño), y armar la lista ya no vuelve a armar el detalle (la selección de la fila emitía `item_selected`). Con dos capturas 4K, cada render tardaba ~0,9 s.
  - Un GIF (Godot no lo carga) o una imagen rota es un botón *▣ nombre* que igual la abre, sin errores en la consola.
  - Sin hub, el poll de 3 s relee `compass/` solo si cambió algún archivo (nombre, fecha y tamaño de los JSON y de los documentos); si no, solo recuenta lo sin commitear.
- **Dock: errores y clics dobles (19.10):**
  - Sin hub, una tarea con `links`, `checklist`, `refs`, `images`, `files` o `tags` de otra forma (un JSON editado a mano) va a los avisos, como en el hub, en vez de romper el render de toda la lista.
  - Lo que no es JSON (otro programa en el puerto, un registro a medio escribir) se descarta sin imprimir un error en la consola cada 3 s.
  - Un guardado que falla vuelve a mostrar el estado real (antes la casilla o el selector quedaban con lo que no se guardó); crear una tarea que falla deja el título y dice por qué.
  - Un segundo *Iniciar hub* mientras arranca el primero no hace nada (el botón se deshabilita), y dos `scompass` seguidos (doble clic en *Actualizar*) esperan uno al otro.
  - Si se borra el hito abierto, el dock pasa al que toca por defecto; ir a una tarea de otro hito recuerda ese hito.
  - *Reiniciar hub* no se ofrece cuando el proyecto lo sirve el Inicio (ahí siempre fallaba).
- **Dock angosto y la tarea en la web (19.11):**
  - El dock entra en el slot derecho (~300 px): el título del aviso sin hub hace autowrap (con un error largo pedía ~960 px), los textos del pie se recortan con … (el tooltip los dice enteros) y *Reiniciar hub* es solo el ícono.
  - Con hub, junto al título del detalle, ↗ abre la tarea en el navegador (`#task/<id>`), y una línea dice que acá se cambian el estado y los pasos y lo demás en el navegador.
  - En Windows, `scope_compass/scompass_path` apuntando a `scompass.cmd` (lo que da `where`) usa el `.js` que el shim tiene al lado: Godot no lanza un `.cmd`.
- **Web: nueva tarea, Pasar a tarea y confirmaciones (19.12):**
  - *Nueva tarea* arranca en el hito elegido o, en *Todos*, en el primero sin terminar (uno sin tareas cuenta como sin terminar; si están todos terminados, el último). Antes era M0, que se reabría y pasaba a ser el hito actual del Inicio. Lo que se elige a mano en el formulario se respeta. Al crearla, se abre su detalle.
  - *Pasar a tarea* (Listas) abre un diálogo con un selector: los hitos sin terminar primero y los terminados aparte, en vez de un `prompt()` donde había que tipear el código.
  - *Quitar* en el visor de capturas pregunta *¿Quitar la captura? Sí / No*, como *Borrar tarea*.
  - En los buscadores de vínculos y referencias, Enter elige el primer resultado y ↓ ↑ los recorren.
  - Destildar un ítem que se repite deja la casilla tildada (no se destilda); el separador del panel informa su ancho real desde que se abre.
- **Web: tipografía y detalles (19.13):**
  - En Alegreya Sans el espacio mide 2-3 px y las palabras se pegaban (*Specydecisiones*): `word-spacing: .12em` en toda la app. Los números son rectos (`lining-nums`): con los antiguos, *M0* se leía *Mo* y *M1*, *MI*.
  - Los enlaces usan el color de la app y uno con forma de botón (*Abrir en Documentos*) se ve como botón.
  - En la lista del teléfono, la marca de vencida no dice *Vencida ·* (el rojo y el tooltip ya lo dicen) y no se parte en dos renglones; el estado muestra una etiqueta corta (*Pend.*, *Curso*, *Rev.*, *Hecho*) además del color.
  - El detalle de una tarea sin código empieza con el hito (*M1*), no con *· M1*; el vacío de Listas dice *Creá una con «+ Nueva lista»*; la búsqueda de Documentos resalta solo al empezar una palabra; la marca del encabezado dice *cambios del tablero sin commitear* (Archivos cuenta todo el repo).
  - En tablet táctil, la barra de abajo de Documentos no repite el índice lateral; el selector de la barra corta con …; los avisos empiezan con mayúscula; el alias inválido de *+ Documento* avisa en castellano; la ruta de un proyecto en el Inicio va en un renglón, cortada con …
- **Tableros de prueba en el Inicio (19.14):** cada tablero creado para probar algo quedaba anotado en `projects.json` y el Inicio se llenaba de *no encontrado*. `init` y `serve` no anotan solos un proyecto en una carpeta temporal (`os.tmpdir()`, `/tmp`, `/var/tmp`), salvo que `projects.json` también sea temporal (tests aislados); `home add` sí lo anota. El Inicio, al arrancar, olvida los temporales que ya no existen. Y cada archivo de test importa `test/isolate.js`, que con `node --test` directo (sin `npm test`) pone un registro, una config y una carpeta de datos temporales.
- **Ícono dorado (19.15):** el ícono de la bandeja (el SVG del tema) y el favicon usan el dorado de la interfaz, `#d9a441`, como el dibujo de respaldo de la bandeja; antes eran grises.
- **Bordes de fantasía (19.16):** después de los mockups con los marcos de un proyecto de juego (*Fantasy UI Borders* de Kenney, CC0, recoloreados), la web los suma como modo opcional. Un botón de Ajustes (engranaje) en el tablero y en el Inicio abre un diálogo con *Bordes de fantasía*; se guarda en el navegador (`scompass.fantasy`), se aplica antes de pintar (`settings.js` en el `<head>`) y sigue en las otras pestañas. Botones, tarjetas, columnas, resumen, detalle, campos, diálogos y tarjetas del Inicio llevan su marco, y también Listas, Documentos (árbol, índice, artículo, ficha, código) y Archivos (árbol, ficha, código, imágenes) y el modo lista del tablero en 9-slice (`border-image`) a tamaño 1:1 y con píxel nítido; el modo usa siempre la paleta oscura, porque los marcos traen su fondo. El hub y el Inicio sirven `frames/*.png`.

### 27.1 Criterios de aceptación de M19
<!-- id: criterios-auditoria -->

- [x] Los cambios hechos fuera del hub (a mano, git, sed -i) siguen llegando a la web y al dock aunque el archivo se reemplace con un rename.
- [x] Nada de lo que dice config.json o la API lee ni escribe fuera del proyecto: export_md, documentos, capturas y enlaces simbólicos.
- [x] La CLI y el hub no fallan en los casos que encontró la auditoría: historial en una subcarpeta, set --file con show --json, registro y claves del Inicio, capturas sin git, export con textos de varias líneas.
- [x] El dock se reconecta al moverlo, no se traba con capturas, entra en 300 px, no muestra cambios que no se guardaron y no se rompe con JSON raros.
- [x] La web crea las tareas donde corresponde, confirma antes de quitar una captura, no usa prompt() y se lee bien (espacios, números, enlaces, teléfono).

Tests: `watcher.test.js` (19.1), `paths.test.js` (19.2), `history.test.js` (19.3), `cli.test.js` (19.4, 19.6), `api.test.js` (19.4, 19.8), `registry.test.js` y `home-serve.test.js` (19.5), `export-md.test.js` (19.7), `filters.test.js` y `home.test.js` (19.8), `dock.test.js` (19.9–19.11), `ui.test.js` y `ui-lists.test.js` (19.12, 19.13, 19.16), `server.test.js` y `home-serve.test.js` (19.16).

Quedaron fuera, a propósito: una CSP para la UI (uso local de un solo usuario; pediría revisar los estilos en línea), índices para tableros de miles de tareas en el dock (con 145 tareas el render tarda ~2 ms) y probar en la VM de Windows el `scompass.cmd` configurado (19.11).

## 28. Playtest y Pausado (M20)
<!-- id: playtest -->

Para ordenar lo que está en Revisión y armar un orden de prueba (D39).

- **Estado Pausado:** `status: "paused"`, para una tarea empezada que se deja de lado por ahora, sin que se confunda con lo que nunca se empezó ni con lo que está en curso. En la web es la columna al lado de Pendiente (Pendiente, Pausado, En curso, Revisión, Hecho; los atajos 1–5 siguen ese orden); en el dock, el grupo después de Pendiente. La CLI (`move <id> paused`, `list --status paused`), el export, el historial y el resumen del Inicio (`counts.paused`) lo conocen.
- **Sesiones de playtest:** una colección nueva, `compass/playtests/<id>.json`, con la forma de las listas:

| Campo | Tipo | Notas |
|---|---|---|
| `title` | string | |
| `order` | number | Orden en la barra lateral |
| `items` | `{ task }[]` | Las tareas, en el orden de la prueba. `task`: id de una tarea |
| `created_at` / `updated_at` | ISO 8601 | |

  - **Cómo salió, en la tarea (D40):** `playtest: { result?, note? }` en la tarea: `result` `"pass"` (anda) o `"fail"` (falla), sin él todavía no se probó; `note`, lo que se vio, puede tener varios renglones (en el export van sangrados debajo del ítem). Sin ninguno de los dos, el campo no está. Una tarea en varias sesiones muestra lo mismo en todas.
  - La sesión apunta a tareas que ya existen; no copia nada de ellas. Una tarea borrada queda en la sesión como *ya no existe* hasta que se la saca.
  - Probar no cambia el estado de la tarea: la web ofrece *Pasar a Hecho* (anda) o *Volver a En curso* (falla), y la CLI usa `move`.
  - **Id legible:** sale del título, como las listas (`"Build 0.3"` → `build-0-3`; sin letras ni números, `playtest`).
- **CLI:** `scompass playtest` (sesiones con cuántas faltan probar), `playtest show|new|set|rm`, `playtest add <sesión> <tarea>… [--at n] [--review] [--milestone m]` (no repite; `--review` suma las de Revisión), `playtest move <sesión> <n|tarea> <pos>`, `playtest drop`, `playtest pass|fail <sesión> <n|tarea> [--note …]` y `playtest reset` (escriben en la tarea; la nota queda) y `playtest migrate` (pasa las sesiones del formato anterior, con `result` y `note` en la sesión, a las tareas: si una tarea estaba en varias, gana la sesión más reciente que la probó y las notas distintas se juntan). Las tareas se nombran por posición (desde 1) o por id.
- **API y WebSocket:** `GET/PUT/PATCH/DELETE /api/playtests[/:id]` y `POST /api/playtests { title, tasks? }` (id del título; `tasks`, ids que tienen que existir, la arranca cargada). Los ítems se escriben enteros con `PATCH { items }` e `If-Match`; el resultado, con `PATCH /api/tasks/<id> { playtest }` (`null` lo quita). Los eventos son los `upsert`/`delete` de siempre con `collection: "playtests"`; el dock los ignora.
- **Web:** pestaña Playtest (`#playtest/<id>`): barra lateral con las sesiones (y cuántas faltan probar), *+ Nueva sesión*, y en un proyecto sin sesiones *Crear una con las N en Revisión*. En la sesión: buscar una tarea por título, código o id (las de Revisión primero) o *+ Las de Revisión*; arrastrar o ↑ ↓ para ordenar; *✓ Anda* / *✗ Falla* (otro clic lo quita), una nota por tarea (de varios renglones: crece con el texto y se agranda desde la esquina; Enter es salto de línea y se guarda al salir o con Ctrl+Enter), ×, *Reiniciar* (todas a *sin probar*, también en las otras sesiones que las tienen; las notas quedan), *Renombrar* y *Borrar*. En escritorio es una **vista dividida**: la sesión a la izquierda y la tarea a la derecha, con el panel siempre a la vista (sin tarea, *Abrir la primera sin probar*); un clic en la sesión no lo cierra, la fila abierta queda marcada y el panel se limita para dejarle a la sesión unos 560 px (en las otras vistas vuelve al ancho elegido). El detalle muestra arriba *Playtest · <sesión>* con ← *Siguiente →* para recorrerla en orden, *Anda* / *Falla*, *Pasar a Hecho* o *Volver a En curso* y la nota; en el teléfono, donde el detalle ocupa toda la pantalla, también. Angosta, la barra de sesiones pasa arriba.
- **Export:** una sección *Playtest* al final de `docs/tareas.md`, con las tareas numeradas, su estado, cómo salieron y la nota.
- **Tarea abierta desde otra vista:** un clic en una tarea desde Listas, Playtest, Documentos o Archivos la abre encima de esa vista, sin pasar al tablero; Cerrar y atrás vuelven ahí (`#task/<id>` guarda de dónde se abrió). Un enlace directo a `#task/<id>` la abre sobre el tablero.

### 28.1 Criterios de aceptación de M20
<!-- id: criterios-playtest -->

- [x] Una tarea puede estar en Pausado (paused), con su columna al lado de Pendiente en la web y en el dock.
- [x] Hay sesiones de playtest en compass/playtests/ con tareas en un orden, resultado (anda / falla) y nota por tarea, manejables desde la CLI, la API y la pestaña Playtest de la web.
- [x] El resultado y la nota viven en la tarea: una tarea en varias sesiones muestra lo mismo en todas, y `playtest migrate` pasa las sesiones del formato anterior (D40).

Tests: `playtest.test.js` (schema, CLI con y sin hub, API, watcher, export, migración), `ui-playtest.test.js` (columna Pausado, pestaña Playtest, tarea abierta encima de la vista), `ui.test.js` (atajos 1–5), `ui-docs.test.js` y `dock.test.js`.

Quedaron fuera, a propósito: sesiones en el dock de Godot y en el Inicio, y que *Anda* mueva la tarea a Hecho sola (una sesión se puede repasar varias veces; el estado de la tarea lo decide quien prueba).

## 29. Dock al día (M21)
<!-- id: dock-al-dia -->

Que el dock de Godot se conecte solo al Inicio, que sus tests no se salteen en silencio y que sirva durante el playtest.

- **Conectarse solo al Inicio (21.1):** ver §17 (*CLI y dock*).
- **Tests que no se saltean en silencio (21.2):** `dock.test.js` toma Godot de `GODOT` o del PATH y solo se saltea si no hay ninguno; un Godot que no arranca falla con el motivo.
- **Resultado del playtest (21.3, D40):** la lista marca ✓ (anda) o ✗ (falla) delante del código, y el tooltip dice el resultado y la nota. El detalle muestra *Playtest* con *✓ Anda* / *✗ Falla* y la nota debajo (en rojo si falla) cuando la tarea ya se probó o está en Revisión. Con hub, *Anda* / *Falla* escriben `playtest.result` en la tarea, sobre su versión más reciente, como la web: otro clic en el mismo lo quita y, sin resultado ni nota, el campo se borra. La nota se escribe en la web o con la CLI. Las sesiones siguen fuera del dock.
- **Cargar un bug con captura (21.4):** al lado de *Agregar*, el menú *Bug* crea una tarea en el hito con el título de la caja, la etiqueta `bug` y su plantilla de `description_templates` (como al etiquetar en la web o la CLI), y le suma una captura (`POST /api/tasks/<id>/images`, que la guarda en `compass/images/`): *Con captura del juego* (solo con un juego corriendo desde el editor), *Con captura del editor* o *Sin captura*. La captura se toma antes de crear la tarea; si no se puede, el bug se carga igual y el dock lo avisa.
  - **Del juego:** `game_shot.gd`, un `EditorDebuggerPlugin`, le manda al juego `scene:rq_screenshot [id]` por el depurador, el mismo pedido de la pestaña Game de Godot: el juego guarda su ventana en un PNG temporal y contesta `game_view:get_screenshot [id, ancho, alto, ruta]`. No hace falta nada del lado del juego. Los ids empiezan en 2⁴⁰ para no cruzarse con los de Godot, que también recibe la respuesta. Si el juego no contesta en 3 s (frenado en un breakpoint, por ejemplo), no hay captura.
  - **Del editor:** el viewport 2D o 3D que esté a la vista, con lo que tiene encima (el gizmo, la barra); si no se ve ninguno (Script, Game), la ventana entera. En 4.8, `get_editor_main_screen()` es un contenedor vacío, así que se va por `get_editor_viewport_2d()` y `get_editor_viewport_3d()`.
  - Un PNG de más de 9 MB va como JPEG (el hub acepta hasta 10 MB).
- **Buscar (21.5):** una caja arriba de la lista filtra por código, título o id, con todas las palabras y sin importar tildes ni mayúsculas, como `scompass list --q`. Busca en todos los hitos: lo de otro hito lleva su código al final, los grupos se despliegan (también Hecho) y el encabezado dice cuántas encontró. Vacía (× o Esc), vuelve la lista del hito.
- **Tres scripts (21.6):** `dock_view.gd` (la conexión con el hub, la lista y las escrituras), `task_detail.gd` (el detalle de la tarea abierta) y `hub_process.gd` (buscar y correr scompass; lanzar, vigilar y cerrar el hub).

### 29.1 Criterios de aceptación de M21
<!-- id: criterios-dock-al-dia -->

- [x] Con el Inicio corriendo, el dock se conecta al abrir y en Reintentar sin apretar Iniciar hub.
- [x] `dock.test.js` encuentra Godot por `GODOT` o por el PATH, y avisa claro si no lo encuentra o no arranca.
- [x] El detalle del dock muestra el resultado y la nota del playtest, y la lista marca anda / falla.
- [x] Desde el dock se carga un bug con la plantilla y una captura del juego o del editor.
- [x] El dock filtra la lista por texto.

Tests: `dock.test.js` (21.1–21.6; la captura del juego corre un editor de verdad con `xvfb-run`).


## 30. MCP (M22)
<!-- id: mcp -->

Que Claude Code opere el tablero con herramientas tipadas en lugar de armar comandos de Bash (D41).

- **`scompass mcp`:** un servidor MCP por stdio: JSON-RPC 2.0, un mensaje por línea en stdin y stdout; stdout es solo del protocolo y los avisos van por stderr. Contesta `initialize` (con la versión de protocolo que pide el cliente si la conoce, si no la más nueva que conoce), `ping`, `tools/list`, `tools/call`, `resources/list`, `resources/templates/list` y `resources/read`. Sin dependencias nuevas.
- **El proyecto:** el de `--dir`, o el primero con `compass/config.json` desde la carpeta donde lo lanzan, como la CLI. Cada herramienta acepta además `dir` para operar sobre otro proyecto sin otro servidor.
- **Las herramientas son la CLI:** cada una arma los argumentos de un comando y llama a `run()` en el mismo proceso con `--json`, una por vez. Así validan, encuentran el hub, regeneran el export y avisan igual que la CLI, y lo que cambie en la CLI llega solo. El resultado es el JSON de `--json` (como texto y como `structuredContent`); un error es `isError` con el mensaje de la CLI (conflicto, validación, id inexistente). Los avisos de la CLI (hub de otra versión, archivos inválidos) se agregan al resultado.
- **Herramientas (22.3, 22.4):** lectura: `list_tasks` (los filtros de `list`), `show_task`, `task_history`, `list_milestones`, `show_milestone`, `list_links`, `list_playtests`, `show_playtest`, `search_docs`, `show_doc` (con el etag del documento y `since`, §41). Escritura: `add_task`, `update_task` (campos sueltos), `move_task`, `add_step`, `update_step`, `remove_step`, `check_step`, `add_link`, `remove_link`, `add_ref`, `remove_ref`, `add_file`, `remove_file`, `set_playtest_result`. Las escrituras aceptan `etag`: si la tarea cambió, falla con conflicto, como `--etag`.
- **Recursos (22.5):** `compass://milestone/<id>` (el hito con sus tareas), `compass://task/<id>` (plantilla) y `compass://doc/<alias>` (el markdown de un documento de `config.json`). `resources/list` da los hitos y los documentos; las tareas se piden por la plantilla.
- **Registrarlo (22.7):** `claude mcp add --scope user scompass -- scompass mcp` lo deja en todos los proyectos; toma el proyecto de la carpeta de la sesión. Desde un clon sin instalar, `node <scope-compass>/hub/bin/scompass.js mcp`.

### 30.1 Criterios de aceptación de M22
<!-- id: criterios-mcp -->

- [x] `scompass mcp` habla MCP por stdio (initialize, tools/list, tools/call, resources/list, resources/read) sin dependencias nuevas.
- [x] Las herramientas leen y escriben tareas, pasos, vínculos, hitos y playtest igual que la CLI: con hub pasan por él y la web y el dock se enteran; sin hub escriben en `compass/`.
- [x] Hitos, tareas y documentos se pueden adjuntar como recursos.
- [x] Un test lanza `scompass mcp` y compara sus resultados con los de la CLI.
- [x] La spec y AGENTS.md explican cómo registrarlo en Claude Code y cuándo usarlo en vez de la CLI.

Tests: `mcp.test.js` (lanza `scompass mcp`, compara con la CLI con y sin hub).

- **Fuera de M22:** transporte HTTP (`/mcp` en el hub) para clientes sin shell; listas e ítems; sesiones de playtest más allá del resultado (crear, ordenar).

## 31. Decisiones (M24)
<!-- id: decisiones-tareas -->

Ver qué decidió el agente al trabajar una tarea, sobre todo lo que decidió sin preguntar (D42). Las decisiones de diseño grandes siguen en `decisiones.md` (D-n); estas son las chicas, las que salen al trabajar.

- **Qué cuenta como decisión:** elegir entre alternativas razonables que el usuario podría haber querido distinto (un formato, un nombre visible, dejar algo afuera, una dependencia, un comportamiento por defecto). No cuenta lo que tiene una sola respuesta razonable (seguir el estilo del código, arreglar un typo). Ante la duda, se registra: revisar una de más cuesta un clic.
- **Dónde vive:** en la tarea, `decisions`, una lista en el orden en que se tomaron. Se numeran desde 1, como los pasos. Sin decisiones, el campo no está.

| Campo | Tipo | Notas |
|---|---|---|
| `text` | string | Qué se decidió, en una línea. Si es una pregunta (`asked`), la pregunta |
| `why` | string | Opcional. Por qué |
| `alternatives` | string | Opcional. Qué se descartó |
| `asked` | `true` | Opcional. Se le preguntó al usuario en lugar de decidir solo |
| `reply` | string | Opcional. Lo que dijo el usuario: la respuesta a la pregunta, o qué hacer en lugar de lo que revierte |
| `review` | `"ok" \| "revert" \| "reverted"` | Opcional. La revisión del usuario: de acuerdo, a revertir, o ya revertida (lo marca quien la revierte) |
| `promoted` | string | Opcional. La entrada de `decisiones.md` a la que se promovió (`"D43"`) |
| `session` | string (uuid) | Opcional. La sesión de Claude Code que hizo la pregunta, para seguirla desde el chat con la respuesta (M25, §32) |
| `at` | ISO 8601 | Cuándo se registró; lo pone el store |

- **Estados (calculados, no se guardan):**
  - *Pregunta abierta*: `asked` sin `reply`. Espera al usuario y bloquea al agente: va en Hoy.
  - *Sin revisar*: sin `asked` y sin `review`. Es la bandeja: lo que el agente decidió solo y nadie miró.
  - *A revertir*: `review: "revert"`. El agente la ve con `list --decisions revert`, la deshace (con `reply` como guía), la marca `reverted` y, si en su lugar decide otra cosa, la registra como decisión nueva. La revertida queda como historia.
  - *Resuelta*: respondida, `ok` o `reverted`.
- **Escritura:** como los pasos, la CLI lee la tarea, cambia la lista y la escribe entera con `PATCH` e `If-Match`. No hay endpoints nuevos para registrar ni revisar.
- **CLI (24.3):**
  ```
  scompass decide <id> "<texto>" [--why "…"] [--alternatives "…"] [--ask]   # imprime el número
  scompass decision ok|revert|reverted <id> <n> [--reply "…"]
  scompass decision reply <id> <n> "<respuesta>"
  scompass decision rm <id> <n>
  scompass decision promote <id> <n>
  scompass decisions [--open | --pending | --revert] [--milestone m00] [--json]   # las de todo el proyecto
  scompass list --decisions open|pending|revert                                  # tareas con alguna así
  ```
  `show` las lista debajo de los pasos, con su número y su estado.
- **MCP (24.4):** `add_decision`, `review_decision`, `reply_decision`, `remove_decision`, `list_decisions` y `promote_decision`, sobre esos comandos; `list_tasks` suma el filtro `decisions`. Las instrucciones del servidor repiten la regla de AGENTS.md (24.5): registrar cada decisión tomada sin consultar y cada pregunta, y mirar las que hay que revertir antes de seguir.
- **Export:** cada tarea con decisiones las lista debajo de sus pasos: `✓` resuelta, `?` pregunta abierta, `!` sin revisar, `↺` a revertir, con el porqué sangrado.
- **Promover a D-n (24.10):** pasa una decisión que resultó ser de diseño a una entrada nueva al final de `decisiones.md` (el documento de `config.json › decisions_doc`, un alias; sin él, `decisiones` si está declarado). Solo una resuelta (revisada con *OK* o una pregunta respondida) y una sola vez. La entrada sigue el formato del documento: `## D<n> · <text>` (en una pregunta, la respuesta, con *Pregunta* debajo), la fecha y `vigente`, la tarea de origen (`tarea 24.3 (m24-03)`), y *Por qué* (`why`) y *Descartado* (`alternatives`) si los tiene. `n` es el número más alto del documento más uno. Primero se escribe el documento (relee el archivo justo antes, escritura atómica) y después la tarea con `promoted`; si la tarea falla por conflicto, el error dice qué D-n se agregó. Con hub lo hace `POST /api/tasks/:id/decisions/:n/promote`, que responde la tarea (con `x-promoted: D<n>` y `x-promoted-path`) y la publica; el watcher de documentos avisa el cambio del documento. Sin hub, la CLI. Nunca commitea.
- **Web (24.6, 24.7):** en el detalle de la tarea, la sección *Decisiones*: texto, quién la tomó (*sola* / *consultada*), porqué y alternativas plegados; *OK* y *Revertir* (con un campo opcional para decir qué hacer) en las sin revisar, un campo para responder en las preguntas abiertas, *Promover* en las resueltas. La tarjeta lleva una marca si tiene preguntas abiertas o decisiones sin revisar. La vista *Decisiones* del proyecto (pestaña `decisions` en `config.views`, después de Playtest; la pestaña cuenta las que esperan) es una línea de tiempo por día, la más nueva arriba, con su tarea e hito, filtrable por hito y por estado: *Esperan* (por defecto: preguntas abiertas, sin revisar y a revertir), *Preguntas abiertas*, *Sin revisar*, *A revertir* y *Todas*. Tiene las mismas acciones que el detalle, y un clic en la tarea la abre encima.
- **Inicio (24.8):** cada proyecto cuenta sus decisiones sin revisar y sus preguntas abiertas (enlace a la vista). Hoy muestra las preguntas abiertas. Con worktrees, una sola vez, como las tareas (tarea 23.2).
- **Dock (24.9):** el detalle de la tarea muestra sus decisiones con su estado; con hub, *OK* y *Revertir* escriben como la web. La lista marca las tareas con preguntas abiertas o decisiones sin revisar.

### 31.1 Criterios de aceptación de M24
<!-- id: criterios-decisiones -->

- [ ] La tarea guarda sus decisiones y la CLI y el MCP las registran, revisan, responden y listan, con hub y sin hub.
- [ ] AGENTS.md pide registrar cada decisión tomada sin consultar y cada pregunta hecha, en el template, el addon y `compass/`.
- [ ] La web muestra las decisiones en la tarea con *OK* y *Revertir*, y la vista del proyecto filtra las sin revisar.
- [ ] El Inicio cuenta las decisiones sin revisar por proyecto y Hoy muestra las preguntas abiertas.
- [ ] *Promover* agrega una entrada D-n al documento de decisiones y la tarea guarda cuál.

- **Fuera de M24:** que el agente se entere de que un documento cambió (por la app o a mano) desde la última vez que lo leyó; editar documentos desde la web; que el agente reciba la respuesta a una pregunta abierta sin volver a leer la tarea.

## 32. Chat (M25)
<!-- id: chat -->

Un chat en la web con el Claude Code instalado en el equipo, que trabaja sobre el proyecto con el MCP `scompass` (D43). Sirve para preguntar por el tablero, cargar tareas o responder decisiones sin abrir una terminal.

- **El proceso (25.2):** el hub (o el Inicio, si sirve el proyecto, D29) lanza `claude` en la carpeta del proyecto con `-p --input-format stream-json --output-format stream-json --verbose --include-partial-messages`. Un proceso por conversación mientras se usa: cada mensaje del usuario es una línea `{"type":"user","message":{"role":"user","content":"…"}}` en stdin, y los eventos se leen línea por línea de stdout. Se cierra tras 10 minutos sin uso y al cerrar el hub; el siguiente mensaje lo vuelve a lanzar con `--resume`. Sin dependencias nuevas.
  - **Ejecutable:** `claude` del PATH (en Windows, también `claude.cmd` y `claude.exe`), o el de `SCOMPASS_CLAUDE` (para el test y para instalaciones fuera del PATH). Si no está, la API responde `claude_missing` y la web dice cómo instalarlo.
  - **Cuenta y config:** las del usuario: su login, su modelo por defecto, su `CLAUDE.md` y su `settings.json`. El hub no guarda claves.
  - **MCP:** `--mcp-config` con un solo servidor, `scompass` (el mismo scompass que corre el hub: `node <scope-compass>/hub/bin/scompass.js mcp --dir <proyecto>`, o el binario con `mcp --dir <proyecto>`), y `--strict-mcp-config`, para que las herramientas sean siempre las mismas aunque el usuario tenga otros servidores o ya haya registrado `scompass`.
  - **Permisos fijados de antemano:** `--tools Read,Grep,Glob` deja solo esas herramientas propias de Claude Code (no ve Bash ni Edit), y `--allowedTools mcp__scompass,Read,Grep,Glob` las permite sin preguntar. `--permission-mode dontAsk --permission-prompts none` niega lo demás sin preguntar, y el agente lo dice; la web no aprueba nada. Editar archivos y correr comandos quedan para la terminal.
  - **Archivos:** la config del MCP (`mcp.json`) y las instrucciones (`prompt.md`, por `--append-system-prompt-file`) se escriben en la carpeta del chat del proyecto (ver *Conversaciones*) antes de cada lanzamiento: así ningún argumento lleva JSON ni espacios, y en Windows `claude.cmd` se puede lanzar por el shell.
  - **Entorno:** el hijo no hereda `CLAUDECODE` ni `CLAUDE_CODE_*`, por si el hub se lanzó desde una sesión de Claude Code.
  - **Instrucciones:** `prompt.md` dice que es el chat de Scope Compass del proyecto, que el tablero se opera con `scompass` y que valen las reglas de AGENTS.md (registrar las decisiones, pasar las tareas a `review`).
- **Conversaciones (25.3):** el hub elige el `session_id` al crearla (`--session-id <uuid>`) y la retoma con `--resume <uuid>`. Si el hub se cerró antes de que claude confirmara la sesión (el `init`), no se sabe si existe: si claude responde que el id ya está en uso o que no encuentra la conversación, se prueba una vez con la otra opción. Claude Code guarda la conversación de verdad; el hub guarda qué conversaciones hay y una copia liviana de lo que se mostró (los mensajes del usuario, el texto de cada respuesta y el nombre y resumen de las herramientas usadas), para volver a mostrarla sin leer los archivos internos de Claude Code. Vive fuera de `compass/`, porque es de la máquina y no va a git: `<config>/scope-compass/chats/<sha1 de la ruta del proyecto>/`, con `index.json` (`{ chats: [{ id, title, created_at, last_at, started? }] }`: el id es el de la sesión de Claude Code, el título es el comienzo del primer mensaje y `started` dice que la sesión ya existe y se retoma con `--resume`) y un `<id>.jsonl` por conversación: una línea por mensaje del usuario (`{ role: 'user', text, task?, at }`, el texto como se escribió) y una por respuesta (`{ role: 'assistant', text, tools: [{ name, brief, ok }], ok, interrupted?, error?, cost?, at }`), que se guarda al terminar el turno. Si crear la conversación falla (sin `claude`), no queda en la lista. `<config>` es la carpeta de `projects.json` (D23). Borrar una conversación la saca de la lista y borra la copia; la de Claude Code queda.
- **API (25.4):**
  ```
  GET    /api/chats                  # { chats, claude: true|false }
  POST   /api/chats                  # { text, task? } → crea y manda el primer mensaje; responde { id }
  GET    /api/chats/:id              # la copia de la conversación y si hay un turno en curso
  POST   /api/chats/:id/messages     # { text, task? }; 409 si hay un turno en curso
  POST   /api/chats/:id/interrupt    # corta el turno en curso
  DELETE /api/chats/:id
  ```
  Errores: `busy` (409), `not_found` (404), `claude_missing` (503), `forbidden` (403), `invalid_argument` (400: sin `text`, o una `task` que no existe). `task` es el id de la tarea abierta en la web: el mensaje lleva delante `Tarea abierta: <code> <título> (compass://task/<id>)`, y el agente la lee con `show_task`. Cortar manda la interrupción del protocolo stream-json; si el proceso no termina el turno en 5 segundos, se mata y la conversación sigue con `--resume`.
- **Eventos (25.4):** por el WebSocket del proyecto, `{ type: 'chat', chat, event, … }` con `event`: `turn` (empieza un turno, con el mensaje del usuario), `text` (un pedazo de texto), `tool` (nombre y resumen de los argumentos), `tool_result` (ok o error), `end` (fin del turno, con costo y duración si vienen) y `error`. Todas las pestañas abiertas ven la misma conversación.
- **Solo en el equipo:** sin login, el chat es una terminal con permisos de lectura y de tablero. Los endpoints responden 403 si el pedido no viene de 127.0.0.1 o `::1` (la dirección del socket, no el Host), también con `--lan` (D36); los eventos `chat` solo van a los WebSocket locales. El Inicio hace el mismo corte en `/p/<clave>/api/chats` y en el WebSocket de cada proyecto, porque el hub del proyecto lo ve a él como 127.0.0.1 (le pasa la dirección del navegador a `inject` y, si reenvía a un hub suelto, filtra los eventos `chat`). Con token (hosting, §12) el chat está apagado.
- **Test (25.5):** un `claude` falso (un script de Node que se pasa por `SCOMPASS_CLAUDE`) imita el stream-json: `system/init` con el `session_id`, texto en partes, una herramienta y su resultado, y `result`. Prueba el proceso, `--resume`, la API, el WebSocket, cortar y el 403 fuera de 127.0.0.1, sin gastar tokens ni depender de la red.
- **Web (25.7):** un panel plegable a la izquierda (el detalle de la tarea sigue a la derecha; en pantallas anchas el tablero se corre), que se abre con *Chat* en la cabecera: la conversación con el texto en vivo, las herramientas plegadas (nombre, resumen y si anduvieron), *Cortar* durante un turno, *Nueva* y *Conversaciones* (la lista, con borrar). Enter manda, Mayús+Enter es otra línea. Con una tarea abierta, el campo dice que la adjunta y se puede sacar; un clic en el chat no cierra la tarea. El navegador recuerda si el panel está abierto y la conversación. Fuera de 127.0.0.1 el botón no aparece (`/api/chats` da 403); sin `claude`, el panel dice cómo instalarlo.
- **Preguntas abiertas (25.8):** la decisión guarda la sesión de Claude Code que la hizo (`session`). Claude Code pone `CLAUDE_CODE_SESSION_ID` en el entorno de Bash y de los servidores MCP que lanza, así que `scompass decide --ask` (y `add_decision` con `ask`) la toman de ahí sin que el agente haga nada; `--session <uuid>` la da a mano y `--session ""` no la guarda. Una pregunta respondida que tiene sesión muestra *Seguir en el chat* en la web: `POST /api/chats` con `session` retoma esa sesión con `--resume` (si ya está en la lista de conversaciones, le manda el mensaje a esa) y le manda `Respuesta a tu pregunta en la tarea <código> (<id>): «<pregunta>»` con la respuesta, así el agente sigue sin volver a leer la tarea. Una sesión de afuera no se crea vacía si `--resume` no la encuentra (pasa si se hizo en otra carpeta, como un worktree): el chat muestra el error de claude. Si esa sesión sigue abierta en una terminal, conviene responder ahí.

### 32.1 Criterios de aceptación de M25
<!-- id: criterios-chat -->

- [ ] Desde la web se conversa con el Claude Code instalado, en la carpeta del proyecto, con el texto en vivo y las herramientas a la vista, sin dependencias nuevas.
- [ ] El agente del chat lee y escribe el tablero con `scompass`, lee archivos, y no edita ni corre comandos.
- [ ] Las conversaciones se listan, se retoman después de cerrar el hub y se borran.
- [ ] Fuera de 127.0.0.1 el chat no responde ni aparece, también con `--lan`.
- [ ] Un test con un `claude` falso cubre el proceso, `--resume`, la API, el WebSocket, cortar y el rechazo fuera del equipo.
- [ ] AGENTS.md, el README e `instalar.md` explican el chat, qué necesita y qué puede hacer.

- **Fuera de M25:** aprobar permisos desde la web (con `--permission-prompts host`, Claude Code manda los pedidos de permiso por el mismo stream-json; no hace falta ACP, D43); editar archivos y correr comandos desde el chat; el chat desde el teléfono; el chat en el dock; adjuntar documentos o imágenes.

## 33. Cuenta, perfiles y uso del chat (M28)
<!-- id: chat-perfiles -->

Saber con qué cuenta de Claude habla el chat (§32) y cuánto gasta, y poder usar varias cuentas (D44).

- **Perfiles (28.2):** un perfil es una carpeta de configuración de Claude Code (`CLAUDE_CONFIG_DIR`): tiene su login, su `settings.json` y sus sesiones.
  - *Predeterminado*: `~/.claude`, el de `claude` sin nada más. Se lanza sin `CLAUDE_CONFIG_DIR`, aunque el hub lo tenga en su entorno, para que no dependa de cómo se levantó el hub.
  - Los demás: cada carpeta de `~/.claude-profiles/` (o de `SCOMPASS_CLAUDE_PROFILES`) que tenga `.claude.json` o `settings.json`. El id y el nombre son el de la carpeta. Se lanza con `CLAUDE_CONFIG_DIR=<carpeta>`.
- **Cuenta:** `claude auth status --json` con el `CLAUDE_CONFIG_DIR` de cada perfil (no gasta tokens), guardado 10 minutos: `email`, `orgName`, `subscriptionType` (`pro`, `max`, `team`…) y `authMethod`. Un perfil sin login (`loggedIn: false`) puede usar una clave o un proveedor propio en su `settings.json`: se muestra como *sin login de Claude*.
- **Perfil de cada conversación:** se elige al crearla y no cambia, porque la sesión vive en ese perfil (`index.json › chats[].profile`; sin él, el predeterminado). El proyecto recuerda el último elegido para las nuevas (`index.json › profile`), en este equipo.
- **Preguntas (25.8):** al retomar la sesión de una pregunta, el hub busca en qué perfil está (`<perfil>/projects/*/<session>.jsonl`; solo mira si el archivo existe) y la retoma ahí. Si no está en ninguno, usa el predeterminado y claude dice que no la encuentra.
- **Límites (28.3):** cada turno trae un `rate_limit_event` con las ventanas de la cuenta: `five_hour` y `seven_day`, cada una con el uso (0 a 1) y cuándo se renueva, más el estado (`allowed`, …) y si se puede pasar del límite. El hub lo emite como evento `limits` del chat (`{ profile, limits: { five_hour: { used, resets_at }, seven_day: …, status }, at }`) y guarda el último de cada perfil en `<config>/scope-compass/chats/limits.json`. Solo se sabe después de un turno: la web dice de cuándo es el dato.
- **Tokens (28.3):** el fin del turno trae `tokens: { input, output, cache_read, cache_write }` (del `usage` del `result`) junto al costo, y la copia de la conversación los guarda. El costo es el que calcula Claude Code: con una suscripción es un estimado, no un cobro.
- **API (28.2, 28.3):**
  ```
  GET /api/chats/profiles      # { profiles: [{ id, label, dir, default?, account, limits }], profile }
  PUT /api/chats/profile       # { profile }: el predeterminado del proyecto para las nuevas
  POST /api/chats              # suma profile (si no, el del proyecto)
  ```
  `GET /api/chats` suma `profile`. Los mismos 403 que §32.
- **Web (28.4):** el panel muestra la cuenta del perfil de la conversación (email, organización, plan); en una conversación nueva, un selector de perfil. Debajo, el uso de las dos ventanas con barras y cuándo se renuevan, con la hora del dato. Cada respuesta lleva, plegados, sus tokens y su costo estimado, y la cabecera de la conversación el total.

### 33.1 Criterios de aceptación de M28
<!-- id: criterios-chat-perfiles -->

- [ ] El chat dice con qué cuenta habla y deja elegir el perfil entre los del equipo.
- [ ] Cada conversación usa siempre su perfil; una pregunta se retoma en el perfil donde está su sesión.
- [ ] El panel muestra el uso de los límites y los tokens y el costo estimado de cada respuesta.
- [ ] Tests con el claude falso cubren perfiles, cuenta, límites y tokens.

- **Fuera de M28:** iniciar o cerrar sesión desde la web (`claude auth login` sigue en la terminal); avisar antes de llegar al límite; otros agentes (M27).

## 34. El Inicio para la vida (M31)
<!-- id: inicio-vida -->

Usar Scope Compass para organizar la vida (rutina, trabajo, hobbies, ocio, aprendizaje), no solo proyectos de juego. Se usa con un proyecto "Vida" (plantilla `personal`) con listas (Rutina, Quiero hacer, Pendientes) y un tablero para las metas con fin; las **áreas** (trabajo, casa, música, aprender) son etiquetas de tarea. Todo sigue local: no toca hosting, Tailscale ni el chat.

- **Hoy en secciones (31.1):** arriba lo mío, suelto: ítems y tareas vencidos o de hoy (los ítems con casilla). Después lo que solo está en curso, en el grupo plegable de cada proyecto (23.1). Al final **Esperan tu respuesta (n)**: las preguntas abiertas de los agentes (§31), plegadas por defecto; si se despliega, se recuerda en el navegador (`scompass.home.questions-open`). Antes iban primero y con muchas tapaban lo demás. En el teléfono (hasta 560 px) no se muestran la fecha ni los subtítulos y las filas son más bajas, para que lo mío entre en 390×844.
- **Captura rápida (31.2):** un formulario **Anotar…** arriba de todo: texto, lista (las de todos los proyectos, agrupadas por proyecto) y fecha opcional; Enter agrega el ítem al final de la lista. La lista elegida se recuerda en el navegador (`scompass.home.capture`); sin elegir, va a "Quiero hacer" del proyecto "Vida" (sin mayúsculas ni tildes), o a la primera lista de "Vida", o a la primera que haya. Sin listas, no se muestra. **Agregar proyecto** pasa a un botón chico en la cabecera de Proyectos.
  - `POST /api/projects/add-item { path, list, text, due?, etag? }` → `201 { list, n, via }`: la misma regla que `item add` (`newItem` de `hub/src/lists.js`, que usa también la CLI), por el hub del proyecto si está vivo o directo al Store con etag. El texto se recorta; vacío o con una fecha inválida, `400`; etag viejo, `409`.
- **Esta semana (31.3):** `GET /api/today` suma `week`: ítems de lista y tareas sin terminar que vencen después de hoy y antes de la medianoche de dentro de 7 días (la regla de `list --due week`, sin lo vencido ni lo de hoy, que ya está en Hoy), de todos los proyectos, por fecha. La página los muestra en una franja **Esta semana** agrupada por día ("mañana · miércoles 4/11"), con casillas para los ítems. Una tarea en curso que vence esta semana aparece en los dos lados.
- **Áreas (31.4):** `items` y `week` traen `tags` en las tareas y las preguntas. Arriba de Hoy, un chip por etiqueta presente más *Todas*; elegir uno filtra Hoy y Esta semana. El filtro se guarda en el navegador (`scompass.home.area`), nunca en `compass/`. Los ítems de lista no tienen área: con un filtro puesto no se ven. Un área guardada que ya no aparece no filtra.
- **Estilo (31.5):** los enlaces de Hoy y Esta semana van sin subrayado (se subrayan con hover o foco) y en el color del texto; el dorado (`--accent`) queda para el título de lo vencido o de hoy. Los campos de Anotar usan los marcos de los bordes de fantasía (19.16).
- **Repetir cada N (31.6):** `repeat.interval` en los ítems de lista (§16.5). CLI: `item add … --repeat day --interval 2`; en `item set`, `--interval` cambia solo el intervalo y `--repeat` solo la unidad (`--repeat ""` quita la repetición). La web del tablero suma un campo *Cada cuántos* al lado del selector. Se lee "cada 2 días" en la web, la CLI y el export. Los días fijos de la semana (lun/mié/vie) quedan para después: hay una pregunta abierta en la tarea sobre cómo modelarlos.

### 34.1 Criterios de aceptación de M31
<!-- id: criterios-inicio-vida -->

Cada uno tiene su test en `hub/test/m31-criteria.test.js`.

- [ ] Con 7 preguntas abiertas en un proyecto, lo vencido, lo de hoy y lo en curso se ven sin scrollear en 1440×900 y en 390×844; Esperan tu respuesta está plegada y, desplegada, sigue así al recargar.
- [ ] Anotar agrega un ítem a "Quiero hacer" de "Vida" sin elegir nada, con fecha si se pone, y recuerda la última lista elegida.
- [ ] Esta semana muestra lo que vence en los próximos 7 días de todos los proyectos, por día, y no lo de dentro de 8.
- [ ] Un chip de área filtra Hoy y Esta semana y se recuerda al recargar sin cambiar nada en `compass/`.
- [ ] Los enlaces de Hoy no van subrayados salvo en hover; solo lo vencido o de hoy va en dorado.
- [ ] Un ítem con `repeat { every: "day", interval: 2 }` avanza dos días al tildarlo; los archivos sin `interval` siguen validando.

## 35. Distribución (M32)

- **Descargas de cada release:** `scompass-v<versión>-linux-x64`, `scompass-v<versión>-windows-x64.exe`, `scope-compass-addon-v<versión>.zip` y `SHA256SUMS`, todos con la misma versión (D45, D47). El `.tgz` de npm no va en la release: lo arma `node tools/build.mjs` desde un clon.
- **El binario** es un Node SEA que trae el paquete entero. La primera vez que corre una versión lo extrae a `~/.cache/scope-compass/runtime/<versión>-<hash>/` (en Windows, `%LOCALAPPDATA%\scope-compass\runtime\`; `SCOMPASS_RUNTIME_DIR` la cambia) y lo carga desde ahí (`tools/sea-main.cjs`). Las versiones viejas quedan en la caché.
- **Relanzarse:** el hub que se reinicia, el Inicio que prende hubs o corre `init`, y el MCP del chat usan `selfCommand` (`hub/src/self.js`). Desde el repo o npm es `node bin/scompass.js`; en el binario, el ejecutable solo.
- **Armarlo:** `node tools/build.mjs` arma el binario de la plataforma donde corre (hace falta Node 25.5 o más nuevo, por `--build-sea`) y lo prueba con `init` y `list` sobre un tablero temporal. Para tener los de Linux y Windows, el build corre en cada plataforma. El zip del addon trae `addons/scope_compass/` desde la raíz, solo lo versionado, y adentro los README (inglés y castellano), `CHANGELOG.md` y `LICENSE`; los links relativos de los README pasan a GitHub, fijados al tag.
- **CI** (`.github/workflows/ci.yml`): en cada push y PR a main, `npm test` en Linux y Windows con Node 26 (la del binario) y en Linux también con Node 22 (la mínima del `.tgz`). Con `timeout-minutes`, porque la corrida completa a veces se cuelga.

### 35.1 Publicar una release

La publica `.github/workflows/release.yml` (D47), con la lógica en `tools/release.mjs` (Node, para que ande igual en los runners de Linux y de Windows; tests en `hub/test/release.test.js`).

1. Antes: los cambios de la versión están en `CHANGELOG.md`, en inglés y formato Keep a Changelog, bajo `## [Unreleased]`. Con esa sección vacía la release falla.
2. **A mano (lo normal):** Actions → Release → Run workflow sobre main, con `bump` = `patch`, `minor`, `major` o una versión exacta `X.Y.Z` (la primera release, `0.1.0`: la versión que ya tienen los archivos), y opcionalmente *pre-release*. El workflow:
   - corre el CI (los tests en Linux y Windows);
   - calcula la versión, valida que el tag no exista y que Unreleased tenga algo;
   - arma el binario en Linux y en Windows, y el zip del addon en Linux, sobre el árbol con la versión nueva aplicada (`release.mjs bump` y `changelog`, con la misma fecha en todos los jobs);
   - con todo armado, commitea «Release vX.Y.Z» (versión en `hub/package.json`, su lock y `plugin.cfg`; Unreleased pasa a `## [X.Y.Z] - fecha` y, si están, los links de comparación del final se actualizan) y pushea a main el commit y el tag en un solo `git push --atomic`;
   - escribe `SHA256SUMS` y publica con `gh release create vX.Y.Z <archivos> --title vX.Y.Z --notes-file notes.md [--prerelease]`. Las notas son la sección de la versión en el CHANGELOG más un párrafo de cómo instalar.
   Si algo falla antes del push, no queda nada en el repo y se puede volver a correr.
3. **Pusheando un tag `vX.Y.Z` a mano:** el commit del tag ya trae las versiones y la sección `## [X.Y.Z]` del CHANGELOG. El workflow corre lo mismo menos el bump y el commit.
4. En los dos casos, cada job verifica que el tag, `hub/package.json` y `plugin.cfg` digan la misma versión (`release.mjs check`).

Lo mismo a mano, en un equipo: `node tools/release.mjs bump <cómo>`, `node tools/release.mjs changelog <X.Y.Z>`, `node tools/release.mjs notes <X.Y.Z>`, `node tools/build.mjs` y `node tools/release.mjs sums dist`.

Si main tiene protección de rama que no deja pushear al `GITHUB_TOKEN`, el paso del commit falla: hay que permitirle a GitHub Actions saltear la protección, o usar el camino del tag.
- **Instalar:** `install.sh` prefiere el binario: lo copia a `~/.local/bin/scompass`. El dock lo encuentra en el PATH; en Windows también acepta `scompass.exe` de `where`.

### Criterios de aceptación

- [ ] El binario corre `init`, `list`, `serve` (con la web), `home` (crea proyectos y prende hubs) y `mcp` en un equipo sin Node.
- [ ] Dos `scompass` que arrancan a la vez por primera vez no rompen la carpeta de la caché.
- [ ] El repo (`node hub/bin/scompass.js`) y el `.tgz` siguen andando igual.
- [ ] Run workflow de Release con `bump` publica la release con los dos binarios, el zip y `SHA256SUMS`, y deja en main el commit «Release vX.Y.Z» con su tag.
- [ ] Con `## [Unreleased]` vacío, o con versiones distintas en el tag, `package.json` y `plugin.cfg`, la release falla sin publicar ni pushear nada.

## 36. El tablero fuera del repo del proyecto (M32)

Un proyecto que se hace público no tiene que publicar su tablero (notas internas, otros proyectos, links privados), así que los tableros son del usuario del sistema. `<proyecto>/compass` sigue siendo la única ruta que usan la CLI, el hub, el MCP, la web y el dock, pero puede ser de tres tipos (`hub/src/board.js`, D46):

- **enlazado (por defecto):** un enlace (symlink en Linux; junction en Windows, que no pide permisos) a `<datos>/boards/<nombre>/` (`~/.local/share/scope-compass/boards`; `%LOCALAPPDATA%\scope-compass\boards`; `SCOMPASS_BOARDS` la cambia). El proyecto lo excluye en `.git/info/exclude`, no en `.gitignore`: el repo público no tiene ningún rastro. El git es uno de dos:
  - **repo de todos los tableros:** si la carpeta de tableros es la raíz de un repo (`git init` o un clon, con un remoto en GitHub si se quiere), cada tablero es una subcarpeta sin `.git` propio. Una carpeta de tableros dentro de otro repo (un `$HOME` versionado) no cuenta.
  - **un repo por tablero:** si no, cada tablero tiene su propio `git init`, con su remoto si se quiere.
- **local:** una carpeta del proyecto, en su mismo repo: `init --in-project`, los tableros de antes de esto y los de un proyecto en una carpeta temporal (como el registro del Inicio, que no los anota).
- **submódulo:** `compass/` con su propio `.git` dentro del proyecto, para compartir el tablero con otros.

Qué cambia según el tipo:

- **El git del tablero** es `git -C compass`: el estado sin commitear (`/api/git`, el aviso de `list`, el Inicio) y el historial de una tarea (`history`) corren ahí, con las rutas mostradas como `compass/…`. El export markdown fuera de `compass/` se sigue mirando en el git del proyecto.
- **Rutas:** lo que está dentro del destino de un enlace `compass/` cuenta como del proyecto (`realInside`), siempre que ese destino sea un tablero (tenga `config.json`): un `compass/` que apunta a `/` no abre el disco.
- **Capturas:** las de `compass/` se sirven desde el disco aunque el git del proyecto no las liste (con el tablero enlazado o como submódulo no las lista).

Comandos:

- `scompass init`: crea el tablero en `<datos>/boards/<nombre>` (el nombre es `--board`, o el de `--project`, o el de la carpeta; uno que ya existe es un conflicto y sugiere `board link`) y lo enlaza. Los documentos de la plantilla (el GDD) van al proyecto. El export por defecto es `compass/tareas.md`. Si algo falla, no quedan ni el enlace ni la carpeta.
- `scompass board`: el tipo, la carpeta real, la rama y el origin.
- `scompass board move [<nombre>]`: saca un tablero local a `<datos>/boards/<nombre>` (por defecto, el `project` de `config.json`). Si `compass/` está en el repo del proyecto, su historial se parte con `git subtree split` (con `compass/` como raíz). Con un repo por tablero, se clona como el repo nuevo. Con el repo de todos los tableros, se reescribe commit por commit con `<nombre>/` adelante (mismos autores, fechas y mensajes; si no, `git log -- <nombre>/tasks/x.json` se corta, como pasa con `git subtree add`) y entra en un commit con dos padres, armado con un índice aparte para no pedir el árbol limpio: en ese repo casi siempre hay algo sin commitear de otro tablero. Es el único commit que hace la app. Lo de disco, también lo sin commitear, se copia encima y queda sin commitear. `compass/` se saca del índice del proyecto (queda para commitear), se reemplaza por el enlace y se excluye. Un export markdown fuera de `compass/` pasa a `compass/tareas.md` y el viejo se borra del disco y del índice. Fuera de ese commit no commitea nada (§4.5), y se niega con un hub o el Inicio sirviendo el proyecto.
- `scompass board link <nombre|carpeta>`: crea el enlace a un tablero que ya existe (en otro equipo, después de clonar su repo) y lo excluye.

### Criterios de aceptación

- [x] Después de `board move`, el tablero tiene el historial de `compass/` y lo sin commitear; el proyecto tiene `compass/` fuera del índice y en `info/exclude`.
- [x] Con el tablero enlazado andan escribir, el export (adentro del tablero), el historial, el estado de git, las capturas y el watcher.
- [x] `board link` en otro proyecto ve el mismo tablero.
- [x] Con el repo de todos los tableros, `board move` trae el historial (el de cada tarea también) sin tocar lo sin commitear de otros tableros, e `init` crea una subcarpeta sin `.git`.
- [ ] Probado en Windows (junction).

## 37. scompass sin el PATH (M32)

Instalar scompass no tiene que obligar a tocar el PATH: en Windows es un paso manual y fácil de errar, y en Linux el editor de Godot lanzado desde el menú no siempre ve el PATH de la terminal.

- **La instalación se anota sola:** cada vez que corre, el binario (o un paquete de npm instalado) escribe en `<datos>/scompass.json` (`~/.local/share/scope-compass/` o `%LOCALAPPDATA%\scope-compass\`; `SCOMPASS_DATA` la cambia) cómo lanzarlo: `{ "command": <ruta>, "args": [] }`, o node con el `.js` del paquete. Solo si cambió. Un clon del repo no se anota (los tests y el desarrollo no pisan la instalación del usuario). Basta con abrir el binario una vez, por ejemplo con doble clic, que levanta el Inicio.
- **El addon** busca scompass en este orden: la ruta de Editor Settings, `../scope-compass` al lado del proyecto, el propio proyecto, la instalación anotada y, al final, el PATH. Una anotada cuyo programa ya no existe se ignora.
- **Claude Code:** `scompass mcp install` corre `claude mcp add --scope user scompass -- <ruta entera> mcp` con la ruta de esta instalación. Sin `claude` encontrable, imprime ese comando para correrlo a mano.
- **Los agentes** que corren la CLI por Bash, si `scompass` no está en el PATH, toman el comando de `<datos>/scompass.json`.

### Criterios de aceptación

- [x] El binario anota su ruta al correr y no reescribe si no cambió; desde un clon del repo no anota nada.
- [x] El dock encuentra la instalación anotada sin PATH ni ruta configurada, y no usa una anotada que ya no existe.
- [x] `scompass mcp install` registra el MCP con la ruta entera; sin claude, dice qué correr.
- [ ] Probado en Windows con el binario fuera del PATH.

## 38. Actualizar todos los tableros (M32)

Cuando sale una versión de Scope Compass con un schema o una guía para agentes nueva, cada tablero queda con `schema/`, `AGENTS.md` o `.gitattributes` viejos. Actualizarlos uno por uno, desde cada tarjeta del Inicio o con `scompass update` en cada proyecto, no escala con muchos proyectos.

- **En el Inicio:** junto a *Agregar proyecto* aparece **Actualizar todos (n)** cuando hay dos o más proyectos desactualizados (con uno solo alcanza el botón de su tarjeta). El tooltip lista los proyectos. Corre `POST /api/projects/update-all`, que pone al día cada proyecto encontrado y devuelve `{ updated: [{ path, name, files }] }`, solo con los que tenían algo viejo.
- **En la CLI:** `scompass update --all` hace lo mismo con los proyectos que conoce el Inicio. `--check` solo los lista y sale con 1 si hay alguno, y `--json` da la misma forma que la API.
- Varios proyectos con el mismo tablero (worktrees o enlaces a la misma carpeta) lo actualizan una sola vez: para el segundo ya está al día.
- No toca los datos, `config.json` ni el README, igual que `update`. Los cambios quedan sin commitear en el repo de cada tablero.

### Criterios de aceptación

- [x] Con dos tableros desactualizados, el botón aparece con el número, los pone al día a los dos y desaparece.
- [x] `update --all --check` lista los desactualizados y sale con 1; `update --all` los actualiza y después `--check` sale con 0.

## 39. Versiones y compatibilidad (M32)

Scope Compass tiene tres partes que se actualizan por separado: el binario `scompass` (uno por equipo), el addon de Godot (uno por proyecto) y el MCP registrado en Claude Code, que es el mismo binario. No hace falta que tengan la misma versión: alcanza con que hablen el mismo **protocolo** (D49).

- **Protocolo:** un entero (`hub/src/protocol.js`) que sube solo cuando se rompe la API HTTP/WebSocket o el formato de `compass/`, no en cada release. `GET /api/health` lo informa en el hub y en el Inicio (`protocol`), y también el `hello` del WebSocket. Un scompass anterior a §39 no lo dice y cuenta como otro protocolo.
- **El addon** tiene su `PROTOCOL` en `hub_client.gd`. Un hub de este proyecto con otro protocolo no se usa: el dock sigue en solo lectura desde `compass/`, el banner dice por qué y un aviso ofrece **Bajar scompass <versión del addon>**, que abre la URL directa del binario del mismo release para este sistema (`scompass-v<v>-<linux|windows|macos>-<x64|arm64>[.exe]`). Si el dock levantó ese hub, lo cierra. Si no encuentra scompass al apretar *Iniciar hub*, ofrece el mismo binario.
- **La CLI y el Inicio** tampoco usan un hub de otro protocolo: la CLI escribe directo en `compass/` y lo avisa por stderr (el watcher del hub lo ve igual); el Inicio lee y escribe ese proyecto de disco. Con el mismo protocolo y otra versión, la CLI sigue avisando que conviene reiniciar el hub.
- **Actualizar el addon:** el addon se actualiza solo, con `addon_updater.gd` (copia del de godot-agent con el repo, la carpeta y el zip de Scope Compass). Al abrir el editor, a lo sumo una vez por día, busca en `api.github.com/repos/dannroda/scope-compass/releases` la versión más alta sin borradores ni prereleases que traiga `scope-compass-addon-v<v>.zip`. Si es más nueva, el dock muestra *Novedades* (las notas en GitHub), *Después* (no vuelve a avisar de esa versión) y *Actualizar*: baja el zip, lo rechaza si su `plugin.cfg` no dice la versión del tag, reemplaza `addons/scope_compass/` (borra lo que la versión nueva ya no trae, salvo archivos que agregó el usuario de otro tipo), guarda las escenas y reinicia el editor. Editor Settings › `scope_compass/check_updates` lo apaga. En una copia de desarrollo (el addon es un enlace, o el proyecto es el repo de Scope Compass) no busca.
- **El binario** no se actualiza solo: se baja del release (el dock lo ofrece cuando el protocolo cambia). `scompass update` sigue siendo para poner al día `compass/` (§38), no el programa.
- **El MCP** es el binario: `serverInfo.version` dice su versión, y como pasa por la CLI, con un hub de otro protocolo escribe directo igual que ella.
- Si algún día el addon está en el Asset Store, el harness de godot-agent lo actualiza como cualquier asset.

### Criterios de aceptación

- [x] `/api/health` del hub y del Inicio, y el `hello`, dicen `protocol`; el proyecto que sirve el Inicio dice el mismo.
- [x] Con un hub de otro protocolo (o sin `protocol`), la CLI escribe directo y avisa; el dock queda en solo lectura con el aviso y la URL del binario de la versión del addon.
- [x] Con el mismo protocolo y otra versión, el dock no avisa.
- [x] El updater elige el zip del addon entre los assets (no un binario), descarta borradores y prereleases, rechaza un zip de otra versión e instala sin borrar lo que agregó el usuario.
- [x] El aviso de versión nueva: *Después* la recuerda; en el repo de Scope Compass no busca.
- [ ] Probado con un release real: actualizar el addon desde el dock y bajar el binario desde el aviso.

## 40. Plugin de Claude Code (M32)

Hasta acá, para que Claude Code trabaje un tablero había que registrar el MCP con `scompass mcp install` y además pedirle al agente, en el `CLAUDE.md` del proyecto, que lea `compass/AGENTS.md`. El plugin hace lo segundo solo, y el harness de godot-agent lo muestra en Extensiones.

- **Qué trae:** la skill `scope-compass` (`claude-plugin/skills/scope-compass/SKILL.md`), que se activa con un proyecto que tiene `compass/` o cuando se habla del tablero. Es corta a propósito: manda a leer `compass/AGENTS.md`, que `scompass update` mantiene al día con cada versión, y resume el flujo (doing, pasos, decisiones, review, etags). Así la skill no queda vieja cuando cambian las reglas.
- **El MCP no viene en el plugin:** el `.mcp.json` de un plugin tiene un `command` fijo, sin variantes por sistema, y no puede leer la ruta que anotó la instalación (§37); con `scompass` a secas dependería del PATH, que es justo lo que D48 evita. Se registra con `scompass mcp install` (la ruta entera, en el scope de usuario). Si las herramientas no están, la skill le dice al agente que lo corra, con el comando de `<datos>/scompass.json` si `scompass` no está en el PATH, y que pida `/mcp`.
- **Dónde vive:** en este repo, `claude-plugin/`. El repo es también un marketplace (`.claude-plugin/marketplace.json`, fuente `./claude-plugin`): `/plugin marketplace add dannroda/scope-compass` y `/plugin install scope-compass@scope-compass`. El marketplace `godot-agent` (dannroda/godot-agent-plugins) lo lista con una fuente `git-subdir` que apunta a esta carpeta, sin copiarlo; esa entrada la agrega quien mantiene ese repo.
- **Versión:** la del plugin es la de Scope Compass. `tools/release.mjs bump` la sube junto con `hub/package.json` y `plugin.cfg`, y `check` exige que coincidan. Claude Code compara la `version` de `plugin.json`, así que `claude plugin update` (o la actualización automática) solo ve un cambio en cada release, no en cada commit de main.

### Criterios de aceptación

- [x] `claude plugin validate` pasa con el marketplace del repo y con el plugin.
- [x] `release.mjs bump` sube la versión del plugin y `check` falla si no coincide; el repo tiene las tres versiones iguales.
- [ ] Instalado desde el marketplace del repo y desde `godot-agent`, la skill aparece en un proyecto con `compass/` y, sin el MCP, el agente lo registra con `scompass mcp install`.

## 41. Documentos al día para el agente (M26)
<!-- id: documentos-al-dia -->

Un agente lee el GDD (o una sección) al empezar y trabaja horas con esa copia. Mientras tanto el documento puede cambiar: el usuario lo edita, otra sesión lo cambia, llega un `git pull` o se promueve una decisión. Hoy el agente no tiene cómo enterarse y sigue con lo que leyó.

- **Etag del documento:** es el id de blob de git del contenido (`git hash-object`, sha1 de `blob <bytes>\0<texto>`), calculado en JS, con o sin repo. Lo dan `doc show --json` (entero o una sección: siempre el del documento), `GET /api/docs/:alias`, `GET /api/docs/:alias/sections/:id` y `show_doc` del MCP. Es el mismo para el mismo texto en cualquier equipo, y un commit lo guarda tal cual.
- **Qué cambió desde un etag:** `scompass doc changed <alias>[#sección] --since <etag>` y `GET /api/docs/:alias/changes?since=<etag>[&section=<id>]` devuelven `{ alias, path, etag, changed, known, sections: { changed, added, removed } }`.
  - Para comparar hace falta el texto viejo. Se busca primero en la caché de versiones y después en git (`git cat-file blob <etag>` en el repo del documento): una versión commiteada siempre está.
  - **Caché de versiones:** cada vez que se entrega un etag, el texto queda en `<datos>/doc-versions/<etag>.md` si no estaba. Va por contenido, no por sesión, y sirve igual para el hub, la CLI y el MCP. Se borran las de más de 30 días. Así también se encuentra la versión de un documento editado sin commitear.
  - Las secciones se comparan por id: `changed` son las que existen en las dos versiones con otro texto (una sección incluye a las de adentro, así que también cambian las que la contienen), `added` las nuevas y `removed` las que ya no están. Con `section`, `changed` dice si cambió esa sección y la lista se limita a ella y lo que tiene adentro.
  - Si el texto viejo no aparece (`known: false`), solo se sabe que cambió, sin las secciones: hay que leerlo de nuevo.
- **MCP:**
  - `show_doc` devuelve el etag y acepta `since`: si el documento no cambió, contesta solo eso, sin el texto; si cambió, el texto con lo que cambió.
  - **Aviso en los resultados:** el servidor MCP es un proceso por sesión de Claude Code, así que recuerda los documentos que mostró (con `show_doc` o adjuntados con `@`) y con qué etag, sin estado en el hub. Después de cada herramienta mira si alguno cambió (`doc list` da los etags; calcularlos es barato) y, si cambió, agrega al resultado un bloque de texto con el documento y las secciones, y lo mismo en `structuredContent.avisos`. Avisa una vez por versión, y deja de avisar cuando lo vuelve a leer. Un documento que ya no está también se avisa.
  - **Sin `resources/subscribe`:** la documentación de Claude Code no dice que se suscriba a recursos ni que le muestre al modelo un `notifications/resources/updated` (revisado el 2026-11-15). Además, un servidor MCP común no empuja nada a la sesión; los *channels* sí, pero están en preview y piden `--channels` al arrancar. Por eso el aviso va en los resultados de las herramientas.
- **AGENTS.md:** volver a leer un documento antes de basarse en él para una decisión o un cambio de código si pasó tiempo, si el MCP avisó o si se promovió una decisión. Para preguntar, `show_doc` con `since`, o `doc changed --since` por la CLI.

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/api/docs/:alias/changes?since=<etag>[&section=<id>]` | `{etag, changed, known, sections: {changed, added, removed}}` |

```
scompass doc changed <alias>[#sección] --since <etag> [--json]   # sale con 0 si no cambió y con 1 si cambió
```

### Criterios de aceptación

- [x] `doc show --json`, la API y `show_doc` dan el etag del documento, igual a `git hash-object` del archivo.
- [x] `doc changed --since` dice qué secciones cambiaron, cuáles son nuevas y cuáles se quitaron, con el texto viejo de la caché o de git; sin él, `known: false`.
- [x] `show_doc` con el mismo etag no repite el texto; con otro, lo da con las secciones cambiadas.
- [x] Un documento que el MCP mostró y después cambió genera un aviso, una sola vez, en el resultado de la herramienta siguiente.
- [x] AGENTS.md (y la skill del plugin) dicen cuándo volver a leer un documento y cómo preguntar si cambió.

## 42. Patrones prohibidos (M30)
<!-- id: patrones-prohibidos -->

Algunos proyectos tienen texto que no puede aparecer en el tablero ni en los documentos. Por ejemplo, una reimplementación a sala limpia no puede citar nombres de archivos ni de funciones del código original, y un proyecto bajo NDA no puede nombrar al cliente. Un agente que lee una referencia y anota lo que vio los cuela sin querer. La lista de lo prohibido vive en el proyecto, y el tablero la hace cumplir.

- **`config.json › forbidden`:** una lista de expresiones regulares de JavaScript. Cada una es un texto (`"\\bCliente\\b"`) o un objeto `{ pattern, ignore_case?, note? }`. `note` dice por qué está prohibido y sale en el mensaje. Sin `forbidden` no se revisa nada.
- **Al escribir:** toda escritura del store (tareas, hitos, listas, sesiones de playtest y lo que agreguen la CLI, la API, el MCP, la web y el dock) revisa todos los textos del documento, a cualquier profundidad, contra los patrones. Si alguno coincide, la escritura entera se rechaza con `forbidden_pattern`, que es HTTP 422 en la API, y no se escribe nada.
  - El mensaje dice el archivo, el campo (`checklist[2].detail`), el texto que coincidió, el patrón y la nota.
  - La API trae además `error.matches` con `{ where, pattern, note, match }`.
  - `config.json` no se revisa: es donde están los patrones.
  - La config se lee de nuevo en cada escritura, así que un patrón agregado vale enseguida, sin reiniciar el hub.
  - Un patrón inválido frena las escrituras con un mensaje que lo nombra (`forbidden[0]: /(roto/ no es una expresión regular válida`), en lugar de dejar pasar todo.
- **`scompass lint`:** revisa lo que se editó a mano, sin pasar por el store.
  - Recorre todos los `.json` de `compass/` (menos `config.json`, `schema/`, `images/` y las carpetas ocultas; un JSON roto se avisa y se sigue) y los documentos declarados en `config.json › docs` (el texto entero, con el número de línea).
  - Imprime una línea por coincidencia y un resumen, y sale con 1 si hay alguna. Con `--json`: `{ patterns, files, findings: [{ file, where | line, pattern, note, match }] }`.
  - El export markdown no se revisa porque se genera de los JSON.
  - Sirve como gancho de pre-commit o en CI.
- **Plantilla:** `init --template clean-room` (§16.6) trae patrones de ejemplo y las reglas que ningún patrón puede hacer cumplir.
- **Lo que no hace:** no revisa el código del proyecto ni los commits. Para eso está el gancho de git del proyecto, que puede llamar a `scompass lint` o usar los mismos patrones. Tampoco reescribe nada: quien escribió decide cómo decirlo sin el texto prohibido.

```
scompass lint [--json]   # sale con 1 si hay coincidencias
```

### Criterios de aceptación

- [x] `forbidden` en `config.json` acepta textos y objetos `{pattern, ignore_case, note}`, y el schema rechaza campos de más.
- [x] Una escritura por la CLI, la API o el MCP con una coincidencia se rechaza entera con el campo, el texto, el patrón y la nota; la API responde 422 con `matches`.
- [x] Un patrón inválido frena las escrituras con un mensaje claro.
- [x] `scompass lint` encuentra coincidencias en los JSON editados a mano y en los documentos (con la línea), y sale con 1.

## 43. Cobertura de los documentos (M30)
<!-- id: cobertura -->

`refs check` va de las tareas a los documentos: qué referencias se rompieron. La cobertura va al revés, de los documentos a las tareas. Dice qué partes del diseño no tienen ninguna tarea y cuáles ya están hechas.

- **Por sección:** las tareas que la referencian, con una ref estructurada o un enlace `[[alias#id]]` en la descripción, las notas, la prueba o los pasos. Lo que está entre `` `…` `` no cuenta, igual que en `refs check`.
  - Una tarea que referencia una sección **cubre también las de adentro**: la sección de afuera es el pedido más amplio. Esas tareas llevan `from` con el id de la sección que referencian.
  - Una referencia al documento entero no cubre ninguna sección: va aparte, en `whole`.
- **Estado de una sección:**
  - `done`: la cubren tareas y todas están hechas (`done`; una en revisión todavía no).
  - `open`: alguna de las que la cubren no está hecha.
  - `inside`: ninguna la cubre, pero sí a una sección de adentro.
  - `none`: ninguna tarea la toca. Es diseño sin planificar.
- **CLI:** `scompass refs coverage [<alias>] [--uncovered] [--json]` imprime por documento el resumen y, por sección (con sangría por nivel), el estado y las tareas: el código, ✓ si está hecha y «por <sección>» si viene de afuera. `--uncovered` deja solo las secciones `none`. Sale con 0: la cobertura informa, no es un error.
- **API:** `GET /api/refs/coverage[?doc=<alias>][&uncovered=1]` devuelve `{ docs: [{ alias, path, whole, sections: [{ id, title, level, line, state, tasks: [{ id, code, title, status, from? }] }], counts: { done, open, inside, none } }] }`. Un alias que no existe da 404.
- **MCP:** `doc_coverage` con `doc` y `uncovered`.
- **Web (Documentos):**
  - El punto de cada sección del índice muestra el estado: verde si está hecha, el color de "En curso" si está abierta, un aro si tiene tareas adentro y gris si no tiene ninguna.
  - La ficha de una sección agrega, debajo de las tareas que la referencian, las de cada sección de afuera («Por <título>») y una línea con el estado.
  - La ficha del documento muestra el resumen de cobertura. «Secciones sin tareas» cuenta solo las `none`: una sección cubierta desde afuera, o con tareas adentro, ya no aparece ahí.

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/api/refs/coverage[?doc=<alias>][&uncovered=1]` | Por sección: estado y tareas que la cubren |

```
scompass refs coverage [<alias>] [--uncovered] [--json]
```

### Criterios de aceptación

- [x] `refs coverage` da por sección las tareas que la cubren (refs y enlaces, también desde una sección de afuera) y su estado; `--uncovered` deja las que no toca ninguna.
- [x] La API y `doc_coverage` del MCP dan lo mismo que `refs coverage --json`.
- [x] En la web, el índice marca el estado de cada sección, la ficha muestra las tareas heredadas y el documento tiene su resumen.

## 44. Merge driver de git para compass/ (M7)
<!-- id: merge-driver -->

Dos cambios a la misma tarea dan conflicto de git aunque toquen campos distintos: aprobar una decisión en el teléfono mientras un agente tilda pasos, o dos worktrees que avanzan la misma tarea. El merge por líneas de git no sabe que un JSON canónico es un objeto.

- **`scompass merge-json %O %A %B %P`:** el driver de git, un merge a tres bandas campo por campo. No necesita hub ni proyecto: git lo corre con archivos temporales, en Linux y en Windows, en ramas y en worktrees.
  - Un campo que cambió de un solo lado toma ese valor; si cambió igual en los dos, también.
  - Las listas se juntan **por elemento**, con la identidad de cada uno:
    - `created_at` en los ítems de las listas;
    - `at` en las decisiones;
    - `doc#section` en las refs;
    - `text` en los pasos;
    - `task` en los vínculos y en los ítems de playtest;
    - el valor en los textos sueltos (etiquetas, archivos, capturas, criterios de un hito).

    Así se juntan pasos tildados de los dos lados, pasos y etiquetas agregados en los dos, y lo que uno quitó. Un elemento que cambió adentro se junta campo por campo, con las mismas reglas.
  - El orden de una lista es el del lado que la reordenó (por ejemplo, las tareas de una sesión de playtest); si no, el nuestro. Lo que agregó el otro lado va después del elemento que tenía antes, o al final si lo agregó al final.
  - `updated_at` toma el mayor.
  - El resultado sale en formato canónico (§4.4) y validado contra el schema del tipo, que sale de la ruta (`%P`).
- **Conflicto:** si los dos lados cambiaron lo mismo de forma distinta (también un elemento que uno quitó y el otro cambió), o el resultado no pasa el schema, el driver hace lo que haría git sin él (`git merge-file`, con marcadores) y sale con 1. El archivo queda en conflicto y el store lo marca inválido (§4.3), como siempre. Una tarea borrada de un lado y cambiada del otro es un conflicto de git que no pasa por el driver.
- **Registro:**
  - `compass/.gitattributes` dice `*.json merge=scompass`. Viene de la plantilla, y `scompass update` lo pone al día.
  - El driver va en `.git/config` del repo de `compass/`, con `git -C compass config`: el repo de tableros si es un enlace (§36) o el del proyecto si es una carpeta suya.
  - Lo hacen `init` (si ya hay repo) y `update` (también `update --all`, "Actualizar todos" y el "Actualizar compass/" de la bandeja). El comando lleva la ruta entera de este `scompass`, sin depender del PATH, con barras `/`.
  - No pisa un `merge.scompass.driver` ajeno (uno sin `merge-json`). Uno nuestro con otra ruta, por ejemplo después de reinstalar, se pone al día.
  - Sin el driver registrado, git ignora el atributo y mergea por líneas como antes.

```
scompass merge-json <base> <nuestro> <de ellos> [<ruta>]   # sale con 0 si juntó, 1 si queda conflicto
```

### Criterios de aceptación

- [x] Dos ramas que cambian campos distintos de la misma tarea se mergean sin conflicto, en formato canónico, con el `updated_at` mayor.
- [x] Pasos tildados en los dos lados, y pasos y etiquetas agregados en los dos, se juntan por elemento.
- [x] El mismo campo cambiado distinto en los dos lados queda con marcadores y el store lo marca inválido; un resultado que no pasa el schema también queda en conflicto.
- [x] Una tarea borrada de un lado y cambiada del otro da el conflicto de siempre de git.
- [x] `init` y `update` registran el driver en el repo de `compass/` sin pisar uno ajeno.

## 45. Interfaz en inglés y castellano (M32)

La CLI, el MCP, el hub (sus mensajes de error), la web del tablero, el Inicio, la bandeja y el dock de Godot hablan castellano o inglés (D56). Los datos que escribe el usuario quedan como los escribió.

- **Catálogos:** el texto fuente es el castellano del código y es la clave, como en gettext. En JS, ``T`Tarea ${id}` `` busca `"Tarea {0}"` en `hub/locales/en/<área>.po` (`cli`, `mcp`, `hub`, `web`, `home`); en GDScript, `I18n.t("Hub en %s") % url` en `addons/scope_compass/i18n/en.po`, que Godot carga solo. Sin entrada (o en castellano), el texto sale tal cual. Sin librerías (`hub/src/i18n.js`, `addons/scope_compass/i18n.gd`).
- **El idioma:**
  - `SCOMPASS_LANG=es|en` gana sobre todo (los tests lo fijan en `es`).
  - Si no, el que eligió el usuario: `scompass lang es|en|auto` o el selector de Ajustes de la web y del Inicio, guardado en `<config>/settings.json › language`.
  - Si no, el del sistema en la CLI y el MCP (`LC_ALL`, `LC_MESSAGES`, `LANG`; en Windows, el formato regional) y el del navegador (`Accept-Language`) en cada pedido al hub y al Inicio. Cada pedido corre con su idioma, también los errores del store.
  - El dock: `SCOMPASS_LANG`, el ajuste del editor `scope_compass/language` (Auto, English, Español; se aplica al reabrir el editor) o el idioma del editor. Manda su idioma en `Accept-Language`, así los errores del hub le llegan igual. El editor no traduce los textos del dock con su propio catálogo.
  - Un idioma que no es castellano cuenta como inglés.
- **La web** carga `/i18n.js` antes que `app.js` y `home.js`: el idioma del pedido, el catálogo de la web y `T`. Los textos fijos del HTML se traducen al cargar (`I18N.dom`). `GET /api/lang` da `{ lang, chosen, forced }` y `PUT /api/lang { lang: 'es' | 'en' | null }` lo elige.
- **El idioma del tablero** (`config.json › language`, `es` o `en`; sin él, `es`) es el de lo que se escribe en el tablero y no depende de quién mira: `compass/AGENTS.md` (`hub/templates/compass-AGENTS.en.md`), `compass/README.md`, el export markdown (que se llama `tasks.md`) y las entradas que agrega Promover. `init` lo pone según el idioma de la interfaz o `--lang`; el Inicio, según el de quien crea el proyecto. Las plantillas tienen su versión en `hub/templates/proyectos/en/` (mismos nombres; `init` también acepta `game` y `empty`). `update` deja la guía en el idioma del tablero.
- **Comprobar:** `node tools/i18n.mjs check` lista lo que falta traducir, lo que sobra y los `{n}` o `%s` que no coinciden; `sync <área>` agrega los textos nuevos con el `msgstr` vacío. `hub/test/i18n.test.js` falla si un catálogo no está completo.

### Criterios de aceptación

- [x] Con el navegador en inglés, el tablero y el Inicio salen en inglés, y elegir Español en Ajustes los cambia (`ui-i18n`, `ui-home-i18n`).
- [x] Con `SCOMPASS_LANG=en`, la CLI, los errores del hub, las descripciones del MCP y el dock salen en inglés (`i18n`, `i18n-hub`, `dock`).
- [x] `init --lang en` crea el tablero con la guía, el README, el export y la plantilla en inglés, y `update` la mantiene.
- [x] Los tests de siempre pasan con el idioma fijo en castellano, y cada texto que se usa está en el catálogo.

## 47. Chat con Antigravity CLI (M27)
<!-- id: chat-agy -->

El chat de §32 también anda con Antigravity CLI (`agy`), el reemplazo de Gemini CLI para cuentas personales (D58). Lo que se promete es lo mismo que con Claude Code: lee el proyecto y opera el tablero con `scompass`, pero no edita archivos ni corre comandos. Lo que sigue se comprobó con agy 1.4.12, con turnos reales por ACP el 2026-11-15 (m27-01, m27-02).

- **El motor:** cada conversación es de un motor, `claude` o `agy`, que queda anotado en `index.json` (`engine`; sin él, `claude`).
  - Las nuevas usan el que está elegido en Ajustes, que es por equipo (m27-04).
  - Si están los dos, por defecto `claude`; si está uno solo, ese.
- **El proceso:** el hub lanza `agy acp --app-data-dir scope-compass-chat` en la carpeta del proyecto y le habla ACP (JSON-RPC 2.0, una línea por mensaje, por stdio). Hay un proceso por conversación mientras se usa, y se cierra a los 10 minutos sin uso, como con `claude`.
  - **Ejecutable:** `agy` del PATH (en Windows también `agy.exe` y `agy.cmd`), o el de `SCOMPASS_AGY` (para el test). Si no está, `agy_missing` (503).
  - **Arranque:**
    - `initialize` con `protocolVersion: 1` y sin capacidades de archivos ni terminal.
    - Después `session/new { cwd, mcpServers }` para una conversación nueva, o `session/resume { sessionId, cwd, mcpServers }` para retomarla. Si `session/resume` falla, se crea una sesión nueva y la conversación lo dice.
  - **MCP:** `mcpServers` lleva un solo servidor, `scompass`, el mismo comando que con `claude`. agy lo lanza al crear la sesión y es el único de la sesión: no se toca `~/.gemini/config/mcp_config.json` ni el repo.
  - **Instrucciones:** el primer mensaje de una sesión nueva lleva delante las mismas instrucciones que `prompt.md` de §32.
- **Solo lectura (D58):** con la config del usuario no alcanza.
  - **El problema:** con `agentMode` en `auto` (el valor por defecto de agy desde 1.4), agy escribe archivos dentro del proyecto sin pedir permiso. ACP no tiene `session/set_mode`, así que el modo sale siempre de `settings.json`.
  - **Ajustes propios del chat:** por eso el chat usa ajustes aparte, en `~/.gemini/scope-compass-chat/` (`--app-data-dir` es relativo a `~/.gemini`). Ahí también quedan sus conversaciones; la carpeta se puede borrar.
    - Su `settings.json` tiene `agentMode: ""` (Default) y `toolPermission: "strict"`. Así, cada edición y cada comando pasan por `session/request_permission`, y el login es el mismo del usuario.
    - El hub crea el archivo si no está. Si está y dice otra cosa en esas dos claves, no arranca (`agy_unsafe`) y no lo pisa: el mensaje dice qué valor poner.
    - Nunca se toca `~/.gemini/antigravity-cli/settings.json`.
  - **Los permisos los contesta el hub:** a cada `session/request_permission` responde sin preguntarle a nadie.
    - Permite las lecturas (`kind` `read` o `search`) y las herramientas de `scompass`.
    - Niega todo lo demás con la opción `reject_once`: editar, borrar, mover, correr comandos, buscar en la web.
    - Las reglas `permissions.allow` del usuario no saltean este pedido: `command(echo)` y `command(godot)` le preguntaron igual al hub.
  - **Vigilancia:** si una herramienta que edita o corre comandos (`kind` `edit`, `delete`, `move` o `execute`) termina `completed` sin haber pasado por el permiso, el hub mata el proceso. El turno termina con el error `agy_unsafe`, que dice qué revisar. El próximo mensaje vuelve a lanzar agy y vuelve a revisar los ajustes.
  - **Lo negado se dice:** después de un rechazo, agy suele terminar el turno sin texto. Si un turno termina sin texto y hubo algo negado, el chat lo dice («No se hizo: …; el chat solo lee el proyecto y opera el tablero»).
- **Eventos:** de `session/update` se usan:
  - `agent_message_chunk` → `text`.
  - `tool_call` → `tool`, con `name` (`run_command`, `read_file`, `write_file`, `mcp_scompass_<herramienta>`, que se muestra como `<herramienta>`) y `kind`.
  - `tool_call_update` con `completed` o `failed` → `tool_result`.
  - Al final, la respuesta de `session/prompt` (`stopReason`, `usage`) → `end`, con los tokens. agy no da costo.
  - Se ignoran `agent_thought_chunk`, `available_commands_update` y `session_info_update`.
- **Cortar:** `session/cancel`. Si no termina en 5 segundos, se mata el proceso y la conversación sigue con `session/resume`.
- **Conversaciones:** el id de la conversación lo elige el hub (un uuid), y el `sessionId` de agy se anota en `index.json` como `agy_session`. La copia liviana es la misma de §32.
- **Preguntas abiertas (25.8):** agy no pone un id de sesión en el entorno de los MCP que lanza. El hub le pasa al MCP `SCOMPASS_CHAT_SESSION=<id de la conversación>`, y `scompass decide --ask` (y `add_decision` con `ask`) lo toman si no está `CLAUDE_CODE_SESSION_ID`. *Seguir en el chat* encuentra la conversación por ese id.
- **Perfiles y límites (§33):** son de Claude Code. Una conversación con agy no tiene perfil ni muestra límites.
- **Test:** un `agy` falso en Node habla ACP: `initialize`, `session/new`, `session/resume`, `session/prompt` con texto, una herramienta de `scompass`, un pedido de permiso que el hub tiene que rechazar, una edición sin permiso que el hub tiene que cortar y `session/cancel`. Revisa además que lo lancen con `--app-data-dir scope-compass-chat` y con los ajustes seguros.

## 49. Vincular el teléfono al chat (M29)
<!-- id: vincular-dispositivos -->

Hoy el chat solo atiende a 127.0.0.1, también con `--lan` (§32, D43). Sin login, cualquiera en la red usaría la cuenta de Claude de este equipo y leería el repo con el agente. El pedido es usar el chat desde el teléfono, con el perfil de este equipo. La idea es vincular el teléfono una vez, desde este equipo, y que el chat acepte «local o vinculado». Es la opción (a) de D36, solo para el chat.

- **Vincular:** en el Inicio de este equipo, *Vincular teléfono* (también en el menú de la bandeja) crea un código de un solo uso y muestra la dirección de la red con el código.
  - La dirección es `http://<ip de la red>:<puerto>/vincular#<código>`, con un QR hecho sin librería (D60). El código va en el fragmento, que el navegador no manda al servidor ni guarda en los logs de nadie.
  - Solo se puede pedir un código desde 127.0.0.1: desde la red no se vincula nada.
  - En la web: el botón *Vincular teléfono* del encabezado del Inicio aparece solo si la página se abrió en este equipo (127.0.0.1, localhost o ::1). Abre un diálogo con el QR, la dirección para copiar, las otras direcciones de la red si hay más de una, y *Dispositivos vinculados* con *Quitar*. El diálogo se pone al día con el evento `devices` del WebSocket del Inicio: cuando el teléfono canjea el código, dice que quedó vinculado. Si el código vence, ofrece otro.
  - El QR lo arma `web/qr.js`, sin librería: modo byte, corrección M, versiones 1 a 10 y la máscara de menor penalidad. Un test lo compara módulo por módulo con `qrencode` cuando está instalado.
  - La página `/vincular` del teléfono saca el código de la dirección apenas carga, pide un nombre y lo canjea. Después, cada tablero abierto desde ese teléfono muestra el botón *Chat*, porque el pedido a `api/chats` ya lleva la cookie.
  - Hace falta el Inicio con `--lan` (o la IP de Tailscale, m7-02). Si no está, `POST /api/devices/code` da 409 y el diálogo lo dice.
  - El código (12 bytes al azar, base64url) vence a los 5 minutos (D60), sirve una sola vez y vive solo en la memoria del Inicio. Con 5 intentos fallidos seguidos se anulan los códigos pendientes. Un código que no sirve da 403.
- **Canje:** la página `/vincular` del teléfono manda el código a `POST /api/devices/pair` con un nombre (hasta 60 caracteres; sin nombre, «Teléfono»), y el Inicio le devuelve una cookie con un token propio de ese dispositivo.
  - El token: 32 bytes al azar (base64url).
  - Se guarda solo su SHA-256, en `<config>/scope-compass/devices.json`, junto a `chats/`: es de la máquina y no va a git. Cada entrada es `{ id, name, hash, created_at, last_seen }`.
  - La cookie: `scompass_device`, `HttpOnly`, `SameSite=Strict`, `Path=/`, por un año. Lleva `Secure` cuando el pedido llega por HTTPS (`tailscale serve`).
  - Sin TLS, la cookie viaja en claro por el wifi, igual que hoy el tablero con `--lan`. Fuera de casa va por Tailscale, que cifra.
- **El chat acepta «local o vinculado»:**
  - `/p/<clave>/api/chats` y los eventos `chat` del WebSocket del proyecto atienden a 127.0.0.1 o a un pedido con una cookie válida. El WebSocket la revisa al abrirse y cada vez que se manda un evento `chat`.
  - El chequeo lo hace el Inicio. Al hub de un proyecto que sirve él (sin puerto, por `inject`) le avisa que el pedido es de un vinculado con una cabecera interna que lleva un secreto de ese proceso; desde afuera no se puede mandar, porque el Inicio solo deja pasar las cabeceras que conoce. `createServer` recibe `chatAllow(req)`, que por defecto es solo 127.0.0.1.
  - Cada pedido válido anota `last_seen`, como mucho una vez por minuto.
  - Nada más cambia de permisos. El agente sigue con lectura y el tablero (§32), sin Bash ni Edit. El resto de la API con `--lan` ya estaba abierto a la red (D36) y no depende de la cookie.
  - Con token de hosting (§12) el chat sigue apagado.
- **El panel en el teléfono** (hasta 760 px de ancho, como el detalle de la tarea):
  - Va a pantalla completa encima del tablero, que no se desplaza por debajo.
  - Abrirlo agrega una entrada a la historia: *Atrás* lo cierra sin salir del tablero, y × la saca.
  - Con el teclado abierto, la altura sigue a `visualViewport` (en iOS el teclado no achica la página). En Android, `interactive-widget=resizes-content` hace lo mismo.
  - El cuadro de texto usa 16 px, para que iOS no haga zoom.
  - La cuenta y los límites quedan plegados en una línea con el perfil.
  - No se vuelve a abrir solo al recargar.
- **Revocar:**
  - En el Inicio, *Dispositivos vinculados* muestra el nombre, cuándo se vinculó y el último uso, con *Desvincular*. Por la CLI: `scompass devices` y `scompass devices rm <id>`.
  - Desvincular borra la entrada: el próximo pedido da 403, y los WebSocket abiertos de ese dispositivo se cierran enseguida (código 4403). El Inicio mira `devices.json` cada segundo, así que también los cierra si se desvinculó con la CLI, desde otro proceso.
  - Solo se administra desde 127.0.0.1.
- **Hub suelto:** un proyecto que sirve un hub suelto, y no el Inicio, se usa desde el teléfono a través del Inicio, que ya reenvía a los hubs sueltos (§16). El chat pasa por el chequeo del Inicio, y el hub suelto lo atiende porque le llega desde 127.0.0.1. Un hub suelto abierto con su propio `--lan` no acepta dispositivos: su chat sigue solo local (D60).
- **Lo que no cambia:**
  - Las conversaciones siguen siendo de este equipo, en `<config>/scope-compass/chats/`: el teléfono ve las mismas.
  - El perfil de Claude Code es el que elige el proyecto (§33).
  - No hay cuentas ni contraseñas, y no hace falta un servicio público ni un espejo de `compass/`: el teléfono habla con este equipo.

| Método | Ruta | Qué hace |
|---|---|---|
| `POST` | `/api/devices/code` | Solo local: crea un código de un solo uso y devuelve la dirección para el QR |
| `POST` | `/api/devices/pair` | `{ code, name }` → crea el dispositivo y deja la cookie |
| `GET` | `/api/devices` | Solo local: los dispositivos vinculados, sin el hash |
| `DELETE` | `/api/devices/:id` | Solo local: lo desvincula y cierra sus WebSocket |

```
scompass devices            # los dispositivos vinculados
scompass devices rm <id>    # desvincular
```

### Criterios de aceptación

- [x] Desde la red no se puede pedir un código ni administrar dispositivos.
- [x] Un código sirve una vez y vence; 5 intentos fallidos anulan los pendientes.
- [x] Con la cookie, el chat del proyecto anda desde el teléfono; sin ella, 403 como hoy.
- [x] Desvincular corta el próximo pedido y cierra los WebSocket abiertos.
- [x] `devices.json` guarda solo el hash del token.

## 50. Editar una sección desde la web (M26)
<!-- id: editar-seccion -->

Aprobado por Dann el 2026-11-15 (D61); implementado en m26-06. D33 descartaba editar documentos desde la web: duplica el editor, y sin git para resolver conflictos se pierden cambios. D42 ya deja que la app escriba documentos (*Promover*). Con el etag de documento de §41, el riesgo de pisar una edición hecha en el editor se puede detectar por sección.

- **Alcance:** una sección por vez, en texto Markdown, desde la vista de la sección en la biblioteca (§20). No es un editor del documento entero ni WYSIWYG, y no hay CLI ni herramienta del MCP: el agente y la persona en su equipo editan el archivo directamente.
- **Guardar:** `PUT /api/docs/:alias/sections/:id` con `{ markdown, etag }`, donde `etag` es el del documento que dio el `GET` (§41).
  - Si el etag es el actual, se reemplaza la sección.
  - Si es otro, se busca el texto viejo (caché de versiones o git) y se mira con `sectionChanges` si cambió *esa* sección o alguna de adentro. Si no cambió, el cambio se aplica sobre el texto actual: otra sección editada en el editor no bloquea. Si cambió, o si el texto viejo no aparece, la respuesta es 409 (`conflict`) con `error.current: { etag, markdown }`, el etag del documento y el texto actual de la sección (`markdown: null` si la sección ya no está). La web muestra los dos para que la persona junte a mano.
  - Antes de escribir, el texto actual queda en la caché de versiones; la respuesta da `{ etag, previous }`. *Deshacer* vuelve a guardar el texto de `previous` con el etag nuevo, por el mismo camino.
- **Qué se reemplaza:** el rango entero de la sección (título, línea del id, texto y las secciones de adentro), como lo da `sections/:id`. El texto nuevo tiene que empezar con un título del mismo nivel y no puede tener títulos de ese nivel o de uno mayor más abajo, porque crearía otra sección fuera del rango (un título dentro de un bloque de código no cuenta). Si no cumple, 422 con el código `invalid_section`. El fin de línea del texto que llega no importa: se escribe con el del archivo.
- **El id:** si el título cambia y la sección no tenía `<!-- id -->`, se le pone el id que tenía (como `doc stamp-ids`), para que las referencias de las tareas no se rompan. Un id explícito que se quita o se cambia en el texto vuelve a ponerse; para cambiar un id se edita el archivo.
- **Cómo se escribe:** escritura atómica, con el fin de línea del archivo (LF o CRLF) y sin commit (D33, D42): el cambio queda en el árbol de trabajo, a la vista en la biblioteca, igual que *Promover*. El watcher de documentos avisa a las demás pestañas y al MCP (§41). Los patrones prohibidos (§42) se miran en el texto nuevo; si alguno aparece, 422 como en el store.
- **Web:** con una sección elegida en la biblioteca, *Editar sección* cambia el texto renderizado por un campo con su Markdown (Ctrl+Enter guarda; *Cancelar* con cambios pide un segundo clic, *Descartar los cambios*).
  - Ante un 409, el campo queda con el texto propio y al lado, el que está ahora en el archivo, con *Usar el del archivo*. Se juntan a mano y *Guardar* va con el etag nuevo. En el teléfono, uno debajo del otro.
  - Un 422 se muestra debajo del campo, sin cerrarlo.
  - Después de guardar, *Deshacer* queda junto a *Copiar enlace* hasta la próxima edición: vuelve a guardar el texto que había justo antes, que con un 409 de por medio es el del archivo. Si la sección cambió otra vez, no deshace y lo dice.
- **Un editor abierto con el mismo archivo:** la mayoría de los editores recargan un archivo que cambió en el disco, o avisan si tienen cambios sin guardar. El caso que no se cubre es guardar desde el editor una copia vieja después de editar en la web, y eso git lo muestra en el diff.
- **Quién puede:** lo mismo que escribe el tablero, también desde la red con `--lan` (D61).
- **Archivos con CRLF:** el índice de secciones reconoce los títulos de un archivo con fin de línea CRLF (antes no veía ninguno).

| Método | Ruta | Qué hace |
|---|---|---|
| `PUT` | `/api/docs/:alias/sections/:id` | `{markdown, etag}` → `{etag, previous, id, markdown}`; 409 con `error.current: {etag, markdown}` si la sección cambió; 422 si el texto se sale de la sección o tiene un patrón prohibido |

### Criterios de aceptación

- [x] Guardar una sección con el etag actual la reemplaza y deja el resto del archivo byte por byte igual, con su fin de línea.
- [x] Con un etag viejo, guardar anda si esa sección no cambió desde entonces y da 409 con el texto actual si cambió o si la versión vieja no aparece.
- [x] Un texto que empieza sin título del nivel de la sección, o que agrega un título de su nivel, da 422.
- [x] Cambiar el título de una sección sin id explícito le pone su id de antes.
- [x] *Deshacer* deja el archivo como estaba.
- [x] Nada se commitea.
