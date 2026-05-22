import path from "node:path";
import type { AnchorContextInput, CodeChunk, RankedCodeChunk } from "../types.js";
import type { AnchorDatabase } from "../db/database.js";
import { tokenizeSearchText, uniqueStrings } from "../utils/text.js";
import { buildFtsQuery, clampMaxResults } from "./query-builder.js";

type CodeChunkRow = {
  id: string;
  repo: string;
  file_path: string;
  language?: string | null;
  start_line: number;
  end_line: number;
  sanitized_text: string;
  symbols_json: string;
  content_hash: string;
  updated_at: string;
  bm25?: number | null;
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

function rowToCodeChunk(row: CodeChunkRow): CodeChunk & { bm25?: number } {
  return {
    id: row.id,
    repo: row.repo,
    filePath: row.file_path,
    language: row.language ?? undefined,
    startLine: row.start_line,
    endLine: row.end_line,
    sanitizedText: row.sanitized_text,
    symbols: parseJsonArray(row.symbols_json),
    contentHash: row.content_hash,
    updatedAt: row.updated_at,
    bm25: row.bm25 ?? undefined,
  };
}

function filePathMatch(filePath: string, queryFiles: string[]): number {
  if (queryFiles.length === 0) return 0;
  let best = 0;
  const unitBase = path.basename(filePath).toLowerCase();
  const unitDir = path.dirname(filePath).toLowerCase();
  const unit = filePath.toLowerCase();

  for (const queryFile of queryFiles) {
    const query = queryFile.toLowerCase();
    const queryBase = path.basename(queryFile).toLowerCase();
    const queryDir = path.dirname(queryFile).toLowerCase();
    if (query === unit) best = Math.max(best, 1);
    else if (queryBase === unitBase) best = Math.max(best, 0.72);
    else if (queryDir === unitDir) best = Math.max(best, 0.62);
    else if (unitDir.startsWith(queryDir) || queryDir.startsWith(unitDir))
      best = Math.max(best, 0.38);
    else if (queryBase && unitBase && queryBase.split(".")[0] === unitBase.split(".")[0]) {
      best = Math.max(best, 0.48);
    }
  }

  return best;
}

function symbolMatch(chunk: CodeChunk, querySymbols: string[]): number {
  if (querySymbols.length === 0) return 0;
  const chunkSymbols = chunk.symbols.map((symbol) => symbol.toLowerCase());
  const text = chunk.sanitizedText.toLowerCase();
  let best = 0;

  for (const symbol of querySymbols) {
    const lower = symbol.toLowerCase();
    if (chunkSymbols.includes(lower)) best = Math.max(best, 1);
    else if (new RegExp(`\\b${escapeRegExp(lower)}\\b`, "i").test(text)) best = Math.max(best, 0.7);
    else if (
      chunkSymbols.some((candidate) => candidate.includes(lower) || lower.includes(candidate))
    ) {
      best = Math.max(best, 0.42);
    }
  }

  return best;
}

function textMatch(chunk: CodeChunk & { bm25?: number }, input: AnchorContextInput): number {
  const tokens = tokenizeSearchText(
    `${input.task} ${input.diff ?? ""} ${input.currentCode ?? ""}`,
    40,
  );
  const haystack =
    `${chunk.sanitizedText} ${chunk.filePath} ${chunk.symbols.join(" ")}`.toLowerCase();
  const overlap = tokens.length
    ? tokens.filter((token) => haystack.includes(token.toLowerCase())).length / tokens.length
    : 0;
  const bm25Signal =
    chunk.bm25 === undefined ? 0 : Math.max(0.25, Math.min(1, 1 / (1 + Math.abs(chunk.bm25))));
  return Math.max(overlap, bm25Signal);
}

function recencyScore(chunk: CodeChunk): number {
  const timestamp = Date.parse(chunk.updatedAt);
  if (Number.isNaN(timestamp)) return 0.25;
  const ageDays = Math.max(0, (Date.now() - timestamp) / (1000 * 60 * 60 * 24));
  if (ageDays < 30) return 1;
  if (ageDays < 180) return 0.75;
  if (ageDays < 730) return 0.45;
  return 0.25;
}

function matchReasons(parts: RankedCodeChunk["scoreParts"]): string[] {
  const reasons: string[] = [];
  if (parts.filePathMatch >= 0.9) reasons.push("exact file path match");
  else if (parts.filePathMatch >= 0.45) reasons.push("related file path match");
  if (parts.symbolMatch >= 0.9) reasons.push("exact symbol match");
  else if (parts.symbolMatch >= 0.45) reasons.push("symbol mentioned in current code");
  if (parts.textMatch >= 0.45) reasons.push("text matched task or diff terms");
  if (parts.recency >= 0.75) reasons.push("recent code file");
  return reasons.slice(0, 5);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function loadCodeCandidates(
  db: AnchorDatabase,
  input: AnchorContextInput,
): Array<CodeChunk & { bm25?: number }> {
  const candidates = new Map<string, CodeChunk & { bm25?: number }>();
  const ftsQuery = buildFtsQuery(input);

  if (ftsQuery) {
    const rows = db
      .prepare(
        `SELECT cc.*, bm25(code_chunks_fts) AS bm25
         FROM code_chunks_fts
         JOIN code_chunks cc ON cc.id = code_chunks_fts.chunkId
         WHERE code_chunks_fts MATCH ?
         ORDER BY bm25(code_chunks_fts)
         LIMIT 150`,
      )
      .all(ftsQuery) as CodeChunkRow[];
    for (const row of rows) {
      const chunk = rowToCodeChunk(row);
      candidates.set(chunk.id, chunk);
    }
  }

  for (const file of input.files ?? []) {
    const basename = path.basename(file);
    const rows = db
      .prepare(
        `SELECT cc.*, NULL AS bm25
         FROM code_chunks cc
         WHERE cc.file_path = ?
            OR cc.file_path LIKE ? ESCAPE '\\'
         LIMIT 80`,
      )
      .all(file, `%/${escapeLike(basename)}`) as CodeChunkRow[];
    for (const row of rows) {
      const chunk = rowToCodeChunk(row);
      candidates.set(chunk.id, { ...chunk, bm25: candidates.get(chunk.id)?.bm25 ?? chunk.bm25 });
    }
  }

  if (candidates.size === 0) {
    const rows = db
      .prepare(
        `SELECT cc.*, NULL AS bm25
         FROM code_chunks cc
         ORDER BY updated_at DESC
         LIMIT 80`,
      )
      .all() as CodeChunkRow[];
    for (const row of rows) {
      const chunk = rowToCodeChunk(row);
      candidates.set(chunk.id, chunk);
    }
  }

  return [...candidates.values()];
}

export function rankCodeChunks(db: AnchorDatabase, input: AnchorContextInput): RankedCodeChunk[] {
  const queryFiles = input.files ?? [];
  const querySymbols = input.symbols ?? [];
  const ranked = loadCodeCandidates(db, input)
    .map((chunk) => {
      const parts = {
        filePathMatch: filePathMatch(chunk.filePath, queryFiles),
        symbolMatch: symbolMatch(chunk, querySymbols),
        textMatch: textMatch(chunk, input),
        recency: recencyScore(chunk),
      };
      const score =
        0.4 * parts.filePathMatch +
        0.25 * parts.symbolMatch +
        0.25 * parts.textMatch +
        0.1 * parts.recency;
      return {
        ...chunk,
        symbols: uniqueStrings(chunk.symbols),
        score: Number(score.toFixed(4)),
        scoreParts: parts,
        matchReasons: matchReasons(parts),
        rankSignals: parts,
      };
    })
    .sort((a, b) => b.score - a.score || b.startLine - a.startLine);

  const limit = Math.min(5, clampMaxResults(input.maxResults, 5));
  return ranked.slice(0, limit);
}
