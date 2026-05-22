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

export function buildAnchorContextResult(
  db: AnchorDatabase,
  cwd: string,
  input: AnchorContextInput,
  warnings: string[] = [],
): FormattedResult {
  const history = rankWisdomUnits(db, input);
  const code = rankCodeChunks(db, input);
  const rules = rankTeamRules(db, cwd, input);
  const tests = rankRelevantTests(db, input);
  const regressions = rankRegressionEvents(db, input);
  const architecture = rankArchitecturePatterns(db, input);
  const indexStatus = getIndexStatus(cwd);
  const semanticStatus = getSemanticStatus();
  const strictWarnings =
    input.strict && indexStatus.historyCoverage !== "all"
      ? [
          `Strict mode is using ${indexStatus.historyCoverage ?? "unknown"} PR history coverage; run anchor index-all for broader evidence.`,
        ]
      : [];

  return formatAnchorContext(
    history,
    input,
    code,
    rules,
    [...warnings, ...strictWarnings],
    tests,
    regressions,
    architecture,
    {
      indexHealth: {
        historyCoverage: indexStatus.historyCoverage ?? "unknown",
        staleCodeIndex: Boolean(indexStatus.staleCodeIndex),
        lastSuccessfulRun: indexStatus.lastSuccessfulRun,
        lastFailedRun: indexStatus.lastFailedRun,
        architecturePatternCount: indexStatus.architecturePatternCount,
      },
      semanticStatus,
    },
  );
}
