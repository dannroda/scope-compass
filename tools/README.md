# tools

- `build.mjs`: arma en `dist/` el paquete de npm, el zip del addon y el binario de la plataforma donde corre (spec §35).
- `release.mjs`: los pasos de la release de GitHub (subir la versión, el CHANGELOG, las notas, la verificación de versiones y `SHA256SUMS`); lo usa `.github/workflows/release.yml` (spec §35.1).
- `sea-main.cjs`: el arranque del binario (extrae el paquete a la caché y lo carga).
- `i18n.mjs check|sync [área…]`: los textos de la interfaz que faltan traducir, sobran o no coinciden en los catálogos (`hub/locales/en/*.po`, `addons/scope_compass/i18n/en.po`); `sync` agrega los nuevos (spec §45).
- `screenshots.mjs [es] [en] [--only board,phone,home,playtest,decisions,dock] [--keep]`: las capturas de `docs/images/<es|en>/` a 1920×1200 (m32-08). Arma tres proyectos de ejemplo con la CLI en `<tmp>/scompass-demo` (registro, configuración y datos propios: no aparece ningún proyecto del usuario), levanta sus hubs y el Inicio, y saca las de la web con Playwright; la del dock abre el editor de Godot en Xvfb (`xvfb-run`; `GODOT=<binario>`). El alt y el epígrafe de cada una están en `docs/images/captions.json`.
- `install.sh`: instala `scompass` en Linux y el lanzador del menú. Sin argumento baja el binario de la release más nueva (se corre con `curl … | sh`; `SCOMPASS_CHANNEL=beta` incluye las pre-releases); con un binario o un `.tgz`, instala ese; `--dev`, el del repo. No va en la release (D63).
- `make-ico.mjs`: arma `hub/assets/icons/scope-compass.ico` (la bandeja de Windows y el acceso directo de `install.ps1`) desde el SVG del ícono, dibujado en el Chromium de Playwright. Se corre solo si cambia el SVG.
- `make-banner.mjs`: arma la imagen de cabecera de los README, `docs/images/<idioma>/banner.png` (el ícono, el nombre y qué es, con los colores y las fuentes del tema oscuro de la web), en el Chromium de Playwright. Se corre solo si cambian el ícono o el texto.
- `install.ps1`: instala el binario en Windows, sin permisos de administrador: `%LOCALAPPDATA%\Programs\scompass`, el PATH del usuario y el acceso directo del menú Inicio; `-Uninstall` lo quita. Como `install.sh`, baja la release (`irm … | iex`) o instala el `.exe` que se le pasa. Sin BOM y sin caracteres que en ANSI se vuelvan comillas (lo revisa `release.test.js`).

El resto son prototipos en Python que se usaron antes de que exista el hub. El hub los reemplaza (`scompass export md`, `scompass import artifact`); quedan como referencia del formato esperado.

- `artifact_to_tablero.py <export> <destino>`: convierte el export del artifact (`ArtifactData` `list` con `out_dir`) al formato canónico de `compass/`.
- `artifact_to_md.py <datos> <salida.md> [--title "Proyecto"] [--board URL]`: genera el markdown legible desde una carpeta con `milestones/` y `tasks/` (sirve tanto el export del artifact como `compass/`).
- `validate.py [carpetas…] [--schema DIR]`: valida una o más carpetas `compass/` (por defecto `compass`) contra `schema/`: JSON Schema, formato canónico, marcadores de conflicto y tareas que apuntan a un hito inexistente. Se corre con `uv run tools/validate.py compass ../otro-proyecto/compass`; uv instala `jsonschema` solo para el script.
