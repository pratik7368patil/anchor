import type { AnchorContextInput } from "../types.js";
import type { AnchorDatabase } from "../db/database.js";
import { getIndexStatus } from "../db/database.js";
import { rankTeamRules } from "../rules/team-rules.js";
import { formatAnchorContext, type FormattedResult } from "./formatter.js";
import { rankCodeChunks } from "./code-ranker.js";
import { rankRegressionEvents } from "./regression-ranker.js";
import { rankRelevantTests } from "./test-ranker.js";
import { rankWisdomUnits } from "./ranker.js";
import { getSemanticStatus } from "./semantic.js";
import { rankArchitecturePatterns } from "./architecture-ranker.js";
import { clampMaxResults } from "./query-builder.js";
import { evaluateReliabilityGate } from "./reliability-gate.js";
import { detectTestCommands } from "./test-commands.js";

export function buildAnchorContextResult(
  db: AnchorDatabase,
  cwd: string,
  input: AnchorContextInput,
  warnings: string[] = [],
): FormattedResult {
  const visibleLimit = clampMaxResults(input.maxResults, 8);
  const history = rankWisdomUnits(db, {
    ...input,
    maxResults: Math.min(12, visibleLimit + 4),
  });
  const code = rankCodeChunks(db, input);
  const rules = rankTeamRules(db, cwd, input);
  const tests = rankRelevantTests(db, input);
  const testCommands = detectTestCommands(db, cwd, input.files ?? []);
  const regressions = rankRegressionEvents(db, input);
  const architecture = rankArchitecturePatterns(db, input);
  const reliability = evaluateReliabilityGate(input, history, rules, code, architecture);
  const visibleHistory = (input.strict ? reliability.acceptedHistory : history).slice(
    0,
    visibleLimit,
  );
  const visibleRules = (input.strict ? reliability.acceptedTeamRules : rules).slice(
    0,
    visibleLimit,
  );
  const indexStatus = getIndexStatus(cwd);
  const semanticStatus = getSemanticStatus();
  const strictWarnings =
    input.strict && indexStatus.historyCoverage !== "all"
      ? [
          `Strict mode is using ${indexStatus.historyCoverage ?? "unknown"} PR history coverage; run anchor index-all for broader evidence.`,
        ]
      : [];

  return formatAnchorContext(
    visibleHistory,
    input,
    code,
    visibleRules,
    [...warnings, ...strictWarnings, ...reliability.gate.warnings],
    tests,
    regressions,
    architecture,
    {
      reliabilityGate: reliability.gate,
      rejectedHistory: reliability.rejectedHistory,
      indexHealth: {
        historyCoverage: indexStatus.historyCoverage ?? "unknown",
        staleCodeIndex: Boolean(indexStatus.staleCodeIndex),
        lastSuccessfulRun: indexStatus.lastSuccessfulRun,
        lastFailedRun: indexStatus.lastFailedRun,
        architecturePatternCount: indexStatus.architecturePatternCount,
      },
      semanticStatus,
    },
    testCommands,
  );
}
