import type { AnchorDatabase } from "../db/database.js";
import { defaultDatabasePath, initializeSchema, upsertPullRequest, updateSyncState } from "../db/database.js";
import type { IndexSummary, PullRequestRecord } from "../types.js";
import { extractWisdomUnits } from "./wisdom-extractor.js";
import { normalizePullRequest } from "./normalize-pr.js";

export function indexPullRequests(
  db: AnchorDatabase,
  pullRequests: PullRequestRecord[],
  options: { cwd: string; repo: string; updateSyncStateAfter?: boolean },
): IndexSummary {
  initializeSchema(db);
  let indexedFiles = 0;
  let indexedComments = 0;
  let wisdomUnitsCreated = 0;
  let skippedItems = 0;
  let lastPr: number | undefined;

  for (const rawPr of pullRequests) {
    const pr = normalizePullRequest({ ...rawPr, repo: rawPr.repo || options.repo });
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
