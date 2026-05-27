import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { getIndexStatus, readOrgHeartbeat } from "@pratik7368patil/anchor-core";
import { runArchitecture } from "./architecture.js";
import { runDemo } from "./demo.js";
import { runExplain } from "./explain.js";
import { runHealth } from "./health.js";
import { runIndexCode } from "./index.js";
import { runPlan } from "./plan.js";
import { runPrompts } from "./prompts.js";
import { runReview } from "./review.js";
import { runTestCommand } from "./test-command.js";
import { runOnboarding } from "./onboarding.js";
import { runCi } from "./ci.js";
import { runEvalAdd, runEvalInit, runEvalRun } from "./eval.js";
import { runOrgGraph, runOrgInit } from "./org.js";
import { runPlaybooksInit, runPlaybooksSuggest } from "./playbooks.js";
import {
  runRulesAdd,
  runRulesCheckEvidence,
  runRulesInit,
  runRulesList,
  runRulesSuggest,
  runRulesValidate,
} from "./rules.js";
import { createProgressReporter } from "./progress.js";

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
              text: "Keep `createResource` backward compatible.",
              symbols: ["createResource"],
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
      text: "Keep `createResource` backward compatible.",
      symbols: ["createResource"],
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

describe("developer value commands", () => {
  it("runs plan, test-command, onboarding, eval, playbook, and CI commands", async () => {
    const cwd = tempDir();
    execFileSync("git", ["init"], { cwd, stdio: "ignore" });
    execFileSync("git", ["remote", "add", "origin", "git@github.com:owner/repo.git"], {
      cwd,
      stdio: "ignore",
    });
    writeFileEnsuringDir(
      path.join(cwd, "package.json"),
      JSON.stringify({ scripts: { test: "vitest run" } }, null, 2),
    );
    writeFileEnsuringDir(
      path.join(cwd, "src/services/api.ts"),
      "export function requestApi() { return true; }\n",
    );
    writeFileEnsuringDir(
      path.join(cwd, "src/services/api.test.ts"),
      "import { requestApi } from './api';\ntest('requestApi', () => requestApi());\n",
    );
    execFileSync("git", ["add", "."], { cwd, stdio: "ignore" });
    await runIndexCode(cwd, { token: undefined });

    expect(runTestCommand(cwd, "src/services/api.ts")[0]?.command).toContain("api.test.ts");
    const plan = runPlan(cwd, "change api service", {
      file: ["src/services/api.ts"],
      symbol: ["requestApi"],
    });
    expect(plan.markdown).toContain("# Anchor Task Plan");

    const map = runArchitecture(cwd, { map: true, format: "mermaid" });
    expect(map.markdown).toContain("```mermaid");
    const onboarding = runOnboarding(cwd, { area: "service" });
    expect(onboarding.markdown).toContain("# Anchor Onboarding Pack");

    expect(runEvalInit(cwd).created).toBe(true);
    runEvalAdd(cwd, {
      task: "change api service",
      file: ["src/services/api.ts"],
      expectPr: [],
      category: [],
    });
    expect(runEvalRun(cwd).total).toBe(1);

    expect(runPlaybooksInit(cwd).created).toBe(true);
    expect(Array.isArray(runPlaybooksSuggest(cwd))).toBe(true);
    expect(runCi(cwd, { minCoverage: 1 }).markdown).toContain("# Anchor CI");
  });
});

describe("progress reporter", () => {
  it("defaults to modern pretty progress for interactive streams and can be turned off", () => {
    const previousCi = process.env.CI;
    const previousProgress = process.env.ANCHOR_PROGRESS;
    const previousNoColor = process.env.NO_COLOR;
    delete process.env.CI;
    delete process.env.ANCHOR_PROGRESS;
    process.env.NO_COLOR = "1";
    const stream = new PassThrough() as PassThrough & { isTTY: boolean; columns: number };
    stream.isTTY = true;
    stream.columns = 120;
    let output = "";
    stream.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });

    const reporter = createProgressReporter({ stream, title: "Indexing repo memory" });
    reporter.onCodeProgress({
      stage: "indexed_code_file",
      repo: "owner/repo",
      current: 1,
      total: 2,
      filePath: "src/index.ts",
      chunks: 1,
    });
    reporter.onCodeProgress({
      stage: "writing_code_chunks",
      repo: "owner/repo",
      current: 500,
      total: 1000,
      filePath: "src/api/client.ts",
      chunks: 500,
    });
    reporter.log("[anchor] done");
    reporter.close();

    expect(output).toContain("Anchor");
    expect(output).toContain("Indexing repo memory");
    expect(output).toContain("last update");
    expect(output).toContain("Indexed code");
    expect(output).toContain("Writing code chunks");
    expect(output).toContain("1/2");
    expect(output).toContain("done");
    expect(output).not.toMatch(/\u001b\[[0-9;]*m/);

    output = "";
    const quiet = createProgressReporter({ json: true, stream });
    quiet.log("[anchor] hidden");
    quiet.onCodeProgress({
      stage: "discovering_code_files",
      repo: "owner/repo",
    });
    quiet.close();
    expect(output).toBe("");

    if (previousCi === undefined) delete process.env.CI;
    else process.env.CI = previousCi;
    if (previousProgress === undefined) delete process.env.ANCHOR_PROGRESS;
    else process.env.ANCHOR_PROGRESS = previousProgress;
    if (previousNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = previousNoColor;
  });

  it("defaults to plain progress for non-tty streams", () => {
    const previousCi = process.env.CI;
    const previousProgress = process.env.ANCHOR_PROGRESS;
    delete process.env.CI;
    delete process.env.ANCHOR_PROGRESS;
    const stream = new PassThrough() as PassThrough & { isTTY: boolean; columns: number };
    stream.isTTY = false;
    stream.columns = 80;

    const reporter = createProgressReporter({ stream });
    expect(reporter.mode).toBe("plain");

    if (previousCi === undefined) delete process.env.CI;
    else process.env.CI = previousCi;
    if (previousProgress === undefined) delete process.env.ANCHOR_PROGRESS;
    else process.env.ANCHOR_PROGRESS = previousProgress;
  });

  it("writes org heartbeat metadata while org progress is active", () => {
    const previousOrgHome = process.env.ANCHOR_ORG_HOME;
    const orgHome = tempDir();
    process.env.ANCHOR_ORG_HOME = orgHome;
    const stream = new PassThrough() as PassThrough & { isTTY: boolean; columns: number };
    stream.isTTY = false;
    stream.columns = 80;
    try {
      const reporter = createProgressReporter({
        stream,
        heartbeat: { org: "acme", command: "org sync" },
      });
      reporter.onOrgProgress({
        stage: "org_repo_phase",
        org: "acme",
        command: "org sync",
        repo: "acme/backend-api",
        current: 2,
        total: 5,
        phase: "Indexing code and architecture",
      });
      const heartbeat = readOrgHeartbeat("acme");
      expect(heartbeat?.command).toBe("org sync");
      expect(heartbeat?.repo).toBe("acme/backend-api");
      expect(heartbeat?.repoIndex).toBe(2);
      expect(heartbeat?.repoTotal).toBe(5);
      expect(heartbeat?.phase).toBe("Indexing code and architecture");
      reporter.close();
      expect(readOrgHeartbeat("acme")).toBeUndefined();
    } finally {
      if (previousOrgHome === undefined) delete process.env.ANCHOR_ORG_HOME;
      else process.env.ANCHOR_ORG_HOME = previousOrgHome;
    }
  });

  it("writes granular code progress into org heartbeat metadata", () => {
    const previousOrgHome = process.env.ANCHOR_ORG_HOME;
    const orgHome = tempDir();
    process.env.ANCHOR_ORG_HOME = orgHome;
    const stream = new PassThrough() as PassThrough & { isTTY: boolean; columns: number };
    stream.isTTY = false;
    stream.columns = 80;
    try {
      const reporter = createProgressReporter({
        stream,
        heartbeat: { org: "acme", command: "org sync" },
      });
      reporter.onCodeProgress({
        stage: "writing_architecture_data",
        repo: "acme/backend-api",
        current: 500,
        total: 1000,
        kind: "components",
      });
      const heartbeat = readOrgHeartbeat("acme");
      expect(heartbeat?.command).toBe("org sync");
      expect(heartbeat?.repo).toBe("acme/backend-api");
      expect(heartbeat?.phase).toBe("Writing architecture components");
      reporter.close();
      expect(readOrgHeartbeat("acme")).toBeUndefined();
    } finally {
      if (previousOrgHome === undefined) delete process.env.ANCHOR_ORG_HOME;
      else process.env.ANCHOR_ORG_HOME = previousOrgHome;
    }
  });
});

describe("org graph command", () => {
  it("rebuilds an empty org graph without fetching or indexing repos", () => {
    const previousOrgHome = process.env.ANCHOR_ORG_HOME;
    const orgHome = tempDir();
    process.env.ANCHOR_ORG_HOME = orgHome;
    try {
      runOrgInit({ org: "acme" });
      const htmlPath = path.join(orgHome, "graph.html");
      const result = runOrgGraph({ org: "acme", progress: "off", html: true, output: htmlPath });
      expect(result.markdown).toContain("# Anchor Org Graph");
      expect(result.metadata.edges).toBe(0);
      expect(result.metadata.apiConsumers).toBe(0);
      expect(result.metadata.htmlPath).toBe(htmlPath);
      expect(fs.existsSync(htmlPath)).toBe(true);
    } finally {
      if (previousOrgHome === undefined) delete process.env.ANCHOR_ORG_HOME;
      else process.env.ANCHOR_ORG_HOME = previousOrgHome;
    }
  });
});
