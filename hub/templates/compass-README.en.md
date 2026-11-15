# compass — board data

These files **are** the project's tasks, in the [Scope Compass](https://github.com/dannroda/scope-compass) format. They can be read, edited and versioned with just git and a text editor; no app is required.

- `milestones/<id>.json`: a milestone (`m00` = M0, …).
- `tasks/<id>.json`: a task. The file name is its id.
- `images/`: task screenshots pasted in the web or added with `scompass image add` from outside the project. Each task cites them in `images`.
- `lists/<id>.json`: a list (to-dos, shopping…), with its items `{ text, done, due? }` inside. Checking one means changing `"done"` to `true`.
- `playtests/<id>.json`: a playtest session: tasks in test order, `{ task }`. How each test went (`result` `"pass"` or `"fail"`, and `note`) goes in the task, in `playtest`, and looks the same in every session that has it.
- `schema/`: JSON Schema for each type and for `config.json`, to validate a hand edit. It's a copy of Scope Compass's: `scompass update` brings it up to date.
- `config.json`: project name, citable documents, markdown export, hub port and `views` (the web's tabs in order; the first is the one that opens: `board`, `lists`, `playtest`, `decisions`, `docs`, `files`).
- `.gdignore`: makes Godot ignore this folder.
- `.gitattributes`: these files always with LF, on Windows too (`scompass update` brings it up to date).
- `AGENTS.md`: the board's guide for AI agents (brought up to date with `scompass update`).

With the CLI: `scompass list`, `scompass show <id>`, `scompass move <id> doing`, `scompass --help`.

## Handling without the app

| I want to… | What to do |
|---|---|
| See the tasks | Open `docs/tareas.md` (last readable export) or the JSON files in `tasks/` |
| Move a card | Change `"status"` to `"todo"`, `"paused"`, `"doing"`, `"review"` or `"done"` |
| Check a step | Change `"done": false` to `true` in `checklist` |
| Create a task | Copy a JSON from `tasks/` under another file name and edit it |
| Delete a task | Delete the file |
| See a task's history | `git log -p compass/tasks/<id>.json` |
| Recover something deleted | `git checkout <commit> -- compass/tasks/<id>.json` |
| Merge two branches that touched the same task | Nothing special: the Scope Compass merge driver (`.gitattributes`, registered by `scompass update`) joins the changes field by field; there's only a conflict if both sides changed the same thing |

## Format

- JSON with 2-space indentation, keys in alphabetical order, UTF-8, trailing newline.
- Files don't store a version number: there's nothing to increment when editing by hand.
- `updated_at` is optional in hand edits.
- In texts, `` `like this` `` is shown as code.
- `links` links tasks: `{ "type": "blocks", "task": "<id>" }` in the task that blocks the other, or `"related"`. "Blocked by" isn't stored: it's computed.
- `refs` points to document sections by their stable id (`<!-- id: ... -->` below each heading).
- `priority` (`"high"`, `"medium"`, `"low"`), `assignee` (text) and `tags` (list of texts without commas) are optional: without the field, the task doesn't have that data.
