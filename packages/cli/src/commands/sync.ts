import fs from "node:fs";
import {
  clearGraphQLFetchCheckpoint,
  defaultDatabasePath,
  fetchMergedPullRequests,
  getLastSyncTime,
  getGraphQLFetchCheckpoint,
  graphQLFetchCheckpointScope,
  indexCodebase,
  indexPullRequests,
  initializeSchema,
  openAnchorDatabase,
  recordIndexRun,
  resolveGitHubToken,
  saveGraphQLFetchCheckpoint,
  type GitHubGraphQLFetchCheckpoint,
} from "@pratik7368patil/anchor-core";
import { printIndexOutcome } from "./engagement.js";
import { resolveRepo, type IndexOptions } from "./index.js";
import { createProgressReporter } from "./progress.js";

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

  const progress = createProgressReporter({
    progress: options.progress,
    title: "Syncing repo memory",
  });
  progress.log("Anchor sync started.");
  progress.log(`Repository: ${repo}`);
  progress.log(`Database path: ${databasePath}`);

  const db = openAnchorDatabase(root, databasePath);
  const startedAt = new Date().toISOString();
  try {
    initializeSchema(db);
    const since = options.force ? options.since : (options.since ?? getLastSyncTime(db, repo));
    const checkpointScope = options.all
      ? graphQLFetchCheckpointScope({
          repo,
          all: true,
          since,
        })
      : undefined;
    let pendingGraphQLCheckpoint: GitHubGraphQLFetchCheckpoint | null | undefined;
    const pullRequests = await fetchMergedPullRequests({
      token: auth.token,
      repo,
      limit: options.limit ?? 200,
      all: options.all,
      detailConcurrency: options.concurrency,
      since,
      graphQLCheckpoint: checkpointScope
        ? getGraphQLFetchCheckpoint(db, repo, checkpointScope)
        : undefined,
      onGraphQLCheckpoint: (checkpoint) => {
        pendingGraphQLCheckpoint = checkpoint;
      },
      onProgress: progress.onFetchProgress,
    });
    progress.log(`[anchor] writing ${pullRequests.length} PRs to SQLite...`);
    const historyCoverage = options.all && !pendingGraphQLCheckpoint ? "all" : "limited";
    const summary = indexPullRequests(db, pullRequests, {
      cwd: root,
      repo,
      historyCoverage,
      historyLimit: options.all ? undefined : (options.limit ?? 200),
      historySince: since,
      onProgress: progress.onPrIndexProgress,
    });
    if (checkpointScope && pendingGraphQLCheckpoint) {
      saveGraphQLFetchCheckpoint(db, pendingGraphQLCheckpoint);
      console.log(
        `GraphQL resume checkpoint saved: rerun the same command after ${pendingGraphQLCheckpoint.resetAt ?? "the GitHub reset"} to continue.`,
      );
    } else if (checkpointScope && pendingGraphQLCheckpoint === null) {
      clearGraphQLFetchCheckpoint(db, repo, checkpointScope);
    }
    const codeSummary =
      options.code === false
        ? undefined
        : indexCodebase(db, {
            cwd: root,
            repo,
            onProgress: progress.onCodeProgress,
          });
    progress.close();
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
      console.log(`Architecture components indexed: ${codeSummary.architectureComponentsIndexed}`);
      console.log(`Architecture patterns indexed: ${codeSummary.architecturePatternsIndexed}`);
      console.log(`Architecture imports indexed: ${codeSummary.architectureImportsIndexed}`);
      console.log(`Skipped code files: ${codeSummary.skippedFiles}`);
    }
    console.log(`Regression events created: ${summary.regressionEventsCreated}`);
    console.log(`Database path: ${summary.databasePath}`);
    printIndexOutcome(root, db, { history: summary, code: codeSummary });
    recordIndexRun(db, {
      command: "sync",
      repo,
      startedAt,
      finishedAt: new Date().toISOString(),
      historyCoverage,
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
    progress.close();
    db.close();
  }
}
