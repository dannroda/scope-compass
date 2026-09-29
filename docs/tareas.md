# Tareas — Scope Compass

> Copia local del tablero https://claude.ai/artifact/JAiu8ZznTSLcDk8EzU3Zaj. El tablero es la fuente de verdad; este archivo se regenera desde ahí.
> Generado: 2026-09-29

## M0 — Fundaciones del repo  (2/6)

Repo inicializado con el spec ordenado, las decisiones registradas, los schemas, el tablero propio y la estructura base. Se abre en Godot.

**Hecho cuando:**
- El repo está en GitHub (`dannroda/scope-compass`).
- Se abre en Godot 4.8 sin errores y el addon stub se activa.
- Las decisiones abiertas del spec están resueltas o con fecha para decidir.

### 0.1 Estructura base del repo · Revisión

- [x] Carpetas `docs/`, `schema/`, `hub/`, `web/`, `addons/scope_compass/`, `tools/`, `compass/`
- [x] `README.md` en la raíz y en cada carpeta sin código
- [x] `.gitignore`, `.gitattributes`, `.editorconfig`
- [x] `project.godot` mínimo
- [x] `hub/package.json` con el `postinstall` que crea `node_modules/.gdignore`
- [x] Primer commit y remoto `origin`
- [ ] Push a GitHub

**Prueba:** `git ls-files` muestra la estructura de `docs/spec.md` §9.

**Referencias:** `docs/spec.md#estructura-repo`

### 0.2 Spec y decisiones · Hecho

- [x] Spec ordenado: nombre Scope Compass, rutas de referencias, `compass/` visible, estructura del repo
- [x] Ids de sección estampados en `docs/spec.md`
- [x] `docs/decisiones.md` con D1–D9

**Notas:** Razonamiento de cada decisión en `docs/decisiones.md`.

**Referencias:** `docs/spec.md#objetivo`

### 0.3 Schemas · En curso

- [x] `schema/milestone.schema.json` y `schema/task.schema.json`
- [x] Copia en `compass/schema/`
- [ ] `schema/config.schema.json` para `compass/config.json`
- [ ] Validar los datos existentes contra los schemas

**Prueba:** Los JSON de `compass/` y de `project-epiphany/compass/` validan contra `schema/`.

**Referencias:** `docs/spec.md#validacion`

### 0.4 Decisiones abiertas · Pendiente

- [ ] Licencia del repo (hoy `UNLICENSED` en `hub/package.json`)
- [ ] Versión mínima de Node
- [ ] ¿Editar hitos desde la UI en v1 o solo por CLI?
- [ ] ¿Export markdown automático en cada cambio o a pedido?

**Notas:** Cada decisión tomada se agrega a `docs/decisiones.md`.

**Referencias:** `docs/spec.md#decisiones-abiertas`

### 0.5 Abrir el repo en Godot · Pendiente

- [ ] Abre en Godot 4.8 sin errores
- [ ] El addon `scope_compass` se activa
- [ ] Editor Settings › TextFile Extensions incluye `js,html,css,json,md`
- [ ] `compass/` no aparece en el FileSystem (`.gdignore`)

**Prueba:** Abrir `../scope-compass` en Godot 4.8, activar el addon y editar `hub/README.md` desde el editor.

**Referencias:** `docs/spec.md#godot`

### 0.6 Tablero y documentación propios · Hecho

- [x] Tablero en artifact con los hitos M0–M7
- [x] Copia en `compass/` en formato canónico
- [x] `docs/tareas.md` generado

**Notas:** Mientras no exista la app, el tablero vive en el artifact y `compass/` es su copia en git.

## M1 — Store + CLI (sin servidor)  (0/7)

Leer y escribir `compass/` con validación, formato canónico y ETag, desde la CLI `scompass`, sin hub corriendo.

**Hecho cuando:**
- `scompass import artifact` migra los datos de Project Epiphany sin diferencias.
- `list`, `show`, `add`, `move`, `check` y `export md` funcionan sin servidor.
- `export md` produce lo mismo que `tools/artifact_to_md.py`.
- Un JSON inválido o con marcadores de conflicto se reporta y nunca se sobrescribe.

### 1.1 Formato canónico y escritura atómica · Pendiente

- [ ] Serializador canónico: claves ordenadas, 2 espacios, UTF-8, salto de línea final
- [ ] Escritura atómica: archivo temporal + rename
- [ ] Tests de ida y vuelta (leer → escribir → mismo contenido)

**Prueba:** Reescribir un archivo editado a mano no cambia su contenido, solo el formato.

**Referencias:** `docs/spec.md#sin-app`, `docs/spec.md#concurrencia`

### 1.2 Validación · Pendiente

- [ ] Cargar los schemas de `schema/`
- [ ] Elegir validador de JSON Schema
- [ ] Archivo inválido → aviso, no se carga ni se sobrescribe
- [ ] Detectar marcadores de conflicto de git

**Prueba:** Un archivo con un campo desconocido o con `<<<<<<<` se reporta y queda sin tocar.

**Notas:** El validador (por ejemplo ajv) es una dependencia nueva: anotarla en `docs/decisiones.md`.

**Referencias:** `docs/spec.md#validacion`, `docs/spec.md#git-merges`

### 1.3 Store json-files + ETag · Pendiente

- [ ] Interfaz `Store` (list, get, put, patch, delete)
- [ ] Implementación `json-files` sobre `compass/`
- [ ] ETag = hash del contenido canónico; conflicto con el documento actual
- [ ] Ids nuevos: 8 caracteres base36

**Prueba:** Dos escrituras con el mismo ETag: la segunda falla con conflicto y devuelve el documento actual.

**Referencias:** `docs/spec.md#modelo`, `docs/spec.md#concurrencia`, `docs/spec.md#arquitectura`

### 1.4 CLI básica · Pendiente

- [ ] `init`: crea `compass/` con schemas, README, `.gdignore` y `config.json`
- [ ] `list` y `show` con `--json`
- [ ] `add`, `move`, `check`
- [ ] `set` y `milestone set` con `--file`
- [ ] `--dir` para apuntar a otro proyecto

**Prueba:** `scompass --dir ../project-epiphany list --json` lista las tareas de Epiphany.

**Referencias:** `docs/spec.md#cli`

### 1.5 Export markdown · Pendiente

- [ ] Port de `tools/artifact_to_md.py`
- [ ] `scompass export md [--out]`
- [ ] Título y URL del tablero desde `config.json`

**Prueba:** Para los mismos datos, la salida es idéntica a `tools/artifact_to_md.py` (salvo la fecha).

**Referencias:** `docs/spec.md#cli`

### 1.6 Import desde el artifact · Pendiente

- [ ] Port de `tools/artifact_to_tablero.py`
- [ ] Descarta `version`; `created_at` = `updated_at` si existe
- [ ] Reporte de conteos

**Prueba:** Importar el export de Epiphany: 11 hitos y 10 tareas, sin diferencias con `project-epiphany/compass/`.

**Referencias:** `docs/spec.md#migracion`

### 1.7 Tests de M1 · Pendiente

- [ ] Criterios de §14 que no necesitan servidor
- [ ] Mover una tarjeta cambia exactamente un archivo y una línea (más `updated_at`)

**Prueba:** `npm test` en `hub/` pasa.

**Referencias:** `docs/spec.md#criterios-v1`

## M2 — Hub: API REST + WebSocket

Servidor Fastify en `127.0.0.1` con la API de §5.2, el protocolo WebSocket de §5.5 y el watcher de cambios externos.

**Hecho cuando:**
- La CLI usa el hub cuando está corriendo y escribe directo cuando no.
- Una escritura con ETag viejo devuelve `409` con el documento actual.
- Editar un JSON a mano se emite por WebSocket en menos de 1 s.
- Un cliente WebSocket mínimo de test recibe `upsert` al mover una tarjeta.

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
