# Scope Compass

**English** · [Español](README.es.md)

A project organizer for video games that keeps its data in git. Tasks, milestones, lists and playtests are plain JSON files you can read, edit and version with nothing but git and a text editor. A local app (the `scompass` CLI, a hub with a web UI) and a dock for the Godot editor make them comfortable to use, but they are never the only place the data lives.

Everything runs on your machine: no accounts, no cloud, no telemetry. The only part that talks to an online service is the optional chat, which runs the Claude Code installed on your machine with your own account.

> **Language:** the interface (web UI, Godot dock and CLI messages) and the documentation in `docs/` are currently in Spanish only. Translation is planned.

<!-- screenshot: board -->

## What it does

- **Board per milestone.** Each milestone has a goal and a "done when" criterion; tasks move across To do, Paused, In progress, Review and Done. Tasks have steps, a description, notes, "how to test it", due dates, tags, priority, size, assignee, links between tasks, screenshots and a per-task history taken from git. There is also a list view with filters.
- **Documents (GDD).** A library for the project's markdown documents, with search, git status and stable references from tasks to document sections. A Files tab shows the repo's files and their git status, and tasks can point to the scripts and scenes they touch.
- **Playtests.** Playtest sessions put tasks in test order and record whether each one passed or failed, with a note.
- **Agent decisions.** When an AI agent works on a task, it records the choices it made on its own and the questions it needs you to answer. You review them from the board or from the Home page.
- **Home.** One page for every project on the machine: what is overdue or due today, the coming week, quick capture, lists with due dates and repetition, and templates to start a game, personal or empty project. It serves every project's board on a single port, with a tray icon.
- **MCP server for Claude Code.** `scompass mcp` exposes the CLI as typed tools (list, show, add and move tasks, check steps, record decisions, search documents…), so an agent works on the board without shell commands. The web UI can also run a chat with the Claude Code installed on your machine, using your own account.
- **Godot dock.** The "Tablero" (board) dock inside the Godot 4.8 editor shows the tasks, opens the scripts and scenes a task points to, and can start the hub. It reads the board on its own; editing needs the hub.
- **Phone on your home network.** With `--lan`, the board and Home open from your phone on a trusted network.

<!-- screenshot: home -->

<!-- screenshot: dock -->

## Principles

1. **The data lives in git; the app is optional.** One JSON file per milestone and per task, in a `compass/` folder. If the app breaks or is not installed, everything can still be read and edited by hand.
2. **Local first.** The hub listens on `127.0.0.1`. Nothing leaves your machine unless you push it to a git remote.
3. **People, agents and the editor alike.** A web UI for people, a CLI with `--json` and an MCP server for agents, and a WebSocket the Godot dock uses to stay live.
4. **Your boards are yours.** Boards live in your user data folder, not inside the project's repository, so a public game can keep its board private (see [Where the boards live](#where-the-boards-live)).

## Requirements

- Linux or Windows 10/11, x64. Developed on Linux, also tested on Windows.
- Git.
- Godot 4.8, for the dock.
- With the release binary, nothing else: it carries its own Node. With the npm package (`.tgz`), Node.js 22 or newer.
- For the chat in the web UI (optional): Claude Code installed and logged in (run `claude` once).

## Install

Download from the [latest release](https://github.com/dannroda/scope-compass/releases/latest):

| File | What |
|---|---|
| `scompass-vX.Y.Z-linux-x64` | The CLI, hub and web UI for Linux, as one binary |
| `scompass-vX.Y.Z-windows-x64.exe` | The same for Windows |
| `scope-compass-addon-vX.Y.Z.zip` | The Godot addon (the dock) |
| `SHA256SUMS` | Checksums of the files above |

Check the download with `sha256sum -c SHA256SUMS --ignore-missing` (on Windows, `Get-FileHash <file>` and compare).

**Hub and CLI.** Put the binary in a folder on your `PATH` named `scompass` (`scompass.exe` on Windows) and run `scompass --help`. On Linux, the repository's [`tools/install.sh`](tools/install.sh), run as `sh install.sh <path to scompass-vX.Y.Z-linux-x64>`, copies it to `~/.local/bin/scompass` and adds **Scope Compass** to the applications menu, which starts Home with a tray icon. The first run of each version extracts its contents (about 30 MB) to `~/.cache/scope-compass/runtime/` (`%LOCALAPPDATA%\scope-compass\runtime\` on Windows).

**Godot addon.** Unzip the addon at the root of your Godot project (it creates `addons/scope_compass/`), then enable **Scope Compass** in Project › Project Settings › Plugins. If the editor does not find `scompass` on the `PATH`, set its path in Editor Settings › `scope_compass/scompass_path`.

The full steps, including the npm package and Windows notes, are in [`docs/instalar.md`](docs/instalar.md) (Spanish).

## First steps

- **All your projects:** `scompass home --tray --open` (or **Scope Compass** in the menu on Linux) opens Home in the browser. From there you can add existing projects or create new ones from a template.
- **One project:** in the project's folder, `scompass init --template juego` creates a board (templates: `juego` for a game, `personal`, `vacio` for empty), or use **Crear compass/** (create compass/) in the Godot dock. Then `scompass serve --open`, or **Iniciar hub** (start hub) in the dock.
- **From the terminal:** `scompass list`, `scompass add "Title" --milestone m00`, `scompass move <id> doing`. Add `--json` for machine-readable output.
- **Claude Code:** register the MCP server once for all projects with `claude mcp add --scope user scompass -- scompass mcp`, and tell the agent about the board guide by adding this to the project's `AGENTS.md` or `CLAUDE.md`: "The task board is managed with scompass; read compass/AGENTS.md before touching it."
- **From your phone:** `scompass home --tray --lan`, or "Activar acceso en la red" (enable network access) in the tray. There is no login: anyone on that network can view and edit, so use it only on a network you trust. See [SECURITY.md](SECURITY.md).

## Where the boards live

A project's board is always reached as `<project>/compass`, but by default that is a link (a symlink on Linux, a junction on Windows) to a folder in your user data directory:

- Linux: `~/.local/share/scope-compass/boards/<name>/`
- Windows: `%LOCALAPPDATA%\scope-compass\boards\<name>\`
- `SCOMPASS_BOARDS` points it elsewhere.

The link is excluded through the project's `.git/info/exclude`, so the project's repository carries no trace of it. To version your boards, either make the boards folder a git repository before creating the first board (one repository for all of them, each board a subfolder) or let each board get its own `git init`. Other options:

- `scompass init --in-project` keeps the board inside the project, in the project's repository.
- `git submodule add <url> compass` shares a board with other people.
- `scompass board move` takes an existing in-project board out to the boards folder, keeping its history; `scompass board link <name>` links a board you cloned on another machine.

## Documentation

| What | Where |
|---|---|
| Installation and first use (Spanish) | [`docs/instalar.md`](docs/instalar.md) |
| Full spec: data format, API, CLI, acceptance criteria (Spanish) | [`docs/spec.md`](docs/spec.md) |
| Design decisions and why (Spanish) | [`docs/decisiones.md`](docs/decisiones.md) |
| Guide for AI agents working on a board (Spanish) | [`addons/scope_compass/AGENTS.md`](addons/scope_compass/AGENTS.md) |
| The hub package, its layout and tests (Spanish) | [`hub/README.md`](hub/README.md) |
| JSON Schemas of the data | [`schema/`](schema/) |
| Changes per release | [`CHANGELOG.md`](CHANGELOG.md) |
| Contributing | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| Security | [`SECURITY.md`](SECURITY.md) |

## License

[MIT](LICENSE). The Godot addon carries its own copy of the license.
