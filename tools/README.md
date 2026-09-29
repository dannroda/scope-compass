# tools

Prototipos en Python que se usaron antes de que exista el hub. El hub los reemplaza (`scompass export md`, `scompass import artifact`); quedan como referencia del formato esperado.

- `artifact_to_tablero.py <export> <destino>`: convierte el export del artifact (`ArtifactData` `list` con `out_dir`) al formato canónico de `compass/`.
- `artifact_to_md.py <datos> <salida.md> [--title "Proyecto"] [--board URL]`: genera el markdown legible desde una carpeta con `milestones/` y `tasks/` (sirve tanto el export del artifact como `compass/`).
