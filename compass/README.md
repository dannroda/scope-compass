# compass — datos del tablero

Estos archivos **son** las tareas de Scope Compass. Se pueden leer, editar y versionar solo con git y un editor de texto; ninguna app es obligatoria. Es el mismo formato que Scope Compass usa en cualquier proyecto.

- `milestones/<id>.json`: un hito (`m00` = M0, …).
- `tasks/<id>.json`: una tarea. El nombre del archivo es su id.
- `schema/`: JSON Schema de cada tipo y de `config.json`, para validar una edición a mano (copia de `../schema/`). Desde la raíz: `uv run tools/validate.py`.
- `config.json`: nombre del proyecto, documentos referenciables, export markdown, puerto del hub.
- `.gdignore`: hace que Godot ignore esta carpeta.

## Estado actual

**Esta carpeta es la fuente de verdad** desde el 2026-09-29 (D16). Se edita con `scompass` (`node hub/bin/scompass.js`, o `scompass` después de `npm link` en `hub/`) o a mano, y los cambios se commitean como cualquier otro archivo. `scompass` regenera `docs/tareas.md` en cada escritura; si editás a mano, corré `scompass export md`.

El tablero en artifact (https://claude.ai/artifact/JAiu8ZznTSLcDk8EzU3Zaj) quedó archivado: no se sincroniza y sus datos pueden estar viejos.

## Manejo sin la app

| Quiero… | Qué hacer |
|---|---|
| Ver las tareas | Abrir `docs/tareas.md` (último export legible) o los JSON de `tasks/` |
| Mover una tarjeta | Cambiar `"status"` a `"todo"`, `"doing"`, `"review"` o `"done"` |
| Tildar un paso | Cambiar `"done": false` a `true` en `checklist` |
| Crear una tarea | Copiar un JSON de `tasks/` con otro nombre de archivo y editarlo |
| Borrar una tarea | Borrar el archivo |
| Ver el historial de una tarea | `git log -p compass/tasks/<id>.json` |
| Recuperar algo borrado | `git checkout <commit> -- compass/tasks/<id>.json` |

## Formato

- JSON con 2 espacios de indentación, claves en orden alfabético, UTF-8, salto de línea al final.
- Los archivos no guardan número de versión: no hay nada que incrementar al editar a mano.
- `updated_at` es opcional en ediciones a mano.
- En los textos, `` `así` `` se muestra como código.
- `refs` apunta a secciones de documentos por su id estable (`<!-- id: ... -->` debajo de cada título).
