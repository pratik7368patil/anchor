import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AnchorDatabase } from "../db/database.js";
import { initializeSchema } from "../db/database.js";
import type { CodeIndexProgress, ConfidenceLevel, TestCommand } from "../types.js";
import { isTestFilePath } from "../indexer/test-awareness.js";
import { uniqueStrings } from "../utils/text.js";

type PackageJson = {
  name?: string;
  scripts?: Record<string, string>;
};

type TestLinkRow = {
  test_path: string;
  reason: string;
  strength: number;
};

type CodeFileRow = {
  path: string;
};

function readJsonFile(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

function asPackageJson(value: unknown): PackageJson {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  const scriptsRecord = record.scripts;
  const scripts =
    scriptsRecord && typeof scriptsRecord === "object"
      ? Object.fromEntries(
          Object.entries(scriptsRecord as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        )
      : undefined;
  return {
    name: typeof record.name === "string" ? record.name : undefined,
    scripts,
  };
}

function packageManager(cwd: string): "pnpm" | "npm" | "yarn" {
  if (
    fs.existsSync(path.join(cwd, "pnpm-lock.yaml")) ||
    fs.existsSync(path.join(cwd, "pnpm-workspace.yaml"))
  ) {
    return "pnpm";
  }
  if (fs.existsSync(path.join(cwd, "yarn.lock"))) return "yarn";
  return "npm";
}

function findPackageRoot(
  cwd: string,
  filePath?: string,
): { root: string; packageJson: PackageJson } {
  const absolute = filePath ? path.resolve(cwd, filePath) : cwd;
  let current =
    fs.existsSync(absolute) && fs.statSync(absolute).isDirectory()
      ? absolute
      : path.dirname(absolute);
  const root = path.resolve(cwd);
  while (current.startsWith(root)) {
    const packageJsonPath = path.join(current, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      return { root: current, packageJson: asPackageJson(readJsonFile(packageJsonPath)) };
    }
    const next = path.dirname(current);
    if (next === current) break;
    current = next;
  }
  return {
    root,
    packageJson: asPackageJson(readJsonFile(path.join(root, "package.json"))),
  };
}

function hasConfig(cwd: string, names: string[]): boolean {
  return names.some((name) => fs.existsSync(path.join(cwd, name)));
}

function scriptNameFor(packageJson: PackageJson): string | undefined {
  const scripts = packageJson.scripts ?? {};
  const preferred = ["test:unit", "test", "vitest", "jest"];
  return preferred.find((name) => scripts[name]);
}

function commandForScript(
  cwd: string,
  packageRoot: string,
  packageJson: PackageJson,
  scriptName: string,
  targetPath: string,
): string {
  const manager = packageManager(cwd);
  const relativeTarget = targetPath.replace(/\\/g, "/");
  const relativePackage = path.relative(cwd, packageRoot).replace(/\\/g, "/");
  const packageScope =
    packageJson.name && manager === "pnpm"
      ? `--filter ${packageJson.name} `
      : relativePackage && relativePackage !== "."
        ? `--prefix ${relativePackage} `
        : "";
  if (manager === "yarn") return `yarn ${scriptName} ${relativeTarget}`;
  if (manager === "npm") return `npm ${packageScope}run ${scriptName} -- ${relativeTarget}`;
  return `pnpm ${packageScope}${scriptName} -- ${relativeTarget}`;
}

function fallbackCommands(cwd: string, targetPath: string): TestCommand[] {
  const manager = packageManager(cwd);
  const rootHasVitest = hasConfig(cwd, [
    "vitest.config.ts",
    "vitest.config.js",
    "vite.config.ts",
    "vite.config.js",
  ]);
  const rootHasJest = hasConfig(cwd, ["jest.config.ts", "jest.config.js", "jest.config.cjs"]);
  const rootHasPlaywright = hasConfig(cwd, [
    "playwright.config.ts",
    "playwright.config.js",
    "playwright.config.mjs",
  ]);
  const commands: TestCommand[] = [];
  if (rootHasVitest) {
    commands.push({
      command: `${manager} exec vitest run ${targetPath}`,
      reason: "Vitest config detected near repository root.",
      confidence: "moderate",
      filePath: targetPath,
    });
  }
  if (rootHasJest) {
    commands.push({
      command: `${manager} exec jest ${targetPath}`,
      reason: "Jest config detected near repository root.",
      confidence: "moderate",
      filePath: targetPath,
    });
  }
  if (rootHasPlaywright && /(?:e2e|playwright|\.spec\.)/i.test(targetPath)) {
    commands.push({
      command: `${manager} exec playwright test ${targetPath}`,
      reason: "Playwright config detected and target looks like an end-to-end test.",
      confidence: "moderate",
      filePath: targetPath,
    });
  }
  commands.push({
    command: `${manager} test`,
    reason: "Broad fallback when no exact test script can be inferred.",
    confidence: "weak",
  });
  return commands;
}

function testTargetsForFile(db: AnchorDatabase, filePath: string): string[] {
  if (isTestFilePath(filePath)) return [filePath];
  const rows = db
    .prepare(
      `SELECT test_path, reason, strength
       FROM test_links
       WHERE source_path = ?
       ORDER BY strength DESC, test_path ASC
       LIMIT 8`,
    )
    .all(filePath) as TestLinkRow[];
  return uniqueStrings(rows.map((row) => row.test_path));
}

function confidenceForTarget(filePath: string, targetPath: string): ConfidenceLevel {
  if (filePath === targetPath || isTestFilePath(filePath)) return "strong";
  const sourceBase = path.posix
    .basename(filePath)
    .replace(/\.[^.]+$/i, "")
    .toLowerCase();
  const testBase = path.posix
    .basename(targetPath)
    .replace(/\.(test|spec)\.[^.]+$/i, "")
    .replace(/\.[^.]+$/i, "")
    .toLowerCase();
  return sourceBase === testBase ? "strong" : "moderate";
}

function commandId(repo: string, command: TestCommand): string {
  return crypto
    .createHash("sha256")
    .update(`${repo}\0${command.filePath ?? ""}\0${command.command}`)
    .digest("hex");
}

export function detectTestCommandsForFile(
  db: AnchorDatabase,
  cwd: string,
  filePath: string,
): TestCommand[] {
  initializeSchema(db);
  const targets = testTargetsForFile(db, filePath);
  const effectiveTargets = targets.length > 0 ? targets : [filePath];
  const commands: TestCommand[] = [];
  for (const targetPath of effectiveTargets) {
    const packageInfo = findPackageRoot(cwd, targetPath);
    const scriptName = scriptNameFor(packageInfo.packageJson);
    if (scriptName) {
      commands.push({
        command: commandForScript(
          cwd,
          packageInfo.root,
          packageInfo.packageJson,
          scriptName,
          targetPath,
        ),
        reason:
          targets.length > 0
            ? `Related test inferred for ${filePath}.`
            : "Exact file test command inferred from package scripts.",
        confidence: confidenceForTarget(filePath, targetPath),
        filePath: targetPath,
      });
    } else {
      commands.push(...fallbackCommands(cwd, targetPath));
    }
  }
  const seen = new Set<string>();
  return commands.filter((command) => {
    const key = command.command;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function detectTestCommands(
  db: AnchorDatabase,
  cwd: string,
  files: string[] = [],
): TestCommand[] {
  initializeSchema(db);
  const targetFiles =
    files.length > 0
      ? files
      : (
          db.prepare("SELECT path FROM code_files ORDER BY path LIMIT 250").all() as CodeFileRow[]
        ).map((row) => row.path);
  const commands = targetFiles.flatMap((filePath) => detectTestCommandsForFile(db, cwd, filePath));
  const seen = new Set<string>();
  return commands.filter((command) => {
    const key = `${command.filePath ?? ""}\0${command.command}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function refreshTestCommands(
  db: AnchorDatabase,
  cwd: string,
  repo: string,
  files: string[] = [],
  options: { onProgress?: (progress: CodeIndexProgress) => void } = {},
): TestCommand[] {
  options.onProgress?.({
    stage: "refreshing_test_commands",
    repo,
    phase: "detecting",
    current: 0,
    total: files.length,
    commands: 0,
  });
  const commands = detectTestCommands(db, cwd, files);
  options.onProgress?.({
    stage: "refreshing_test_commands",
    repo,
    phase: "writing",
    current: 0,
    total: commands.length,
    commands: commands.length,
  });
  const now = new Date().toISOString();
  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM test_commands WHERE repo = ?").run(repo);
    const insert = db.prepare(
      `INSERT INTO test_commands (id, repo, file_path, command, reason, confidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const [index, command] of commands.entries()) {
      insert.run(
        commandId(repo, command),
        repo,
        command.filePath ?? null,
        command.command,
        command.reason,
        command.confidence,
        now,
      );
      const current = index + 1;
      if (current === 1 || current === commands.length || current % 250 === 0) {
        options.onProgress?.({
          stage: "refreshing_test_commands",
          repo,
          phase: "writing",
          current,
          total: commands.length,
          commands: commands.length,
        });
      }
    }
  });
  transaction();
  return commands;
}
