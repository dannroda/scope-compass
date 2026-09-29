# Tareas — Scope Compass

> Export de `compass/`, que es la fuente de verdad. No editar: los cambios se hacen en `compass/` o con `scompass`, y este archivo se regenera.
> Generado: 2026-09-29

## M0 — Fundaciones del repo  (6/6)

Repo inicializado con el spec ordenado, las decisiones registradas, los schemas, el tablero propio y la estructura base. Se abre en Godot.

**Hecho cuando:**
- El repo está en GitHub (`dannroda/scope-compass`).
- Se abre en Godot 4.8 sin errores y el addon stub se activa.
- Las decisiones abiertas del spec están resueltas o con fecha para decidir.

### 0.1 Estructura base del repo · Hecho

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

- [x] Spec ordenado: nombre Scope Compass, rutas de referencias, `compass/` visible, estructura del repo
- [x] Ids de sección estampados en `docs/spec.md`
- [x] `docs/decisiones.md` con D1–D9

**Notas:** Razonamiento de cada decisión en `docs/decisiones.md`.

**Referencias:** `docs/spec.md#objetivo`

### 0.3 Schemas · Hecho

- [x] `schema/milestone.schema.json` y `schema/task.schema.json`
- [x] Copia en `compass/schema/`
- [x] `schema/config.schema.json` para `compass/config.json`
- [x] Validar los datos existentes contra los schemas

**Prueba:** Los JSON de `compass/` y de `project-epiphany/compass/` validan contra `schema/`.

**Notas:** Validador: `uv run tools/validate.py compass ../project-epiphany/compass` (schemas, formato canónico, conflictos, hitos inexistentes). La copia del schema de config en `project-epiphany/compass/schema/` queda para cuando Epiphany adopte la CLI (M4).

**Referencias:** `docs/spec.md#validacion`

### 0.4 Decisiones abiertas · Hecho

- [x] Licencia del repo: MIT (`LICENSE`, `hub/package.json`)
- [x] Versión mínima de Node: 22 (`engines`)
- [x] Hitos: solo CLI en v1; la UI los muestra
- [x] Export markdown automático en cada escritura, desactivable con `auto_export_md`

**Notas:** Decisiones D10–D13 en `docs/decisiones.md`: MIT, Node >=22, hitos solo por CLI en v1, export markdown automático (`auto_export_md`, activado por defecto).

**Referencias:** `docs/spec.md#decisiones-abiertas`

### 0.5 Abrir el repo en Godot · Hecho

- [x] Abre en Godot 4.8 sin errores
- [x] El addon `scope_compass` se activa
- [x] Editor Settings › Docks › FileSystem › TextFile Extensions: agregar `js,html,css` (`md` y `json` vienen por defecto)
- [x] `compass/` no aparece en el FileSystem (`.gdignore`)

**Prueba:** Abrir `../scope-compass` en Godot 4.8, activar el addon y editar `hub/README.md` desde el editor.

**Notas:** Probado con Godot 4.8-dev6 (`.godot-version`). El addon queda activado en `project.godot`; `compass/` no aparece en la caché del FileSystem.

**Referencias:** `docs/spec.md#godot`

### 0.6 Tablero y documentación propios · Hecho

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

- [x] Serializador canónico: claves ordenadas, 2 espacios, UTF-8, salto de línea final
- [x] Escritura atómica: archivo temporal + rename
- [x] Tests de ida y vuelta (leer → escribir → mismo contenido)

**Prueba:** Reescribir un archivo editado a mano no cambia su contenido, solo el formato.

**Notas:** `hub/src/store/canonical.js` y `hub/src/store/atomic.js`. Mismos bytes que el `canon()` de Python de `tools/` (verificado con los 21 JSON de Epiphany y casos límite). Los temporales se llaman `.<archivo>.<hex>.tmp`; el watcher de M2 los ignora con `isTempFile`. Los schemas no están en formato canónico a propósito (orden legible).

**Referencias:** `docs/spec.md#sin-app`, `docs/spec.md#concurrencia`

### 1.2 Validación · Hecho

- [x] Cargar los schemas de `schema/`
- [x] Elegir validador de JSON Schema: ajv (D14)
- [x] Archivo inválido → aviso, no se carga y la carga no lo toca
- [x] Detectar marcadores de conflicto de git

**Prueba:** Un archivo con un campo desconocido o con `<<<<<<<` se reporta y queda sin tocar.

**Notas:** ajv + ajv-formats (D14). `hub/src/schema.js` (`loadValidators`, `parseDoc`) y `hub/src/store/load.js` (`loadCompass`, solo lectura). Avisos con código: `invalid_json`, `invalid_schema`, `conflict_markers`, `unknown_milestone`, `missing_config`. Que una escritura no pise un archivo inválido queda en 1.3.

**Referencias:** `docs/spec.md#validacion`, `docs/spec.md#git-merges`

### 1.3 Store json-files + ETag · Hecho

- [x] Interfaz `Store` (list, get, put, patch, delete)
- [x] Implementación `json-files` sobre `compass/`
- [x] ETag = hash del contenido canónico; conflicto con el documento actual
- [x] Ids nuevos: 8 caracteres base36
- [x] Escribir sobre un archivo inválido o con conflicto se rechaza (no se pisa)

**Prueba:** Dos escrituras con el mismo ETag: la segunda falla con conflicto y devuelve el documento actual.

**Notas:** `hub/src/store/json-files.js`. Sin caché: cada operación lee el disco. Las operaciones del proceso se encolan; entre procesos protege el ETag (16 hex de sha256 del canónico). `patch`: merge de primer nivel, `null` borra el campo. Errores `StoreError` con `invalid_argument`, `not_found`, `conflict` (trae `current`), `invalid_file`, `io_error`.

**Referencias:** `docs/spec.md#modelo`, `docs/spec.md#concurrencia`, `docs/spec.md#arquitectura`

### 1.4 CLI básica · Hecho

- [x] `init`: crea `compass/` con schemas, README, `.gdignore` y `config.json`
- [x] `list` y `show` con `--json`
- [x] `add`, `move`, `check`
- [x] `set` y `milestone set` con `--file`
- [x] `--dir` para apuntar a otro proyecto

**Prueba:** `scompass --dir ../project-epiphany list --json` lista las tareas de Epiphany.

**Notas:** `hub/src/cli.js` + `hub/bin/scompass.js` (`npm link` en `hub/`). Extras sobre el spec: `milestone list|show`, `--etag` en escrituras, `--file -` (stdin), búsqueda de `compass/` hacia arriba. `check` numera desde 1. `serve`, `export` e `import` responden "todavía no está disponible".

**Referencias:** `docs/spec.md#cli`

### 1.5 Export markdown · Hecho

- [x] Port de `tools/artifact_to_md.py`
- [x] `scompass export md [--out]`
- [x] Título y URL del tablero desde `config.json`
- [x] Regenerar después de cada escritura de la CLI si `auto_export_md` no es `false` (D13)

**Prueba:** Para los mismos datos, la salida es idéntica a `tools/artifact_to_md.py` (salvo la fecha).

**Notas:** `hub/src/export-md.js`. Test contra `tools/artifact_to_md.py` con los datos de los dos proyectos: salida idéntica. Con `board_url` en la config el encabezado cita el artifact como fuente de verdad; sin él, dice que la fuente es `compass/` (se quita al migrar).

**Referencias:** `docs/spec.md#cli`

### 1.6 Import desde el artifact · Hecho

- [x] Port de `tools/artifact_to_tablero.py`
- [x] Descarta `version`; `created_at` = `updated_at` si existe
- [x] Reporte de conteos

**Prueba:** Importar el export de Epiphany: 11 hitos y 10 tareas, sin diferencias con `project-epiphany/compass/`.

**Notas:** `hub/src/import-artifact.js` + `scompass import artifact <carpeta> [--dry-run] [--overwrite]`. Export real de Epiphany: 11 hitos y 10 tareas sin cambios contra `project-epiphany/compass/`, e import en limpio idéntico a `tools/artifact_to_tablero.py`. Si el documento ya existe conserva su `created_at`. La detección de notas "gdd.md §N.N" → `refs` (spec §8, notas) queda para M6.

**Referencias:** `docs/spec.md#migracion`

### 1.7 Tests de M1 · Hecho

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

- [x] `GET/PUT/DELETE /api/milestones[/:id]`; `DELETE` rechaza con `409` si tiene tareas
- [x] `GET /api/tasks?milestone=&status=`, `POST`, `PATCH`, `DELETE`
- [x] Cabecera `ETag` en cada documento; `If-Match` en escrituras
- [x] `409 conflict` con el documento actual; `invalid_file` como `409`
- [x] `POST /api/export/markdown`

**Prueba:** Dos `PATCH` con el mismo `If-Match`: el segundo devuelve `409` con el documento actual.

**Notas:** `hub/src/api.js`, vistas compartidas con la CLI en `hub/src/views.js`. Extras sobre §5.2: `GET` de un documento, `PUT /api/tasks/:id` y `If-None-Match: *` para crear solo si no existe. Cerrada por la propia API.

**Referencias:** `docs/spec.md#api-rest`, `docs/spec.md#concurrencia`

### 2.3 Watcher de cambios externos · Hecho

- [x] `fs.watch` recursivo sobre `compass/` con debounce
- [x] Ignora los temporales de `writeAtomic`
- [x] Distingue escrituras propias de externas (sin eventos duplicados)
- [x] Archivo inválido → aviso, no se cae el servidor

**Prueba:** Editar un JSON a mano con el hub corriendo emite el cambio en menos de 1 s; un JSON roto emite un aviso.

**Notas:** `hub/src/watcher.js` + bus `app.events` en el servidor (`watch: true` en `serve`). Etag conocido por documento: sin duplicados por escrituras propias ni por reformateos. Tests con disco real, estables en 10 corridas seguidas.

**Referencias:** `docs/spec.md#cambios-externos`, `docs/spec.md#validacion`

### 2.4 WebSocket · Hecho

- [x] `/ws` con `hello` al conectar
- [x] `upsert`, `delete` y `warning` para escrituras de la API y cambios externos
- [x] Mensajes del cliente: `update` → `ack` o `error` (con `conflict` y el documento)

**Prueba:** Un cliente WebSocket mínimo recibe `upsert` al mover una tarjeta por la API y por la CLI.

**Notas:** `hub/src/ws.js`. `update` solo para tareas (como la API, D12); el ack va a quien lo manda y el upsert a todos. Errores sin cerrar la conexión; un error inesperado responde `io_error` en vez de tumbar el hub. Cerrada por el propio WebSocket.

**Referencias:** `docs/spec.md#websocket`

### 2.5 La CLI usa el hub si está corriendo · Hecho

- [x] Detectar el hub en el puerto de la config (`/api/health` del mismo proyecto)
- [x] Escrituras por la API cuando está; si no, directo al disco
- [x] Mismos códigos de salida y la misma salida `--json` en los dos modos

**Prueba:** `scompass move` con el hub corriendo emite el evento por WebSocket; con el hub apagado escribe el archivo igual.

**Notas:** `hub/src/store/http.js`: store sobre la API con la misma interfaz que json-files; la CLI elige uno u otro. Solo usa el hub si `/api/health` es del mismo proyecto. `--direct` fuerza el disco. Test: misma secuencia con y sin hub, salida idéntica. Cerrada por la CLI a través del hub.

**Referencias:** `docs/spec.md#cli`

### 2.6 Export markdown desde el hub · Hecho

- [x] Regenerar `export_md` después de cada escritura de la API (D13)
- [x] Debounce para ráfagas de cambios
- [x] También tras cambios externos detectados por el watcher

**Prueba:** Mover una tarjeta desde la API actualiza `docs/tareas.md`.

**Notas:** `hub/src/auto-export.js` (`exportMd: true` en `serve`). Debounce de 200 ms y relectura de la config en cada export. Al cerrar el hub se hace el export pendiente. Con hub, la CLI ya no exporta. Cerrada con el hub corriendo: el markdown lo generó el hub.

**Referencias:** `docs/spec.md#cli`

### 2.7 Tests de M2 · Hecho

- [x] Criterios de §14 que necesitan servidor (sin UI)
- [x] Escritura concurrente con ETag viejo → `409`
- [x] JSON inválido con el hub corriendo → aviso, el servidor sigue

**Prueba:** `npm test` en `hub/` pasa, incluidos los tests con servidor.

**Notas:** `hub/test/m2-criteria.test.js`: JSON inválido con hub (avisa y sigue respondiendo), CLI con hub incluido `export md`, edición con la app apagada vista al levantarla, conflicto sin sobrescribir por API/CLI/WebSocket, y escrituras concurrentes contra el hub real. Criterios de §14 con UI quedan para M3. Límite conocido: dos `add` simultáneos pueden repetir `order` (se leen antes de escribir); no pierde datos.

**Referencias:** `docs/spec.md#criterios-v1`

### 2.8 Detalles de la CLI: `--etag none`, editar campos, `order` al crear · Hecho

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

- [x] Separar `docs/reference/tablero-artifact.html` en `web/index.html`, `app.css` y `app.js` sin build step
- [x] El hub sirve `web/` en `/` (handler propio, sin dependencia nueva)
- [x] `GET /api/config` con el nombre del proyecto para el título
- [x] Mismo aspecto que el artifact en claro y oscuro

**Prueba:** `scompass serve --open` muestra el tablero con el aspecto del artifact.

**Notas:** `web/index.html`, `app.css` (copiado del artifact) y `app.js`. El hub sirve `/`, `/app.css`, `/app.js` y `/fonts/:file` con rutas fijas. Revisado con capturas de Playwright en claro, oscuro y 390 px. En "Todos" las tarjetas se ordenan por hito y después por order, como `scompass list` (el artifact mezclaba hitos).

**Referencias:** `docs/spec.md#frontend`, `docs/spec.md#v1-paridad`

### 3.2 Cliente de la API y carga inicial · Hecho

- [x] Reemplazar `claude.use("db")` por un cliente de `/api`
- [x] Carga inicial de hitos y tareas
- [x] Crear, mover, editar y borrar tareas por la API

**Prueba:** Crear, mover, tildar pasos y borrar desde la UI cambia los JSON de `compass/`.

**Notas:** Cliente de `/api` en `app.js`; cada escritura aplica el documento que devuelve la API. Prueba de humo con Playwright sobre una copia: crear, mover, tildar, arrastrar y borrar cambian los JSON. Todavía sin etag (3.4) ni WebSocket (3.3).

**Referencias:** `docs/spec.md#frontend`, `docs/spec.md#api-rest`

### 3.3 WebSocket con reconexión · Hecho

- [x] Aplicar `upsert` y `delete` sobre el estado
- [x] Reconexión con espera creciente; al reconectar, recarga completa
- [x] Indicador discreto de "sin conexión con el hub"

**Prueba:** Dos pestañas: mover una tarjeta en una se ve en la otra en menos de 1 s; al reiniciar el hub, la UI se reconecta sola.

**Notas:** WebSocket en `app.js`: carga completa en cada `hello` (también al reconectar) y se repite si llegan eventos durante la carga. Reconexión de 0,5 s a 10 s con aviso en la cabecera. Tests de navegador en `hub/test/ui.test.js`: dos pestañas en menos de 1 s, cambios de la CLI y a mano, hub caído y vuelta.

**Referencias:** `docs/spec.md#websocket`, `docs/spec.md#frontend`

### 3.4 Escrituras con etag y 409 · Hecho

- [x] Cada escritura manda el etag que la UI tiene en memoria
- [x] Ante `409`: tomar el documento actual y avisar "otra pestaña cambió esta tarea"

**Prueba:** Escritura con etag viejo desde una pestaña: la UI muestra el aviso y queda con el documento actual.

**Notas:** Cada escritura manda `If-Match`. Ante `409` la UI toma el documento actual y avisa. Escrituras de una tarea en fila, con el cambio calculado al enviarlo: tildar varios pasos seguidos no da 409 ni pisa. Test con una pestaña que no recibe eventos (`routeWebSocket`) para forzar el 409.

**Referencias:** `docs/spec.md#concurrencia`, `docs/spec.md#frontend`

### 3.5 Avisos de archivos inválidos · Hecho

- [x] Mostrar los `warnings` de la carga y los eventos `warning`
- [x] El aviso desaparece cuando el archivo se corrige

**Prueba:** Romper un JSON a mano con la UI abierta muestra un aviso; arreglarlo lo quita y la tarea vuelve.

**Notas:** Sección de avisos en la UI con los `warnings` de la carga y los eventos `warning`, uno por archivo; se va con el `upsert` o `delete` de ese archivo. Un archivo que pasa a inválido deja de mostrarse como tarjeta.

**Referencias:** `docs/spec.md#validacion`, `docs/spec.md#cambios-externos`

### 3.6 Fuentes locales · Hecho

- [x] Cinzel, Alegreya Sans y JetBrains Mono en `web/fonts/` (OFL, con sus licencias)
- [x] Sin requests a Google Fonts ni a ningún otro host

**Prueba:** Con la red cortada, la UI carga con las mismas tipografías.

**Notas:** `web/fonts/`: 5 woff2 (subconjunto latino, `@fontsource` 5.3.0) y sus licencias OFL. Test de navegador con todo lo que no es 127.0.0.1 bloqueado: ninguna petición externa y las fuentes cargan.

**Referencias:** `docs/spec.md#frontend`

### 3.7 Mejoras chicas del port · Hecho

- [x] No perder lo escrito en el detalle (Notas, Cómo probarlo y "Agregar paso") cuando se vuelve a dibujar, sea por un evento de otra pestaña o por la respuesta de una escritura propia
- [x] Reordenar tarjetas dentro de una columna al arrastrar (`order`)
- [x] Atajos: `N` nueva tarea, `1`–`4` estado de la tarea abierta, `Esc` cierra

**Prueba:** Escribir notas mientras otra pestaña mueve la misma tarea no pierde lo escrito.

**Notas:** Cada campo del detalle guarda en `data-orig` el valor dibujado; lo cambiado y no guardado, el foco y la selección se restauran al redibujar. Reordenar: soltar sobre una tarjeta del mismo hito la deja antes (order intermedio) y toma el estado de esa columna. Atajos N, 1–4 y Esc, nunca mientras se escribe. Los tests de "no perder lo escrito" fallan con el app.js anterior.

**Referencias:** `docs/spec.md#frontend`

### 3.8 Tests de M3 (Playwright) · Hecho

- [x] Playwright como devDependency (D18)
- [x] Criterios de §14 con UI: paridad, dos pestañas, 409, JSON inválido, sin internet
- [x] Claro, oscuro y pantalla angosta

**Prueba:** `npm test` en `hub/` corre también los tests de navegador.

**Notas:** `hub/test/ui.test.js` (Playwright en `node:test`, D18): 15 tests. Paridad con el HTML del artifact en claro/oscuro y 1400/900/390 px (detecta un cambio de un dígito en un token). Cliente WebSocket mínimo mientras la UI arrastra. Sin la app: los JSON validan con `compass/schema/` y el markdown tiene lo hecho. Encontró el cuelgue al cerrar el hub con la UI abierta (arreglado en 3.5/3.6).

**Referencias:** `docs/spec.md#criterios-v1`

## M4 — Adopción en Project Epiphany  (1/2)

Project Epiphany deja el artifact y usa `compass/` + `scompass` a diario.

**Hecho cuando:**
- Epiphany tiene sus datos en `compass/` migrados con `scompass import artifact`.
- El artifact de Epiphany queda como archivo de solo lectura.
- Una semana de uso diario sin volver al artifact.

### 4.1 Migrar Epiphany a `compass/` · Hecho

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

## M5 — Dock de Godot (v1.5)  (2/7)

Addon `scope_compass` con un dock que muestra las tareas del hito actual y las mueve a través del hub.

**Hecho cuando:**
- El dock funciona en Godot 4.8 (API de docks verificada).
- Mover una tarea desde el dock se ve en la UI web al instante, y al revés.
- Sin hub corriendo, el dock muestra las tareas leyendo `compass/` en solo lectura.

### 5.1 Estructura del addon con `EditorDock` · Hecho

- [x] Dock con `EditorDock` + `add_dock` (API de 4.8, D19)
- [x] Vista del dock como `Control` aparte, testeable sin el editor
- [x] Se agrega y se quita limpio al activar y desactivar el plugin

**Prueba:** Activar el plugin muestra el dock "Tablero"; desactivarlo lo quita sin errores.

**Notas:** `scope_compass.gd` monta `dock_view.gd` (un VBoxContainer) dentro de un `EditorDock`. Probado en el editor sin ventana sobre este repo: se monta y se desmonta sin errores.

**Referencias:** `docs/spec.md#godot`

### 5.2 Modo sin hub: leer `compass/` · Hecho

- [x] Leer hitos y tareas con `FileAccess`/`JSON`, mismo orden que la CLI; los inválidos se avisan
- [x] Selector de hito (por defecto el primero sin terminar; se recuerda por proyecto)
- [x] Tareas agrupadas por estado, plegables, con código, título y pasos
- [x] Aviso de solo lectura, "Reintentar" y "Abrir compass/tasks"
- [x] Pie con "N sin commitear" (`git status`)

**Prueba:** Sin hub, el dock muestra las tareas del hito y un aviso de solo lectura.

**Notas:** `compass_reader.gd` (lectura y validación mínima, mismos avisos que el hub), `board.gd` (orden de la CLI; hito por defecto: el primero sin terminar) y `dock_view.gd`. Sin hub relee cada 5 s. Tests de Godot sin ventana desde `npm test` (`hub/test/dock.test.js`). `web/fonts/.gdignore`: Godot importaba las fuentes.

**Referencias:** `docs/spec.md#godot`, `docs/spec.md#sin-app`

### 5.3 Cliente del hub · Pendiente

- [ ] Detectar el hub por `/api/health` del mismo proyecto
- [ ] Carga por HTTP y cambios por `WebSocketPeer` con reconexión
- [ ] Pasar de solo lectura a edición (y al revés) según haya hub

**Prueba:** Con el hub corriendo, un cambio desde la UI web se ve en el dock al instante.

**Referencias:** `docs/spec.md#godot`, `docs/spec.md#websocket`

### 5.4 Editar desde el dock · Pendiente

- [ ] Cambiar el estado y tildar pasos
- [ ] Etag y 409 (en fila por tarea, como la UI web)
- [ ] "Nueva tarea" y abrir el tablero en el navegador

**Prueba:** Mover una tarea desde el dock se ve en la UI web al instante.

**Referencias:** `docs/spec.md#godot`, `docs/spec.md#concurrencia`

### 5.5 Iniciar el hub desde el dock · Pendiente

- [ ] "Iniciar hub" con `OS.create_process` (ruta a `scompass` configurable)
- [ ] Cerrarlo al salir del editor solo si lo abrió el dock

**Prueba:** Sin hub, "Iniciar hub" lo levanta y el dock pasa a edición; al cerrar el editor, el hub se cierra.

**Referencias:** `docs/spec.md#godot`

### 5.6 Tests de M5 · Pendiente

- [ ] Godot sin ventana lanzado desde `npm test` (se saltea si no hay `godot`)
- [ ] Dock ↔ UI web en los dos sentidos; modo sin hub

**Prueba:** `npm test` en `hub/` corre también los tests de Godot.

**Referencias:** `docs/spec.md#criterios-v1`, `docs/spec.md#godot`

### 5.7 Instalar el addon en Epiphany · Pendiente

- [ ] Symlink `project-epiphany/addons/scope_compass` → este addon
- [ ] Activarlo y usarlo con el tablero de Epiphany

**Prueba:** El dock de Epiphany muestra sus tareas.

**Notas:** Depende de que `scope-compass` esté clonado al lado de Epiphany.

**Referencias:** `docs/spec.md#godot`

## M6 — Documentos y referencias (v2)

Visor de documentos del proyecto (GDD) y referencias estables entre tareas y secciones (§10).

**Hecho cuando:**
- Una tarea con `refs` muestra la sección renderizada en su detalle, con GDScript resaltado.
- Renombrar o renumerar una sección con id no rompe referencias.
- `scompass refs check` detecta referencias rotas.
- El dock muestra la sección referenciada en BBCode.

## M7 — Hosting privado

El mismo hub en un servidor privado para usarlo desde el teléfono, con git como almacenamiento (§12).

**Hecho cuando:**
- Desde el teléfono se ve y se edita el tablero (PWA).
- Los cambios se commitean y se pushean solos, sin forzar nunca ante conflictos.
- El hub pide token y no queda expuesto a internet sin login.
