import type {
  AnchorContextInput,
  ConfidenceLevel,
  RankedArchitecturePattern,
  RankedCodeChunk,
  RankedTeamRule,
  RankedWisdomUnit,
  ReliabilityGate,
  ReliabilityGateRejection,
} from "../types.js";
import { clipSentence } from "../utils/text.js";
import { confidenceAtLeast } from "./evidence.js";

export type ReliabilityGateResult = {
  gate: ReliabilityGate;
  acceptedHistory: RankedWisdomUnit[];
  rejectedHistory: ReliabilityGateRejection[];
  acceptedTeamRules: RankedTeamRule[];
};

function reliabilityThreshold(input: AnchorContextInput): ConfidenceLevel {
  if (input.minConfidence) return input.minConfidence;
  return input.strict ? "strong" : "weak";
}

function hasTarget(input: AnchorContextInput): boolean {
  return Boolean(input.files?.length || input.symbols?.length);
}

function isPriorityEvidence(unit: RankedWisdomUnit): boolean {
  return (
    unit.category === "security_note" ||
    unit.category === "bug_regression" ||
    unit.category === "api_contract" ||
    unit.category === "architecture_decision" ||
    unit.category === "constraint"
  );
}

function historyRejectionReasons(
  unit: RankedWisdomUnit,
  input: AnchorContextInput,
  minConfidence: ConfidenceLevel,
): string[] {
  const reasons: string[] = [];
  if (unit.freshnessStatus === "stale") {
    reasons.push("stale against the current code index");
  }
  if (!confidenceAtLeast(unit.confidenceLevel, minConfidence)) {
    reasons.push(`below ${minConfidence} confidence`);
  }

  const directTargetMatch =
    unit.scoreParts.filePathMatch >= 0.45 || unit.scoreParts.symbolMatch >= 0.45;
  const repeatedSupport = unit.repeatedEvidenceCount > 1 && unit.scoreParts.textMatch >= 0.35;
  const strongTextOnly =
    !hasTarget(input) && isPriorityEvidence(unit) && unit.scoreParts.textMatch >= 0.6;

  if (!directTargetMatch && !repeatedSupport && !strongTextOnly) {
    reasons.push(
      hasTarget(input)
        ? "no direct file, symbol, or repeated-evidence match for the requested target"
        : "only a weak text match and no repeated evidence",
    );
  }

  return reasons;
}

function isReliableTeamRule(
  rule: RankedTeamRule,
  input: AnchorContextInput,
  minConfidence: ConfidenceLevel,
): boolean {
  const filePathMatch = rule.rankSignals.filePathMatch ?? 0;
  const symbolMatch = rule.rankSignals.symbolMatch ?? 0;
  const textMatch = rule.rankSignals.textMatch ?? 0;
  if (rule.freshnessStatus === "stale") return false;
  if (!confidenceAtLeast(rule.confidenceLevel, minConfidence)) return false;
  if (!hasTarget(input)) return textMatch >= 0.25 || rule.evidence.length > 0;
  return filePathMatch >= 0.45 || symbolMatch >= 0.45 || textMatch >= 0.45;
}

function strongCodeSignal(chunks: RankedCodeChunk[]): number {
  return chunks.filter(
    (chunk) => chunk.scoreParts.filePathMatch >= 0.9 || chunk.scoreParts.symbolMatch >= 0.9,
  ).length;
}

function strongArchitectureSignal(patterns: RankedArchitecturePattern[]): number {
  return patterns.filter(
    (pattern) =>
      (pattern.rankSignals.filePath ?? 0) >= 0.9 || (pattern.rankSignals.symbol ?? 0) >= 0.9,
  ).length;
}

function rejectionFor(unit: RankedWisdomUnit, reasons: string[]): ReliabilityGateRejection {
  return {
    id: unit.id,
    prNumber: unit.prNumber,
    category: unit.category,
    confidenceLevel: unit.confidenceLevel,
    freshnessStatus: unit.freshnessStatus,
    reasons,
    rankSignals: unit.rankSignals,
  };
}

export function evaluateReliabilityGate(
  input: AnchorContextInput,
  history: RankedWisdomUnit[],
  teamRules: RankedTeamRule[] = [],
  codeChunks: RankedCodeChunk[] = [],
  architecturePatterns: RankedArchitecturePattern[] = [],
): ReliabilityGateResult {
  const minConfidence = reliabilityThreshold(input);
  const acceptedHistory: RankedWisdomUnit[] = [];
  const rejectedHistory: ReliabilityGateRejection[] = [];

  for (const unit of history) {
    const reasons = historyRejectionReasons(unit, input, minConfidence);
    if (reasons.length === 0) acceptedHistory.push(unit);
    else rejectedHistory.push(rejectionFor(unit, reasons));
  }

  const acceptedTeamRules = teamRules.filter((rule) =>
    isReliableTeamRule(rule, input, minConfidence),
  );
  const currentCodeSignals = strongCodeSignal(codeChunks);
  const architectureSignals = strongArchitectureSignal(architecturePatterns);
  const reliableEvidenceCount = acceptedHistory.length + acceptedTeamRules.length;
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (acceptedTeamRules.length > 0) {
    reasons.push(`${acceptedTeamRules.length} matching team-approved rule(s) passed the gate`);
  }
  if (acceptedHistory.length > 0) {
    reasons.push(
      `${acceptedHistory.length} historical item(s) passed freshness, confidence, and target relevance checks`,
    );
  }
  if (currentCodeSignals > 0) {
    reasons.push(`${currentCodeSignals} exact current-code signal(s) matched the target`);
  }
  if (architectureSignals > 0) {
    reasons.push(`${architectureSignals} exact architecture signal(s) matched the target`);
  }
  if (!hasTarget(input)) {
    warnings.push(
      "No target files or symbols were provided, so historical relevance relies on text and repeated evidence.",
    );
  }
  if (rejectedHistory.length > 0) {
    const example = rejectedHistory[0];
    const exampleText = example
      ? ` Example rejected item: PR #${example.prNumber} (${example.reasons.join(", ")}).`
      : "";
    warnings.push(
      `${input.strict ? "Strict reliability gate filtered" : "Reliability gate flagged"} ${
        rejectedHistory.length
      } weak, stale, or loosely matched historical item(s).${exampleText}`,
    );
  }

  let status: ReliabilityGate["status"] = "failed";
  if (reliableEvidenceCount > 0) {
    status = "passed";
  } else if (
    history.length > 0 ||
    teamRules.length > 0 ||
    currentCodeSignals > 0 ||
    architectureSignals > 0
  ) {
    status = "weak";
  }
  if (input.strict && reliableEvidenceCount === 0) {
    status = "failed";
    warnings.push(
      "Strict reliability gate found no reliable PR or team-rule evidence; inspect current code and tests directly.",
    );
  }
  if (status === "weak" && !input.strict) {
    warnings.push(
      "Only weak historical signals matched; treat them as leads to verify, not as implementation guidance.",
    );
  }

  if (reasons.length === 0) {
    reasons.push(
      status === "failed"
        ? "No PR or team-rule evidence passed the reliability gate"
        : "Only current-code or architecture signals were available",
    );
  }

  return {
    gate: {
      status,
      strict: Boolean(input.strict),
      minConfidence,
      acceptedHistoryCount: acceptedHistory.length,
      rejectedHistoryCount: rejectedHistory.length,
      acceptedTeamRuleCount: acceptedTeamRules.length,
      strongCurrentCodeSignals: currentCodeSignals,
      strongArchitectureSignals: architectureSignals,
      reasons: reasons.map((reason) => clipSentence(reason, 220)),
      warnings: warnings.map((warning) => clipSentence(warning, 260)),
    },
    acceptedHistory,
    rejectedHistory,
    acceptedTeamRules,
  };
}
