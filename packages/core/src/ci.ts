import fs from "node:fs";
import path from "node:path";
import type { AnchorDatabase } from "./db/database.js";
import { getIndexStatus, initializeSchema } from "./db/database.js";
import { validateTeamRulesFile, checkTeamRuleEvidence } from "./rules/team-rules.js";
import { runRetrievalEvals, ANCHOR_EVALS_FILE } from "./evals/retrieval-evals.js";
import type { FormattedResult } from "./retrieval/formatter.js";

export type AnchorCiInput = {
  strict?: boolean;
  minCoverage?: number;
};

export function runAnchorCi(
  db: AnchorDatabase,
  cwd: string,
  input: AnchorCiInput = {},
): FormattedResult {
  initializeSchema(db);
  const status = getIndexStatus(cwd, false);
  const minCoverage = input.minCoverage ?? 70;
  const rules = validateTeamRulesFile(cwd);
  const evidence = rules.ok ? checkTeamRuleEvidence(cwd) : undefined;
  const evalsPath = path.join(cwd, ANCHOR_EVALS_FILE);
  const evals = fs.existsSync(evalsPath) ? runRetrievalEvals(db, cwd) : undefined;
  const checks = [
    {
      name: "coverage",
      ok: status.coverageScore >= minCoverage,
      message: `Anchor coverage ${status.coverageScore}% >= ${minCoverage}%`,
    },
    {
      name: "rules",
      ok: rules.ok,
      message: rules.ok ? "Team rules are valid." : rules.errors.join("; "),
    },
    {
      name: "rule evidence",
      ok: evidence ? evidence.ok : rules.ok,
      message: evidence
        ? evidence.ok
          ? "Team-rule evidence exists in the local index."
          : `Missing team-rule evidence: ${evidence.missing.map((item) => `${item.ruleId}/PR #${item.prNumber}`).join(", ")}`
        : "Skipped because rules are invalid or missing.",
    },
    {
      name: "evals",
      ok: evals ? evals.ok : true,
      message: evals
        ? `${evals.passed}/${evals.total} retrieval eval(s) passed.`
        : "No retrieval eval file found; run anchor eval init to add gates.",
    },
    {
      name: "stale code",
      ok: !status.staleCodeIndex || !input.strict,
      message: status.staleCodeIndex
        ? "Code index is stale; run anchor index-code."
        : "Code index is fresh enough.",
    },
  ];
  const ok = checks.every((check) => check.ok);
  const lines = ["# Anchor CI", "", ok ? "Status: passed" : "Status: failed", ""];
  for (const check of checks) {
    lines.push(`- ${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.message}`);
  }
  if (!ok) lines.push("", "Suggested next command: anchor health");
  return {
    markdown: lines.join("\n"),
    metadata: {
      ok,
      checks,
      indexStatus: status,
      evals,
    },
  };
}
