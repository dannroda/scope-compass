# Security

## Supported versions

Security fixes go into the latest release. There are no long-term support branches.

## How Scope Compass is exposed

Scope Compass is a local app with no accounts and no authentication. Its safety rests on who can reach the hub:

- **By default the hub and Home listen only on `127.0.0.1`.** Other machines cannot reach them. Any program running on your machine can, as with most local development servers.
- **Requests from web pages are filtered.** The hub only answers requests addressed to `localhost` or to an IP address, so a website that points its own domain name at your machine (DNS rebinding) cannot read the board or the repository's files. Requests and WebSocket connections that carry an `Origin` from a different page are refused, so another site cannot write to the board (CSRF).
- **`--lan` has no login.** With `scompass serve --lan`, `scompass home --lan` or "Activar acceso en la red" in the tray, the hub also listens on your network interfaces. Anyone on that network can then view and edit your boards and read the files of your projects' repositories through the web UI. Use it only on a network you trust, such as your home network, never on public or shared Wi-Fi. Turn it off when you do not need it.
- **The chat works only from the same machine.** The chat panel runs the Claude Code installed on your machine, with your account. The hub refuses chat requests that do not come from `127.0.0.1` or `::1`, also when `--lan` is on. Claude Code runs there with read-only file tools and the board's MCP tools: it cannot edit files or run commands from the web UI.
- **The board data is plain files.** Boards live in your user data folder (or inside a project, if you chose that). Whoever can read those folders, or the git remotes you push them to, can read your boards.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: on the repository, go to **Security › Report a vulnerability** to open a private security advisory (https://github.com/dannroda/scope-compass/security/advisories/new). Do not open a public issue for a security problem.

Include what you found, the version (the one in the name of the release file you downloaded, or the commit if you run from the repository), your operating system and the steps to reproduce it. You will get an answer on the advisory; once a fix is released, the advisory is published with credit to you unless you prefer otherwise.
