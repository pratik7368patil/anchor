#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { printInitResult, runInit } from "./commands/init.js";
import { runIndex } from "./commands/index.js";
import { runSync } from "./commands/sync.js";
import { runDoctorCommand } from "./commands/doctor.js";
import { runServe } from "./commands/serve.js";

const program = new Command();

function readPackageVersion(): string {
  try {
    const packageJsonPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { version?: string };
    return packageJson.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

program
  .name("anchor")
  .description("Anchor: local-first Cursor MCP context from GitHub PR history")
  .version(readPackageVersion());

program
  .command("init")
  .description("Configure Cursor to run Anchor for this repository")
  .action(() => {
    const result = runInit(process.cwd());
    printInitResult(result);
  });

program
  .command("index")
  .description("Fetch merged GitHub PRs and build the local Anchor index")
  .option("--repo <owner/name>", "GitHub repository to index")
  .option("--limit <number>", "Maximum merged PRs to fetch", (value) => Number.parseInt(value, 10), 200)
  .option("--since <YYYY-MM-DD>", "Fetch PRs updated since this date")
  .option("--force", "Rebuild the local database before indexing")
  .action(async (options) => {
    await runIndex(process.cwd(), options);
  });

program
  .command("sync")
  .description("Incrementally sync PRs updated since the last Anchor sync")
  .option("--repo <owner/name>", "GitHub repository to sync")
  .option("--limit <number>", "Maximum merged PRs to fetch", (value) => Number.parseInt(value, 10), 200)
  .option("--since <YYYY-MM-DD>", "Override the sync cursor")
  .option("--force", "Rebuild the local database before syncing")
  .action(async (options) => {
    await runSync(process.cwd(), options);
  });

program
  .command("doctor")
  .description("Check local Anchor, Cursor, GitHub, and SQLite setup")
  .action(async () => {
    const ok = await runDoctorCommand(process.cwd());
    if (!ok) process.exitCode = 1;
  });

program
  .command("serve")
  .description("Start the Anchor MCP stdio server")
  .action(async () => {
    await runServe(process.cwd());
  });

const argv =
  process.argv[2] === "--"
    ? [process.argv[0] ?? "node", process.argv[1] ?? "anchor", ...process.argv.slice(3)]
    : process.argv;

program.parseAsync(argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
