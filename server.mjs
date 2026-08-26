import http from "node:http";
import path from "node:path";
import { checkout, lastCommit, listBranches, listWorktrees } from "./git.mjs";
import { nodeListeners, reapOrphans, serverFor, startServer, stopServer } from "./servers.mjs";
import { page } from "./page.mjs";

function collect(config) {
  const listeners = nodeListeners();
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
      };
    }),
    branches: listBranches(repo, worktrees),
  }));
}

function handleAction(config, req, res) {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    let action, repoPath, worktreePath, branch;
    try {
      ({ action, repo: repoPath, path: worktreePath, branch } = JSON.parse(body));
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
      return respond(200, {});
    }
    if (action === "stop") {
      stopServer(repo, worktreePath, worktrees);
      return respond(200, {});
    }
    respond(400, { error: "unknown action" });
  });
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
