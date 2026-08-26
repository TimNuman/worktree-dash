import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import path from "node:path";

const CONFIG_PATH = path.join(homedir(), ".config", "worktree-dash.json");

function expandHome(p) {
  return p.startsWith("~/") ? path.join(homedir(), p.slice(2)) : p;
}

function normalizeRepo(repo) {
  return {
    path: path.resolve(expandHome(repo.path)),
    appDir: repo.appDir ?? ".",
    mainPort: repo.mainPort ?? 3000,
    portRange: repo.portRange ?? [3001, 3099],
    startCommand: repo.startCommand ?? "npm run start",
    processes: (repo.processes ?? []).map((proc) => ({
      name: proc.name ?? proc.command,
      command: proc.command,
      autostart: proc.autostart ?? false,
    })),
  };
}

export function loadConfig() {
  let raw = null;
  try {
    raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {}

  const repos = (raw?.repos ?? []).map(normalizeRepo);
  if (repos.length === 0) {
    try {
      const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
      repos.push(normalizeRepo({ path: top }));
    } catch {}
  }
  return { port: raw?.port ?? 2999, repos };
}
