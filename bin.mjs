#!/usr/bin/env node
import { loadConfig } from "./config.mjs";
import { startDashboard } from "./server.mjs";
import { statusReport } from "./status.mjs";

const args = process.argv.slice(2);
const config = loadConfig();

if (args[0] === "status") {
  const report = statusReport(config, process.cwd());
  if (!report) process.exit(1);
  console.log(report);
  process.exit(0);
}

const portFlag = args.indexOf("--port");
if (portFlag !== -1) config.port = Number(args[portFlag + 1]);

if (config.repos.length === 0) {
  console.error("No repos configured. Run inside a git repository or create ~/.config/worktree-dash.json:");
  console.error('{ "port": 2999, "repos": [{ "path": "~/Projects/my-repo", "appDir": "." }] }');
  process.exit(1);
}

startDashboard(config);
