#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import type { WisdomCategory } from "@pratik7368patil/anchor-core";
import { printInitResult, resolveInitTargets, runInit } from "./commands/init.js";
import { runIndex, runIndexCode } from "./commands/index.js";
import { runSync } from "./commands/sync.js";
import { runDoctorCommand } from "./commands/doctor.js";
import { runServe } from "./commands/serve.js";
import { printExplain, runExplain } from "./commands/explain.js";
import { printReview, runReview } from "./commands/review.js";
import { printArchitecture, runArchitecture } from "./commands/architecture.js";
import { printHealth, runHealth } from "./commands/health.js";
import { printDemo, runDemo } from "./commands/demo.js";
import { printPrompts, runPrompts } from "./commands/prompts.js";
import { printContext, runContext } from "./commands/context.js";
import { printPlan, runPlan } from "./commands/plan.js";
import { printTestCommand, runTestCommand } from "./commands/test-command.js";
import {
  printEvalAdd,
  printEvalInit,
  printEvalRun,
  runEvalAdd,
  runEvalInit,
  runEvalRun,
} from "./commands/eval.js";
import { printCi, runCi } from "./commands/ci.js";
import { printOnboarding, runOnboarding } from "./commands/onboarding.js";
import { printFeedbackRecord, runFeedbackRecord } from "./commands/feedback.js";
import {
  printPlaybook,
  printPlaybooks,
  printPlaybooksInit,
  runPlaybooksGet,
  runPlaybooksInit,
  runPlaybooksList,
  runPlaybooksSuggest,
} from "./commands/playbooks.js";
import { runWatch } from "./commands/watch.js";
import {
  printJsonOrMarkdown,
  printOrgAddRepo,
  printOrgInit,
  printOrgRemoveRepo,
  runOrgAddRepo,
  runOrgCi,
  runOrgClone,
  runOrgGraph,
  runOrgImpact,
  runOrgIndex,
  runOrgInit,
  runOrgList,
  runOrgMap,
  runOrgRemoveRepo,
  runOrgStatus,
} from "./commands/org.js";
import {
  printRulesAdd,
  printRulesEvidenceCheck,
  printRulesInit,
  printRulesList,
  printRulesSuggest,
  printRulesValidation,
  runRulesAdd,
  runRulesCheckEvidence,
  runRulesInit,
  runRulesList,
  runRulesSuggest,
  runRulesValidate,
} from "./commands/rules.js";

const program = new Command();

function parseIntegerOption(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid number: ${value}`);
  return parsed;
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function collectNumberOption(value: string, previous: number[]): number[] {
  return [...previous, parseIntegerOption(value)];
}

function parseConfidenceOption(value: string): "strong" | "moderate" | "weak" {
  if (value === "strong" || value === "moderate" || value === "weak") return value;
  throw new Error("Invalid confidence level. Use strong, moderate, or weak.");
}

function parseArchitectureAreaOption(value: string) {
  const areas = [
    "api",
    "service",
    "component",
    "hook",
    "route",
    "store",
    "test",
    "schema",
    "type",
    "config",
    "util",
    "unknown",
  ];
  if (areas.includes(value)) return value;
  throw new Error(`Invalid architecture area: ${value}`);
}

function parseWisdomCategoryOption(value: string): WisdomCategory {
  const categories = [
    "architecture_decision",
    "constraint",
    "rejected_approach",
    "bug_regression",
    "testing_rule",
    "api_contract",
    "performance_note",
    "security_note",
    "style_convention",
    "unknown",
  ];
  if (categories.includes(value)) return value as WisdomCategory;
  throw new Error(`Invalid wisdom category: ${value}`);
}

function parseMapFormatOption(value: string): "mermaid" | "json" {
  if (value === "mermaid" || value === "json") return value;
  throw new Error("Invalid map format. Use mermaid or json.");
}

function parseFeedbackRatingOption(value: string): "useful" | "not-useful" {
  if (value === "useful" || value === "not-useful") return value;
  throw new Error("Invalid feedback rating. Use useful or not-useful.");
}

function parseInitScopeOption(value: string): "project" | "user" {
  if (value === "project" || value === "user") return value;
  throw new Error("Invalid init scope. Use project or user.");
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
  .description("Anchor: local-first repo memory for AI coding agents")
  .version(readPackageVersion());

program
  .command("init")
  .description("Configure Anchor for one or more AI coding agents")
  .option("--target <targets>", "Comma-separated targets: cursor,claude-code,codex,vscode,antigravity,generic")
  .option("--all-targets", "Configure every supported target where safe")
  .option("--scope <scope>", "Configuration scope: project or user", parseInitScopeOption, "project")
  .action(async (options) => {
    const targets = await resolveInitTargets(options);
    const result = runInit(process.cwd(), { targets, scope: options.scope });
    printInitResult(result);
  });

program
  .command("demo")
  .description("Run a deterministic offline Anchor demo with bundled PR and code fixtures")
  .option("--json", "Print demo output as JSON")
  .option("--keep", "Keep the generated temporary demo workspace")
  .option("--path <dir>", "Use and keep a specific demo workspace path")
  .action((options) => {
    printDemo(runDemo(options), options);
  });

program
  .command("prompts")
  .description("Print agent-ready prompts for common Anchor workflows")
  .option("--target <target>", "Prompt target: cursor,claude-code,codex,vscode,antigravity,generic")
  .option("--json", "Print prompts as JSON")
  .action((options) => {
    printPrompts(runPrompts(options), options);
  });

program
  .command("context")
  .description("Return Anchor context from the CLI for agents without MCP")
  .argument("<task>", "Task to gather context for")
  .option("--file <path>", "Target file", collectOption, [])
  .option("--symbol <name>", "Target symbol", collectOption, [])
  .option("--diff-file <path>", "Read current diff from a file")
  .option("--strict", "Use strict non-stale evidence filtering")
  .option("--min-confidence <level>", "Minimum confidence: strong, moderate, or weak", parseConfidenceOption)
  .option("--max-results <number>", "Maximum results", parseIntegerOption)
  .option("--json", "Print structured context as JSON")
  .action((task, options) => {
    printContext(runContext(process.cwd(), task, options), options);
  });

program
  .command("plan")
  .description("Create a deterministic edit plan from Anchor context")
  .argument("<task>", "Task to plan")
  .option("--file <path>", "Target file", collectOption, [])
  .option("--symbol <name>", "Target symbol", collectOption, [])
  .option("--strict", "Use strict non-stale evidence filtering")
  .option("--json", "Print structured plan as JSON")
  .action((task, options) => {
    printPlan(runPlan(process.cwd(), task, options), options);
  });

program
  .command("test-command")
  .description("Infer exact test commands for a source or test file")
  .argument("<file>", "Source or test file")
  .option("--json", "Print test commands as JSON")
  .action((file, options) => {
    printTestCommand(runTestCommand(process.cwd(), file), options);
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
  .command("explain")
  .description("Explain a file using the local Anchor index")
  .argument("<file>", "File path to explain")
  .option("--strict", "Only include non-stale strong evidence")
  .option("--share", "Print compact Markdown for Slack or PR comments")
  .option("--json", "Print structured metadata as JSON")
  .option("--max-results <number>", "Maximum historical results", parseIntegerOption)
  .action((file, options) => {
    printExplain(runExplain(process.cwd(), file, options), options);
  });

program
  .command("review")
  .description("Review the current git diff against Anchor history")
  .option("--base <ref>", "Review diff from base ref to HEAD")
  .option("--diff-file <path>", "Read a diff from a file instead of git diff")
  .option("--strict", "Only include non-stale strong evidence")
  .option("--share", "Print compact Markdown for Slack or PR comments")
  .option("--json", "Print structured metadata as JSON")
  .option("--max-results <number>", "Maximum historical results", parseIntegerOption)
  .action((options) => {
    printReview(runReview(process.cwd(), options), options);
  });

program
  .command("architecture")
  .description("Summarize or check local architecture patterns from the Anchor index")
  .option("--file <path>", "Explain architecture patterns for one file")
  .option("--area <area>", "Filter architecture patterns by area", parseArchitectureAreaOption)
  .option("--check", "Check the current git diff against architecture patterns")
  .option("--map", "Print an architecture graph from indexed imports and test links")
  .option("--format <format>", "Architecture map format: mermaid or json", parseMapFormatOption)
  .option("--diff-file <path>", "Read a diff from a file for --check")
  .option("--write-doc", "Write ANCHOR_ARCHITECTURE.md from the architecture summary")
  .option("--json", "Print structured metadata as JSON")
  .option("--max-results <number>", "Maximum architecture patterns", parseIntegerOption)
  .action((options) => {
    printArchitecture(runArchitecture(process.cwd(), options), options);
  });

const evals = program.command("eval").description("Manage deterministic Anchor retrieval evals");

evals
  .command("init")
  .description("Create anchor.evals.json if missing")
  .action(() => {
    printEvalInit(runEvalInit(process.cwd()));
  });

evals
  .command("add")
  .description("Add a golden retrieval eval")
  .requiredOption("--task <task>", "Task query")
  .option("--file <path>", "Expected target file", collectOption, [])
  .option("--expect-pr <number>", "Expected PR number", collectNumberOption, [])
  .option("--category <category>", "Expected wisdom category", collectOption, [])
  .action((options) => {
    printEvalAdd(
      runEvalAdd(process.cwd(), {
        task: options.task,
        file: options.file,
        expectPr: options.expectPr,
        category: (options.category ?? []).map(parseWisdomCategoryOption),
      }),
    );
  });

evals
  .command("run")
  .description("Run Anchor retrieval evals")
  .option("--json", "Print eval results as JSON")
  .action((options) => {
    const result = runEvalRun(process.cwd());
    printEvalRun(result, options);
    if (!result.ok) process.exitCode = 1;
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

rules
  .command("add")
  .description("Add a team-approved rule with required PR evidence")
  .requiredOption("--id <id>", "Stable rule id")
  .requiredOption("--category <category>", "Wisdom category")
  .requiredOption("--text <text>", "Rule text")
  .requiredOption("--pr-number <number>", "Evidence PR number", parseIntegerOption)
  .requiredOption("--pr-url <url>", "Evidence PR URL")
  .option("--source-type <sourceType>", "Evidence source type", "pr_body")
  .option("--file <path>", "Associated file path", collectOption, [])
  .option("--symbol <symbol>", "Associated symbol", collectOption, [])
  .action((options) => {
    printRulesAdd(runRulesAdd(process.cwd(), options));
  });

rules
  .command("check-evidence")
  .description("Validate that team-rule PR evidence exists in the local index")
  .action(() => {
    const result = runRulesCheckEvidence(process.cwd());
    printRulesEvidenceCheck(result);
    if (!result.ok) process.exitCode = 1;
  });

rules
  .command("suggest")
  .description("Suggest draft team-approved rules from local Anchor evidence")
  .option("--json", "Print suggestions as JSON")
  .option("--category <category>", "Only suggest one wisdom category")
  .option(
    "--min-confidence <level>",
    "Minimum evidence confidence: strong, moderate, or weak",
    parseConfidenceOption,
    "moderate",
  )
  .action((options) => {
    printRulesSuggest(
      runRulesSuggest(process.cwd(), {
        category: options.category,
        minConfidence: options.minConfidence,
      }),
      options,
    );
  });

program
  .command("doctor")
  .description("Check local Anchor, AI agent, GitHub, and SQLite setup")
  .option("--target <targets>", "Comma-separated targets to check")
  .action(async (options) => {
    const ok = await runDoctorCommand(process.cwd(), options);
    if (!ok) process.exitCode = 1;
  });

program
  .command("health")
  .description("Report Anchor index quality, coverage, and freshness")
  .option("--json", "Print structured health report as JSON")
  .action((options) => {
    printHealth(runHealth(process.cwd()), options);
  });

program
  .command("watch")
  .description("Keep local code, architecture, tests, and test commands fresh")
  .option("--interval <seconds>", "Refresh interval in seconds", parseIntegerOption, 30)
  .option("--repo <owner/name>", "Repository name to associate with the code index")
  .action((options) => {
    runWatch(process.cwd(), options);
  });

program
  .command("ci")
  .description("Run Anchor reliability gates for CI")
  .option("--strict", "Fail when the code index is stale")
  .option("--min-coverage <number>", "Minimum Anchor coverage score", parseIntegerOption, 70)
  .option("--json", "Print CI result as JSON")
  .action((options) => {
    const result = runCi(process.cwd(), options);
    printCi(result, options);
    if (result.metadata.ok === false) process.exitCode = 1;
  });

program
  .command("onboarding")
  .description("Build a deterministic onboarding pack from the local Anchor index")
  .option("--file <path>", "Focus on one file")
  .option("--area <area>", "Focus on one architecture area", parseArchitectureAreaOption)
  .option("--json", "Print onboarding pack as JSON")
  .action((options) => {
    printOnboarding(runOnboarding(process.cwd(), options), options);
  });

const feedback = program.command("feedback").description("Record local-only Anchor feedback");

feedback
  .command("record")
  .description("Record whether an Anchor result was useful")
  .requiredOption("--result-id <id>", "Result id from structured Anchor metadata")
  .requiredOption(
    "--rating <rating>",
    "Feedback rating: useful or not-useful",
    parseFeedbackRatingOption,
  )
  .option("--note <note>", "Optional local-only note")
  .action((options) => {
    printFeedbackRecord(runFeedbackRecord(process.cwd(), options));
  });

const playbooks = program
  .command("playbooks")
  .description("Manage repo playbooks from Anchor evidence");

playbooks
  .command("init")
  .description("Create anchor.playbooks.json if missing")
  .action(() => {
    printPlaybooksInit(runPlaybooksInit(process.cwd()));
  });

playbooks
  .command("suggest")
  .description("Suggest draft playbooks from local evidence")
  .option("--json", "Print suggestions as JSON")
  .action((options) => {
    printPlaybooks(runPlaybooksSuggest(process.cwd()), options);
  });

playbooks
  .command("list")
  .description("List committed repo playbooks")
  .option("--json", "Print playbooks as JSON")
  .action((options) => {
    printPlaybooks(runPlaybooksList(process.cwd()), options);
  });

playbooks
  .command("get")
  .description("Show one committed repo playbook")
  .argument("<id>", "Playbook id")
  .option("--json", "Print playbook as JSON")
  .action((id, options) => {
    printPlaybook(runPlaybooksGet(process.cwd(), id), options);
  });

const org = program.command("org").description("Manage local-first organization memory");

org
  .command("init")
  .description("Initialize a local Anchor org memory store")
  .requiredOption("--org <org>", "GitHub org or company namespace")
  .action((options) => {
    printOrgInit(runOrgInit(options));
  });

org
  .command("add-repo")
  .description("Allowlist a repository for local org memory")
  .argument("<owner/name>", "Repository full name")
  .requiredOption("--org <org>", "Org memory namespace")
  .option("--alias <name>", "Local clone alias")
  .option("--group <group>", "Repo group: backend, frontend, shared, infra, docs, or unknown")
  .action(async (repo, options) => {
    printOrgAddRepo(await runOrgAddRepo(repo, options));
  });

org
  .command("remove-repo")
  .description("Disable an allowlisted org repository")
  .argument("<owner/name>", "Repository full name")
  .requiredOption("--org <org>", "Org memory namespace")
  .action((repo, options) => {
    printOrgRemoveRepo(runOrgRemoveRepo(repo, options), repo);
  });

org
  .command("list")
  .description("List allowlisted org repositories")
  .requiredOption("--org <org>", "Org memory namespace")
  .option("--json", "Print structured status as JSON")
  .action((options) => {
    printJsonOrMarkdown(runOrgList(options), options);
  });

org
  .command("clone")
  .description("Clone or pull allowlisted repos into the local Anchor org cache")
  .requiredOption("--org <org>", "Org memory namespace")
  .option("--repo <owner/name>", "Only clone or pull one repo")
  .option("--concurrency <number>", "Concurrent clone/pull workers", parseIntegerOption, 3)
  .option("--json", "Print results as JSON")
  .action(async (options) => {
    printJsonOrMarkdown(await runOrgClone(options), options);
  });

org
  .command("index")
  .description("Index allowlisted org repos into one local org SQLite database")
  .requiredOption("--org <org>", "Org memory namespace")
  .option("--repo <owner/name>", "Only index one repo")
  .option("--code-only", "Index code only without GitHub PR history")
  .option("--prs-only", "Index PR history only without code")
  .option("--no-graph", "Skip cross-repo graph rebuild after indexing")
  .option("--force", "Refresh unchanged code indexes")
  .option("--concurrency <number>", "Concurrent GitHub detail fetches", parseIntegerOption, 3)
  .option("--json", "Print results as JSON")
  .action(async (options) => {
    printJsonOrMarkdown(await runOrgIndex({ ...options, command: "org index" }), options);
  });

org
  .command("sync")
  .description("Pull/index allowlisted repos and refresh cross-repo graph")
  .requiredOption("--org <org>", "Org memory namespace")
  .option("--repo <owner/name>", "Only sync one repo")
  .option(
    "--concurrency <number>",
    "Concurrent clone/pull and GitHub workers",
    parseIntegerOption,
    3,
  )
  .option("--since <YYYY-MM-DD>", "Override PR sync cursor")
  .option("--no-graph", "Skip cross-repo graph rebuild after syncing")
  .option("--force", "Refresh unchanged code indexes")
  .option("--json", "Print results as JSON")
  .action(async (options) => {
    await runOrgClone({ ...options, command: "org sync" });
    printJsonOrMarkdown(await runOrgIndex({ ...options, command: "org sync" }), options);
  });

org
  .command("graph")
  .description("Rebuild the local org cross-repo graph without refetching or reindexing repos")
  .requiredOption("--org <org>", "Org memory namespace")
  .option("--repo <owner/name>", "Reserved for future scoped graph rebuilds")
  .option("--force", "Accepted for compatibility; org graph always rebuilds")
  .option("--html", "Write an interactive standalone HTML graph")
  .option("--open", "Write the HTML graph and open it in the default browser")
  .option("--output <path>", "Path for the generated HTML graph")
  .option("--json", "Print graph rebuild result as JSON")
  .action((options) => {
    printJsonOrMarkdown(runOrgGraph(options), options);
  });

org
  .command("status")
  .description("Report org memory coverage, clone state, and index health")
  .requiredOption("--org <org>", "Org memory namespace")
  .option("--json", "Print structured status as JSON")
  .action((options) => {
    printJsonOrMarkdown(runOrgStatus(options), options);
  });

org
  .command("map")
  .description("Show cross-repo architecture and dependency map")
  .requiredOption("--org <org>", "Org memory namespace")
  .option("--format <format>", "Map format: mermaid or json", parseMapFormatOption, "mermaid")
  .option("--html", "Write a standalone local HTML map report")
  .option("--open", "Write the HTML report and open it in the default browser")
  .option("--output <path>", "Path for the generated HTML report")
  .option("--json", "Print structured metadata as JSON")
  .action((options) => {
    printJsonOrMarkdown(runOrgMap(options), options);
  });

org
  .command("impact")
  .description("Check a diff for cross-repo impact and deterministic anomalies")
  .requiredOption("--org <org>", "Org memory namespace")
  .option("--repo <owner/name>", "Repo where the diff belongs")
  .option("--diff-file <path>", "Read diff from a file instead of git diff")
  .option("--strict", "Fail metadata when high/blocker anomalies are found")
  .option("--html", "Write a standalone local HTML impact report")
  .option("--open", "Write the HTML report and open it in the default browser")
  .option("--output <path>", "Path for the generated HTML report")
  .option("--json", "Print structured impact as JSON")
  .action((options) => {
    const result = runOrgImpact(options);
    printJsonOrMarkdown(result, options);
    if (options.strict && !result.metadata.ok) process.exitCode = 1;
  });

org
  .command("ci")
  .description("Run org-memory reliability gates for CI")
  .requiredOption("--org <org>", "Org memory namespace")
  .option("--repo <owner/name>", "Repo where the diff belongs")
  .option("--strict", "Fail on high/blocker anomalies")
  .option("--min-coverage <number>", "Minimum org coverage score", parseIntegerOption, 70)
  .option("--html", "Write a standalone local HTML CI report")
  .option("--open", "Write the HTML report and open it in the default browser")
  .option("--output <path>", "Path for the generated HTML report")
  .option("--json", "Print structured CI result as JSON")
  .action((options) => {
    const result = runOrgCi(options);
    printJsonOrMarkdown(result, options);
    if (!result.metadata.ok) process.exitCode = 1;
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
