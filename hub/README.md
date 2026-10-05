# hub

Paquete Node de Scope Compass: el servidor (API REST + WebSocket + UI web) y la CLI `scompass`.

El diseño está en `../docs/spec.md` (§3, §5, §6, §9) y el plan en el tablero del repo (hitos M1 y M2).

Estructura prevista:

```
bin/scompass.js      CLI
src/server.js        Fastify: API REST, WebSocket, estáticos (sirve ../web)
src/store/           interfaz Store + json-files.js
src/docs/            interfaz DocSource (v2)
src/schema.js        carga ../schema
src/registry.js      hubs vivos ($XDG_RUNTIME_DIR/scope-compass/hubs)
src/projects.js      proyectos conocidos (~/.config/scope-compass/projects.json, D23)
src/export-md.js     port de ../tools/artifact_to_md.py
src/import-artifact.js  port de ../tools/artifact_to_tablero.py
test/                node:test
```

`npm install` crea `node_modules/.gdignore` (script `postinstall`) para que Godot no escanee las dependencias. `npm install <paquete>` no lo corre: después de agregar una dependencia, correr `npm install` sin argumentos.

## CLI

```
cd hub && npm install && npm link     # deja `scompass` en el PATH
scompass --help
scompass list                          # desde cualquier carpeta dentro de un proyecto con compass/
scompass --dir ../project-epiphany list --json
scompass home list                     # proyectos conocidos en este equipo y el estado de su hub
```

Los tests usan un registro, una config y una carpeta de datos propios (`SCOMPASS_REGISTRY`, `SCOMPASS_CONFIG`, `SCOMPASS_DATA` en `npm test`): correrlos con `npm test`, no con `node --test` a secas, para no tocar `~/.config/scope-compass/` ni `~/.local/share/scope-compass/`.

Sin `npm link`: `node hub/bin/scompass.js …`. Por ahora escribe siempre directo en `compass/`; cuando exista el hub (M2), usará la API si está corriendo.

## Tests

`npm test` en `hub/`. Los tests que escriben usan `test/fixtures/compass/`, una copia congelada del tablero, para no depender del estado real de `compass/`. Los que comprueban propiedades de los datos reales (formato canónico, carga sin avisos, export idéntico a `tools/`) leen `../compass/` y `../../project-epiphany/compass/` si existe.

Los tests del dock (`test/dock.test.js`) lanzan Godot sin ventana con `test/godot/runner.gd`; se saltean si no hay `godot` en el PATH. Para ver el dock sin abrir el editor: `xvfb-run -a godot --path .. --script res://hub/test/godot/shot.gd -- <proyecto> <salida.png> [tarea]`.
