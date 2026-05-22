import {
  addTeamRule,
  checkTeamRuleEvidence,
  defaultDatabasePath,
  detectGitRoot,
  ensureTeamRulesFile,
  loadTeamRulesFile,
  openAnchorDatabase,
  suggestTeamRules,
  validateTeamRulesFile,
  type RulesAddInput,
  type RulesAddResult,
  type RulesEvidenceCheckResult,
  type RulesSuggestOptions,
  type RulesInitResult,
  type TeamRule,
  type TeamRuleSuggestion,
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

export function runRulesAdd(
  cwd: string,
  options: {
    id: string;
    category: RulesAddInput["category"];
    text: string;
    prNumber: number;
    prUrl: string;
    sourceType?: RulesAddInput["sourceType"];
    file?: string[];
    symbol?: string[];
  },
): RulesAddResult {
  return addTeamRule(cwd, {
    id: options.id,
    category: options.category,
    text: options.text,
    prNumber: options.prNumber,
    prUrl: options.prUrl,
    sourceType: options.sourceType,
    filePaths: options.file ?? [],
    symbols: options.symbol ?? [],
  });
}

export function runRulesCheckEvidence(cwd: string): RulesEvidenceCheckResult {
  return checkTeamRuleEvidence(cwd);
}

export function runRulesSuggest(
  cwd: string,
  options: RulesSuggestOptions = {},
): { suggestions: TeamRuleSuggestion[] } {
  const root = detectGitRoot(cwd) ?? cwd;
  const db = openAnchorDatabase(root, defaultDatabasePath(root));
  try {
    return { suggestions: suggestTeamRules(db, root, options) };
  } finally {
    db.close();
  }
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

export function printRulesAdd(result: RulesAddResult): void {
  console.log("Added Anchor team rule.");
  console.log(`Rule: ${result.rule.id}`);
  console.log(`Path: ${result.path}`);
}

export function printRulesEvidenceCheck(result: RulesEvidenceCheckResult): void {
  if (result.ok) {
    console.log("Anchor team-rule evidence is present in the local index.");
    console.log(`Evidence references checked: ${result.checked}`);
    console.log(`Path: ${result.path}`);
    return;
  }

  console.error("Anchor team-rule evidence check failed.");
  for (const error of result.errors) console.error(`- ${error}`);
  for (const missing of result.missing) {
    console.error(`- ${missing.ruleId}: PR #${missing.prNumber} is not in the local index.`);
  }
  console.error(`Path: ${result.path}`);
}

export function printRulesSuggest(
  result: { suggestions: TeamRuleSuggestion[] },
  options: { json?: boolean } = {},
): void {
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Anchor rule suggestions (${result.suggestions.length})`);
  if (result.suggestions.length === 0) {
    console.log("No evidence-backed suggestions found in the local index.");
    return;
  }
  for (const suggestion of result.suggestions) {
    const evidence = suggestion.evidence[0];
    console.log(`- ${suggestion.id} [${suggestion.category}]`);
    console.log(`  Text: ${suggestion.sanitizedText}`);
    console.log(`  Reason: ${suggestion.reason}`);
    console.log(`  Evidence: PR #${evidence?.prNumber ?? "n/a"} ${evidence?.prUrl ?? ""}`);
    console.log(`  Confidence: ${suggestion.confidenceLevel}`);
  }
  console.log("Run anchor rules add with a reviewed rule when the team agrees.");
}
