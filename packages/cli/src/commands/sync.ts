import fs from "node:fs";
import {
  defaultDatabasePath,
  fetchMergedPullRequests,
  getLastSyncTime,
  indexCodebase,
  indexPullRequests,
  initializeSchema,
  openAnchorDatabase,
  recordIndexRun,
  resolveGitHubToken,
} from "@pratik7368patil/anchor-core";
import { resolveRepo, type IndexOptions } from "./index.js";
import { printCodeIndexProgress, printFetchProgress, printIndexProgress } from "./progress.js";

function removeDatabaseFiles(databasePath: string): void {
  for (const candidate of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    if (fs.existsSync(candidate)) fs.rmSync(candidate, { force: true });
  }
}

export async function runSync(cwd: string, options: IndexOptions): Promise<void> {
  const auth = options.token
    ? { token: options.token, source: "GITHUB_TOKEN" as const }
    : resolveGitHubToken({ cwd });
  if (!auth.token) {
    throw new Error(
      "GitHub authentication is required for anchor sync. Run gh auth login, or export GITHUB_TOKEN/GH_TOKEN with a read-only GitHub token.",
    );
  }

  const { repo, root } = resolveRepo(cwd, options.repo);
  const databasePath = defaultDatabasePath(root);
  if (options.force) removeDatabaseFiles(databasePath);

  console.error("Anchor sync started.");
  console.error(`Repository: ${repo}`);
  console.error(`Database path: ${databasePath}`);

  const db = openAnchorDatabase(root, databasePath);
  const startedAt = new Date().toISOString();
  try {
    initializeSchema(db);
    const since = options.force ? options.since : (options.since ?? getLastSyncTime(db, repo));
    const pullRequests = await fetchMergedPullRequests({
      token: auth.token,
      repo,
      limit: options.limit ?? 200,
      all: options.all,
      detailConcurrency: options.concurrency,
      since,
      onProgress: printFetchProgress,
    });
    console.error(`[anchor] writing ${pullRequests.length} PRs to SQLite...`);
    const summary = indexPullRequests(db, pullRequests, {
      cwd: root,
      repo,
      historyCoverage: options.all ? "all" : "limited",
      historyLimit: options.all ? undefined : (options.limit ?? 200),
      historySince: since,
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
    console.log("Anchor sync complete.");
    console.log(`Repository: ${repo}`);
    console.log(`Since: ${since ?? "full recent history"}`);
    console.log(`Indexed PRs: ${summary.indexedPrs}`);
    console.log(`Indexed files: ${summary.indexedFiles}`);
    console.log(`Indexed comments: ${summary.indexedComments}`);
    console.log(`Wisdom units created: ${summary.wisdomUnitsCreated}`);
    console.log(`Skipped items: ${summary.skippedItems}`);
    if (codeSummary) {
      console.log(`Indexed code files: ${codeSummary.indexedFiles}`);
      console.log(`Code chunks created: ${codeSummary.codeChunksCreated}`);
      console.log(`Test files indexed: ${codeSummary.testFilesIndexed}`);
      console.log(`Test links created: ${codeSummary.testLinksCreated}`);
      console.log(`Skipped code files: ${codeSummary.skippedFiles}`);
    }
    console.log(`Regression events created: ${summary.regressionEventsCreated}`);
    console.log(`Database path: ${summary.databasePath}`);
    recordIndexRun(db, {
      command: "sync",
      repo,
      startedAt,
      finishedAt: new Date().toISOString(),
      historyCoverage: options.all ? "all" : "limited",
      historyLimit: options.all ? undefined : (options.limit ?? 200),
      prsFetched: summary.indexedPrs,
      prsSkipped: summary.skippedItems,
      commentsIndexed: summary.indexedComments,
      codeFilesIndexed: codeSummary?.indexedFiles,
      testFilesIndexed: codeSummary?.testFilesIndexed,
      status: "success",
    });
  } catch (error) {
    recordIndexRun(db, {
      command: "sync",
      repo,
      startedAt,
      finishedAt: new Date().toISOString(),
      historyCoverage: options.all ? "all" : "limited",
      historyLimit: options.all ? undefined : (options.limit ?? 200),
      failures: [error instanceof Error ? error.message : String(error)],
      status: "failed",
    });
    throw error;
  } finally {
    db.close();
  }
}
