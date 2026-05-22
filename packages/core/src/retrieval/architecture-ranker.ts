import path from "node:path";
import type {
  AnchorContextInput,
  ArchitectureArea,
  ArchitecturePattern,
  EvidenceRef,
  RankedArchitecturePattern,
} from "../types.js";
import type { AnchorDatabase } from "../db/database.js";
import { buildFtsQuery, buildQueryTerms } from "./query-builder.js";

type ArchitecturePatternRow = {
  id: string;
  repo: string;
  area: ArchitectureArea;
  name: string;
  summary_sanitized: string;
  source_files_json: string;
  symbols_json: string;
  evidence_json: string;
  confidence: number;
  created_at: string;
  bm25?: number | null;
};

type ComponentAreaRow = { area: ArchitectureArea };
type ArchitectureRankParts = {
  filePath: number;
  symbol: number;
  text: number;
  area: number;
  confidence: number;
};

export type ArchitectureQueryInput = AnchorContextInput & {
  area?: ArchitectureArea;
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

function parseEvidence(value: string): EvidenceRef[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as EvidenceRef[]) : [];
  } catch {
    return [];
  }
}

function rowToPattern(row: ArchitecturePatternRow): ArchitecturePattern & { bm25?: number } {
  return {
    id: row.id,
    repo: row.repo,
    area: row.area,
    name: row.name,
    summary: row.summary_sanitized,
    sanitizedSummary: row.summary_sanitized,
    sourceFiles: parseJsonArray(row.source_files_json),
    symbols: parseJsonArray(row.symbols_json),
    evidence: parseEvidence(row.evidence_json),
    confidence: row.confidence,
    createdAt: row.created_at,
    bm25: row.bm25 ?? undefined,
  };
}

function filePathMatch(pattern: ArchitecturePattern, files: string[]): number {
  if (files.length === 0) return 0;
  let best = 0;
  for (const sourceFile of pattern.sourceFiles) {
    const sourceBase = path.basename(sourceFile).toLowerCase();
    const sourceDir = path.dirname(sourceFile).toLowerCase();
    for (const queryFile of files) {
      const queryBase = path.basename(queryFile).toLowerCase();
      const queryDir = path.dirname(queryFile).toLowerCase();
      if (sourceFile.toLowerCase() === queryFile.toLowerCase()) best = Math.max(best, 1);
      else if (sourceBase === queryBase) best = Math.max(best, 0.72);
      else if (sourceDir === queryDir) best = Math.max(best, 0.62);
      else if (sourceDir.startsWith(queryDir) || queryDir.startsWith(sourceDir)) {
        best = Math.max(best, 0.38);
      }
    }
  }
  return best;
}

function symbolMatch(pattern: ArchitecturePattern, symbols: string[]): number {
  if (symbols.length === 0) return 0;
  const indexed = pattern.symbols.map((symbol) => symbol.toLowerCase());
  let best = 0;
  for (const symbol of symbols) {
    const lower = symbol.toLowerCase();
    if (indexed.includes(lower)) best = Math.max(best, 1);
    else if (indexed.some((candidate) => candidate.includes(lower) || lower.includes(candidate))) {
      best = Math.max(best, 0.45);
    }
  }
  return best;
}

function textMatch(
  pattern: ArchitecturePattern & { bm25?: number },
  input: ArchitectureQueryInput,
): number {
  const terms = buildQueryTerms(input).slice(0, 32);
  const bm25Signal =
    pattern.bm25 === undefined ? 0 : Math.max(0.25, Math.min(1, 1 / (1 + Math.abs(pattern.bm25))));
  if (terms.length === 0) return bm25Signal;
  const haystack =
    `${pattern.area} ${pattern.name} ${pattern.sanitizedSummary} ${pattern.sourceFiles.join(
      " ",
    )} ${pattern.symbols.join(" ")}`.toLowerCase();
  const overlap =
    terms.filter((term) => haystack.includes(term.toLowerCase())).length / terms.length;
  return Math.max(overlap, bm25Signal);
}

function matchReasons(parts: ArchitectureRankParts, pattern: ArchitecturePattern): string[] {
  const reasons: string[] = [`${pattern.area} architecture pattern`];
  if (parts.filePath >= 0.9) reasons.push("exact file architecture evidence");
  else if (parts.filePath >= 0.45) reasons.push("nearby file architecture evidence");
  if (parts.symbol >= 0.9) reasons.push("symbol match");
  else if (parts.symbol >= 0.4) reasons.push("related symbol match");
  if (parts.area >= 0.9) reasons.push("area match");
  if (parts.text >= 0.25) reasons.push("query terms matched pattern");
  return reasons.slice(0, 5);
}

export function rankArchitecturePatterns(
  db: AnchorDatabase,
  input: ArchitectureQueryInput,
): RankedArchitecturePattern[] {
  const fileAreas = new Set<ArchitectureArea>();
  for (const file of input.files ?? []) {
    const row = db
      .prepare("SELECT area FROM architecture_components WHERE path = ? LIMIT 1")
      .get(file) as ComponentAreaRow | undefined;
    if (row?.area) fileAreas.add(row.area);
  }
  const candidates = new Map<string, ArchitecturePattern & { bm25?: number }>();
  const ftsQuery = buildFtsQuery(input);
  if (ftsQuery) {
    const rows = db
      .prepare(
        `SELECT ap.id, ap.repo, ap.area, ap.name, ap.summary_sanitized, ap.source_files_json,
                ap.symbols_json, ap.evidence_json, ap.confidence, ap.created_at,
                bm25(architecture_patterns_fts) AS bm25
         FROM architecture_patterns_fts
         JOIN architecture_patterns ap ON ap.id = architecture_patterns_fts.patternId
         WHERE architecture_patterns_fts MATCH ?
         ORDER BY bm25(architecture_patterns_fts)
         LIMIT 150`,
      )
      .all(ftsQuery) as ArchitecturePatternRow[];
    for (const row of rows) {
      const pattern = rowToPattern(row);
      candidates.set(pattern.id, pattern);
    }
  }

  const rows = db
    .prepare(
      `SELECT id, repo, area, name, summary_sanitized, source_files_json, symbols_json,
              evidence_json, confidence, created_at, NULL AS bm25
       FROM architecture_patterns
       ORDER BY confidence DESC, created_at DESC`,
    )
    .all() as ArchitecturePatternRow[];
  for (const row of rows) {
    const pattern = rowToPattern(row);
    candidates.set(pattern.id, { ...pattern, bm25: candidates.get(pattern.id)?.bm25 });
  }

  return [...candidates.values()]
    .filter((pattern) => !input.area || pattern.area === input.area)
    .map((pattern) => {
      const parts = {
        filePath: filePathMatch(pattern, input.files ?? []),
        symbol: symbolMatch(pattern, input.symbols ?? []),
        text: textMatch(pattern, input),
        area: input.area && pattern.area === input.area ? 1 : fileAreas.has(pattern.area) ? 1 : 0,
        confidence: pattern.confidence,
      };
      const score =
        (0.34 * parts.filePath +
          0.2 * parts.symbol +
          0.18 * parts.text +
          0.13 * parts.area +
          0.15 * parts.confidence) *
        (fileAreas.size > 0 && !fileAreas.has(pattern.area) ? 0.75 : 1);
      return {
        ...pattern,
        score: Number(score.toFixed(4)),
        matchReasons: matchReasons(parts, pattern),
        rankSignals: parts,
      };
    })
    .filter((pattern) => {
      if (input.files?.length || input.symbols?.length || input.area) return pattern.score > 0.08;
      return true;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(input.maxResults ?? 6, 12));
}
