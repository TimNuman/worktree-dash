import { execFileSync } from "node:child_process";

function git(repoPath, args) {
  return execFileSync("git", ["-C", repoPath, ...args], { encoding: "utf8" });
}

export function listWorktrees(repo) {
  const worktrees = [];
  let current = null;
  for (const line of git(repo.path, ["worktree", "list", "--porcelain"]).split("\n")) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice("worktree ".length), branch: null };
      worktrees.push(current);
    } else if (line.startsWith("branch ") && current) {
      current.branch = line.slice("branch ".length).replace("refs/heads/", "");
    }
  }
  return worktrees;
}

export function lastCommit(worktreePath) {
  try {
    const out = git(worktreePath, ["log", "-1", "--format=%h%x00%s"]);
    const [hash, subject] = out.trim().split("\0");
    return { hash, subject };
  } catch {
    return { hash: null, subject: null };
  }
}

export function baseRef(repo) {
  try {
    const head = git(repo.path, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]).trim();
    return head.replace("refs/remotes/", "");
  } catch {}
  for (const ref of ["origin/main", "origin/master", "main", "master"]) {
    try {
      git(repo.path, ["rev-parse", "--verify", "--quiet", ref]);
      return ref;
    } catch {}
  }
  return "HEAD";
}

export function listBranches(repo, worktrees) {
  const checkedOut = new Set(worktrees.map((wt) => wt.branch).filter(Boolean));
  const base = baseRef(repo);
  const out = git(repo.path, [
    "for-each-ref", "refs/heads", "--sort=-committerdate",
    "--format=%(refname:short)%00%(objectname:short)%00%(subject)%00%(committerdate:relative)",
  ]);

  const branches = [];
  for (const line of out.split("\n")) {
    if (!line) continue;
    const [name, hash, subject, age] = line.split("\0");
    if (checkedOut.has(name)) continue;
    let ahead = null;
    let behind = null;
    try {
      const counts = git(repo.path, ["rev-list", "--left-right", "--count", `${base}...${name}`]);
      [behind, ahead] = counts.trim().split("\t").map(Number);
    } catch {}
    branches.push({ name, hash, subject, age, ahead, behind });
  }
  return branches;
}

export function checkout(repo, branch) {
  try {
    execFileSync("git", ["-C", repo.path, "checkout", branch], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return {};
  } catch (error) {
    return { error: (error.stderr ?? String(error)).trim() };
  }
}
