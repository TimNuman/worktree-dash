# worktree-dash

Local dashboard for git worktrees on `http://localhost:2999`: every worktree with its branch, last commit, and dev server (port, liveness, start/stop), plus all other local branches with ahead/behind counts against the default branch and a one-click checkout into the main folder.

Dev servers are discovered live via `lsof` — node processes listening on a dev port, matched to worktrees by working directory. No state files. Servers whose worktree has been deleted are killed automatically.

Zero dependencies. macOS (relies on `lsof`).

## Install

```sh
git clone https://github.com/TimNuman/worktree-dash.git
cd worktree-dash
npm link
```

## Usage

```sh
worktree-dash            # uses ~/.config/worktree-dash.json, or the git repo you're in
worktree-dash --port 4000
```

## Config

`~/.config/worktree-dash.json`:

```json
{
  "port": 2999,
  "repos": [
    {
      "path": "~/Projects/my-monorepo",
      "appDir": "apps/web",
      "mainPort": 3000,
      "portRange": [3001, 3099],
      "startCommand": "npm run start"
    }
  ]
}
```

- `appDir` — folder (relative to the repo root) where the dev server runs; defaults to the repo root.
- `mainPort` — preferred port for the main checkout; worktrees get the first free port in `portRange`.
- `startCommand` — run with `PORT` set, detached; logs land in `~/.cache/worktree-dash/logs/`.

Starting a worktree server also copies `appDir/.env.example` to `.env` if missing and symlinks the main checkout's `node_modules` into the worktree. Multiple repos each get their own section on the page.
