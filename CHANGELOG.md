# Changelog

All notable changes to Scope Compass are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The hub (`scompass`) and the Godot addon always share the same version.

## [Unreleased]

### Added

- Link a board that already exists to a project without `compass/`: another project's board, a standalone one, or one cloned from the boards repo. `scompass board list` shows the boards in the boards folder and which projects use them; Home has Add project › Link board, and the Godot dock offers the boards next to "Create compass/".
- Change the board of a project that already has one: `scompass board link <board> --replace`, and a board button in the Godot dock that shows where the board is and switches it (stopping and restarting the dock's hub). A linked board is swapped; an in-project board leaves the project's repo and stays in its history. Nothing changes if the board has uncommitted changes.

### Changed

- Update channels for the binary and the Godot addon: `stable` (the default) only gets releases; `beta` also gets pre-releases, which are versions for testing. Choose it with `scompass upgrade --channel stable|beta` (used by `upgrade` and Home) and, for the addon, in Editor Settings › `scope_compass/update_channel`. The binary no longer follows pre-releases just because the running version is one. Pre-releases show as "(beta)" in the notices.

### Fixed

- Chat with Antigravity CLI: every message failed with `INVALID_ARGUMENT … enum[3]: cannot be empty`, because the Gemini API rejects the MCP tools when an enum contains an empty value. `update_task` now takes `none` to remove `priority` or `size` (`""` still works).

## [0.1.0] - 2026-11-18

First public release. The interface is in English and Spanish; the documentation in `docs/` is in Spanish.

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
- Self-update for the binary: `scompass upgrade` downloads the newest release for your platform, checks it against `SHA256SUMS` and replaces itself (`--check` only reports; `--pre` includes pre-releases, which are also followed when the running version is one). Home checks once a day and offers **Update** in the page and in the tray.

### CLI and agents

- `scompass` CLI covering tasks, steps, links, milestones, lists, playtests, decisions, documents and boards, with `--json` output and etags to detect concurrent changes.
- Document coverage: `scompass refs coverage`, `GET /api/refs/coverage` and the `doc_coverage` MCP tool list, per section, the tasks that cover it (directly or through an enclosing section) and whether they are all done; the Documents view marks each section's state in the index and summarizes the coverage of the document.
- A git merge driver for `compass/` (`scompass merge-json`, registered by `init` and `update`): two changes to the same task in different fields merge cleanly, lists merge per element (steps, decisions, tags, links…), `updated_at` takes the newest, and only a change to the same field on both sides leaves the usual conflict.
- A `clean-room` project template (`scompass init --template clean-room`, "Sala limpia" in Home): rules for agents and people doing a clean-room reimplementation (what not to read, what to write, what never to write), documents for observed behavior and open questions, a root `AGENTS.md` pointing to the rules, and generic example forbidden patterns.
- Forbidden patterns (`config.json › forbidden`): regular expressions a project must never have on its board. Any write that matches is rejected whole (HTTP 422 `forbidden_pattern` with the matches), and `scompass lint` checks hand-edited files in `compass/` and the declared documents, exiting with 1 on a match.
- `scompass mcp`: an MCP server over stdio exposing the CLI as typed tools and the board as resources, for Claude Code and other MCP clients.
- A guide for agents (`AGENTS.md`) that `scompass init` and `scompass update` keep in each board.
- A chat panel in the web UI that runs the locally installed Claude Code with read-only file tools and the board's MCP tools, with profile selection and usage shown per response. Available from the same machine and from phones linked in Home with a single-use QR code (`scompass devices` lists and removes them); full screen on a phone.

### Godot addon

- A "Tablero" dock for Godot 4.8 that reads the board on its own, starts or restarts the hub to edit, opens the scripts and scenes linked to a task, and shows the tasks of the open script or scene.

### Distribution

- Standalone binaries for Linux x64 and Windows x64 that do not need Node, and the Godot addon as a zip. `node tools/build.mjs` also builds the hub as an npm package (`.tgz`) for systems with Node 22 or newer.
- `install.sh` (Linux) and `install.ps1` (Windows), attached to each release, install the binary: on Linux in `~/.local/bin` with a launcher for Home in the applications menu; on Windows in `%LOCALAPPDATA%\Programs\scompass`, on the user `PATH` and with a Start menu shortcut, without admin rights (`-Uninstall` removes it). The binary also works portable, from any folder.
- **Update all** in Home (and `scompass update --all`) brings every known board's generated files (schemas and the agent guide) up to date after a new version of Scope Compass.
- The Godot addon updates itself from GitHub releases (once a day when the editor opens; it can be turned off). The addon, the hub and the CLI check compatibility by a protocol number instead of the version: a hub that speaks another protocol is not used, and the dock offers the matching `scompass` binary.
- A Claude Code plugin (`claude-plugin/`, with this repository as its marketplace) whose skill sends the agent to the board guide; it follows the Scope Compass version.
- `scompass` does not need to be on the `PATH`: every run records its own path in the data folder, the Godot addon looks there, and `scompass mcp install` registers the MCP server in Claude Code with the full path.
- The CLI, the web board, Home, the MCP server, the tray and the Godot dock in English and Spanish, following the system, browser or editor language; `scompass lang` and a selector in Settings choose one. Templates, the agent guide and the markdown export follow the board's language (`config.json › language`).
- Screenshots of the board, the phone view, Home, a playtest session, the decisions inbox and the Godot dock in `docs/images/en/` and `docs/images/es/` (1920×1200, with alt text and captions in `docs/images/captions.json`), made from sample projects by `node tools/screenshots.mjs`.
- Releases built and published by GitHub Actions: tests on Linux and Windows, each binary built on its own platform, and `SHA256SUMS` with the downloads.
