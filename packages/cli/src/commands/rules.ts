import {
  ensureTeamRulesFile,
  loadTeamRulesFile,
  validateTeamRulesFile,
  type RulesInitResult,
  type TeamRule,
  type TeamRulesValidationResult,
} from "@pratik7368patil/anchor-core";

export function runRulesInit(cwd: string): RulesInitResult {
  return ensureTeamRulesFile(cwd);
}

export function runRulesValidate(cwd: string): TeamRulesValidationResult {
  return validateTeamRulesFile(cwd);
}

export function runRulesList(cwd: string): { path: string; rules: TeamRule[]; errors: string[] } {
  const loaded = loadTeamRulesFile(cwd);
  return { path: loaded.path, rules: loaded.rules, errors: loaded.errors };
}

export function printRulesInit(result: RulesInitResult): void {
  console.log(
    result.created ? "Created Anchor team rules file." : "Anchor team rules file exists.",
  );
  console.log(`Path: ${result.path}`);
}

export function printRulesValidation(result: TeamRulesValidationResult): void {
  if (result.ok) {
    console.log("Anchor team rules are valid.");
    console.log(`Rules: ${result.rules.length}`);
    console.log(`Path: ${result.path}`);
    return;
  }

  console.error("Anchor team rules are invalid.");
  for (const error of result.errors) console.error(`- ${error}`);
  console.error(`Path: ${result.path}`);
}

export function printRulesList(result: {
  path: string;
  rules: TeamRule[];
  errors: string[];
}): void {
  if (result.errors.length > 0) {
    console.error("Could not list Anchor team rules.");
    for (const error of result.errors) console.error(`- ${error}`);
    return;
  }

  console.log(`Anchor team rules (${result.rules.length})`);
  console.log(`Path: ${result.path}`);
  for (const rule of result.rules) {
    const evidence = rule.evidence[0];
    console.log(
      `- ${rule.id} [${rule.category}] ${rule.sanitizedText} (evidence: PR #${evidence?.prNumber ?? "n/a"})`,
    );
  }
}
