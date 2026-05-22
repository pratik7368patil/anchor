import type { AnchorDatabase } from "../db/database.js";
import type { AnchorReviewDiffInput } from "../types.js";
import { clipSentence, uniqueStrings } from "../utils/text.js";
import { buildAnchorContextResult } from "./context.js";
import type { FormattedResult } from "./formatter.js";

export function filesFromDiff(diff: string): string[] {
  const files: string[] = [];
  for (const line of diff.split("\n")) {
    const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (match?.[2] && match[2] !== "/dev/null") files.push(match[2]);
    const plus = line.match(/^\+\+\+ b\/(.+)$/);
    if (plus?.[1] && plus[1] !== "/dev/null") files.push(plus[1]);
  }
  return uniqueStrings(files);
}

type MetadataItem = {
  category?: string;
  confidenceLevel?: string;
  freshnessStatus?: string;
  sanitizedSnippet?: string;
  prNumber?: number;
  prUrl?: string;
};

type MetadataRegression = {
  prNumber?: number;
  prUrl?: string;
  summary?: string;
  filePaths?: string[];
};

type MetadataTest = {
  path?: string;
  reason?: string;
};

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function reviewDiff(
  db: AnchorDatabase,
  cwd: string,
  input: AnchorReviewDiffInput,
): FormattedResult {
  const files = input.files?.length ? input.files : filesFromDiff(input.diff);
  const contextInput = {
    task: "Review this diff against Anchor history, team rules, regressions, and tests.",
    files,
    diff: input.diff,
    strict: input.strict,
    maxResults: input.maxResults,
  };
  const context = buildAnchorContextResult(db, cwd, contextInput);
  const items = asArray<MetadataItem>(context.metadata.items);
  const regressions = asArray<MetadataRegression>(context.metadata.regressionEvents);
  const tests = asArray<MetadataTest>(context.metadata.relevantTests);
  const ruleItems = asArray<MetadataItem>(context.metadata.teamRules);

  const blockerRules = ruleItems.filter(
    (item) => item.freshnessStatus !== "stale" && item.confidenceLevel !== "weak",
  );
  const historicalConstraints = items.filter((item) =>
    ["constraint", "api_contract", "security_note", "architecture_decision"].includes(
      item.category ?? "",
    ),
  );

  const lines = ["# Anchor Diff Review", "", `Changed files: ${files.join(", ") || "n/a"}`, ""];
  lines.push("## Blockers", "");
  if (blockerRules.length === 0) lines.push("- No evidence-backed blockers found.");
  else {
    for (const rule of blockerRules.slice(0, 4)) {
      lines.push(`- Team rule evidence may block this change: ${rule.category ?? "rule"}.`);
    }
  }

  lines.push("", "## Risks", "");
  const riskItems = items.filter((item) =>
    ["security_note", "bug_regression", "api_contract"].includes(item.category ?? ""),
  );
  if (riskItems.length === 0) lines.push("- No specific historical risks found.");
  else {
    for (const item of riskItems.slice(0, 5)) {
      lines.push(`- [${item.category}] PR #${item.prNumber}: preserve cited behavior.`);
    }
  }

  lines.push("", "## Historical constraints", "");
  if (historicalConstraints.length === 0) lines.push("- No matching constraints found.");
  else {
    for (const item of historicalConstraints.slice(0, 5)) {
      lines.push(`- PR #${item.prNumber}: ${item.category} (${item.confidenceLevel}).`);
    }
  }

  lines.push("", "## Regression checks", "");
  if (regressions.length === 0) lines.push("- No related regression memory found.");
  else {
    for (const event of regressions.slice(0, 5)) {
      lines.push(`- PR #${event.prNumber}: ${clipSentence(event.summary ?? "", 180)}`);
    }
  }

  lines.push("", "## Recommended tests", "");
  if (tests.length === 0) lines.push("- No related tests found in the local index.");
  else {
    for (const test of tests.slice(0, 6)) {
      lines.push(`- ${test.path ?? "unknown test"} (${test.reason ?? "related"})`);
    }
  }

  return {
    markdown: lines.join("\n"),
    metadata: {
      ...context.metadata,
      mode: "review_diff",
      changedFiles: files,
    },
  };
}
