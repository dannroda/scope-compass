'use strict';
// Arranque del binario de scompass (Node SEA, armado por tools/build.mjs): no necesita Node instalado.
// El ejecutable trae, en el asset payload, el paquete entero (src, web, schema, templates, assets y node_modules de
// producción), comprimido. La primera vez que corre una versión lo extrae a una carpeta de caché y desde ahí carga
// src/main.js como en el paquete de npm: las rutas que el código arma con import.meta.url siguen siendo archivos
// de verdad (la web que sirve fastify, las plantillas que copia init, los íconos de la bandeja, tray-win.ps1).
// Se carga con require() y no con import(): en el script principal de un SEA, import() solo resuelve módulos
// internos de Node; require() de un módulo ES sí anda mientras no tenga await en el nivel superior.
const sea = require('node:sea');
const { createRequire } = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const meta = JSON.parse(sea.getAsset('meta.json', 'utf8'));

function cacheRoot() {
  if (process.env.SCOMPASS_RUNTIME_DIR) return process.env.SCOMPASS_RUNTIME_DIR;
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'scope-compass', 'runtime');
  }
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'scope-compass', 'runtime');
}

// payload: gzip de [largo del índice (uint32 LE)][índice JSON: [[ruta, bytes], …]][los archivos, uno detrás de otro].
function extract(dir) {
  const data = zlib.gunzipSync(Buffer.from(sea.getAsset('payload')));
  const len = data.readUInt32LE(0);
  const index = JSON.parse(data.subarray(4, 4 + len).toString('utf8'));
  // Se arma al lado y se renombra entero: otro scompass que arranque a la vez nunca ve una carpeta a medias.
  const tmp = `${dir}.tmp-${process.pid}`;
  fs.rmSync(tmp, { recursive: true, force: true });
  let at = 4 + len;
  for (const [rel, size] of index) {
    const file = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data.subarray(at, at + size));
    at += size;
  }
  fs.writeFileSync(path.join(tmp, '.complete'), meta.version);
  try {
    fs.renameSync(tmp, dir);
  } catch (e) {
    if (fs.existsSync(path.join(dir, '.complete'))) {
      // Otro proceso la extrajo primero: se usa la suya.
      fs.rmSync(tmp, { recursive: true, force: true });
      return;
    }
    // Una carpeta sin .complete no la deja nunca este código (solo aparece entera, por el rename): la tocó alguien
    // más. Se reemplaza.
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(tmp, dir);
  }
}

const dir = path.join(cacheRoot(), `${meta.version}-${meta.hash}`);
if (!fs.existsSync(path.join(dir, '.complete'))) {
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  extract(dir);
}

const { main } = createRequire(path.join(dir, 'package.json'))(path.join(dir, 'src', 'main.js'));
main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (e) => { console.error(e?.stack ?? e); process.exitCode = 1; },
);
