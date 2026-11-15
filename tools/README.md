# tools

- `build.mjs`: arma en `dist/` el paquete de npm, el zip del addon y el binario de la plataforma donde corre (spec §35).
- `release.mjs`: los pasos de la release de GitHub (subir la versión, el CHANGELOG, las notas, la verificación de versiones y `SHA256SUMS`); lo usa `.github/workflows/release.yml` (spec §35.1).
- `sea-main.cjs`: el arranque del binario (extrae el paquete a la caché y lo carga).
- `install.sh`: instala `scompass` en Linux (el binario o el `.tgz`; `--dev`, el del repo) y el lanzador del menú.

El resto son prototipos en Python que se usaron antes de que exista el hub. El hub los reemplaza (`scompass export md`, `scompass import artifact`); quedan como referencia del formato esperado.

- `artifact_to_tablero.py <export> <destino>`: convierte el export del artifact (`ArtifactData` `list` con `out_dir`) al formato canónico de `compass/`.
- `artifact_to_md.py <datos> <salida.md> [--title "Proyecto"] [--board URL]`: genera el markdown legible desde una carpeta con `milestones/` y `tasks/` (sirve tanto el export del artifact como `compass/`).
- `validate.py [carpetas…] [--schema DIR]`: valida una o más carpetas `compass/` (por defecto `compass`) contra `schema/`: JSON Schema, formato canónico, marcadores de conflicto y tareas que apuntan a un hito inexistente. Se corre con `uv run tools/validate.py compass ../otro-proyecto/compass`; uv instala `jsonschema` solo para el script.
