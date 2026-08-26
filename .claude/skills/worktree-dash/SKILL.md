---
name: worktree-dash
description: How worktree-dash works — module map, the lsof/ps discovery model and its invariants, the HTTP API, and how to test changes. Load BEFORE changing worktree-dash code, or when integrating other tooling with its /action API or status command.
---

# worktree-dash architecture

Zero-dependency Node CLI serving a dashboard on localhost:2999 (default). No build step, plain ESM.

## Module map

- `bin.mjs` — entry. `worktree-dash` serves; `worktree-dash status` prints dev-server/watcher state for the worktree containing cwd (standalone, no server needed — made for agent hooks).
- `config.mjs` — loads `~/.config/worktree-dash.json`; falls back to the git repo at cwd. Normalizes repos: `path`, `appDir`, `mainPort` (3000), `portRange` ([3001, 3099]), `startCommand`, `processes[]` ({name, command, autostart} — tracked watchers, run in appDir), `actions[]` ({name, command} — one-off buttons, run detached in the worktree ROOT, e.g. `code .`).
- `git.mjs` — worktrees (`worktree list --porcelain`), last commits, branch list with ahead/behind vs `baseRef()` (origin/HEAD, falls back main/master), checkout.
- `servers.mjs` — dev servers: lsof discovery, start (env copy + node_modules symlink + port pick + detached spawn), stop, orphan reaping.
- `processes.mjs` — configured background watchers: pid registry + ps discovery, group kill, log files (`~/.cache/worktree-dash/logs/<repo>-<worktree>-<name>.log`; dev server logs as name `dev`), `readLogTail` (ANSI-stripped).
- `status.mjs` — the `status` subcommand's report.
- `server.mjs` — HTTP: `/` page, `/data`, `POST /action`, `/log?repo&path&name`. Validates every action against live git/config state (never trust client paths).
- `page.mjs` — the whole UI as ONE JS template literal. Client script inside must use string concatenation, never backticks or `${}` — they would interpolate in the outer literal.

## Discovery model (no state files — this is the core design)

Everything is derived live; nothing is persisted about running processes.

- **Dev servers** = node processes LISTENING on a TCP port (lsof), matched to a worktree by process **cwd**.
  - Ownership is **longest-prefix match** (`owningWorktree`): worktrees nest under the main checkout at `<repo>/.claude/worktrees/`, so a plain prefix match wrongly assigns every worktree server to main.
  - Only ports inside the dev range count — stray tooling processes on random high ports must not surface as servers.
  - A listener existing IS liveness; there is no separate port probe.
- **Watchers** (processes.mjs) don't listen on ports. Tracking = in-memory pid registry, with **ps + cwd discovery** as fallback so a dashboard restart still finds them (prevents duplicate watchers).
  - Discovery matches the configured command OR its args-tail (command minus first word). Required because `sh -c "npx tsc --watch"` **execs into** `npm exec tsc --watch` — the literal command disappears from the process title.
  - Spawns are `detached: true` → the child is a process-group leader; stop kills the group (`process.kill(-pid)`, fallback `kill(pid)`).
- **Stopping the main checkout** must skip cwds under `<repo>/.claude/` — otherwise it kills the nested worktree servers. Apply that guard ONLY for the main path, or stopping worktrees breaks (they live under `.claude/worktrees/` themselves).
- Orphan reaping (60s + each `/data`): listeners whose cwd is under `.claude/worktrees/` but not under any live worktree get killed.

## Consumers

External tooling scripts against this: repo hooks that provision worktrees POST `{action:"start"}` to `/action` (autostart processes ride along), and agent session hooks inject `worktree-dash status` output as context. Treat `/action` and the `status` output format as public API — keep them backward compatible.

## Testing changes

`node --check` every touched .mjs, restart (`kill $(lsof -nP -tiTCP:2999 -sTCP:LISTEN); nohup worktree-dash &`), then curl:

- `curl -s localhost:2999/data | jq` — worktrees, branches, processes all present?
- `POST /action` with a real repo/worktree path from /data; verify effect via lsof/ps, not just the 200.
- Watcher changes: also test the restart path (start watcher → restart dash → still `running:true` → stop → `ps` shows 0 leftovers).
- `cd <a worktree>/… && worktree-dash status` for the subcommand.
