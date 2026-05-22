import path from "node:path";
import type {
  AnchorContextInput,
  ConfidenceLevel,
  RankedWisdomUnit,
  SearchHistoryInput,
  WisdomCategory,
  WisdomUnit,
} from "../types.js";
import type { AnchorDatabase } from "../db/database.js";
import { tokenizeSearchText, uniqueStrings } from "../utils/text.js";
import { buildFtsQuery, clampMaxResults } from "./query-builder.js";
import {
  claimKeyFor,
  confidenceAtLeast,
  confidenceLevelFor,
  confidenceReasonsFor,
  evaluateFreshness,
  evidenceForWisdom,
  loadCurrentCodeSnapshot,
} from "./evidence.js";

type WisdomUnitRow = {
  id: string;
  repo: string;
  pr_number: number;
  pr_url: string;
  source_type: WisdomUnit["sourceType"];
  category: WisdomCategory;
  text: string;
  sanitized_text: string;
  file_paths_json: string;
  symbols_json: string;
  authors_json: string;
  created_at: string;
  merged_at?: string | null;
  confidence: number;
  bm25?: number;
};

type ClaimRepetitionRow = {
  category: WisdomCategory;
  sanitized_text: string;
  pr_number: number;
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

function rowToWisdomUnit(row: WisdomUnitRow): WisdomUnit & { bm25?: number } {
  return {
    id: row.id,
    repo: row.repo,
    prNumber: row.pr_number,
    prUrl: row.pr_url,
    sourceType: row.source_type,
    category: row.category,
    text: row.text,
    sanitizedText: row.sanitized_text,
    filePaths: parseJsonArray(row.file_paths_json),
    symbols: parseJsonArray(row.symbols_json),
    authors: parseJsonArray(row.authors_json),
    createdAt: row.created_at,
    mergedAt: row.merged_at ?? undefined,
    confidence: row.confidence,
    bm25: row.bm25,
  };
}

function categoryPriority(category: WisdomCategory): number {
  const priorities: Record<WisdomCategory, number> = {
    security_note: 1,
    bug_regression: 0.95,
    api_contract: 0.9,
    architecture_decision: 0.82,
    constraint: 0.75,
    testing_rule: 0.65,
    performance_note: 0.58,
    rejected_approach: 0.5,
    style_convention: 0.35,
    unknown: 0.1,
  };
  return priorities[category];
}

function filePathMatch(unitPaths: string[], queryFiles: string[]): number {
  if (queryFiles.length === 0 || unitPaths.length === 0) return 0;
  let best = 0;
  for (const queryFile of queryFiles) {
    const queryBase = path.basename(queryFile).toLowerCase();
    const queryDir = path.dirname(queryFile).toLowerCase();
    for (const unitPath of unitPaths) {
      const unitBase = path.basename(unitPath).toLowerCase();
      const unitDir = path.dirname(unitPath).toLowerCase();
      const q = queryFile.toLowerCase();
      const u = unitPath.toLowerCase();
      if (q === u) best = Math.max(best, 1);
      else if (queryBase === unitBase) best = Math.max(best, 0.68);
      else if (queryDir === unitDir) best = Math.max(best, 0.62);
      else if (unitDir.startsWith(queryDir) || queryDir.startsWith(unitDir))
        best = Math.max(best, 0.38);
      else if (queryBase && unitBase && queryBase.split(".")[0] === unitBase.split(".")[0]) {
        best = Math.max(best, 0.48);
      }
    }
  }
  return best;
}

function symbolMatch(unit: WisdomUnit, querySymbols: string[]): number {
  if (querySymbols.length === 0) return 0;
  const unitSymbols = unit.symbols.map((symbol) => symbol.toLowerCase());
  const text = unit.sanitizedText.toLowerCase();
  let best = 0;
  for (const symbol of querySymbols) {
    const lower = symbol.toLowerCase();
    if (unitSymbols.includes(lower)) best = Math.max(best, 1);
    else if (text.includes(`\`${lower}\``)) best = Math.max(best, 1);
    else if (new RegExp(`\\b${escapeRegExp(lower)}\\b`, "i").test(text))
      best = Math.max(best, 0.66);
    else if (
      unitSymbols.some((candidate) => candidate.includes(lower) || lower.includes(candidate))
    ) {
      best = Math.max(best, 0.35);
    }
  }
  return best;
}

function textMatch(unit: WisdomUnit & { bm25?: number }, inputText: string): number {
  const queryTokens = tokenizeSearchText(inputText, 32);
  if (queryTokens.length === 0) return unit.bm25 === undefined ? 0 : 0.45;
  const haystack =
    `${unit.sanitizedText} ${unit.filePaths.join(" ")} ${unit.symbols.join(" ")}`.toLowerCase();
  const overlap =
    queryTokens.filter((token) => haystack.includes(token.toLowerCase())).length /
    queryTokens.length;
  const bm25Signal =
    unit.bm25 === undefined ? 0 : Math.max(0.25, Math.min(1, 1 / (1 + Math.abs(unit.bm25))));
  return Math.max(overlap, bm25Signal);
}

function reviewerOrAuthorSignal(unit: WisdomUnit): number {
  if (unit.sourceType === "review_comment" || unit.sourceType === "review_summary") return 0.9;
  if (unit.sourceType === "pr_body") return 0.62;
  if (unit.sourceType === "commit_message") return 0.5;
  if (unit.sourceType === "diff_context") return 0.45;
  return 0.28;
}

function recencyScore(unit: WisdomUnit): number {
  const timestamp = Date.parse(unit.mergedAt ?? unit.createdAt);
  if (Number.isNaN(timestamp)) return 0.3;
  const ageDays = Math.max(0, (Date.now() - timestamp) / (1000 * 60 * 60 * 24));
  if (ageDays < 180) return 1;
  if (ageDays < 730) return 0.75;
  if (ageDays < 1460) return 0.45;
  return 0.25;
}

function freshnessMultiplier(status: RankedWisdomUnit["freshnessStatus"]): number {
  if (status === "current") return 1;
  if (status === "possibly_stale") return 0.85;
  return 0.55;
}

function scoreUnit(
  unit: WisdomUnit & { bm25?: number },
  input: AnchorContextInput | SearchHistoryInput,
  duplicateCount: number,
  repeatedEvidenceCount: number,
  freshness: ReturnType<typeof evaluateFreshness>,
): RankedWisdomUnit {
  const queryFiles = input.files ?? [];
  const querySymbols = "symbols" in input ? (input.symbols ?? []) : [];
  const inputText =
    "task" in input ? `${input.task} ${input.diff ?? ""} ${input.currentCode ?? ""}` : input.query;
  const repetition = Math.min(1, Math.max(duplicateCount, repeatedEvidenceCount) / 3);
  const claimKey = claimKeyFor(unit.category, unit.sanitizedText);
  const parts = {
    filePathMatch: filePathMatch(unit.filePaths, queryFiles),
    symbolMatch: symbolMatch(unit, querySymbols),
    textMatch: textMatch(unit, inputText),
    reviewerOrAuthorSignal: reviewerOrAuthorSignal(unit),
    recencyOrRepetition: Math.max(recencyScore(unit), repetition),
    categoryPriority: categoryPriority(unit.category),
  };

  const score =
    (0.35 * parts.filePathMatch +
      0.2 * parts.symbolMatch +
      0.2 * parts.textMatch +
      0.1 * parts.reviewerOrAuthorSignal +
      0.1 * parts.recencyOrRepetition +
      0.05 * parts.categoryPriority) *
    freshnessMultiplier(freshness.status);

  return {
    ...unit,
    score: Number(score.toFixed(4)),
    scoreParts: parts,
    duplicateCount,
    claimKey,
    repeatedEvidenceCount,
    confidenceLevel: confidenceLevelFor(unit.confidence),
    confidenceReasons: confidenceReasonsFor(unit, repeatedEvidenceCount),
    freshnessStatus: freshness.status,
    freshnessReason: freshness.reason,
    evidence: evidenceForWisdom(unit),
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function loadCandidates(
  db: AnchorDatabase,
  input: AnchorContextInput | SearchHistoryInput,
): Array<WisdomUnit & { bm25?: number }> {
  const ftsQuery = buildFtsQuery(input);
  const categories = "categories" in input ? (input.categories ?? []) : [];
  const categorySql = categories.length
    ? ` AND wu.category IN (${categories.map(() => "?").join(", ")})`
    : "";

  if (ftsQuery) {
    const rows = db
      .prepare(
        `SELECT wu.*, bm25(wisdom_units_fts) AS bm25
         FROM wisdom_units_fts
         JOIN wisdom_units wu ON wu.id = wisdom_units_fts.unitId
         WHERE wisdom_units_fts MATCH ?${categorySql}
         ORDER BY bm25(wisdom_units_fts)
         LIMIT 150`,
      )
      .all(ftsQuery, ...categories) as WisdomUnitRow[];
    if (rows.length > 0) return rows.map(rowToWisdomUnit);
  }

  const rows = db
    .prepare(
      `SELECT wu.*, NULL AS bm25
       FROM wisdom_units wu
       WHERE 1 = 1${categorySql}
       ORDER BY COALESCE(merged_at, created_at) DESC
       LIMIT 150`,
    )
    .all(...categories) as WisdomUnitRow[];
  return rows.map(rowToWisdomUnit);
}

function loadClaimRepetitionCounts(db: AnchorDatabase): Map<string, number> {
  const rows = db
    .prepare("SELECT category, sanitized_text, pr_number FROM wisdom_units")
    .all() as ClaimRepetitionRow[];
  const grouped = new Map<string, Set<number>>();
  for (const row of rows) {
    const key = claimKeyFor(row.category, row.sanitized_text);
    const prs = grouped.get(key) ?? new Set<number>();
    prs.add(row.pr_number);
    grouped.set(key, prs);
  }
  return new Map([...grouped.entries()].map(([key, prs]) => [key, prs.size]));
}

function minConfidence(input: AnchorContextInput | SearchHistoryInput): ConfidenceLevel {
  if ("minConfidence" in input && input.minConfidence) return input.minConfidence;
  return "strong";
}

function passesStrictMode(
  unit: RankedWisdomUnit,
  input: AnchorContextInput | SearchHistoryInput,
): boolean {
  if (!("strict" in input) || !input.strict) return true;
  if (unit.freshnessStatus === "stale") return false;
  return confidenceAtLeast(unit.confidenceLevel, minConfidence(input));
}

export function rankWisdomUnits(
  db: AnchorDatabase,
  input: AnchorContextInput | SearchHistoryInput,
): RankedWisdomUnit[] {
  const candidates = loadCandidates(db, input);
  const codeSnapshot = loadCurrentCodeSnapshot(db);
  const repetitionCounts = loadClaimRepetitionCounts(db);
  const duplicates = new Map<string, number>();
  for (const unit of candidates) {
    const key = claimKeyFor(unit.category, unit.sanitizedText);
    duplicates.set(key, (duplicates.get(key) ?? 0) + 1);
  }

  const ranked = candidates
    .map((unit) => {
      const key = claimKeyFor(unit.category, unit.sanitizedText);
      return scoreUnit(
        unit,
        input,
        duplicates.get(key) ?? 1,
        repetitionCounts.get(key) ?? 1,
        evaluateFreshness(unit, codeSnapshot),
      );
    })
    .filter((unit) => passesStrictMode(unit, input))
    .sort((a, b) => b.score - a.score || b.confidence - a.confidence);

  const grouped = new Map<string, RankedWisdomUnit>();
  for (const unit of ranked) {
    const key = unit.claimKey;
    const existing = grouped.get(key);
    if (!existing || unit.score > existing.score) {
      grouped.set(key, {
        ...unit,
        filePaths: uniqueStrings([...(existing?.filePaths ?? []), ...unit.filePaths]),
        symbols: uniqueStrings([...(existing?.symbols ?? []), ...unit.symbols]),
        authors: uniqueStrings([...(existing?.authors ?? []), ...unit.authors]),
        duplicateCount: Math.max(unit.duplicateCount, existing?.duplicateCount ?? 1),
        repeatedEvidenceCount: Math.max(
          unit.repeatedEvidenceCount,
          existing?.repeatedEvidenceCount ?? 1,
        ),
      });
    }
  }

  const limit = clampMaxResults(input.maxResults, "task" in input ? 8 : 10);
  return [...grouped.values()]
    .sort((a, b) => b.score - a.score || b.confidence - a.confidence)
    .slice(0, limit);
}
