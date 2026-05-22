import type { CoverageGrade, IndexStatus } from "../types.js";
import { getSuggestedPromptTexts } from "./prompts.js";

export type CoverageInput = Pick<
  IndexStatus,
  | "prCount"
  | "wisdomUnitCount"
  | "codeFileCount"
  | "codeChunkCount"
  | "testLinkCount"
  | "regressionEventCount"
  | "architecturePatternCount"
  | "teamRuleCount"
  | "historyCoverage"
  | "staleEvidenceCount"
  | "staleCodeIndex"
>;

export type CoverageReport = {
  coverageScore: number;
  coverageGrade: CoverageGrade;
  coverageReasons: string[];
  suggestedPrompts: string[];
};

function gradeFor(score: number): CoverageGrade {
  if (score === 0) return "empty";
  if (score < 40) return "poor";
  if (score < 60) return "fair";
  if (score < 80) return "good";
  return "excellent";
}

export function calculateCoverage(input: CoverageInput): CoverageReport {
  const reasons: string[] = [];
  let score = 0;

  if (input.wisdomUnitCount > 0) {
    score += 20;
    reasons.push(`${input.wisdomUnitCount} PR-history wisdom units indexed.`);
  } else {
    reasons.push("No PR-history wisdom indexed yet.");
  }

  if (input.historyCoverage === "all") {
    score += 30;
    reasons.push("All merged PR history is indexed.");
  } else if (input.prCount >= 200) {
    score += 25;
    reasons.push("Default PR history window is indexed.");
  } else if (input.prCount > 0) {
    score += 15;
    reasons.push(`${input.prCount} merged PRs indexed; history coverage is partial.`);
  } else {
    reasons.push("No merged PRs indexed yet.");
  }

  if (input.codeChunkCount > 0) {
    score += 20;
    reasons.push(`${input.codeChunkCount} current-code chunks indexed.`);
  } else {
    reasons.push("No current code chunks indexed yet.");
  }

  if (input.codeChunkCount > 0 && !input.staleCodeIndex) {
    score += 10;
    reasons.push("Code index is fresh.");
  } else if (input.codeFileCount > 0) {
    reasons.push("Code index may be stale.");
  }

  if (input.testLinkCount > 0) {
    score += 10;
    reasons.push(`${input.testLinkCount} source-to-test links inferred.`);
  } else {
    reasons.push("No source-to-test links inferred yet.");
  }

  if (input.regressionEventCount > 0) {
    score += 10;
    reasons.push(`${input.regressionEventCount} regression events indexed.`);
  } else {
    reasons.push("No regression memory indexed yet.");
  }

  if (input.architecturePatternCount > 0) {
    score += 10;
    reasons.push(`${input.architecturePatternCount} architecture patterns indexed.`);
  } else {
    reasons.push("No architecture patterns indexed yet.");
  }

  if (input.teamRuleCount > 0) {
    score += 5;
    reasons.push(`${input.teamRuleCount} team-approved rules available.`);
  } else {
    reasons.push("No team-approved rules found.");
  }

  if (input.staleEvidenceCount > 0) {
    score -= 10;
    reasons.push(`${input.staleEvidenceCount} historical evidence items look stale.`);
  }

  const clampedScore = Math.max(0, Math.min(100, score));
  return {
    coverageScore: clampedScore,
    coverageGrade: gradeFor(clampedScore),
    coverageReasons: reasons,
    suggestedPrompts: getSuggestedPromptTexts(),
  };
}
