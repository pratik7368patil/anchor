import { getAnchorIndexHealth } from "@pratik7368patil/anchor-core";

export type HealthOptions = {
  json?: boolean;
};

export function runHealth(cwd: string) {
  return getAnchorIndexHealth(cwd);
}

export function printHealth(
  result: ReturnType<typeof runHealth>,
  options: HealthOptions = {},
): void {
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("# Anchor Health");
  console.log("");
  console.log(`Status: ${result.status}`);
  console.log(`Anchor coverage: ${result.coverageScore}% (${result.coverageGrade})`);
  console.log(`History coverage: ${result.historyCoverage}`);
  console.log(`Stale code index: ${result.staleCodeIndex ? "yes" : "no"}`);
  console.log(`Last successful run: ${result.lastSuccessfulRun ?? "never"}`);
  console.log(`Last failed run: ${result.lastFailedRun ?? "never"}`);
  console.log(`Suggested next command: ${result.suggestedNextCommand ?? "n/a"}`);
  if (result.warnings.length > 0) {
    console.log("");
    console.log("Warnings:");
    for (const warning of result.warnings) console.log(`- ${warning}`);
  }
  if (result.coverageReasons.length > 0) {
    console.log("");
    console.log("Coverage reasons:");
    for (const reason of result.coverageReasons.slice(0, 8)) console.log(`- ${reason}`);
  }
  if (result.suggestedPrompts.length > 0) {
    console.log("");
    console.log("Suggested prompts:");
    for (const prompt of result.suggestedPrompts.slice(0, 4)) console.log(`- ${prompt}`);
  }
}
