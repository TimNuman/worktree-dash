import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, openSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const LOG_DIR = path.join(homedir(), ".cache", "worktree-dash", "logs");

export function nodeListeners() {
  let out = "";
  try {
    out = execFileSync("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-a", "-c", "node", "-Fpn"], { encoding: "utf8" });
  } catch {
    return [];
  }
  const portsByPid = new Map();
  let pid = null;
  for (const line of out.split("\n")) {
    if (line.startsWith("p")) {
      pid = Number(line.slice(1));
      if (!portsByPid.has(pid)) portsByPid.set(pid, new Set());
    } else if (line.startsWith("n") && pid !== null) {
      const port = Number(line.slice(line.lastIndexOf(":") + 1));
      if (Number.isFinite(port)) portsByPid.get(pid).add(port);
    }
  }
  const listeners = [];
  for (const [listenerPid, ports] of portsByPid) {
    if (listenerPid === process.pid) continue;
    let cwd = null;
    try {
      const out = execFileSync("lsof", ["-a", "-p", String(listenerPid), "-d", "cwd", "-Fn"], { encoding: "utf8" });
      cwd = out.split("\n").find((l) => l.startsWith("n"))?.slice(1) ?? null;
    } catch {}
    listeners.push({ pid: listenerPid, ports: [...ports].sort((a, b) => a - b), cwd });
  }
  return listeners;
}

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

function portInUse(port) {
  try {
    execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
    return true;
  } catch {
    return false;
  }
}

export function startServer(repo, worktreePath, worktrees) {
  const appDir = path.join(worktreePath, repo.appDir);
  if (!existsSync(appDir)) return;

  const envExample = path.join(appDir, ".env.example");
  const envFile = path.join(appDir, ".env");
  if (existsSync(envExample) && !existsSync(envFile)) copyFileSync(envExample, envFile);

  const nodeModules = path.join(appDir, "node_modules");
  const mainNodeModules = path.join(repo.path, repo.appDir, "node_modules");
  if (!existsSync(nodeModules) && existsSync(mainNodeModules)) symlinkSync(mainNodeModules, nodeModules);

  if (serverFor(worktreePath, nodeListeners(), worktrees, repo)) return;

  const isMain = worktreePath === repo.path;
  const [firstPort, lastPort] = repo.portRange;
  const candidates = isMain ? [repo.mainPort] : [];
  for (let p = firstPort; p <= lastPort; p++) candidates.push(p);
  const port = candidates.find((p) => !portInUse(p));
  if (!port) return;

  mkdirSync(LOG_DIR, { recursive: true });
  const logName = `${path.basename(repo.path)}-${path.basename(worktreePath)}.log`;
  const log = openSync(path.join(LOG_DIR, logName), "a");
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
    try {
      process.kill(listener.pid);
    } catch {}
  }
}

export function reapOrphans(listeners, reposWithWorktrees) {
  for (const { repo, worktrees } of reposWithWorktrees) {
    const worktreesDir = path.join(repo.path, ".claude", "worktrees") + path.sep;
    for (const listener of listeners) {
      if (!listener.cwd?.startsWith(worktreesDir)) continue;
      const owned = worktrees.some((wt) => listener.cwd === wt.path || listener.cwd.startsWith(`${wt.path}/`));
      if (!owned) {
        try {
          process.kill(listener.pid);
        } catch {}
      }
    }
  }
}
