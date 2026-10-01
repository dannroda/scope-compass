# compass — datos del tablero

Estos archivos **son** las tareas del proyecto, en el formato de [Scope Compass](https://github.com/dannroda/scope-compass). Se pueden leer, editar y versionar solo con git y un editor de texto; ninguna app es obligatoria.

- `milestones/<id>.json`: un hito (`m00` = M0, …).
- `tasks/<id>.json`: una tarea. El nombre del archivo es su id.
- `schema/`: JSON Schema de cada tipo y de `config.json`, para validar una edición a mano.
- `config.json`: nombre del proyecto, documentos referenciables, export markdown, puerto del hub.
- `.gdignore`: hace que Godot ignore esta carpeta.
- `AGENTS.md`: guía del tablero para agentes de IA (se regenera con `scompass agents`).

Con la CLI: `scompass list`, `scompass show <id>`, `scompass move <id> doing`, `scompass --help`.

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
