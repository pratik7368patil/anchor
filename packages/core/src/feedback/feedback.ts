import type { AnchorDatabase } from "../db/database.js";
import { initializeSchema } from "../db/database.js";
import type { FeedbackEvent, FeedbackRating } from "../types.js";
import { sanitizeHistoricalText } from "../security/sanitize.js";

type FeedbackRow = {
  result_id: string;
  rating: FeedbackRating;
  note_sanitized?: string | null;
  created_at: string;
};

export function recordFeedback(
  db: AnchorDatabase,
  input: { resultId: string; rating: FeedbackRating; note?: string },
): FeedbackEvent {
  initializeSchema(db);
  const event: FeedbackEvent = {
    resultId: input.resultId,
    rating: input.rating,
    note: input.note ? sanitizeHistoricalText(input.note) : undefined,
    createdAt: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO feedback_events (result_id, rating, note_sanitized, created_at)
     VALUES (?, ?, ?, ?)`,
  ).run(event.resultId, event.rating, event.note ?? null, event.createdAt);
  return event;
}

export function feedbackAdjustedScore(
  db: AnchorDatabase,
  resultId: string,
  baseScore: number,
): number {
  initializeSchema(db);
  const rows = db
    .prepare("SELECT rating FROM feedback_events WHERE result_id = ?")
    .all(resultId) as Array<{ rating: FeedbackRating }>;
  const adjustment = rows.reduce((score, row) => {
    if (row.rating === "useful") return score + 0.03;
    if (row.rating === "not-useful") return score - 0.03;
    return score;
  }, 0);
  return Number(Math.max(0, Math.min(1, baseScore + adjustment)).toFixed(4));
}

export function listFeedbackEvents(db: AnchorDatabase, limit = 50): FeedbackEvent[] {
  initializeSchema(db);
  const rows = db
    .prepare(
      `SELECT result_id, rating, note_sanitized, created_at
       FROM feedback_events
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(limit) as FeedbackRow[];
  return rows.map((row) => ({
    resultId: row.result_id,
    rating: row.rating,
    note: row.note_sanitized ?? undefined,
    createdAt: row.created_at,
  }));
}
