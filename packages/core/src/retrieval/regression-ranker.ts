import path from "node:path";
import type {
  AnchorContextInput,
  RankedRegressionEvent,
  RegressionEvent,
  SearchHistoryInput,
} from "../types.js";
import type { AnchorDatabase } from "../db/database.js";
import { tokenizeSearchText, uniqueStrings } from "../utils/text.js";
import { clampMaxResults } from "./query-builder.js";

type RegressionRow = {
  id: string;
  repo: string;
  pr_number: number;
  pr_url: string;
  summary_sanitized: string;
  file_paths_json: string;
  symbols_json: string;
  test_paths_json: string;
  authors_json: string;
  labels_json: string;
  signals_json: string;
  created_at: string;
  merged_at?: string | null;
  confidence: number;
};

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function rowToEvent(row: RegressionRow): RegressionEvent {
  return {
    id: row.id,
    repo: row.repo,
    prNumber: row.pr_number,
    prUrl: row.pr_url,
    summary: row.summary_sanitized,
    filePaths: parseJsonArray(row.file_paths_json),
    symbols: parseJsonArray(row.symbols_json),
    testPaths: parseJsonArray(row.test_paths_json),
    authors: parseJsonArray(row.authors_json),
    labels: parseJsonArray(row.labels_json),
    signals: parseJsonArray(row.signals_json),
    createdAt: row.created_at,
    mergedAt: row.merged_at ?? undefined,
    confidence: row.confidence,
  };
}

function filePathMatch(eventPaths: string[], queryFiles: string[]): number {
  let best = 0;
  for (const queryFile of queryFiles) {
    const queryBase = path.posix.basename(queryFile).toLowerCase();
    const queryDir = path.posix.dirname(queryFile).toLowerCase();
    for (const eventPath of eventPaths) {
      const eventBase = path.posix.basename(eventPath).toLowerCase();
      const eventDir = path.posix.dirname(eventPath).toLowerCase();
      if (queryFile.toLowerCase() === eventPath.toLowerCase()) best = Math.max(best, 1);
      else if (queryBase === eventBase) best = Math.max(best, 0.7);
      else if (queryDir === eventDir) best = Math.max(best, 0.55);
    }
  }
  return best;
}

function symbolMatch(event: RegressionEvent, querySymbols: string[]): number {
  const eventSymbols = event.symbols.map((symbol) => symbol.toLowerCase());
  let best = 0;
  for (const symbol of querySymbols) {
    const lower = symbol.toLowerCase();
    if (eventSymbols.includes(lower)) best = Math.max(best, 1);
    else if (event.summary.toLowerCase().includes(lower)) best = Math.max(best, 0.65);
  }
  return best;
}

function textMatch(event: RegressionEvent, inputText: string): number {
  const tokens = tokenizeSearchText(inputText, 32);
  if (tokens.length === 0) return 0;
  const haystack =
    `${event.summary} ${event.filePaths.join(" ")} ${event.symbols.join(" ")} ${event.signals.join(" ")}`.toLowerCase();
  return tokens.filter((token) => haystack.includes(token.toLowerCase())).length / tokens.length;
}

function recencyScore(event: RegressionEvent): number {
  const timestamp = Date.parse(event.mergedAt ?? event.createdAt);
  if (Number.isNaN(timestamp)) return 0.25;
  const ageDays = Math.max(0, (Date.now() - timestamp) / (1000 * 60 * 60 * 24));
  if (ageDays < 180) return 1;
  if (ageDays < 730) return 0.7;
  return 0.35;
}

function matchReasons(parts: Record<string, number>, event: RegressionEvent): string[] {
  const reasons: string[] = [];
  if ((parts.filePathMatch ?? 0) >= 0.9) reasons.push("exact file path match");
  else if ((parts.filePathMatch ?? 0) >= 0.45) reasons.push("related file path match");
  if ((parts.symbolMatch ?? 0) >= 0.9) reasons.push("exact symbol match");
  if ((parts.textMatch ?? 0) >= 0.35) reasons.push("text matched task or diff terms");
  if (event.signals.length > 0)
    reasons.push(`regression signals: ${event.signals.slice(0, 3).join(", ")}`);
  return reasons.slice(0, 5);
}

function loadRegressionEvents(db: AnchorDatabase): RegressionEvent[] {
  const rows = db
    .prepare(
      "SELECT * FROM regression_events ORDER BY COALESCE(merged_at, created_at) DESC LIMIT 200",
    )
    .all() as RegressionRow[];
  return rows.map(rowToEvent);
}

export function rankRegressionEvents(
  db: AnchorDatabase,
  input: AnchorContextInput | SearchHistoryInput,
): RankedRegressionEvent[] {
  const queryFiles = input.files ?? [];
  const querySymbols = "symbols" in input ? (input.symbols ?? []) : [];
  const inputText =
    "task" in input ? `${input.task} ${input.diff ?? ""} ${input.currentCode ?? ""}` : input.query;
  const ranked = loadRegressionEvents(db)
    .map((event) => {
      const parts = {
        filePathMatch: filePathMatch(event.filePaths, queryFiles),
        symbolMatch: symbolMatch(event, querySymbols),
        textMatch: textMatch(event, inputText),
        recency: recencyScore(event),
        confidence: event.confidence,
      };
      const score =
        0.35 * parts.filePathMatch +
        0.2 * parts.symbolMatch +
        0.2 * parts.textMatch +
        0.15 * parts.recency +
        0.1 * parts.confidence;
      return {
        ...event,
        filePaths: uniqueStrings(event.filePaths),
        symbols: uniqueStrings(event.symbols),
        score: Number(score.toFixed(4)),
        matchReasons: matchReasons(parts, event),
        rankSignals: parts,
      };
    })
    .filter((event) => event.score > 0 || ("regressionsOnly" in input && input.regressionsOnly))
    .sort((a, b) => b.score - a.score || b.confidence - a.confidence);

  return ranked.slice(0, Math.min(5, clampMaxResults(input.maxResults, 5)));
}
