import type {
  AnchorContextInput,
  IndexStatus,
  RankedCodeChunk,
  RankedArchitecturePattern,
  RankedRegressionEvent,
  RankedTeamRule,
  RankedTestFile,
  RankedWisdomUnit,
  WisdomCategory,
} from "../types.js";
import { clipSentence } from "../utils/text.js";
import { buildQueryTerms } from "./query-builder.js";

export type FormattedResult = {
  markdown: string;
  metadata: Record<string, unknown>;
};

function evidenceLine(unit: RankedWisdomUnit): string {
  const author = unit.authors[0] ? ` by @${unit.authors[0]}` : "";
  const file = unit.filePaths[0] ? `, ${unit.filePaths[0]}` : "";
  return `PR #${unit.prNumber}${author}, ${unit.sourceType}${file}`;
}

function confidenceLine(unit: RankedWisdomUnit | RankedTeamRule): string {
  const reasons = unit.confidenceReasons.length ? ` (${unit.confidenceReasons.join(", ")})` : "";
  return `${unit.confidenceLevel}${reasons}`;
}

function currentCodeCheckLine(unit: RankedWisdomUnit | RankedTeamRule): string {
  return `${unit.freshnessStatus.replace(/_/g, " ")} - ${unit.freshnessReason}`;
}

function whyItMatters(unit: RankedWisdomUnit, input: AnchorContextInput): string {
  const prefix = unit.confidenceLevel === "weak" ? "Historical evidence suggests " : "";
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
    if (unit.category === "security_note")
      risks.add("Avoid logging, exposing, or weakening security-sensitive values.");
    if (unit.category === "bug_regression")
      risks.add("Check for regressions similar to the cited PR history.");
    if (unit.category === "api_contract")
      risks.add("Preserve documented API and backward-compatibility contracts.");
    if (unit.category === "constraint")
      risks.add(
        "Do not remove constraints without verifying the original reason no longer applies.",
      );
  }
  return [...risks].slice(0, 4);
}

export function formatAnchorContext(
  units: RankedWisdomUnit[],
  input: AnchorContextInput,
  codeChunks: RankedCodeChunk[] = [],
  teamRules: RankedTeamRule[] = [],
  warnings: string[] = [],
  relevantTests: RankedTestFile[] = [],
  regressionEvents: RankedRegressionEvent[] = [],
  architecturePatterns: RankedArchitecturePattern[] = [],
  extraMetadata: Record<string, unknown> = {},
): FormattedResult {
  const lines = ["# Anchor Context", ""];

  if (warnings.length > 0) {
    lines.push("## Warnings", "");
    for (const warning of warnings) lines.push(`- ${warning}`);
    lines.push("");
  }

  if (teamRules.length > 0) {
    lines.push("## Team-approved rules", "");
    teamRules.forEach((rule, index) => {
      const evidence = rule.evidence[0];
      const evidenceText = evidence
        ? `PR #${evidence.prNumber}, ${evidence.sourceType}${evidence.filePath ? `, ${evidence.filePath}` : ""}`
        : "No evidence";
      lines.push(`${index + 1}. [${rule.category}] ${clipSentence(rule.sanitizedText)}`);
      lines.push(`   Evidence: ${evidenceText}`);
      lines.push(`   Confidence: ${confidenceLine(rule)}`);
      lines.push(`   Current code check: ${currentCodeCheckLine(rule)}`);
      if (evidence?.prUrl) lines.push(`   Link: ${evidence.prUrl}`);
      lines.push("");
    });
  }

  lines.push("## Must know", "");
  if (units.length === 0) {
    lines.push(
      input.strict
        ? "No reliable historical evidence found."
        : "No directly relevant indexed PR history found.",
      "",
    );
  } else {
    units.forEach((unit, index) => {
      const statement =
        unit.confidenceLevel === "weak"
          ? `Historical evidence suggests ${clipSentence(unit.sanitizedText)}`
          : clipSentence(unit.sanitizedText);
      lines.push(`${index + 1}. [${unit.category}] ${statement}`);
      lines.push(`   Evidence: ${evidenceLine(unit)}`);
      lines.push(`   Confidence: ${confidenceLine(unit)}`);
      lines.push(`   Current code check: ${currentCodeCheckLine(unit)}`);
      lines.push(`   Why it matters: ${whyItMatters(unit, input)}`);
      lines.push(`   Link: ${unit.prUrl}`);
      lines.push("");
    });
  }

  lines.push("## Codebase Evidence", "");
  if (codeChunks.length === 0) {
    lines.push("No directly relevant indexed codebase context found.", "");
  } else {
    codeChunks.forEach((chunk, index) => {
      const symbols = chunk.symbols.length
        ? `; symbols: ${chunk.symbols.slice(0, 6).join(", ")}`
        : "";
      lines.push(`${index + 1}. ${chunk.filePath}:${chunk.startLine}-${chunk.endLine}${symbols}`);
      lines.push(`   Why it matters: Current code near this match may affect the requested edit.`);
      lines.push(`   Snippet: ${clipSentence(chunk.sanitizedText, 260)}`);
      lines.push("");
    });
  }

  lines.push("## Architecture Guidance", "");
  if (architecturePatterns.length === 0) {
    lines.push("No directly relevant architecture patterns found in the local index.", "");
  } else {
    architecturePatterns.forEach((pattern, index) => {
      lines.push(`${index + 1}. [${pattern.area}] ${clipSentence(pattern.sanitizedSummary, 240)}`);
      lines.push(`   Evidence: ${pattern.sourceFiles.slice(0, 5).join(", ") || "indexed code"}`);
      lines.push(`   Confidence: ${pattern.confidence.toFixed(2)}`);
      lines.push(
        `   Why it matters: Follow this current-code pattern unless stronger PR or team-rule evidence says otherwise.`,
      );
      lines.push("");
    });
  }

  lines.push("## Relevant tests", "");
  if (relevantTests.length === 0) {
    lines.push("No directly related tests found in the local index.", "");
  } else {
    relevantTests.forEach((test, index) => {
      const symbolText = test.matchedSymbols.length
        ? `; symbols: ${test.matchedSymbols.slice(0, 6).join(", ")}`
        : "";
      lines.push(`${index + 1}. ${test.path}${symbolText}`);
      lines.push(`   Why it matters: ${test.reason} (${test.strength.toFixed(2)} link strength).`);
      if (test.sourcePath) lines.push(`   Source: ${test.sourcePath}`);
      lines.push("");
    });
  }

  lines.push("## Regression memory", "");
  if (regressionEvents.length === 0) {
    lines.push("No related regression events found in the local index.", "");
  } else {
    regressionEvents.forEach((event, index) => {
      lines.push(`${index + 1}. ${clipSentence(event.summary, 220)}`);
      lines.push(`   Evidence: PR #${event.prNumber}, signals: ${event.signals.join(", ")}`);
      lines.push(`   Files: ${event.filePaths.slice(0, 5).join(", ") || "n/a"}`);
      if (event.testPaths.length > 0) {
        lines.push(`   Tests: ${event.testPaths.slice(0, 5).join(", ")}`);
      }
      lines.push(`   Link: ${event.prUrl}`);
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
        confidenceLevel: unit.confidenceLevel,
        confidenceReasons: unit.confidenceReasons,
        freshnessStatus: unit.freshnessStatus,
        freshnessReason: unit.freshnessReason,
        evidence: unit.evidence,
        claimKey: unit.claimKey,
        repeatedEvidenceCount: unit.repeatedEvidenceCount,
        category: unit.category,
        sanitizedSnippet: clipSentence(unit.sanitizedText, 260),
        prNumber: unit.prNumber,
        prUrl: unit.prUrl,
        sourceType: unit.sourceType,
        filePaths: unit.filePaths,
        symbols: unit.symbols,
        duplicateCount: unit.duplicateCount,
        matchReasons: unit.matchReasons,
        rankSignals: unit.rankSignals,
      })),
      teamRules: teamRules.map((rule) => ({
        id: rule.id,
        score: rule.score,
        confidenceLevel: rule.confidenceLevel,
        confidenceReasons: rule.confidenceReasons,
        freshnessStatus: rule.freshnessStatus,
        freshnessReason: rule.freshnessReason,
        category: rule.category,
        sanitizedSnippet: clipSentence(rule.sanitizedText, 260),
        filePaths: rule.filePaths,
        symbols: rule.symbols,
        evidence: rule.evidence,
        matchReasons: rule.matchReasons,
        rankSignals: rule.rankSignals,
      })),
      codeEvidence: codeChunks.map((chunk) => ({
        id: chunk.id,
        score: chunk.score,
        filePath: chunk.filePath,
        language: chunk.language,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        symbols: chunk.symbols,
        sanitizedSnippet: clipSentence(chunk.sanitizedText, 260),
        matchReasons: chunk.matchReasons,
        rankSignals: chunk.rankSignals,
      })),
      architecturePatterns: architecturePatterns.map((pattern) => ({
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
      relevantTests: relevantTests.map((test) => ({
        path: test.path,
        sourcePath: test.sourcePath,
        reason: test.reason,
        strength: test.strength,
        score: test.score,
        matchedSymbols: test.matchedSymbols,
      })),
      regressionEvents: regressionEvents.map((event) => ({
        id: event.id,
        score: event.score,
        prNumber: event.prNumber,
        prUrl: event.prUrl,
        filePaths: event.filePaths,
        symbols: event.symbols,
        testPaths: event.testPaths,
        summary: clipSentence(event.summary, 260),
        matchReasons: event.matchReasons,
        rankSignals: event.rankSignals,
      })),
      queryTerms: buildQueryTerms(input),
      ...extraMetadata,
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
        matchReasons: unit.matchReasons,
        rankSignals: unit.rankSignals,
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
    `- Code files: ${status.codeFileCount}`,
    `- Code chunks: ${status.codeChunkCount}`,
    `- Test files: ${status.testFileCount}`,
    `- Test links: ${status.testLinkCount}`,
    `- Regression events: ${status.regressionEventCount}`,
    `- Architecture components: ${status.architectureComponentCount}`,
    `- Architecture patterns: ${status.architecturePatternCount}`,
    `- Architecture imports: ${status.architectureImportCount}`,
    `- Anchor coverage: ${status.coverageScore}% (${status.coverageGrade})`,
    `- History coverage: ${status.historyCoverage ?? "unknown"}`,
    `- History limit: ${status.historyLimit ?? "n/a"}`,
    `- Stale evidence: ${status.staleEvidenceCount}`,
    `- Team rules: ${status.teamRuleCount}`,
    `- Last sync: ${status.lastSyncTime ?? "never"}`,
    `- Last code index: ${status.lastCodeIndexTime ?? "never"}`,
    `- Last architecture index: ${status.lastArchitectureIndexTime ?? "never"}`,
    `- Last rule index: ${status.lastRuleIndexTime ?? "never"}`,
    `- Last successful index run: ${status.lastSuccessfulRun ?? "never"}`,
    `- Last failed index run: ${status.lastFailedRun ?? "never"}`,
    `- Stale code index: ${status.staleCodeIndex ? "yes" : "no"}`,
    `- Suggested next command: ${status.suggestedNextCommand ?? "n/a"}`,
    `- GitHub token configured: ${status.githubTokenConfigured ? "yes" : "no"}`,
    `- Health: ${status.health}`,
  ];
  if (status.coverageReasons.length > 0) {
    lines.push("", "Coverage reasons:");
    for (const reason of status.coverageReasons.slice(0, 8)) lines.push(`- ${reason}`);
  }
  if (status.suggestedPrompts.length > 0) {
    lines.push("", "Suggested prompts:");
    for (const prompt of status.suggestedPrompts.slice(0, 4)) lines.push(`- ${prompt}`);
  }
  return { markdown: lines.join("\n"), metadata: status as unknown as Record<string, unknown> };
}
