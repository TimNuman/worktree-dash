import { spawn } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { killTree, nodeListeners, portInUse, symlinkDir } from "./platform.mjs";
import { openLog } from "./processes.mjs";

export { nodeListeners };

function devRange(repo) {
  return [Math.min(repo.mainPort, repo.portRange[0]), repo.portRange[1]];
}

function devPortOf(listener, repo) {
  const [low, high] = devRange(repo);
  return listener.ports.find((p) => p >= low && p <= high) ?? null;
}

export function owningWorktree(cwd, worktrees) {
  let owner = null;
  for (const wt of worktrees) {
    if (cwd !== wt.path && !cwd.startsWith(`${wt.path}/`)) continue;
    if (!owner || wt.path.length > owner.path.length) owner = wt;
  }
  return owner;
}

export function serverFor(worktreePath, listeners, worktrees, repo) {
  const match = listeners.find(
    (l) => l.cwd && owningWorktree(l.cwd, worktrees)?.path === worktreePath && devPortOf(l, repo) !== null,
  );
  if (!match) return null;
  return { pid: match.pid, port: devPortOf(match, repo) };
}

export function startServer(repo, worktreePath, worktrees) {
  const appDir = path.join(worktreePath, repo.appDir);
  if (!existsSync(appDir)) return;

  const envExample = path.join(appDir, ".env.example");
  const envFile = path.join(appDir, ".env");
  if (existsSync(envExample) && !existsSync(envFile)) copyFileSync(envExample, envFile);

  const nodeModules = path.join(appDir, "node_modules");
  const mainNodeModules = path.join(repo.path, repo.appDir, "node_modules");
  if (!existsSync(nodeModules) && existsSync(mainNodeModules)) symlinkDir(mainNodeModules, nodeModules);

  if (serverFor(worktreePath, nodeListeners(), worktrees, repo)) return;

  const isMain = worktreePath === repo.path;
  const [firstPort, lastPort] = repo.portRange;
  const candidates = isMain ? [repo.mainPort] : [];
  for (let p = firstPort; p <= lastPort; p++) candidates.push(p);
  const port = candidates.find((p) => !portInUse(p));
  if (!port) return;

  const log = openLog(repo, worktreePath, "dev");
  const child = spawn(repo.startCommand, {
    cwd: appDir,
    shell: true,
    detached: true,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", log, log],
  });
  child.unref();
}

export function stopServer(repo, worktreePath, worktrees) {
  const isMain = worktreePath === repo.path;
  const claudeDir = path.join(repo.path, ".claude") + path.sep;
  for (const listener of nodeListeners()) {
    if (!listener.cwd || devPortOf(listener, repo) === null) continue;
    if (owningWorktree(listener.cwd, worktrees)?.path !== worktreePath) continue;
    if (isMain && listener.cwd.startsWith(claudeDir)) continue;
    killTree(listener.pid);
  }
}

export function reapOrphans(listeners, reposWithWorktrees) {
  for (const { repo, worktrees } of reposWithWorktrees) {
    const worktreesDir = path.join(repo.path, ".claude", "worktrees") + path.sep;
    for (const listener of listeners) {
      if (!listener.cwd?.startsWith(worktreesDir)) continue;
      const owned = worktrees.some((wt) => listener.cwd === wt.path || listener.cwd.startsWith(`${wt.path}/`));
      if (!owned) killTree(listener.pid);
    }
  }
}
