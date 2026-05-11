import type { AnchorContextInput, IndexStatus, RankedWisdomUnit, WisdomCategory } from "../types.js";
import { clipSentence } from "../utils/text.js";

export type FormattedResult = {
  markdown: string;
  metadata: Record<string, unknown>;
};

function evidenceLine(unit: RankedWisdomUnit): string {
  const author = unit.authors[0] ? ` by @${unit.authors[0]}` : "";
  const file = unit.filePaths[0] ? `, ${unit.filePaths[0]}` : "";
  return `PR #${unit.prNumber}${author}, ${unit.sourceType}${file}`;
}

function whyItMatters(unit: RankedWisdomUnit, input: AnchorContextInput): string {
  const prefix = unit.confidence < 0.7 ? "Historical evidence suggests " : "";
  const target = input.files?.[0] ? ` when editing ${input.files[0]}` : " for this change";
  const categoryReasons: Record<WisdomCategory, string> = {
    security_note: `${prefix}there is a security-sensitive constraint to preserve${target}.`,
    bug_regression: `${prefix}similar changes have caused regressions before${target}.`,
    api_contract: `${prefix}there is an API or compatibility contract to preserve${target}.`,
    architecture_decision: `${prefix}the current design appears intentional${target}.`,
    constraint: `${prefix}there is a constraint reviewers previously called out${target}.`,
    testing_rule: `${prefix}tests were treated as important evidence for this area.`,
    performance_note: `${prefix}performance behavior may depend on this implementation detail.`,
    rejected_approach: `${prefix}a related approach may have been rejected previously.`,
    style_convention: `${prefix}there may be a local convention to follow.`,
    unknown: `${prefix}this may be relevant background evidence.`,
  };
  return categoryReasons[unit.category];
}

function riskLines(units: RankedWisdomUnit[]): string[] {
  const risks = new Set<string>();
  for (const unit of units) {
    if (unit.category === "security_note") risks.add("Avoid logging, exposing, or weakening security-sensitive values.");
    if (unit.category === "bug_regression") risks.add("Check for regressions similar to the cited PR history.");
    if (unit.category === "api_contract") risks.add("Preserve documented API and backward-compatibility contracts.");
    if (unit.category === "constraint") risks.add("Do not remove constraints without verifying the original reason no longer applies.");
  }
  return [...risks].slice(0, 4);
}

export function formatAnchorContext(
  units: RankedWisdomUnit[],
  input: AnchorContextInput,
): FormattedResult {
  const lines = ["# Anchor Context", "", "## Must know", ""];
  if (units.length === 0) {
    lines.push("No directly relevant indexed PR history found.", "");
  } else {
    units.forEach((unit, index) => {
      const statement =
        unit.confidence < 0.7
          ? `Historical evidence suggests ${clipSentence(unit.sanitizedText)}`
          : clipSentence(unit.sanitizedText);
      lines.push(`${index + 1}. [${unit.category}] ${statement}`);
      lines.push(`   Evidence: ${evidenceLine(unit)}`);
      lines.push(`   Why it matters: ${whyItMatters(unit, input)}`);
      lines.push(`   Link: ${unit.prUrl}`);
      lines.push("");
    });
  }

  lines.push("## Risks", "");
  const risks = riskLines(units);
  if (risks.length === 0) {
    lines.push("- No specific historical risks found in the local index.");
  } else {
    for (const risk of risks) lines.push(`- ${risk}`);
  }

  lines.push("", "## Recommended checks", "");
  lines.push("- Check related tests.");
  lines.push("- Check sibling files.");
  lines.push("- Search for related overloads or API contracts.");

  return {
    markdown: lines.join("\n"),
    metadata: {
      resultCount: units.length,
      items: units.map((unit) => ({
        id: unit.id,
        score: unit.score,
        confidence: unit.confidence,
        category: unit.category,
        prNumber: unit.prNumber,
        prUrl: unit.prUrl,
        sourceType: unit.sourceType,
        filePaths: unit.filePaths,
        symbols: unit.symbols,
        duplicateCount: unit.duplicateCount,
      })),
    },
  };
}

export function formatSearchHistory(units: RankedWisdomUnit[]): FormattedResult {
  const lines = ["# Anchor Search History", ""];
  if (units.length === 0) {
    lines.push("No matching indexed PR history found.");
  } else {
    for (const unit of units) {
      lines.push(`- [${unit.category}] ${clipSentence(unit.sanitizedText, 260)}`);
      lines.push(
        `  Evidence: PR #${unit.prNumber}, ${unit.sourceType}, confidence ${unit.confidence.toFixed(2)}`,
      );
      lines.push(`  Files: ${unit.filePaths.slice(0, 5).join(", ") || "n/a"}`);
      lines.push(`  Symbols: ${unit.symbols.slice(0, 8).join(", ") || "n/a"}`);
      lines.push(`  Link: ${unit.prUrl}`);
    }
  }
  return {
    markdown: lines.join("\n"),
    metadata: {
      resultCount: units.length,
      items: units.map((unit) => ({
        id: unit.id,
        score: unit.score,
        confidence: unit.confidence,
        category: unit.category,
        prNumber: unit.prNumber,
        prUrl: unit.prUrl,
        sourceType: unit.sourceType,
        sanitizedSnippet: clipSentence(unit.sanitizedText, 260),
        matchedFiles: unit.filePaths,
        matchedSymbols: unit.symbols,
      })),
    },
  };
}

export function formatIndexStatus(status: IndexStatus): FormattedResult {
  const lines = [
    "# Anchor Index Status",
    "",
    `- Repo: ${status.repo ?? "unknown"}`,
    `- Database: ${status.databasePath}`,
    `- Pull requests: ${status.prCount}`,
    `- Files: ${status.fileCount}`,
    `- Comments: ${status.commentCount}`,
    `- Wisdom units: ${status.wisdomUnitCount}`,
    `- Last sync: ${status.lastSyncTime ?? "never"}`,
    `- GitHub token configured: ${status.githubTokenConfigured ? "yes" : "no"}`,
    `- Health: ${status.health}`,
  ];
  return { markdown: lines.join("\n"), metadata: status as unknown as Record<string, unknown> };
}
