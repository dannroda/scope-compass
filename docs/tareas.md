# Tareas — Scope Compass

> Export de `compass/`, que es la fuente de verdad. No editar: los cambios se hacen en `compass/` o con `scompass`, y este archivo se regenera.
> Generado: 2026-10-10

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

## M4 — Adopción en Project Epiphany  (3/4)

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

**Relacionadas:** 4.3 Ids legibles al crear tareas; 4.4 Aviso de cambios sin commitear en compass/

### 4.3 Ids legibles al crear tareas · Hecho

- [x] Generar el id a partir del hito: m<N>-<NN> con el siguiente libre
- [x] Usarlo desde la CLI, la API (web) y el dock
- [x] Mantener el aleatorio solo si hay choque
  Por ejemplo, si dos ramas crean la misma tarea: el id tiene que seguir siendo único después del merge.

**Prueba:** scompass add en m00 crea m0-NN con el siguiente número libre; la web y el dock hacen lo mismo.

**Notas:** `taskIdFor` en el Store: lo usan la CLI, la API (web, dock, Inicio) y `item task`. El paso 3 quedó como: un hito con id no numérico usa aleatorio, y si otro proceso tomó el número entre la lectura y la escritura, el siguiente. Choques entre ramas: conflicto add/add de git (D27).

**Relacionadas:** 4.2 Una semana de uso diario sin volver al artifact

### 4.4 Aviso de cambios sin commitear en compass/ · Hecho

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

### 5.3 Cliente del hub · Hecho

- [x] Detectar el hub por `/api/health` del mismo proyecto
- [x] Carga por HTTP y cambios por `WebSocketPeer` con reconexión
- [x] Pasar de solo lectura a edición (y al revés) según haya hub

**Prueba:** Con el hub corriendo, un cambio desde la UI web se ve en el dock al instante.

**Notas:** `hub_client.gd`: detecta el hub por `/api/health` del mismo proyecto, carga por HTTP y aplica eventos del `WebSocketPeer`. Sin hub reintenta cada 3 s y lee compass/. Tests con Godot y un hub reales: un cambio de la web llega al dock en menos de 1 s; el hub se cae y vuelve y el dock se reconecta solo.

**Referencias:** `docs/spec.md#godot`, `docs/spec.md#websocket`

### 5.4 Editar desde el dock · Hecho

- [x] Cambiar el estado y tildar pasos
- [x] Etag y 409 (en fila por tarea, como la UI web)
- [x] "Nueva tarea" y abrir el tablero en el navegador

**Prueba:** Mover una tarea desde el dock se ve en la UI web al instante.

**Notas:** Estado y pasos editables, en fila por tarea con el cambio calculado al enviar (como la UI web); `409` toma la versión actual y avisa. "Nueva tarea" en el hito elegido y botón para abrir el tablero en el navegador. Coordinación Godot ↔ Node en los tests por líneas de stdout y un archivo marcador.

**Referencias:** `docs/spec.md#godot`, `docs/spec.md#concurrencia`

### 5.5 Iniciar el hub desde el dock · Hecho

- [x] "Iniciar hub" con `OS.create_process` (ruta a `scompass` configurable)
- [x] Cerrarlo al salir del editor solo si lo abrió el dock

**Prueba:** Sin hub, "Iniciar hub" lo levanta y el dock pasa a edición; al cerrar el editor, el hub se cierra.

**Notas:** "Iniciar hub" busca scompass en Editor Settings (`scope_compass/scompass_path`), al lado del proyecto, dentro de él o en el PATH. Se lanza por `sh` con la salida a `.godot/scope_compass_hub.log` (si no, heredaba el stdout de Godot y colgaba los tests). Al salir, SIGTERM solo si lo abrió el dock.

**Referencias:** `docs/spec.md#godot`

### 5.6 Tests de M5 · Hecho

- [x] Godot sin ventana lanzado desde `npm test` (se saltea si no hay `godot`)
- [x] Dock ↔ UI web en los dos sentidos; modo sin hub

**Prueba:** `npm test` en `hub/` corre también los tests de Godot.

**Notas:** `hub/test/dock.test.js`: 12 casos con Godot sin ventana (sin hub, con hub en los dos sentidos, 409, pasos seguidos, nueva tarea, reconexión, iniciar y cerrar el hub). Estables en 3 corridas.

**Referencias:** `docs/spec.md#criterios-v1`, `docs/spec.md#godot`

### 5.7 Instalar el addon en Epiphany · Hecho

- [x] Symlink `project-epiphany/addons/scope_compass` → este addon
- [x] Activarlo y usarlo con el tablero de Epiphany

**Prueba:** El dock de Epiphany muestra sus tareas.

**Notas:** Symlink `project-epiphany/addons/scope_compass` → `../../scope-compass/addons/scope_compass` y activado en su `project.godot`. El editor de Epiphany lo carga sin errores y el dock lee su tablero. Con tareas de muchos pasos, el detalle ahora tiene su propio scroll.

**Referencias:** `docs/spec.md#godot`

### 5.8 El hub lanzado por el dock muere con el editor · Hecho

- [x] `scompass serve --exit-on-stdin-close`: se cierra cuando se corta su entrada
- [x] El dock lo lanza con `OS.execute_with_pipe` (la salida sigue yendo al log)
- [x] Probado matando a Godot con `kill -9`: el hub se va solo

**Prueba:** Iniciar el hub desde el dock y matar a Godot con `kill -9`: el hub se cierra en menos de 2 s.

**Notas:** `scompass serve --exit-on-stdin-close` y el dock lo lanza con `OS.execute_with_pipe` (la salida sigue yendo a `.godot/scope_compass_hub.log`). Al cerrar el dock se corta la tubería; si en 3 s sigue vivo, SIGTERM. Test: Godot lanza el hub y Node lo mata con `kill -9`; con la versión anterior el hub quedaba vivo, ahora se va en menos de 3 s. También probado con el editor real cerrándose normalmente.

**Referencias:** `docs/spec.md#godot`

### 5.9 Opción de mantener el hub, con ícono en la bandeja · Hecho

- [x] `scompass serve --tray`: ícono en la bandeja de Plasma (StatusNotifierItem por D-Bus, D20)
- [x] Tooltip con proyecto y dirección; clic abre el tablero; menú "Abrir tablero" y "Detener hub"
- [x] Editor Settings `scope_compass/keep_hub_running`: el dock lo lanza independiente y con `--tray`
- [x] Epiphany en el puerto 4712 para poder tener los dos hubs a la vez

**Prueba:** Con la opción activada, cerrar el editor deja el hub y su ícono; "Detener hub" desde la bandeja lo cierra.

**Notas:** `hub/src/tray.js` (D20): ícono, tooltip con proyecto y dirección, clic abre el tablero, menú "Abrir tablero" / "Detener hub". Probado en un bus privado (el test hace de Plasma) y registrado en el Plasma real. Editor Settings `scope_compass/keep_hub_running`: el dock lo lanza sin tubería y con `--tray`, y no lo cierra. `create_process` ya pone al hijo en su propia sesión (setsid sobraba y cambiaba el PID). Epiphany pasó al puerto 4712 (commit `1277eec` allá).

**Referencias:** `docs/spec.md#godot`

### 5.10 Reiniciar el hub (dock, bandeja, CLI y API) · Hecho

**Notas:** Pedido del usuario, para cargar código nuevo sin cerrar el editor. `POST /api/restart`: el hub cierra, libera el puerto y se relanza con los mismos argumentos (y el puerto que tenía de verdad), heredando entrada y salida: si lo lanzó el dock sigue atado a Godot por la misma tubería. `/api/health` informa el PID. Dock: botón "Reiniciar hub" en el pie; bandeja: "Reiniciar hub" en el menú; CLI: `scompass restart`. Detalles: la tubería "pipe" de Node es un par de sockets y el test necesitó un pipe real (cat); OS.is_process_running de Godot no ve al hub reiniciado (es nieto), se usa kill -0. Los tests que leen Epiphany ya no dependen de su contenido exacto.

### 5.11 Dock: el texto del paso despliega su detalle, divisor lista/detalle, bloque de tareas plegable · Hecho

**Notas:** Pedido del usuario. El cuadradito tilda y el texto (o ▸) despliega el detalle: tildar al tocar el texto era contraintuitivo. VSplitContainer entre la lista de tareas y el detalle, con el divisor recordado por proyecto; "▾ Tareas · n" pliega la lista y el detalle usa todo el alto (también recordado). De paso: el selector de hito fijaba el ancho mínimo del dock al del hito más largo (`fit_to_longest_item = false`) y los botones del aviso bajan de renglón.

### 5.12 Bandeja: "Actualizar compass/" cuando el schema o AGENTS.md quedaron viejos · Hecho

- [x] Lógica de `scompass update` en `hub/src/update.js`, compartida por la CLI y el hub
- [x] Ítem del menú visible solo si hay archivos viejos; se reevalúa al abrir el menú (AboutToShow)
- [x] Tests en un bus D-Bus privado

**Prueba:** Con `compass/schema/task.schema.json` viejo, el menú muestra "Actualizar compass/ (1 archivo)"; al tocarlo se copia el schema y el ítem desaparece.

**Notas:** Pedido al usar Epiphany. `startTray` ahora acepta `label` y `visible` como funciones y expone `refresh()` (emite LayoutUpdated). Los ids del menú son la posición + 1: Abrir 1, Actualizar 2, Reiniciar 3, Detener 4.

## M6 — Documentos y referencias (v2)  (12/12)

Visor de documentos del proyecto (GDD) y referencias estables entre tareas y secciones (§10).

**Hecho cuando:**
- Una tarea con `refs` muestra la sección renderizada en su detalle, con GDScript resaltado.
- Renombrar o renumerar una sección con id no rompe referencias.
- `scompass refs check` detecta referencias rotas.
- El dock muestra la sección referenciada en BBCode.

### 6.1 Parser de documentos e índice de secciones · Hecho

- [x] Índice `{id, title, level, start, end}`; una sección llega hasta el próximo título de nivel igual o superior
- [x] Id explícito (`<!-- id: … -->`) o slug del título, marcado como frágil
- [x] Documentos de `config.json › docs` (alias y ruta o patrón)
- [x] `scompass doc list` y `doc show <alias>#<id> [--raw]`

**Prueba:** `scompass --dir ../project-epiphany doc show gdd#ventanas-ataque --raw` devuelve justo esa sección.

**Notas:** `hub/src/docs.js`: índice de secciones (ignora bloques de código; ids explícitos o slug frágil; ids explícitos repetidos avisan), documentos por ruta o patrón, y refs resueltas por ruta (`gdd.md`) o alias (`gdd`). `scompass doc list` y `doc show alias#id [--raw|--json]`. Todas las refs de este repo resuelven contra `spec.md`.

**Referencias:** `docs/spec.md#ids-seccion`, `docs/spec.md#documentos-servidor`

### 6.2 Chequeo y edición de referencias · Hecho

- [x] `scompass refs check`: lista las rotas y sale con código ≠ 0
- [x] `scompass ref add <tarea> <alias>#<id>` (y quitar)
- [x] `scompass doc stamp-ids <alias>`: estampa ids en las secciones que no tienen

**Prueba:** Renombrar el título de una sección con id no rompe nada; borrar su id hace fallar `refs check`.

**Notas:** `refs check` (refs y enlaces `[[alias#id]]` en notas, prueba y pasos; lo que está entre `…` es un ejemplo y no cuenta; sale con 1 si hay rotas, avisa las frágiles), `ref add|rm` (guarda la ruta del documento, como las refs existentes) y `doc stamp-ids [--dry-run]` (estampa el slug actual, así las refs frágiles siguen resolviendo). Criterio: renombrar el título no rompe; borrar el id sí.

**Referencias:** `docs/spec.md#ids-seccion`, `docs/spec.md#referencias`

### 6.3 API de documentos y render · Hecho

- [x] `GET /api/docs`, `/api/docs/:alias`, `/api/docs/:alias/sections/:id` (con backlinks), `/api/refs/broken`
- [x] Markdown renderizado con GDScript resaltado, librerías empaquetadas (D21)
- [x] El watcher mira los documentos: evento `doc_changed`

**Prueba:** Editar `gdd.md` con el hub corriendo emite `doc_changed` en menos de 1 s.

**Notas:** `hub/src/docs-api.js` (`/api/docs`, `/api/docs/:alias`, `/sections/:id` con las tareas que la referencian, `/api/refs/broken`), `hub/src/render.js` (D21) y `hub/src/doc-watcher.js` (`doc_changed`, mira la carpeta de cada documento). Con Epiphany: backlinks de sus 12 refs y los bloques de GDScript resaltados.

**Referencias:** `docs/spec.md#documentos-servidor`, `docs/spec.md#cambios-externos`

### 6.4 UI web: referencias en el detalle · Hecho

- [x] Sección "Referencias" con cada sección renderizada y plegable, y "Abrir en el documento"
- [x] Buscador de secciones para agregar referencias; quitar
- [x] Indicador en la tarjeta y aviso si alguna está rota

**Prueba:** Una tarea con `refs` muestra la sección renderizada en su detalle, con GDScript resaltado.

**Notas:** Sección "Referencias" en el detalle: cada una plegable (la primera abierta), sección renderizada (sin repetir el título), "Abrir en el documento", quitar. Buscador por título o id para agregar. Rotas: aviso con "Buscar la sección nueva". Tarjetas: § n, en rojo si hay rotas.

**Referencias:** `docs/spec.md#documentos-ui`, `docs/spec.md#referencias`

### 6.5 UI web: vista Documentos · Hecho

- [x] Pestaña "Documentos" al lado de los hitos
- [x] Índice lateral y contenido renderizado
- [x] Junto a cada título, cuántas tareas lo referencian, con la lista

**Prueba:** Los backlinks de cada sección coinciden con las `refs` de las tareas.

**Notas:** Pestañas Tablero | Documentos con el hash (`#docs/gdd/ventanas-ataque`). Índice con punto verde y contador de tareas por sección (gris = sin planificar), documento renderizado, "Referenciada por" que sigue a la sección visible, contador de refs rotas y el botón para copiar `[[alias#id]]`. Backlinks calculados en el navegador. Al entrar a Documentos se cierra el detalle de la tarea (lo tapaba).

**Referencias:** `docs/spec.md#documentos-ui`

### 6.6 Enlaces en línea `[[alias#id]]` · Hecho

- [x] En notas, "Cómo probarlo" y pasos: enlace con el título actual de la sección
- [x] Rotos: marcados como tales

**Prueba:** `[[gdd#ventanas-ataque]]` en una nota se ve como "Ventanas de ataque" y abre la sección.

**Notas:** `rich()` convierte `[[alias#id]]` (fuera de `código`) en enlace con el título actual de la sección, o lo marca roto. En las tarjetas (botones) va como texto. Debajo de Notas y "Cómo probarlo" (textareas) se listan sus enlaces.

**Referencias:** `docs/spec.md#referencias`

### 6.7 Dock: referencias en BBCode · Hecho

- [x] `GET /api/docs/:alias/sections/:id?format=bbcode`
- [x] El detalle del dock lista las referencias y muestra la sección en un `RichTextLabel`

**Prueba:** El dock muestra la sección referenciada sin salir de Godot.

**Notas:** `?format=bbcode` en `/api/docs/:alias/sections/:id` (`renderBBCode`: títulos, listas, tablas simples, enlaces, corchetes escapados y GDScript coloreado con los tokens de Prism). El dock lista las refs de la tarea, plegables, con la sección en un RichTextLabel y "↗" a la UI web; sin hub, el markdown leído de disco (`compass_reader.read_docs`, mismo parser en GDScript). Una vez apareció en una captura con xvfb el aviso de "Iniciar hub" sin que nadie lo tocara; no se repitió en 4 corridas.

**Referencias:** `docs/spec.md#godot`, `docs/spec.md#documentos-servidor`

### 6.8 Migración de notas "§N.N" · Hecho

- [x] Detectar "`gdd.md` §N.N" en notas, pruebas y pasos
- [x] Proponer la referencia equivalente (sin aplicarla sola)

**Prueba:** En Epiphany, las notas con "§" dan propuestas revisables.

**Notas:** `scompass refs suggest` (`suggestRefs` en `docs.js`): cita "`gdd.md` §4.3" o "gdd §4.3" → la sección cuyo título empieza con ese número; marca las que ya son ref y da el `ref add` listo. `import artifact` avisa si hay por revisar. En Epiphany: sus 2 citas ya eran referencias.

**Referencias:** `docs/spec.md#migracion-notas`

### 6.9 Tests de M6 · Hecho

- [x] Criterios de §10.6
- [x] Con los documentos reales de Epiphany y de este repo

**Prueba:** `npm test` en `hub/` pasa con los tests de documentos.

**Notas:** Criterios de §10.6 cumplidos: tests de docs (parser, refs check, stamp-ids, suggest), API, UI (detalle, vista Documentos, enlaces, cambio de gdd.md medido: menos de 1 s en 3 ediciones seguidas, sección borrada marca la tarea en vivo) y dock (BBCode con y sin hub), con los documentos reales de Epiphany y de este repo.

**Referencias:** `docs/spec.md#criterios-v2`

### 6.10 Snippets del dock en CodeEdit con el resaltado del editor · Hecho

**Notas:** Pedido del usuario: los snippets en el dock se ven mejor en un CodeEdit. `?format=blocks` (texto en BBCode, código crudo); el dock usa `GDScriptSyntaxHighlighter` del editor (verificado en el editor: resaltado y fuente `EditorFonts/source`); fuera del editor, un CodeHighlighter básico.

### 6.11 UI web: "Cerrar" del buscador de referencias y panel de detalle redimensionable · Hecho

**Notas:** Reportado por el usuario. "Cerrar" no cerraba: el buscador abierto sin texto guarda "" y el toggle lo tomaba como cerrado. Panel: borde izquierdo arrastrable (y flechas, Shift = paso grande), entre 360 px y 90 % de la ventana, recordado en el navegador; doble clic vuelve a 460 px.

### 6.12 Pasos con texto corto y detalle desplegable · Hecho

**Notas:** Pedido del usuario: los pasos eran ambiguos cortos o demasiado largos para el dock. `checklist[].detail` opcional. Web: ▸ despliega, ✎ edita texto y detalle (vacío lo quita). Dock: ▸ debajo del checkbox. CLI: `step add|set|rm`, `show` con el detalle sangrado. Export md con el detalle sangrado (y `tools/artifact_to_md.py`, para seguir idénticos). Los enlaces del detalle cuentan en refs check, backlinks y refs suggest. `refs suggest` también reconoce "en el GDD (§4.3)".

## M7 — Hosting privado  (0/1)

El mismo hub en un servidor privado para usarlo desde el teléfono, con git como almacenamiento (§12).

**Hecho cuando:**
- Desde el teléfono se ve y se edita el tablero (PWA).
- Los cambios se commitean y se pushean solos, sin forzar nunca ante conflictos.
- El hub pide token y no queda expuesto a internet sin login.

### 7.1 Investigar: abrir el hub desde el teléfono por la LAN · Pendiente

**Prioridad:** media · **Etiquetas:** `investigacion`, `seguridad`

- [ ] Relevar el estado actual
  El hub escucha solo en 127.0.0.1 y sin auth (spec §servidor). createServer ya acepta un token, pero como header Authorization: Bearer, que el navegador del teléfono no puede mandar. Hoy funciona un túnel SSH desde el teléfono (Termux / Termius).
- [ ] Comparar opciones de acceso
  (a) --lan escuchando en la IP local + token por link que queda en cookie (y QR en la CLI); (b) auth de verdad: usuario/contraseña o passkey con sesión; (c) Tailscale (o similar) y seguir escuchando solo en la interfaz de la VPN; (d) reverse proxy con login delante (Caddy + basic auth, Cloudflare Access). Para cada una: seguridad en un wifi compartido, fricción en el teléfono, trabajo en el hub, si sirve también para el hosting de §12.
- [ ] Riesgos a cubrir
  HTTP sin TLS en la LAN (token o cookie viajan en claro), el WebSocket también autenticado, CSRF en la API de escritura, endpoints peligrosos (/api/shutdown, restart) que no deberían quedar expuestos, el Inicio (multi-hub) que proxea proyectos, y revocar el acceso.
- [ ] Probar en un teléfono real
  Android e iPhone si se puede: login, tiempo real por WebSocket, PWA instalable.
- [ ] Decisión
  Registrar en docs/decisiones.md la opción elegida y lo descartado; dejar las tareas de implementación en M7.

**Prueba:** Hay una decisión registrada con la comparación de opciones, y una prueba de concepto de la elegida abre el tablero desde el teléfono por el wifi sin que otro dispositivo de la red pueda entrar sin credenciales.

**Notas:** Pedido desde Project Epiphany (2026-10-10): ver el panel en el teléfono por el wifi de casa. Puede convenir auth de verdad en vez de un token suelto.

**Referencias:** `docs/spec.md#hosting`, `docs/spec.md#servidor`

## M8 — Inicio, listas y plantillas (v3)  (17/17)

Página de Inicio con todos los proyectos, listas con fecha límite y repetición, y plantillas de proyecto (§16). Local; el mirror always-on queda para M7.

**Hecho cuando:**
- El Inicio muestra todos los proyectos del equipo, con o sin hub, y los prende y apaga.
- Un proyecto creado con la plantilla personal abre en Listas, con fechas límite y repetición simple.
- Con el Inicio en la bandeja hay un solo ícono.

### 8.1 Registro persistente de proyectos · Hecho

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

- [x] Schema: `due` opcional, `YYYY-MM-DD` o con `THH:MM`
- [x] CLI: `add|set --due` y la fecha en `list` y `show`
- [x] Export md: `**Vence:**` debajo del título

**Prueba:** `scompass set <id> --due 2026-10-10` cambia una sola línea del JSON (más updated_at) y la fecha aparece en `list`, `show` y `docs/tareas.md`.

**Notas:** `hub/src/dates.js`: `parseDue`, `isValidDue` (también para las listas), `dueState` (overdue/today/later, hora local; sin hora vence al terminar el día). `list` marca "(vencida)" y "(hoy)" salvo en las hechas. La parte visual pasó a 8.13.

**Referencias:** `docs/spec.md#v3-fechas`

**Bloquea a:** 8.13 Fechas límite en la web y el dock

### 8.3 Listas: schema, Store y CLI · Hecho

- [x] `schema/list.schema.json` y `compass/lists/<id>.json`
- [x] Store: cargar, validar y escribir listas con etag
- [x] CLI: `lists`, `list-add`, `item add|check|rm`
- [x] Export md: una sección por lista

**Prueba:** `scompass item check pendientes 2` con y sin hub cambia una sola línea.

**Notas:** `schema/list.schema.json`, colección `lists` en el Store (crea la carpeta si falta), `hub/src/lists.js` (slug del id, `isValidDue`). CLI `lists` y `item` (incluye `item task`, que adelanta un paso de 8.4). Para que la CLI ande con hub hizo falta la API REST de listas (`/api/lists`): queda hecha acá; 8.4 suma la vista web. El watcher ya publica las listas; la web y el dock ignoran colecciones que no muestran. Export: sección "Listas" al final.

**Referencias:** `docs/spec.md#v3-listas`

**Bloquea a:** 8.4 Listas: API, WebSocket y vista en la web; 8.5 Repetición simple en ítems de lista; 8.7 Plantillas en `scompass init`

### 8.4 Listas: API, WebSocket y vista en la web · Hecho

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

- [x] `repeat: { every: day|week|month|year }`, requiere `due`
- [x] Tildar avanza `due` desde la fecha límite
  Fin de mes: 31/01 mensual pasa a 28/02 (o 29/02).
- [x] CLI `--repeat` y la repetición visible en la web

**Prueba:** Un ítem mensual con `due` 2026-01-31 pasa a 2026-02-28 al tildarlo; sigue sin tildar.

**Notas:** `nextDue` en `hub/src/dates.js`; `checkItem` en `hub/src/lists.js` (la van a usar la web y el Inicio, no solo la CLI). Schema: `repeat` con `dependentRequired` → `due`; `interval` todavía no se acepta. Destildar uno que se repite es un error. La parte visible en la web va con 8.4.

**Referencias:** `docs/spec.md#v3-fechas`

**Bloqueada por:** 8.3 Listas: schema, Store y CLI

### 8.6 `views` en `config.json` · Hecho

- [x] Schema de config: `views` con `board`, `lists`, `docs`
- [x] Sin `views`: las tres, tablero primero (`viewsOf` en `hub/src/views.js`)

**Prueba:** Con `views: [\"lists\", \"board\"]` el schema la acepta y `viewsOf` la devuelve; repetidas, vacía o desconocidas no validan.

**Notas:** `/api/config` devuelve la config tal cual: los clientes aplican el mismo default que `viewsOf`. Las pestañas de la web pasaron a 8.4.

**Referencias:** `docs/spec.md#v3-plantillas`

**Bloquea a:** 8.7 Plantillas en `scompass init`

### 8.7 Plantillas en `scompass init` · Hecho

- [x] `hub/templates/proyectos/juego|personal|vacio.json`: config y datos iniciales
- [x] `scompass init --template <nombre>`
- [x] La plantilla personal crea el hito General

**Prueba:** `scompass init --template personal --project Vida` en una carpeta vacía crea un proyecto que abre en Listas.

**Notas:** Las plantillas son JSON, no carpetas: más fáciles de revisar en un diff. `juego` crea `docs/gdd.md` solo si no existe. `init` anota el proyecto en el registro. El selector de plantilla del dock pasó a 8.14.

**Referencias:** `docs/spec.md#v3-plantillas`

**Bloquea a:** 8.14 Dock: "Crear compass/" con plantilla

**Bloqueada por:** 8.3 Listas: schema, Store y CLI; 8.6 `views` en `config.json`

### 8.8 `scompass home`: proceso y API · Hecho

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

- [x] Prender: `scompass serve --dir` como hijo del Inicio
- [x] Apagar: `SIGTERM` al pid del registro
- [x] Avisar antes de apagar un hub del dock

**Prueba:** Prender un proyecto apagado desde el Inicio y apagarlo; al cerrar el Inicio, los hubs que prendió mueren.

**Notas:** Los hijos van sin `--tray`: la bandeja agrupada del Inicio (8.11) los va a mostrar. El dock no cambió: el registro detecta que su hub está atado (`--exit-on-stdin-close`) y que su padre no es el Inicio.

**Referencias:** `docs/spec.md#v3-home`

**Bloqueada por:** 8.8 `scompass home`: proceso y API

### 8.10 UI del Inicio · Hecho

- [x] Franja Hoy: vencidos, hoy y en curso de todos los proyectos
- [x] Tarjetas: estado del hub, hito actual, lo próximo, sin commitear
- [x] Agregar proyecto: importar carpeta o crear con plantilla
- [x] Pantalla angosta (mockup del teléfono)

**Prueba:** Tildar "Pagar la luz" en Hoy cambia el JSON de la lista, con su hub prendido o apagado; un ítem que se repite avanza su fecha (tests de navegador en `hub/test/ui-home.test.js`).

**Notas:** `web/home.*`. Para crear proyectos hizo falta `/api/templates` y `/api/projects/init` (las plantillas pasaron a `hub/src/templates.js`). Un proyecto se marca Godot si tiene `project.godot`, y Personal si abre en Listas. Los cambios hechos sin hub (CLI directa, a mano) se ven al recargar o con el próximo evento: el Inicio no mira los archivos.

**Referencias:** `docs/spec.md#v3-home`

**Bloqueada por:** 8.8 `scompass home`: proceso y API

### 8.11 Bandeja agrupada en el Inicio · Hecho

- [x] El Inicio con `--tray` pone el único ícono
- [x] Los hubs con `--tray` lo esconden si hay un `home` vivo y lo vuelven a poner si muere
- [x] Menú: un submenú por hub (Abrir, Reiniciar, Detener), Abrir Inicio, Agregar proyecto
- [x] El submenú de cada hub incluye "Actualizar compass/" cuando hace falta

**Prueba:** `home --tray` con un hub con `--tray`: el hub quita su ícono, el Inicio lo muestra como submenú, y al cerrar el Inicio el hub vuelve a la bandeja (test en un bus D-Bus privado, con un hub).

**Notas:** `startTray` acepta submenús, separadores e ítems dinámicos (la lista de proyectos se arma al abrir el menú). El Inicio se anota con `tray: true` recién con el ícono puesto. Agregar proyecto… abre el Inicio (la UI de importar es 8.10).

**Referencias:** `docs/spec.md#v3-bandeja`

**Bloqueada por:** 8.8 `scompass home`: proceso y API

### 8.12 Tests de M8 y guía para agentes · Hecho

- [x] Tests de los criterios de §16.8
- [x] `AGENTS.md` (plantilla, addon y `compass/`) con listas, fechas y `home`
- [x] README y `compass/README.md`: editar listas a mano

**Prueba:** Los criterios de §16.8 tildados con su prueba.

**Notas:** `hub/test/m8-criteria.test.js` (un test por criterio de §16.8) y la bandeja con tres hubs en `tray.test.js`. El Inicio mira el registro cada 0,5 s (antes 1 s) para que un hub nuevo se vea en menos de 1 s. README, docs/instalar.md y el spec al día.

**Referencias:** `docs/spec.md#criterios-v3`

### 8.13 Fechas límite en la web y el dock · Hecho

- [x] Web: elegir y ver la fecha en el detalle; vencidas y de hoy marcadas en la tarjeta
- [x] Dock: mostrar la fecha y marcar las vencidas

**Prueba:** Una tarea con `due` de ayer se ve como vencida en la web y en el dock; al pasarla a Hecho deja de marcarse.

**Notas:** Web: `dueField` en el detalle (fecha, hora, Quitar) y `dueMark` en la tarjeta. Dock: `Board.due_state` y `show_due` (misma regla que `hub/src/dates.js`), la fecha en la columna derecha de la lista y una línea en el detalle; el dock no la edita.

**Referencias:** `docs/spec.md#v3-fechas`

**Bloqueada por:** 8.2 Fecha límite (`due`) en tareas

### 8.14 Dock: "Crear compass/" con plantilla · Hecho

- [x] Elegir juego, personal o vacío antes de crear (por defecto juego, porque es un proyecto de Godot)
- [x] Pasar `--template` a `scompass init`

**Prueba:** En un proyecto sin compass/, "Crear compass/" con la plantilla juego deja el hito M0, las dos listas y docs/gdd.md.

**Notas:** Un OptionButton al lado de "Crear compass/" (Juego, Personal, Vacío), visible solo sin compass/. Tests: plantilla juego por defecto (hito M0, listas y docs/gdd.md) y vacío sin datos.

**Bloqueada por:** 8.7 Plantillas en `scompass init`

### 8.15 Tablero: enlace "← Inicio" si el Inicio está corriendo · Hecho

- [x] `GET /api/home` en el hub (el Inicio del registro, o null)
- [x] Web: "← Inicio" arriba del título; se revisa cada 10 s y al volver a la pestaña

**Prueba:** Sin Inicio no aparece; con uno anotado en el registro, el enlace apunta a su puerto (hub/test/ui.test.js).

**Notas:** Pedido al usar el Inicio.

### 8.16 Bandeja del Inicio: el estado de los hubs prendidos desde la web no se actualizaba · Hecho

**Prueba:** Test en bus privado: hub prendido por la API del Inicio → LayoutUpdated, AboutToShow dice que cambió y el menú muestra el puerto.

**Notas:** Plasma pregunta AboutToShow antes de abrir el menú; si un refresh() ya había visto el cambio, respondía "no cambió" y Plasma mostraba su copia vieja. Ahora compara con la última revisión que el escritorio pidió (GetLayout), y refresh() manda también ItemsPropertiesUpdated.

### 8.17 Crear proyecto desde el Inicio: ~/.local/share/scope-compass/<nombre>, o elegir otra carpeta · Hecho

**Prueba:** "Vida dos" queda en …/scope-compass/Vida dos con .git; con el selector, en <elegida>/Mi juego (ui-home y home tests).

**Notas:** D28. `projectsDataDir`: `$SCOMPASS_DATA` o `$XDG_DATA_HOME/scope-compass`. El nombre es la carpeta, tal cual; si existe, 409. "Elegir otra carpeta…" usa `POST /api/pick-folder` (kdialog o zenity; `SCOMPASS_PICKER` en tests); sin selector, campo de texto.

## M9 — Inicio como app (multi-hub)  (10/10)

Con el Inicio corriendo, el Inicio sirve todos los proyectos en /p/<clave>/ con el código del hub: un puerto, sin esperas, todo editable (§17, D29).

**Hecho cuando:**
- Abrir un tablero desde el Inicio no cambia de puerto ni levanta procesos.
- Un solo proceso escribe cada compass/ (hub suelto o Inicio).
- El Inicio se reinicia y actualiza compass/ de cualquier proyecto sin hub.

### 9.1 Servidor del hub montable bajo una ruta · Hecho

- [x] La app de un hub expone lo que necesita su WebSocket (`app.hub`) y `attachSocket` se puede usar desde otra app
- [x] El hub suelto sigue igual: mismos tests

**Notas:** Fastify no deja agregar rutas ni plugins después de arrancar, así que montar cada proyecto como plugin impediría activarlos o importarlos con el Inicio corriendo. En su lugar: cada proyecto es una app de createServer sin listen; el Inicio le pasa los pedidos con inject() y atiende su WebSocket con attachSocket.

**Referencias:** `docs/spec.md#v4`

### 9.2 El Inicio sirve los proyectos en /p/<clave>/ · Hecho

- [x] Clave por proyecto (nombre de la carpeta, sin repetir)
- [x] Activar al primer pedido: store, watcher, export y WebSocket
- [x] Si hay un hub suelto del proyecto, reenviarle HTTP y WebSocket

**Prueba:** hub/test/home-serve.test.js: tablero, API con etag, POST con Location, WebSocket con watcher, y reenvío a un hub suelto.

**Notas:** `hub/src/home-serve.js`: `projectKeys`, rutas /p/:key, /p/:key/* (inject o fetch al hub suelto, Location con la base) y /p/:key/ws (attachSocket o puente). El plugin de WebSocket se registra una vez en la raíz del Inicio. /api/projects suma key, url y served. Falta que un hub suelto no arranque si el Inicio ya sirve el proyecto (9.3).

**Referencias:** `docs/spec.md#v4`

### 9.3 Registro: quién sirve cada proyecto · Hecho

- [x] El Inicio anota los proyectos que sirve con su base
- [x] hubsOf y detectHub entienden la base

**Notas:** `registerServed` / `unregisterServed`: <pid>-<clave>.json con kind "served" y base. hubsOf los incluye; el Inicio se excluye a sí mismo (standaloneOf) para no reenviarse ni apagarse. Sus escrituras (Hoy) usan el store del hub en memoria y publican como el hub.

**Referencias:** `docs/spec.md#v4`

### 9.4 CLI: usar la base del registro · Hecho

- [x] El store HTTP con la base
- [x] scompass hubs y home list muestran quién sirve cada proyecto

**Notas:** detectHub prueba cada entrada con su base: la URL del store HTTP ya la incluye. `serve` se niega si el Inicio sirve el proyecto; `hubs` lo muestra.

**Referencias:** `docs/spec.md#v4`

### 9.5 Dock: usar la base, e "Iniciar hub" delega en el Inicio · Hecho

- [x] Cliente HTTP y WebSocket con la base
- [x] Con el Inicio corriendo, "Iniciar hub" activa el proyecto en el Inicio

**Notas:** hub_client.gd: `base` y `registry_targets()` ([puerto, base]); `request_url`; `home_port()` (sin chequear el pid: Godot solo puede con sus hijos). start_hub: con el Inicio, POST /api/projects/activate (lo anota si hace falta) y se conecta a /p/<clave>; si falla, levanta su hub como antes.

**Referencias:** `docs/spec.md#v4`

### 9.6 Tablero web dentro del Inicio · Hecho

- [x] Llamadas relativas a su ruta
- [x] Barra superior compartida: volver al Inicio y cambiar de proyecto
- [x] Transiciones entre páginas (View Transitions)

**Notas:** app.js: BASE = la carpeta de la página ("/" o "/p/<clave>/"); IN_HOME muestra la barra con "← Inicio" y el selector (lista de /api/projects del Inicio). View Transitions en app.css y home.css. Chromium headless avisa "Transition was aborted… opt-in disabled" al cambiar de proyecto con el selector: la navegación anda; revisar en un navegador real.

**Referencias:** `docs/spec.md#v4`

### 9.7 Tarjetas, Hoy y bandeja apuntan a /p/… · Hecho

- [x] Abrir tablero dentro del Inicio
- [x] La bandeja: un submenú por proyecto sin prender ni apagar (salvo hubs sueltos)

**Notas:** Tarjetas: "Abrir tablero" → /p/<clave>/, etiqueta "abierto" o "hub suelto :puerto"; ya no hay Prender. Hoy enlaza al tablero. Bandeja: un submenú por proyecto (Abrir tablero, Actualizar compass/, y Detener hub suelto si hay uno).

**Referencias:** `docs/spec.md#v4`

### 9.8 Reiniciar el Inicio · Hecho

- [x] POST /api/restart del Inicio: vuelve en el mismo puerto
- [x] scompass home restart
- [x] "Reiniciar Inicio" en la bandeja

**Notas:** POST /api/restart del Inicio (onRestart), `scompass home restart` (espera el PID nuevo en el mismo puerto) y "Reiniciar Inicio" en la bandeja. Se relanza el mismo comando con --port fijo.

**Referencias:** `docs/spec.md#v4`

### 9.9 Actualizar compass/ desde el Inicio, sin hub · Hecho

- [x] POST /api/projects/update (schema y AGENTS.md)
- [x] Botón en la tarjeta cuando está desactualizado, y en la bandeja

**Notas:** POST /api/projects/update (updateCompass, sin hub); /api/projects trae `outdated`; la tarjeta muestra "compass/ desactualizado" con Actualizar. La bandeja ya lo tenía por proyecto.

**Referencias:** `docs/spec.md#v4`

### 9.10 Tests de M9, spec y guía · Hecho

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

- [x] El script `test` de package.json sin sintaxis de sh (un `node` que arma las variables)
- [x] registry.test: simular otro hub con un PID vivo de verdad, no PID 1 (en Windows se colgaba)
- [x] cli-hub.test: sin `sh -c`
- [x] export-md: saltar los tests de Python si no hay `python3` que ande (en Windows, `python3` es el alias de la Store)
- [x] Rutas absolutas esperadas con el separador del sistema (projects.test, home list)

**Notas:** Primera corrida en la VM (2026-10-06): 280 tests, 188 pasan, 54 fallan, 37 saltados. 41 fallas eran de Playwright sin navegador y 29 saltos, de que Node no lanza `godot.cmd` (resuelto en la VM con `godot.exe`). Hecho: `npm test` es `scripts/run-tests.js` (arma las variables en Node y borra la carpeta temporal al final); registry.test simula el otro hub con `process.ppid`; cli-hub.test sin `sh` en Windows; export-md salta sin Python (también el alias de la Store, que sale con 9009); home list acepta los dos separadores. Después de 10.1 y 10.2: 255 pasan; lo que falla es de 10.3, 10.4, 10.6 y 10.8.

**Referencias:** `docs/spec.md#windows`

### 10.2 Rutas relativas al proyecto siempre con / · Hecho

- [x] Documentos: path y alias con / (docs.js, config docs)
- [x] Avisos y errores del Store con rutas con /
- [x] Revisar export, watcher y refs que comparen rutas relativas

**Notas:** Las rutas dentro del proyecto son identificadores, como en git: siempre con `/`. Las absolutas, con el separador del sistema. Hecho: `rel()` de store/load.js (avisos del Store) y loadDocs (glob devuelve `\` en Windows, y el alias quedaba `docs/docs\audio`). El watcher de compass/ ya aceptaba los dos separadores y el de documentos usa basename, que también.

**Referencias:** `docs/spec.md#windows`

### 10.3 Carpetas de config, datos y registro en Windows · Hecho

- [x] Carpetas por plataforma en projects.js y registry.js
- [x] Ruta absoluta con isAbsolute; nombres de proyecto sin \ / : * ? " < > | ni nombres reservados
- [x] Mensajes y docs que nombran ~/.config muestran la ruta real

**Notas:** D23, D28 y el registro de hubs usaban solo XDG. Hecho: en Windows, proyectos conocidos en %APPDATA%\scope-compass, datos en %LOCALAPPDATA%\scope-compass y hubs vivos en %TEMP%\scope-compass\hubs (%TEMP% ya es de cada usuario; `userInfo().uid` es -1). Crear un proyecto valida la carpeta con `isAbsolute`. Los nombres de proyecto siguen la regla de Windows en las dos plataformas (sin \ / : * ? " < > |, sin CON/NUL/COM1…, sin punto al final), para que un proyecto de Linux se abra en Windows. La página del Inicio arma "Se crea en …" con el separador que manda /api/templates (`sep`). AGENTS.md y hub/README nombran la ruta de Windows.

**Referencias:** `docs/spec.md#windows`

### 10.4 Cerrar hubs e Inicio sin señales · Hecho

- [x] Cierre pedido por API/stdin en el Inicio (stop, apagar al cerrar); el del dock, en 10.8
- [x] windowsHide en spawn y execFile; restart con detached sin ventana
- [x] Tests de cierre que corran en las dos plataformas

**Notas:** En Windows Node no tiene SIGTERM: `kill` termina el proceso en seco, sin cerrar el servidor ni darse de baja. Hecho: `POST /api/shutdown` en el hub y en el Inicio (un proyecto servido por el Inicio lo rechaza con 400). El Inicio apaga a sus hijos cortándoles la entrada y a los demás hubs por la API; `kill` solo si en 3 s siguen vivos. `windowsHide` en todos los procesos que se lanzan (salvo el selector de carpetas, 10.6). Tests: cierre por API con código 0 (cli, tray, home-hubs, home-restart); SIGTERM solo en Linux. Encontrado: un hub reiniciado cuyo padre es Node (con la tubería 'pipe' directa) recibe fin de entrada al irse el viejo y se cierra, en Linux y en Windows; por eso el test usa cat (findstr en Windows). Con el dock (Godot de padre) se ve en 10.8. Con el Inicio de padre pasaría igual, pero desde D29 el Inicio no crea hubs.

**Referencias:** `docs/spec.md#windows`

### 10.5 Escritura atómica: reintentar el rename en Windows · Hecho

- [x] Reintento con espera corta en writeAtomic
- [x] Test que simula el destino ocupado

**Notas:** En Windows, `rename` sobre un archivo que otro proceso tiene abierto sin compartir (antivirus, indexador, un editor) falla con EPERM/EBUSY/EACCES. Hecho: `renameRetrying` en store/atomic.js, que usa writeAtomic (y con él el Store, projects.json, el export y doc stamp-ids): hasta 10 intentos con esperas que crecen (~1 s en total), solo en Windows; en Linux esos errores son de permisos y salen enseguida. Verificado en la VM con el destino abierto por PowerShell con FileShare None: sin reintento, EPERM al instante; con reintento, anda cuando lo suelta.

**Referencias:** `docs/spec.md#windows`

### 10.6 Navegador y selector de carpetas en Windows · Hecho

- [x] Abrir el navegador por plataforma (serve --open, home --open, bandeja)
- [x] Selector de carpetas con PowerShell
- [x] Selector falso de los tests que corra en Windows

**Notas:** Hecho: hub/src/desktop.js con openUrl (xdg-open; en Windows, explorer.exe) y pickFolder (kdialog o zenity; en Windows, el FolderBrowserDialog de Windows Forms desde PowerShell 5.1, sin dependencias). La carpeta inicial y el título van por variables de entorno y la elegida vuelve en UTF-8. PowerShell corre con windowsHide; un formulario dueño invisible y TopMost hace que el diálogo salga delante. SCOMPASS_OPEN y SCOMPASS_PICKER aceptan un .js (se corre con Node), así los tests andan en las dos plataformas. Verificado en el escritorio de la VM con una tarea programada interactiva: el diálogo se ve, en primer plano, sin consola, y la ruta con tilde vuelve intacta.

**Referencias:** `docs/spec.md#windows`

### 10.7 Bandeja en Windows con NotifyIcon · Hecho

- [x] Script de PowerShell: ícono, tooltip, menú con submenús, clics
- [x] tray.js elige D-Bus o PowerShell según la plataforma, con la misma interfaz
- [x] Ícono .ico generado del mismo dibujo
- [x] Test con el script real en Windows (sin hacer clic: menú y respuesta simulada)

**Notas:** D31. Hecho: tray.js elige por plataforma; tray-win.js lanza tray-win.ps1 (NotifyIcon de Windows Forms) con -EncodedCommand y windowsHide, y le habla en JSON por líneas: el hub manda ícono, tooltip y menú; PowerShell devuelve clics, clic en el ícono y "opening" (antes de abrir el menú, el hub lo reevalúa, como AboutToShow en D-Bus). stdin se lee sin bloquear con un Timer de la interfaz; si se corta (el hub se cerró o murió), saca el ícono y termina. tray-menu.js tiene lo compartido: buildMenu (lo usa también D-Bus) y el dibujo, más el .ico de 16 a 48 px armado en JS. Tests en la VM sin escritorio (dump e invoke de prueba): menú con submenús, tildes, ocultos y deshabilitados; clics por el handler real; refresh; cierre; home --tray; el hub muerto de golpe saca el ícono. Visto en el escritorio de la VM (captura): ícono en la bandeja y el menú como en Linux. Falta mirar en la máquina real el clic izquierdo en el ícono (abre el Inicio): 10.10.

**Referencias:** `docs/spec.md#windows`

### 10.8 Dock en Windows · Hecho

- [x] Encontrar y lanzar el hub sin sh
- [x] Vivo/cerrar con las APIs de Godot (cierre ordenado como en 10.4)
- [x] registry_dir igual que el hub
- [x] dock.test pasa en la VM con Godot 4.8

**Notas:** Hecho, solo la rama de Windows (Linux sigue con sh): scompass_command busca con `where` y del shim de `npm link` toma node_modules/scope-compass/bin/scompass.js; start_hub lanza node directo con `serve --log` (nueva opción: el hub agrega su salida al archivo, también un error que lo tire), con tubería (--exit-on-stdin-close) o con create_process en modo mantener; `pid_alive` usa tasklist (OS.is_process_running solo conoce los hijos y tras un reinicio el hub es nieto) y el último recurso es OS.kill; registry_dir en %TEMP% como Node; _same_path normaliza \ y mayúsculas. Tests: el runner usa pid_alive; dock.test saca el \r de las líneas de Godot en Windows (por eso "Node no avisó") y el log de modo mantener se mira por plataforma. dock.test 29/29 en la VM con Godot 4.8-dev7; suite completa en la VM sin fallas. Falta probar `where` con un `npm link` de verdad: 10.9.

**Referencias:** `docs/spec.md#windows`

### 10.9 Instalar en Windows · Hecho

- [x] Pasos de Windows en la guía de instalación
- [x] build.mjs corre en Windows
- [x] Probar la instalación desde el .tgz en la VM

**Notas:** Hecho: docs/instalar.md con Windows (Node y Git con winget, npm install -g desde PowerShell o cmd, scompass.cmd si PowerShell no deja correr scripts, dónde quedan los datos, sincronizar por git, nombres de proyecto). build.mjs corre en Windows: npm.cmd por la consola (sin comillas en el nombre: si no, el shim busca sus archivos en la carpeta actual) y el zip del addon con el tar.exe de Windows; el paquete sale sin scripts (postinstall solo sirve en el repo y npm reciente lo frena con un aviso). Probado en la VM: build, npm install -g del .tgz, scompass en PowerShell y cmd, home --tray instalado, y el dock encuentra el scompass global con where. Agregado: compass/.gitattributes (* text eol=lf), que init crea y update pone al día como el schema; en la VM, un proyecto de Linux clonado con core.autocrlf=true sale todo en CRLF sin él, y en LF con él. Encontrado con el scompass global: el dock corría `scompass update --check` con OS.execute y en Windows Node tarda ~0,5 s; el cuadro siguiente vencía en el acto los pedidos de 0,5 s al hub y el dock arrancaba sin hub. Ahora _scompass corre en otro hilo. Menor: Invoke-WebRequest -Method Post sin cuerpo manda un Content-Type de formulario y Fastify responde 415 en /api/shutdown (Node, curl y el dock no lo hacen).

**Referencias:** `docs/spec.md#windows`

### 10.10 Tests de M10, spec y guía · Pendiente

- [ ] Tests de los criterios de §18.1
- [ ] Suite completa en la VM
- [ ] Prueba en Windows en la máquina real (incluye Ctrl+C en la consola cierra ordenado el hub y el Inicio, y el clic izquierdo en el ícono abre el Inicio)
- [ ] AGENTS.md, README y spec al día
- [ ] Esperas de 3 s en los tests de UI que fallan a veces con la suite entera en la VM (fecha límite 8.13, listas «tildar, editar…»); solos pasan siempre
- [ ] Dock: _scompass deja un Thread vivo si el editor se cierra mientras corre scompass (aviso «Thread object is being destroyed» en godot --import); esperar el hilo en _exit_tree
  Se ve con godot --headless --path . --import: el plugin corre check_compass al abrir y el editor sale antes de que termine el hilo. Una vez el --import salió con error y tumbó toda la suite del dock.
- [ ] Los tests del dock aíslan el registro solos: node --test test/dock.test.js sin npm test usa el registro real y el Inicio del usuario sirve los proyectos temporales (y los anota en projects.json)

**Notas:** Criterios de §18.1. Al cerrar: suite completa en la VM, y una sesión real en la máquina con Windows (Inicio con bandeja, un proyecto sincronizado por git con Linux, dock en Godot). AGENTS.md (plantilla, copia del addon y compass/) con lo que cambie para Windows.

**Referencias:** `docs/spec.md#windows`

## M11 — Lista y filtros  (7/7)

Ver y encontrar tareas en un tablero grande: vista de lista y filtros en la UI web, con campos nuevos para filtrar.

**Hecho cuando:**
- La UI web tiene una vista de lista del tablero, compacta y ordenable por columna, que abre el mismo detalle.
- Tablero y lista se filtran por texto, estado, fecha límite, bloqueo, pasos pendientes, etiquetas, prioridad y responsable, y el filtro se recuerda.
- Las tareas tienen etiquetas, prioridad y responsable, editables desde la CLI y la web, y scompass list filtra por lo mismo.

### 11.1 Etiquetas, prioridad y responsable en el schema · Hecho

- [x] tags: lista de textos cortos; priority: high|medium|low; assignee: texto libre (persona o agente)
- [x] schema/task.schema.json y la copia de compass/schema (scompass update)
- [x] Validación en el store y la API, con tests
- [x] Decisión nueva en docs/decisiones.md y el modelo en la spec

### 11.2 CLI: editar los campos nuevos y filtrar scompass list · Hecho

- [x] add y set con --tags a,b --priority high --assignee nombre ("" quita)
- [x] show y list muestran etiquetas, prioridad y responsable
- [x] list filtra con --q, --status (varios), --due overdue|today|week|none, --blocked, --unblocked, --pending-steps, --tag, --priority, --assignee
- [x] Tests de la CLI

### 11.3 Export a markdown con los campos nuevos · Hecho

- [x] docs/tareas.md muestra etiquetas, prioridad y responsable de cada tarea
- [x] Test del export

### 11.4 Web: barra de filtros del tablero · Hecho

- [x] Texto (título y código, sin tildes ni mayúsculas), estado, fecha límite, bloqueadas o no, con pasos pendientes, con referencias
- [x] Etiquetas, prioridad y responsable, con los valores que existen en el tablero
- [x] Combinables con el hito; el filtro se recuerda por proyecto y se limpia con un botón
- [x] Los contadores del hito y el resumen dicen cuántas tareas quedan ocultas

### 11.5 Web: vista de lista · Hecho

- [x] Pestaña Tablero | Lista dentro de la vista del tablero; la elección se recuerda
- [x] Columnas: código, título, hito, estado, pasos x/y, fecha límite, bloqueo, prioridad, responsable, etiquetas
- [x] Ordenable por columna (orden natural del código por defecto); clic en la fila abre el mismo detalle
- [x] Usa los mismos filtros que el tablero; se ve bien en el teléfono

### 11.6 Web: editar etiquetas, prioridad y responsable en el detalle · Hecho

- [x] Prioridad y responsable en el detalle; etiquetas con sugerencias de las que ya existen
- [x] Marcas en la tarjeta del tablero (prioridad, etiquetas)

### 11.7 Tests de M11, spec y guía · Hecho

- [x] Tests de UI de la lista y los filtros
- [x] AGENTS.md (plantilla, copia del addon y compass/), README y spec al día

**Prueba:** npm test (hub/test/filters.test.js, ui-filters.test.js y los de schema, API y export)

## M12 — Biblioteca de documentos  (2/8)

Explorar los documentos del proyecto como una biblioteca de conocimiento: muchos archivos, enlaces a documentos enteros, búsqueda y el estado de git de cada uno.

**Hecho cuando:**
- Una tarea puede referenciar un documento entero (ref sin sección o `[[alias]]`), y refs check lo valida.
- Los documentos se agregan y quitan desde la CLI y la web sin editar config.json; la plantilla juego declara un glob de docs/.
- La web tiene una biblioteca: árbol por carpetas, búsqueda de texto en todos los documentos y, por documento, sus tareas y su estado de git.
- Cada documento muestra si tiene cambios sin commitear, su último commit y el diff contra HEAD.

### 12.1 Refs a un documento entero · Hecho

- [x] Schema: section opcional en refs (schema/, compass/schema/ y fixture de tests)
- [x] docs.js: resolveRef, LINK y checkRefs aceptan doc sin sección
- [x] CLI ref add|rm <tarea> <alias>[#<id>] y doc show <alias> sin sección
- [x] Backlinks a nivel documento en /api/docs y export md
- [x] Tests

**Prueba:** scompass ref add <tarea> gdd; refs check no lo marca roto; `[[gdd]]` en notas resuelve; borrar el archivo lo marca missing_doc.

**Notas:** Hoy refs exige doc y section. Se hace section opcional: una ref sin sección apunta al documento entero. En texto, `[[alias]]` sin #. Afecta resolveRef/checkRefs/suggestRefs, export md, ref add|rm y backlinks (docs-api).

### 12.8 Ordenar las tarjetas del tablero · Hecho

- [x] Columnas Actualizada y Creada en la lista (updated_at, created_at)
- [x] Selector de orden y sentido en la barra del tablero, compartido con la lista
- [x] renderBoard ordena cada columna con sortedForList
- [x] Arrastrar para reordenar solo con orden manual
- [x] Tests de UI

**Prueba:** Elegir Actualizada ▼: la tarea recién editada sube al tope de su columna, también al llegar el cambio por ws; volver a Manual restaura el orden y el arrastre.

**Notas:** Selector de orden en la barra del tablero: orden manual (el de hoy, order), código, actualizada, creada, fecha límite, prioridad y título, ascendente o descendente. Se ordena dentro de cada columna. Reusa COLUMNS/sortedForList de la vista de lista y el mismo S.sort, así tablero y lista comparten el orden; la lista suma las columnas Actualizada y Creada. Con un orden que no es el manual, arrastrar entre columnas sigue cambiando el estado pero no reordena (aviso en el tooltip). Se recuerda por proyecto como el filtro. Solo web: no toca datos. Hecho: AGENTS.md no cambia (es solo web, sin CLI ni datos).

### 12.2 Agregar y quitar documentos sin editar config.json · Pendiente

- [ ] CLI doc add / doc rm con validación de alias y ruta dentro del proyecto
- [ ] API POST/DELETE /api/docs que reescribe config.json
- [ ] loadDocs excluye export_md de los globs
- [ ] Plantilla juego con glob docs/**/*.md
- [ ] Tests
- [ ] Dock sin hub: compass_reader.read_docs expande los globs (hoy los saltea), con las mismas reglas que loadDocs

**Prueba:** doc add enemigos docs/enemigos.md lo muestra en doc list; un glob nuevo toma archivos creados después; init --template juego no lista tareas.md.

**Notas:** scompass doc add <alias> <ruta|glob> y doc rm <alias>; API POST/DELETE /api/docs que escribe config.json (atómico, con etag). La plantilla juego declara docs/**/*.md en vez de solo gdd.md; el glob excluye el export_md (docs/tareas.md) para no listarse a sí mismo.

### 12.3 Estado de git de los documentos · Pendiente

- [ ] git.js: docStatus (porcelain por ruta) y lastCommit (git log -1)
- [ ] git.js: docDiff contra HEAD y docLog con --follow
- [ ] API: git en /api/docs, GET /api/docs/:alias/diff y /log
- [ ] CLI doc status y doc diff <alias> [--json]
- [ ] El watcher avisa por ws cuando cambia el estado de un documento
- [ ] Tests (repo temporal; sin git devuelve repo: false)

**Prueba:** Modificar docs/gdd.md sin commitear: doc status lo marca modificado y doc diff gdd muestra el cambio; tras commitear vuelve a limpio con el commit nuevo.

**Notas:** Ampliar git.js: por documento, estado (sin cambios, modificado, nuevo sin seguir, borrado), último commit (hash corto, fecha, autor, asunto) y diff contra HEAD. Historial con git log --follow. Sin repo: los campos quedan vacíos, nada falla. Solo lectura: la app nunca commitea (spec §4.5).

### 12.4 Búsqueda de texto en los documentos · Pendiente

- [ ] docs.js: searchDocs(docs, q) → [{ alias, section, line, snippet }]
- [ ] API GET /api/docs/search?q=
- [ ] CLI doc search "<texto>" [--json]
- [ ] Tests

**Prueba:** scompass doc search slime encuentra la sección de enemigos.md con su fragmento; la API devuelve lo mismo.

**Notas:** Buscar en todos los documentos declarados, sin índice externo: recorrer las líneas ya cargadas. Cada resultado dice documento, sección y un fragmento. Sin tildes ni mayúsculas, como los filtros de M11.

### 12.5 Biblioteca en la web · Pendiente

- [ ] Árbol de documentos por carpeta con contadores de tareas
- [ ] Caja de búsqueda con resultados por documento y sección
- [ ] Ficha del documento: tareas, secciones sin tareas, estado de git
- [ ] Agregar / quitar documento desde la UI
- [ ] Detalle de tarea: refs a documento entero y `[[alias]]` en el texto

**Prueba:** Con 5+ documentos en carpetas: navegar el árbol, buscar un término y saltar a la sección, ver qué tareas referencian el documento.

**Notas:** La vista Docs pasa de un selector a un explorador: árbol por carpetas a la izquierda, búsqueda arriba y, por documento, ficha con secciones, tareas que lo referencian (a nivel documento y por sección) y estado de git. Resaltar documentos o secciones sin tareas (diseño sin planificar). Agregar y quitar documentos desde la UI.

### 12.6 Cambios y diff de documentos en la web · Pendiente

- [ ] Marca de modificado/nuevo en el árbol, en vivo por ws
- [ ] Vista de diff contra HEAD
- [ ] Historial de commits del documento
- [ ] Secciones tocadas por el diff y sus tareas

**Prueba:** Editar un documento con el hub abierto: aparece la marca sin recargar, el diff muestra el cambio y las tareas de esa sección quedan señaladas.

**Notas:** Marca en el árbol para documentos con cambios sin commitear. En la ficha: último commit, historial y el diff contra HEAD con líneas agregadas y quitadas. Marcar las secciones tocadas por el diff para ver qué tareas pueden quedar afectadas.

### 12.7 Tests de M12, spec y guía · Pendiente

- [ ] Tests de UI de la biblioteca y el diff
- [ ] Spec §20 y decisiones
- [ ] AGENTS.md (plantilla, copia del addon y compass/), README y spec al día

## M13 — UI más compacta  (2/7)

Llegar a las tareas sin bajar: tablero, detalle, teléfono y lista más compactos, según la revisión de diseño del 2026-10-09 (https://claude.ai/artifact/D6vMr2tWMv9dRCX8MUv5qg).

**Hecho cuando:**
- En escritorio a 1440×900 la primera tarjeta empieza antes de los 320 px; en el teléfono a 390×844, antes de los 450 px.
- En el detalle, los pasos aparecen sin bajar, con las propiedades en una fila de chips.
- El código de los documentos se ve sin ligaduras y las acciones de los pasos miden 36 px o más en el teléfono.

### 13.1 Bugs: ligaduras en el código y `[[alias]]` en M12 · Hecho

- [x] font-variant-ligatures: none en code y pre (web y Inicio)
- [x] Backticks alrededor de `[[alias]]` en compass/milestones/m12.json
- [x] Test de UI: code y pre sin ligaduras
  Las ligaduras de JetBrains Mono conservan el ancho de cada carácter: el ancho de != no cambia, así que el test mira font-variant-ligatures calculado.

**Prueba:** Un bloque de código con `<!-- id: x -->` y `!=` se ve tal cual; el resumen de M12 no muestra ⚠.

**Notas:** JetBrains Mono trae ligaduras: en la vista Documentos `<!-- id -->` se ve como flechas y `!=` como ≠. El "Hecho cuando" de M12 nombra `[[alias]]` sin backticks y desde la 12.1 se muestra como enlace roto.

### 13.2 Tablero: parte de arriba compacta · Pendiente

- [ ] Resumen del hito en una línea con "Hecho cuando" desplegable
- [ ] Chip "Terminados (n)" que agrupa los hitos hechos (el elegido siempre visible)
- [ ] Botón "Filtros (n)" con panel; Orden a la derecha
- [ ] Encabezado sin "tareas"
- [ ] Tests de UI (posición de la primera tarjeta, filtros desde el panel)

**Prueba:** A 1440×900 con M12 elegido la primera tarjeta empieza antes de los 320 px; los filtros y el orden siguen funcionando y recordándose.

**Notas:** Hoy la primera tarjeta empieza a ~580 px en escritorio. Resumen del hito en una línea (título, barra, contador y "Hecho cuando ▸" que despliega la lista, recordado por proyecto). Hitos terminados agrupados en "Terminados (n) ▾". "Orden" a la derecha de la fila del buscador; los 9 filtros detrás de un botón "Filtros (n)" que abre un panel. Sacar el "tareas" del encabezado.

### 13.3 Detalle: propiedades en chips y pasos arriba · Pendiente

- [ ] Fila de chips de propiedades con edición en el lugar
- [ ] Título sin borde en reposo
- [ ] Pasos, notas y referencias debajo del estado
- [ ] Tests de UI del detalle

**Prueba:** Al abrir una tarea a 1440×900 se ven los pasos sin bajar; cada propiedad se edita desde su chip y se guarda como hoy.

**Notas:** Hito, fecha, prioridad, responsable y etiquetas ocupan ~450 px antes de los pasos. Pasan a una fila de chips que se editan al hacer clic (vacíos en tono apagado). El título sin borde en reposo, con borde al enfocarlo.

### 13.4 Teléfono: menos filas antes de las tareas · Pendiente

- [ ] Hitos en una fila con scroll horizontal
- [ ] Columnas vacías de una línea
- [ ] Acciones de los pasos de 36 px en el teléfono, visibles al pasar el mouse en escritorio
- [ ] Cabecera del detalle: código del hito, sin el nombre
- [ ] Tests de UI a 390 px

**Prueba:** A 390×844 la primera tarjeta empieza antes de los 450 px, sin scroll horizontal de la página; ✎ y × miden 36 px o más.

**Notas:** A 390×844 la primera tarjeta aparece a ~1220 px. Hitos en una fila con scroll horizontal; columnas vacías de una línea; acciones de los pasos (✎ ×) de 36 px o más; la cabecera del detalle con solo el código del hito.

### 13.5 Lista: fechas relativas y columnas vacías · Pendiente

- [ ] Fechas relativas en Actualizada y Creada
- [ ] Columnas sin valores escondidas
- [ ] Tests de UI

**Prueba:** Con M11 elegido no aparecen las columnas vacías; una tarea editada recién dice "hace un momento".

**Notas:** Actualizada y Creada dicen todas "8 oct". Fecha relativa para lo reciente ("hace 3 h", "ayer") con la completa en el tooltip. Esconder las columnas sin ningún valor en lo que se está viendo (la de orden activo siempre visible).

### 13.6 Spec y guía de M13 · Pendiente

- [ ] Spec: sección de M13 con lo que cambió en la UI
- [ ] README de web/ al día

### 13.7 Bug: show muestra «doc#undefined» en referencias al documento entero · Hecho

**Prioridad:** baja · **Etiquetas:** `bug`, `cli`

- [x] Arreglar el formato en scompass show
  hub/src/cli.js:489 arma `${r.doc}#${r.section}` sin mirar si hay sección; una ref sin #id (ref add <tarea> gdd.md) sale como gdd.md#undefined. Usar el mismo criterio que export-md.js:50 (solo doc si no hay section).
- [x] Revisar la web y el dock
  Que el detalle de tarea en la UI y en el dock de Godot muestren bien una ref al documento entero.
- [x] Test
  show de una tarea con ref sin sección imprime solo el alias.

**Prueba:** scompass ref add <tarea> gdd.md y scompass show <tarea>: dice «Referencias: gdd.md», no «gdd.md#undefined»; lo mismo en la web.

**Notas:** Visto en Project Epiphany (m11-20) el 2026-10-10. Hecho: solo fallaba scompass show; la web y el dock ya separaban la ref sin sección (12.1).
