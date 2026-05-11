import fs from "node:fs";
import {
  defaultDatabasePath,
  detectGitHubRepo,
  detectGitRoot,
  fetchMergedPullRequests,
  indexPullRequests,
  openAnchorDatabase,
  resolveGitHubToken,
} from "@pratik7368patil/anchor-core";

export type IndexOptions = {
  repo?: string;
  limit?: number;
  since?: string;
  force?: boolean;
  token?: string;
};

function removeDatabaseFiles(databasePath: string): void {
  for (const candidate of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    if (fs.existsSync(candidate)) fs.rmSync(candidate, { force: true });
  }
}

export function resolveRepo(cwd: string, repoOption?: string): { repo: string; root: string } {
  const gitRoot = detectGitRoot(cwd);
  if (repoOption) return { repo: repoOption, root: gitRoot ?? cwd };
  const repo = gitRoot ? detectGitHubRepo(gitRoot) : undefined;
  if (!repo) {
    throw new Error("Could not detect GitHub repo. Pass --repo owner/name or set a GitHub origin remote.");
  }
  return { repo: repo.fullName, root: gitRoot };
}

export async function runIndex(cwd: string, options: IndexOptions): Promise<void> {
  const auth = options.token
    ? { token: options.token, source: "GITHUB_TOKEN" as const }
    : resolveGitHubToken({ cwd });
  if (!auth.token) {
    throw new Error(
      "GitHub authentication is required for anchor index. Run gh auth login, or export GITHUB_TOKEN/GH_TOKEN with a read-only GitHub token.",
    );
  }

  const { repo, root } = resolveRepo(cwd, options.repo);
  const databasePath = defaultDatabasePath(root);
  if (options.force) removeDatabaseFiles(databasePath);

  const db = openAnchorDatabase(root, databasePath);
  try {
    const pullRequests = await fetchMergedPullRequests({
      token: auth.token,
      repo,
      limit: options.limit ?? 200,
      since: options.since,
    });
    const summary = indexPullRequests(db, pullRequests, { cwd: root, repo });
    console.log("Anchor index complete.");
    console.log(`Repository: ${repo}`);
    console.log(`Indexed PRs: ${summary.indexedPrs}`);
    console.log(`Indexed files: ${summary.indexedFiles}`);
    console.log(`Indexed comments: ${summary.indexedComments}`);
    console.log(`Wisdom units created: ${summary.wisdomUnitsCreated}`);
    console.log(`Skipped items: ${summary.skippedItems}`);
    console.log(`Database path: ${summary.databasePath}`);
  } finally {
    db.close();
  }
}
