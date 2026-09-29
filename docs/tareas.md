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

## M2 — Hub: API REST + WebSocket  (0/8)

Servidor Fastify en `127.0.0.1` con la API de §5.2, el protocolo WebSocket de §5.5 y el watcher de cambios externos.

**Hecho cuando:**
- La CLI usa el hub cuando está corriendo y escribe directo cuando no.
- Una escritura con ETag viejo devuelve `409` con el documento actual.
- Editar un JSON a mano se emite por WebSocket en menos de 1 s.
- Un cliente WebSocket mínimo de test recibe `upsert` al mover una tarjeta.

### 2.1 Servidor Fastify y `scompass serve` · Pendiente

- [ ] Dependencias `fastify` y `@fastify/websocket` (D17)
- [ ] Escucha solo en `127.0.0.1`, puerto de `config.json` o `--port`
- [ ] `scompass serve [--port] [--open]`; sin `compass/` sugiere `scompass init`
- [ ] Errores `{error: {code, message}}` con los códigos del store
- [ ] Hook de autenticación por token, apagado en local
- [ ] `GET /api/health` con la versión y la ruta del proyecto

**Prueba:** `scompass serve` arranca, `curl 127.0.0.1:4711/api/health` responde, y no escucha en otras interfaces.

**Referencias:** `docs/spec.md#arranque`, `docs/spec.md#arquitectura`, `docs/spec.md#servidor`

### 2.2 API REST · Pendiente

- [ ] `GET/PUT/DELETE /api/milestones[/:id]`; `DELETE` rechaza con `409` si tiene tareas
- [ ] `GET /api/tasks?milestone=&status=`, `POST`, `PATCH`, `DELETE`
- [ ] Cabecera `ETag` en cada documento; `If-Match` en escrituras
- [ ] `409 conflict` con el documento actual; `invalid_file` como `409`
- [ ] `POST /api/export/markdown`

**Prueba:** Dos `PATCH` con el mismo `If-Match`: el segundo devuelve `409` con el documento actual.

**Referencias:** `docs/spec.md#api-rest`, `docs/spec.md#concurrencia`

### 2.3 Watcher de cambios externos · Pendiente

- [ ] `fs.watch` recursivo sobre `compass/` con debounce
- [ ] Ignora los temporales de `writeAtomic`
- [ ] Distingue escrituras propias de externas (sin eventos duplicados)
- [ ] Archivo inválido → aviso, no se cae el servidor

**Prueba:** Editar un JSON a mano con el hub corriendo emite el cambio en menos de 1 s; un JSON roto emite un aviso.

**Referencias:** `docs/spec.md#cambios-externos`, `docs/spec.md#validacion`

### 2.4 WebSocket · Pendiente

- [ ] `/ws` con `hello` al conectar
- [ ] `upsert`, `delete` y `warning` para escrituras de la API y cambios externos
- [ ] Mensajes del cliente: `update` → `ack` o `error` (con `conflict` y el documento)

**Prueba:** Un cliente WebSocket mínimo recibe `upsert` al mover una tarjeta por la API y por la CLI.

**Referencias:** `docs/spec.md#websocket`

### 2.5 La CLI usa el hub si está corriendo · Pendiente

- [ ] Detectar el hub en el puerto de la config (`/api/health` del mismo proyecto)
- [ ] Escrituras por la API cuando está; si no, directo al disco
- [ ] Mismos códigos de salida y la misma salida `--json` en los dos modos

**Prueba:** `scompass move` con el hub corriendo emite el evento por WebSocket; con el hub apagado escribe el archivo igual.

**Referencias:** `docs/spec.md#cli`

### 2.6 Export markdown desde el hub · Pendiente

- [ ] Regenerar `export_md` después de cada escritura de la API (D13)
- [ ] Debounce para ráfagas de cambios
- [ ] También tras cambios externos detectados por el watcher

**Prueba:** Mover una tarjeta desde la API actualiza `docs/tareas.md`.

**Referencias:** `docs/spec.md#cli`

### 2.7 Tests de M2 · Pendiente

- [ ] Criterios de §14 que necesitan servidor (sin UI)
- [ ] Escritura concurrente con ETag viejo → `409`
- [ ] JSON inválido con el hub corriendo → aviso, el servidor sigue

**Prueba:** `npm test` en `hub/` pasa, incluidos los tests con servidor.

**Referencias:** `docs/spec.md#criterios-v1`

### 2.8 `--etag` que exija que el documento no exista · Pendiente

- [ ] Valor especial (por ejemplo `--etag none`) que mapee a `ifMatch: null`
- [ ] Documentarlo en `--help` y en el spec §6

**Prueba:** `scompass set x --file t.json --etag none` falla con `conflict` si `x` ya existe.

**Notas:** Salió al cargar M2: `--etag ''` no expresaba "que no exista".

**Referencias:** `docs/spec.md#cli`

## M3 — UI web (port del artifact)

La UI del artifact servida por el hub: cliente de la API, WebSocket con reconexión, fuentes locales y las mejoras chicas de §7.

**Hecho cuando:**
- Paridad con el artifact (§2) en claro, oscuro y pantalla angosta.
- Dos pestañas abiertas se sincronizan en menos de 1 s.
- Funciona sin conexión a internet.

## M4 — Adopción en Project Epiphany

Project Epiphany deja el artifact y usa `compass/` + `scompass` a diario.

**Hecho cuando:**
- Epiphany tiene sus datos en `compass/` migrados con `scompass import artifact`.
- El artifact de Epiphany queda como archivo de solo lectura.
- Una semana de uso diario sin volver al artifact.

## M5 — Dock de Godot (v1.5)

Addon `scope_compass` con un dock que muestra las tareas del hito actual y las mueve a través del hub.

**Hecho cuando:**
- El dock funciona en Godot 4.8 (API de docks verificada).
- Mover una tarea desde el dock se ve en la UI web al instante, y al revés.
- Sin hub corriendo, el dock muestra las tareas leyendo `compass/` en solo lectura.

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
