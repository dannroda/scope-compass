# Scope Compass plugin for Claude Code

A skill that gets Claude Code working on a [Scope Compass](https://github.com/dannroda/scope-compass) board: it reads the project's `compass/AGENTS.md`, uses the `scompass` MCP tools (or the CLI) instead of editing the JSON, and follows the task workflow: in progress, steps, decisions, review.

## Install

```
/plugin marketplace add dannroda/scope-compass
/plugin install scope-compass@scope-compass
```

It is also listed in the [godot-agent](https://github.com/dannroda/godot-agent-plugins) marketplace.

The plugin does not bring the `scompass` binary or register its MCP server: download the binary from the [releases](https://github.com/dannroda/scope-compass/releases/latest), run it once, and run `scompass mcp install`. That registers the server for every project with the binary's full path, so it does not need to be on the `PATH`. If you skip it, the skill tells Claude to do it.

## Versions

The plugin's version is the Scope Compass version: `tools/release.mjs bump` raises it with the hub and the addon, so `claude plugin update` (or auto-update) only sees a change on each release. The skill itself says little; the rules are in `compass/AGENTS.md`, which `scompass update` refreshes for each board.
