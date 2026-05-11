import fs from "node:fs";
import {
  defaultDatabasePath,
  fetchMergedPullRequests,
  getLastSyncTime,
  indexPullRequests,
  initializeSchema,
  openAnchorDatabase,
} from "@anchor/core";
import { resolveRepo, type IndexOptions } from "./index.js";

function removeDatabaseFiles(databasePath: string): void {
  for (const candidate of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    if (fs.existsSync(candidate)) fs.rmSync(candidate, { force: true });
  }
}

export async function runSync(cwd: string, options: IndexOptions): Promise<void> {
  const token = options.token ?? process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN is required for anchor sync. Use a read-only GitHub token.");
  }

  const { repo, root } = resolveRepo(cwd, options.repo);
  const databasePath = defaultDatabasePath(root);
  if (options.force) removeDatabaseFiles(databasePath);

  const db = openAnchorDatabase(root, databasePath);
  try {
    initializeSchema(db);
    const since = options.force ? options.since : options.since ?? getLastSyncTime(db, repo);
    const pullRequests = await fetchMergedPullRequests({
      token,
      repo,
      limit: options.limit ?? 200,
      since,
    });
    const summary = indexPullRequests(db, pullRequests, { cwd: root, repo });
    console.log("Anchor sync complete.");
    console.log(`Repository: ${repo}`);
    console.log(`Since: ${since ?? "full recent history"}`);
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
