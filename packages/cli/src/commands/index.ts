import fs from "node:fs";
import {
  defaultDatabasePath,
  detectGitHubRepo,
  detectGitRoot,
  fetchMergedPullRequests,
  indexCodebase,
  indexPullRequests,
  openAnchorDatabase,
  resolveGitHubToken,
} from "@pratik7368patil/anchor-core";
import { printCodeIndexProgress, printFetchProgress, printIndexProgress } from "./progress.js";

export type IndexOptions = {
  repo?: string;
  limit?: number;
  all?: boolean;
  concurrency?: number;
  code?: boolean;
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
    throw new Error(
      "Could not detect GitHub repo. Pass --repo owner/name or set a GitHub origin remote.",
    );
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

  console.error("Anchor index started.");
  console.error(`Repository: ${repo}`);
  console.error(`Database path: ${databasePath}`);

  const db = openAnchorDatabase(root, databasePath);
  try {
    const pullRequests = await fetchMergedPullRequests({
      token: auth.token,
      repo,
      limit: options.limit ?? 200,
      all: options.all,
      detailConcurrency: options.concurrency,
      since: options.since,
      onProgress: printFetchProgress,
    });
    console.error(`[anchor] writing ${pullRequests.length} PRs to SQLite...`);
    const summary = indexPullRequests(db, pullRequests, {
      cwd: root,
      repo,
      onProgress: printIndexProgress,
    });
    const codeSummary =
      options.code === false
        ? undefined
        : indexCodebase(db, {
            cwd: root,
            repo,
            onProgress: printCodeIndexProgress,
          });
    console.log("Anchor index complete.");
    console.log(`Repository: ${repo}`);
    console.log(`Indexed PRs: ${summary.indexedPrs}`);
    console.log(`Indexed files: ${summary.indexedFiles}`);
    console.log(`Indexed comments: ${summary.indexedComments}`);
    console.log(`Wisdom units created: ${summary.wisdomUnitsCreated}`);
    console.log(`Skipped items: ${summary.skippedItems}`);
    if (codeSummary) {
      console.log(`Indexed code files: ${codeSummary.indexedFiles}`);
      console.log(`Code chunks created: ${codeSummary.codeChunksCreated}`);
      console.log(`Skipped code files: ${codeSummary.skippedFiles}`);
    }
    console.log(`Database path: ${summary.databasePath}`);
  } finally {
    db.close();
  }
}

export async function runIndexCode(cwd: string, options: IndexOptions): Promise<void> {
  const { repo, root } = resolveRepo(cwd, options.repo);
  const databasePath = defaultDatabasePath(root);
  if (options.force) removeDatabaseFiles(databasePath);

  console.error("Anchor code index started.");
  console.error(`Repository: ${repo}`);
  console.error(`Database path: ${databasePath}`);

  const db = openAnchorDatabase(root, databasePath);
  try {
    const summary = indexCodebase(db, {
      cwd: root,
      repo,
      onProgress: printCodeIndexProgress,
    });
    console.log("Anchor code index complete.");
    console.log(`Repository: ${repo}`);
    console.log(`Indexed code files: ${summary.indexedFiles}`);
    console.log(`Code chunks created: ${summary.codeChunksCreated}`);
    console.log(`Skipped code files: ${summary.skippedFiles}`);
    console.log(`Database path: ${summary.databasePath}`);
  } finally {
    db.close();
  }
}
