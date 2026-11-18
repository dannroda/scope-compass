# Instalar Scope Compass

Scope Compass tiene dos partes: el **hub** (la CLI `scompass`, el servidor y la UI web) y el **addon de Godot** (el dock "Tablero"). El addon funciona solo para leer el tablero; para editarlo necesita el hub.

Se desarrolla en Linux y se prueba también en Windows 10/11 (D30). Los pasos son los mismos; donde cambian, está aclarado.

## Descargas

Todo está en la última release: https://github.com/dannroda/scope-compass/releases/latest. Los archivos llevan la versión con una `v` adelante:

- `scompass-v<versión>-linux-x64`: el hub y la CLI para Linux, en un solo binario.
- `scompass-v<versión>-windows-x64.exe`: lo mismo para Windows.
- `scope-compass-addon-v<versión>.zip`: el addon de Godot.
- `install.sh` e `install.ps1`: los instaladores del binario para Linux y Windows (opcionales, ver abajo).
- `SHA256SUMS`: las sumas SHA-256 de los archivos. Para comprobar lo descargado: `sha256sum -c SHA256SUMS --ignore-missing` en Linux; en Windows, `Get-FileHash <archivo>` en PowerShell y comparar con la línea del archivo.

## Requisitos

- Linux o Windows 10/11, x64.
- Con el binario, nada más: trae su propio Node. Con el paquete de npm (`.tgz`, ver abajo), Node.js 22 o más nuevo (`node --version`; en Windows, el instalador de nodejs.org o `winget install OpenJS.NodeJS.LTS`).
- Git (los datos viven en git). En Windows, `winget install Git.Git`.
- Godot 4.8 para el addon.
- Con el `.tgz`, conexión a internet la primera vez: `npm` descarga las dependencias del hub.
- Para el chat de la web (opcional): Claude Code instalado (`npm i -g @anthropic-ai/claude-code`) y con tu login (correr `claude` una vez). Lo busca en el PATH; si está en otro lado, `SCOMPASS_CLAUDE=<ruta>` al levantar el hub o el Inicio. También anda con Antigravity CLI (`agy`, con tu login de Google; correr `agy` una vez): se elige en Ajustes › *Agente del chat*, y `SCOMPASS_AGY=<ruta>` si no está en el PATH. Con agy, el hub crea `~/.gemini/scope-compass-chat/` con ajustes propios del chat (sin modo automático y con permisos estrictos), para que cada edición y cada comando le pidan permiso y el hub los niegue; ahí quedan también sus conversaciones, y se puede borrar.

## 1. Hub y CLI

### Con el binario (recomendado)

No hace falta ponerlo en el PATH: cada vez que corre anota su ruta en `~/.local/share/scope-compass/scompass.json` (`%LOCALAPPDATA%\scope-compass\scompass.json` en Windows), y de ahí lo toman el addon de Godot y `scompass mcp install` (spec §37). Basta con abrirlo una vez; con doble clic levanta el Inicio. El PATH sirve para escribir `scompass` en una terminal.

- **Linux:** `sh install.sh scompass-v<versión>-linux-x64` (el `install.sh` está en `tools/` del repo; sin argumento, toma el binario más nuevo que tenga al lado) lo copia a `~/.local/bin/scompass` y deja **Scope Compass** en el menú de aplicaciones: levanta el Inicio con ícono en la bandeja y lo abre en el navegador. El acceso desde el teléfono se prende y apaga desde la bandeja ("Activar acceso en la red"). Sin el script: `install -m 755 scompass-v<versión>-linux-x64 ~/.local/bin/scompass`, con `~/.local/bin` en el PATH.
- **Windows, instalado:** con `install.ps1` al lado del binario, desde PowerShell: `powershell -ExecutionPolicy Bypass -File install.ps1 scompass-v<versión>-windows-x64.exe` (sin argumento, toma el binario más nuevo que tenga al lado). Lo copia a `%LOCALAPPDATA%\Programs\scompass\scompass.exe`, suma esa carpeta al PATH de tu usuario (en las consolas que abras después) y deja **Scope Compass** en el menú Inicio, que levanta el Inicio con ícono en la bandeja y lo abre en el navegador. No pide permisos de administrador. Para actualizar, `scompass upgrade` (o **Actualizar** en el Inicio), o correlo con el binario nuevo: anda aunque el Inicio esté abierto, que sigue con la versión anterior hasta `scompass home restart`. Si en el PATH hay otro `scompass` antes (por ejemplo, uno de npm), avisa. `install.ps1 -Uninstall` saca el binario, el acceso directo y la entrada del PATH; los tableros no se tocan.
- **Windows, portable:** renombralo a `scompass.exe`, ponelo en una carpeta propia (por ejemplo `%LOCALAPPDATA%\Programs\scompass`, o un pendrive) y abrilo una vez. Si lo movés, abrilo otra vez en el lugar nuevo (y `scompass update` en los proyectos, para el merge driver de git). Para usarlo desde una terminal, agregá esa carpeta al PATH de tu usuario (Configuración › Sistema › Información › Configuración avanzada del sistema › Variables de entorno).

La primera vez que corre una versión extrae su contenido (unos 30 MB) a `~/.cache/scope-compass/runtime/` (`%LOCALAPPDATA%\scope-compass\runtime\` en Windows); `SCOMPASS_RUNTIME_DIR` cambia esa carpeta. Para actualizar: `scompass upgrade` baja la versión más nueva de GitHub, la verifica con `SHA256SUMS` y reemplaza el binario (`--check` solo avisa; `--pre` incluye las pre-releases, que también siguen sin `--pre` si la que tenés es una). El Inicio lo consulta una vez por día y, si hay una nueva, lo ofrece arriba de la página y en la bandeja (**Actualizar a la …**). El Inicio y los hubs que ya corren siguen con la versión anterior hasta reiniciarse (`scompass home restart`, **Reiniciar Inicio**). También se puede reemplazar el binario a mano (o volver a correr `install.sh` con el nuevo). Las versiones viejas quedan en la caché y se pueden borrar. Para quitarlo, borrá el binario, la caché y, en Linux, el lanzador (`~/.local/share/applications/scope-compass.desktop`); en Windows, si lo instalaste, `install.ps1 -Uninstall`.

### Con el paquete de npm

Si ya tenés Node, el hub también se instala como paquete de npm, `scope-compass-<versión>.tgz`. Lo arma `node tools/build.mjs` en `dist/`, desde un clon del repo:

```sh
npm install -g ./scope-compass-<versión>.tgz
scompass --help
```

El `./` importa: sin él, npm puede tomar la ruta como un repositorio de GitHub.

Eso deja `scompass` en el PATH. Si `npm install -g` pide permisos, usá un prefijo propio (`npm config set prefix ~/.local`) y asegurate de que `~/.local/bin` esté en el PATH.

En Windows, desde PowerShell o cmd: `npm install -g .\scope-compass-<versión>.tgz`. Queda en `%APPDATA%\npm`, que el instalador de Node ya pone en el PATH. Si PowerShell dice que la ejecución de scripts está deshabilitada, usá `scompass.cmd` en lugar de `scompass`, o habilitalos para tu usuario: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

En Linux, `sh install.sh scope-compass-<versión>.tgz` hace el `npm install -g` y deja el lanzador en el menú, igual que con el binario. Para desarrollar, `tools/install.sh --dev` en el repo: `scompass` en `~/.local/bin` corre el `hub/bin/scompass.js` del repo, sin empaquetar.

Para actualizar, instalá el `.tgz` nuevo con el mismo comando. Para quitarlo: `npm uninstall -g scope-compass`.

## 2. Addon de Godot

1. Descomprimí `scope-compass-addon-v<versión>.zip` en la raíz del proyecto de Godot: crea `addons/scope_compass/`.
2. En Godot: Proyecto › Configuración del proyecto › Plugins › activar **Scope Compass**.
3. El dock "Tablero" aparece junto al Inspector.

El dock busca scompass en la ruta de Editor Settings › `scope_compass/scompass_path`, en `../scope-compass` al lado del proyecto, en la instalación anotada y en el PATH, en ese orden. Si no lo encuentra, abrí el binario una vez o indicá su ruta en esa opción.

## 3. Primer uso en un proyecto

- Proyecto sin tablero: en el dock, **Crear compass/** con la plantilla Juego, Personal o Vacío (o `scompass init --template juego` en la raíz del proyecto).
- Para editar: **Iniciar hub** en el dock, o `scompass serve --open` en una terminal.
- Tareas y código (M15): una tarea cita los scripts y escenas que toca. Se agregan con **+ Vincular** en el dock (el script o la escena que estás editando), con **+ Agregar** en la sección Archivos del detalle web o con `scompass file add <tarea> <ruta>`. En el dock, un clic en el archivo lo abre en el editor y, arriba de la lista, aparecen las tareas del script o la escena abiertos.
- Todos los proyectos juntos: `scompass home --tray` levanta el Inicio, con un solo ícono en la bandeja (en Windows también: el área de notificación, junto al reloj). Sirve cada proyecto en `/p/<proyecto>/` sin procesos aparte; el dock y la CLI lo usan solos. `scompass home restart` (o "Reiniciar Inicio") carga una versión nueva.
- Desde el teléfono, en casa: `scompass home --tray --lan`. Con la bandeja, "Activar acceso en la red" lo reinicia con `--lan` y el ítem pasa a mostrar la dirección. Escribe en qué dirección abrirlo (`http://192.168.x.x:4700/`). No hay login: cualquiera en esa red puede ver y editar, así que solo en una red de confianza (D36). Con un firewall, hay que abrir el puerto. En Windows, la primera vez pregunta si deja a Node usar la red: sí, en redes privadas.
- Chat con Claude Code: el botón **Chat** del tablero abre un panel a la izquierda. Corre el `claude` instalado en la carpeta del proyecto, con tu cuenta y tu configuración: lee y escribe el tablero (el MCP `scompass`) y lee los archivos (`Read`, `Grep`, `Glob`), pero no edita ni corre comandos, porque la web no puede aprobar permisos; eso sigue en la terminal. Con una tarea abierta, la manda como contexto. Aparece en el mismo equipo (`127.0.0.1`) y en un teléfono vinculado (el punto siguiente); desde la red, sin vincular, no, aunque haya `--lan`, porque no hay login y el chat usa tu cuenta y lee el repo (D43). Cada conversación es una sesión de Claude Code: se puede seguir en la terminal con `claude --resume <id>`.
- Chat desde el teléfono (§49, D60):
  - **Vincular:** con el Inicio en la red (`--lan`, o "Activar acceso en la red" en la bandeja), abrí el Inicio en este equipo y tocá **Vincular teléfono**. El botón está arriba y solo aparece en este equipo. Escaneá el QR con la cámara del teléfono, conectado al mismo wifi, o abrí la dirección que aparece abajo. El código sirve una sola vez y vence a los 5 minutos. En el teléfono, poné un nombre y tocá **Vincular**: desde ahí, cada tablero que abras desde el Inicio en el teléfono muestra el botón **Chat**.
  - **Qué corre dónde:** el chat corre en este equipo, con el `claude` instalado acá, sus perfiles y tu cuenta. El teléfono solo muestra la conversación, que es la misma que ves en la computadora. Los permisos del agente no cambian: lee, y escribe solo el tablero.
  - **Quitar:** en **Vincular teléfono**, *Dispositivos vinculados* tiene **Quitar**; por la terminal, `scompass devices` lista los vinculados y `scompass devices rm <id>` quita uno. El teléfono deja de usar el chat en el acto.
  - **Por el Inicio:** el teléfono entra a los proyectos por el Inicio (`/p/<proyecto>/`). Un hub suelto con su propio `--lan` sigue con el chat solo en este equipo.
  - **Fuera de casa:** sin un servicio en línea. Más adelante va por Tailscale (m7-02); hasta entonces, solo en la red de casa. Sin HTTPS, la cookie del teléfono viaja sin cifrar por el wifi, igual que el tablero con `--lan`.
- Cuentas en el chat: el panel dice con qué cuenta habla (email, organización, plan), el uso de las ventanas de 5 horas y de la semana (con cuándo se renuevan; se actualiza con cada respuesta) y los tokens y el costo estimado de cada respuesta. Si tenés varios perfiles de Claude Code (carpetas con su propio login que se usan con `CLAUDE_CONFIG_DIR`), ponelos en `~/.claude-profiles/<nombre>/` y el panel deja elegir uno al empezar una conversación; sin elegir, usa `~/.claude`. `SCOMPASS_CLAUDE_PROFILES=<carpeta>` busca los perfiles en otro lado. Para entrar o cambiar de cuenta: `claude auth login` (con el `CLAUDE_CONFIG_DIR` del perfil) en la terminal.
- Varios proyectos a la vez: cada hub usa el puerto de su `compass/config.json` (4711 por defecto); si está ocupado, toma el siguiente libre solo.
- Tras actualizar Scope Compass: reiniciá los hubs que estuvieran corriendo (`scompass restart`, o "Reiniciar hub" en el dock); el dock y la CLI avisan si el hub es de otra versión.
- Tras actualizar Scope Compass: si el dock avisa que `compass/` tiene archivos de una versión anterior, **Actualizar** (o `scompass update`, o "Actualizar compass/" en la bandeja). Para todos los proyectos a la vez: **Actualizar todos** en el Inicio, o `scompass update --all`.

## Windows

- Dónde quedan las cosas: la lista de proyectos del Inicio en `%APPDATA%\scope-compass\projects.json` (y al lado, las conversaciones del chat en `chats\` y los teléfonos vinculados en `devices.json`); los proyectos creados desde el Inicio, en `%LOCALAPPDATA%\scope-compass`; el registro de hubs vivos, en `%TEMP%\scope-compass`.
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
