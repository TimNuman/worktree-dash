import http from "node:http";
import path from "node:path";
import { checkout, lastCommit, listBranches, listWorktrees } from "./git.mjs";
import { nodeListeners, reapOrphans, serverFor, startServer, stopServer } from "./servers.mjs";
import { processStatuses, psSnapshot, readLogTail, startProcess, stopProcess } from "./processes.mjs";
import { page } from "./page.mjs";

function collect(config) {
  const listeners = nodeListeners();
  const snapshot = psSnapshot();
  const reposWithWorktrees = config.repos.map((repo) => ({ repo, worktrees: listWorktrees(repo) }));
  reapOrphans(listeners, reposWithWorktrees);

  return reposWithWorktrees.map(({ repo, worktrees }) => ({
    name: path.basename(repo.path),
    path: repo.path,
    worktrees: worktrees.map((wt) => {
      const isMain = wt.path === repo.path;
      const server = serverFor(wt.path, listeners, worktrees, repo);
      return {
        name: isMain ? "main checkout" : wt.path.split("/").pop(),
        path: wt.path,
        branch: wt.branch ?? "(detached)",
        ...lastCommit(wt.path),
        port: server?.port ?? null,
        up: server !== null,
        isMain,
        processes: processStatuses(repo, wt.path, snapshot),
      };
    }),
    branches: listBranches(repo, worktrees),
  }));
}

function handleAction(config, req, res) {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    let action, repoPath, worktreePath, branch, name;
    try {
      ({ action, repo: repoPath, path: worktreePath, branch, name } = JSON.parse(body));
    } catch {}

    const respond = (status, payload) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };

    const repo = config.repos.find((r) => r.path === repoPath);
    if (!repo) return respond(400, { error: "unknown repo" });
    const worktrees = listWorktrees(repo);

    if (action === "checkout") {
      const known = listBranches(repo, worktrees).some((b) => b.name === branch);
      if (!known) return respond(400, { error: "unknown branch" });
      const result = checkout(repo, branch);
      return respond(result.error ? 409 : 200, result);
    }

    if (!worktrees.some((wt) => wt.path === worktreePath)) return respond(400, { error: "unknown worktree" });

    if (action === "start") {
      startServer(repo, worktreePath, worktrees);
      for (const proc of repo.processes.filter((p) => p.autostart)) startProcess(repo, worktreePath, proc);
      return respond(200, {});
    }
    if (action === "stop") {
      stopServer(repo, worktreePath, worktrees);
      return respond(200, {});
    }
    if (action === "proc-start" || action === "proc-stop") {
      const proc = repo.processes.find((p) => p.name === name);
      if (!proc) return respond(400, { error: "unknown process" });
      if (action === "proc-start") startProcess(repo, worktreePath, proc);
      else stopProcess(repo, worktreePath, proc);
      return respond(200, {});
    }
    respond(400, { error: "unknown action" });
  });
}

function handleLog(config, req, res) {
  const url = new URL(req.url, "http://localhost");
  const repo = config.repos.find((r) => r.path === url.searchParams.get("repo"));
  const worktreePath = url.searchParams.get("path");
  const name = url.searchParams.get("name");

  const valid =
    repo &&
    listWorktrees(repo).some((wt) => wt.path === worktreePath) &&
    (name === "dev" || repo.processes.some((p) => p.name === name));
  if (!valid) {
    res.writeHead(400, { "content-type": "text/plain" });
    res.end("unknown log");
    return;
  }
  const tail = readLogTail(repo, worktreePath, name);
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  res.end(tail ?? "(no output captured — process was started outside worktree-dash)");
}

export function startDashboard(config) {
  setInterval(() => {
    try {
      const reposWithWorktrees = config.repos.map((repo) => ({ repo, worktrees: listWorktrees(repo) }));
      reapOrphans(nodeListeners(), reposWithWorktrees);
    } catch {}
  }, 60000);

  http
    .createServer((req, res) => {
      if (req.method === "POST" && req.url === "/action") {
        handleAction(config, req, res);
      } else if (req.url.startsWith("/log?")) {
        handleLog(config, req, res);
      } else if (req.url === "/data") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ repos: collect(config) }));
      } else {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(page);
      }
    })
    .listen(config.port, "127.0.0.1", () => {
      console.log(`worktree-dash on http://localhost:${config.port}`);
    });
}
