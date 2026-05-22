#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { printInitResult, runInit } from "./commands/init.js";
import { runIndex, runIndexCode } from "./commands/index.js";
import { runSync } from "./commands/sync.js";
import { runDoctorCommand } from "./commands/doctor.js";
import { runServe } from "./commands/serve.js";
import {
  printRulesInit,
  printRulesList,
  printRulesValidation,
  runRulesInit,
  runRulesList,
  runRulesValidate,
} from "./commands/rules.js";

const program = new Command();

function parseIntegerOption(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid number: ${value}`);
  return parsed;
}

function readPackageVersion(): string {
  try {
    const packageJsonPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../package.json",
    );
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
      version?: string;
    };
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
  .option("--limit <number>", "Maximum merged PRs to fetch", parseIntegerOption, 200)
  .option("--all", "Fetch every merged PR without Anchor's default or maximum PR limit")
  .option("--no-code", "Skip local codebase indexing")
  .option(
    "--concurrency <number>",
    "Concurrent PR detail fetches (default: 5, max: 10)",
    parseIntegerOption,
  )
  .option("--since <YYYY-MM-DD>", "Fetch PRs updated since this date")
  .option("--force", "Rebuild the local database before indexing")
  .action(async (options) => {
    await runIndex(process.cwd(), options);
  });

program
  .command("index-all")
  .description("Fetch every merged GitHub PR and build the local Anchor index")
  .option("--repo <owner/name>", "GitHub repository to index")
  .option("--no-code", "Skip local codebase indexing")
  .option(
    "--concurrency <number>",
    "Concurrent PR detail fetches (default: 5, max: 10)",
    parseIntegerOption,
  )
  .option("--since <YYYY-MM-DD>", "Fetch PRs updated since this date")
  .option("--force", "Rebuild the local database before indexing")
  .action(async (options) => {
    await runIndex(process.cwd(), { ...options, all: true });
  });

program
  .command("index-code")
  .description("Index the local codebase without fetching GitHub PR history")
  .option("--repo <owner/name>", "GitHub repository to associate with this code index")
  .option("--force", "Rebuild the local database before indexing code")
  .action(async (options) => {
    await runIndexCode(process.cwd(), options);
  });

program
  .command("sync")
  .description("Incrementally sync PRs updated since the last Anchor sync")
  .option("--repo <owner/name>", "GitHub repository to sync")
  .option("--limit <number>", "Maximum merged PRs to fetch", parseIntegerOption, 200)
  .option("--all", "Fetch every merged PR updated since the sync cursor")
  .option("--no-code", "Skip local codebase indexing")
  .option(
    "--concurrency <number>",
    "Concurrent PR detail fetches (default: 5, max: 10)",
    parseIntegerOption,
  )
  .option("--since <YYYY-MM-DD>", "Override the sync cursor")
  .option("--force", "Rebuild the local database before syncing")
  .action(async (options) => {
    await runSync(process.cwd(), options);
  });

const rules = program.command("rules").description("Manage committed Anchor team-approved rules");

rules
  .command("init")
  .description("Create anchor.rules.json if missing")
  .action(() => {
    printRulesInit(runRulesInit(process.cwd()));
  });

rules
  .command("validate")
  .description("Validate anchor.rules.json")
  .action(() => {
    const result = runRulesValidate(process.cwd());
    printRulesValidation(result);
    if (!result.ok) process.exitCode = 1;
  });

rules
  .command("list")
  .description("List valid team-approved Anchor rules")
  .action(() => {
    printRulesList(runRulesList(process.cwd()));
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
