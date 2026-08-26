import { execFileSync } from "node:child_process";
import { readlinkSync, symlinkSync } from "node:fs";

const os = process.platform;

export function symlinkDir(target, linkPath) {
  symlinkSync(target, linkPath);
}

export function killTree(pid) {
  try {
    process.kill(-pid);
  } catch {
    try {
      process.kill(pid);
    } catch {}
  }
}

export function psSnapshot() {
  try {
    return execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
  } catch {
    return "";
  }
}

export function cwdOf(pid) {
  if (os === "linux") {
    try {
      return readlinkSync(`/proc/${pid}/cwd`);
    } catch {
      return null;
    }
  }
  try {
    const out = execFileSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { encoding: "utf8" });
    return out.split("\n").find((l) => l.startsWith("n"))?.slice(1) ?? null;
  } catch {
    return null;
  }
}

export function portInUse(port) {
  if (os === "linux") {
    try {
      return execFileSync("ss", ["-Htln", `sport = :${port}`], { encoding: "utf8" }).trim() !== "";
    } catch {
      return false;
    }
  }
  try {
    execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
    return true;
  } catch {
    return false;
  }
}

function listenerRecords(portsByPid) {
  const listeners = [];
  for (const [pid, ports] of portsByPid) {
    if (pid === process.pid) continue;
    listeners.push({ pid, ports: [...ports].sort((a, b) => a - b), cwd: cwdOf(pid), command: null });
  }
  return listeners;
}

function darwinListeners() {
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
  return listenerRecords(portsByPid);
}

function linuxListeners() {
  let out = "";
  try {
    out = execFileSync("ss", ["-Htlnp"], { encoding: "utf8" });
  } catch {
    return [];
  }
  const portsByPid = new Map();
  for (const line of out.split("\n")) {
    const owner = line.match(/users:\(\("([^"]+)",pid=(\d+)/);
    if (!owner || !owner[1].includes("node")) continue;
    const local = line.trim().split(/\s+/)[3] ?? "";
    const port = Number(local.slice(local.lastIndexOf(":") + 1));
    if (!Number.isFinite(port)) continue;
    const pid = Number(owner[2]);
    if (!portsByPid.has(pid)) portsByPid.set(pid, new Set());
    portsByPid.get(pid).add(port);
  }
  return listenerRecords(portsByPid);
}

export function nodeListeners() {
  return os === "linux" ? linuxListeners() : darwinListeners();
}
