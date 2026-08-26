import path from "node:path";
import { listWorktrees } from "./git.mjs";
import { nodeListeners, owningWorktree, serverFor } from "./servers.mjs";
import { logPath, processStatuses, psSnapshot } from "./processes.mjs";

export function statusReport(config, cwd) {
  for (const repo of config.repos) {
    if (cwd !== repo.path && !cwd.startsWith(repo.path + path.sep)) continue;
    const worktrees = listWorktrees(repo);
    const worktree = owningWorktree(cwd, worktrees);
    if (!worktree) return null;

    const server = serverFor(worktree.path, nodeListeners(), worktrees, repo);
    const lines = [`worktree: ${worktree.path} (branch ${worktree.branch ?? "detached"})`];
    lines.push(
      server
        ? `dev server: running on http://localhost:${server.port} — log: ${logPath(repo, worktree.path, "dev")}`
        : "dev server: not running",
    );
    const snapshot = psSnapshot();
    for (const proc of processStatuses(repo, worktree.path, snapshot)) {
      lines.push(
        proc.running
          ? `${proc.name}: running — log: ${logPath(repo, worktree.path, proc.name)}`
          : `${proc.name}: not running`,
      );
    }
    return lines.join("\n");
  }
  return null;
}
