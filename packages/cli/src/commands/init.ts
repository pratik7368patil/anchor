import { detectGitHubRepo, detectGitRoot, ensureCursorConfig, ensureCursorRule } from "@anchor/core";

export type InitResult = {
  gitRoot: string;
  repo: string;
  mcpConfigPath: string;
  rulePath: string;
  mcpConfigUpdated: boolean;
  ruleCreated: boolean;
};

export function runInit(cwd: string): InitResult {
  const gitRoot = detectGitRoot(cwd);
  if (!gitRoot) {
    throw new Error("No git repository detected. Run anchor init from inside the repository you use with Cursor.");
  }

  const repo = detectGitHubRepo(gitRoot);
  if (!repo) {
    throw new Error("No GitHub origin remote detected. Set origin to a GitHub repo, then rerun anchor init.");
  }

  const config = ensureCursorConfig(gitRoot);
  const rule = ensureCursorRule(gitRoot);

  return {
    gitRoot,
    repo: repo.fullName,
    mcpConfigPath: config.path,
    rulePath: rule.path,
    mcpConfigUpdated: config.updated,
    ruleCreated: rule.created,
  };
}

export function printInitResult(result: InitResult): void {
  console.log("Anchor initialized for Cursor.");
  console.log(`Repo: ${result.repo}`);
  console.log(`Cursor MCP config: ${result.mcpConfigPath}`);
  console.log(`Cursor rule: ${result.rulePath}`);
  console.log(`MCP config ${result.mcpConfigUpdated ? "updated" : "already up to date"}.`);
  console.log(`Cursor rule ${result.ruleCreated ? "created" : "already existed"}.`);
  console.log("No GitHub token was written to disk. Cursor will read ${env:GITHUB_TOKEN} at runtime.");
}
