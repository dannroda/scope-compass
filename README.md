# Scope Compass

Organizador de proyectos de videojuegos: tablero de tareas por hito, con los datos en git. Una app local (CLI `scompass` + hub + UI web) y un dock para el editor de Godot los hacen cómodos de usar, pero nunca son el único lugar donde viven.

**Estado:** la CLI `scompass` funciona (M1): leer, crear, mover y tildar tareas, exportar markdown e importar desde el artifact. Falta el hub (M2) y la UI web (M3). Nació del tablero en artifact de [Project Epiphany](../project-epiphany), que es su primer usuario. Por ahora es **Linux primero** (D15).

## Documentación

| Qué | Dónde |
|---|---|
| Spec completo (qué, cómo, criterios de aceptación) | [`docs/spec.md`](docs/spec.md) |
| Decisiones tomadas y por qué | [`docs/decisiones.md`](docs/decisiones.md) |
| Plan de implementación (datos, fuente de verdad) | [`compass/`](compass/), con `scompass list` |
| Plan en versión legible (generado) | [`docs/tareas.md`](docs/tareas.md) |
| Tablero en artifact original (archivado, solo lectura) | https://claude.ai/artifact/JAiu8ZznTSLcDk8EzU3Zaj |
| Mockups (web, teléfono, dock de Godot) | https://claude.ai/artifact/6QSijARPwJtsRd1t6wJGJ9 |
| Código del artifact original | [`docs/reference/tablero-artifact.html`](docs/reference/tablero-artifact.html) |

## Principios

1. **Los datos viven en git; la app es opcional.** Un archivo JSON por hito y por tarea, en `compass/` dentro de cada proyecto. Se leen y editan a mano (ver [`compass/README.md`](compass/README.md)).
2. **Local primero.** El hub escucha en `127.0.0.1`. El hosting privado para el teléfono viene después y usa git como almacenamiento.
3. **Personas, agentes y el editor por igual.** UI web para personas, CLI con `--json` para agentes, WebSocket para el dock de Godot.

## Estructura

```
docs/                  spec, decisiones, export del plan, referencias
schema/                JSON Schemas de hito y tarea
hub/                   paquete Node: servidor + CLI scompass (M1–M2)
web/                   UI del tablero, sin build step (M3)
addons/scope_compass/  plugin de Godot: dock (M5)
tools/                 prototipos en Python (export md, import del artifact)
compass/               el tablero de Scope Compass mismo
project.godot          el repo se abre en Godot para editarlo desde el editor
```

## Trabajar desde Godot

El repo es un proyecto de Godot 4.8 para poder editar todo sin salir del editor y desarrollar el addon ahí mismo:

1. Abrir `project.godot` en Godot.
2. En *Editor Settings › Docks › FileSystem › TextFile Extensions*, agregar `js,html,css,json,md`.
3. `compass/` no aparece en el FileSystem a propósito (tiene `.gdignore`).
