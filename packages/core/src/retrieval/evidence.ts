import type { AnchorDatabase } from "../db/database.js";
import type {
  ConfidenceLevel,
  EvidenceRef,
  FreshnessStatus,
  SourceType,
  WisdomCategory,
  WisdomUnit,
} from "../types.js";
import { canonicalizeText } from "../utils/text.js";

type CodeFileRow = { path: string };
type CodeChunkSymbolRow = { file_path: string; symbols_json: string };

export type CurrentCodeSnapshot = {
  hasCodeIndex: boolean;
  filePaths: Set<string>;
  symbolsByFile: Map<string, Set<string>>;
  allSymbols: Set<string>;
};

export type FreshnessResult = {
  status: FreshnessStatus;
  reason: string;
};

export function claimKeyFor(category: WisdomCategory, sanitizedText: string): string {
  return `${category}:${canonicalizeText(sanitizedText).slice(0, 180)}`;
}

export function confidenceLevelFor(confidence: number): ConfidenceLevel {
  if (confidence >= 0.75) return "strong";
  if (confidence >= 0.55) return "moderate";
  return "weak";
}

export function confidenceRank(level: ConfidenceLevel): number {
  const ranks: Record<ConfidenceLevel, number> = {
    weak: 1,
    moderate: 2,
    strong: 3,
  };
  return ranks[level];
}

export function confidenceAtLeast(level: ConfidenceLevel, minimum: ConfidenceLevel): boolean {
  return confidenceRank(level) >= confidenceRank(minimum);
}

export function evidenceForWisdom(unit: WisdomUnit): EvidenceRef {
  return {
    prNumber: unit.prNumber,
    prUrl: unit.prUrl,
    sourceType: unit.sourceType,
    author: unit.authors[0],
    filePath: unit.filePaths[0],
  };
}

export function confidenceReasonsFor(unit: WisdomUnit, repeatedEvidenceCount: number): string[] {
  const reasons: string[] = [];
  if (unit.sourceType === "review_comment" || unit.sourceType === "review_summary") {
    reasons.push("reviewer evidence");
  } else if (unit.sourceType === "pr_body") {
    reasons.push("PR description evidence");
  } else if (unit.sourceType === "commit_message") {
    reasons.push("commit message evidence");
  } else {
    reasons.push(sourceTypeLabel(unit.sourceType));
  }

  if (unit.filePaths.length > 0) reasons.push("file-associated");
  if (unit.symbols.length > 0) reasons.push("symbol-associated");
  if (/\b(regression|this broke|broke|root cause)\b/i.test(unit.sanitizedText)) {
    reasons.push("regression language");
  }
  if (/\b(do not|don't|must|should not|avoid|invariant|contract)\b/i.test(unit.sanitizedText)) {
    reasons.push("constraint language");
  }
  if (repeatedEvidenceCount > 1) {
    reasons.push(`repeated across ${repeatedEvidenceCount} PRs`);
  }
  return reasons;
}

export function sourceTypeLabel(sourceType: SourceType): string {
  return sourceType.replace(/_/g, " ");
}

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

export function loadCurrentCodeSnapshot(db: AnchorDatabase): CurrentCodeSnapshot {
  const fileRows = db.prepare("SELECT path FROM code_files").all() as CodeFileRow[];
  const chunkRows = db
    .prepare("SELECT file_path, symbols_json FROM code_chunks")
    .all() as CodeChunkSymbolRow[];
  const filePaths = new Set(fileRows.map((row) => row.path));
  const symbolsByFile = new Map<string, Set<string>>();
  const allSymbols = new Set<string>();

  for (const row of chunkRows) {
    const symbols = parseJsonArray(row.symbols_json).map((symbol) => symbol.toLowerCase());
    const fileSymbols = symbolsByFile.get(row.file_path) ?? new Set<string>();
    for (const symbol of symbols) {
      fileSymbols.add(symbol);
      allSymbols.add(symbol);
    }
    symbolsByFile.set(row.file_path, fileSymbols);
  }

  return {
    hasCodeIndex: fileRows.length > 0 || chunkRows.length > 0,
    filePaths,
    symbolsByFile,
    allSymbols,
  };
}

export function evaluateFreshness(
  subject: { filePaths: string[]; symbols: string[] },
  snapshot: CurrentCodeSnapshot,
): FreshnessResult {
  if (!snapshot.hasCodeIndex) {
    return {
      status: "possibly_stale",
      reason: "No current code index is available to verify this evidence.",
    };
  }

  const filePaths = subject.filePaths.filter(Boolean);
  const symbols = subject.symbols.map((symbol) => symbol.toLowerCase()).filter(Boolean);

  if (filePaths.length > 0) {
    const existingFiles = filePaths.filter((filePath) => snapshot.filePaths.has(filePath));
    if (existingFiles.length === 0) {
      return {
        status: "stale",
        reason: "None of the historical file paths exist in the current code index.",
      };
    }

    if (symbols.length === 0) {
      return {
        status: "current",
        reason: "At least one historical file path exists in the current code index.",
      };
    }

    for (const filePath of existingFiles) {
      const fileSymbols = snapshot.symbolsByFile.get(filePath) ?? new Set<string>();
      if (symbols.some((symbol) => fileSymbols.has(symbol))) {
        return {
          status: "current",
          reason: "Historical file and symbol are present in the current code index.",
        };
      }
    }

    if (symbols.some((symbol) => snapshot.allSymbols.has(symbol))) {
      return {
        status: "possibly_stale",
        reason: "The historical file exists, but the referenced symbol appears elsewhere or moved.",
      };
    }

    return {
      status: "possibly_stale",
      reason: "The historical file exists, but referenced symbols were not found there.",
    };
  }

  if (symbols.length > 0 && symbols.some((symbol) => snapshot.allSymbols.has(symbol))) {
    return {
      status: "current",
      reason: "Referenced symbol exists in the current code index.",
    };
  }

  return {
    status: "possibly_stale",
    reason: "Evidence has no exact current file path to verify.",
  };
}
