# Changelog

All notable changes to Scope Compass are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The hub (`scompass`) and the Godot addon always share the same version.

## [Unreleased]

First public release. The interface and the documentation in `docs/` are in Spanish.

### Data

- Boards stored as plain JSON in a `compass/` folder: one file per milestone, task, list and playtest session, in a canonical format with JSON Schemas (`schema/`), readable and editable by hand.
- Boards live in the user's data folder by default (`~/.local/share/scope-compass/boards/`, `%LOCALAPPDATA%\scope-compass\boards\`), with `<project>/compass` as a link excluded from the project's git; a single repository for all boards or one per board. `scompass board move` takes an in-project board out with its history, `board link` links it on another machine, and a git submodule shares it with others.
- An auto-generated markdown export of the board.

### Board

- Milestones with goal, "done when" criterion, target date and progress; tasks across To do, Paused, In progress, Review and Done.
- Tasks with steps, description, notes, "how to test it", due date, tags, priority, size, assignee, links between tasks (including blockers), screenshots and a per-task history read from git.
- List view with filters, live sync across browser tabs, light and dark themes, and a layout for phones.
- Document library for the project's markdown documents (GDD and others): folders, search, git status, and stable references from tasks to document sections.
- Files tab with the repository's files and their git status; tasks can point to the scripts and scenes they touch.
- Playtest sessions that order tasks for testing and record pass or fail with a note.
- Decisions and questions recorded by AI agents on each task, to review, answer or revert.

### Home

- One page for every project on the machine, served on a single port with a tray icon (Linux and Windows).
- Today and This week across all projects, quick capture, and areas (tags) to filter them.
- Lists with due dates and repetition (every N days, weeks, months or years).
- Templates for game, personal and empty projects.
- Optional access from a phone on a trusted network (`--lan`).

### CLI and agents

- `scompass` CLI covering tasks, steps, links, milestones, lists, playtests, decisions, documents and boards, with `--json` output and etags to detect concurrent changes.
- `scompass mcp`: an MCP server over stdio exposing the CLI as typed tools and the board as resources, for Claude Code and other MCP clients.
- A guide for agents (`AGENTS.md`) that `scompass init` and `scompass update` keep in each board.
- A chat panel in the web UI that runs the locally installed Claude Code with read-only file tools and the board's MCP tools, with profile selection and usage shown per response. Available only from the same machine.

### Godot addon

- A "Tablero" dock for Godot 4.8 that reads the board on its own, starts or restarts the hub to edit, opens the scripts and scenes linked to a task, and shows the tasks of the open script or scene.

### Distribution

- Standalone binaries for Linux x64 and Windows x64 that do not need Node, and the Godot addon as a zip. `node tools/build.mjs` also builds the hub as an npm package (`.tgz`) for systems with Node 22 or newer.
- `tools/install.sh` installs `scompass` on Linux and adds a launcher for Home to the applications menu.
- Releases built and published by GitHub Actions: tests on Linux and Windows, each binary built on its own platform, and `SHA256SUMS` with the downloads.
