# Instalar Scope Compass (build interna)

Scope Compass tiene dos partes: el **hub** (la CLI `scompass`, el servidor y la UI web) y el **addon de Godot** (el dock "Tablero"). El addon funciona solo para leer el tablero; para editarlo necesita el hub.

Se desarrolla en Linux y se prueba también en Windows 10/11 (D30). Los pasos son los mismos; donde cambian, está aclarado.

## Requisitos

- Con el binario (`scompass-v<versión>-linux-x64` o `-windows-x64.exe`), nada más: trae su propio Node. Con el `.tgz`, Node.js 22 o más nuevo (`node --version`; en Windows, el instalador de nodejs.org o `winget install OpenJS.NodeJS.LTS`).
- Git (los datos viven en git). En Windows, `winget install Git.Git`.
- Godot 4.8 para el addon.
- Con el `.tgz`, conexión a internet la primera vez: `npm` descarga las dependencias del hub.
- Para el chat de la web (opcional): Claude Code instalado (`npm i -g @anthropic-ai/claude-code`) y con tu login (correr `claude` una vez). Lo busca en el PATH; si está en otro lado, `SCOMPASS_CLAUDE=<ruta>` al levantar el hub o el Inicio.

## 1. Hub y CLI

### Con el binario (sin Node)

Poné el binario en una carpeta del PATH con el nombre `scompass` (`scompass.exe` en Windows). En Linux, `sh install.sh` al lado del binario lo copia a `~/.local/bin/scompass` y deja **Scope Compass** en el menú de aplicaciones (ver abajo). La primera vez que corre una versión extrae su contenido (unos 30 MB) a `~/.cache/scope-compass/runtime/` (`%LOCALAPPDATA%\scope-compass\runtime\` en Windows); `SCOMPASS_RUNTIME_DIR` cambia esa carpeta. Para actualizar, reemplazá el binario.

### Con el paquete de npm

```sh
npm install -g ./scope-compass-<versión>.tgz
scompass --help
```

El `./` importa: sin él, npm puede tomar la ruta como un repositorio de GitHub.

Eso deja `scompass` en el PATH, que es donde lo busca el addon. Si `npm install -g` pide permisos, usá un prefijo propio (`npm config set prefix ~/.local`) y asegurate de que `~/.local/bin` esté en el PATH.

En Windows, desde PowerShell o cmd: `npm install -g .\scope-compass-<versión>.tgz`. Queda en `%APPDATA%\npm`, que el instalador de Node ya pone en el PATH. Si PowerShell dice que la ejecución de scripts está deshabilitada, usá `scompass.cmd` en lugar de `scompass`, o habilitalos para tu usuario: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

En Linux, `sh install.sh` (al lado del binario o del `.tgz`; prefiere el binario) instala `scompass` y además deja **Scope Compass** en el menú de aplicaciones: levanta el Inicio con ícono en la bandeja y lo abre en el navegador. El acceso desde el teléfono se prende y apaga desde la bandeja ("Activar acceso en la red"). Para desarrollar, `tools/install.sh --dev` en el repo: `scompass` en `~/.local/bin` corre el `hub/bin/scompass.js` del repo, sin empaquetar.

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
- Desde el teléfono, en casa: `scompass home --tray --lan`. Con la bandeja, "Activar acceso en la red" lo reinicia con `--lan` y el ítem pasa a mostrar la dirección. Escribe en qué dirección abrirlo (`http://192.168.x.x:4700/`). No hay login: cualquiera en esa red puede ver y editar, así que solo en una red de confianza (D36). Con un firewall, hay que abrir el puerto. En Windows, la primera vez pregunta si deja a Node usar la red: sí, en redes privadas.
- Chat con Claude Code: el botón **Chat** del tablero abre un panel a la izquierda. Corre el `claude` instalado en la carpeta del proyecto, con tu cuenta y tu configuración: lee y escribe el tablero (el MCP `scompass`) y lee los archivos (`Read`, `Grep`, `Glob`), pero no edita ni corre comandos, porque la web no puede aprobar permisos; eso sigue en la terminal. Con una tarea abierta, la manda como contexto. Solo aparece en el mismo equipo (`127.0.0.1`), también con `--lan`, porque no hay login y el chat usa tu cuenta y lee el repo (D43). Cada conversación es una sesión de Claude Code: se puede seguir en la terminal con `claude --resume <id>`.
- Cuentas en el chat: el panel dice con qué cuenta habla (email, organización, plan), el uso de las ventanas de 5 horas y de la semana (con cuándo se renuevan; se actualiza con cada respuesta) y los tokens y el costo estimado de cada respuesta. Si tenés varios perfiles de Claude Code (carpetas con su propio login que se usan con `CLAUDE_CONFIG_DIR`), ponelos en `~/.claude-profiles/<nombre>/` y el panel deja elegir uno al empezar una conversación; sin elegir, usa `~/.claude`. `SCOMPASS_CLAUDE_PROFILES=<carpeta>` busca los perfiles en otro lado. Para entrar o cambiar de cuenta: `claude auth login` (con el `CLAUDE_CONFIG_DIR` del perfil) en la terminal.
- Varios proyectos a la vez: cada hub usa el puerto de su `compass/config.json` (4711 por defecto); si está ocupado, toma el siguiente libre solo.
- Tras actualizar Scope Compass: reiniciá los hubs que estuvieran corriendo (`scompass restart`, o "Reiniciar hub" en el dock); el dock y la CLI avisan si el hub es de otra versión.
- Tras actualizar Scope Compass: si el dock avisa que `compass/` tiene archivos de una versión anterior, **Actualizar** (o `scompass update`, o "Actualizar compass/" en la bandeja).

## Windows

- Dónde quedan las cosas: la lista de proyectos del Inicio en `%APPDATA%\scope-compass\projects.json` (y las conversaciones del chat al lado, en `chats\`); los proyectos creados desde el Inicio, en `%LOCALAPPDATA%\scope-compass`; el registro de hubs vivos, en `%TEMP%\scope-compass`.
- Un mismo proyecto en Linux y en Windows: se sincroniza con git (push en uno, pull en el otro), no con una partición compartida. Los JSON de `compass/` usan LF en las dos plataformas (`.gitattributes`).
- El chat busca `claude.exe` o `claude.cmd` en el PATH.
- Los nombres de proyecto no pueden tener `\ / : * ? " < > |` ni ser `CON`, `NUL` y similares, tampoco en Linux, para que el mismo proyecto se abra en los dos sistemas.

## Para agentes de IA

La guía del tablero está en `addons/scope_compass/AGENTS.md` y en `compass/AGENTS.md`. Para que un agente la use, agregá al `AGENTS.md` o `CLAUDE.md` del proyecto:

> El tablero de tareas se maneja con scompass; leé compass/AGENTS.md antes de tocarlo.

## Los tableros, en la carpeta del usuario

Los tableros no van en el repo del proyecto (spec §36): `scompass init` (y "Crear compass/" del dock y del Inicio) los crea en `~/.local/share/scope-compass/boards/<nombre>/` (`%LOCALAPPDATA%\scope-compass\boards\` en Windows), y `compass/` queda como un enlace (junction en Windows) fuera del git del proyecto (`.git/info/exclude`).

Para versionarlos, una de dos:

- Un repo para todos los tableros: antes de crear el primero, `git init ~/.local/share/scope-compass/boards` (o clonar ahí tu repo de tableros), y opcionalmente `git -C ~/.local/share/scope-compass/boards remote add origin <url-de-un-repo-privado>`. Cada tablero es una subcarpeta.
- Un repo por tablero: si la carpeta de tableros no es un repo, cada tablero nuevo tiene su propio `git init`; el remoto se agrega con `git -C compass remote add origin <url>`.

Un tablero de antes, dentro del proyecto:

```sh
scompass board move              # lo saca a la carpeta de tableros, con su historial
git commit -m "Saco el tablero"  # en el proyecto: la baja de compass/ quedó en el índice
```

Con el repo de todos los tableros, el historial entra en un commit en ese repo; lo sin commitear queda sin commitear. En otro equipo: clonar el repo de tableros (o el del tablero) en la carpeta de tableros y `scompass board link <nombre>` en el proyecto. Para compartir un tablero con otros, en lugar del enlace: `git submodule add <url> compass`. Antes de `board move`, detené el hub del proyecto y el Inicio.

## Si se publica el proyecto antes que Scope Compass

Agregá `addons/scope_compass` (sin barra final) al `.gitignore` del proyecto, y no commitees `project.godot` con el plugin activado.
