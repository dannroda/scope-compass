---
name: scope-compass
description: Use when the project has a compass/ folder (a Scope Compass task board), or the user mentions the board, tasks, milestones, steps, playtests or decisions to track, or the scompass CLI or MCP tools. Covers reading compass/AGENTS.md, using the scompass MCP tools or CLI instead of editing the JSON, and the task workflow (doing, steps, review, decisions).
---

# Scope Compass board

The project's tasks and milestones live in `compass/` (often a link to the user's boards folder). Everything about operating the board is in **`compass/AGENTS.md`**, which `scompass update` keeps in step with the installed version. Read it before touching the board; this skill only gets you there.

## Tools

- **MCP first.** If the `scompass` MCP tools are available (`list_tasks`, `show_task`, `move_task`, `check_step`, `update_task`, `add_decision`…), use them: they are the CLI with typed parameters.
- **Not available?** Register them once for all projects with `scompass mcp install` (it registers the full path, no `PATH` needed), then ask the user to run `/mcp` or restart Claude Code. If `scompass` is not on the `PATH`, the installed binary recorded its command in `~/.local/share/scope-compass/scompass.json` (`%LOCALAPPDATA%\scope-compass\scompass.json` on Windows): run its `command` with its `args`, then `mcp install`. With no binary at all, it is downloaded from https://github.com/dannroda/scope-compass/releases/latest.
- **CLI otherwise.** `scompass <command> --json` from any folder of the project (or `--dir <project>`). Never edit the JSON in `compass/` by hand: the CLI validates, writes the canonical format and regenerates the markdown export.

## Workflow

1. Before starting a task: `show_task`, and check for decisions marked to revert (`list_decisions` with state `revert`); undo them and mark them reverted.
2. Starting: move it to `doing`. Advancing: check its steps (numbered from 1, as `show_task` shows them).
3. A choice the user could have wanted differently (a name, a default, leaving something out): record it with `add_decision` (why, alternatives). A question for the user: `add_decision` with `ask`.
4. New work that shows up: `add_task` with a description; a dependency between tasks is a link, not a note.
5. Done: fill `test` (how it is checked) and `notes`, and move it to `review`, never to `done`.
6. Writes return an `etag`; pass it on the next write so you don't overwrite someone else's change.
7. Changes stay as modified files in the board's repository (`git -C compass …`): commit only when asked.

Board, CLI, hub, web UI and Godot addon versions differ freely as long as they speak the same protocol; if the CLI warns that a hub speaks another protocol, it writes straight to `compass/` instead, which is fine.
