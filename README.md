# Scope Compass

Organizador de proyectos de videojuegos: tablero de tareas por hito, con los datos en git. Una app local (CLI `scompass` + hub + UI web) y un dock para el editor de Godot los hacen cómodos de usar, pero nunca son el único lugar donde viven.

**Estado:** v1 (M1–M3), el dock de Godot (M5), v2 (M6), v3 (M8: Inicio, listas y plantillas) y v4 (M9: el Inicio como app, multi-hub), M11 (vista de lista y filtros del tablero, con etiquetas, prioridad y responsable), M12 (biblioteca de documentos: carpetas, búsqueda y estado de git), M13 (UI más compacta), M14 (pestaña Archivos: los archivos del repo y su estado de git) y M15 (tareas con archivos del repo, que el dock abre en el editor) completos: la CLI `scompass`, el hub (`scompass serve`, API REST y WebSocket en `127.0.0.1`), la UI web del tablero en vivo, el dock "Tablero" en el editor, los documentos del proyecto (GDD) con referencias estables desde las tareas, y el Inicio (`scompass home`) con todos los proyectos del equipo, listas con fecha límite y repetición, y plantillas para crear proyectos de juego o personales. Se abre con `node hub/bin/scompass.js home --tray` (o `scompass home --tray` con `npm link`): el Inicio sirve todos los proyectos en un solo puerto, cada tablero en `/p/<proyecto>/` (D29). Sin el Inicio, un proyecto se abre solo con `scompass serve --open`. Project Epiphany ya usa `compass/` como fuente de verdad (M4, en su semana de prueba). Nació del tablero en artifact de [Project Epiphany](../project-epiphany), que es su primer usuario. Por ahora es **Linux primero** (D15).

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
2. **Local primero.** El hub escucha en `127.0.0.1`. Con `--lan` se abre desde el teléfono en la red de casa, sin login (D36). El hosting privado viene después y usa git como almacenamiento.
3. **Personas, agentes y el editor por igual.** UI web para personas, CLI con `--json` y un servidor MCP para agentes, WebSocket para el dock de Godot. La web trae un chat con el Claude Code instalado (solo en el mismo equipo, D43).

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

## Build interna

`node tools/build.mjs` deja en `dist/` el paquete del hub (`scope-compass-<versión>.tgz`, con la CLI, la UI web y los schemas), el zip del addon de Godot y `INSTALAR.md` con los pasos ([docs/instalar.md](docs/instalar.md)). La versión sale de `hub/package.json` y tiene que coincidir con la de `addons/scope_compass/plugin.cfg`.
