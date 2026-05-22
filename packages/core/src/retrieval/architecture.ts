import type { AnchorDatabase } from "../db/database.js";
import type { ArchitectureArea, RankedArchitecturePattern } from "../types.js";
import { clipSentence, uniqueStrings } from "../utils/text.js";
import { rankArchitecturePatterns } from "./architecture-ranker.js";
import type { FormattedResult } from "./formatter.js";

export type ArchitectureContextInput = {
  file?: string;
  area?: ArchitectureArea;
  query?: string;
  maxResults?: number;
};

export type ArchitectureCheckInput = {
  diff: string;
  files?: string[];
  maxResults?: number;
};

export function architectureFilesFromDiff(diff: string): string[] {
  const files: string[] = [];
  for (const line of diff.split("\n")) {
    const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (match?.[2] && match[2] !== "/dev/null") files.push(match[2]);
    const plus = line.match(/^\+\+\+ b\/(.+)$/);
    if (plus?.[1] && plus[1] !== "/dev/null") files.push(plus[1]);
  }
  return uniqueStrings(files);
}

function formatPatternList(patterns: RankedArchitecturePattern[]): string[] {
  if (patterns.length === 0) return ["No matching architecture patterns found."];
  return patterns.flatMap((pattern, index) => [
    `${index + 1}. [${pattern.area}] ${clipSentence(pattern.sanitizedSummary, 260)}`,
    `   Evidence: ${pattern.sourceFiles.slice(0, 6).join(", ") || "indexed code"}`,
    `   Confidence: ${pattern.confidence.toFixed(2)}`,
    `   Match: ${pattern.matchReasons.join(", ")}`,
    "",
  ]);
}

function architectureMetadata(
  mode: "architecture" | "architecture_check",
  patterns: RankedArchitecturePattern[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    mode,
    architecturePatterns: patterns.map((pattern) => ({
      id: pattern.id,
      score: pattern.score,
      area: pattern.area,
      name: pattern.name,
      sanitizedSummary: clipSentence(pattern.sanitizedSummary, 280),
      sourceFiles: pattern.sourceFiles,
      symbols: pattern.symbols,
      confidence: pattern.confidence,
      evidence: pattern.evidence,
      matchReasons: pattern.matchReasons,
      rankSignals: pattern.rankSignals,
    })),
    ...extra,
  };
}

export function getArchitectureContext(
  db: AnchorDatabase,
  _cwd: string,
  input: ArchitectureContextInput = {},
): FormattedResult {
  const task =
    input.query ??
    (input.file
      ? `Explain architecture patterns for ${input.file}`
      : input.area
        ? `Explain ${input.area} architecture patterns`
        : "Summarize repository architecture patterns");
  const patterns = rankArchitecturePatterns(db, {
    task,
    files: input.file ? [input.file] : undefined,
    area: input.area,
    maxResults: input.maxResults ?? 8,
  });
  const lines = ["# Anchor Architecture", ""];
  if (input.file) lines.push(`File: ${input.file}`);
  if (input.area) lines.push(`Area: ${input.area}`);
  if (input.query) lines.push(`Query: ${input.query}`);
  if (input.file || input.area || input.query) lines.push("");

  lines.push("## Patterns", "", ...formatPatternList(patterns));
  lines.push("## Recommended implementation path", "");
  if (patterns.length === 0) {
    lines.push("- Run `anchor index-code` to refresh current-code architecture evidence.");
    lines.push("- Search nearby files manually before changing architecture-sensitive code.");
  } else {
    lines.push("- Follow the highest-ranked current-code pattern for placement and imports.");
    lines.push("- Update related tests when the pattern evidence cites nearby tests.");
    lines.push(
      "- Use PR/team-rule evidence from `anchor_get_context` for stronger historical constraints.",
    );
  }

  return {
    markdown: lines.join("\n"),
    metadata: architectureMetadata("architecture", patterns, {
      file: input.file,
      area: input.area,
      query: input.query,
    }),
  };
}

export function checkArchitecture(
  db: AnchorDatabase,
  _cwd: string,
  input: ArchitectureCheckInput,
): FormattedResult {
  const files = input.files?.length ? input.files : architectureFilesFromDiff(input.diff);
  const patterns = rankArchitecturePatterns(db, {
    task: "Check this diff against current architecture patterns",
    files,
    diff: input.diff,
    maxResults: input.maxResults ?? 8,
  });
  const lines = [
    "# Anchor Architecture Check",
    "",
    `Changed files: ${files.join(", ") || "n/a"}`,
    "",
    "## Matching patterns",
    "",
    ...formatPatternList(patterns),
    "## Architecture risks",
    "",
  ];
  if (patterns.length === 0) {
    lines.push(
      "- No matching architecture evidence found. Run `anchor index-code` or inspect nearby files.",
    );
  } else {
    lines.push("- Check that new files live in the same layer/area as matching examples.");
    lines.push("- Check imports follow the observed direction between layers.");
    lines.push("- Check related tests follow the cited test placement pattern.");
  }

  return {
    markdown: lines.join("\n"),
    metadata: architectureMetadata("architecture_check", patterns, {
      changedFiles: files,
    }),
  };
}
