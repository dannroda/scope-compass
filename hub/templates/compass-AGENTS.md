# Tablero del proyecto — guía para agentes

Las tareas y los hitos de este proyecto viven en `compass/`, en el formato de Scope Compass. Esta guía alcanza para operar el tablero; no hace falta leer el código de Scope Compass.

## Reglas

- **Usá la CLI `scompass`, no edites los JSON a mano.** Valida, escribe en formato canónico, regenera el export markdown y, si hay un hub corriendo, avisa al instante a la UI web y al dock de Godot.
- Corré los comandos desde cualquier carpeta del proyecto (busca `compass/` hacia arriba) o con `--dir <proyecto>`.
- Si `scompass` no está en el PATH: `node <carpeta de scope-compass>/hub/bin/scompass.js`.
- Agregá `--json` para leer la salida desde un programa. Código de salida 0 si anduvo; el error va por stderr.
- No hace falta que el hub esté corriendo: sin hub, la CLI escribe directo en `compass/`.
- Los cambios quedan como archivos modificados en `compass/` (y en el export markdown). Commitealos solo si te lo piden.

## Modelo

- **Hito** (`compass/milestones/<id>.json`): id `m00`, `m01`, …; campos `code` ("M0"), `title`, `order`, `goal`, `done_when`.
- **Tarea** (`compass/tasks/<id>.json`): el id es el nombre del archivo. `scompass add` asigna uno al azar (por ejemplo `sd3tg577`) y lo imprime; las tareas viejas pueden tener ids como `m5-02`. No se renombra. Campos:
  - `milestone` (id del hito), `title`, `code` (número visible, por ejemplo "5.2"; opcional);
  - `status`: `todo` (Pendiente), `doing` (En curso), `review` (Revisión), `done` (Hecho);
  - `checklist`: pasos `{ text, done, detail? }`. `text` es una línea corta; el cómo y el porqué van en `detail`;
  - `test`: cómo se comprueba que la tarea está terminada;
  - `notes`: notas libres;
  - `refs`: secciones de documentos del proyecto que la tarea cita.
- En los textos, `` `así` `` se muestra como código.

## Leer

```sh
scompass milestone list                      # hitos, en orden
scompass list                                # todas las tareas, por hito
scompass list --milestone m05 --status doing # filtros (se pueden combinar)
scompass list --json                         # { "tasks": [ { "id", "etag", "title", "status", "checklist", … } ] }
scompass show m5-02                          # una tarea, con los pasos numerados desde 1
scompass show m5-02 --json
```

## Escribir

```sh
scompass add "Título de la tarea" --milestone m05 --code 5.9   # imprime el id nuevo
scompass move m5-02 doing                                     # todo | doing | review | done
scompass set m5-02 --title "…" --notes "…" --test "…"          # cambia solo esos campos
scompass step add m5-02 "Paso corto" --detail "Cómo y por qué"
scompass step set m5-02 2 --text "…" --detail "…"              # --detail "" quita el detalle
scompass step rm m5-02 2
scompass check m5-02 2                                        # tilda el paso 2
scompass check m5-02 2 --undo
scompass set m5-02 --file tarea.json                          # reemplazo completo (--file - lee stdin)
scompass milestone set m08 --file hito.json                   # crea o reemplaza un hito
```

- Los pasos se numeran desde 1, como los muestra `scompass show`.
- Para no pisar un cambio ajeno, pasá `--etag <etag>` (el que devuelve `--json`): si la tarea cambió, falla con conflicto. Volvé a leerla y reintentá.
- Una tarea se borra borrando su archivo en `compass/tasks/`.

## Uso habitual

- Al empezar una tarea: `scompass move <id> doing`. A medida que avanzás, `scompass check <id> <n>`.
- Al terminar: completá `test` si está vacío, dejá en `notes` lo que el siguiente necesite saber y pasala a `review` (o a `done` si ya se comprobó).
- Trabajo nuevo que aparece en el camino: `scompass add` en el hito que corresponda, en lugar de dejarlo solo en el chat.

## Documentos y referencias

Los documentos citables están en `compass/config.json` › `docs` (alias y ruta). Una referencia apunta a una sección por su id estable (`<!-- id: … -->` debajo del título).

```sh
scompass doc list                  # documentos con su índice de secciones
scompass doc show spec#godot --raw # el markdown de una sección
scompass ref add m5-02 spec#godot  # la tarea cita esa sección
scompass ref rm m5-02 spec#godot
scompass refs check                # referencias rotas (sale con 1 si hay)
```

## Más

- `scompass --help`: todos los comandos.
- `compass/README.md`: formato de los archivos y manejo a mano con git.
- `compass/schema/`: JSON Schema de tareas, hitos y `config.json`.
