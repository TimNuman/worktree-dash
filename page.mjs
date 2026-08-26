export const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Worktree Dash</title>
<style>
  :root { color-scheme: light dark; }
  body {
    font-family: ui-sans-serif, system-ui, sans-serif;
    max-width: 640px;
    margin: 3rem auto;
    padding: 0 1rem;
    background: light-dark(#fafafa, #1a1a1e);
    color: light-dark(#1a1a1e, #eaeaea);
  }
  h1 { font-size: 1.2rem; font-weight: 600; }
  h2 { font-size: 1rem; font-weight: 600; margin-top: 2rem; }
  section + section { margin-top: 3rem; }
  ul { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
  li {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    border-radius: 10px;
    background: light-dark(#fff, #26262b);
    border: 1px solid light-dark(#e4e4e7, #3a3a40);
  }
  .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
  .up { background: #22c55e; }
  .down { background: light-dark(#d4d4d8, #52525b); }
  .branch { font-weight: 600; }
  .name { color: light-dark(#71717a, #a1a1aa); font-size: 0.85rem; }
  .info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.15rem; }
  .top { display: flex; align-items: baseline; gap: 0.5rem; }
  .commit {
    color: light-dark(#71717a, #a1a1aa);
    font-size: 0.8rem;
    overflow-wrap: anywhere;
  }
  .hash { font-family: ui-monospace, monospace; color: light-dark(#a1a1aa, #6b6b74); }
  .counts { font-size: 0.8rem; font-variant-numeric: tabular-nums; }
  .ahead { color: #22c55e; }
  .behind { color: light-dark(#a1a1aa, #6b6b74); }
  .age { color: light-dark(#a1a1aa, #6b6b74); font-size: 0.8rem; margin-left: auto; }
  #msg { color: light-dark(#dc2626, #f87171); font-size: 0.85rem; min-height: 1.2rem; margin-top: 0.75rem; white-space: pre-wrap; }
  a { color: light-dark(#2563eb, #7ab8ff); text-decoration: none; font-variant-numeric: tabular-nums; }
  a:hover { text-decoration: underline; }
  .noport { color: light-dark(#a1a1aa, #6b6b74); font-size: 0.9rem; }
  button {
    font: inherit;
    font-size: 0.8rem;
    padding: 0.25rem 0.7rem;
    border-radius: 7px;
    border: 1px solid light-dark(#d4d4d8, #4a4a52);
    background: light-dark(#f4f4f5, #303036);
    color: inherit;
    cursor: pointer;
  }
  button:hover { background: light-dark(#e4e4e7, #3a3a42); }
  button:disabled { opacity: 0.5; cursor: default; }
</style>
</head>
<body>
<div id="root"></div>
<div id="msg"></div>
<script>
const pending = new Set();

function esc(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

function commitLine(row) {
  if (!row.hash) return "";
  return '<div class="commit"><span class="hash">' + esc(row.hash) + "</span> " + esc(row.subject) + "</div>";
}

function worktreeItem(row) {
  const link = row.port
    ? '<a href="http://localhost:' + row.port + '" target="_blank">localhost:' + row.port + "</a>"
    : '<span class="noport">no server</span>';
  const name = row.isMain ? "" : '<span class="name">' + esc(row.name) + "</span>";
  const busy = pending.has(row.path);
  const button = busy
    ? "<button disabled>…</button>"
    : '<button data-action="' + (row.up ? "stop" : "start") + '">' + (row.up ? "stop" : "start") + "</button>";
  return (
    '<li data-path="' + esc(row.path) + '"><span class="dot ' + (row.up ? "up" : "down") + '"></span>' +
    '<div class="info"><div class="top"><span class="branch">' + esc(row.branch) + "</span>" + name + "</div>" +
    commitLine(row) + "</div>" + link + button + "</li>"
  );
}

function branchItem(branch) {
  const counts =
    '<span class="counts"><span class="ahead">+' + (branch.ahead ?? "?") + "</span> " +
    '<span class="behind">−' + (branch.behind ?? "?") + "</span></span>";
  return (
    '<li data-branch="' + esc(branch.name) + '"><div class="info">' +
    '<div class="top"><span class="branch">' + esc(branch.name) + "</span>" + counts +
    '<span class="age">' + esc(branch.age) + "</span></div>" + commitLine(branch) + "</div>" +
    '<button data-action="checkout">checkout</button></li>'
  );
}

function render(data) {
  document.getElementById("root").innerHTML = data.repos
    .map((repo) =>
      '<section data-repo="' + esc(repo.path) + '">' +
      "<h1>" + esc(repo.name) + "</h1>" +
      "<ul>" + repo.worktrees.map(worktreeItem).join("") + "</ul>" +
      "<h2>Branches</h2>" +
      "<ul>" + repo.branches.map(branchItem).join("") + "</ul>" +
      "</section>",
    )
    .join("");
}

async function refresh() {
  const data = await fetch("/data").then((r) => r.json());
  render(data);
}

async function act(action, repo, path, button) {
  button.disabled = true;
  button.textContent = action === "start" ? "starting…" : "stopping…";
  pending.add(path);
  await fetch("/action", { method: "POST", body: JSON.stringify({ action, repo, path }) });
  setTimeout(() => {
    pending.delete(path);
    refresh();
  }, action === "start" ? 4000 : 1500);
}

async function checkout(repo, branch, button) {
  button.disabled = true;
  button.textContent = "checking out…";
  const response = await fetch("/action", { method: "POST", body: JSON.stringify({ action: "checkout", repo, branch }) });
  const result = await response.json();
  document.getElementById("msg").textContent = result.error ?? "";
  refresh();
}

document.getElementById("root").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const repo = button.closest("section").dataset.repo;
  const item = button.closest("li");
  if (button.dataset.action === "checkout") {
    checkout(repo, item.dataset.branch, button);
  } else {
    act(button.dataset.action, repo, item.dataset.path, button);
  }
});

refresh();
setInterval(refresh, 3000);
</script>
</body>
</html>`;
