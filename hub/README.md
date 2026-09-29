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
src/export-md.js     port de ../tools/artifact_to_md.py
src/import-artifact.js  port de ../tools/artifact_to_tablero.py
test/                node:test
```

`npm install` crea `node_modules/.gdignore` (script `postinstall`) para que Godot no escanee las dependencias. `npm install <paquete>` no lo corre: después de agregar una dependencia, correr `npm install` sin argumentos.
