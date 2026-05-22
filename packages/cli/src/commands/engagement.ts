import {
  getIndexStatus,
  getSuggestedPrompts,
  getWisdomCategoryCounts,
  type AnchorDatabase,
  type CodeIndexSummary,
  type IndexSummary,
} from "@pratik7368patil/anchor-core";

export function printIndexOutcome(
  cwd: string,
  db: AnchorDatabase,
  summaries: {
    history?: IndexSummary;
    code?: CodeIndexSummary;
  } = {},
): void {
  const categories = getWisdomCategoryCounts(db);
  const status = getIndexStatus(cwd, false);
  const prompts = getSuggestedPrompts();
  console.log("");
  console.log("Anchor outcome:");
  console.log(`Architecture decisions: ${categories.architecture_decision ?? 0}`);
  console.log(`Constraints: ${categories.constraint ?? 0}`);
  console.log(`API contracts: ${categories.api_contract ?? 0}`);
  console.log(`Security notes: ${categories.security_note ?? 0}`);
  console.log(`Regressions: ${status.regressionEventCount}`);
  console.log(`Tests linked: ${status.testLinkCount}`);
  console.log(`Team rules: ${status.teamRuleCount}`);
  console.log(`Anchor coverage: ${status.coverageScore}% (${status.coverageGrade})`);
  if (summaries.history || summaries.code) {
    console.log(`Recommended next prompt: ${prompts[1]?.prompt ?? prompts[0]?.prompt ?? "n/a"}`);
  }
}
