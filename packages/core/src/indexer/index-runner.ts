import type { AnchorDatabase } from "../db/database.js";
import {
  defaultDatabasePath,
  initializeSchema,
  upsertPullRequest,
  updateSyncState,
} from "../db/database.js";
import type { IndexPullRequestsProgress, IndexSummary, PullRequestRecord } from "../types.js";
import { extractWisdomUnits } from "./wisdom-extractor.js";
import { normalizePullRequest } from "./normalize-pr.js";
import { extractRegressionEvents } from "./regression-extractor.js";

export function indexPullRequests(
  db: AnchorDatabase,
  pullRequests: PullRequestRecord[],
  options: {
    cwd: string;
    repo: string;
    updateSyncStateAfter?: boolean;
    historyCoverage?: "limited" | "all" | "unknown";
    historyLimit?: number;
    historySince?: string;
    onProgress?: (progress: IndexPullRequestsProgress) => void;
  },
): IndexSummary {
  initializeSchema(db);
  let indexedFiles = 0;
  let indexedComments = 0;
  let wisdomUnitsCreated = 0;
  let regressionEventsCreated = 0;
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
    const regressionEvents = extractRegressionEvents(pr);
    const result = upsertPullRequest(db, pr, wisdomUnits, regressionEvents);
    indexedFiles += result.files;
    indexedComments += result.comments;
    wisdomUnitsCreated += result.wisdom;
    regressionEventsCreated += result.regressions;
    lastPr = pr.number;
    options.onProgress?.({
      stage: "indexed_pull_request",
      repo: options.repo,
      current: index + 1,
      total: pullRequests.length,
      prNumber: pr.number,
      wisdomUnitsCreated: result.wisdom,
      regressionEventsCreated: result.regressions,
    });
  }

  if (options.updateSyncStateAfter !== false) {
    updateSyncState(db, options.repo, lastPr, {
      historyCoverage: options.historyCoverage,
      historyLimit: options.historyLimit,
      historySince: options.historySince,
    });
  }

  return {
    indexedPrs: pullRequests.length - skippedItems,
    indexedFiles,
    indexedComments,
    wisdomUnitsCreated,
    regressionEventsCreated,
    skippedItems,
    databasePath: defaultDatabasePath(options.cwd),
  };
}
