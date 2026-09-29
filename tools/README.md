# tools

Prototipos en Python que se usaron antes de que exista el hub. El hub los reemplaza (`scompass export md`, `scompass import artifact`); quedan como referencia del formato esperado.

- `artifact_to_tablero.py <export> <destino>`: convierte el export del artifact (`ArtifactData` `list` con `out_dir`) al formato canónico de `compass/`.
- `artifact_to_md.py <datos> <salida.md> [--title "Proyecto"] [--board URL]`: genera el markdown legible desde una carpeta con `milestones/` y `tasks/` (sirve tanto el export del artifact como `compass/`).
- `validate.py [carpetas…] [--schema DIR]`: valida una o más carpetas `compass/` (por defecto `compass`) contra `schema/`: JSON Schema, formato canónico, marcadores de conflicto y tareas que apuntan a un hito inexistente. Se corre con `uv run tools/validate.py compass ../project-epiphany/compass`; uv instala `jsonschema` solo para el script.
