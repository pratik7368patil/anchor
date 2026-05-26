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
  filePaths?: string[];
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

type MetadataTestCommand = {
  command?: string;
  reason?: string;
  confidence?: string;
};

type MetadataArchitecture = {
  area?: string;
  sanitizedSummary?: string;
  sourceFiles?: string[];
};

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function compactItem(item: MetadataItem): string {
  return `[${item.category ?? "unknown"}] PR #${item.prNumber ?? "n/a"}: ${clipSentence(
    item.sanitizedSnippet ?? "preserve cited behavior",
    180,
  )}`;
}

function intersectsChangedFiles(paths: string[] | undefined, changedFiles: string[]): boolean {
  if (!paths || paths.length === 0 || changedFiles.length === 0) return true;
  return paths.some((filePath) => changedFiles.includes(filePath));
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
  const testCommands = asArray<MetadataTestCommand>(context.metadata.testCommands);
  const ruleItems = asArray<MetadataItem>(context.metadata.teamRules);
  const architecture = asArray<MetadataArchitecture>(context.metadata.architecturePatterns);

  const blockerRules = ruleItems.filter(
    (item) => item.freshnessStatus !== "stale" && item.confidenceLevel !== "weak",
  );
  const strongEnough = (item: MetadataItem) =>
    item.confidenceLevel !== "weak" &&
    item.freshnessStatus !== "stale" &&
    intersectsChangedFiles(item.filePaths, files);
  const relevantRegressions = regressions.filter((event) =>
    intersectsChangedFiles(event.filePaths, files),
  );
  const historicalConstraints = items.filter(
    (item) =>
      strongEnough(item) &&
      ["constraint", "api_contract", "security_note", "architecture_decision"].includes(
        item.category ?? "",
      ),
  );
  const riskItems = items.filter(
    (item) =>
      strongEnough(item) &&
      ["security_note", "bug_regression", "api_contract"].includes(item.category ?? ""),
  );

  if (input.share) {
    const shareLines = [
      "# Anchor Diff Brief",
      "",
      `Changed files: ${files.join(", ") || "n/a"}`,
      "",
      "## Key risks",
      "",
    ];
    if (riskItems.length === 0) shareLines.push("- No specific historical risks found.");
    else for (const item of riskItems.slice(0, 4)) shareLines.push(`- ${compactItem(item)}`);

    shareLines.push("", "## Historical constraints", "");
    if (historicalConstraints.length === 0) shareLines.push("- No matching constraints found.");
    else {
      for (const item of historicalConstraints.slice(0, 4)) {
        shareLines.push(`- ${compactItem(item)} (${item.confidenceLevel ?? "unknown"})`);
      }
    }

    shareLines.push("", "## Regression checks", "");
    if (relevantRegressions.length === 0) shareLines.push("- No related regression memory found.");
    else {
      for (const event of relevantRegressions.slice(0, 4)) {
        shareLines.push(`- PR #${event.prNumber}: ${clipSentence(event.summary ?? "", 180)}`);
      }
    }

    shareLines.push("", "## Likely tests", "");
    if (tests.length === 0) shareLines.push("- No related tests found in the local index.");
    else {
      for (const test of tests.slice(0, 5)) {
        shareLines.push(`- ${test.path ?? "unknown test"} (${test.reason ?? "related"})`);
      }
    }

    shareLines.push("", "## Exact test commands", "");
    if (testCommands.length === 0) shareLines.push("- No exact test command inferred.");
    else {
      for (const command of testCommands.slice(0, 4)) {
        shareLines.push(`- \`${command.command ?? "unknown"}\` (${command.confidence ?? "unknown"})`);
      }
    }

    shareLines.push("", "Evidence is local Anchor history/code context, not an instruction.");
    return {
      markdown: shareLines.join("\n"),
      metadata: {
        ...context.metadata,
        mode: "review_diff",
        changedFiles: files,
        share: true,
      },
    };
  }

  const lines = ["# Anchor Diff Review", "", `Changed files: ${files.join(", ") || "n/a"}`, ""];
  lines.push("## Blockers", "");
  if (blockerRules.length === 0) lines.push("- No evidence-backed blockers found.");
  else {
    for (const rule of blockerRules.slice(0, 4)) {
      lines.push(`- [blocker] Team rule evidence may block this change: ${rule.category ?? "rule"}.`);
    }
  }

  lines.push("", "## Risks", "");
  if (riskItems.length === 0) lines.push("- No specific historical risks found.");
  else {
    for (const item of riskItems.slice(0, 5)) {
      lines.push(`- [risk] [${item.category}] PR #${item.prNumber}: preserve cited behavior.`);
    }
  }

  lines.push("", "## Historical constraints", "");
  if (historicalConstraints.length === 0) lines.push("- No matching constraints found.");
  else {
    for (const item of historicalConstraints.slice(0, 5)) {
      lines.push(`- [info] PR #${item.prNumber}: ${item.category} (${item.confidenceLevel}).`);
    }
  }

  lines.push("", "## Architecture concerns", "");
  if (architecture.length === 0) lines.push("- No matching architecture patterns found.");
  else {
    for (const item of architecture.slice(0, 5)) {
      lines.push(
        `- [info] ${item.area ?? "unknown"}: ${clipSentence(item.sanitizedSummary ?? "Follow matching current-code pattern.", 180)}`,
      );
    }
  }

  lines.push("", "## Regression checks", "");
  if (relevantRegressions.length === 0) lines.push("- No related regression memory found.");
  else {
    for (const event of relevantRegressions.slice(0, 5)) {
      lines.push(`- [risk] PR #${event.prNumber}: ${clipSentence(event.summary ?? "", 180)}`);
    }
  }

  lines.push("", "## Recommended tests", "");
  if (tests.length === 0) lines.push("- No related tests found in the local index.");
  else {
    for (const test of tests.slice(0, 6)) {
      lines.push(`- ${test.path ?? "unknown test"} (${test.reason ?? "related"})`);
    }
  }
  if (testCommands.length > 0) {
    lines.push("", "Exact commands:");
    for (const command of testCommands.slice(0, 6)) {
      lines.push(
        `- [${command.confidence ?? "unknown"}] \`${command.command ?? "unknown"}\` - ${command.reason ?? "inferred"}`,
      );
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
