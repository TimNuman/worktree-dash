import { execFileSync, spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const LOG_DIR = path.join(homedir(), ".cache", "worktree-dash", "logs");
const registry = new Map();

function registryKey(worktreePath, name) {
  return `${worktreePath}\0${name}`;
}

export function logPath(repo, worktreePath, name) {
  return path.join(LOG_DIR, `${path.basename(repo.path)}-${path.basename(worktreePath)}-${name}.log`);
}

export function openLog(repo, worktreePath, name) {
  mkdirSync(LOG_DIR, { recursive: true });
  return openSync(logPath(repo, worktreePath, name), "a");
}

export function readLogTail(repo, worktreePath, name, bytes = 65536) {
  try {
    const file = logPath(repo, worktreePath, name);
    const { size } = statSync(file);
    const start = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(size - start);
    const fd = openSync(file, "r");
    readSync(fd, buffer, 0, buffer.length, start);
    closeSync(fd);
    return buffer.toString("utf8").replace(/\x1b\[[0-9;?]*[a-zA-Z]|\x1bc/g, "");
  } catch {
    return null;
  }
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function cwdOf(pid) {
  try {
    const out = execFileSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { encoding: "utf8" });
    return out.split("\n").find((l) => l.startsWith("n"))?.slice(1) ?? null;
  } catch {
    return null;
  }
}

export function psSnapshot() {
  try {
    return execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
  } catch {
    return "";
  }
}

function discover(command, appDir, snapshot) {
  const argsTail = command.split(" ").slice(1).join(" ");
  const matchers = [command, argsTail].filter(Boolean);
  const candidates = [];
  for (const line of snapshot.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(.*)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    if (pid === process.pid) continue;
    if (!matchers.some((m) => match[2].includes(m))) continue;
    candidates.push(pid);
  }
  candidates.sort((a, b) => a - b);
  return candidates.find((pid) => cwdOf(pid) === appDir) ?? null;
}

function findPid(repo, worktreePath, proc, snapshot) {
  const key = registryKey(worktreePath, proc.name);
  const tracked = registry.get(key);
  if (tracked && alive(tracked)) return tracked;
  registry.delete(key);
  const appDir = path.join(worktreePath, repo.appDir);
  const found = discover(proc.command, appDir, snapshot ?? psSnapshot());
  if (found) registry.set(key, found);
  return found;
}

export function processStatuses(repo, worktreePath, snapshot) {
  return repo.processes.map((proc) => ({
    name: proc.name,
    autostart: proc.autostart,
    running: findPid(repo, worktreePath, proc, snapshot) !== null,
  }));
}

export function startProcess(repo, worktreePath, proc) {
  if (findPid(repo, worktreePath, proc)) return;
  const appDir = path.join(worktreePath, repo.appDir);
  const log = openLog(repo, worktreePath, proc.name);
  const child = spawn(proc.command, {
    cwd: appDir,
    shell: true,
    detached: true,
    stdio: ["ignore", log, log],
  });
  child.unref();
  registry.set(registryKey(worktreePath, proc.name), child.pid);
}

export function stopProcess(repo, worktreePath, proc) {
  const pid = findPid(repo, worktreePath, proc);
  if (!pid) return;
  try {
    process.kill(-pid);
  } catch {
    try {
      process.kill(pid);
    } catch {}
  }
  registry.delete(registryKey(worktreePath, proc.name));
}
