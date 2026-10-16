# Tareas — Scope Compass

> Export de `compass/`, que es la fuente de verdad. No editar: los cambios se hacen en `compass/` o con `scompass`, y este archivo se regenera.
> Generado: 2026-10-16

## M0 — Fundaciones del repo  (6/6)

Repo inicializado con el spec ordenado, las decisiones registradas, los schemas, el tablero propio y la estructura base. Se abre en Godot.

**Hecho cuando:**
- El repo está en GitHub (`dannroda/scope-compass`).
- Se abre en Godot 4.8 sin errores y el addon stub se activa.
- Las decisiones abiertas del spec están resueltas o con fecha para decidir.

### 0.1 Estructura base del repo · Hecho

**Terminada:** 2026-09-29

- [x] Carpetas `docs/`, `schema/`, `hub/`, `web/`, `addons/scope_compass/`, `tools/`, `compass/`
- [x] `README.md` en la raíz y en cada carpeta sin código
- [x] `.gitignore`, `.gitattributes`, `.editorconfig`
- [x] `project.godot` mínimo
- [x] `hub/package.json` con el `postinstall` que crea `node_modules/.gdignore`
- [x] Primer commit y remoto `origin`
- [x] Push a GitHub

**Prueba:** `git ls-files` muestra la estructura de `docs/spec.md` §9.

**Referencias:** `docs/spec.md#estructura-repo`

### 0.2 Spec y decisiones · Hecho

**Terminada:** 2026-09-29

- [x] Spec ordenado: nombre Scope Compass, rutas de referencias, `compass/` visible, estructura del repo
- [x] Ids de sección estampados en `docs/spec.md`
- [x] `docs/decisiones.md` con D1–D9

**Notas:** Razonamiento de cada decisión en `docs/decisiones.md`.

**Referencias:** `docs/spec.md#objetivo`

### 0.3 Schemas · Hecho

**Terminada:** 2026-09-29

- [x] `schema/milestone.schema.json` y `schema/task.schema.json`
- [x] Copia en `compass/schema/`
- [x] `schema/config.schema.json` para `compass/config.json`
- [x] Validar los datos existentes contra los schemas

**Prueba:** Los JSON de `compass/` y de `project-epiphany/compass/` validan contra `schema/`.

**Notas:** Validador: `uv run tools/validate.py compass ../project-epiphany/compass` (schemas, formato canónico, conflictos, hitos inexistentes). La copia del schema de config en `project-epiphany/compass/schema/` queda para cuando Epiphany adopte la CLI (M4).

**Referencias:** `docs/spec.md#validacion`

### 0.4 Decisiones abiertas · Hecho

**Terminada:** 2026-09-29

- [x] Licencia del repo: MIT (`LICENSE`, `hub/package.json`)
- [x] Versión mínima de Node: 22 (`engines`)
- [x] Hitos: solo CLI en v1; la UI los muestra
- [x] Export markdown automático en cada escritura, desactivable con `auto_export_md`

**Notas:** Decisiones D10–D13 en `docs/decisiones.md`: MIT, Node >=22, hitos solo por CLI en v1, export markdown automático (`auto_export_md`, activado por defecto).

**Referencias:** `docs/spec.md#decisiones-abiertas`

### 0.5 Abrir el repo en Godot · Hecho

**Terminada:** 2026-09-29

- [x] Abre en Godot 4.8 sin errores
- [x] El addon `scope_compass` se activa
- [x] Editor Settings › Docks › FileSystem › TextFile Extensions: agregar `js,html,css` (`md` y `json` vienen por defecto)
- [x] `compass/` no aparece en el FileSystem (`.gdignore`)

**Prueba:** Abrir `../scope-compass` en Godot 4.8, activar el addon y editar `hub/README.md` desde el editor.

**Notas:** Probado con Godot 4.8-dev6 (`.godot-version`). El addon queda activado en `project.godot`; `compass/` no aparece en la caché del FileSystem.

**Referencias:** `docs/spec.md#godot`

### 0.6 Tablero y documentación propios · Hecho

**Terminada:** 2026-09-29

- [x] Tablero en artifact con los hitos M0–M7
- [x] Copia en `compass/` en formato canónico
- [x] `docs/tareas.md` generado

**Notas:** Mientras no exista la app, el tablero vive en el artifact y `compass/` es su copia en git.

## M1 — Store + CLI (sin servidor)  (7/7)

Leer y escribir `compass/` con validación, formato canónico y ETag, desde la CLI `scompass`, sin hub corriendo.

**Hecho cuando:**
- `scompass import artifact` migra los datos de Project Epiphany sin diferencias.
- `list`, `show`, `add`, `move`, `check` y `export md` funcionan sin servidor.
- `export md` produce lo mismo que `tools/artifact_to_md.py`.
- Un JSON inválido o con marcadores de conflicto se reporta y nunca se sobrescribe.

### 1.1 Formato canónico y escritura atómica · Hecho

**Terminada:** 2026-09-29

- [x] Serializador canónico: claves ordenadas, 2 espacios, UTF-8, salto de línea final
- [x] Escritura atómica: archivo temporal + rename
- [x] Tests de ida y vuelta (leer → escribir → mismo contenido)

**Prueba:** Reescribir un archivo editado a mano no cambia su contenido, solo el formato.

**Notas:** `hub/src/store/canonical.js` y `hub/src/store/atomic.js`. Mismos bytes que el `canon()` de Python de `tools/` (verificado con los 21 JSON de Epiphany y casos límite). Los temporales se llaman `.<archivo>.<hex>.tmp`; el watcher de M2 los ignora con `isTempFile`. Los schemas no están en formato canónico a propósito (orden legible).

**Referencias:** `docs/spec.md#sin-app`, `docs/spec.md#concurrencia`

### 1.2 Validación · Hecho

**Terminada:** 2026-09-29

- [x] Cargar los schemas de `schema/`
- [x] Elegir validador de JSON Schema: ajv (D14)
- [x] Archivo inválido → aviso, no se carga y la carga no lo toca
- [x] Detectar marcadores de conflicto de git

**Prueba:** Un archivo con un campo desconocido o con `<<<<<<<` se reporta y queda sin tocar.

**Notas:** ajv + ajv-formats (D14). `hub/src/schema.js` (`loadValidators`, `parseDoc`) y `hub/src/store/load.js` (`loadCompass`, solo lectura). Avisos con código: `invalid_json`, `invalid_schema`, `conflict_markers`, `unknown_milestone`, `missing_config`. Que una escritura no pise un archivo inválido queda en 1.3.

**Referencias:** `docs/spec.md#validacion`, `docs/spec.md#git-merges`

### 1.3 Store json-files + ETag · Hecho

**Terminada:** 2026-09-29

- [x] Interfaz `Store` (list, get, put, patch, delete)
- [x] Implementación `json-files` sobre `compass/`
- [x] ETag = hash del contenido canónico; conflicto con el documento actual
- [x] Ids nuevos: 8 caracteres base36
- [x] Escribir sobre un archivo inválido o con conflicto se rechaza (no se pisa)

**Prueba:** Dos escrituras con el mismo ETag: la segunda falla con conflicto y devuelve el documento actual.

**Notas:** `hub/src/store/json-files.js`. Sin caché: cada operación lee el disco. Las operaciones del proceso se encolan; entre procesos protege el ETag (16 hex de sha256 del canónico). `patch`: merge de primer nivel, `null` borra el campo. Errores `StoreError` con `invalid_argument`, `not_found`, `conflict` (trae `current`), `invalid_file`, `io_error`.

**Referencias:** `docs/spec.md#modelo`, `docs/spec.md#concurrencia`, `docs/spec.md#arquitectura`

### 1.4 CLI básica · Hecho

**Terminada:** 2026-09-29

- [x] `init`: crea `compass/` con schemas, README, `.gdignore` y `config.json`
- [x] `list` y `show` con `--json`
- [x] `add`, `move`, `check`
- [x] `set` y `milestone set` con `--file`
- [x] `--dir` para apuntar a otro proyecto

**Prueba:** `scompass --dir ../project-epiphany list --json` lista las tareas de Epiphany.

**Notas:** `hub/src/cli.js` + `hub/bin/scompass.js` (`npm link` en `hub/`). Extras sobre el spec: `milestone list|show`, `--etag` en escrituras, `--file -` (stdin), búsqueda de `compass/` hacia arriba. `check` numera desde 1. `serve`, `export` e `import` responden "todavía no está disponible".

**Referencias:** `docs/spec.md#cli`

### 1.5 Export markdown · Hecho

**Terminada:** 2026-09-29

- [x] Port de `tools/artifact_to_md.py`
- [x] `scompass export md [--out]`
- [x] Título y URL del tablero desde `config.json`
- [x] Regenerar después de cada escritura de la CLI si `auto_export_md` no es `false` (D13)

**Prueba:** Para los mismos datos, la salida es idéntica a `tools/artifact_to_md.py` (salvo la fecha).

**Notas:** `hub/src/export-md.js`. Test contra `tools/artifact_to_md.py` con los datos de los dos proyectos: salida idéntica. Con `board_url` en la config el encabezado cita el artifact como fuente de verdad; sin él, dice que la fuente es `compass/` (se quita al migrar).

**Referencias:** `docs/spec.md#cli`

### 1.6 Import desde el artifact · Hecho

**Terminada:** 2026-09-29

- [x] Port de `tools/artifact_to_tablero.py`
- [x] Descarta `version`; `created_at` = `updated_at` si existe
- [x] Reporte de conteos

**Prueba:** Importar el export de Epiphany: 11 hitos y 10 tareas, sin diferencias con `project-epiphany/compass/`.

**Notas:** `hub/src/import-artifact.js` + `scompass import artifact <carpeta> [--dry-run] [--overwrite]`. Export real de Epiphany: 11 hitos y 10 tareas sin cambios contra `project-epiphany/compass/`, e import en limpio idéntico a `tools/artifact_to_tablero.py`. Si el documento ya existe conserva su `created_at`. La detección de notas "gdd.md §N.N" → `refs` (spec §8, notas) queda para M6.

**Referencias:** `docs/spec.md#migracion`

### 1.7 Tests de M1 · Hecho

**Terminada:** 2026-09-30

- [x] Criterios de §14 que no necesitan servidor
- [x] Mover una tarjeta cambia exactamente un archivo y una línea (más `updated_at`)

**Prueba:** `npm test` en `hub/` pasa.

**Notas:** `hub/test/m1-criteria.test.js`: criterios de §14 sin hub, probados como los describe el spec (con git real para el de `git status`). El criterio de "un archivo" se reescribió por D13: también cambia `docs/tareas.md`. Quedan para M2/M3 las partes con servidor, y Windows sin probar (conviene CI con matriz Linux/Windows).

**Referencias:** `docs/spec.md#criterios-v1`

## M2 — Hub: API REST + WebSocket  (8/8)

Servidor Fastify en `127.0.0.1` con la API de §5.2, el protocolo WebSocket de §5.5 y el watcher de cambios externos.

**Hecho cuando:**
- La CLI usa el hub cuando está corriendo y escribe directo cuando no.
- Una escritura con ETag viejo devuelve `409` con el documento actual.
- Editar un JSON a mano se emite por WebSocket en menos de 1 s.
- Un cliente WebSocket mínimo de test recibe `upsert` al mover una tarjeta.

### 2.1 Servidor Fastify y `scompass serve` · Hecho

**Terminada:** 2026-09-29

- [x] Dependencias `fastify` y `@fastify/websocket` (D17)
- [x] Escucha solo en `127.0.0.1`, puerto de `config.json` o `--port`
- [x] `scompass serve [--port] [--open]`; sin `compass/` sugiere `scompass init`
- [x] Errores `{error: {code, message}}` con los códigos del store
- [x] Hook de autenticación por token, apagado en local
- [x] `GET /api/health` con la versión y la ruta del proyecto

**Prueba:** `scompass serve` arranca, `curl 127.0.0.1:4711/api/health` responde, y no escucha en otras interfaces.

**Notas:** `hub/src/server.js` (`createServer`, `listen`) y `scompass serve`. `--open` usa `xdg-open` (D15). Probado a mano: escucha solo en 127.0.0.1 y SIGTERM lo cierra limpio.

**Referencias:** `docs/spec.md#arranque`, `docs/spec.md#arquitectura`, `docs/spec.md#servidor`

### 2.2 API REST · Hecho

**Terminada:** 2026-09-29

- [x] `GET/PUT/DELETE /api/milestones[/:id]`; `DELETE` rechaza con `409` si tiene tareas
- [x] `GET /api/tasks?milestone=&status=`, `POST`, `PATCH`, `DELETE`
- [x] Cabecera `ETag` en cada documento; `If-Match` en escrituras
- [x] `409 conflict` con el documento actual; `invalid_file` como `409`
- [x] `POST /api/export/markdown`

**Prueba:** Dos `PATCH` con el mismo `If-Match`: el segundo devuelve `409` con el documento actual.

**Notas:** `hub/src/api.js`, vistas compartidas con la CLI en `hub/src/views.js`. Extras sobre §5.2: `GET` de un documento, `PUT /api/tasks/:id` y `If-None-Match: *` para crear solo si no existe. Cerrada por la propia API.

**Referencias:** `docs/spec.md#api-rest`, `docs/spec.md#concurrencia`

### 2.3 Watcher de cambios externos · Hecho

**Terminada:** 2026-09-29

- [x] `fs.watch` recursivo sobre `compass/` con debounce
- [x] Ignora los temporales de `writeAtomic`
- [x] Distingue escrituras propias de externas (sin eventos duplicados)
- [x] Archivo inválido → aviso, no se cae el servidor

**Prueba:** Editar un JSON a mano con el hub corriendo emite el cambio en menos de 1 s; un JSON roto emite un aviso.

**Notas:** `hub/src/watcher.js` + bus `app.events` en el servidor (`watch: true` en `serve`). Etag conocido por documento: sin duplicados por escrituras propias ni por reformateos. Tests con disco real, estables en 10 corridas seguidas.

**Referencias:** `docs/spec.md#cambios-externos`, `docs/spec.md#validacion`

### 2.4 WebSocket · Hecho

**Terminada:** 2026-09-29

- [x] `/ws` con `hello` al conectar
- [x] `upsert`, `delete` y `warning` para escrituras de la API y cambios externos
- [x] Mensajes del cliente: `update` → `ack` o `error` (con `conflict` y el documento)

**Prueba:** Un cliente WebSocket mínimo recibe `upsert` al mover una tarjeta por la API y por la CLI.

**Notas:** `hub/src/ws.js`. `update` solo para tareas (como la API, D12); el ack va a quien lo manda y el upsert a todos. Errores sin cerrar la conexión; un error inesperado responde `io_error` en vez de tumbar el hub. Cerrada por el propio WebSocket.

**Referencias:** `docs/spec.md#websocket`

### 2.5 La CLI usa el hub si está corriendo · Hecho

**Terminada:** 2026-09-29

- [x] Detectar el hub en el puerto de la config (`/api/health` del mismo proyecto)
- [x] Escrituras por la API cuando está; si no, directo al disco
- [x] Mismos códigos de salida y la misma salida `--json` en los dos modos

**Prueba:** `scompass move` con el hub corriendo emite el evento por WebSocket; con el hub apagado escribe el archivo igual.

**Notas:** `hub/src/store/http.js`: store sobre la API con la misma interfaz que json-files; la CLI elige uno u otro. Solo usa el hub si `/api/health` es del mismo proyecto. `--direct` fuerza el disco. Test: misma secuencia con y sin hub, salida idéntica. Cerrada por la CLI a través del hub.

**Referencias:** `docs/spec.md#cli`

### 2.6 Export markdown desde el hub · Hecho

**Terminada:** 2026-09-29

- [x] Regenerar `export_md` después de cada escritura de la API (D13)
- [x] Debounce para ráfagas de cambios
- [x] También tras cambios externos detectados por el watcher

**Prueba:** Mover una tarjeta desde la API actualiza `docs/tareas.md`.

**Notas:** `hub/src/auto-export.js` (`exportMd: true` en `serve`). Debounce de 200 ms y relectura de la config en cada export. Al cerrar el hub se hace el export pendiente. Con hub, la CLI ya no exporta. Cerrada con el hub corriendo: el markdown lo generó el hub.

**Referencias:** `docs/spec.md#cli`

### 2.7 Tests de M2 · Hecho

**Terminada:** 2026-09-29

- [x] Criterios de §14 que necesitan servidor (sin UI)
- [x] Escritura concurrente con ETag viejo → `409`
- [x] JSON inválido con el hub corriendo → aviso, el servidor sigue

**Prueba:** `npm test` en `hub/` pasa, incluidos los tests con servidor.

**Notas:** `hub/test/m2-criteria.test.js`: JSON inválido con hub (avisa y sigue respondiendo), CLI con hub incluido `export md`, edición con la app apagada vista al levantarla, conflicto sin sobrescribir por API/CLI/WebSocket, y escrituras concurrentes contra el hub real. Criterios de §14 con UI quedan para M3. Límite conocido: dos `add` simultáneos pueden repetir `order` (se leen antes de escribir); no pierde datos.

**Referencias:** `docs/spec.md#criterios-v1`

### 2.8 Detalles de la CLI: `--etag none`, editar campos, `order` al crear · Hecho

**Terminada:** 2026-09-29

- [x] `--etag none` mapea a `ifMatch: null` (que no exista)
- [x] `set <id> --title/--notes/--test/--code/--milestone/--status` sin `--file`: patch de esos campos
- [x] `order` al crear lo calcula el store dentro de su cola (no la CLI): sin repetidos en `add` simultáneos
- [x] Documentarlo en `--help` y en el spec §6

**Prueba:** `scompass set x --file t.json --etag none` falla con `conflict` si `x` existe; `scompass set m2-08 --notes ...` cambia solo las notas; dos `add` simultáneos por el hub dan `order` distintos.

**Notas:** CLI: `--etag none`, `set` con campos sueltos (patch) y `order` calculado por el store dentro de su cola. Con hub, 6 `add` simultáneos dan order 1..6. Cerrada con `scompass set --status --notes`, lo que agrega esta misma tarea.

**Referencias:** `docs/spec.md#cli`

## M3 — UI web (port del artifact)  (8/8)

La UI del artifact servida por el hub: cliente de la API, WebSocket con reconexión, fuentes locales y las mejoras chicas de §7.

**Hecho cuando:**
- Paridad con el artifact (§2) en claro, oscuro y pantalla angosta.
- Dos pestañas abiertas se sincronizan en menos de 1 s.
- Funciona sin conexión a internet.

### 3.1 Estructura de `web/` servida por el hub · Hecho

**Terminada:** 2026-09-29

- [x] Separar `docs/reference/tablero-artifact.html` en `web/index.html`, `app.css` y `app.js` sin build step
- [x] El hub sirve `web/` en `/` (handler propio, sin dependencia nueva)
- [x] `GET /api/config` con el nombre del proyecto para el título
- [x] Mismo aspecto que el artifact en claro y oscuro

**Prueba:** `scompass serve --open` muestra el tablero con el aspecto del artifact.

**Notas:** `web/index.html`, `app.css` (copiado del artifact) y `app.js`. El hub sirve `/`, `/app.css`, `/app.js` y `/fonts/:file` con rutas fijas. Revisado con capturas de Playwright en claro, oscuro y 390 px. En "Todos" las tarjetas se ordenan por hito y después por order, como `scompass list` (el artifact mezclaba hitos).

**Referencias:** `docs/spec.md#frontend`, `docs/spec.md#v1-paridad`

### 3.2 Cliente de la API y carga inicial · Hecho

**Terminada:** 2026-09-29

- [x] Reemplazar `claude.use("db")` por un cliente de `/api`
- [x] Carga inicial de hitos y tareas
- [x] Crear, mover, editar y borrar tareas por la API

**Prueba:** Crear, mover, tildar pasos y borrar desde la UI cambia los JSON de `compass/`.

**Notas:** Cliente de `/api` en `app.js`; cada escritura aplica el documento que devuelve la API. Prueba de humo con Playwright sobre una copia: crear, mover, tildar, arrastrar y borrar cambian los JSON. Todavía sin etag (3.4) ni WebSocket (3.3).

**Referencias:** `docs/spec.md#frontend`, `docs/spec.md#api-rest`

### 3.3 WebSocket con reconexión · Hecho

**Terminada:** 2026-09-29

- [x] Aplicar `upsert` y `delete` sobre el estado
- [x] Reconexión con espera creciente; al reconectar, recarga completa
- [x] Indicador discreto de "sin conexión con el hub"

**Prueba:** Dos pestañas: mover una tarjeta en una se ve en la otra en menos de 1 s; al reiniciar el hub, la UI se reconecta sola.

**Notas:** WebSocket en `app.js`: carga completa en cada `hello` (también al reconectar) y se repite si llegan eventos durante la carga. Reconexión de 0,5 s a 10 s con aviso en la cabecera. Tests de navegador en `hub/test/ui.test.js`: dos pestañas en menos de 1 s, cambios de la CLI y a mano, hub caído y vuelta.

**Referencias:** `docs/spec.md#websocket`, `docs/spec.md#frontend`

### 3.4 Escrituras con etag y 409 · Hecho

**Terminada:** 2026-09-29

- [x] Cada escritura manda el etag que la UI tiene en memoria
- [x] Ante `409`: tomar el documento actual y avisar "otra pestaña cambió esta tarea"

**Prueba:** Escritura con etag viejo desde una pestaña: la UI muestra el aviso y queda con el documento actual.

**Notas:** Cada escritura manda `If-Match`. Ante `409` la UI toma el documento actual y avisa. Escrituras de una tarea en fila, con el cambio calculado al enviarlo: tildar varios pasos seguidos no da 409 ni pisa. Test con una pestaña que no recibe eventos (`routeWebSocket`) para forzar el 409.

**Referencias:** `docs/spec.md#concurrencia`, `docs/spec.md#frontend`

### 3.5 Avisos de archivos inválidos · Hecho

**Terminada:** 2026-09-29

- [x] Mostrar los `warnings` de la carga y los eventos `warning`
- [x] El aviso desaparece cuando el archivo se corrige

**Prueba:** Romper un JSON a mano con la UI abierta muestra un aviso; arreglarlo lo quita y la tarea vuelve.

**Notas:** Sección de avisos en la UI con los `warnings` de la carga y los eventos `warning`, uno por archivo; se va con el `upsert` o `delete` de ese archivo. Un archivo que pasa a inválido deja de mostrarse como tarjeta.

**Referencias:** `docs/spec.md#validacion`, `docs/spec.md#cambios-externos`

### 3.6 Fuentes locales · Hecho

**Terminada:** 2026-09-29

- [x] Cinzel, Alegreya Sans y JetBrains Mono en `web/fonts/` (OFL, con sus licencias)
- [x] Sin requests a Google Fonts ni a ningún otro host

**Prueba:** Con la red cortada, la UI carga con las mismas tipografías.

**Notas:** `web/fonts/`: 5 woff2 (subconjunto latino, `@fontsource` 5.3.0) y sus licencias OFL. Test de navegador con todo lo que no es 127.0.0.1 bloqueado: ninguna petición externa y las fuentes cargan.

**Referencias:** `docs/spec.md#frontend`

### 3.7 Mejoras chicas del port · Hecho

**Terminada:** 2026-09-29

- [x] No perder lo escrito en el detalle (Notas, Cómo probarlo y "Agregar paso") cuando se vuelve a dibujar, sea por un evento de otra pestaña o por la respuesta de una escritura propia
- [x] Reordenar tarjetas dentro de una columna al arrastrar (`order`)
- [x] Atajos: `N` nueva tarea, `1`–`4` estado de la tarea abierta, `Esc` cierra

**Prueba:** Escribir notas mientras otra pestaña mueve la misma tarea no pierde lo escrito.

**Notas:** Cada campo del detalle guarda en `data-orig` el valor dibujado; lo cambiado y no guardado, el foco y la selección se restauran al redibujar. Reordenar: soltar sobre una tarjeta del mismo hito la deja antes (order intermedio) y toma el estado de esa columna. Atajos N, 1–4 y Esc, nunca mientras se escribe. Los tests de "no perder lo escrito" fallan con el app.js anterior.

**Referencias:** `docs/spec.md#frontend`

### 3.8 Tests de M3 (Playwright) · Hecho

**Terminada:** 2026-09-29

- [x] Playwright como devDependency (D18)
- [x] Criterios de §14 con UI: paridad, dos pestañas, 409, JSON inválido, sin internet
- [x] Claro, oscuro y pantalla angosta

**Prueba:** `npm test` en `hub/` corre también los tests de navegador.

**Notas:** `hub/test/ui.test.js` (Playwright en `node:test`, D18): 15 tests. Paridad con el HTML del artifact en claro/oscuro y 1400/900/390 px (detecta un cambio de un dígito en un token). Cliente WebSocket mínimo mientras la UI arrastra. Sin la app: los JSON validan con `compass/schema/` y el markdown tiene lo hecho. Encontró el cuelgue al cerrar el hub con la UI abierta (arreglado en 3.5/3.6).

**Referencias:** `docs/spec.md#criterios-v1`

## M4 — Adopción en Project Epiphany  (3/4)

Project Epiphany deja el artifact y usa `compass/` + `scompass` a diario.

**Hecho cuando:**
- Epiphany tiene sus datos en `compass/` migrados con `scompass import artifact`.
- El artifact de Epiphany queda como archivo de solo lectura.
- Una semana de uso diario sin volver al artifact.

### 4.1 Migrar Epiphany a `compass/` · Hecho

**Terminada:** 2026-09-29

- [x] Último export del artifact e import con `--dry-run`: 11 hitos y 10 tareas sin cambios
- [x] Quitar `board_url`; copiar `config.schema.json` a su `compass/schema/`
- [x] README de `compass/` y GDD apuntan a `compass/`; `docs/tareas.md` regenerado con `scompass`
- [x] Hub y UI probados con los datos de Epiphany

**Prueba:** `scompass --dir ../project-epiphany list` y la UI muestran las 11 hitos y 10 tareas sin avisos.

**Notas:** Commit `cb42dae` en project-epiphany, sin push (queda para revisar). El artifact de Epiphany quedó archivado.

**Referencias:** `docs/spec.md#migracion`

### 4.2 Una semana de uso diario sin volver al artifact · Pendiente

- [ ] Usar la UI o la CLI para el tablero de Epiphany a diario
- [ ] Anotar acá lo que falte o moleste, como tareas nuevas

**Prueba:** Una semana sin abrir el artifact de Epiphany.

**Notas:** Depende del usuario.

**Relacionadas:** 4.3 Ids legibles al crear tareas; 4.4 Aviso de cambios sin commitear en compass/

### 4.3 Ids legibles al crear tareas · Hecho

**Terminada:** 2026-10-04

- [x] Generar el id a partir del hito: m<N>-<NN> con el siguiente libre
- [x] Usarlo desde la CLI, la API (web) y el dock
- [x] Mantener el aleatorio solo si hay choque
  Por ejemplo, si dos ramas crean la misma tarea: el id tiene que seguir siendo único después del merge.

**Prueba:** scompass add en m00 crea m0-NN con el siguiente número libre; la web y el dock hacen lo mismo.

**Notas:** `taskIdFor` en el Store: lo usan la CLI, la API (web, dock, Inicio) y `item task`. El paso 3 quedó como: un hito con id no numérico usa aleatorio, y si otro proceso tomó el número entre la lectura y la escritura, el siguiente. Choques entre ramas: conflicto add/add de git (D27).

**Relacionadas:** 4.2 Una semana de uso diario sin volver al artifact

### 4.4 Aviso de cambios sin commitear en compass/ · Hecho

**Terminada:** 2026-10-04

- [x] El hub detecta archivos de compass/ con cambios (git status)
- [x] Mostrar el aviso en la web y en el dock, con la cantidad de archivos
- [x] scompass list lo menciona al final

**Prueba:** Mover una tarjeta muestra el aviso en la web y en el dock; después de commitear, desaparece.

**Notas:** `hub/src/git.js` (`boardStatus`: compass/ + export_md). El hub publica `git` tras cada cambio y recuenta cada 3 s mientras haya algo pendiente (un commit no toca compass/). Web: aviso en la cabecera con los archivos en el tooltip. Dock: el pie se resalta y toma el número del hub. Inicio: la tarjeta lo muestra. CLI: línea al final de `list`.

**Relacionadas:** 4.2 Una semana de uso diario sin volver al artifact

## M5 — Dock de Godot (v1.5)  (12/12)

Addon `scope_compass` con un dock que muestra las tareas del hito actual y las mueve a través del hub.

**Hecho cuando:**
- El dock funciona en Godot 4.8 (API de docks verificada).
- Mover una tarea desde el dock se ve en la UI web al instante, y al revés.
- Sin hub corriendo, el dock muestra las tareas leyendo `compass/` en solo lectura.

### 5.1 Estructura del addon con `EditorDock` · Hecho

**Terminada:** 2026-09-29

- [x] Dock con `EditorDock` + `add_dock` (API de 4.8, D19)
- [x] Vista del dock como `Control` aparte, testeable sin el editor
- [x] Se agrega y se quita limpio al activar y desactivar el plugin

**Prueba:** Activar el plugin muestra el dock "Tablero"; desactivarlo lo quita sin errores.

**Notas:** `scope_compass.gd` monta `dock_view.gd` (un VBoxContainer) dentro de un `EditorDock`. Probado en el editor sin ventana sobre este repo: se monta y se desmonta sin errores.

**Referencias:** `docs/spec.md#godot`

### 5.2 Modo sin hub: leer `compass/` · Hecho

**Terminada:** 2026-09-29

- [x] Leer hitos y tareas con `FileAccess`/`JSON`, mismo orden que la CLI; los inválidos se avisan
- [x] Selector de hito (por defecto el primero sin terminar; se recuerda por proyecto)
- [x] Tareas agrupadas por estado, plegables, con código, título y pasos
- [x] Aviso de solo lectura, "Reintentar" y "Abrir compass/tasks"
- [x] Pie con "N sin commitear" (`git status`)

**Prueba:** Sin hub, el dock muestra las tareas del hito y un aviso de solo lectura.

**Notas:** `compass_reader.gd` (lectura y validación mínima, mismos avisos que el hub), `board.gd` (orden de la CLI; hito por defecto: el primero sin terminar) y `dock_view.gd`. Sin hub relee cada 5 s. Tests de Godot sin ventana desde `npm test` (`hub/test/dock.test.js`). `web/fonts/.gdignore`: Godot importaba las fuentes.

**Referencias:** `docs/spec.md#godot`, `docs/spec.md#sin-app`

### 5.3 Cliente del hub · Hecho

**Terminada:** 2026-09-29

- [x] Detectar el hub por `/api/health` del mismo proyecto
- [x] Carga por HTTP y cambios por `WebSocketPeer` con reconexión
- [x] Pasar de solo lectura a edición (y al revés) según haya hub

**Prueba:** Con el hub corriendo, un cambio desde la UI web se ve en el dock al instante.

**Notas:** `hub_client.gd`: detecta el hub por `/api/health` del mismo proyecto, carga por HTTP y aplica eventos del `WebSocketPeer`. Sin hub reintenta cada 3 s y lee compass/. Tests con Godot y un hub reales: un cambio de la web llega al dock en menos de 1 s; el hub se cae y vuelve y el dock se reconecta solo.

**Referencias:** `docs/spec.md#godot`, `docs/spec.md#websocket`

### 5.4 Editar desde el dock · Hecho

**Terminada:** 2026-09-29

- [x] Cambiar el estado y tildar pasos
- [x] Etag y 409 (en fila por tarea, como la UI web)
- [x] "Nueva tarea" y abrir el tablero en el navegador

**Prueba:** Mover una tarea desde el dock se ve en la UI web al instante.

**Notas:** Estado y pasos editables, en fila por tarea con el cambio calculado al enviar (como la UI web); `409` toma la versión actual y avisa. "Nueva tarea" en el hito elegido y botón para abrir el tablero en el navegador. Coordinación Godot ↔ Node en los tests por líneas de stdout y un archivo marcador.

**Referencias:** `docs/spec.md#godot`, `docs/spec.md#concurrencia`

### 5.5 Iniciar el hub desde el dock · Hecho

**Terminada:** 2026-09-29

- [x] "Iniciar hub" con `OS.create_process` (ruta a `scompass` configurable)
- [x] Cerrarlo al salir del editor solo si lo abrió el dock

**Prueba:** Sin hub, "Iniciar hub" lo levanta y el dock pasa a edición; al cerrar el editor, el hub se cierra.

**Notas:** "Iniciar hub" busca scompass en Editor Settings (`scope_compass/scompass_path`), al lado del proyecto, dentro de él o en el PATH. Se lanza por `sh` con la salida a `.godot/scope_compass_hub.log` (si no, heredaba el stdout de Godot y colgaba los tests). Al salir, SIGTERM solo si lo abrió el dock.

**Referencias:** `docs/spec.md#godot`

### 5.6 Tests de M5 · Hecho

**Terminada:** 2026-09-29

- [x] Godot sin ventana lanzado desde `npm test` (se saltea si no hay `godot`)
- [x] Dock ↔ UI web en los dos sentidos; modo sin hub

**Prueba:** `npm test` en `hub/` corre también los tests de Godot.

**Notas:** `hub/test/dock.test.js`: 12 casos con Godot sin ventana (sin hub, con hub en los dos sentidos, 409, pasos seguidos, nueva tarea, reconexión, iniciar y cerrar el hub). Estables en 3 corridas.

**Referencias:** `docs/spec.md#criterios-v1`, `docs/spec.md#godot`

### 5.7 Instalar el addon en Epiphany · Hecho

**Terminada:** 2026-09-29

- [x] Symlink `project-epiphany/addons/scope_compass` → este addon
- [x] Activarlo y usarlo con el tablero de Epiphany

**Prueba:** El dock de Epiphany muestra sus tareas.

**Notas:** Symlink `project-epiphany/addons/scope_compass` → `../../scope-compass/addons/scope_compass` y activado en su `project.godot`. El editor de Epiphany lo carga sin errores y el dock lee su tablero. Con tareas de muchos pasos, el detalle ahora tiene su propio scroll.

**Referencias:** `docs/spec.md#godot`

### 5.8 El hub lanzado por el dock muere con el editor · Hecho

**Terminada:** 2026-09-29

- [x] `scompass serve --exit-on-stdin-close`: se cierra cuando se corta su entrada
- [x] El dock lo lanza con `OS.execute_with_pipe` (la salida sigue yendo al log)
- [x] Probado matando a Godot con `kill -9`: el hub se va solo

**Prueba:** Iniciar el hub desde el dock y matar a Godot con `kill -9`: el hub se cierra en menos de 2 s.

**Notas:** `scompass serve --exit-on-stdin-close` y el dock lo lanza con `OS.execute_with_pipe` (la salida sigue yendo a `.godot/scope_compass_hub.log`). Al cerrar el dock se corta la tubería; si en 3 s sigue vivo, SIGTERM. Test: Godot lanza el hub y Node lo mata con `kill -9`; con la versión anterior el hub quedaba vivo, ahora se va en menos de 3 s. También probado con el editor real cerrándose normalmente.

**Referencias:** `docs/spec.md#godot`

### 5.9 Opción de mantener el hub, con ícono en la bandeja · Hecho

**Terminada:** 2026-09-29

- [x] `scompass serve --tray`: ícono en la bandeja de Plasma (StatusNotifierItem por D-Bus, D20)
- [x] Tooltip con proyecto y dirección; clic abre el tablero; menú "Abrir tablero" y "Detener hub"
- [x] Editor Settings `scope_compass/keep_hub_running`: el dock lo lanza independiente y con `--tray`
- [x] Epiphany en el puerto 4712 para poder tener los dos hubs a la vez

**Prueba:** Con la opción activada, cerrar el editor deja el hub y su ícono; "Detener hub" desde la bandeja lo cierra.

**Notas:** `hub/src/tray.js` (D20): ícono, tooltip con proyecto y dirección, clic abre el tablero, menú "Abrir tablero" / "Detener hub". Probado en un bus privado (el test hace de Plasma) y registrado en el Plasma real. Editor Settings `scope_compass/keep_hub_running`: el dock lo lanza sin tubería y con `--tray`, y no lo cierra. `create_process` ya pone al hijo en su propia sesión (setsid sobraba y cambiaba el PID). Epiphany pasó al puerto 4712 (commit `1277eec` allá).

**Referencias:** `docs/spec.md#godot`

### 5.10 Reiniciar el hub (dock, bandeja, CLI y API) · Hecho

**Terminada:** 2026-09-30

Pedido del usuario, para cargar código nuevo sin cerrar el editor.

**Notas:** `POST /api/restart`: el hub cierra, libera el puerto y se relanza con los mismos argumentos (y el puerto que tenía de verdad), heredando entrada y salida: si lo lanzó el dock sigue atado a Godot por la misma tubería. `/api/health` informa el PID. Dock: botón "Reiniciar hub" en el pie; bandeja: "Reiniciar hub" en el menú; CLI: `scompass restart`. Detalles: la tubería "pipe" de Node es un par de sockets y el test necesitó un pipe real (cat); OS.is_process_running de Godot no ve al hub reiniciado (es nieto), se usa kill -0. Los tests que leen Epiphany ya no dependen de su contenido exacto.

### 5.11 Dock: el texto del paso despliega su detalle, divisor lista/detalle, bloque de tareas plegable · Hecho

**Terminada:** 2026-09-30

Pedido del usuario. El cuadradito tilda y el texto (o ▸) despliega el detalle: tildar al tocar el texto era contraintuitivo.

**Notas:** VSplitContainer entre la lista de tareas y el detalle, con el divisor recordado por proyecto; "▾ Tareas · n" pliega la lista y el detalle usa todo el alto (también recordado). De paso: el selector de hito fijaba el ancho mínimo del dock al del hito más largo (`fit_to_longest_item = false`) y los botones del aviso bajan de renglón.

### 5.12 Bandeja: "Actualizar compass/" cuando el schema o AGENTS.md quedaron viejos · Hecho

**Terminada:** 2026-10-04

Pedido al usar Epiphany.

- [x] Lógica de `scompass update` en `hub/src/update.js`, compartida por la CLI y el hub
- [x] Ítem del menú visible solo si hay archivos viejos; se reevalúa al abrir el menú (AboutToShow)
- [x] Tests en un bus D-Bus privado

**Prueba:** Con `compass/schema/task.schema.json` viejo, el menú muestra "Actualizar compass/ (1 archivo)"; al tocarlo se copia el schema y el ítem desaparece.

**Notas:** `startTray` ahora acepta `label` y `visible` como funciones y expone `refresh()` (emite LayoutUpdated). Los ids del menú son la posición + 1: Abrir 1, Actualizar 2, Reiniciar 3, Detener 4.

## M6 — Documentos y referencias (v2)  (12/12)

Visor de documentos del proyecto (GDD) y referencias estables entre tareas y secciones (§10).

**Hecho cuando:**
- Una tarea con `refs` muestra la sección renderizada en su detalle, con GDScript resaltado.
- Renombrar o renumerar una sección con id no rompe referencias.
- `scompass refs check` detecta referencias rotas.
- El dock muestra la sección referenciada en BBCode.

### 6.1 Parser de documentos e índice de secciones · Hecho

**Terminada:** 2026-09-29

- [x] Índice `{id, title, level, start, end}`; una sección llega hasta el próximo título de nivel igual o superior
- [x] Id explícito (`<!-- id: … -->`) o slug del título, marcado como frágil
- [x] Documentos de `config.json › docs` (alias y ruta o patrón)
- [x] `scompass doc list` y `doc show <alias>#<id> [--raw]`

**Prueba:** `scompass --dir ../project-epiphany doc show gdd#ventanas-ataque --raw` devuelve justo esa sección.

**Notas:** `hub/src/docs.js`: índice de secciones (ignora bloques de código; ids explícitos o slug frágil; ids explícitos repetidos avisan), documentos por ruta o patrón, y refs resueltas por ruta (`gdd.md`) o alias (`gdd`). `scompass doc list` y `doc show alias#id [--raw|--json]`. Todas las refs de este repo resuelven contra `spec.md`.

**Referencias:** `docs/spec.md#ids-seccion`, `docs/spec.md#documentos-servidor`

### 6.2 Chequeo y edición de referencias · Hecho

**Terminada:** 2026-09-29

- [x] `scompass refs check`: lista las rotas y sale con código ≠ 0
- [x] `scompass ref add <tarea> <alias>#<id>` (y quitar)
- [x] `scompass doc stamp-ids <alias>`: estampa ids en las secciones que no tienen

**Prueba:** Renombrar el título de una sección con id no rompe nada; borrar su id hace fallar `refs check`.

**Notas:** `refs check` (refs y enlaces `[[alias#id]]` en notas, prueba y pasos; lo que está entre `…` es un ejemplo y no cuenta; sale con 1 si hay rotas, avisa las frágiles), `ref add|rm` (guarda la ruta del documento, como las refs existentes) y `doc stamp-ids [--dry-run]` (estampa el slug actual, así las refs frágiles siguen resolviendo). Criterio: renombrar el título no rompe; borrar el id sí.

**Referencias:** `docs/spec.md#ids-seccion`, `docs/spec.md#referencias`

### 6.3 API de documentos y render · Hecho

**Terminada:** 2026-09-29

- [x] `GET /api/docs`, `/api/docs/:alias`, `/api/docs/:alias/sections/:id` (con backlinks), `/api/refs/broken`
- [x] Markdown renderizado con GDScript resaltado, librerías empaquetadas (D21)
- [x] El watcher mira los documentos: evento `doc_changed`

**Prueba:** Editar `gdd.md` con el hub corriendo emite `doc_changed` en menos de 1 s.

**Notas:** `hub/src/docs-api.js` (`/api/docs`, `/api/docs/:alias`, `/sections/:id` con las tareas que la referencian, `/api/refs/broken`), `hub/src/render.js` (D21) y `hub/src/doc-watcher.js` (`doc_changed`, mira la carpeta de cada documento). Con Epiphany: backlinks de sus 12 refs y los bloques de GDScript resaltados.

**Referencias:** `docs/spec.md#documentos-servidor`, `docs/spec.md#cambios-externos`

### 6.4 UI web: referencias en el detalle · Hecho

**Terminada:** 2026-09-29

- [x] Sección "Referencias" con cada sección renderizada y plegable, y "Abrir en el documento"
- [x] Buscador de secciones para agregar referencias; quitar
- [x] Indicador en la tarjeta y aviso si alguna está rota

**Prueba:** Una tarea con `refs` muestra la sección renderizada en su detalle, con GDScript resaltado.

**Notas:** Sección "Referencias" en el detalle: cada una plegable (la primera abierta), sección renderizada (sin repetir el título), "Abrir en el documento", quitar. Buscador por título o id para agregar. Rotas: aviso con "Buscar la sección nueva". Tarjetas: § n, en rojo si hay rotas.

**Referencias:** `docs/spec.md#documentos-ui`, `docs/spec.md#referencias`

### 6.5 UI web: vista Documentos · Hecho

**Terminada:** 2026-09-29

- [x] Pestaña "Documentos" al lado de los hitos
- [x] Índice lateral y contenido renderizado
- [x] Junto a cada título, cuántas tareas lo referencian, con la lista

**Prueba:** Los backlinks de cada sección coinciden con las `refs` de las tareas.

**Notas:** Pestañas Tablero | Documentos con el hash (`#docs/gdd/ventanas-ataque`). Índice con punto verde y contador de tareas por sección (gris = sin planificar), documento renderizado, "Referenciada por" que sigue a la sección visible, contador de refs rotas y el botón para copiar `[[alias#id]]`. Backlinks calculados en el navegador. Al entrar a Documentos se cierra el detalle de la tarea (lo tapaba).

**Referencias:** `docs/spec.md#documentos-ui`

### 6.6 Enlaces en línea `[[alias#id]]` · Hecho

**Terminada:** 2026-09-29

- [x] En notas, "Cómo probarlo" y pasos: enlace con el título actual de la sección
- [x] Rotos: marcados como tales

**Prueba:** `[[gdd#ventanas-ataque]]` en una nota se ve como "Ventanas de ataque" y abre la sección.

**Notas:** `rich()` convierte `[[alias#id]]` (fuera de `código`) en enlace con el título actual de la sección, o lo marca roto. En las tarjetas (botones) va como texto. Debajo de Notas y "Cómo probarlo" (textareas) se listan sus enlaces.

**Referencias:** `docs/spec.md#referencias`

### 6.7 Dock: referencias en BBCode · Hecho

**Terminada:** 2026-09-29

- [x] `GET /api/docs/:alias/sections/:id?format=bbcode`
- [x] El detalle del dock lista las referencias y muestra la sección en un `RichTextLabel`

**Prueba:** El dock muestra la sección referenciada sin salir de Godot.

**Notas:** `?format=bbcode` en `/api/docs/:alias/sections/:id` (`renderBBCode`: títulos, listas, tablas simples, enlaces, corchetes escapados y GDScript coloreado con los tokens de Prism). El dock lista las refs de la tarea, plegables, con la sección en un RichTextLabel y "↗" a la UI web; sin hub, el markdown leído de disco (`compass_reader.read_docs`, mismo parser en GDScript). Una vez apareció en una captura con xvfb el aviso de "Iniciar hub" sin que nadie lo tocara; no se repitió en 4 corridas.

**Referencias:** `docs/spec.md#godot`, `docs/spec.md#documentos-servidor`

### 6.8 Migración de notas "§N.N" · Hecho

**Terminada:** 2026-09-29

- [x] Detectar "`gdd.md` §N.N" en notas, pruebas y pasos
- [x] Proponer la referencia equivalente (sin aplicarla sola)

**Prueba:** En Epiphany, las notas con "§" dan propuestas revisables.

**Notas:** `scompass refs suggest` (`suggestRefs` en `docs.js`): cita "`gdd.md` §4.3" o "gdd §4.3" → la sección cuyo título empieza con ese número; marca las que ya son ref y da el `ref add` listo. `import artifact` avisa si hay por revisar. En Epiphany: sus 2 citas ya eran referencias.

**Referencias:** `docs/spec.md#migracion-notas`

### 6.9 Tests de M6 · Hecho

**Terminada:** 2026-09-29

- [x] Criterios de §10.6
- [x] Con los documentos reales de Epiphany y de este repo

**Prueba:** `npm test` en `hub/` pasa con los tests de documentos.

**Notas:** Criterios de §10.6 cumplidos: tests de docs (parser, refs check, stamp-ids, suggest), API, UI (detalle, vista Documentos, enlaces, cambio de gdd.md medido: menos de 1 s en 3 ediciones seguidas, sección borrada marca la tarea en vivo) y dock (BBCode con y sin hub), con los documentos reales de Epiphany y de este repo.

**Referencias:** `docs/spec.md#criterios-v2`

### 6.10 Snippets del dock en CodeEdit con el resaltado del editor · Hecho

**Terminada:** 2026-09-29

Pedido del usuario: los snippets en el dock se ven mejor en un CodeEdit.

**Notas:** `?format=blocks` (texto en BBCode, código crudo); el dock usa `GDScriptSyntaxHighlighter` del editor (verificado en el editor: resaltado y fuente `EditorFonts/source`); fuera del editor, un CodeHighlighter básico.

### 6.11 UI web: "Cerrar" del buscador de referencias y panel de detalle redimensionable · Hecho

**Terminada:** 2026-09-29

Reportado por el usuario. "Cerrar" no cerraba: el buscador abierto sin texto guarda "" y el toggle lo tomaba como cerrado.

**Notas:** Panel: borde izquierdo arrastrable (y flechas, Shift = paso grande), entre 360 px y 90 % de la ventana, recordado en el navegador; doble clic vuelve a 460 px.

### 6.12 Pasos con texto corto y detalle desplegable · Hecho

**Terminada:** 2026-09-30

Pedido del usuario: los pasos eran ambiguos cortos o demasiado largos para el dock.

**Notas:** `checklist[].detail` opcional. Web: ▸ despliega, ✎ edita texto y detalle (vacío lo quita). Dock: ▸ debajo del checkbox. CLI: `step add|set|rm`, `show` con el detalle sangrado. Export md con el detalle sangrado (y `tools/artifact_to_md.py`, para seguir idénticos). Los enlaces del detalle cuentan en refs check, backlinks y refs suggest. `refs suggest` también reconoce "en el GDD (§4.3)".

## M7 — Hosting privado  (0/2)

El mismo hub en un servidor privado para usarlo desde el teléfono, con git como almacenamiento (§12).

**Hecho cuando:**
- Desde el teléfono se ve y se edita el tablero (PWA).
- Los cambios se commitean y se pushean solos, sin forzar nunca ante conflictos.
- El hub pide token y no queda expuesto a internet sin login.

### 7.1 Investigar: abrir el hub desde el teléfono por la LAN · Revisión

**Prioridad:** media · **Etiquetas:** `investigacion`, `seguridad`

Pedido desde Project Epiphany (2026-10-10): ver el panel en el teléfono por el wifi de casa. Por ahora alcanza con abrirlo en la red, sin login (usuario, 2026-10-10).

- [x] Relevar el estado actual
  El hub escucha solo en 127.0.0.1 y sin auth (spec §servidor). createServer ya acepta un token, pero como header Authorization: Bearer, que el navegador del teléfono no puede mandar. Hoy funciona un túnel SSH desde el teléfono (Termux / Termius).
- [x] Comparar opciones de acceso
  (a) --lan escuchando en la IP local + token por link que queda en cookie (y QR en la CLI); (b) auth de verdad: usuario/contraseña o passkey con sesión; (c) Tailscale (o similar) y seguir escuchando solo en la interfaz de la VPN; (d) reverse proxy con login delante (Caddy + basic auth, Cloudflare Access). Para cada una: seguridad en un wifi compartido, fricción en el teléfono, trabajo en el hub, si sirve también para el hosting de §12.
- [x] Riesgos a cubrir
  HTTP sin TLS en la LAN (token o cookie viajan en claro), el WebSocket también autenticado, CSRF en la API de escritura, endpoints peligrosos (/api/shutdown, restart) que no deberían quedar expuestos, el Inicio (multi-hub) que proxea proyectos, y revocar el acceso.
- [ ] Probar en un teléfono real
  Android e iPhone si se puede, con scompass home --lan: abrir la dirección que escribe, editar y ver los cambios en vivo (WebSocket). Login y PWA quedan para 7.2 (D36).
- [x] Decisión
  Registrar en docs/decisiones.md la opción elegida y lo descartado; dejar las tareas de implementación en M7.

**Prueba:** D36 registra la comparación de las cuatro opciones. Con scompass home --lan, el tablero se abre y se edita desde el teléfono por el wifi de casa; un Host con nombre o un pedido con el Origin de otra página dan 403. Sin login, por pedido: es para la red de casa.

**Notas:** Hecho: --lan en serve y home (listen en 0.0.0.0; las URLs de siempre siguen en 127.0.0.1 para el dock, la CLI y el Inicio, y se imprimen las direcciones de la red, también en --json). El chequeo de Host (D34) acepta una IP y no un nombre. Además, cualquier pedido con un Origin distinto de http://<Host> da 403 en el hub y en el Inicio: faltaba también en local, donde cualquier página podía hacer POST /api/shutdown o abrir el WebSocket y leer el tablero. Probado con un Inicio aislado --lan por 192.168.100.56 desde Chromium a 390×844: el tablero carga, el WebSocket conecta y un PATCH desde la página se guarda; Host malo.example y un POST con Origin ajeno dan 403. --host <ip> descartado: el dock y la CLI hablan por 127.0.0.1. De paso: el import de Godot en los tests del dock a veces aborta al salir (bug de tiempos del motor: EditorHelp::load_script_doc_cache diferido corre con EditorNode ya borrado); se reintenta una vez. Encontrado al probarlo: con un Inicio ya corriendo sin --lan, scompass home --lan decía que ya corría y salía sin hacer nada; ahora el registro anota lan y el comando falla diciendo que hay que cerrarlo.

**Referencias:** `docs/spec.md#hosting`, `docs/spec.md#servidor`

### 7.2 Acceso fuera de casa con Tailscale · Pendiente

**Prioridad:** baja · **Etiquetas:** `seguridad`

La opción recomendada en D36 para cuando la red de casa no alcance: cifrado de punta a punta, solo tus dispositivos y HTTPS sin escribir autenticación.

- [ ] Probar --lan por la IP de Tailscale (100.x) desde el teléfono con datos móviles
  Debería andar sin cambios: es una IP más, y el hub escucha en todas las interfaces.
- [ ] HTTPS con tailscale serve
  Aceptar el nombre *.ts.net en el chequeo de Host si tailscale serve lo reenvía, y ver que el WebSocket pase por wss://.
- [ ] PWA instalable sobre HTTPS
  Manifest y service worker; caché del último estado para leer sin conexión (§12).

**Prueba:** Desde el teléfono, fuera de casa, el tablero se abre por HTTPS dentro de la tailnet, se instala como app y otro dispositivo fuera de la tailnet no llega.

**Referencias:** `docs/spec.md#hosting`

## M8 — Inicio, listas y plantillas (v3)  (17/17)

Página de Inicio con todos los proyectos, listas con fecha límite y repetición, y plantillas de proyecto (§16). Local; el mirror always-on queda para M7.

**Hecho cuando:**
- El Inicio muestra todos los proyectos del equipo, con o sin hub, y los prende y apaga.
- Un proyecto creado con la plantilla personal abre en Listas, con fechas límite y repetición simple.
- Con el Inicio en la bandeja hay un solo ícono.

### 8.1 Registro persistente de proyectos · Hecho

**Terminada:** 2026-10-04

- [x] `~/.config/scope-compass/projects.json` (`$XDG_CONFIG_HOME`), escritura atómica
- [x] `scompass serve` anota o actualiza su proyecto
- [x] `scompass home add|rm|list`: importar sin levantar el hub
- [x] Carpetas que ya no existen: marcadas como no encontradas
  No se borran solas: el usuario decide.

**Prueba:** Levantar un hub desde el dock lo agrega a `projects.json`; `scompass home add ../otro` lo agrega sin levantar nada.

**Notas:** `hub/src/projects.js`: `{ projects: [{ path, name, added_at, last_seen }] }` en `$SCOMPASS_CONFIG` o `$XDG_CONFIG_HOME/scope-compass/projects.json`, canónico y con escritura atómica. Las rutas se comparan resueltas (un symlink no duplica). Un registro inválido tira error y no se pisa; `serve` avisa y levanta igual. `npm test` usa una config temporal. Los hubs que ya estaban corriendo se anotan recién al reiniciarlos.

**Referencias:** `docs/spec.md#v3-registro`

**Bloquea a:** 8.8 `scompass home`: proceso y API

### 8.2 Fecha límite (`due`) en tareas · Hecho

**Terminada:** 2026-10-04

- [x] Schema: `due` opcional, `YYYY-MM-DD` o con `THH:MM`
- [x] CLI: `add|set --due` y la fecha en `list` y `show`
- [x] Export md: `**Vence:**` debajo del título

**Prueba:** `scompass set <id> --due 2026-10-10` cambia una sola línea del JSON (más updated_at) y la fecha aparece en `list`, `show` y `docs/tareas.md`.

**Notas:** `hub/src/dates.js`: `parseDue`, `isValidDue` (también para las listas), `dueState` (overdue/today/later, hora local; sin hora vence al terminar el día). `list` marca "(vencida)" y "(hoy)" salvo en las hechas. La parte visual pasó a 8.13.

**Referencias:** `docs/spec.md#v3-fechas`

**Bloquea a:** 8.13 Fechas límite en la web y el dock

### 8.3 Listas: schema, Store y CLI · Hecho

**Terminada:** 2026-10-04

- [x] `schema/list.schema.json` y `compass/lists/<id>.json`
- [x] Store: cargar, validar y escribir listas con etag
- [x] CLI: `lists`, `list-add`, `item add|check|rm`
- [x] Export md: una sección por lista

**Prueba:** `scompass item check pendientes 2` con y sin hub cambia una sola línea.

**Notas:** `schema/list.schema.json`, colección `lists` en el Store (crea la carpeta si falta), `hub/src/lists.js` (slug del id, `isValidDue`). CLI `lists` y `item` (incluye `item task`, que adelanta un paso de 8.4). Para que la CLI ande con hub hizo falta la API REST de listas (`/api/lists`): queda hecha acá; 8.4 suma la vista web. El watcher ya publica las listas; la web y el dock ignoran colecciones que no muestran. Export: sección "Listas" al final.

**Referencias:** `docs/spec.md#v3-listas`

**Bloquea a:** 8.4 Listas: API, WebSocket y vista en la web; 8.5 Repetición simple en ítems de lista; 8.7 Plantillas en `scompass init`

### 8.4 Listas: API, WebSocket y vista en la web · Hecho

**Terminada:** 2026-10-04

- [x] `/api/lists` y mensajes con `kind: "list"`
- [x] Pestaña Listas: barra lateral, lista simple y agrupada por fecha
- [x] Agregar rápido, quitar tildadas, reordenar
- [x] Pasar a tarea: crea la tarea y enlaza el ítem
  Guarda el id de la tarea en `task` del ítem.
- [x] Pestañas según `config.views` (sin `views`: board, lists, docs) y abrir en la primera

**Prueba:** Dos pestañas: tildar un ítem en una se refleja en la otra en menos de 1 s.

**Notas:** Endpoints nuevos en `hub/src/api.js` (crear, tildar, pasar a tarea) para no duplicar reglas en la web. La vista re-arma todo en cada evento y restaura lo que se estaba escribiendo y el foco. Tests en `hub/test/ui-lists.test.js`.

**Referencias:** `docs/spec.md#v3-listas`

**Bloqueada por:** 8.3 Listas: schema, Store y CLI

### 8.5 Repetición simple en ítems de lista · Hecho

**Terminada:** 2026-10-04

- [x] `repeat: { every: day|week|month|year }`, requiere `due`
- [x] Tildar avanza `due` desde la fecha límite
  Fin de mes: 31/01 mensual pasa a 28/02 (o 29/02).
- [x] CLI `--repeat` y la repetición visible en la web

**Prueba:** Un ítem mensual con `due` 2026-01-31 pasa a 2026-02-28 al tildarlo; sigue sin tildar.

**Notas:** `nextDue` en `hub/src/dates.js`; `checkItem` en `hub/src/lists.js` (la van a usar la web y el Inicio, no solo la CLI). Schema: `repeat` con `dependentRequired` → `due`; `interval` todavía no se acepta. Destildar uno que se repite es un error. La parte visible en la web va con 8.4.

**Referencias:** `docs/spec.md#v3-fechas`

**Bloqueada por:** 8.3 Listas: schema, Store y CLI

### 8.6 `views` en `config.json` · Hecho

**Terminada:** 2026-10-04

- [x] Schema de config: `views` con `board`, `lists`, `docs`
- [x] Sin `views`: las tres, tablero primero (`viewsOf` en `hub/src/views.js`)

**Prueba:** Con `views: [\"lists\", \"board\"]` el schema la acepta y `viewsOf` la devuelve; repetidas, vacía o desconocidas no validan.

**Notas:** `/api/config` devuelve la config tal cual: los clientes aplican el mismo default que `viewsOf`. Las pestañas de la web pasaron a 8.4.

**Referencias:** `docs/spec.md#v3-plantillas`

**Bloquea a:** 8.7 Plantillas en `scompass init`

### 8.7 Plantillas en `scompass init` · Hecho

**Terminada:** 2026-10-04

- [x] `hub/templates/proyectos/juego|personal|vacio.json`: config y datos iniciales
- [x] `scompass init --template <nombre>`
- [x] La plantilla personal crea el hito General

**Prueba:** `scompass init --template personal --project Vida` en una carpeta vacía crea un proyecto que abre en Listas.

**Notas:** Las plantillas son JSON, no carpetas: más fáciles de revisar en un diff. `juego` crea `docs/gdd.md` solo si no existe. `init` anota el proyecto en el registro. El selector de plantilla del dock pasó a 8.14.

**Referencias:** `docs/spec.md#v3-plantillas`

**Bloquea a:** 8.14 Dock: "Crear compass/" con plantilla

**Bloqueada por:** 8.3 Listas: schema, Store y CLI; 8.6 `views` en `config.json`

### 8.8 `scompass home`: proceso y API · Hecho

**Terminada:** 2026-10-04

- [x] Un solo `home` por usuario (`kind: "home"` en el registro de hubs)
- [x] Leer cada proyecto de disco con el Store; cruzar con los hubs vivos
- [x] WebSocket a los hubs vivos para cambios en vivo
- [x] Escrituras por el hub si está vivo, si no directo con etag
- [x] `/api/projects` y `/api/today`

**Prueba:** Con un hub vivo y otro proyecto apagado, `GET /api/projects` devuelve los dos con su estado.

**Notas:** `hub/src/home.js` (servidor), `hub/src/summary.js` (resumen y Hoy, funciones puras). El registro de hubs anota el Inicio con `kind: \"home\"`; `hubsOf` lo excluye. Los proyectos se nombran por ruta en la API, no por índice. Todavía no sirve una página: la UI es 8.10.

**Referencias:** `docs/spec.md#v3-home`

**Bloquea a:** 8.9 Prender y apagar hubs desde el Inicio; 8.10 UI del Inicio; 8.11 Bandeja agrupada en el Inicio

**Bloqueada por:** 8.1 Registro persistente de proyectos

### 8.9 Prender y apagar hubs desde el Inicio · Hecho

**Terminada:** 2026-10-04

- [x] Prender: `scompass serve --dir` como hijo del Inicio
- [x] Apagar: `SIGTERM` al pid del registro
- [x] Avisar antes de apagar un hub del dock

**Prueba:** Prender un proyecto apagado desde el Inicio y apagarlo; al cerrar el Inicio, los hubs que prendió mueren.

**Notas:** Los hijos van sin `--tray`: la bandeja agrupada del Inicio (8.11) los va a mostrar. El dock no cambió: el registro detecta que su hub está atado (`--exit-on-stdin-close`) y que su padre no es el Inicio.

**Referencias:** `docs/spec.md#v3-home`

**Bloqueada por:** 8.8 `scompass home`: proceso y API

### 8.10 UI del Inicio · Hecho

**Terminada:** 2026-10-04

- [x] Franja Hoy: vencidos, hoy y en curso de todos los proyectos
- [x] Tarjetas: estado del hub, hito actual, lo próximo, sin commitear
- [x] Agregar proyecto: importar carpeta o crear con plantilla
- [x] Pantalla angosta (mockup del teléfono)

**Prueba:** Tildar "Pagar la luz" en Hoy cambia el JSON de la lista, con su hub prendido o apagado; un ítem que se repite avanza su fecha (tests de navegador en `hub/test/ui-home.test.js`).

**Notas:** `web/home.*`. Para crear proyectos hizo falta `/api/templates` y `/api/projects/init` (las plantillas pasaron a `hub/src/templates.js`). Un proyecto se marca Godot si tiene `project.godot`, y Personal si abre en Listas. Los cambios hechos sin hub (CLI directa, a mano) se ven al recargar o con el próximo evento: el Inicio no mira los archivos.

**Referencias:** `docs/spec.md#v3-home`

**Bloqueada por:** 8.8 `scompass home`: proceso y API

### 8.11 Bandeja agrupada en el Inicio · Hecho

**Terminada:** 2026-10-04

- [x] El Inicio con `--tray` pone el único ícono
- [x] Los hubs con `--tray` lo esconden si hay un `home` vivo y lo vuelven a poner si muere
- [x] Menú: un submenú por hub (Abrir, Reiniciar, Detener), Abrir Inicio, Agregar proyecto
- [x] El submenú de cada hub incluye "Actualizar compass/" cuando hace falta

**Prueba:** `home --tray` con un hub con `--tray`: el hub quita su ícono, el Inicio lo muestra como submenú, y al cerrar el Inicio el hub vuelve a la bandeja (test en un bus D-Bus privado, con un hub).

**Notas:** `startTray` acepta submenús, separadores e ítems dinámicos (la lista de proyectos se arma al abrir el menú). El Inicio se anota con `tray: true` recién con el ícono puesto. Agregar proyecto… abre el Inicio (la UI de importar es 8.10).

**Referencias:** `docs/spec.md#v3-bandeja`

**Bloqueada por:** 8.8 `scompass home`: proceso y API

### 8.12 Tests de M8 y guía para agentes · Hecho

**Terminada:** 2026-10-04

- [x] Tests de los criterios de §16.8
- [x] `AGENTS.md` (plantilla, addon y `compass/`) con listas, fechas y `home`
- [x] README y `compass/README.md`: editar listas a mano

**Prueba:** Los criterios de §16.8 tildados con su prueba.

**Notas:** `hub/test/m8-criteria.test.js` (un test por criterio de §16.8) y la bandeja con tres hubs en `tray.test.js`. El Inicio mira el registro cada 0,5 s (antes 1 s) para que un hub nuevo se vea en menos de 1 s. README, docs/instalar.md y el spec al día.

**Referencias:** `docs/spec.md#criterios-v3`

### 8.13 Fechas límite en la web y el dock · Hecho

**Terminada:** 2026-10-04

- [x] Web: elegir y ver la fecha en el detalle; vencidas y de hoy marcadas en la tarjeta
- [x] Dock: mostrar la fecha y marcar las vencidas

**Prueba:** Una tarea con `due` de ayer se ve como vencida en la web y en el dock; al pasarla a Hecho deja de marcarse.

**Notas:** Web: `dueField` en el detalle (fecha, hora, Quitar) y `dueMark` en la tarjeta. Dock: `Board.due_state` y `show_due` (misma regla que `hub/src/dates.js`), la fecha en la columna derecha de la lista y una línea en el detalle; el dock no la edita.

**Referencias:** `docs/spec.md#v3-fechas`

**Bloqueada por:** 8.2 Fecha límite (`due`) en tareas

### 8.14 Dock: "Crear compass/" con plantilla · Hecho

**Terminada:** 2026-10-04

- [x] Elegir juego, personal o vacío antes de crear (por defecto juego, porque es un proyecto de Godot)
- [x] Pasar `--template` a `scompass init`

**Prueba:** En un proyecto sin compass/, "Crear compass/" con la plantilla juego deja el hito M0, las dos listas y docs/gdd.md.

**Notas:** Un OptionButton al lado de "Crear compass/" (Juego, Personal, Vacío), visible solo sin compass/. Tests: plantilla juego por defecto (hito M0, listas y docs/gdd.md) y vacío sin datos.

**Bloqueada por:** 8.7 Plantillas en `scompass init`

### 8.15 Tablero: enlace "← Inicio" si el Inicio está corriendo · Hecho

**Terminada:** 2026-10-04

Pedido al usar el Inicio.

- [x] `GET /api/home` en el hub (el Inicio del registro, o null)
- [x] Web: "← Inicio" arriba del título; se revisa cada 10 s y al volver a la pestaña

**Prueba:** Sin Inicio no aparece; con uno anotado en el registro, el enlace apunta a su puerto (hub/test/ui.test.js).

### 8.16 Bandeja del Inicio: el estado de los hubs prendidos desde la web no se actualizaba · Hecho

**Terminada:** 2026-10-04

**Prueba:** Test en bus privado: hub prendido por la API del Inicio → LayoutUpdated, AboutToShow dice que cambió y el menú muestra el puerto.

**Notas:** Plasma pregunta AboutToShow antes de abrir el menú; si un refresh() ya había visto el cambio, respondía "no cambió" y Plasma mostraba su copia vieja. Ahora compara con la última revisión que el escritorio pidió (GetLayout), y refresh() manda también ItemsPropertiesUpdated.

### 8.17 Crear proyecto desde el Inicio: ~/.local/share/scope-compass/<nombre>, o elegir otra carpeta · Hecho

**Terminada:** 2026-10-04

**Prueba:** "Vida dos" queda en …/scope-compass/Vida dos con .git; con el selector, en <elegida>/Mi juego (ui-home y home tests).

**Notas:** D28. `projectsDataDir`: `$SCOMPASS_DATA` o `$XDG_DATA_HOME/scope-compass`. El nombre es la carpeta, tal cual; si existe, 409. "Elegir otra carpeta…" usa `POST /api/pick-folder` (kdialog o zenity; `SCOMPASS_PICKER` en tests); sin selector, campo de texto.

## M9 — Inicio como app (multi-hub)  (10/10)

Con el Inicio corriendo, el Inicio sirve todos los proyectos en /p/<clave>/ con el código del hub: un puerto, sin esperas, todo editable (§17, D29).

**Hecho cuando:**
- Abrir un tablero desde el Inicio no cambia de puerto ni levanta procesos.
- Un solo proceso escribe cada compass/ (hub suelto o Inicio).
- El Inicio se reinicia y actualiza compass/ de cualquier proyecto sin hub.

### 9.1 Servidor del hub montable bajo una ruta · Hecho

**Terminada:** 2026-10-04

- [x] La app de un hub expone lo que necesita su WebSocket (`app.hub`) y `attachSocket` se puede usar desde otra app
- [x] El hub suelto sigue igual: mismos tests

**Notas:** Fastify no deja agregar rutas ni plugins después de arrancar, así que montar cada proyecto como plugin impediría activarlos o importarlos con el Inicio corriendo. En su lugar: cada proyecto es una app de createServer sin listen; el Inicio le pasa los pedidos con inject() y atiende su WebSocket con attachSocket.

**Referencias:** `docs/spec.md#v4`

### 9.2 El Inicio sirve los proyectos en /p/<clave>/ · Hecho

**Terminada:** 2026-10-04

- [x] Clave por proyecto (nombre de la carpeta, sin repetir)
- [x] Activar al primer pedido: store, watcher, export y WebSocket
- [x] Si hay un hub suelto del proyecto, reenviarle HTTP y WebSocket

**Prueba:** hub/test/home-serve.test.js: tablero, API con etag, POST con Location, WebSocket con watcher, y reenvío a un hub suelto.

**Notas:** `hub/src/home-serve.js`: `projectKeys`, rutas /p/:key, /p/:key/* (inject o fetch al hub suelto, Location con la base) y /p/:key/ws (attachSocket o puente). El plugin de WebSocket se registra una vez en la raíz del Inicio. /api/projects suma key, url y served. Falta que un hub suelto no arranque si el Inicio ya sirve el proyecto (9.3).

**Referencias:** `docs/spec.md#v4`

### 9.3 Registro: quién sirve cada proyecto · Hecho

**Terminada:** 2026-10-04

- [x] El Inicio anota los proyectos que sirve con su base
- [x] hubsOf y detectHub entienden la base

**Notas:** `registerServed` / `unregisterServed`: <pid>-<clave>.json con kind "served" y base. hubsOf los incluye; el Inicio se excluye a sí mismo (standaloneOf) para no reenviarse ni apagarse. Sus escrituras (Hoy) usan el store del hub en memoria y publican como el hub.

**Referencias:** `docs/spec.md#v4`

### 9.4 CLI: usar la base del registro · Hecho

**Terminada:** 2026-10-04

- [x] El store HTTP con la base
- [x] scompass hubs y home list muestran quién sirve cada proyecto

**Notas:** detectHub prueba cada entrada con su base: la URL del store HTTP ya la incluye. `serve` se niega si el Inicio sirve el proyecto; `hubs` lo muestra.

**Referencias:** `docs/spec.md#v4`

### 9.5 Dock: usar la base, e "Iniciar hub" delega en el Inicio · Hecho

**Terminada:** 2026-10-04

- [x] Cliente HTTP y WebSocket con la base
- [x] Con el Inicio corriendo, "Iniciar hub" activa el proyecto en el Inicio

**Notas:** hub_client.gd: `base` y `registry_targets()` ([puerto, base]); `request_url`; `home_port()` (sin chequear el pid: Godot solo puede con sus hijos). start_hub: con el Inicio, POST /api/projects/activate (lo anota si hace falta) y se conecta a /p/<clave>; si falla, levanta su hub como antes.

**Referencias:** `docs/spec.md#v4`

### 9.6 Tablero web dentro del Inicio · Hecho

**Terminada:** 2026-10-04

- [x] Llamadas relativas a su ruta
- [x] Barra superior compartida: volver al Inicio y cambiar de proyecto
- [x] Transiciones entre páginas (View Transitions)

**Notas:** app.js: BASE = la carpeta de la página ("/" o "/p/<clave>/"); IN_HOME muestra la barra con "← Inicio" y el selector (lista de /api/projects del Inicio). View Transitions en app.css y home.css. Chromium headless avisa "Transition was aborted… opt-in disabled" al cambiar de proyecto con el selector: la navegación anda; revisar en un navegador real.

**Referencias:** `docs/spec.md#v4`

### 9.7 Tarjetas, Hoy y bandeja apuntan a /p/… · Hecho

**Terminada:** 2026-10-04

- [x] Abrir tablero dentro del Inicio
- [x] La bandeja: un submenú por proyecto sin prender ni apagar (salvo hubs sueltos)

**Notas:** Tarjetas: "Abrir tablero" → /p/<clave>/, etiqueta "abierto" o "hub suelto :puerto"; ya no hay Prender. Hoy enlaza al tablero. Bandeja: un submenú por proyecto (Abrir tablero, Actualizar compass/, y Detener hub suelto si hay uno).

**Referencias:** `docs/spec.md#v4`

### 9.8 Reiniciar el Inicio · Hecho

**Terminada:** 2026-10-04

- [x] POST /api/restart del Inicio: vuelve en el mismo puerto
- [x] scompass home restart
- [x] "Reiniciar Inicio" en la bandeja

**Notas:** POST /api/restart del Inicio (onRestart), `scompass home restart` (espera el PID nuevo en el mismo puerto) y "Reiniciar Inicio" en la bandeja. Se relanza el mismo comando con --port fijo.

**Referencias:** `docs/spec.md#v4`

### 9.9 Actualizar compass/ desde el Inicio, sin hub · Hecho

**Terminada:** 2026-10-04

- [x] POST /api/projects/update (schema y AGENTS.md)
- [x] Botón en la tarjeta cuando está desactualizado, y en la bandeja

**Notas:** POST /api/projects/update (updateCompass, sin hub); /api/projects trae `outdated`; la tarjeta muestra "compass/ desactualizado" con Actualizar. La bandeja ya lo tenía por proyecto.

**Referencias:** `docs/spec.md#v4`

### 9.10 Tests de M9, spec y guía · Hecho

**Terminada:** 2026-10-04

- [x] Tests de los criterios de §17.1
- [x] AGENTS.md, README e instalar.md

**Referencias:** `docs/spec.md#v4`

## M10 — Windows  (9/10)

Scope Compass funciona en Windows como segunda plataforma: CLI, hub, Inicio, bandeja y dock (§18, D30).

**Hecho cuando:**
- npm test pasa en Windows, salvo los tests marcados como solo Linux.
- El Inicio con bandeja, los hubs y el dock funcionan en Windows sin ventanas de consola.
- Los mismos proyectos se usan en Linux y en Windows, sincronizados por git, sin cambios por fin de línea.

### 10.1 npm test corre en Windows · Hecho

**Terminada:** 2026-10-06

Primera corrida en la VM (2026-10-06): 280 tests, 188 pasan, 54 fallan, 37 saltados. 41 fallas eran de Playwright sin navegador y 29 saltos, de que Node no lanza `godot.cmd` (resuelto en la VM con `godot.exe`).

- [x] El script `test` de package.json sin sintaxis de sh (un `node` que arma las variables)
- [x] registry.test: simular otro hub con un PID vivo de verdad, no PID 1 (en Windows se colgaba)
- [x] cli-hub.test: sin `sh -c`
- [x] export-md: saltar los tests de Python si no hay `python3` que ande (en Windows, `python3` es el alias de la Store)
- [x] Rutas absolutas esperadas con el separador del sistema (projects.test, home list)

**Notas:** Hecho: `npm test` es `scripts/run-tests.js` (arma las variables en Node y borra la carpeta temporal al final); registry.test simula el otro hub con `process.ppid`; cli-hub.test sin `sh` en Windows; export-md salta sin Python (también el alias de la Store, que sale con 9009); home list acepta los dos separadores. Después de 10.1 y 10.2: 255 pasan; lo que falla es de 10.3, 10.4, 10.6 y 10.8.

**Referencias:** `docs/spec.md#windows`

### 10.2 Rutas relativas al proyecto siempre con / · Hecho

**Terminada:** 2026-10-06

Las rutas dentro del proyecto son identificadores, como en git: siempre con `/`. Las absolutas, con el separador del sistema.

- [x] Documentos: path y alias con / (docs.js, config docs)
- [x] Avisos y errores del Store con rutas con /
- [x] Revisar export, watcher y refs que comparen rutas relativas

**Notas:** Hecho: `rel()` de store/load.js (avisos del Store) y loadDocs (glob devuelve `\` en Windows, y el alias quedaba `docs/docs\audio`). El watcher de compass/ ya aceptaba los dos separadores y el de documentos usa basename, que también.

**Referencias:** `docs/spec.md#windows`

### 10.3 Carpetas de config, datos y registro en Windows · Hecho

**Terminada:** 2026-10-06

D23, D28 y el registro de hubs usaban solo XDG.

- [x] Carpetas por plataforma en projects.js y registry.js
- [x] Ruta absoluta con isAbsolute; nombres de proyecto sin \ / : * ? " < > | ni nombres reservados
- [x] Mensajes y docs que nombran ~/.config muestran la ruta real

**Notas:** Hecho: en Windows, proyectos conocidos en %APPDATA%\scope-compass, datos en %LOCALAPPDATA%\scope-compass y hubs vivos en %TEMP%\scope-compass\hubs (%TEMP% ya es de cada usuario; `userInfo().uid` es -1). Crear un proyecto valida la carpeta con `isAbsolute`. Los nombres de proyecto siguen la regla de Windows en las dos plataformas (sin \ / : * ? " < > |, sin CON/NUL/COM1…, sin punto al final), para que un proyecto de Linux se abra en Windows. La página del Inicio arma "Se crea en …" con el separador que manda /api/templates (`sep`). AGENTS.md y hub/README nombran la ruta de Windows.

**Referencias:** `docs/spec.md#windows`

### 10.4 Cerrar hubs e Inicio sin señales · Hecho

**Terminada:** 2026-10-06

En Windows Node no tiene SIGTERM: `kill` termina el proceso en seco, sin cerrar el servidor ni darse de baja.

- [x] Cierre pedido por API/stdin en el Inicio (stop, apagar al cerrar); el del dock, en 10.8
- [x] windowsHide en spawn y execFile; restart con detached sin ventana
- [x] Tests de cierre que corran en las dos plataformas

**Notas:** Hecho: `POST /api/shutdown` en el hub y en el Inicio (un proyecto servido por el Inicio lo rechaza con 400). El Inicio apaga a sus hijos cortándoles la entrada y a los demás hubs por la API; `kill` solo si en 3 s siguen vivos. `windowsHide` en todos los procesos que se lanzan (salvo el selector de carpetas, 10.6). Tests: cierre por API con código 0 (cli, tray, home-hubs, home-restart); SIGTERM solo en Linux. Encontrado: un hub reiniciado cuyo padre es Node (con la tubería 'pipe' directa) recibe fin de entrada al irse el viejo y se cierra, en Linux y en Windows; por eso el test usa cat (findstr en Windows). Con el dock (Godot de padre) se ve en 10.8. Con el Inicio de padre pasaría igual, pero desde D29 el Inicio no crea hubs.

**Referencias:** `docs/spec.md#windows`

### 10.5 Escritura atómica: reintentar el rename en Windows · Hecho

**Terminada:** 2026-10-06

En Windows, `rename` sobre un archivo que otro proceso tiene abierto sin compartir (antivirus, indexador, un editor) falla con EPERM/EBUSY/EACCES.

- [x] Reintento con espera corta en writeAtomic
- [x] Test que simula el destino ocupado

**Notas:** Hecho: `renameRetrying` en store/atomic.js, que usa writeAtomic (y con él el Store, projects.json, el export y doc stamp-ids): hasta 10 intentos con esperas que crecen (~1 s en total), solo en Windows; en Linux esos errores son de permisos y salen enseguida. Verificado en la VM con el destino abierto por PowerShell con FileShare None: sin reintento, EPERM al instante; con reintento, anda cuando lo suelta.

**Referencias:** `docs/spec.md#windows`

### 10.6 Navegador y selector de carpetas en Windows · Hecho

**Terminada:** 2026-10-06

- [x] Abrir el navegador por plataforma (serve --open, home --open, bandeja)
- [x] Selector de carpetas con PowerShell
- [x] Selector falso de los tests que corra en Windows

**Notas:** Hecho: hub/src/desktop.js con openUrl (xdg-open; en Windows, explorer.exe) y pickFolder (kdialog o zenity; en Windows, el FolderBrowserDialog de Windows Forms desde PowerShell 5.1, sin dependencias). La carpeta inicial y el título van por variables de entorno y la elegida vuelve en UTF-8. PowerShell corre con windowsHide; un formulario dueño invisible y TopMost hace que el diálogo salga delante. SCOMPASS_OPEN y SCOMPASS_PICKER aceptan un .js (se corre con Node), así los tests andan en las dos plataformas. Verificado en el escritorio de la VM con una tarea programada interactiva: el diálogo se ve, en primer plano, sin consola, y la ruta con tilde vuelve intacta.

**Referencias:** `docs/spec.md#windows`

### 10.7 Bandeja en Windows con NotifyIcon · Hecho

**Terminada:** 2026-10-06

D31.

- [x] Script de PowerShell: ícono, tooltip, menú con submenús, clics
- [x] tray.js elige D-Bus o PowerShell según la plataforma, con la misma interfaz
- [x] Ícono .ico generado del mismo dibujo
- [x] Test con el script real en Windows (sin hacer clic: menú y respuesta simulada)

**Notas:** Hecho: tray.js elige por plataforma; tray-win.js lanza tray-win.ps1 (NotifyIcon de Windows Forms) con -EncodedCommand y windowsHide, y le habla en JSON por líneas: el hub manda ícono, tooltip y menú; PowerShell devuelve clics, clic en el ícono y "opening" (antes de abrir el menú, el hub lo reevalúa, como AboutToShow en D-Bus). stdin se lee sin bloquear con un Timer de la interfaz; si se corta (el hub se cerró o murió), saca el ícono y termina. tray-menu.js tiene lo compartido: buildMenu (lo usa también D-Bus) y el dibujo, más el .ico de 16 a 48 px armado en JS. Tests en la VM sin escritorio (dump e invoke de prueba): menú con submenús, tildes, ocultos y deshabilitados; clics por el handler real; refresh; cierre; home --tray; el hub muerto de golpe saca el ícono. Visto en el escritorio de la VM (captura): ícono en la bandeja y el menú como en Linux. Falta mirar en la máquina real el clic izquierdo en el ícono (abre el Inicio): 10.10.

**Referencias:** `docs/spec.md#windows`

### 10.8 Dock en Windows · Hecho

**Terminada:** 2026-10-06

- [x] Encontrar y lanzar el hub sin sh
- [x] Vivo/cerrar con las APIs de Godot (cierre ordenado como en 10.4)
- [x] registry_dir igual que el hub
- [x] dock.test pasa en la VM con Godot 4.8

**Notas:** Hecho, solo la rama de Windows (Linux sigue con sh): scompass_command busca con `where` y del shim de `npm link` toma node_modules/scope-compass/bin/scompass.js; start_hub lanza node directo con `serve --log` (nueva opción: el hub agrega su salida al archivo, también un error que lo tire), con tubería (--exit-on-stdin-close) o con create_process en modo mantener; `pid_alive` usa tasklist (OS.is_process_running solo conoce los hijos y tras un reinicio el hub es nieto) y el último recurso es OS.kill; registry_dir en %TEMP% como Node; _same_path normaliza \ y mayúsculas. Tests: el runner usa pid_alive; dock.test saca el \r de las líneas de Godot en Windows (por eso "Node no avisó") y el log de modo mantener se mira por plataforma. dock.test 29/29 en la VM con Godot 4.8-dev7; suite completa en la VM sin fallas. Falta probar `where` con un `npm link` de verdad: 10.9.

**Referencias:** `docs/spec.md#windows`

### 10.9 Instalar en Windows · Hecho

**Terminada:** 2026-10-06

- [x] Pasos de Windows en la guía de instalación
- [x] build.mjs corre en Windows
- [x] Probar la instalación desde el .tgz en la VM

**Notas:** Hecho: docs/instalar.md con Windows (Node y Git con winget, npm install -g desde PowerShell o cmd, scompass.cmd si PowerShell no deja correr scripts, dónde quedan los datos, sincronizar por git, nombres de proyecto). build.mjs corre en Windows: npm.cmd por la consola (sin comillas en el nombre: si no, el shim busca sus archivos en la carpeta actual) y el zip del addon con el tar.exe de Windows; el paquete sale sin scripts (postinstall solo sirve en el repo y npm reciente lo frena con un aviso). Probado en la VM: build, npm install -g del .tgz, scompass en PowerShell y cmd, home --tray instalado, y el dock encuentra el scompass global con where. Agregado: compass/.gitattributes (* text eol=lf), que init crea y update pone al día como el schema; en la VM, un proyecto de Linux clonado con core.autocrlf=true sale todo en CRLF sin él, y en LF con él. Encontrado con el scompass global: el dock corría `scompass update --check` con OS.execute y en Windows Node tarda ~0,5 s; el cuadro siguiente vencía en el acto los pedidos de 0,5 s al hub y el dock arrancaba sin hub. Ahora _scompass corre en otro hilo. Menor: Invoke-WebRequest -Method Post sin cuerpo manda un Content-Type de formulario y Fastify responde 415 en /api/shutdown (Node, curl y el dock no lo hacen).

**Referencias:** `docs/spec.md#windows`

### 10.10 Tests de M10, spec y guía · Pendiente

Criterios de §18.1. Al cerrar: suite completa en la VM, y una sesión real en la máquina con Windows (Inicio con bandeja, un proyecto sincronizado por git con Linux, dock en Godot). AGENTS.md (plantilla, copia del addon y compass/) con lo que cambie para Windows.

- [ ] Tests de los criterios de §18.1
- [ ] Suite completa en la VM
- [ ] Prueba en Windows en la máquina real (incluye Ctrl+C en la consola cierra ordenado el hub y el Inicio, y el clic izquierdo en el ícono abre el Inicio)
- [ ] AGENTS.md, README y spec al día
- [ ] Esperas de 3 s en los tests de UI que fallan a veces con la suite entera en la VM (fecha límite 8.13, listas «tildar, editar…»); solos pasan siempre
- [x] Dock: _scompass deja un Thread vivo si el editor se cierra mientras corre scompass (aviso «Thread object is being destroyed» en godot --import); esperar el hilo en _exit_tree
  Se ve con godot --headless --path . --import: el plugin corre check_compass al abrir y el editor sale antes de que termine el hilo. Una vez el --import salió con error y tumbó toda la suite del dock.
- [x] Los tests del dock aíslan el registro solos: node --test test/dock.test.js sin npm test usa el registro real y el Inicio del usuario sirve los proyectos temporales (y los anota en projects.json)
- [ ] tray.test.js §16.8 (tres hubs con --tray, un solo ícono) falla a veces con la suite entera; sola y con carga de UI pasa
  Falló en 3 corridas completas del 2026-10-10 sin guardar el mensaje. La próxima vez, mirar el log entero (npm test > log) antes de tocar las esperas.
- [ ] home-hubs «los hubs que prendió el Inicio mueren con él» falló una vez con la suite entera (2026-10-10: /api/projects/start sin hub en la respuesta); sola pasa 5 de 5. También ui-filters «detalle: prioridad, responsable y etiquetas» una vez
  Como el paso anterior: guardar la respuesta completa la próxima vez antes de tocar esperas.

**Referencias:** `docs/spec.md#windows`

## M11 — Lista y filtros  (7/7)

Ver y encontrar tareas en un tablero grande: vista de lista y filtros en la UI web, con campos nuevos para filtrar.

**Hecho cuando:**
- La UI web tiene una vista de lista del tablero, compacta y ordenable por columna, que abre el mismo detalle.
- Tablero y lista se filtran por texto, estado, fecha límite, bloqueo, pasos pendientes, etiquetas, prioridad y responsable, y el filtro se recuerda.
- Las tareas tienen etiquetas, prioridad y responsable, editables desde la CLI y la web, y scompass list filtra por lo mismo.

### 11.1 Etiquetas, prioridad y responsable en el schema · Hecho

**Terminada:** 2026-10-08

- [x] tags: lista de textos cortos; priority: high|medium|low; assignee: texto libre (persona o agente)
- [x] schema/task.schema.json y la copia de compass/schema (scompass update)
- [x] Validación en el store y la API, con tests
- [x] Decisión nueva en docs/decisiones.md y el modelo en la spec

### 11.2 CLI: editar los campos nuevos y filtrar scompass list · Hecho

**Terminada:** 2026-10-08

- [x] add y set con --tags a,b --priority high --assignee nombre ("" quita)
- [x] show y list muestran etiquetas, prioridad y responsable
- [x] list filtra con --q, --status (varios), --due overdue|today|week|none, --blocked, --unblocked, --pending-steps, --tag, --priority, --assignee
- [x] Tests de la CLI

### 11.3 Export a markdown con los campos nuevos · Hecho

**Terminada:** 2026-10-08

- [x] docs/tareas.md muestra etiquetas, prioridad y responsable de cada tarea
- [x] Test del export

### 11.4 Web: barra de filtros del tablero · Hecho

**Terminada:** 2026-10-08

- [x] Texto (título y código, sin tildes ni mayúsculas), estado, fecha límite, bloqueadas o no, con pasos pendientes, con referencias
- [x] Etiquetas, prioridad y responsable, con los valores que existen en el tablero
- [x] Combinables con el hito; el filtro se recuerda por proyecto y se limpia con un botón
- [x] Los contadores del hito y el resumen dicen cuántas tareas quedan ocultas

### 11.5 Web: vista de lista · Hecho

**Terminada:** 2026-10-08

- [x] Pestaña Tablero | Lista dentro de la vista del tablero; la elección se recuerda
- [x] Columnas: código, título, hito, estado, pasos x/y, fecha límite, bloqueo, prioridad, responsable, etiquetas
- [x] Ordenable por columna (orden natural del código por defecto); clic en la fila abre el mismo detalle
- [x] Usa los mismos filtros que el tablero; se ve bien en el teléfono

### 11.6 Web: editar etiquetas, prioridad y responsable en el detalle · Hecho

**Terminada:** 2026-10-08

- [x] Prioridad y responsable en el detalle; etiquetas con sugerencias de las que ya existen
- [x] Marcas en la tarjeta del tablero (prioridad, etiquetas)

### 11.7 Tests de M11, spec y guía · Hecho

**Terminada:** 2026-10-08

- [x] Tests de UI de la lista y los filtros
- [x] AGENTS.md (plantilla, copia del addon y compass/), README y spec al día

**Prueba:** npm test (hub/test/filters.test.js, ui-filters.test.js y los de schema, API y export)

## M12 — Biblioteca de documentos  (8/8)

Explorar los documentos del proyecto como una biblioteca de conocimiento: muchos archivos, enlaces a documentos enteros, búsqueda y el estado de git de cada uno.

**Hecho cuando:**
- Una tarea puede referenciar un documento entero (ref sin sección o `[[alias]]`), y refs check lo valida.
- Los documentos se agregan y quitan desde la CLI y la web sin editar config.json; la plantilla juego declara un glob de docs/.
- La web tiene una biblioteca: árbol por carpetas, búsqueda de texto en todos los documentos y, por documento, sus tareas y su estado de git.
- Cada documento muestra si tiene cambios sin commitear, su último commit y el diff contra HEAD.

### 12.1 Refs a un documento entero · Hecho

**Terminada:** 2026-10-08

Hoy refs exige doc y section. Se hace section opcional: una ref sin sección apunta al documento entero. En texto, `[[alias]]` sin #. Afecta resolveRef/checkRefs/suggestRefs, export md, ref add|rm y backlinks (docs-api).

- [x] Schema: section opcional en refs (schema/, compass/schema/ y fixture de tests)
- [x] docs.js: resolveRef, LINK y checkRefs aceptan doc sin sección
- [x] CLI ref add|rm <tarea> <alias>[#<id>] y doc show <alias> sin sección
- [x] Backlinks a nivel documento en /api/docs y export md
- [x] Tests

**Prueba:** scompass ref add <tarea> gdd; refs check no lo marca roto; `[[gdd]]` en notas resuelve; borrar el archivo lo marca missing_doc.

### 12.8 Ordenar las tarjetas del tablero · Hecho

**Terminada:** 2026-10-08

Selector de orden en la barra del tablero: orden manual (el de hoy, order), código, actualizada, creada, fecha límite, prioridad y título, ascendente o descendente. Se ordena dentro de cada columna. Reusa COLUMNS/sortedForList de la vista de lista y el mismo S.sort, así tablero y lista comparten el orden; la lista suma las columnas Actualizada y Creada. Con un orden que no es el manual, arrastrar entre columnas sigue cambiando el estado pero no reordena (aviso en el tooltip). Se recuerda por proyecto como el filtro. Solo web: no toca datos.

- [x] Columnas Actualizada y Creada en la lista (updated_at, created_at)
- [x] Selector de orden y sentido en la barra del tablero, compartido con la lista
- [x] renderBoard ordena cada columna con sortedForList
- [x] Arrastrar para reordenar solo con orden manual
- [x] Tests de UI

**Prueba:** Elegir Actualizada ▼: la tarea recién editada sube al tope de su columna, también al llegar el cambio por ws; volver a Manual restaura el orden y el arrastre.

**Notas:** Hecho: AGENTS.md no cambia (es solo web, sin CLI ni datos).

### 12.2 Agregar y quitar documentos sin editar config.json · Hecho

**Terminada:** 2026-10-10

scompass doc add <alias> <ruta|glob> y doc rm <alias>; API POST/DELETE /api/docs que escribe config.json (atómico). La plantilla juego declara docs/**/*.md además de gdd.md; el glob excluye el export_md (docs/tareas.md) para no listarse a sí mismo.

- [x] CLI doc add / doc rm con validación de alias y ruta dentro del proyecto
- [x] API POST/DELETE /api/docs que reescribe config.json
- [x] loadDocs excluye export_md de los globs
- [x] Plantilla juego con glob docs/**/*.md
- [x] Tests
- [x] Dock sin hub: compass_reader.read_docs expande los globs (hoy los saltea), con las mismas reglas que loadDocs

**Prueba:** doc add enemigos docs/enemigos.md lo muestra en doc list; un glob nuevo toma archivos creados después; init --template juego no lista tareas.md.

**Notas:** Hecho: un patrón tampoco toma los archivos declarados aparte (el GDD no sale dos veces) ni carpetas ocultas o node_modules, y el alias de sus archivos es <alias>/<ruta desde la carpeta fija> (docs/arte/paleta), no solo el nombre: dos README en carpetas distintas chocaban (D33, a registrar en la 12.7). Sin etag en config.json: el cambio se aplica sobre la config leída en el momento y un alias o ruta repetidos dan conflicto. El hub rearma el watcher de documentos y avisa doc_changed con el alias. La ruta de la CLI es relativa a la carpeta actual, como --file.

### 12.3 Estado de git de los documentos · Hecho

**Terminada:** 2026-10-10

Ampliar git.js: por documento, estado (sin cambios, modificado, nuevo sin seguir, borrado), último commit (hash corto, fecha, autor, asunto) y diff contra HEAD. Historial con git log --follow. Sin repo: los campos quedan vacíos, nada falla. Solo lectura: la app nunca commitea (spec §4.5).

- [x] git.js: docStatus (porcelain por ruta) y lastCommit (git log -1)
- [x] git.js: docDiff contra HEAD y docLog con --follow
- [x] API: git en /api/docs, GET /api/docs/:alias/diff y /log
- [x] CLI doc status y doc diff <alias> [--json]
- [x] El watcher avisa por ws cuando cambia el estado de un documento
- [x] Tests (repo temporal; sin git devuelve repo: false)

**Prueba:** Modificar docs/gdd.md sin commitear: doc status lo marca modificado y doc diff gdd muestra el cambio; tras commitear vuelve a limpio con el commit nuevo.

**Notas:** Hecho: docsStatus hace un solo git status del proyecto (no un proceso por documento, ni rutas en la línea de comandos, que en Windows tiene tope) y pasa las rutas, que porcelain da desde la raíz del repo, a relativas al proyecto. /api/docs y /api/docs/:alias traen git (clean|modified|added|untracked|deleted|renamed; sin repo no va, y /api/docs dice repo). GET /api/docs/:alias/diff trae además las secciones tocadas (diffSections, para la 12.6) y /log el historial. Un archivo sin seguir no sale en git diff: se arma entero como agregado. El hub manda docs_git { repo, docs: { alias: estado } } cuando cambia alguno; mira después de doc_changed y, mientras haya documentos con cambios, cada gitPollMs (un commit no toca los archivos).

### 12.4 Búsqueda de texto en los documentos · Hecho

**Terminada:** 2026-10-10

Buscar en todos los documentos declarados, sin índice externo: recorrer las líneas ya cargadas. Cada resultado dice documento, sección y un fragmento. Sin tildes ni mayúsculas, como los filtros de M11.

- [x] docs.js: searchDocs(docs, q) → [{ alias, section, line, snippet }]
- [x] API GET /api/docs/search?q=
- [x] CLI doc search "<texto>" [--json]
- [x] Tests

**Prueba:** scompass doc search slime encuentra la sección de enemigos.md con su fragmento; la API devuelve lo mismo.

**Notas:** Hecho: searchDocs devuelve { results, more } (corta en 200); una línea coincide si tiene todas las palabras; la sección es la más chica que la contiene (null antes del primer título); los comentarios <!-- id --> no cuentan; el fragmento recorta las líneas largas alrededor de la primera palabra. /api/docs/search es una ruta fija: gana sobre /api/docs/:alias (un documento con alias search no se puede pedir por ahí).

### 12.5 Biblioteca en la web · Hecho

**Terminada:** 2026-10-10

La vista Docs pasa de un selector a un explorador: árbol por carpetas a la izquierda, búsqueda arriba y, por documento, ficha con secciones, tareas que lo referencian (a nivel documento y por sección) y estado de git. Resaltar documentos o secciones sin tareas (diseño sin planificar). Agregar y quitar documentos desde la UI.

- [x] Árbol de documentos por carpeta con contadores de tareas
- [x] Caja de búsqueda con resultados por documento y sección
- [x] Ficha del documento: tareas, secciones sin tareas, estado de git
- [x] Agregar / quitar documento desde la UI
- [x] Detalle de tarea: refs a documento entero y `[[alias]]` en el texto

**Prueba:** Con 5+ documentos en carpetas: navegar el árbol, buscar un término y saltar a la sección, ver qué tareas referencian el documento.

**Notas:** Hecho: a la izquierda el árbol (una carpeta por grupo, plegable; el número es cuántas tareas citan el documento, entero o por sección; punto apagado si ninguna) y debajo el índice del documento abierto. La barra de arriba (buscador y + Documento) se arma una sola vez, como la de filtros, para no perder lo escrito cuando llega un cambio. La búsqueda reemplaza el artículo por los resultados, por documento, con las palabras resaltadas; ir a uno limpia la búsqueda. La ficha (aside) dice título, ruta, estado de git, de qué entrada sale (un documento de un patrón no se quita solo) y Quitar del proyecto con confirmación; sin sección elegida, Secciones sin tareas. El paso 5 ya estaba desde la 12.1. Arreglado de paso: al abrir un documento, el IntersectionObserver elegía enseguida la primera sección y la ficha del documento entero no se veía; ahora ignora su primer aviso (el del armado).

### 12.6 Cambios y diff de documentos en la web · Hecho

**Terminada:** 2026-10-10

Marca en el árbol para documentos con cambios sin commitear. En la ficha: último commit, historial y el diff contra HEAD con líneas agregadas y quitadas. Marcar las secciones tocadas por el diff para ver qué tareas pueden quedar afectadas.

- [x] Marca de modificado/nuevo en el árbol, en vivo por ws
- [x] Vista de diff contra HEAD
- [x] Historial de commits del documento
- [x] Secciones tocadas por el diff y sus tareas

**Prueba:** Editar un documento con el hub abierto: aparece la marca sin recargar, el diff muestra el cambio y las tareas de esa sección quedan señaladas.

**Notas:** Hecho: el árbol marca M (modificado), N (nuevo) o B (borrado) y se actualiza con docs_git, sin recargar. Con cambios, la web pide el diff aunque no se mire: el índice marca ± en las secciones tocadas (también las que las contienen) y la ficha lista las tareas que pueden quedar afectadas. Ver los cambios reemplaza el documento por el diff, con el título de la sección donde empieza cada bloque. Historial plegable en la ficha. Arreglado en el hub: después de un doc_changed manda docs_git siempre, aunque no vea un cambio; si se editaba y commiteaba antes de que mirara (400 ms), la web quedaba con la marca de modificado.

### 12.7 Tests de M12, spec y guía · Hecho

**Terminada:** 2026-10-10

Cerrar M12: tests, spec y guía al día.

- [x] Tests de UI de la biblioteca y el diff
- [x] Spec §20 y decisiones
- [x] AGENTS.md (plantilla, copia del addon y compass/), README y spec al día

**Notas:** Hecho: los tests de UI de la biblioteca y del diff ya estaban de la 12.5 y la 12.6 (ui-docs.test.js). Spec §20 Biblioteca de documentos con sus criterios, la tabla de rutas y los comandos; §10.4 apunta a §20 y §5.5 suma los eventos git y docs_git. D33: la app declara documentos y lee git, pero no escribe documentos ni commitea; alias de patrón por ruta bajo la carpeta base. AGENTS.md (plantilla, compass/ y addon, idénticos) con doc add/rm/search/status/diff y la regla de alias; README (estado con M12), web/README y hub/README (los archivos de documentos y git).

## M13 — UI más compacta  (7/7)

Llegar a las tareas sin bajar: tablero, detalle, teléfono y lista más compactos, según la revisión de diseño del 2026-10-09 (https://claude.ai/artifact/D6vMr2tWMv9dRCX8MUv5qg).

**Hecho cuando:**
- En escritorio a 1440×900 la primera tarjeta empieza antes de los 320 px; en el teléfono a 390×844, antes de los 450 px.
- En el detalle, los pasos aparecen sin bajar, con las propiedades en una fila de chips.
- El código de los documentos se ve sin ligaduras y las acciones de los pasos miden 36 px o más en el teléfono.

### 13.1 Bugs: ligaduras en el código y `[[alias]]` en M12 · Hecho

**Terminada:** 2026-10-10

- [x] font-variant-ligatures: none en code y pre (web y Inicio)
- [x] Backticks alrededor de `[[alias]]` en compass/milestones/m12.json
- [x] Test de UI: code y pre sin ligaduras
  Las ligaduras de JetBrains Mono conservan el ancho de cada carácter: el ancho de != no cambia, así que el test mira font-variant-ligatures calculado.

**Prueba:** Un bloque de código con `<!-- id: x -->` y `!=` se ve tal cual; el resumen de M12 no muestra ⚠.

**Notas:** JetBrains Mono trae ligaduras: en la vista Documentos `<!-- id -->` se ve como flechas y `!=` como ≠. El "Hecho cuando" de M12 nombra `[[alias]]` sin backticks y desde la 12.1 se muestra como enlace roto.

### 13.2 Tablero: parte de arriba compacta · Hecho

**Terminada:** 2026-10-10

Hoy la primera tarjeta empieza a ~580 px en escritorio. Resumen del hito en una línea (título, barra, contador y "Hecho cuando ▸" que despliega la lista, recordado por proyecto). Hitos terminados agrupados en "Terminados (n) ▾". "Orden" a la derecha de la fila del buscador; los 9 filtros detrás de un botón "Filtros (n)" que abre un panel. Sacar el "tareas" del encabezado.

- [x] Resumen del hito en una línea con "Hecho cuando" desplegable
- [x] Chip "Terminados (n)" que agrupa los hitos hechos (el elegido siempre visible)
- [x] Botón "Filtros (n)" con panel; Orden a la derecha
- [x] Encabezado sin "tareas"
- [x] Tests de UI (posición de la primera tarjeta, filtros desde el panel)

**Prueba:** A 1440×900 con M12 elegido la primera tarjeta empieza antes de los 320 px; los filtros y el orden siguen funcionando y recordándose.

**Notas:** Hecho: con M12 elegido a 1440×900 la primera tarjeta queda a 301 px (antes 622). Lo que más ganó, además de lo pedido: las pestañas Tablero/Listas/Documentos y el "← Inicio" van en la fila del título, con la línea del encabezado debajo. El resumen despliega el objetivo y "Hecho cuando" ("Objetivo" si el hito no tiene la lista); abierto o cerrado se recuerda por proyecto, no por hito. "Terminados (n)" va después de Todos y lista código, título y avance; el hito elegido queda en la fila aunque esté terminado. "Filtros (n)" cuenta los filtros del panel (no el texto, que está a la vista); el contador de ocultas y Limpiar filtros quedan en la fila. El panel no se recuerda abierto. Los tests que elegían M1 (terminado en el fixture) pasan por "Terminados"; el de §14 ya no compara el padding ni la grilla del resumen.

### 13.3 Detalle: propiedades en chips y pasos arriba · Hecho

**Terminada:** 2026-10-10

Hito, fecha, prioridad, responsable y etiquetas ocupan ~450 px antes de los pasos. Pasan a una fila de chips que se editan al hacer clic (vacíos en tono apagado). El título sin borde en reposo, con borde al enfocarlo.

- [x] Fila de chips de propiedades con edición en el lugar
- [x] Título sin borde en reposo
- [x] Pasos, notas y referencias debajo del estado
- [x] Tests de UI del detalle

**Prueba:** Al abrir una tarea a 1440×900 se ven los pasos sin bajar; cada propiedad se edita desde su chip y se guarda como hoy.

**Notas:** Hecho: los chips son los mismos controles nativos (select, date, input con datalist) con aspecto de chip y field-sizing: content, así que un clic ya edita en el lugar y no hay estados de edición nuevos; cada uno lleva su nombre chico adelante (Hito, Vence, Prioridad, Responsable, Etiquetas). Vacíos: borde punteado y texto apagado; vencida en rojo, hoy en ámbar, prioridad alta en rojo. La hora aparece cuando hay fecha, y × quita la fecha. Orden: título, chips, estado, pasos, notas, referencias, vínculos y Cómo probarlo. Con 5 pasos, a 1440×900 los pasos empiezan a 339 px (antes 519). El título ya tenía borde transparente: se veía con borde porque abrir la tarea lo enfocaba; ahora el foco va al panel (tabindex -1), y de paso 1–4 cambian el estado apenas se abre.

### 13.4 Teléfono: menos filas antes de las tareas · Hecho

**Terminada:** 2026-10-10

A 390×844 la primera tarjeta aparece a ~1220 px. Hitos en una fila con scroll horizontal; columnas vacías de una línea; acciones de los pasos (✎ ×) de 36 px o más; la cabecera del detalle con solo el código del hito.

- [x] Hitos en una fila con scroll horizontal
- [x] Columnas vacías de una línea
- [x] Acciones de los pasos de 36 px en el teléfono, visibles al pasar el mouse en escritorio
- [x] Cabecera del detalle: código del hito, sin el nombre
- [x] Tests de UI a 390 px

**Prueba:** A 390×844 la primera tarjeta empieza antes de los 450 px, sin scroll horizontal de la página; ✎ y × miden 36 px o más.

**Notas:** Hecho: con M13 a 390×844 la primera tarjeta queda a 399 px (373 sin el aviso de git, que ocupa una fila). Además de lo pedido: encabezado en dos filas (título; vistas con Nueva tarea a la derecha), la fila del buscador con Tablero/Lista, buscador y Filtros (el Orden baja a la segunda), y el título del hito en una línea con puntos suspensivos. La fila de hitos conserva el desplazamiento al redibujar y, la primera vez, deja a la vista el hito elegido; el desplegable de Terminados va fijo a lo ancho para que el scroll de la fila no lo recorte. Columnas vacías: solo el título con el 0, sin el texto. ✎ y × miden 36 px en el teléfono o sin mouse; en escritorio aparecen al pasar el mouse o con el foco. La cabecera del detalle dice el código del hito en todas las pantallas (el nombre está en el chip Hito y en el tooltip). Con M12 (todo hecho) la tarjeta queda más abajo, a 562 px: las tres columnas vacías van antes. El test de §14 compara una columna con tarjetas; el botón y el espacio entre columnas siguen iguales al artifact.

### 13.5 Lista: fechas relativas y columnas vacías · Hecho

**Terminada:** 2026-10-10

Actualizada y Creada dicen todas "8 oct". Fecha relativa para lo reciente ("hace 3 h", "ayer") con la completa en el tooltip. Esconder las columnas sin ningún valor en lo que se está viendo (la de orden activo siempre visible).

- [x] Fechas relativas en Actualizada y Creada
- [x] Columnas sin valores escondidas
- [x] Tests de UI

**Prueba:** Con M11 elegido no aparecen las columnas vacías; una tarea editada recién dice "hace un momento".

**Notas:** Hecho: menos de un minuto, "hace un momento"; después, minutos y horas cortos ("hace 5 min", "hace 3 h") hasta las 24 h, y días por calendario hasta la semana ("ayer", "anteayer", "hace 4 días"); más viejo, la fecha corta de antes. Lo da Intl.RelativeTimeFormat en español; la fecha completa queda en el tooltip. No se actualiza sola con el reloj: se recalcula cada vez que la lista se redibuja (cualquier cambio del hub). Las columnas se calculan sobre las filas que se ven (hito y filtros); la del orden elegido se ve aunque esté vacía. Con M11 quedan Código, Título, Hito, Estado, Pasos, Actualizada y Creada.

### 13.6 Spec y guía de M13 · Hecho

**Terminada:** 2026-10-10

- [x] Spec: sección de M13 con lo que cambió en la UI
- [x] README de web/ al día

**Notas:** Hecho: spec §21 UI más compacta (M13) con lo que cambió en el encabezado, los hitos, el buscador y los filtros, el resumen, el detalle, los pasos, el teléfono, la lista y las ligaduras, y sus criterios; §19 apunta a §21 para la barra de filtros. web/README con una línea de lo compacto y el README de la raíz con M13 en el estado. AGENTS.md no cambia: M13 no toca la CLI ni los datos.

### 13.7 Bug: show muestra «doc#undefined» en referencias al documento entero · Hecho

**Terminada:** 2026-10-10 · **Prioridad:** baja · **Etiquetas:** `bug`, `cli`

Visto en Project Epiphany (m11-20) el 2026-10-10.

- [x] Arreglar el formato en scompass show
  hub/src/cli.js:489 arma `${r.doc}#${r.section}` sin mirar si hay sección; una ref sin #id (ref add <tarea> gdd.md) sale como gdd.md#undefined. Usar el mismo criterio que export-md.js:50 (solo doc si no hay section).
- [x] Revisar la web y el dock
  Que el detalle de tarea en la UI y en el dock de Godot muestren bien una ref al documento entero.
- [x] Test
  show de una tarea con ref sin sección imprime solo el alias.

**Prueba:** scompass ref add <tarea> gdd.md y scompass show <tarea>: dice «Referencias: gdd.md», no «gdd.md#undefined»; lo mismo en la web.

**Notas:** Hecho: solo fallaba scompass show; la web y el dock ya separaban la ref sin sección (12.1).

## M14 — Archivos del repo  (4/4)

Ver los archivos del repo y su estado de git desde la web, sin salir del tablero.

**Hecho cuando:**
- La web tiene una pestaña Archivos, al lado de Documentos, con el árbol de los archivos del repo y la marca de git de cada uno.
- Un archivo se ve en la web (texto con resaltado, markdown renderizado o imagen), con su estado de git, su diff contra HEAD y su historial.
- Sin archivo elegido, la pestaña muestra la rama, los cambios sin commitear y los últimos commits.
- Solo se ven los archivos que git no ignora, y la app sigue sin escribir archivos ni commitear.

### 14.1 API de archivos del repo y su estado de git · Hecho

**Terminada:** 2026-10-10

Todo de lectura, como el estado de git de los documentos (12.3): reusa git.js (docsStatus, docLog, docDiff).

- [x] GET /api/files: archivos que git no ignora, su estado, la rama y los últimos commits
- [x] GET /api/files/file, /diff y /raw: contenido con resaltado, diff contra HEAD, historial e imágenes
- [x] Solo rutas que git lista; el hub solo atiende pedidos a 127.0.0.1 o localhost
- [x] Tests de la API

**Prueba:** En un repo con un archivo modificado, uno nuevo y uno ignorado: /api/files lista los dos primeros con su estado y no el ignorado; /api/files/file de un .gd trae el código resaltado; pedir el ignorado o ../ da 404.

**Notas:** Hecho: hub/src/files-api.js. GET /api/files trae { repo, branch, ahead, behind, files, status, commits }: los archivos salen de git ls-files --cached --others --exclude-standard (lo seguido y lo nuevo, nunca lo ignorado), más lo que solo está en el estado (un borrado ya agregado al índice); la rama de symbolic-ref (null con HEAD suelto) y ahead/behind solo si sigue a otra; los últimos 20 commits del proyecto (docLog con follow: false sobre '.'). GET /api/files/file?path= devuelve kind text (html con Prism por extensión: .gd, .tscn/.tres/.godot/.import como ini, json, js, py, cs, glsl, yaml, html, css), markdown (renderizado), image, binary (un NUL en los primeros 8000 bytes), big (más de 1 MB), link (un enlace simbólico no se sigue: se dice adónde apunta) o missing, con git, size y su historial. /diff: contra HEAD, el nuevo entero, binary o truncated cuando no hay texto que mostrar. /raw: solo imágenes (png, jpg, gif, webp), con nosniff y CSP sandbox. Una ruta se acepta solo si git la lista (o está en el estado), sin ../, sin / adelante y sin carpetas; si no, 404. Además, el hub y el Inicio solo atienden pedidos con Host 127.0.0.1 o localhost (403 si no): una página de otro sitio que apunte su nombre a 127.0.0.1 ya no puede leer el tablero ni los archivos. Sin token nada más; con token (hosting) manda el token. Sin repo: { repo: false, files: [] }.

### 14.2 Pestaña Archivos en la web · Hecho

**Terminada:** 2026-10-10

- [x] Pestaña Archivos al lado de Documentos (config.views acepta files)
- [x] Árbol por carpetas con la marca de git, filtro por nombre y Solo con cambios
- [x] Archivo: contenido, estado, Ver los cambios e historial
- [x] Sin archivo elegido: rama, cambios sin commitear y últimos commits
- [x] Tests de UI

**Prueba:** Abrir Archivos, ver un archivo modificado marcado en el árbol, abrirlo, ver sus cambios, commitear desde la terminal y que la marca se vaya al actualizar.

**Notas:** Hecho: pestaña Archivos (#files, #files/<ruta>) después de Documentos; config.views acepta files y, sin views, se ven las cuatro (la plantilla juego la suma; el schema cambia en las tres copias). A la izquierda el árbol: carpetas plegadas, armadas solo cuando se abren (un repo grande no dibuja miles de filas), cada una con cuántos archivos con cambios tiene adentro, y cada archivo con la misma marca que Documentos (M, N, B, R). Arriba: filtro por nombre (lista plana, hasta 300), Solo con cambios (n), la rama y cuántos archivos, y Actualizar. Sin archivo elegido: la rama, cuántos commits faltan subir o traer, los cambios sin commitear y los últimos commits. Un archivo: ficha con estado, tamaño, último commit, historial y Abrir en Documentos si es un documento; el contenido resaltado, el markdown renderizado o la imagen; uno modificado abre en Ver los cambios (el diff de Documentos, sin secciones). La lista se vuelve a leer al entrar a la pestaña, con cualquier evento del hub, al volver a la ventana y con Actualizar: los cambios hechos en el editor no avisan solos. En el teléfono, con cuatro pestañas, Nueva tarea pasa a flotar abajo a la derecha. Arreglado de paso: en la 13.4 quedó una } suelta en app.css que se comía la regla de las transiciones y dejaba abierto el bloque del teléfono. dock.test.js ahora muestra la salida de Godot si falla el --import (falla a veces con la suite entera).

### 14.3 Spec, decisión y guía de M14 · Hecho

**Terminada:** 2026-10-10

Spec §22 (Archivos del repo: qué archivos, la pestaña, cuándo se actualiza, solo local, rutas de /api/files) con §22.1; D34 (de lectura, solo lo que git no ignora, Host 127.0.0.1/localhost, sin vigilar el repo entero). §16.6 suma files a views y a la plantilla juego; §21 dice que Nueva tarea flota en el teléfono; §10.4 apunta a §22. README (M14 en el estado y una coma que faltaba), web/README y hub/README al día.

- [x] Spec §22 y decisión
- [x] README, web/README y §16.6 (views) al día

**Notas:** Hecho: M14 documentado; suite 338/1 (la bandeja §16.8, inestable con la suite completa, pasa 3/3 sola).

### 14.4 Dock al día: prioridad, responsable y etiquetas, botón de Archivos y el puerto con el Inicio · Hecho

**Terminada:** 2026-10-10

Visto con el Inicio abierto: el dock abría el tablero en 127.0.0.1:4711/p/<proyecto>. Causa: con el dock sin hub, el sondeo de cada 3 s encontraba el Inicio (puerto 4700, base /p/<proyecto>) y, antes de que abriera el WebSocket, reload() volvía client.port al de la config sin tocar la base; la carga, las escrituras y lo que abre en el navegador iban a ese puerto. Pasaba también tras home restart, o con un hub suelto en otro puerto que la config. reload() ya no toca el puerto: lo elige detect(), que vuelve a la config si no encuentra hub. web_url() arma lo que abre el navegador (tablero, documentos, archivos).

- [x] El puerto: con el Inicio abierto, lo que abre el dock va al puerto del Inicio
  reload() pisaba client.port con el de la config mientras abría el WebSocket recién encontrado por el sondeo: quedaba la base /p/<proyecto> con el puerto 4711.
- [x] Prioridad, responsable y etiquetas en la lista y el detalle del dock
- [x] Botón para abrir la pestaña Archivos en el navegador
- [x] Tests del dock y spec §19 y §22

**Notas:** Hecho: arreglado el puerto; la fila muestra · Alta (solo la alta, como la tarjeta web) · @responsable · #etiquetas y el detalle Prioridad x · @responsable · #etiquetas; botón de Archivos al lado de Abrir el tablero, visible si views no está o incluye files. Tests poll_registry y props en dock.test.js; spec §19 y §22.

## M15 — Tareas y archivos del repo  (5/5)

Vincular tareas con scripts, escenas y demás archivos del repo, y llegar de una a la otra desde la web y desde el editor de Godot.

**Hecho cuando:**
- Una tarea puede citar archivos del repo (campo files) desde la CLI, la web y el dock; refs check avisa los que ya no están.
- En la web, el detalle de la tarea lleva a cada archivo en la pestaña Archivos, y la ficha del archivo muestra las tareas que lo citan.
- En el dock, un archivo de la tarea se abre en el editor de Godot (script, escena o recurso); lo que Godot no ve se abre en la pestaña Archivos.
- Con un script o una escena abiertos en el editor, el dock muestra las tareas que los citan y vincula el abierto a la tarea elegida.

### 15.1 Tareas con archivos del repo: dato, CLI y chequeo · Hecho

**Terminada:** 2026-10-10

- [x] Campo files en el schema de la tarea (las tres copias)
  Rutas desde la raíz del proyecto (la carpeta de compass/), como las lista la pestaña Archivos; sin repetir.
- [x] scompass file add|rm <tarea> <ruta>
  Acepta res://. Solo un archivo que git no ignora (o que existe, sin repo): lo mismo que sirve /api/files.
- [x] show, export markdown y refs check
  Un archivo que ya no está es una referencia rota (missing_file).
- [x] AGENTS.md (las tres copias) y tests

**Notas:** Hecho: campo files (rutas desde la raíz del proyecto, sin repetir; el schema rechaza absolutas, .. y \) en las tres copias del schema. scompass file add|rm <tarea> <ruta>: acepta res:// y ./, y solo agrega lo que sirve la pestaña Archivos (repoFile de files-api.js: lo que git lista o tiene en su estado); sin archivos, el campo se borra. show y el export markdown los listan; refs check marca missing_file si git ya no lista el archivo (se borró o se movió). AGENTS.md (las tres copias). Ojo: un hub o un Inicio que ya corría tiene el schema viejo en memoria y rechaza files hasta reiniciarlo.

### 15.2 Archivos de la tarea en la web · Hecho

**Terminada:** 2026-10-10

- [x] Sección Archivos en el detalle: cada uno lleva a la pestaña Archivos, se quita con ×, y se agregan con un buscador de los archivos del repo
- [x] En la pestaña Archivos, la ficha muestra las tareas que citan el archivo
- [x] Tests de UI

**Notas:** Hecho: en el detalle, la sección Archivos (entre Referencias y Vínculos): cada archivo lleva a #files/<ruta> con su marca de git; uno que git ya no lista se marca '⚠ … ya no está en el repo'; × lo quita (sin archivos, el campo se borra). + Agregar abre un buscador por ruta (todas las palabras, sin los que ya tiene, hasta 8) sobre la lista del repo, que se lee al abrirlo. En la pestaña Archivos, la ficha suma 'Citado por · n tareas' y cada tarea lleva al tablero con el detalle abierto. Las tareas que citan un archivo se calculan en la web (ya tiene todas): la API no cambia.

### 15.3 Dock: abrir los archivos de la tarea en el editor · Hecho

**Terminada:** 2026-10-10

- [x] Los archivos de la tarea en el detalle del dock
- [x] Clic: el script en el editor de scripts, la escena abierta, otro recurso en el inspector; lo que Godot no ve (markdown, compass/) en la pestaña Archivos
- [x] Tests

**Notas:** Hecho: el detalle del dock lista los archivos de la tarea (en rojo el que no está en el disco). Un clic llama a open_file, que pone el plugin: como un doble clic en el FileSystem, el script va al editor de scripts (edit_script), la escena se abre (open_scene_from_path) y otro recurso va al inspector (edit_resource). Lo que Godot no abre como recurso (TextFile como .md, JSON, o lo que no ve: compass/, carpetas con .gdignore) se abre en la pestaña Archivos de la web; sin hub, el dock lo avisa. Verificado en un editor real sin ventana (proyecto de prueba con un plugin): get_file_type da GDScript, PackedScene, TextFile, JSON y '' para lo ignorado, y edit_script y open_scene_from_path dejan abiertos el script y la escena. Test task_files en dock.test.js (open_file simulado).

### 15.4 Dock: tareas del script y la escena abiertos · Hecho

**Terminada:** 2026-10-10

- [x] Con el script o la escena que se edita, el dock muestra las tareas que lo citan (de cualquier hito) y lleva a cada una
- [x] Vincular el script o la escena abiertos a la tarea elegida
- [x] Tests

**Notas:** Hecho: el plugin avisa al dock qué script (editor_script_changed del ScriptEditor) y qué escena (scene_changed) se editan; un script incorporado a una escena (res://x.tscn::GDScript_…) no cuenta. Arriba de la lista, las tareas sin terminar que citan el script o la escena abiertos, de cualquier hito (archivo · tarea); un clic lleva a la tarea y cambia de hito si hace falta. En el detalle, con hub, '+ Vincular player.gd' agrega el script o la escena abiertos que la tarea no cita. Verificado en un editor real sin ventana (proyecto de prueba con el addon y un plugin que abre el script y la escena): la caja muestra la tarea con cada uno. Test editing en dock.test.js.

### 15.5 Spec, decisión y guía de M15 · Hecho

**Terminada:** 2026-10-10

- [x] Spec §23 con criterios y decisión D35
- [x] README, web/README y la spec del dock (§11.1) al día

**Notas:** Hecho: spec §23 (el dato, CLI, web, dock) con §23.1 y cómo se probó la parte del editor; D35 (files aparte de refs, rutas y no uid://, solo lo que git lista, tareas de un archivo calculadas en el cliente). §11 y §11.1 marcan hechos el módulo de referencias a res://, las tareas del script abierto y abrir desde la tarea. README (M15 en el estado), web/README e instalar.md (cómo se vinculan y se abren). Suite completa: 345 pasan, 0 fallan.

## M16 — Uso en el teléfono  (7/7)

Usar el tablero y los documentos cómodos desde el teléfono, ahora que se abren por la red de casa (D36).

**Hecho cuando:**
- En el teléfono, el tablero se desliza de costado, una columna por pantalla, en vez de apilar las columnas.
- En el teléfono, Documentos muestra fijos abajo el índice, para saltar de sección, y las tareas de la sección que se está leyendo.
- Las notas y los demás campos de texto del detalle crecen con el texto, sin arrastrar la esquina.
- Un clic afuera del detalle de la tarea lo cierra.
- En el teléfono el detalle de la tarea ocupa toda la pantalla; desde 761 px es un panel al costado.
- Atrás cierra la tarea abierta y vuelve a la vista de antes; cada tarea tiene su enlace (#task/<id>).

### 16.1 Tablero deslizable en el teléfono · Hecho

**Terminada:** 2026-10-10 · **Etiquetas:** `ui`

Pedido del usuario al abrirlo en el teléfono (2026-10-10): apiladas, las columnas quedaban interminables.

- [x] Columnas lado a lado con scroll-snap a ≤ 560 px
  Una por pantalla (86 %), con la siguiente asomando; las vacías, angostas, solo con el título.
- [x] El desplazamiento se mantiene al redibujar (cambios en vivo, cambio de hito)
- [x] También en teléfonos de más de 560 px: táctil (hover: none) hasta 980 px
  El teléfono del usuario mide unos 600 px y le tocaba la grilla de dos; la primera versión solo se probó a 390.

**Prueba:** A 390×844 el tablero se desplaza de costado y encaja en una columna; la página no se desplaza de costado; un cambio en vivo no devuelve el tablero a la primera columna.

**Notas:** Hecho: solo CSS en la media query del teléfono (flex con overflow-x y scroll-snap-type x mandatory, margen negativo como la fila de hitos). La comparación con el artifact (§14) ya no mira la grilla del tablero a 390 px: el artifact apilaba. Comprobado a 390×844 con toque: desliza y encaja en En curso con Revisión asomando; tras un cambio en vivo el scroll queda igual (main.board no se recrea). Corregido: en el teléfono del usuario (unos 600 px de ancho) seguía la grilla de dos columnas, porque el corte era 560 px y solo se había probado a 390. Ahora vale a ≤ 560 px o en pantallas táctiles (hover: none) de hasta 980 px, con columnas de hasta 360 px; con mouse, entre 561 y 980, sigue la grilla. La barra de Documentos (16.2), igual: táctil hasta 1180 px. Revisado a 390, 412, 602 y 900 táctil, y a 900 y 1440 con mouse; el test nuevo falla con el CSS anterior.

**Referencias:** `docs/spec.md#telefono`

### 16.2 Tareas de la sección, fijas abajo en Documentos · Hecho

**Terminada:** 2026-10-10 · **Etiquetas:** `ui`

Pedido del usuario al usarlo en el teléfono (2026-10-10): en Documentos, las tareas de la sección quedaban al final, después de todo el documento.

- [x] Barra fija abajo a ≤ 760 px con las tareas de la sección visible
  Cuántas son y un enlace a cada una (los mismos de la ficha), deslizable de costado; sin barra si la sección no tiene tareas, en la búsqueda o en el diff.

**Prueba:** A 390×844, en #docs/gdd/ventanas-ataque la barra está fija y pegada abajo con 2 tareas; en una sección sin tareas no hay barra; un clic lleva a la tarea; en escritorio no se ve.

**Notas:** Hecho: un nav.sec-bar al final de la vista, con backlinkTask (los mismos enlaces de la ficha); escondido por CSS fuera de ≤ 760 px, donde la ficha va al final. La sección es S.sec, que ya seguía el scroll con el IntersectionObserver del índice; la barra se redibuja con renderDocs y desaparece al salir de la vista (renderDocs la vacía). Comprobado con la spec de este repo a 390×844: en #docs/spec/hosting la barra muestra 2 tareas con la 7.1 y la 7.2.

**Referencias:** `docs/spec.md#telefono`

### 16.3 Campos de texto del detalle que crecen solos · Hecho

**Terminada:** 2026-10-10 · **Etiquetas:** `ui`

Pedido del usuario (2026-10-10): la esquina para agrandar el campo de notas es muy chica en el teléfono.

**Prueba:** A 390×844 táctil, las notas vacías miden 72 px y con siete líneas crecen más de 60 px, sin scroll adentro; el test falla sin field-sizing.

**Notas:** Hecho: field-sizing: content en .detail textarea (notas, Cómo probarlo y el detalle de un paso, que está dentro del detalle), con el mínimo de antes; resize: vertical queda para los navegadores sin field-sizing. Sin JS: el Chromium de Playwright (153) y Chrome en Android lo soportan.

**Referencias:** `docs/spec.md#telefono`

### 16.4 Índice del documento en la barra de abajo · Hecho

**Terminada:** 2026-10-10 · **Etiquetas:** `ui`

Pedido del usuario (2026-10-10): un desplegable con el índice en la barra de las referencias, para navegar más fácil.

**Prueba:** A 390×844 táctil, en #docs/gdd/ventanas-ataque el desplegable de la barra lista las cuatro secciones con la actual elegida; elegir camara cambia el hash y dice Sin tareas; elegir juego la deja arriba.

**Notas:** Hecho: un select nativo (en el teléfono abre el selector del sistema) a la izquierda de la barra de 16.2, con las secciones sangradas por nivel y la actual elegida; elegir una cambia el hash como los enlaces del índice. Las tareas van al lado en su propio contenedor que se desliza, así el desplegable queda fijo. La barra ahora está siempre que el documento tenga secciones: sin tareas dice Sin tareas. Visto con la spec de este repo a 390 y 602 px.

**Referencias:** `docs/spec.md#telefono`

### 16.5 Un clic afuera cierra el detalle de la tarea · Hecho

**Terminada:** 2026-10-10 · **Etiquetas:** `ui`

Pedido del usuario (2026-10-10): al abrir una tarea, un clic afuera del panel debería cerrarlo.

**Prueba:** Con el detalle abierto: tildar un paso no lo cierra; arrastrar una selección desde las notas hasta afuera tampoco; una tarjeta de otra columna abre esa tarea; un clic en el título del proyecto lo cierra. El test falla sin el cambio.

**Notas:** Hecho: dos escuchas en document, sin fondo nuevo (con el panel abierto se sigue pudiendo arrastrar y abrir otras tarjetas). pointerdown anota la tarea abierta si empieza fuera de #detail; click cierra si sigue abierta la misma. Así un clic que abre otra tarea (tarjeta, fila de la lista) cambia de tarea, una selección que sale del panel no cierra, y un botón del detalle que se redibuja (queda fuera del documento al llegar el click) tampoco. Las otras vistas ya cierran la tarea al entrar, así que sus enlaces a tareas no chocan.

**Referencias:** `docs/spec.md#telefono`

### 16.6 Detalle de la tarea a pantalla completa en el teléfono · Hecho

**Terminada:** 2026-10-10 · **Etiquetas:** `ui`

Pedido del usuario (2026-10-10): en el teléfono la tarea debería ocupar toda la pantalla, según el tamaño.

**Prueba:** A 390 y 602 px táctil el detalle mide todo el ancho; a 900 con mouse, 460 px. El test falla sin el cambio (a 602 quedaba de 460).

**Notas:** Hecho: hasta 760 px el detalle va a todo el ancho y sin el borde para cambiar su ancho (antes, solo bajo 460 px, así que en su teléfono de unos 600 quedaba una franja); desde 761 es el panel de siempre (el ancho elegido, 460 por defecto), con al menos 300 px de tablero al lado. 760 es el corte que ya usan Documentos, Listas y Archivos. De paso: overscroll-behavior: contain, así el scroll del detalle no arrastra la página de atrás.

**Referencias:** `docs/spec.md#telefono`

### 16.7 Ruta propia para la tarea abierta (atrás la cierra) · Hecho

**Terminada:** 2026-10-10 · **Etiquetas:** `ui`

Pedido del usuario (2026-10-10): con una tarea abierta, atrás llevaba a Documentos (la página anterior) en vez de cerrar la tarea.

**Prueba:** Abrir m1-07 deja #task/m1-07 y atrás la cierra con el tablero a la vista; adelante la reabre; Cerrar no suma entradas al historial; cambiar a otra tarea reemplaza la entrada; el enlace directo la abre y uno a una tarea inexistente se descarta; desde Documentos, atrás vuelve a #docs/gdd/ventanas-ataque. Los tests fallan sin el cambio.

**Notas:** Hecho: openTask apila #task/<id> con pushState y guarda en history.state desde qué hash se abrió (taskFrom); con otra tarea abierta, replaceState. readHash lee la ruta (y sin ella no hay tarea abierta). closeTask: si se abrió desde el tablero, history.back(); si no (otra vista o enlace directo), reemplaza la ruta por la del tablero, así no quedan dos entradas iguales. goToTask ya no pone un hash vacío antes (eran dos entradas). Una ruta a una tarea que no existe se descarta al cargar y al cambiar el hash (dropMissingTask). El test del ancho del detalle ahora encuentra la tarea abierta al recargar.

**Referencias:** `docs/spec.md#telefono`

## M17 — Descripción de las tareas  (3/3)

Que cada tarea diga qué hay que hacer y por qué en un campo propio, separado de las notas de lo que fue saliendo al trabajarla.

**Hecho cuando:**
- Una tarea tiene una descripción opcional (campo description), separada de las notas, que la CLI escribe y el export muestra antes de los pasos.
- El detalle de la tarea muestra la descripción antes de los pasos: en la web se edita; en el dock se lee.
- Las tareas de este repo que tenían el pedido en las notas lo tienen en la descripción.

### 17.1 Campo description: esquema, CLI, export y referencias · Hecho

**Terminada:** 2026-10-11 · **Etiquetas:** `cli`

Pedido del usuario (2026-10-11): las tareas no tenían dónde decir qué hay que hacer: el pedido iba en las notas, mezclado con lo hecho. Un campo opcional description con el qué y el porqué, y notes para lo que va saliendo al trabajarla (D37). Primero el backend: esquema, CLI, export, enlaces en línea y la guía para agentes.

- [x] Esquema, CLI, export y referencias
- [x] Tests, spec, D37 y AGENTS.md

**Prueba:** add --description la escribe; set --description "" la quita; show la imprime antes de los pasos y el export la pone debajo del título; refs check mira los `[[enlaces]]` de la descripción. `npm test` en `hub/` pasa (salvo los tres de la bandeja, que fallan igual en HEAD por el sandbox).

**Notas:** Hecho: description en el esquema (las tres copias), add/set/show en la CLI, el export (párrafo debajo de la línea de etiquetas, antes de los pasos), checkRefs, suggestRefs y las tareas de cada sección. add no la escribe vacía. La paridad con artifact_to_md.py se mide sin la descripción, como con etiquetas. AGENTS.md: la diferencia entre description y notes, y add con --description. Spec §4.2, §6, §10.2 y §25; D37.

**Referencias:** `docs/spec.md#descripcion`

### 17.2 Descripción en el detalle de la web y del dock · Hecho

**Terminada:** 2026-10-11 · **Etiquetas:** `ui`

Pedido del usuario (2026-10-11): mostrar y editar la descripción arriba en el detalle de la web, debajo del título y antes de los pasos, para que la tarea arranque por lo que hay que hacer. En el dock de Godot, mostrarla de solo lectura en el mismo lugar.

- [x] Web: Descripción entre el estado y los pasos
- [x] Dock: descripción de solo lectura

**Prueba:** En el detalle de la web, Descripción va entre el estado y los pasos; escribir y salir la guarda, un cambio de la CLI se ve en vivo y dejarla en blanco quita el campo. En el dock, la descripción de m1-04 se lee debajo del estado y una tarea sin descripción no muestra nada. `ui.test.js` y `dock.test.js` pasan (salvo «← Inicio», que falla porque hay un Inicio real corriendo).

**Notas:** Hecho: web: textarea #d-description debajo del selector de estado (las propiedades y el estado son de una línea, así la descripción queda arriba de todo lo largo), con placeholder, field-sizing como las notas y sus `[[enlaces]]` debajo; en blanco manda null y el campo se quita. Sobrevive al redibujado (EDITABLE). Las tareas de una sección y de un documento también miran la descripción. Dock: un Label de solo lectura en el mismo lugar, sin las comillas de código, como el título.

**Referencias:** `docs/spec.md#descripcion`

### 17.3 Migrar las notas: el pedido pasa a la descripción · Hecho

**Terminada:** 2026-10-11

Pedido del usuario (2026-10-11): las tareas existentes tienen el pedido al principio de las notas ("Pedido del usuario … Hecho: …"). Pasar esa parte a la descripción y dejar en las notas lo que se hizo; las que no siguen el patrón quedan como están.

**Prueba:** scompass refs check resuelve todo y tools/validate.py da OK. En 16.3 la descripción es el pedido y las notas arrancan en «Hecho:»; 12.1 tiene todo en la descripción; 1.7 sigue sin descripción.

**Notas:** Hecho: 39 tareas. 29 con texto antes de «Hecho:» (M10, M12–M16, 7.1): ese texto pasó a la descripción. 6 cortadas a mano en la primera oración (los «Pedido del usuario» sin «Hecho:», «Reportado por el usuario» de 6.11 y «Pedido al usar Epiphany» de 5.12). 4 eran solo un plan y pasaron enteras (12.1, 10.10, 7.2, 8.15). 4.2 («Depende del usuario.») y las de M1–M9, que son registro de lo hecho, quedaron sin descripción. Con la CLI, así que updated_at de esas tareas pasó a hoy. Project Epiphany no se tocó.

**Referencias:** `docs/spec.md#descripcion`

## M18 — Fechas, capturas e historial  (7/7)

Saber cuándo se terminó cada tarea y si un hito se atrasa, y que la tarea muestre más que texto: capturas, su historial en git y plantillas para bugs.

**Hecho cuando:**
- Cada tarea hecha dice cuándo se terminó (done_at), y el Inicio cuenta las terminadas en los últimos 7 días.
- Un hito puede tener fecha objetivo; pasada con tareas sin terminar, la CLI, la web, el dock y el Inicio lo marcan atrasado.
- Una tarea se puede estimar (S, M o L); la lista la filtra y ordena, y el resumen del hito dice cuánto falta por tamaño.
- Una tarea tiene capturas: en la web se pegan, se sueltan o se suben (en el teléfono, con la cámara), se ven en miniatura y en un visor; la CLI y el dock también las manejan.
- El detalle de la tarea y scompass history muestran qué cambió en cada commit, sacado de git.
- Etiquetar una tarea sin descripción con una etiqueta que tiene plantilla (como bug) arranca la descripción con esa plantilla.

### 18.1 done_at: fecha en que la tarea pasó a Hecho · Hecho

**Terminada:** 2026-10-11 · **Etiquetas:** `cli`

Pedido del usuario (2026-10-11): updated_at cambia con cualquier edición (la migración de 17.3 lo pisó en 39 tareas), así que no se sabe cuándo se terminó algo. Un campo done_at que se pone al pasar a Hecho y se quita al salir de Hecho, desde la CLI, la API, la web y el dock. Base para «terminadas esta semana» en el Inicio y el ritmo por hito.

**Prueba:** Pasar a Hecho (CLI, web, dock o API) pone done_at; editarla hecha no lo mueve; sacarla de Hecho lo quita. show dice «Hecho el …», el export «Terminada:», el pie del detalle «Terminada …», la lista tiene la columna y el orden Terminada, y el Inicio «n tareas terminadas en los últimos 7 días». Tests: store, cli, home, ui y m2-criteria.

**Notas:** Hecho: done_at en write() del store (un solo lugar para todos los clientes): al pasar a done, la hora de la escritura o la que traiga el documento; hecha, se conserva aunque un put no lo traiga; fuera de done, se quita. Una hecha de antes del campo no lo recibe al editarla. 133 tareas de este repo completadas con un script desde git (el updated_at en el commit que la dejó hecha), escrito sin la CLI para no tocar updated_at. localDay en dates.js para mostrar el día local. summarize suma done_week. AGENTS.md: los tres sellos los pone la CLI. Spec §4.2 y §26.

**Referencias:** `docs/spec.md#fechas-capturas-historial`

### 18.2 Fecha objetivo del hito · Hecho

**Terminada:** 2026-10-11 · **Etiquetas:** `cli`

Pedido del usuario (2026-10-11): los hitos tienen goal y done_when pero no fecha. Un due opcional en el hito, con la misma regla de vencido que las tareas; la web, el dock y el Inicio avisan cuando un hito con tareas pendientes pasó su fecha.

**Prueba:** milestone set m01 --due 2020-01-01 con una tarea sin terminar: milestone list/show, los encabezados de list y el export dicen «(atrasado)»; con todas hechas, no. En la web el resumen dice «Atrasado · …» y el chip tiene el borde rojo; en el dock el selector suma «· atrasado»; el Inicio lo marca en la tarjeta. --due "" la quita. Tests: cli, home, ui y dock (props).

**Notas:** Hecho: due en milestone.schema (mismo patrón que las tareas). milestoneDueState en dates.js: «done» si tiene tareas y están todas hechas; si no, dueState (un hito sin tareas cuenta como pendiente). milestone set --due lee el hito y lo reescribe entero con su etag: la API no tiene PATCH de hitos (D12) y la CLI pasa por el hub. La fecha se edita solo con la CLI, como el resto del hito.

**Referencias:** `docs/spec.md#fechas-capturas-historial`

### 18.3 Estimación S/M/L · Hecho

**Terminada:** 2026-10-11 · **Etiquetas:** `cli`

Pedido del usuario (2026-10-11): un tamaño opcional por tarea (S, M o L) para ver cuánto entra en un hito: filtro en la lista y la suma por hito en el resumen.

**Prueba:** set --size m (o M) la guarda; xl da error; list --size l,m y none filtran; show, list y el export la muestran; "" la quita. En la web: el chip Tamaño del detalle, la letra en la tarjeta, la columna y el filtro Tamaño, y «Falta 1 M» en el resumen. En el dock, «Tamaño M» en las propiedades. Tests: cli, ui y dock (props).

**Notas:** Hecho: size (s, m, l) en el schema, SIZES y el filtro en filters.js (lo comparten list y la web), --size en add/set/list. El resumen cuenta solo las tareas sin terminar y nombra las sin estimar; si ninguna está estimada no muestra nada, así un proyecto que no estima no ve ruido. Sin puntos ni horas: S/M/L alcanza para una sola persona.

**Referencias:** `docs/spec.md#fechas-capturas-historial`

### 18.4 Capturas en la tarea · Hecho

**Terminada:** 2026-10-11 · **Etiquetas:** `ui`

Pedido del usuario (2026-10-11): en un juego una imagen del bug o del efecto dice más que un párrafo. Rutas a imágenes del repo (como files) que el detalle muestra en miniatura y se abren grandes; sin servicio externo, versionadas con git.

**Prueba:** En la web, + Captura y pegar una imagen con la tarea abierta la suben a compass/images/ y aparece la miniatura; un clic abre el visor (← → recorren, Esc lo cierra sin cerrar la tarea) y Quitar la saca y borra el archivo si nadie más la usa. image add copia una de afuera y cita una del repo; refs check marca la que falta. El dock muestra la miniatura y «⚠ nombre» para la que falta. Tests: api, cli, ui y dock (props).

**Notas:** Hecho: images en el schema (rutas del repo con extensión de imagen). hub/src/images.js: verifica PNG/JPEG/GIF/WebP por los primeros bytes, hasta 10 MB, guarda en compass/images/<tarea>-<fecha-hora>[-n].<ext> y borra solo lo que guardó ahí cuando nadie lo cita (D38, que cambia D34 en ese punto). POST/DELETE /api/tasks/:id/images; el Inicio subió el límite del cuerpo de /p/:key/* a 16 MB, porque reenviaba con el de 1 MB. queueTask en la web: la cola por tarea ahora acepta cualquier escritura, no solo un PATCH. Bug evitado: compass/.gitattributes tenía «* text eol=lf», que habría corrompido las imágenes; ahora las marca binarias (scompass update lo lleva a los proyectos). Las miniaturas se sirven con /api/files/raw: hace falta un repo de git.

**Referencias:** `docs/spec.md#fechas-capturas-historial`

### 18.5 Historial de la tarea desde git · Hecho

**Terminada:** 2026-10-11 · **Etiquetas:** `ui`

Pedido del usuario (2026-10-11): quién cambió qué y cuándo ya está en git. Un Historial en el detalle con los commits que tocaron el JSON de la tarea y qué campos cambió cada uno, reusando lo de git.js para los documentos.

**Prueba:** Con un repo: scompass history m1-07 lista lo sin commitear arriba y cada commit con su fecha, autor y un renglón por campo («Estado: Hecho → En curso», «Tamaño: — → M»); la creación dice «Creada»; sin repo, avisa. En la web, Historial está plegado y al abrirlo lista lo mismo; cambiar el estado suma «Sin commitear». Tests: history y ui.

**Notas:** Hecho: hub/src/history.js. Los JSON de cada commit y de su padre salen de un solo git cat-file --batch (unos 15 ms con 30 commits). taskChanges arma los renglones en castellano para la CLI y la web por igual: pasos por texto (agregados, quitados, tildados), listas por elemento y textos largos solo como agregados, quitados o editados. Se saltean order y los sellos de fecha, y los commits que solo tocaron eso. GET /api/tasks/:id/history y scompass history. En la web se pide al abrir el historial y otra vez cuando cambia el etag.

**Referencias:** `docs/spec.md#fechas-capturas-historial`

### 18.6 Plantilla de descripción según la etiqueta · Hecho

**Terminada:** 2026-10-11 · **Etiquetas:** `ui`

Pedido del usuario (2026-10-11): un bug pide pasos para reproducirlo, qué se esperaba y qué pasó. Al etiquetar #bug una tarea sin descripción, la descripción arranca con esos encabezados; las plantillas por etiqueta van en config.json.

**Prueba:** Con description_templates.bug en config.json: add --tags bug (sin --description) y set --tags bug ponen la plantilla; con descripción, no la tocan. En la web, agregar la etiqueta bug en el detalle llena la descripción. La plantilla juego trae la de bug, y este repo también. Tests: cli y ui.

**Notas:** Hecho: description_templates en config.schema ({ etiqueta: texto }). descriptionTemplate en filters.js (la primera etiqueta nueva con plantilla, solo si no hay descripción); la web repite la regla al agregar etiquetas en el detalle, como con los filtros. Se edita en config.json, sin comando: es una config de una vez por proyecto.

**Referencias:** `docs/spec.md#fechas-capturas-historial`

### 18.7 Bug: un vínculo a una tarea de otro hito no cambia el tablero · Hecho

**Terminada:** 2026-10-11 · **Etiquetas:** `bug`, `ui`

Visto al revisar los vínculos entre hitos (2026-10-11): con el tablero en un hito, un clic en un vínculo del detalle a una tarea de otro hito abre su detalle pero deja el tablero en el hito anterior, porque usa openTask en vez de goToTask. Desde Documentos sí cambia.

**Prueba:** Con el tablero en M1, un clic en el vínculo de m1-07 a m0-01 abre m0-01 y el resumen dice M0. El test falla sin el cambio.

**Notas:** Hecho: el botón del vínculo usa goToTask (cambia el hito del tablero si hace falta) en vez de openTask. El dock ya cambiaba de hito.

## M19 — Auditoría  (16/16)

Arreglar lo que encontró la auditoría completa de M18 (seguridad, backend, web y dock): que los cambios en vivo no se pierdan, que nada escriba ni lea fuera del proyecto, y que la web y el dock no mientan ni se traben.

**Hecho cuando:**
- Los cambios hechos fuera del hub (a mano, git, sed -i) siguen llegando a la web y al dock aunque el archivo se reemplace con un rename.
- Nada de lo que dice config.json o la API lee ni escribe fuera del proyecto: export_md, documentos, capturas y enlaces simbólicos.
- La CLI y el hub no fallan en los casos que encontró la auditoría: historial en una subcarpeta, set --file con show --json, registro y claves del Inicio, capturas sin git, export con textos de varias líneas.
- El dock se reconecta al moverlo, no se traba con capturas, entra en 300 px, no muestra cambios que no se guardaron y no se rompe con JSON raros.
- La web crea las tareas donde corresponde, confirma antes de quitar una captura, no usa prompt() y se lee bien (espacios, números, enlaces, teléfono).

### 19.1 El watcher deja de ver un archivo reemplazado por rename · Hecho

**Terminada:** 2026-10-11 · **Etiquetas:** `bug`, `hub`

Auditoría (2026-10-11): en Linux, el fs.watch recursivo deja de avisar de un archivo después de que se lo reemplaza con un rename (writeAtomic, git checkout, sed -i), así que la web y el dock no se enteran de los cambios hechos fuera del hub (watcher.js, doc-watcher.js).

**Prueba:** Reemplazar tres veces seguidas una tarea con un temporal renombrado encima emite tres upsert; una carpeta lists/ que aparece después del arranque se mira y una lista nueva adentro se emite. El test (watcher.test.js, 19.1) falla sin el cambio.

**Notas:** Hecho: watch-tree.js con un fs.watch no recursivo por carpeta en Linux (salta .git, node_modules, .godot y .import), que suma las carpetas nuevas y suelta las que se van; ready se cumple cuando ya se miran todas, y el watcher lo espera en start(). El watcher de compass/ hace rescan si aparece o se va una carpeta de colección. doc-watcher lo usa para los documentos con patrón (los fijos ya miraban su carpeta sin recursión). Comprobado antes con un script: después del primer rename, el recursivo no avisaba más del archivo.

**Referencias:** `docs/spec.md#auditoria`

### 19.2 Nada se lee ni se escribe fuera del proyecto · Hecho

**Terminada:** 2026-10-11 · **Etiquetas:** `bug`, `hub`

Auditoría (2026-10-11): export_md en config.json puede apuntar a cualquier ruta (por ejemplo ~/.bashrc); POST /api/docs lee fuera del proyecto con llaves de glob, .., rutas absolutas, enlaces simbólicos o archivos ignorados por git (.env); compass/images como enlace simbólico deja escribir y borrar afuera; repoFile deja pasar claves del prototipo (status['constructor']).

**Prueba:** paths.test.js: projectRel; export_md fuera, a través de un enlace o no .md falla y no escribe afuera (--out sí puede); POST /api/docs rechaza llaves, .., absolutas, enlaces afuera, .env, lo ignorado y lo que no es .md; loadDocs no sigue enlaces afuera; compass/images enlazado afuera no guarda ni borra; repoFile('constructor') es 404. Cinco de los seis tests fallan sin el cambio.

**Notas:** Hecho: paths.js (projectRel, realInside con realpath de lo existente más cercano). Pattern en el schema de config para docs[].path y export_md (las tres copias); las configs de este repo, Project Epiphany y scope-audio lo cumplen. exportMarkdown sin out valida y mira el realpath; changeDocs exige .md, realpath adentro y, con repo, que git no lo ignore; docFiles filtra los enlaces de los patrones; loadDocs no lee lo de afuera. saveImage y dropImage miran el realpath. repoFile con Object.hasOwn. Quedan sin hacer: CSP en la UI (uso local de un solo usuario; pediría revisar los estilos en línea) y nosniff en el proxy del Inicio (19.8).

**Referencias:** `docs/spec.md#auditoria`

### 19.3 Historial en un repo con el proyecto en una subcarpeta · Hecho

**Terminada:** 2026-10-11 · **Etiquetas:** `bug`, `cli`

Auditoría (2026-10-11): si el proyecto no está en la raíz del repo, git cat-file con <hash>:compass/tasks/… no encuentra nada y el historial queda vacío. Además scompass history mezcla la hora UTC de lo sin commitear con la hora local de los commits.

**Prueba:** history.test.js (19.3): un repo con el proyecto en juegos/uno: el historial lista «Estado: Hecho → En curso» y la CLI da la hora local del commit. Falla sin el cambio en history.js.

**Notas:** Hecho: cat-file con <hash>:./<ruta> (relativo al -C del proyecto). localStamp en dates.js para la hora local de la CLI. La web ya mostraba hora local.

**Referencias:** `docs/spec.md#auditoria`

### 19.4 set --file acepta la salida de show --json · Hecho

**Terminada:** 2026-10-11 · **Etiquetas:** `bug`, `cli`

Auditoría (2026-10-11): sin hub, scompass set <id> --file con lo que devuelve show --json falla porque trae id y etag. Además If-Match: * da 409 en vez de aceptar cualquier versión.

**Prueba:** cli.test.js (19.4): show --json → editar → set --file guarda sin id; el mismo archivo otra vez es conflict; un id de otra tarea sale con código 2; milestone show --json → milestone set --file anda. api.test.js: PATCH con If-Match: * es 200. Fallan sin el cambio.

**Notas:** Hecho: readDocFile en la CLI saca id y etag, usa el etag como If-Match si no hay --etag y rechaza un id distinto; lo usan set y milestone set. preconditions() trata * como sin cabecera. Ayuda de la CLI y AGENTS.md.

**Referencias:** `docs/spec.md#auditoria`

### 19.5 Registro de hubs y claves del Inicio estables · Hecho

**Terminada:** 2026-10-11 · **Etiquetas:** `bug`, `hub`

Auditoría (2026-10-11): listHubs puede borrar la entrada de un hub vivo si lee el archivo a medio escribir; las claves /p/<n>/ del Inicio se corren al quitar un proyecto, y el registro queda con la base vieja.

**Prueba:** registry.test.js (19.5): un registro roto con el PID de un proceso vivo sigue después de listHubs y no quedan temporales. home-serve.test.js: después de quitar /a/Vida, /b/vida sigue en vida-2 y uno nuevo toma vida-3. Fallan sin el cambio.

**Notas:** Hecho: writeEntry (temporal + renameSync) para registerHub y registerServed; listHubs borra solo si el PID del nombre está muerto. projectKeys recibe las claves ya dadas; registerProjectRoutes guarda las suyas mientras vive el proceso.

**Referencias:** `docs/spec.md#auditoria`

### 19.6 Capturas en un proyecto sin git · Hecho

**Terminada:** 2026-10-11 · **Etiquetas:** `bug`, `hub`

Auditoría (2026-10-11): sin repo de git, las capturas no se sirven (raw pide un repo) y refs check las marca faltantes aunque estén.

**Prueba:** cli.test.js (19.6): sin git, image add de arte/boceto.png anda y nada.png no; refs check no marca nada hasta que se borra el archivo; /api/files/raw sirve la imagen y /api/files/file de un .txt es 404. Falla sin el cambio.

**Notas:** Hecho: imageFile en files-api.js (con repo, repoFile; sin repo, una imagen existente dentro del proyecto con realInside). La usan /api/files/raw y image add. refs check usa existsSync sin repo. También devuelve a m1-08 una aserción de cli.test.js que el sed de 19.4 había cambiado por error.

**Referencias:** `docs/spec.md#auditoria`

### 19.7 El export no se rompe con textos de varias líneas · Hecho

**Terminada:** 2026-10-11 · **Etiquetas:** `bug`, `hub`

Auditoría (2026-10-11): un título, un paso o unas notas con saltos de línea rompen la estructura de docs/tareas.md (listas y encabezados).

**Prueba:** export-md.test.js (19.7): título, hito y paso con saltos de línea quedan en un renglón; los únicos encabezados son los del export; ## y # dentro de la descripción salen escapados. Falla sin el cambio; la paridad con Python sigue pasando.

**Notas:** Hecho: line() para títulos, pasos, done_when e ítems; block() escapa # al empezar un renglón en descripción, meta, prueba y notas. No se tocó el schema (cambiarlo podía invalidar datos existentes): la web ya usa campos de un renglón para títulos y pasos.

**Referencias:** `docs/spec.md#auditoria`

### 19.8 Detalles del backend · Hecho

**Terminada:** 2026-10-11 · **Etiquetas:** `bug`, `cli`

Auditoría (2026-10-11): una fecha imposible (2026-02-30) cuenta en --due week; scompass restart en un proyecto del Inicio da HTTP 400 sin explicar; borrar una tarea no borra sus capturas guardadas por la app; file/image add y rm no normalizan \\ en Windows; un proyecto nuevo con nombre que empieza con - deja una carpeta huérfana; el proxy del Inicio no pasa nosniff.

**Prueba:** filters.test.js: 2026-02-30 no está en la semana. api.test.js (19.8): DELETE de una tarea borra su captura de compass/images/; PATCH con due 2026-02-30 es 400. home.test.js: el proyecto «-guion» se crea con ese nombre. Los tres fallan sin el cambio.

**Notas:** Hecho: dueMatches con s !== null; write() del store valida la fecha si cambió. restart avisa si la base del hub es /p/. DELETE de tarea llama a dropImage por cada captura. \\ → / en file e image. --project=<nombre> y rm de la carpeta si init falla. OUT del proxy con nosniff y CSP. El mensaje de restart y el proxy no tienen test propio (los dos son de una línea).

**Referencias:** `docs/spec.md#auditoria`

### 19.9 Dock: reconexión al moverlo y capturas sin trabar el editor · Hecho

**Terminada:** 2026-10-11 · **Etiquetas:** `bug`, `dock`

Auditoría (2026-10-11): mover el dock o hacerlo flotante lo deja «conectado» sin WebSocket para siempre; cada render decodifica las capturas desde disco dos veces (0,9 s con dos PNG 4K; sin hub, cada 3 s); un GIF o una imagen rota queda como miniatura invisible.

**Prueba:** dock.test.js (19.9): thumbs: la miniatura es la misma textura después de otro render, el GIF es un botón «▣ anim.gif» sin ERROR en la salida, el poll sin cambios no emite loaded y después de editar la tarea sí. reparent: sacar y volver a poner la vista la deja sin hub y se reconecta en menos de 8 s. Los dos fallan sin el cambio.

**Notas:** Hecho: _enter_tree vuelve a sin hub si el cliente quedó cerrado. _render_tree con set_block_signals alrededor del armado. _thumb() con caché por ruta, fecha y tamaño; mira la firma GIF8 antes de Image.load. _stamp_compass + _stamp_docs: la firma de compass/ se toma antes de leer y la de los documentos después, con la config nueva.

**Referencias:** `docs/spec.md#auditoria`

### 19.10 Dock: errores, guardados fallidos y clics dobles · Hecho

**Terminada:** 2026-10-11 · **Etiquetas:** `bug`, `dock`

Auditoría (2026-10-11): sin hub, un JSON con links/checklist/refs de forma rara rompe el render; otro programa en el puerto llena la consola de errores de JSON; un guardado fallido deja la UI mostrando el cambio; doble clic en Iniciar hub termina sin hub y dos scompass a la vez pierden el hilo; crear una tarea borra el título aunque falle; borrar el hito abierto deja el selector vacío; Reiniciar hub falla en un proyecto del Inicio.

**Prueba:** dock.test.js (19.10): bad_shapes: tres tareas con links, checklist y refs mal formados van a los avisos y la lista sigue, sin SCRIPT ERROR. failed_writes: con el hub inalcanzable, el selector vuelve al estado real y avisa; crear deja el título; con base /p/… no se ve Reiniciar hub; un segundo start_hub durante el primero devuelve false. Fallan sin el cambio; la suite del dock pasa entera (38).

**Notas:** Hecho: _check del reader valida la forma de las listas y sus elementos. HubClient.parse_json con JSON.new() para respuestas, registro, WebSocket y check_compass. _error_of para los mensajes del hub. _render_detail en la rama de error de _send_update. create_task borra el título solo si se creó. _starting y botón deshabilitado en start_hub; _scompass espera a un hilo en curso. delete del hito abierto → default_milestone; _go_to_task guarda la preferencia. restart_button oculto con client.base. El error de otro programa en el puerto sin paréntesis anidados.

**Referencias:** `docs/spec.md#auditoria`

### 19.11 Dock: ancho mínimo y abrir la tarea en la web · Hecho

**Terminada:** 2026-10-11 · **Etiquetas:** `ui`, `dock`

Auditoría (2026-10-11): el dock pide 466 px (947 con un error largo) porque el aviso no hace autowrap y el pie no recorta; no hay forma de abrir en la web la tarea abierta, y lo que es de solo lectura no lo dice; en Windows, scompass_path apuntando a un .cmd no arranca.

**Prueba:** dock.test.js (19.11): narrow: con un error largo sin hub y con hub (12 sin commitear) el ancho mínimo de la vista es ≤ 300 px; sin hub no hay ↗; con hub está y web_url termina en /#task/<id>. Falla sin el cambio (pedía 961 px). La suite del dock pasa entera (39). Lo del .cmd en Windows queda por probar en la VM.

**Notas:** Hecho: autowrap en banner_title; clip_text + elipsis en los labels del pie, con tooltip; restart sin texto. detail_web (↗) y detail_hint en el detalle, visibles con hub. scompass_command toma el .js junto a un .cmd/.ps1 configurado.

**Referencias:** `docs/spec.md#auditoria`

### 19.12 Web: nueva tarea, Pasar a tarea y confirmaciones · Hecho

**Terminada:** 2026-10-11 · **Etiquetas:** `bug`, `ui`

Auditoría (2026-10-11): Nueva tarea en Todos la crea en M0 (terminado) y lo reabre; Pasar a tarea pide el hito con un prompt() con los 19 hitos; Quitar en el visor borra sin confirmar; destildar un ítem que se repite deja la casilla mintiendo; el buscador de vínculos no responde a Enter ni a las flechas; el separador del panel arranca con aria-valuenow 0; la nueva tarea no se abre al crearla.

**Prueba:** ui.test.js (19.12): en Todos, N propone m02 (m00 y m01 terminados, m02 sin tareas); crear abre el detalle; aria-valuenow del separador ≥ 360; en el buscador de vínculos ↓ va a los resultados, ↑ vuelve, Enter vincula el primero. 18.4: Quitar pide confirmación y No no saca nada. ui-lists.test.js: Pasar a tarea abre el diálogo en m02, con los dos terminados aparte, y crea en m01. Fallan sin el cambio.

**Notas:** Hecho: defaultMilestone() en app.js (data-touched en el select para respetar lo elegido a mano); openTask al crear. pickMilestone(): dialog.pick con optgroup Terminados. openLightbox(id, i, confirming). searchKeys() en .ref-search. e.target.checked = true en un ítem que se repite. aria-valuenow después de mostrar el panel. Estilos de dialog.pick.

**Referencias:** `docs/spec.md#auditoria`

### 19.13 Web: tipografía y detalles visuales · Hecho

**Terminada:** 2026-10-11 · **Etiquetas:** `ui`

Auditoría (2026-10-11): en Alegreya Sans el espacio mide 2-3 px (las palabras se pegan) y los números antiguos hacen que M0 se lea Mo; enlaces con el azul del navegador en el Inicio y en Archivos; en el teléfono el borde de Vencida se parte y el estado de la Lista es solo color; el detalle de una tarea sin código empieza con «· M0»; el vacío de Listas dice «a la izquierda» en el teléfono; la búsqueda de Documentos resalta pedazos de palabras; dos conteos distintos de cambios sin commitear; el índice de Documentos dos veces en tablet; títulos cortados sin puntos suspensivos; toasts en minúscula.

**Prueba:** ui.test.js (19.13): el body tiene word-spacing y lining-nums; en el teléfono, en Lista, la marca de una tarea vencida es un solo rectángulo sin «Vencida ·», el estado dice «Pend.», y el detalle de la tarea sin código empieza con M1. Falla sin el cambio. Las suites ui*.test.js pasan (77; «← Inicio» falla solo con un Inicio real corriendo, como antes).

**Notas:** Hecho: word-spacing y lining-nums en body; a y a.btn. dm-pre y data-short (::after) en la lista del teléfono. Cabecera del detalle sin «·» si no hay código. Textos de Listas y del badge de git. highlight() solo al inicio de palabra (\p{L}\p{N}). toast() con mayúscula. setCustomValidity en el alias. sec-bar sin select en tablet táctil y con elipsis. .proj .kind en un renglón con elipsis.

**Referencias:** `docs/spec.md#auditoria`

### 19.14 Los tableros de prueba no quedan en el Inicio · Hecho

**Terminada:** 2026-10-11 · **Etiquetas:** `bug`, `hub`

Pedido del usuario (2026-10-11): cada tablero que se crea para probar algo queda como entrada basura en el Inicio (había 98 en projects.json, casi todas carpetas de /tmp que ya no existen).

**Prueba:** projects.test.js (19.14): con un projects.json fuera de /tmp, recordProject auto de un tablero en /tmp no lo anota; anotado a mano sí, y borrado, pruneTempProjects lo olvida. Con los tests aislados (projects.json en /tmp) serve sigue anotando, como verifican m8 y m9. La suite completa no tocó el projects.json del usuario.

**Notas:** Hecho: isTempPath (os.tmpdir(), /tmp, /var/tmp) y recordProject({ auto }) en projects.js; init y serve pasan auto. pruneTempProjects al arrancar el Inicio. test/isolate.js importado primero en los 44 archivos de test: con node --test directo pone registro, config y datos temporales (npm test ya lo hacía). El projects.json del usuario quedó con sus 2 proyectos reales (tenía 98). AGENTS.md lo cuenta. De paso, la paridad del export con Python ignora size (Epiphany ya tiene una tarea con tamaño).

**Referencias:** `docs/spec.md#auditoria`

### 19.15 Ícono y favicon con el dorado de la interfaz · Hecho

**Terminada:** 2026-10-11 · **Etiquetas:** `ui`

Pedido del usuario (2026-10-11): colorear el ícono y el favicon con el mismo amarillo que la interfaz.

**Prueba:** El favicon del tablero y del Inicio, y el ícono de la bandeja en Linux (SVG del tema), se ven dorados (#d9a441), como el dibujo de respaldo de la bandeja y el .ico de Windows.

**Notas:** Hecho: fill #d9a441 en web/favicon.svg (sin la variante gris por esquema de color) y en hub/assets/icons/hicolor/scalable/apps/scope-compass.svg. El README de los íconos lo anota.

**Referencias:** `docs/spec.md#auditoria`

### 19.16 Bordes de fantasía opcionales en la web · Hecho

**Terminada:** 2026-10-11

Pedido del usuario (2026-10-11): después de ver los mockups con los marcos de Project Epiphany (Kenney, CC0, recoloreados), sumarlos a la web con un botón de ajustes para activarlos y desactivarlos.

- [ ] Marcos también en Listas, Documentos, Archivos y el modo lista
  La primera versión solo cubría el tablero y el Inicio (lo notó el usuario). Paneles, índices, fichas, filas, campos, el selector Tablero/Lista y los bloques de código; las reglas quedaron agrupadas por marco.

**Prueba:** ui.test.js (19.16): Ajustes prende los bordes, la clase fantasy pone border-image de frames/ en columnas y tarjetas, la imagen se sirve como image/png, Esc cierra y devuelve el foco al engranaje, con el tema claro del sistema el fondo sigue oscuro, otra pestaña arranca con el modo, sigue al recargar y apagarlo se refleja en la otra pestaña. server.test.js y home-serve.test.js: /frames/*.png en el hub, en el Inicio y por /p/<clave>/; .gdignore y ../ dan 404.

**Notas:** Hecho: web/settings.js (en el <head> del tablero y del Inicio, sin defer) con el botón de engranaje y el diálogo Ajustes; scompass.fantasy en localStorage, evento storage para las otras pestañas. web/frames/ con 9 marcos de Project Epiphany y su License.txt (Kenney, CC0) más un .gdignore para que Godot no los importe. app.css: :root.fantasy usa la paleta oscura y las reglas .fantasy ponen los marcos con border-image a 1:1 y píxel nítido, sin atajos border (borran el border-image). El hub y el Inicio sirven /frames/*.png y /settings.js. AGENTS.md (las 3 copias), web/README.md (también el favicon, que ya era dorado) y spec §27. De paso, la paridad del export con Python ignora files (Epiphany ya cita archivos en sus tareas).

**Referencias:** `docs/spec.md#auditoria`

## M20 — Playtest y Pausado  (0/7)

Ordenar lo que está en Revisión: sesiones de playtest con tareas ya creadas en un orden de prueba, y un estado Pausado para lo que se dejó de lado sin terminar.

**Hecho cuando:**
- Una tarea puede estar en Pausado (paused), con su columna al lado de Pendiente en la web y en el dock.
- Hay sesiones de playtest en compass/playtests/ con tareas en un orden, resultado (anda / falla) y nota por tarea, manejables desde la CLI, la API y la pestaña Playtest de la web.

### 20.1 Estado Pausado · Revisión

Un estado paused (Pausado) para tareas empezadas que se dejan de lado sin terminar: schema, CLI, API, export, Inicio, columna al lado de Pendiente en la web y en el dock.

**Prueba:** playtest.test.js (CLI, schema, export), ui-playtest.test.js (columna), ui.test.js (atajos 1–5), dock.test.js

**Notas:** Columna entre Pendiente y En curso; color --s-paused (#a99bd1 oscuro). En el dock va después de Pendiente en el árbol (su orden es doing, review, todo, paused, done). Atajos 1–5.

### 20.2 Sesiones de playtest: datos, CLI y API · Revisión

Colección compass/playtests/<id>.json: sesiones con tareas ya creadas en un orden de prueba, con resultado (pass/fail) y nota por tarea. Schema, store, watcher, API, CLI scompass playtest y export.

**Prueba:** hub/test/playtest.test.js

**Notas:** Colección playtests con la forma de las listas; ítems { task, result?, note? }. CLI: scompass playtest (show/new/set/rm/add/move/drop/pass/fail/reset), por posición o por id. POST /api/playtests { title, tasks? }. Export: sección Playtest al final; la paridad con artifact_to_md.py se mide sin playtests (y sin images, que faltaba).

### 20.3 Pestaña Playtest en la web · Revisión

Vista Playtest (#playtest/<id>): crear sesiones, cargar tareas (una a una o todas las de Revisión), arrastrar para ordenar, marcar anda/falla con nota y pasar la tarea a Hecho o En curso.

**Prueba:** hub/test/ui-playtest.test.js

**Notas:** Reusa las clases de Listas (lists-grid, list-side, list-panel), así los bordes de fantasía aplican. Anda/Falla no mueve la tarea: ofrece Pasar a Hecho / Volver a En curso.

### 20.4 Docs y tests de M20 · Revisión

Spec, decisión, AGENTS.md (template, addon y compass/), README de compass y tests de lo nuevo.

**Prueba:** npm test (404 pass) y dock.test.js con Godot

**Notas:** spec §28, D39, AGENTS.md (template, addon y compass/), compass README.

### 20.5 Tarea abierta encima de la vista desde la que se abre · Revisión

Pedido: un clic en una tarea desde Listas, Playtest, Documentos o Archivos la abría pasando al tablero. Tiene que abrirse encima de esa vista, y Cerrar/atrás volver ahí.

**Prueba:** ui-playtest.test.js (abrir desde Playtest, Cerrar y atrás), ui-docs.test.js (backlinks)

**Notas:** readHash toma la vista de history.state.taskFrom; closeTask vuelve atrás siempre que haya taskFrom. En el teléfono la barra fija de Documentos se esconde con el detalle abierto.

### 20.6 Vista dividida en Playtest · Revisión

Pedido: al abrir una tarea desde Playtest, el panel tapaba Anda/Falla y la nota; después: que Playtest sea una vista dividida.

- [x] Nota de varios renglones
  Pedido: el campo de qué se vio tiene que poder agrandarse y aceptar varias líneas. Textarea con field-sizing: content y resize vertical, en la fila y en el detalle; Enter es salto de línea, se guarda al salir (onchange) o con Ctrl/⌘+Enter. El export sangra los renglones siguientes debajo del ítem (block() escapa #).
- [x] Código de la tarea en un renglón
  En una fila angosta el código (11.145) salía un dígito por renglón: heredaba overflow-wrap: anywhere del título. .pt-task .code va con white-space: nowrap y flex: none; se parte el título.
- [x] Fila de la sesión en grilla
  Con títulos de dos renglones, la posición y el punto quedaban centrados entre renglones y ↑ ↓ × caían solos a otro renglón. La fila es una grilla: posición, punto, código y título alineados a la primera línea (el título en .pt-title, sangrado bajo sí mismo), .pt-side con estado, resultado y flechas a la derecha, y la nota a lo ancho debajo. .pt-panel es container: con menos de 620 px los botones van en su renglón; #playtest pasa la barra de sesiones arriba desde 900 px.

**Prueba:** ui-playtest.test.js: botones y nota de la fila a la izquierda del panel; Falla y nota desde el detalle llegan a la sesión y a la fila

**Notas:** En escritorio (≥900 px, matchMedia SPLIT) Playtest es vista dividida: .wrap toma margin-right = --pt-detail-w = max(360px, min(--detail-w, 100vw − 600px)), así la sesión no baja de ~560 px (con un panel agrandado a ~1000 px quedaba de ~50 px y el texto en columna). Sin tarea abierta, #pt-empty ocupa el panel con Abrir la primera sin probar. Un clic en la sesión no cierra el detalle. ptDetail() pone ← Siguiente →, resultado, seguimiento y nota arriba en el detalle. #playtest es container: angosta, la barra de sesiones va arriba. La nota de la fila se conserva al re-armar solo si tiene cambios sin guardar (data-orig): con data-keep pisaba la nota escrita en el detalle.

### 20.7 Resultado del playtest en la tarea · Revisión

Pedido: una tarea que está en varias sesiones mostraba en cada una un resultado y una nota distintos (m11-130 anda en una y falla con nota en otra). Decidido: resultado y nota viven en la tarea (D40).

- [x] Modelo: playtest en la tarea; sesión solo { task }
- [x] CLI, API, export e historial
- [x] Web: fila, detalle, contadores y Reiniciar
- [x] scompass playtest migrate

**Prueba:** playtest.test.js (schema, misma tarea en dos sesiones por CLI, reset sin nada quita el campo, migrate con dos sesiones y una tarea borrada), ui-playtest.test.js (dos sesiones muestran lo mismo; Reiniciar en una se ve en la otra), history.test.js

**Notas:** La tarea lleva playtest: { result?, note? } (minProperties 1; sin nada, el campo se va). La sesión queda { task } en orden. hub/src/playtests.js: sessionState (cuántas faltan y fallan), nextPlaytest (undefined no cambia, null o "" quita) y migrateSessions (lee las sesiones crudas, ordena por updated_at, la más reciente que la probó gana el resultado, notas distintas se juntan de la vieja a la nueva, respeta lo que la tarea ya tenía; reescribe las sesiones directo con writeAtomic porque el store no pisa inválidas). La CLI avisa en playtest list si ve sesiones del formato anterior. Web: ptOf, ptSetResult y ptSetNote van por updateTask; Reiniciar quita result de cada tarea de la sesión (se ve en las otras). El historial muestra Playtest: anda → falla, nota agregada.

## M21 — Dock al día  (0/6)

Que el dock de Godot se conecte solo al Inicio, que sus tests no se salteen en silencio, y que sirva durante el playtest: ver el resultado de cada tarea, cargar bugs con captura desde el editor y buscar tareas.

**Hecho cuando:**
- Con el Inicio corriendo, el dock se conecta al abrir y en Reintentar sin apretar Iniciar hub.
- dock.test.js encuentra Godot por GODOT o por los nombres habituales, y avisa claro si no lo encuentra.
- El detalle del dock muestra el resultado y la nota del playtest, y la lista marca anda / falla.
- Desde el dock se carga un bug con la plantilla y una captura del juego o del editor.
- El dock filtra la lista por texto.

### 21.1 Conectarse solo al Inicio · Pendiente

Si el Inicio corre pero todavía no sirve el proyecto, el dock dice 'No hay hub en 127.0.0.1:<puerto> (no responde)' hasta apretar Iniciar hub. Al abrir y en Reintentar, pedirle al Inicio que active el proyecto (POST /api/projects/activate) antes de rendirse.

### 21.2 Tests del dock sin saltearse en silencio · En curso

dock.test.js saltea los 39 tests si no hay 'godot' en el PATH. Buscarlo también por la variable GODOT y nombres habituales del binario 4.8, y avisar claro cuando no está.

### 21.3 Resultado del playtest en el dock · Pendiente

El resultado vive en la tarea (D40): mostrar Anda / Falla y la nota en el detalle, y una marca en la lista. Las sesiones siguen fuera del dock.

### 21.4 Cargar un bug con captura desde el dock · Pendiente

Nueva tarea con la etiqueta bug (y su plantilla de description_templates) y una captura del juego corriendo o del viewport del editor, guardada en compass/images/.

### 21.5 Buscar tareas en el dock · Pendiente

Una caja de texto que filtra la lista por código, título o id, sin tildes, como scompass list --q.

### 21.6 Partir dock_view.gd · Pendiente

Tiene ~1600 líneas y mezcla la vida del hub, la lista, el detalle y las referencias. Separarlo en dos o tres scripts sin cambiar el comportamiento.
