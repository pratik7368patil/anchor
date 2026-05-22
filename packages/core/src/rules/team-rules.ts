import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { AnchorDatabase } from "../db/database.js";
import { defaultDatabasePath, initializeSchema, openAnchorDatabase } from "../db/database.js";
import type {
  AnchorContextInput,
  ConfidenceLevel,
  EvidenceRef,
  RankedTeamRule,
  SourceType,
  TeamRule,
  TeamRuleSuggestion,
  WisdomCategory,
} from "../types.js";
import { sanitizeHistoricalText } from "../security/sanitize.js";
import { clipSentence, tokenizeSearchText, uniqueStrings } from "../utils/text.js";
import { detectGitRoot } from "../utils/git.js";
import {
  claimKeyFor,
  confidenceAtLeast,
  confidenceLevelFor,
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

export type RulesAddInput = {
  id: string;
  category: WisdomCategory;
  text: string;
  filePaths?: string[];
  symbols?: string[];
  prNumber: number;
  prUrl: string;
  sourceType?: SourceType;
};

export type RulesAddResult = {
  path: string;
  rule: TeamRule;
};

export type RulesEvidenceCheckResult = {
  ok: boolean;
  path: string;
  checked: number;
  missing: Array<{ ruleId: string; prNumber: number }>;
  errors: string[];
};

export type RulesSuggestOptions = {
  category?: WisdomCategory;
  minConfidence?: ConfidenceLevel;
  maxResults?: number;
};

type WisdomSuggestionRow = {
  id: string;
  pr_number: number;
  pr_url: string;
  source_type: SourceType;
  category: WisdomCategory;
  sanitized_text: string;
  file_paths_json: string;
  symbols_json: string;
  authors_json: string;
  confidence: number;
};

type RegressionSuggestionRow = {
  id: string;
  pr_number: number;
  pr_url: string;
  summary_sanitized: string;
  file_paths_json: string;
  symbols_json: string;
  authors_json: string;
  confidence: number;
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

export function addTeamRule(cwd: string, input: RulesAddInput): RulesAddResult {
  ensureTeamRulesFile(cwd);
  const filePath = rulesPath(cwd);
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
    version?: number;
    rules?: unknown[];
  };
  const nextRule = {
    id: input.id,
    category: input.category,
    text: input.text,
    filePaths: input.filePaths ?? [],
    symbols: input.symbols ?? [],
    evidence: [
      {
        prNumber: input.prNumber,
        prUrl: input.prUrl,
        sourceType: input.sourceType ?? "pr_body",
      },
    ],
    confidenceLevel: "strong",
  };
  const next = { version: 1, rules: [...(raw.rules ?? []), nextRule] };
  fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`);

  const validation = validateTeamRulesFile(cwd);
  if (!validation.ok) {
    throw new Error(`Invalid Anchor rule: ${validation.errors.join("; ")}`);
  }
  const rule = validation.rules.find((item) => item.id === input.id);
  if (!rule) throw new Error(`Failed to add Anchor rule ${input.id}`);
  return { path: filePath, rule };
}

export function checkTeamRuleEvidence(cwd: string): RulesEvidenceCheckResult {
  const validation = validateTeamRulesFile(cwd);
  if (!validation.ok) {
    return {
      ok: false,
      path: validation.path,
      checked: 0,
      missing: [],
      errors: validation.errors,
    };
  }

  const databasePath = defaultDatabasePath(detectGitRoot(cwd) ?? cwd);
  if (!fs.existsSync(databasePath)) {
    return {
      ok: false,
      path: validation.path,
      checked: 0,
      missing: [],
      errors: [`Anchor database not found at ${databasePath}. Run anchor index first.`],
    };
  }

  const db = openAnchorDatabase(detectGitRoot(cwd) ?? cwd, databasePath);
  try {
    initializeSchema(db);
    const missing: Array<{ ruleId: string; prNumber: number }> = [];
    let checked = 0;
    for (const rule of validation.rules) {
      for (const evidence of rule.evidence) {
        checked += 1;
        const row = db
          .prepare("SELECT 1 FROM pull_requests WHERE number = ? LIMIT 1")
          .get(evidence.prNumber);
        if (!row) missing.push({ ruleId: rule.id, prNumber: evidence.prNumber });
      }
    }
    return {
      ok: missing.length === 0,
      path: validation.path,
      checked,
      missing,
      errors: [],
    };
  } finally {
    db.close();
  }
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

function matchReasons(parts: {
  filePathMatch: number;
  symbolMatch: number;
  textMatch: number;
  confidence: number;
}): string[] {
  const reasons = ["team-approved rule"];
  if (parts.filePathMatch >= 0.9) reasons.push("exact file path match");
  else if (parts.filePathMatch >= 0.45) reasons.push("related file path match");
  if (parts.symbolMatch >= 0.9) reasons.push("exact symbol match");
  else if (parts.symbolMatch >= 0.45) reasons.push("symbol-associated rule");
  if (parts.textMatch >= 0.35) reasons.push("text matched task or diff terms");
  return reasons.slice(0, 5);
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
      const parts = {
        filePathMatch: pathMatch(rule.filePaths, input.files ?? []),
        symbolMatch: symbolMatch(rule, input.symbols ?? []),
        textMatch: textMatch(rule, input),
        confidence: confidenceScore(rule.confidenceLevel),
      };
      const score =
        1 +
        0.35 * parts.filePathMatch +
        0.25 * parts.symbolMatch +
        0.25 * parts.textMatch +
        0.15 * parts.confidence;
      return {
        ...rule,
        score: Number(score.toFixed(4)),
        freshnessStatus: freshness.status,
        freshnessReason: freshness.reason,
        confidenceReasons: confidenceReasons(rule),
        matchReasons: matchReasons(parts),
        rankSignals: parts,
      };
    })
    .filter((rule) => passesStrictMode(rule, input))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function confidenceMinimum(level: ConfidenceLevel): number {
  if (level === "strong") return 0.75;
  if (level === "moderate") return 0.55;
  return 0;
}

function suggestionSlug(category: WisdomCategory, text: string, filePaths: string[]): string {
  const base =
    filePaths[0]?.split(/[/.]/).filter(Boolean).slice(-2).join("-") ||
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 36) ||
    "rule";
  const hash = createHash("sha1").update(`${category}:${text}`).digest("hex").slice(0, 8);
  return `${category.replace(/_/g, "-")}-${base.toLowerCase()}-${hash}`
    .replace(/[^a-z0-9._-]+/g, "-")
    .slice(0, 120);
}

function sortSuggestionCandidates(a: TeamRuleSuggestion, b: TeamRuleSuggestion): number {
  const repeated = b.repeatedEvidenceCount - a.repeatedEvidenceCount;
  if (repeated !== 0) return repeated;
  return confidenceMinimum(b.confidenceLevel) - confidenceMinimum(a.confidenceLevel);
}

function wisdomCategoriesForSuggestions(category?: WisdomCategory): WisdomCategory[] {
  const defaults: WisdomCategory[] = [
    "constraint",
    "api_contract",
    "security_note",
    "bug_regression",
    "architecture_decision",
  ];
  return category ? [category] : defaults;
}

function existingRuleIds(cwd: string): Set<string> {
  const loaded = loadTeamRulesFile(cwd);
  return new Set(loaded.rules.map((rule) => rule.id));
}

export function suggestTeamRules(
  db: AnchorDatabase,
  cwd: string,
  options: RulesSuggestOptions = {},
): TeamRuleSuggestion[] {
  initializeSchema(db);
  const minConfidence = options.minConfidence ?? "moderate";
  const categories = wisdomCategoriesForSuggestions(options.category);
  const categoryPlaceholders = categories.map(() => "?").join(", ");
  const wisdomRows = db
    .prepare(
      `SELECT id, pr_number, pr_url, source_type, category, sanitized_text, file_paths_json,
              symbols_json, authors_json, confidence
       FROM wisdom_units
       WHERE category IN (${categoryPlaceholders}) AND confidence >= ?
       ORDER BY confidence DESC, pr_number DESC`,
    )
    .all(...categories, confidenceMinimum(minConfidence)) as WisdomSuggestionRow[];
  const loadedIds = existingRuleIds(cwd);
  const grouped = new Map<
    string,
    {
      best: WisdomSuggestionRow;
      rows: WisdomSuggestionRow[];
      prNumbers: Set<number>;
    }
  >();

  for (const row of wisdomRows) {
    const key = claimKeyFor(row.category, row.sanitized_text);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { best: row, rows: [row], prNumbers: new Set([row.pr_number]) });
    } else {
      existing.rows.push(row);
      existing.prNumbers.add(row.pr_number);
      if (row.confidence > existing.best.confidence) existing.best = row;
    }
  }

  const suggestions: TeamRuleSuggestion[] = [];
  for (const group of grouped.values()) {
    const row = group.best;
    const filePaths = uniqueStrings(
      group.rows.flatMap((item) => parseJsonArray(item.file_paths_json)),
    );
    const symbols = uniqueStrings(group.rows.flatMap((item) => parseJsonArray(item.symbols_json)));
    const id = suggestionSlug(row.category, row.sanitized_text, filePaths);
    if (loadedIds.has(id)) continue;
    const evidence = group.rows.slice(0, 5).map((item) => ({
      prNumber: item.pr_number,
      prUrl: item.pr_url,
      sourceType: item.source_type,
      author: parseJsonArray(item.authors_json)[0],
      filePath: parseJsonArray(item.file_paths_json)[0],
    }));
    suggestions.push({
      id,
      category: row.category,
      text: clipSentence(row.sanitized_text, 500),
      sanitizedText: clipSentence(row.sanitized_text, 500),
      filePaths: filePaths.slice(0, 12),
      symbols: symbols.slice(0, 20),
      evidence,
      confidenceLevel: confidenceLevelFor(
        Math.max(row.confidence, group.prNumbers.size > 1 ? 0.8 : 0),
      ),
      repeatedEvidenceCount: group.prNumbers.size,
      reason:
        group.prNumbers.size > 1
          ? `Repeated across ${group.prNumbers.size} PRs.`
          : `${sourceTypeLabel(row.source_type)} with ${confidenceLevelFor(row.confidence)} confidence.`,
    });
  }

  if (!options.category || options.category === "bug_regression") {
    const regressionRows = db
      .prepare(
        `SELECT id, pr_number, pr_url, summary_sanitized, file_paths_json, symbols_json,
                authors_json, confidence
         FROM regression_events
         WHERE confidence >= ?
         ORDER BY confidence DESC, pr_number DESC`,
      )
      .all(confidenceMinimum(minConfidence)) as RegressionSuggestionRow[];
    for (const row of regressionRows.slice(0, 12)) {
      const filePaths = parseJsonArray(row.file_paths_json);
      const id = suggestionSlug("bug_regression", row.summary_sanitized, filePaths);
      if (loadedIds.has(id)) continue;
      suggestions.push({
        id,
        category: "bug_regression",
        text: clipSentence(row.summary_sanitized, 500),
        sanitizedText: clipSentence(row.summary_sanitized, 500),
        filePaths: filePaths.slice(0, 12),
        symbols: parseJsonArray(row.symbols_json).slice(0, 20),
        evidence: [
          {
            prNumber: row.pr_number,
            prUrl: row.pr_url,
            sourceType: "pr_body",
            author: parseJsonArray(row.authors_json)[0],
            filePath: filePaths[0],
            note: "Regression event extracted from local PR history.",
          },
        ],
        confidenceLevel: confidenceLevelFor(row.confidence),
        repeatedEvidenceCount: 1,
        reason: "Regression memory extracted from local PR history.",
      });
    }
  }

  return suggestions
    .sort(sortSuggestionCandidates)
    .slice(0, Math.max(1, Math.min(options.maxResults ?? 8, 20)));
}

export function countValidTeamRules(cwd: string): { count: number; lastRuleIndexTime?: string } {
  const loaded = loadTeamRulesFile(cwd);
  if (!loaded.exists || !loaded.ok) return { count: 0 };
  const stat = fs.statSync(loaded.path);
  return { count: loaded.rules.length, lastRuleIndexTime: stat.mtime.toISOString() };
}
