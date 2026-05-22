import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { getIndexStatus } from "@pratik7368patil/anchor-core";
import { runArchitecture } from "./architecture.js";
import { runDemo } from "./demo.js";
import { runExplain } from "./explain.js";
import { runHealth } from "./health.js";
import { runIndexCode } from "./index.js";
import { runPrompts } from "./prompts.js";
import { runReview } from "./review.js";
import {
  runRulesAdd,
  runRulesCheckEvidence,
  runRulesInit,
  runRulesList,
  runRulesSuggest,
  runRulesValidate,
} from "./rules.js";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anchor-cli-test-"));
  tempDirs.push(dir);
  return dir;
}

function writeFileEnsuringDir(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("demo and prompts commands", () => {
  it("runs the offline demo without GitHub authentication and cleans temporary workspaces", () => {
    const demo = runDemo({ json: true });
    expect(demo.context.markdown).toContain("# Anchor Context");
    expect(demo.explain.markdown).toContain("# Anchor File Brief");
    expect(demo.review.markdown).toContain("# Anchor Diff Brief");
    expect(demo.indexStatus.coverageScore).toBeGreaterThan(0);
    expect(demo.prompts.length).toBeGreaterThanOrEqual(4);
    expect(fs.existsSync(demo.path)).toBe(false);
  });

  it("keeps a requested demo workspace path", () => {
    const cwd = tempDir();
    const demoPath = path.join(cwd, "demo");
    const demo = runDemo({ path: demoPath });
    expect(demo.kept).toBe(true);
    expect(fs.existsSync(path.join(demoPath, ".anchor", "index.sqlite"))).toBe(true);
  });

  it("prints reusable Cursor prompts", () => {
    const prompts = runPrompts();
    expect(prompts.map((prompt) => prompt.id)).toContain("before_edit");
    expect(prompts.map((prompt) => prompt.id)).toContain("review_diff");
  });
});

describe("index-code command", () => {
  it("indexes local code without GitHub authentication", async () => {
    const cwd = tempDir();
    execFileSync("git", ["init"], { cwd, stdio: "ignore" });
    execFileSync("git", ["remote", "add", "origin", "git@github.com:owner/repo.git"], {
      cwd,
      stdio: "ignore",
    });
    writeFileEnsuringDir(
      path.join(cwd, "src/index.ts"),
      "export function localContext() { return 'code'; }\n",
    );
    execFileSync("git", ["add", "src/index.ts"], { cwd, stdio: "ignore" });

    await runIndexCode(cwd, { token: undefined });

    const status = getIndexStatus(cwd, false);
    expect(status.codeFileCount).toBe(1);
    expect(status.codeChunkCount).toBeGreaterThan(0);
    expect(status.architectureComponentCount).toBe(1);
    expect(status.architecturePatternCount).toBeGreaterThan(0);
    expect(runHealth(cwd).indexStatus.codeFileCount).toBe(1);
    expect(runExplain(cwd, "src/index.ts").markdown).toContain("# Anchor File Explain");
    expect(runExplain(cwd, "src/index.ts", { share: true }).markdown).toContain(
      "# Anchor File Brief",
    );
  });
});

describe("architecture command", () => {
  it("summarizes architecture, checks diffs, and writes docs on request", async () => {
    const cwd = tempDir();
    execFileSync("git", ["init"], { cwd, stdio: "ignore" });
    execFileSync("git", ["remote", "add", "origin", "git@github.com:owner/repo.git"], {
      cwd,
      stdio: "ignore",
    });
    writeFileEnsuringDir(
      path.join(cwd, "src/services/api.ts"),
      "export function requestApi() { return true; }\n",
    );
    writeFileEnsuringDir(
      path.join(cwd, "src/services/api.test.ts"),
      "import { requestApi } from './api';\ntest('requestApi', () => requestApi());\n",
    );
    execFileSync("git", ["add", "src"], { cwd, stdio: "ignore" });
    await runIndexCode(cwd, { token: undefined });

    const summary = runArchitecture(cwd, {});
    expect(summary.markdown).toContain("# Anchor Architecture");
    const file = runArchitecture(cwd, { file: "src/services/api.ts" });
    expect(file.markdown).toContain("src/services/api.ts");
    const area = runArchitecture(cwd, { area: "service" });
    expect(area.markdown).toContain("service");

    const diffPath = path.join(cwd, "change.diff");
    fs.writeFileSync(
      diffPath,
      [
        "diff --git a/src/services/api.ts b/src/services/api.ts",
        "--- a/src/services/api.ts",
        "+++ b/src/services/api.ts",
        "+export function requestApi() { return false; }",
      ].join("\n"),
    );
    const check = runArchitecture(cwd, { check: true, diffFile: diffPath });
    expect(check.markdown).toContain("# Anchor Architecture Check");

    runArchitecture(cwd, { writeDoc: true });
    expect(fs.existsSync(path.join(cwd, "ANCHOR_ARCHITECTURE.md"))).toBe(true);
  });
});

describe("rules commands", () => {
  it("initializes, validates, and lists committed team rules", () => {
    const cwd = tempDir();
    const init = runRulesInit(cwd);
    expect(fs.existsSync(init.path)).toBe(true);
    expect(init.created).toBe(true);
    expect(runRulesValidate(cwd).ok).toBe(true);

    fs.writeFileSync(
      path.join(cwd, "anchor.rules.json"),
      JSON.stringify(
        {
          version: 1,
          rules: [
            {
              id: "api-contract",
              category: "api_contract",
              text: "Keep `createMembership` backward compatible.",
              symbols: ["createMembership"],
              evidence: [
                {
                  prNumber: 10,
                  prUrl: "https://github.com/owner/repo/pull/10",
                  sourceType: "pr_body",
                },
              ],
            },
          ],
        },
        null,
        2,
      ),
    );

    const listed = runRulesList(cwd);
    expect(listed.rules).toHaveLength(1);
    expect(listed.rules[0]?.id).toBe("api-contract");
  });

  it("adds a rule and reports missing local PR evidence", () => {
    const cwd = tempDir();
    runRulesInit(cwd);
    const added = runRulesAdd(cwd, {
      id: "api-contract",
      category: "api_contract",
      text: "Keep `createMembership` backward compatible.",
      symbols: ["createMembership"],
      prNumber: 10,
      prUrl: "https://github.com/owner/repo/pull/10",
      sourceType: "pr_body",
    });
    expect(added.rule.id).toBe("api-contract");
    const evidence = runRulesCheckEvidence(cwd);
    expect(evidence.ok).toBe(false);
    expect(evidence.errors.join("\n")).toContain("Anchor database not found");
  });

  it("suggests draft rules from local evidence without writing the rules file", () => {
    const cwd = tempDir();
    runDemo({ path: cwd });
    const result = runRulesSuggest(cwd, { minConfidence: "moderate" });
    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions[0]?.evidence[0]?.prNumber).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(cwd, "anchor.rules.json"))).toBe(false);
  });
});

describe("review command", () => {
  it("reads a diff file and returns an evidence review shape", async () => {
    const cwd = tempDir();
    execFileSync("git", ["init"], { cwd, stdio: "ignore" });
    execFileSync("git", ["remote", "add", "origin", "git@github.com:owner/repo.git"], {
      cwd,
      stdio: "ignore",
    });
    writeFileEnsuringDir(
      path.join(cwd, "src/index.ts"),
      "export function localContext() { return 'code'; }\n",
    );
    execFileSync("git", ["add", "src/index.ts"], { cwd, stdio: "ignore" });
    await runIndexCode(cwd, { token: undefined });
    const diffPath = path.join(cwd, "change.diff");
    fs.writeFileSync(
      diffPath,
      [
        "diff --git a/src/index.ts b/src/index.ts",
        "--- a/src/index.ts",
        "+++ b/src/index.ts",
        "+export function localContext() { return 'new'; }",
      ].join("\n"),
    );

    const review = runReview(cwd, { diffFile: diffPath });
    expect(review.markdown).toContain("# Anchor Diff Review");
    expect(review.metadata.changedFiles).toEqual(["src/index.ts"]);

    const shared = runReview(cwd, { diffFile: diffPath, share: true });
    expect(shared.markdown).toContain("# Anchor Diff Brief");
    expect(shared.markdown).toContain("## Likely tests");
  });
});
