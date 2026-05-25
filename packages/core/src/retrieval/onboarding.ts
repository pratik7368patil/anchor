import type { AnchorDatabase } from "../db/database.js";
import { initializeSchema } from "../db/database.js";
import type { ArchitectureArea, OnboardingPack } from "../types.js";
import { loadTeamRulesFile } from "../rules/team-rules.js";
import { getSuggestedPrompts } from "../engagement/prompts.js";
import { listPlaybooks } from "../playbooks/playbooks.js";
import { buildArchitectureMap } from "./architecture-map.js";
import type { FormattedResult } from "./formatter.js";

type AreaRow = {
  area: ArchitectureArea;
  files: number;
  pattern_count: number;
};

type PathRow = {
  path: string;
};

type RegressionPathRow = {
  file_paths_json: string;
};

export type OnboardingInput = {
  file?: string;
  area?: ArchitectureArea;
};

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

function importantFiles(db: AnchorDatabase, input: OnboardingInput): string[] {
  if (input.file) return [input.file];
  if (input.area) {
    return (
      db
        .prepare(
          `SELECT path
           FROM architecture_components
           WHERE area = ?
           ORDER BY confidence DESC, path
           LIMIT 12`,
        )
        .all(input.area) as PathRow[]
    ).map((row) => row.path);
  }
  return (
    db
      .prepare(
        `SELECT path
         FROM architecture_components
         ORDER BY confidence DESC, path
         LIMIT 12`,
      )
      .all() as PathRow[]
  ).map((row) => row.path);
}

function riskyModules(db: AnchorDatabase): string[] {
  const rows = db
    .prepare(
      `SELECT file_paths_json
       FROM regression_events
       ORDER BY confidence DESC, COALESCE(merged_at, created_at) DESC
       LIMIT 20`,
    )
    .all() as RegressionPathRow[];
  return [...new Set(rows.flatMap((row) => parseJsonArray(row.file_paths_json)))].slice(0, 10);
}

function relatedTests(db: AnchorDatabase, files: string[]): string[] {
  if (files.length === 0) {
    return (
      db.prepare("SELECT path FROM test_files ORDER BY path LIMIT 10").all() as PathRow[]
    ).map((row) => row.path);
  }
  const placeholders = files.map(() => "?").join(", ");
  return (
    db
      .prepare(
        `SELECT DISTINCT test_path AS path
         FROM test_links
         WHERE source_path IN (${placeholders})
         ORDER BY test_path
         LIMIT 12`,
      )
      .all(...files) as PathRow[]
  ).map((row) => row.path);
}

export function buildOnboardingPack(
  db: AnchorDatabase,
  cwd: string,
  input: OnboardingInput = {},
): FormattedResult {
  initializeSchema(db);
  const areaRows = db
    .prepare(
      `SELECT ac.area AS area, COUNT(DISTINCT ac.path) AS files,
              COUNT(DISTINCT ap.id) AS pattern_count
       FROM architecture_components ac
       LEFT JOIN architecture_patterns ap ON ap.area = ac.area
       GROUP BY ac.area
       ORDER BY files DESC, ac.area`,
    )
    .all() as AreaRow[];
  const files = importantFiles(db, input);
  const rules = loadTeamRulesFile(cwd).rules.slice(0, 5);
  const pack: OnboardingPack = {
    title: input.file
      ? `Onboarding for ${input.file}`
      : input.area
        ? `Onboarding for ${input.area}`
        : "Repository onboarding pack",
    areas: areaRows.map((row) => ({
      area: row.area,
      files: importantFiles(db, { area: row.area }).slice(0, 5),
      patternCount: row.pattern_count,
    })),
    importantFiles: files,
    riskyModules: riskyModules(db),
    relevantTests: relatedTests(db, files),
    topRules: rules,
    playbooks: listPlaybooks(cwd).slice(0, 5),
    starterPrompts: getSuggestedPrompts().map((prompt) => prompt.prompt).slice(0, 5),
    architectureMap: buildArchitectureMap(db, {
      file: input.file,
      area: input.area,
      format: "json",
      maxNodes: 60,
    }),
  };

  const lines = ["# Anchor Onboarding Pack", "", pack.title, ""];
  lines.push("## Areas", "");
  if (pack.areas.length === 0) lines.push("- No architecture areas indexed yet.");
  else {
    for (const area of pack.areas.slice(0, 8)) {
      lines.push(`- ${area.area}: ${area.files.length} sample file(s), ${area.patternCount} pattern(s)`);
    }
  }
  lines.push("", "## Important files", "");
  if (pack.importantFiles.length === 0) lines.push("- No important files inferred.");
  else for (const file of pack.importantFiles.slice(0, 10)) lines.push(`- ${file}`);
  lines.push("", "## Risky modules", "");
  if (pack.riskyModules.length === 0) lines.push("- No regression-linked modules found.");
  else for (const file of pack.riskyModules.slice(0, 8)) lines.push(`- ${file}`);
  lines.push("", "## Relevant tests", "");
  if (pack.relevantTests.length === 0) lines.push("- No related tests found.");
  else for (const test of pack.relevantTests.slice(0, 8)) lines.push(`- ${test}`);
  lines.push("", "## Starter prompts", "");
  for (const prompt of pack.starterPrompts.slice(0, 4)) lines.push(`- ${prompt}`);

  return {
    markdown: lines.join("\n"),
    metadata: {
      onboardingPack: pack,
    },
  };
}
