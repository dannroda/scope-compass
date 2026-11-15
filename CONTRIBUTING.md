# Contributing

Thanks for your interest in Scope Compass. Bug reports and pull requests are welcome on GitHub. For a security problem, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Running from the repository

You need Node.js 22 or newer and git (Godot 4.8 for the addon).

```sh
(cd hub && npm install)        # once, and again after adding a dependency
node hub/bin/scompass.js --help   # from the repository root
```

`node hub/bin/scompass.js` behaves exactly like an installed `scompass`. On Linux, `tools/install.sh --dev` puts a `scompass` in `~/.local/bin` that runs the repository's `hub/bin/scompass.js` (no packaging step) and adds the Home launcher to the applications menu. After changing hub code, restart running hubs with `scompass restart` and Home with `scompass home restart`.

The repository is also a Godot 4.8 project, so the addon can be developed inside the editor: open `project.godot` and add `js,html,css,json,md` to *Editor Settings › Docks › FileSystem › TextFile Extensions* to edit the rest from there too.

`node tools/build.mjs` builds the npm package, the addon zip and the standalone binary for the current platform into `dist/` (the binary needs Node 25.5 or newer). The versions in `hub/package.json` and `addons/scope_compass/plugin.cfg` must match.

## Tests

```sh
cd hub && npm test                                  # everything
cd hub && node scripts/run-tests.js test/cli.test.js   # one file
```

Always go through `npm test` or `scripts/run-tests.js`, not plain `node --test`: the runner gives the tests their own registry, config and data folders, so they never touch your real `~/.config/scope-compass/` or `~/.local/share/scope-compass/`.

The dock tests launch Godot headless (`GODOT`, or `godot` on the `PATH`) and are skipped when there is none; the game screenshot test also needs `xvfb-run`. See [`hub/README.md`](hub/README.md) for details.

## Style

- The documentation in `docs/`, the UI, the CLI messages and the code comments are in Spanish (Rioplatense). Keep new text in the same language as its surroundings. The top-level README has an English and a Spanish version: change both.
- Commit messages are in Spanish, one descriptive line (see `git log --oneline`).
- No build step for the web UI and few dependencies: prefer what Node and the platform already provide.

## When you change a feature

Update the documentation in the same commit:

- **`AGENTS.md`**, the guide for agents working on a board. The source is `hub/templates/compass-AGENTS.md`; `addons/scope_compass/AGENTS.md` must be an identical copy (a test in `hub/test/cli.test.js` checks it), and boards pick up the new version with `scompass update` (also the `compass/AGENTS.md` of any board you use for this repository).
- **`docs/spec.md`**: what the feature does and its acceptance criteria.
- **`docs/decisiones.md`**: a new entry when you choose between reasonable alternatives (what, why, what was discarded).
- **`CHANGELOG.md`**: a line under `## [Unreleased]`.
- **`docs/instalar.md`** and both READMEs, if installation or first use changes.
