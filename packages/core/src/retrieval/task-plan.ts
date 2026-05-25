import type { AnchorDatabase } from "../db/database.js";
import type { AnchorContextInput, EvidenceRef, TaskPlan, TestCommand } from "../types.js";
import { clipSentence, uniqueStrings } from "../utils/text.js";
import { buildAnchorContextResult } from "./context.js";
import type { FormattedResult } from "./formatter.js";

type MetadataEvidenceItem = {
  evidence?: EvidenceRef;
  category?: string;
  filePaths?: string[];
  symbols?: string[];
  sanitizedSnippet?: string;
  prNumber?: number;
  prUrl?: string;
};

type MetadataCodeItem = {
  filePath?: string;
  symbols?: string[];
};

type MetadataTestCommand = TestCommand;

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function evidenceFromMetadata(metadata: Record<string, unknown>): EvidenceRef[] {
  const items = [
    ...asArray<MetadataEvidenceItem>(metadata.items),
    ...asArray<MetadataEvidenceItem>(metadata.teamRules),
  ];
  return items
    .map((item) => item.evidence)
    .filter((item): item is EvidenceRef => Boolean(item?.prNumber && item.prUrl));
}

function planRisks(metadata: Record<string, unknown>): string[] {
  const risks = new Set<string>();
  for (const item of asArray<MetadataEvidenceItem>(metadata.items)) {
    if (item.category === "security_note") risks.add("Security-sensitive behavior has historical evidence; preserve redaction and access boundaries.");
    if (item.category === "bug_regression") risks.add("This area has regression memory; verify the cited failure mode before editing.");
    if (item.category === "api_contract") risks.add("API compatibility or contract behavior may be relied on by callers.");
    if (item.category === "constraint") risks.add("A previous constraint may still apply; check current code before removing it.");
  }
  if (risks.size === 0) risks.add("No specific historical risks were found; rely on current code and nearby tests.");
  return [...risks].slice(0, 5);
}

function implementationSteps(input: AnchorContextInput, metadata: Record<string, unknown>): string[] {
  const codeFiles = asArray<MetadataCodeItem>(metadata.codeEvidence)
    .map((item) => item.filePath)
    .filter((item): item is string => Boolean(item));
  const files = uniqueStrings([...(input.files ?? []), ...codeFiles]).slice(0, 6);
  const steps = [
    "Read the highest-ranked codebase evidence and architecture guidance before editing.",
    files.length > 0
      ? `Make the smallest change in ${files.slice(0, 3).join(", ")} first.`
      : "Identify the smallest target file from current-code evidence before editing.",
    "Preserve any cited team rules, API contracts, security notes, and regression constraints.",
    "Update or add the nearest related tests before broad refactors.",
  ];
  if (input.strict) steps.push("Because strict mode is enabled, ignore stale or weak historical evidence.");
  return steps;
}

export function planTask(
  db: AnchorDatabase,
  cwd: string,
  input: AnchorContextInput,
): FormattedResult {
  const context = buildAnchorContextResult(db, cwd, input);
  const codeFiles = asArray<MetadataCodeItem>(context.metadata.codeEvidence)
    .map((item) => item.filePath)
    .filter((item): item is string => Boolean(item));
  const codeSymbols = asArray<MetadataCodeItem>(context.metadata.codeEvidence).flatMap(
    (item) => item.symbols ?? [],
  );
  const targetFiles = uniqueStrings([...(input.files ?? []), ...codeFiles]).slice(0, 10);
  const likelySymbols = uniqueStrings([...(input.symbols ?? []), ...codeSymbols]).slice(0, 12);
  const testCommands = asArray<MetadataTestCommand>(context.metadata.testCommands);
  const plan: TaskPlan = {
    targetFiles,
    likelySymbols,
    implementationSteps: implementationSteps(input, context.metadata),
    risks: planRisks(context.metadata),
    recommendedTests: testCommands.map((command) => command.command).slice(0, 8),
    evidence: evidenceFromMetadata(context.metadata).slice(0, 12),
    testCommands,
  };

  const lines = ["# Anchor Task Plan", "", `Task: ${clipSentence(input.task, 260)}`, ""];
  lines.push("## Target files", "");
  if (plan.targetFiles.length === 0) lines.push("- No target files inferred from the local index.");
  else for (const file of plan.targetFiles) lines.push(`- ${file}`);
  lines.push("", "## Likely symbols", "");
  if (plan.likelySymbols.length === 0) lines.push("- No symbols inferred.");
  else for (const symbol of plan.likelySymbols) lines.push(`- ${symbol}`);
  lines.push("", "## Implementation steps", "");
  for (const step of plan.implementationSteps) lines.push(`- ${step}`);
  lines.push("", "## Risks", "");
  for (const risk of plan.risks) lines.push(`- ${risk}`);
  lines.push("", "## Exact checks", "");
  if (plan.testCommands.length === 0) lines.push("- No exact test command inferred.");
  else {
    for (const command of plan.testCommands.slice(0, 6)) {
      lines.push(`- \`${command.command}\` - ${command.reason} (${command.confidence})`);
    }
  }
  lines.push("", "## Evidence", "");
  if (plan.evidence.length === 0) lines.push("- No PR/rule evidence found; plan is based on current-code inference.");
  else {
    for (const evidence of plan.evidence.slice(0, 6)) {
      lines.push(`- PR #${evidence.prNumber}, ${evidence.sourceType}: ${evidence.prUrl}`);
    }
  }

  return {
    markdown: lines.join("\n"),
    metadata: {
      ...context.metadata,
      taskPlan: plan,
    },
  };
}
