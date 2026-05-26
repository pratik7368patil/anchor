import {
  defaultDatabasePath,
  detectGitRoot,
  initializeSchema,
  openAnchorDatabase,
  recordFeedback,
  type FeedbackEvent,
  type FeedbackRating,
} from "@pratik7368patil/anchor-core";

export type FeedbackRecordOptions = {
  resultId: string;
  rating: FeedbackRating;
  note?: string;
};

export function runFeedbackRecord(cwd: string, options: FeedbackRecordOptions): FeedbackEvent {
  const root = detectGitRoot(cwd) ?? cwd;
  const db = openAnchorDatabase(root, defaultDatabasePath(root));
  try {
    initializeSchema(db);
    return recordFeedback(db, options);
  } finally {
    db.close();
  }
}

export function printFeedbackRecord(result: FeedbackEvent): void {
  console.log(`Recorded ${result.rating} feedback for ${result.resultId}`);
}
