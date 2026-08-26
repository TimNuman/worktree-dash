#!/usr/bin/env node
import { loadConfig } from "./config.mjs";
import { startDashboard } from "./server.mjs";

const args = process.argv.slice(2);
const portFlag = args.indexOf("--port");
const config = loadConfig();
if (portFlag !== -1) config.port = Number(args[portFlag + 1]);

if (config.repos.length === 0) {
  console.error("No repos configured. Run inside a git repository or create ~/.config/worktree-dash.json:");
  console.error('{ "port": 2999, "repos": [{ "path": "~/Projects/my-repo", "appDir": "." }] }');
  process.exit(1);
}

startDashboard(config);
