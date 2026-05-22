import type { AnchorIndexHealth, IndexStatus } from "./types.js";
import { getIndexStatus } from "./db/database.js";
import { validateTeamRulesFile } from "./rules/team-rules.js";

export function evaluateIndexHealth(status: IndexStatus, rulesOk: boolean): AnchorIndexHealth {
  const warnings: string[] = [];
  if (status.health === "missing_database") warnings.push("Anchor database is missing.");
  if (status.health === "schema_invalid") warnings.push("Anchor SQLite schema is invalid.");
  if (status.health === "empty_index") warnings.push("Anchor index is empty.");
  if (status.historyCoverage !== "all") warnings.push("PR history coverage is partial.");
  if (status.staleCodeIndex) warnings.push("Code index is older than 7 days or has never run.");
  if (!rulesOk) warnings.push("Team rules file is missing or invalid.");
  if (status.lastFailedRun) warnings.push(`Last failed index run: ${status.lastFailedRun}.`);

  const hasError = status.health === "missing_database" || status.health === "schema_invalid";
  const healthStatus = hasError ? "error" : warnings.length > 0 ? "warning" : "ok";
  return {
    status: healthStatus,
    warnings,
    suggestedNextCommand: status.suggestedNextCommand,
    historyCoverage: status.historyCoverage ?? "unknown",
    staleCodeIndex: Boolean(status.staleCodeIndex),
    lastSuccessfulRun: status.lastSuccessfulRun,
    lastFailedRun: status.lastFailedRun,
    coverageScore: status.coverageScore,
    coverageGrade: status.coverageGrade,
    coverageReasons: status.coverageReasons,
    suggestedPrompts: status.suggestedPrompts,
  };
}

export function getAnchorIndexHealth(
  cwd: string,
): AnchorIndexHealth & { indexStatus: IndexStatus } {
  const indexStatus = getIndexStatus(cwd);
  const rulesValidation = validateTeamRulesFile(cwd);
  return {
    ...evaluateIndexHealth(indexStatus, rulesValidation.ok),
    indexStatus,
  };
}
