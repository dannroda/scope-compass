# Instalar Scope Compass (build interna)

Scope Compass tiene dos partes: el **hub** (la CLI `scompass`, el servidor y la UI web) y el **addon de Godot** (el dock "Tablero"). El addon funciona solo para leer el tablero; para editarlo necesita el hub.

Se desarrolla en Linux y se prueba también en Windows 10/11 (D30). Los pasos son los mismos; donde cambian, está aclarado.

## Requisitos

- Node.js 22 o más nuevo (`node --version`). En Windows, el instalador de nodejs.org (o `winget install OpenJS.NodeJS.LTS`).
- Git (los datos viven en git). En Windows, `winget install Git.Git`.
- Godot 4.8 para el addon.
- Conexión a internet la primera vez: `npm` descarga las dependencias del hub.

## 1. Hub y CLI

```sh
npm install -g ./scope-compass-<versión>.tgz
scompass --help
```

El `./` importa: sin él, npm puede tomar la ruta como un repositorio de GitHub.

Eso deja `scompass` en el PATH, que es donde lo busca el addon. Si `npm install -g` pide permisos, usá un prefijo propio (`npm config set prefix ~/.local`) y asegurate de que `~/.local/bin` esté en el PATH.

En Windows, desde PowerShell o cmd: `npm install -g .\scope-compass-<versión>.tgz`. Queda en `%APPDATA%\npm`, que el instalador de Node ya pone en el PATH. Si PowerShell dice que la ejecución de scripts está deshabilitada, usá `scompass.cmd` en lugar de `scompass`, o habilitalos para tu usuario: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

Para actualizar, instalá el `.tgz` nuevo con el mismo comando. Para quitarlo: `npm uninstall -g scope-compass`.

## 2. Addon de Godot

1. Descomprimí `scope-compass-addon-<versión>.zip` en la raíz del proyecto de Godot: crea `addons/scope_compass/`.
2. En Godot: Proyecto › Configuración del proyecto › Plugins › activar **Scope Compass**.
3. El dock "Tablero" aparece junto al Inspector.

Si `scompass` no está en el PATH del editor, indicá su ruta en Editor Settings › `scope_compass/scompass_path`.

## 3. Primer uso en un proyecto

- Proyecto sin tablero: en el dock, **Crear compass/** con la plantilla Juego, Personal o Vacío (o `scompass init --template juego` en la raíz del proyecto).
- Para editar: **Iniciar hub** en el dock, o `scompass serve --open` en una terminal.
- Tareas y código (M15): una tarea cita los scripts y escenas que toca. Se agregan con **+ Vincular** en el dock (el script o la escena que estás editando), con **+ Agregar** en la sección Archivos del detalle web o con `scompass file add <tarea> <ruta>`. En el dock, un clic en el archivo lo abre en el editor y, arriba de la lista, aparecen las tareas del script o la escena abiertos.
- Todos los proyectos juntos: `scompass home --tray` levanta el Inicio, con un solo ícono en la bandeja (en Windows también: el área de notificación, junto al reloj). Sirve cada proyecto en `/p/<proyecto>/` sin procesos aparte; el dock y la CLI lo usan solos. `scompass home restart` (o "Reiniciar Inicio") carga una versión nueva.
- Varios proyectos a la vez: cada hub usa el puerto de su `compass/config.json` (4711 por defecto); si está ocupado, toma el siguiente libre solo.
- Tras actualizar Scope Compass: reiniciá los hubs que estuvieran corriendo (`scompass restart`, o "Reiniciar hub" en el dock); el dock y la CLI avisan si el hub es de otra versión.
- Tras actualizar Scope Compass: si el dock avisa que `compass/` tiene archivos de una versión anterior, **Actualizar** (o `scompass update`, o "Actualizar compass/" en la bandeja).

## Windows

- Dónde quedan las cosas: la lista de proyectos del Inicio en `%APPDATA%\scope-compass\projects.json`; los proyectos creados desde el Inicio, en `%LOCALAPPDATA%\scope-compass`; el registro de hubs vivos, en `%TEMP%\scope-compass`.
- Un mismo proyecto en Linux y en Windows: se sincroniza con git (push en uno, pull en el otro), no con una partición compartida. Los JSON de `compass/` usan LF en las dos plataformas (`.gitattributes`).
- Los nombres de proyecto no pueden tener `\ / : * ? " < > |` ni ser `CON`, `NUL` y similares, tampoco en Linux, para que el mismo proyecto se abra en los dos sistemas.

## Para agentes de IA

La guía del tablero está en `addons/scope_compass/AGENTS.md` y en `compass/AGENTS.md`. Para que un agente la use, agregá al `AGENTS.md` o `CLAUDE.md` del proyecto:

> El tablero de tareas se maneja con scompass; leé compass/AGENTS.md antes de tocarlo.

## Si se publica el proyecto antes que Scope Compass

Agregá `addons/scope_compass` (sin barra final) al `.gitignore` del proyecto, y no commitees `project.godot` con el plugin activado.
