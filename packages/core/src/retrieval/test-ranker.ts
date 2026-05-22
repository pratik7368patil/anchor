import path from "node:path";
import type { AnchorContextInput, RankedTestFile } from "../types.js";
import type { AnchorDatabase } from "../db/database.js";
import { clampMaxResults } from "./query-builder.js";

type TestCandidateRow = {
  path: string;
  language?: string | null;
  size_bytes: number;
  content_hash: string;
  updated_at: string;
  source_path?: string | null;
  reason?: string | null;
  strength?: number | null;
  symbols_json?: string | null;
  sanitized_text?: string | null;
};

function parseJsonArray(value?: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function baseStem(filePath: string): string {
  return path.posix
    .basename(filePath)
    .replace(/\.(test|spec)\.[^.]+$/i, "")
    .replace(/\.[^.]+$/i, "")
    .toLowerCase();
}

function rowToRanked(row: TestCandidateRow, input: AnchorContextInput): RankedTestFile {
  const symbols = parseJsonArray(row.symbols_json);
  const text = row.sanitized_text ?? "";
  const matchedSymbols = (input.symbols ?? []).filter((symbol) => {
    const lower = symbol.toLowerCase();
    return (
      symbols.some((candidate) => candidate.toLowerCase() === lower) ||
      new RegExp(`\\b${escapeRegExp(symbol)}\\b`, "i").test(text)
    );
  });
  const exactFile = (input.files ?? []).some((file) => row.source_path === file);
  const basenameMatch = (input.files ?? []).some((file) => baseStem(file) === baseStem(row.path));
  const symbolScore = matchedSymbols.length > 0 ? 0.25 : 0;
  const score =
    (exactFile ? 0.55 : 0) +
    (basenameMatch ? 0.25 : 0) +
    (row.strength ?? 0.35) * 0.3 +
    symbolScore;

  return {
    repo: "",
    path: row.path,
    language: row.language ?? undefined,
    sizeBytes: row.size_bytes,
    contentHash: row.content_hash,
    updatedAt: row.updated_at,
    sourcePath: row.source_path ?? undefined,
    reason: row.reason ?? (basenameMatch ? "same basename" : "test file match"),
    strength: row.strength ?? 0.35,
    score: Number(score.toFixed(4)),
    matchedSymbols,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function rankRelevantTests(db: AnchorDatabase, input: AnchorContextInput): RankedTestFile[] {
  const candidates = new Map<string, TestCandidateRow>();

  for (const file of input.files ?? []) {
    const linkedRows = db
      .prepare(
        `SELECT tf.path, tf.language, tf.size_bytes, tf.content_hash, tf.updated_at,
                tl.source_path, tl.reason, tl.strength, cc.symbols_json, cc.sanitized_text
         FROM test_links tl
         JOIN test_files tf ON tf.repo_id = tl.repo_id AND tf.path = tl.test_path
         LEFT JOIN code_chunks cc ON cc.repo_id = tl.repo_id AND cc.file_path = tf.path
         WHERE tl.source_path = ?
         ORDER BY tl.strength DESC
         LIMIT 40`,
      )
      .all(file) as TestCandidateRow[];
    for (const row of linkedRows) candidates.set(row.path, row);

    const basename = baseStem(file);
    const basenameRows = db
      .prepare(
        `SELECT tf.path, tf.language, tf.size_bytes, tf.content_hash, tf.updated_at,
                NULL AS source_path, 'same basename' AS reason, 0.7 AS strength,
                cc.symbols_json, cc.sanitized_text
         FROM test_files tf
         LEFT JOIN code_chunks cc ON cc.file_path = tf.path
         WHERE lower(tf.path) LIKE ?
         LIMIT 25`,
      )
      .all(`%${basename}%`) as TestCandidateRow[];
    for (const row of basenameRows) candidates.set(row.path, row);
  }

  if (candidates.size === 0) {
    const rows = db
      .prepare(
        `SELECT tf.path, tf.language, tf.size_bytes, tf.content_hash, tf.updated_at,
                NULL AS source_path, 'recent test file' AS reason, 0.25 AS strength,
                cc.symbols_json, cc.sanitized_text
         FROM test_files tf
         LEFT JOIN code_chunks cc ON cc.file_path = tf.path
         ORDER BY tf.updated_at DESC
         LIMIT 20`,
      )
      .all() as TestCandidateRow[];
    for (const row of rows) candidates.set(row.path, row);
  }

  return [...candidates.values()]
    .map((row) => rowToRanked(row, input))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, Math.min(5, clampMaxResults(input.maxResults, 5)));
}
