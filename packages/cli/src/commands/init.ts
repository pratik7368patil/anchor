import fs from "node:fs";
import path from "node:path";
import {
  anchorMcpEntry,
  detectGitHubRepo,
  detectGitRoot,
  ensureAnchorGitExclude,
  ensureCursorConfig,
  ensureCursorRule,
} from "@pratik7368patil/anchor-core";

export type InitResult = {
  gitRoot: string;
  repo: string;
  mcpConfigPath: string;
  rulePath: string;
  gitExcludePath: string;
  mcpConfigUpdated: boolean;
  ruleCreated: boolean;
  gitExcludeUpdated: boolean;
};

function cursorMcpEntryForCurrentInstall(): Record<string, unknown> {
  const invokedPath = process.argv[1];
  if (invokedPath && path.isAbsolute(invokedPath) && fs.existsSync(invokedPath) && !invokedPath.endsWith(".ts")) {
    return anchorMcpEntry(invokedPath, ["serve"]);
  }
  return anchorMcpEntry("npx", ["-y", "@pratik7368patil/anchor@latest", "serve"]);
}

export function runInit(cwd: string): InitResult {
  const gitRoot = detectGitRoot(cwd);
  if (!gitRoot) {
    throw new Error("No git repository detected. Run anchor init from inside the repository you use with Cursor.");
  }

  const repo = detectGitHubRepo(gitRoot);
  if (!repo) {
    throw new Error("No GitHub origin remote detected. Set origin to a GitHub repo, then rerun anchor init.");
  }

  const config = ensureCursorConfig(gitRoot, cursorMcpEntryForCurrentInstall());
  const rule = ensureCursorRule(gitRoot);
  const gitExclude = ensureAnchorGitExclude(gitRoot);

  return {
    gitRoot,
    repo: repo.fullName,
    mcpConfigPath: config.path,
    rulePath: rule.path,
    gitExcludePath: gitExclude.path,
    mcpConfigUpdated: config.updated,
    ruleCreated: rule.created,
    gitExcludeUpdated: gitExclude.updated,
  };
}

export function printInitResult(result: InitResult): void {
  console.log("Anchor initialized for Cursor.");
  console.log(`Repo: ${result.repo}`);
  console.log(`Cursor MCP config: ${result.mcpConfigPath}`);
  console.log(`Cursor rule: ${result.rulePath}`);
  console.log(`Local git exclude: ${result.gitExcludePath}`);
  console.log(`MCP config ${result.mcpConfigUpdated ? "updated" : "already up to date"}.`);
  console.log(`Cursor rule ${result.ruleCreated ? "created" : "already existed"}.`);
  console.log(`Anchor index exclude ${result.gitExcludeUpdated ? "added" : "already existed"}.`);
  console.log("No GitHub token was written to disk. Anchor can use GITHUB_TOKEN, GH_TOKEN, or gh auth token for indexing.");
}
