import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { AnchorDatabase } from "../db/database.js";
import type {
  AnchorContextInput,
  ConfidenceLevel,
  EvidenceRef,
  RankedTeamRule,
  TeamRule,
} from "../types.js";
import { sanitizeHistoricalText } from "../security/sanitize.js";
import { tokenizeSearchText, uniqueStrings } from "../utils/text.js";
import { detectGitRoot } from "../utils/git.js";
import {
  confidenceAtLeast,
  evaluateFreshness,
  loadCurrentCodeSnapshot,
  sourceTypeLabel,
} from "../retrieval/evidence.js";

export const TEAM_RULES_FILE = "anchor.rules.json";

const SourceTypeSchema = z.enum([
  "pr_body",
  "review_comment",
  "issue_comment",
  "review_summary",
  "commit_message",
  "diff_context",
]);

const WisdomCategorySchema = z.enum([
  "architecture_decision",
  "constraint",
  "rejected_approach",
  "bug_regression",
  "testing_rule",
  "api_contract",
  "performance_note",
  "security_note",
  "style_convention",
  "unknown",
]);

const ConfidenceLevelSchema = z.enum(["strong", "moderate", "weak"]);

const EvidenceRefSchema = z.object({
  prNumber: z.number().int().positive(),
  prUrl: z.string().url(),
  sourceType: SourceTypeSchema,
  author: z.string().min(1).optional(),
  filePath: z.string().min(1).optional(),
  note: z.string().min(1).max(500).optional(),
});

const TeamRuleSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9][a-z0-9._-]*$/i),
  category: WisdomCategorySchema,
  text: z.string().min(1).max(1000),
  filePaths: z.array(z.string().min(1)).max(50).default([]),
  symbols: z.array(z.string().min(1)).max(100).default([]),
  evidence: z.array(EvidenceRefSchema).min(1),
  confidenceLevel: ConfidenceLevelSchema.default("strong"),
});

const TeamRulesFileSchema = z.object({
  version: z.literal(1),
  rules: z.array(TeamRuleSchema).default([]),
});

export type TeamRulesValidationResult = {
  ok: boolean;
  path: string;
  errors: string[];
  rules: TeamRule[];
};

export type RulesInitResult = {
  path: string;
  created: boolean;
};

function rulesPath(cwd: string): string {
  return path.join(detectGitRoot(cwd) ?? cwd, TEAM_RULES_FILE);
}

function defaultRulesFile(): string {
  return `${JSON.stringify({ version: 1, rules: [] }, null, 2)}\n`;
}

export function ensureTeamRulesFile(cwd: string): RulesInitResult {
  const filePath = rulesPath(cwd);
  if (fs.existsSync(filePath)) return { path: filePath, created: false };
  fs.writeFileSync(filePath, defaultRulesFile());
  return { path: filePath, created: true };
}

function sanitizeEvidence(evidence: EvidenceRef[]): EvidenceRef[] {
  return evidence.map((item) => ({
    ...item,
    note: item.note ? sanitizeHistoricalText(item.note) : undefined,
  }));
}

export function loadTeamRulesFile(cwd: string): TeamRulesValidationResult & { exists: boolean } {
  const filePath = rulesPath(cwd);
  if (!fs.existsSync(filePath)) {
    return { ok: true, exists: false, path: filePath, errors: [], rules: [] };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  } catch (error) {
    return {
      ok: false,
      exists: true,
      path: filePath,
      errors: [`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`],
      rules: [],
    };
  }

  const parsed = TeamRulesFileSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return {
      ok: false,
      exists: true,
      path: filePath,
      errors: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      rules: [],
    };
  }

  const seenIds = new Set<string>();
  const duplicateIds = parsed.data.rules
    .map((rule) => rule.id)
    .filter((id) => {
      if (seenIds.has(id)) return true;
      seenIds.add(id);
      return false;
    });
  if (duplicateIds.length > 0) {
    return {
      ok: false,
      exists: true,
      path: filePath,
      errors: [`Duplicate rule ids: ${uniqueStrings(duplicateIds).join(", ")}`],
      rules: [],
    };
  }

  const rules = parsed.data.rules.map((rule): TeamRule => {
    const sanitizedText = sanitizeHistoricalText(rule.text);
    return {
      id: rule.id,
      category: rule.category,
      text: sanitizedText,
      sanitizedText,
      filePaths: uniqueStrings(rule.filePaths),
      symbols: uniqueStrings(rule.symbols),
      evidence: sanitizeEvidence(rule.evidence),
      confidenceLevel: rule.confidenceLevel,
    };
  });

  return { ok: true, exists: true, path: filePath, errors: [], rules };
}

export function validateTeamRulesFile(cwd: string): TeamRulesValidationResult {
  const loaded = loadTeamRulesFile(cwd);
  if (!loaded.exists) {
    return {
      ok: false,
      path: loaded.path,
      errors: [`${TEAM_RULES_FILE} does not exist. Run anchor rules init.`],
      rules: [],
    };
  }
  return {
    ok: loaded.ok,
    path: loaded.path,
    errors: loaded.errors,
    rules: loaded.rules,
  };
}

function pathMatch(rulePaths: string[], queryFiles: string[]): number {
  if (rulePaths.length === 0 || queryFiles.length === 0) return 0;
  let best = 0;
  for (const rulePath of rulePaths) {
    const ruleBase = path.basename(rulePath).toLowerCase();
    const ruleDir = path.dirname(rulePath).toLowerCase();
    for (const queryFile of queryFiles) {
      const queryBase = path.basename(queryFile).toLowerCase();
      const queryDir = path.dirname(queryFile).toLowerCase();
      if (rulePath.toLowerCase() === queryFile.toLowerCase()) best = Math.max(best, 1);
      else if (ruleBase === queryBase) best = Math.max(best, 0.72);
      else if (ruleDir === queryDir) best = Math.max(best, 0.6);
      else if (ruleDir.startsWith(queryDir) || queryDir.startsWith(ruleDir)) {
        best = Math.max(best, 0.35);
      }
    }
  }
  return best;
}

function symbolMatch(rule: TeamRule, querySymbols: string[]): number {
  if (rule.symbols.length === 0 || querySymbols.length === 0) return 0;
  const ruleSymbols = rule.symbols.map((symbol) => symbol.toLowerCase());
  let best = 0;
  for (const symbol of querySymbols) {
    const lower = symbol.toLowerCase();
    if (ruleSymbols.includes(lower)) best = Math.max(best, 1);
    else if (
      ruleSymbols.some((candidate) => candidate.includes(lower) || lower.includes(candidate))
    ) {
      best = Math.max(best, 0.45);
    }
  }
  return best;
}

function textMatch(rule: TeamRule, input: AnchorContextInput): number {
  const tokens = tokenizeSearchText(
    `${input.task} ${input.diff ?? ""} ${input.currentCode ?? ""}`,
    32,
  );
  if (tokens.length === 0) return 0;
  const haystack =
    `${rule.sanitizedText} ${rule.filePaths.join(" ")} ${rule.symbols.join(" ")}`.toLowerCase();
  return tokens.filter((token) => haystack.includes(token.toLowerCase())).length / tokens.length;
}

function confidenceScore(level: ConfidenceLevel): number {
  if (level === "strong") return 1;
  if (level === "moderate") return 0.7;
  return 0.4;
}

function confidenceReasons(rule: TeamRule): string[] {
  const firstEvidence = rule.evidence[0];
  return [
    "team-approved rule",
    firstEvidence ? `${sourceTypeLabel(firstEvidence.sourceType)} evidence` : "source evidence",
    ...(rule.filePaths.length > 0 ? ["file-associated"] : []),
    ...(rule.symbols.length > 0 ? ["symbol-associated"] : []),
  ];
}

function passesStrictMode(rule: RankedTeamRule, input: AnchorContextInput): boolean {
  if (!input.strict) return true;
  if (rule.freshnessStatus === "stale") return false;
  return confidenceAtLeast(rule.confidenceLevel, input.minConfidence ?? "strong");
}

export function rankTeamRules(
  db: AnchorDatabase,
  cwd: string,
  input: AnchorContextInput,
): RankedTeamRule[] {
  const loaded = loadTeamRulesFile(cwd);
  if (!loaded.ok || loaded.rules.length === 0) return [];
  const codeSnapshot = loadCurrentCodeSnapshot(db);
  return loaded.rules
    .map((rule) => {
      const freshness = evaluateFreshness(rule, codeSnapshot);
      const score =
        1 +
        0.35 * pathMatch(rule.filePaths, input.files ?? []) +
        0.25 * symbolMatch(rule, input.symbols ?? []) +
        0.25 * textMatch(rule, input) +
        0.15 * confidenceScore(rule.confidenceLevel);
      return {
        ...rule,
        score: Number(score.toFixed(4)),
        freshnessStatus: freshness.status,
        freshnessReason: freshness.reason,
        confidenceReasons: confidenceReasons(rule),
      };
    })
    .filter((rule) => passesStrictMode(rule, input))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

export function countValidTeamRules(cwd: string): { count: number; lastRuleIndexTime?: string } {
  const loaded = loadTeamRulesFile(cwd);
  if (!loaded.exists || !loaded.ok) return { count: 0 };
  const stat = fs.statSync(loaded.path);
  return { count: loaded.rules.length, lastRuleIndexTime: stat.mtime.toISOString() };
}
