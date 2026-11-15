# Project board — guide for agents

This project's tasks and milestones live in `compass/`, in the Scope Compass format. This guide is enough to operate the board; you don't need to read Scope Compass's code.

## Rules

- **Use the `scompass` CLI; don't edit the JSON by hand.** It validates, writes in canonical format, regenerates the markdown export and, if a hub is running, notifies the web UI and the Godot dock instantly.
- Run commands from any folder of the project (it looks for `compass/` upwards) or with `--dir <project>`.
- If `scompass` isn't on the PATH: use the command the installation recorded in `~/.local/share/scope-compass/scompass.json` (`%LOCALAPPDATA%\scope-compass\scompass.json` on Windows; `command` followed by `args`), or `node <scope-compass folder>/hub/bin/scompass.js` from a clone of the repo.
- Add `--json` to read the output from a program. Exit code 0 on success; errors go to stderr.
- The hub doesn't need to be running: without a hub, the CLI writes straight to `compass/`. With Home running (`scompass home`), the CLI goes through it on its own (it finds it in the registry).
- If the CLI warns that the hub is a different version, restart it with `scompass restart` before going on: an old hub may not know new fields.
- Changes stay as modified files in `compass/` (and in the markdown export). Commit them only if asked, and in the board's repo: `git -C compass …`, which is the project's repo if `compass/` is one of its folders, and its own if it's a link or a submodule (see *Where the board lives*). `scompass list` ends with how many are uncommitted (`uncommitted` in `--json`).

## MCP

If the `scompass` server shows up in your tools (`list_tasks`, `show_task`, `add_task`, `move_task`, `check_step`…), use it instead of running `scompass` through Bash: they are the same commands with `--json`, with typed parameters, and they don't ask for permission on every call. Everything below still applies (model, etags, steps from 1); tool names follow the commands (`set` is `update_task`, `step add` is `add_step`, `decide` is `add_decision`, `decision ok` is `review_decision`, `playtest pass` is `set_playtest_result`, `refs coverage` is `doc_coverage`). Lists, playtest sessions (creating, ordering), screenshots and `init`/`serve` still go through the CLI.

To have it in Claude Code in every project (it takes the one of the session's folder; `dir` in each tool points to another):

```sh
scompass mcp install
```

That runs `claude mcp add --scope user scompass -- <full path of scompass> mcp`, so `scompass` doesn't need to be on the PATH. The `scope-compass` Claude Code plugin (`/plugin marketplace add dannroda/scope-compass`) doesn't bring the MCP: it brings a skill that tells the agent to read this guide.

Milestones (`compass://milestone/<id>`), tasks (`compass://task/<id>`) and documents (`compass://doc/<alias>`) are attached with `@scompass:…`.

`show_doc` gives the document's `etag` (also when reading a section). Pass it as `since` to ask whether it changed: if it didn't, it answers just that, without the text; if it did, it brings the text and `changes` with the changed, added and removed sections. If, after you read a document, a result carries "Notice: the document … changed since you read it", someone edited it while you worked: read it again before relying on it any further.

## Chat

The board's web page has a chat (*Chat* button, on the same computer or on a phone linked from Home) with the installed Claude Code or with Antigravity CLI (`agy`), whichever is chosen in Settings. It launches the agent in the project folder with the `scompass` MCP and file reading allowed: it doesn't edit files or run commands, and everything else is denied without asking (with `agy`, the hub answers each permission request and the denied attempt doesn't happen). If you are that agent:

- A message may start with `Open task: <code> <title> (compass://task/<id>)` (`Tarea abierta: …` with the interface in Spanish): it's the task the user has open; read it with `show_task` if needed.
- Whatever needs editing or running, say so, to do it in the terminal.
- The rules of this guide still apply: record decisions, move what you finish to `review`.

Conversations are Claude Code sessions (they can be resumed with `claude --resume <id>`, with the same profile); the hub only keeps the list and a copy to show them, outside `compass/`. Each conversation uses a Claude Code profile (`~/.claude` or a folder in `~/.claude-profiles/`, launched with `CLAUDE_CONFIG_DIR`), and the panel shows its account, the usage of its limits and the tokens of each answer.

## Model

- **Milestone** (`compass/milestones/<id>.json`): id `m00`, `m01`, …; fields `code` ("M0"), `title`, `order`, `goal`, `done_when` and `due` (optional target date; late if it passes with unfinished tasks).
- **Task** (`compass/tasks/<id>.json`): the id is the file name. `scompass add` gives it the next number of its milestone (`m5-12` in `m05`) and prints it; older tasks may have random ids like `sd3tg577`. It isn't renamed, even if the task changes milestone. Fields:
  - `milestone` (milestone id), `title`, `code` (visible number, for example "5.2"; optional);
  - `description`: what needs to be done and why, the task's statement, written when it's created (optional);
  - `status`: `todo` (To do), `paused` (Paused: started and set aside for now), `doing` (In progress), `review` (Review), `done` (Done);
  - `checklist`: steps `{ text, done, detail? }`. `text` is a short line; the how and the why go in `detail`;
  - `due`: optional due date, `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM` (local time);
  - `priority`: optional priority, `high`, `medium` or `low`;
  - `size`: optional estimate, `s`, `m` or `l` (small, medium, large);
  - `assignee`: optional owner, free text (a person or an agent);
  - `tags`: optional tags, short texts without commas (`["art", "audio"]`). If `compass/config.json` › `description_templates` has a template for the tag (for example `bug`), tagging a task without a description starts it with that text: fill it in. Bugs filed from the Godot dock arrive like that, with the `bug` tag, that template unfilled and, almost always, a screenshot of the game or the editor in `images`;
  - `test`: how to check that the task is finished;
  - `notes`: what comes up while working on it: decisions, findings, what the next person needs to know. The request goes in `description`, not here;
  - `refs`: project documents the task cites, whole (`{ doc }`) or a section (`{ doc, section }`);
  - `files`: repo files the task touches (scripts, scenes, resources), with the path from the project root (`["player/player.gd"]`);
  - `images`: the task's screenshots (PNG, JPEG, GIF or WebP), with the path from the root; the ones pasted in the web go to `compass/images/`;
  - `links`: links to other tasks (see "Links between tasks");
  - `playtest`: how it went when tested, `{ result?, note? }` (see "Playtest"); written by `playtest pass`, `fail` and `reset`;
  - `decisions`: the decisions made while working on it, in order, `{ text, why?, alternatives?, asked?, reply?, review?, promoted?, at }`. Without `asked`, it was decided without asking and stays unreviewed until the user sets `review` (`ok`, `revert`; `reverted` once it's been reverted); with `asked`, it's an open question until it has a `reply`;
  - `created_at`, `updated_at` and `done_at` (when it became Done): set by the CLI; no need to write them.
- In texts, `` `like this` `` is shown as code.

## Read

```sh
scompass milestone list                      # milestones, in order
scompass list                                # all tasks, by milestone
scompass list --milestone m05 --status doing # filters (can be combined)
scompass list --q "pause menu"               # all the words in code, title or id (ignoring accents)
scompass list --status todo,doing --priority high --assignee Claude
scompass list --size l,none                  # estimate: s, m, l or not estimated
scompass list --due overdue                  # overdue | today | week | none (done tasks don't go overdue)
scompass list --tag art,audio                # with any of those tags
scompass list --blocked                      # or --unblocked; also --pending-steps and --with-refs
scompass list --json                         # { "tasks": [ { "id", "etag", "title", "status", "checklist", … } ] }
scompass show m5-02                          # a task, with steps numbered from 1
scompass show m5-02 --json
scompass history m5-02                       # what changed in the task in each commit (from git)
```

## Write

```sh
scompass add "Task title" --milestone m05 --code 5.9 --description "What and why"   # prints the new id
scompass move m5-02 doing                                     # todo | paused | doing | review | done
scompass set m5-02 --title "…" --notes "…" --test "…"          # changes only those fields (--description "" removes it)
scompass set m5-02 --due 2026-10-10                           # due date (--due "" removes it)
scompass set m5-02 --priority high --size m --assignee Claude --tags art,level  # "" removes each one; --tags replaces the list
scompass step add m5-02 "Short step" --detail "How and why"
scompass step set m5-02 2 --text "…" --detail "…"              # --detail "" removes the detail
scompass step rm m5-02 2
scompass check m5-02 2                                        # checks step 2
scompass check m5-02 2 --undo
scompass set m5-02 --file task.json                           # full replacement (--file - reads stdin); show --json's output works, and its etag protects against overwriting a change
scompass milestone set m08 --file milestone.json              # creates or replaces a milestone
scompass milestone set m08 --due 2026-11-01                   # the milestone's target date ("" removes it)
```

- Steps are numbered from 1, as `scompass show` shows them.
- To avoid overwriting someone else's change, pass `--etag <etag>` (the one `--json` returns): if the task changed, it fails with a conflict. Read it again and retry.
- A task is deleted by deleting its file in `compass/tasks/`.
- If a git merge leaves a task with conflict markers, both sides changed the same field (the `compass/` merge driver joins everything else on its own). Resolve it by hand leaving valid JSON and run `scompass list` to check that no warning is left.
- If a write fails with `forbidden_pattern`, the text matches one of the project's forbidden patterns (`compass/config.json › forbidden`; the message gives the field, the pattern and why). Nothing was saved: say it another way, without that text, and don't copy it to another field or to a document. `scompass lint` checks what was edited by hand in `compass/` and in the documents, and exits with 1 if it finds something.

## Links between tasks

A task can block another or be related to another. It's stored on one side only (`links` of the blocking task); "blocked by" is computed.

```sh
scompass link add m5-02 blocked-by m5-01   # m5-02 can't move forward until m5-01 is done
scompass link add m5-01 blocks m5-02       # the same, said from the other task
scompass link add m5-02 related m4-03      # related, no order
scompass link rm m5-02 m5-01               # removes the link between them
scompass link list m5-02 --json            # { "links": [ { "id", "blocks", "blocked_by", "related" } ], "broken": [] }
scompass link list                         # all of them; exits with 1 if there are links to tasks that don't exist
```

- Two tasks have a single link between them: adding another replaces the previous one. A `blocks` that would close a cycle is rejected.
- `scompass list` marks `[blocked by <ids>]` on tasks that have an unfinished task ahead of them; `scompass show` lists the links.
- Before starting a task, check whether it's blocked. If you find out one depends on another, link them instead of writing it in `notes`.

## Decisions

The user wants to see what you decided without asking them. **Every time you choose between reasonable alternatives that the user might have wanted differently, record it in the task:** a format or a visible name, leaving something out, adding a dependency, a default behavior, a simplification of what they asked for. It's not needed for things with only one reasonable answer (following the code's style, fixing a typo). When in doubt, record it: reviewing one too many costs a click.

```sh
scompass decide m5-02 "Save as JSON" --why "readable in the diff" --alternatives "binary"   # made without asking
scompass decide m5-02 "JSON or binary?" --ask       # you asked the user (stays open until they answer)
scompass decision reply m5-02 2 "JSON"               # the answer, if they gave it in the chat
scompass decision reverted m5-02 1                   # you already undid the one the user marked to revert
scompass list --decisions open,pending,revert        # tasks with open questions, unreviewed or to revert
scompass decisions --revert                          # the whole project's (--open, --pending, --revert)
```

- Decisions are numbered from 1, like steps, and `show` lists them with their state: `?` open question, `!` unreviewed, `↺` to revert, `✓` settled.
- Questions are recorded too (`--ask`), with the answer when it arrives: that way it's clear why the task ended up as it did. From Claude Code, `--ask` saves the asking session on its own (`CLAUDE_CODE_SESSION_ID`; in the chat with `agy`, the chat conversation, `SCOMPASS_CHAT_SESSION`): if the user answers in the web, they can send you the answer to that same session through the chat.
- Reviewing (`decision ok`, `revert`) is the user's job. Before continuing a task, check whether it has any to revert: undo it following `reply`, mark it `reverted` and, if you decided something else instead, record it as a new decision.
- The project's big design decisions (the ones that change the spec) also go to the decisions document: `scompass decision promote m5-02 1` adds a settled one as entry `D<n>` at the end of the `decisiones` document (or the one in `config.json › decisions_doc`) and marks it in the task. Do it when asked or when the decision changes the spec; it doesn't commit.

## Usual workflow

- When starting a task: `scompass move <id> doing`. As you progress, `scompass check <id> <n>`.
- When finishing: fill in `test` if it's empty, leave in `notes` what the next person needs to know and move it to `review` (or to `done` if it's already been checked). Milestone progress counts the ones in `review` as done (and says how many there are); the milestone is considered finished when all of them are in `done`.
- New work that comes up along the way: `scompass add` in the right milestone, with `--description` (what and why), instead of leaving it only in the chat.
- If asked for "my stuff" or "the high-priority stuff", filter with `--assignee` or `--priority`. When taking a task, if the project uses assignees, put your name with `set --assignee`. Use the tags that already exist (`scompass list --json` shows them) before inventing others.

## Lists

Besides tasks, a project can have lists (`compass/lists/<id>.json`): to-dos, shopping, ideas, assets to get. Each item is `{ text, done, created_at, due?, repeat?, task? }`; `due` is the due date (`YYYY-MM-DD` or `YYYY-MM-DDTHH:MM`, local time), `repeat` `{ "every": "day" | "week" | "month" | "year", "interval"? }` (requires `due`; `interval`: every how many periods, 1 if absent) and `task` the id of the task created from the item.

```sh
scompass lists                                      # lists with what's left pending
scompass lists show shopping --json                 # { "id", "etag", "title", "items": [ … ] }
scompass lists add "Books to read"                  # the id comes from the title: books-to-read
scompass item add shopping "Coffee"
scompass item add todo "Pay the electricity bill" --due 2026-10-10 --repeat month
scompass item add routine "Water the plants" --due 2026-11-03 --repeat day --interval 2   # every 2 days
scompass item check shopping 2                      # items numbered from 1, as in lists show
scompass item set todo 1 --due ""                   # removes the date
scompass item clear shopping                        # removes the checked ones
scompass item task assets 3 --milestone m06         # turns the item into a task and links it
```

- Checking an item that repeats doesn't leave it checked: its `due` moves one period (or `interval` periods) ahead from the due date (01/31 → 02/28). It isn't unchecked; if needed, change its date with `item set --due`.
- Something with stages or steps goes as a task in a milestone; something that only gets checked goes in a list. If an item grows, turn it into a task with `item task`.

## Playtest

A playtest session (`compass/playtests/<id>.json`) gathers existing tasks in the order they'll be tested, to sort out what's in Review. Each item is `{ task }`, the task's id. How the test went lives in the task, in `playtest: { result?, note? }`: `result` `pass` (works) or `fail` (fails; without `result`, it hasn't been tested yet) and `note` what was seen while testing it (it can span several lines). That way a task that's in several sessions shows the same in all of them. `pass`, `fail` and `reset` write that into the task; they don't change its status: that's done separately, with `move`.

```sh
scompass playtest                                   # sessions, with how many tasks are left to test
scompass playtest show build-0-3 --json             # { "id", "etag", "title", "items": [ { "task" } ] }; the result, in each task
scompass playtest new "Build 0.3" --review          # the id comes from the title; --review fills it with the tasks in Review
scompass playtest add build-0-3 m5-02 m5-07 --at 1  # adds tasks (from position 1); the ones already there aren't repeated
scompass playtest add build-0-3 --review --milestone m05   # adds the ones in Review of that milestone
scompass playtest move build-0-3 m5-07 3            # moves it to position 3 (by id or by number from 1)
scompass playtest fail build-0-3 2 --note "Gets stuck when jumping"
scompass playtest pass build-0-3 m5-02              # reset sets it back to "untested"; drop takes it out of the session
scompass playtest rm build-0-3                      # deletes the session; the tasks aren't touched
scompass playtest migrate                           # old sessions (result and note in the session) → the tasks
```

- If `playtest` warns about sessions in the old format, run `scompass playtest migrate`: if a task was in several, the result of the most recent session that tested it wins and differing notes are merged.
- If a test fails, leave in `note` what was seen and, if it needs fixing, move the task back to `doing`; if it works, move it to `done`.
- The Godot dock marks ✓ / ✗ in the list and shows the result and the note in the detail; with a hub, *Pass* / *Fail* can be changed there too.

## Documents and references

Citable documents are in `compass/config.json` › `docs` (alias and path, or a pattern like `docs/**/*.md`). They're declared with `doc add`, not by editing the config: it has to be a `.md` inside the project that git doesn't ignore (or a pattern ending in `.md`); nothing with `..`, braces, absolute paths or symbolic links leading outside. A file from a pattern takes the pattern's alias plus its path under the pattern's folder, without `.md`: `docs/notes/art.md` is `docs/notes/art`. A reference points to a section by its stable id (`<!-- id: … -->` below the heading), or to the whole document if it has no `#<id>`. In the description, notes, test and steps, `[[alias#id]]` links a section and `[[alias]]` the document.

```sh
scompass doc list                  # documents with their section index
scompass doc show spec#godot --raw # a section's markdown (without #godot, the whole document)
scompass ref add m5-02 spec#godot  # the task cites that section
scompass ref add m5-02 spec        # the task cites the whole document
scompass ref rm m5-02 spec#godot
scompass refs check                # broken references (exits with 1 if any), also files that are gone
scompass refs coverage gdd         # per section: which tasks cover it (also from an outer section) and whether they're done; --uncovered, the ones no task touches
scompass file add m5-02 player/player.gd   # the task touches that file (accepts res://); file rm removes it
scompass image add m5-02 /tmp/screenshot.png  # screenshot: one from outside is copied to compass/images/; one from the repo is cited
scompass image rm m5-02 compass/images/m5-02-20261011-101500.png   # takes it out (and deletes the file if the app saved it)
scompass doc add enemies docs/enemies.md     # or a pattern: doc add docs "docs/**/*.md"
scompass doc rm enemies                      # stops declaring it; the file isn't touched
scompass doc search "double jump"            # lines with all the words, with their section
scompass doc status                          # git state of each document and its last commit
scompass doc diff gdd                        # uncommitted changes and the sections they touch
scompass doc changed gdd --since <etag>      # which sections changed since the etag doc show gave (exits with 1 if it changed)
```

### Reading a document again

What you read from a document can go stale while you work: the user edits it (in their editor, or a section from the web library, which saves without committing), another session changes it, a `git pull` arrives or someone promotes a decision to the decisions document. Read it again before relying on it:

- before a decision, a code change or closing a task that depends on what it says, if you read it a while ago (another task in between, a long pause, or after a commit or a pull);
- if an MCP tool brings "Notice: the document … changed since you read it";
- after `decision promote`, if you'll keep using the decisions document;
- when a task cites a section (`refs` or `[[alias#id]]`) that you read in another task.

To avoid reading it all again, ask whether it changed with the `etag` that `doc show --json` (or `show_doc`) gave you, which is the document's even if you read a section:

```sh
scompass doc changed gdd --since <etag>          # exits with 0 if it didn't change and with 1 if it did, with the sections
scompass doc changed gdd#combat --since <etag>   # only that section and the ones inside it
```

With the MCP, `show_doc` with `since` does the same and, if it changed, already brings the new text. Read again only the sections that changed, were added or were removed and matter to you. If it says it didn't find the old version (`known: false`), read it whole. If what changed contradicts something you already did, say so and record it as a decision instead of carrying on with the old version.

## Where the board lives

Boards belong to the user, not to the project: `scompass init` creates the board in `~/.local/share/scope-compass/boards/<name>/` (on Windows, `%LOCALAPPDATA%\scope-compass\boards\`) and `compass/` becomes a link (symlink; junction on Windows) that the project excludes in `.git/info/exclude`. That way the board isn't published with the code. The kinds:

- linked: the above. If the boards folder is the root of a git repo, that repo is the one for all boards and each board is a subfolder; if not, each board has its own repo;
- submodule: `compass/` is a git submodule with the board's repo, to share it with others;
- in the project: a folder of the project, in its same repo (`init --in-project`, older boards and those of a project in `/tmp`).

For the CLI, the MCP, the web and the dock it makes no difference: it's always `<project>/compass`. What changes is where you commit (`git -C compass`).

```sh
scompass board                   # where it is: in the project, linked or submodule, with its branch and its origin (--json)
scompass board move [<name>]     # moves an older board to boards/<name> with its history; compass/ becomes a link, out of the project's index
scompass board link <name>       # on another computer, after cloning the board's repo into boards/<name>: creates the link
```

`board move` moves the markdown export to `compass/tareas.md` (inside the board) and leaves what wasn't committed uncommitted in the board; removing `compass/` from the project stays in its index to be committed. With the repo of all boards, the history goes in as one commit (the only one the app makes); with one repo per board, it doesn't commit anything. Don't run it while a hub or Home is serving the project.

## Projects on this computer

Every hub that starts records its project in `~/.config/scope-compass/projects.json` (on Windows, `%APPDATA%\scope-compass\projects.json`), so Home shows it even after it shuts down. Next to it, `chats/` keeps each project's chat conversations, and `devices.json` the phones linked to the chat, with the hash of their token (`scompass devices` lists them and `scompass devices rm <id>` unlinks one). You don't need to touch it to operate the board. A board in a temporary folder (`/tmp`, to try something out) isn't recorded on its own, and Home forgets, on startup, temporary ones that no longer exist; for tests, `SCOMPASS_CONFIG` and `SCOMPASS_REGISTRY` pointing to a folder of their own isolate everything.

```sh
scompass home list --json   # { "file", "projects": [ { "path", "name", "found", "hubs": [ { "pid", "port" } ] } ] }
scompass home add           # records this project without starting its hub (or: home add <folder>)
scompass home rm <folder>   # removes it from the registry; doesn't touch its data
scompass home               # starts Home (one per user): GET /api/today gathers what's overdue, due today and in progress, and what's due in the next 7 days (week)
```

## Language

The CLI, the MCP, the web, Home and the dock speak Spanish or English (§45). Messages and tool descriptions come out in the language of whoever uses the app; the board's data (titles, notes) stays as it was written.

- `scompass lang` says which one is used; `scompass lang es|en` sets it for the CLI, the web and Home (in `~/.config/scope-compass/settings.json`), and `scompass lang auto` goes back to following the system (`LANG`) and the browser. `SCOMPASS_LANG=es|en` wins over everything (for tests). The dock follows the Godot editor, or the `scope_compass/language` setting in the editor settings.
- `config.json › language` (`es` or `en`) is the board's language: that of this guide, `compass/README.md`, the markdown export and what the template brings. `init` sets it from the interface language (`--lang` chooses it); without it, `es`. If you change it by hand, `scompass update` switches this guide to the other language (the README stays as it is).

## More

- `scompass --help`: all commands. A new project is created with `scompass init --template juego|personal|vacio|clean-room` (or `game|personal|empty`; `clean-room`: a clean-room reimplementation, with its rules in `docs/clean-room.md` and example forbidden patterns).
- `compass/README.md`: file format and manual handling with git.
- `compass/schema/`: JSON Schema for tasks, milestones, lists, playtest sessions and `config.json` (`views` picks the web's tabs: `board`, `lists`, `playtest`, `decisions`, `docs`, `files`).
- Web settings (the gear on the board and on Home): preferences of whoever is looking, saved in their browser and not in `compass/`. For now, fantasy borders: pixel-art frames on buttons, cards and panels, always with the dark theme.
- **Versions:** `scompass`, the Godot addon and the MCP update separately and don't need the same version, only the same protocol (`protocol` in `/api/health`). If the CLI finds a hub for this project with another protocol, it doesn't use it: it writes directly to `compass/` and says so on stderr. It isn't an error; that hub was left by an old scompass and has to be restarted with the new one. The dock offers to download the scompass from the same release as the addon, and tells you when a new addon version comes out.
- `scompass update`: brings `compass/schema/`, this guide and `compass/.gitattributes` (LF on Windows too) up to date when Scope Compass was updated (`--check` only reports). The Godot dock offers it with the "Update" button, and the hub's tray with "Update compass/". `scompass update --all` (or "Update all" on Home) does the same in every project Home knows.
