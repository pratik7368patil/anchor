import type { AnchorDatabase } from "../db/database.js";
import { defaultDatabasePath, initializeSchema, upsertPullRequest, updateSyncState } from "../db/database.js";
import type { IndexPullRequestsProgress, IndexSummary, PullRequestRecord } from "../types.js";
import { extractWisdomUnits } from "./wisdom-extractor.js";
import { normalizePullRequest } from "./normalize-pr.js";

export function indexPullRequests(
  db: AnchorDatabase,
  pullRequests: PullRequestRecord[],
  options: {
    cwd: string;
    repo: string;
    updateSyncStateAfter?: boolean;
    onProgress?: (progress: IndexPullRequestsProgress) => void;
  },
): IndexSummary {
  initializeSchema(db);
  let indexedFiles = 0;
  let indexedComments = 0;
  let wisdomUnitsCreated = 0;
  let skippedItems = 0;
  let lastPr: number | undefined;

  for (const [index, rawPr] of pullRequests.entries()) {
    const pr = normalizePullRequest({ ...rawPr, repo: rawPr.repo || options.repo });
    options.onProgress?.({
      stage: "indexing_pull_request",
      repo: options.repo,
      current: index + 1,
      total: pullRequests.length,
      prNumber: pr.number,
    });
    if (!pr.merged_at) {
      skippedItems += 1;
      continue;
    }
    const wisdomUnits = extractWisdomUnits(pr);
    const result = upsertPullRequest(db, pr, wisdomUnits);
    indexedFiles += result.files;
    indexedComments += result.comments;
    wisdomUnitsCreated += result.wisdom;
    lastPr = pr.number;
    options.onProgress?.({
      stage: "indexed_pull_request",
      repo: options.repo,
      current: index + 1,
      total: pullRequests.length,
      prNumber: pr.number,
      wisdomUnitsCreated: result.wisdom,
    });
  }

  if (options.updateSyncStateAfter !== false) {
    updateSyncState(db, options.repo, lastPr);
  }

  return {
    indexedPrs: pullRequests.length - skippedItems,
    indexedFiles,
    indexedComments,
    wisdomUnitsCreated,
    skippedItems,
    databasePath: defaultDatabasePath(options.cwd),
  };
}
