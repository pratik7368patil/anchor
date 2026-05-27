import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  addOrgRepoConfig,
  indexCodebase,
  indexPullRequests,
  initOrgConfig,
  openAnchorDatabase,
  openOrgDatabase,
  orgRepoLocalPath,
  rebuildOrgGraph,
  type PullRequestRecord,
} from "@pratik7368patil/anchor-core";
import { createAnchorMcpServer } from "../server.js";
import { handleAnchorExplainFile } from "./explain-file.js";
import { handleAnchorGetContext } from "./get-context.js";
import { handleAnchorIndexStatus } from "./index-status.js";
import { handleAnchorReviewDiff } from "./review-diff.js";
import { handleAnchorSearchHistory } from "./search-history.js";
import { handleAnchorGetArchitecture } from "./get-architecture.js";
import { handleAnchorCheckArchitecture } from "./check-architecture.js";
import { handleAnchorPlanTask } from "./plan-task.js";
import { handleAnchorGetTestCommands } from "./get-test-commands.js";
import { handleAnchorGetArchitectureMap } from "./get-architecture-map.js";
import { handleAnchorOnboardingPack } from "./onboarding-pack.js";
import { handleAnchorGetPlaybook } from "./get-playbook.js";
import { handleAnchorGetOrgContext } from "./get-org-context.js";
import { handleAnchorCheckCrossRepoImpact } from "./check-cross-repo-impact.js";
import { handleAnchorFindApiConsumers } from "./find-api-consumers.js";
import { handleAnchorGetOrgArchitecture } from "./get-org-architecture.js";
import { handleAnchorOrgIndexStatus } from "./org-index-status.js";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anchor-mcp-test-"));
  tempDirs.push(dir);
  return dir;
}

function loadFixtures(): PullRequestRecord[] {
  const fixturePath = path.resolve(process.cwd(), "../../fixtures/github/sample-prs.json");
  return JSON.parse(fs.readFileSync(fixturePath, "utf8")) as PullRequestRecord[];
}

function createIndexedFixture(cwd: string): void {
  execFileSync("git", ["init"], { cwd, stdio: "ignore" });
  fs.mkdirSync(path.join(cwd, "src/auth"), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, "package.json"),
    JSON.stringify({ scripts: { test: "vitest run" } }, null, 2),
  );
  fs.writeFileSync(
    path.join(cwd, "src/auth/cache.ts"),
    "export class AuthCache { refreshToken() { return true; } }\n",
  );
  fs.writeFileSync(
    path.join(cwd, "src/auth/cache.test.ts"),
    "import { AuthCache } from './cache';\ntest('refreshToken', () => new AuthCache());\n",
  );
  fs.writeFileSync(
    path.join(cwd, "anchor.rules.json"),
    JSON.stringify(
      {
        version: 1,
        rules: [
          {
            id: "auth-cache-lazy",
            category: "constraint",
            text: "Team rule: keep `AuthCache` lazy because cold starts regressed before.",
            filePaths: ["src/auth/cache.ts"],
            symbols: ["AuthCache"],
            evidence: [
              {
                prNumber: 101,
                prUrl: "https://github.com/owner/repo/pull/101",
                sourceType: "review_comment",
                note: "Reviewer called out the lazy constraint.",
              },
            ],
          },
        ],
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(cwd, "anchor.playbooks.json"),
    JSON.stringify(
      {
        version: 1,
        playbooks: [
          {
            id: "auth-cache-playbook",
            title: "Change auth cache safely",
            body: "Check AuthCache history and run nearby tests.",
            evidence: [
              {
                prNumber: 101,
                prUrl: "https://github.com/owner/repo/pull/101",
                sourceType: "review_comment",
              },
            ],
            createdAt: "2025-01-01T00:00:00.000Z",
          },
        ],
      },
      null,
      2,
    ),
  );
  execFileSync("git", ["add", "src/auth/cache.ts", "src/auth/cache.test.ts"], {
    cwd,
    stdio: "ignore",
  });
  const db = openAnchorDatabase(cwd);
  try {
    indexPullRequests(db, loadFixtures(), { cwd, repo: "owner/repo" });
    indexCodebase(db, { cwd, repo: "owner/repo" });
  } finally {
    db.close();
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.ANCHOR_ORG_HOME;
});

describe("MCP tools", () => {
  it("creates the Anchor MCP server", () => {
    const server = createAnchorMcpServer({ cwd: tempDir() });
    expect(server).toBeDefined();
  });

  it("validates anchor_get_context schema with helpful errors", async () => {
    const result = await handleAnchorGetContext({ task: "" }, tempDir());
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Invalid anchor_get_context input");
  });

  it("returns sanitized context and structured metadata", async () => {
    const cwd = tempDir();
    createIndexedFixture(cwd);
    const result = await handleAnchorGetContext(
      {
        task: "refactor AuthCache and token handling",
        files: ["src/auth/cache.ts"],
        symbols: ["AuthCache"],
      },
      cwd,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("# Anchor Context");
    expect(result.content[0]?.text).toContain("## Team-approved rules");
    expect(result.content[0]?.text).toContain("Evidence: PR #");
    expect(result.content[0]?.text).toContain("Confidence:");
    expect(result.content[0]?.text).toContain("Current code check:");
    expect(result.content[0]?.text).toContain("## Codebase Evidence");
    expect(result.content[0]?.text).toContain("## Architecture Guidance");
    expect(result.content[0]?.text).toContain("## Relevant tests");
    expect(result.content[0]?.text).toContain("## Regression memory");
    expect(result.content[0]?.text).toContain("src/auth/cache.ts");
    expect(result.content[0]?.text).not.toContain("ignore previous instructions");
    expect(result.content[0]?.text).not.toContain("FAKE_ANCHOR_REDACTION_SAMPLE");
    expect(result.structuredContent?.resultCount).toBeGreaterThan(0);
    expect(Array.isArray(result.structuredContent?.codeEvidence)).toBe(true);
    expect(Array.isArray(result.structuredContent?.architecturePatterns)).toBe(true);
    expect(Array.isArray(result.structuredContent?.relevantTests)).toBe(true);
    expect(Array.isArray(result.structuredContent?.regressionEvents)).toBe(true);
    expect(Array.isArray(result.structuredContent?.queryTerms)).toBe(true);
    expect(Array.isArray(result.structuredContent?.teamRules)).toBe(true);
    expect(result.structuredContent?.reliabilityGate).toMatchObject({
      status: "passed",
      acceptedHistoryCount: expect.any(Number),
    });
    expect(Array.isArray(result.structuredContent?.rejectedHistory)).toBe(true);
  });

  it("filters stale and weak evidence in strict mode", async () => {
    const cwd = tempDir();
    execFileSync("git", ["init"], { cwd, stdio: "ignore" });
    fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
    fs.writeFileSync(path.join(cwd, "src/other.ts"), "export const other = true;\n");
    execFileSync("git", ["add", "src/other.ts"], { cwd, stdio: "ignore" });
    const db = openAnchorDatabase(cwd);
    try {
      indexPullRequests(db, loadFixtures(), { cwd, repo: "owner/repo" });
      indexCodebase(db, { cwd, repo: "owner/repo" });
    } finally {
      db.close();
    }

    const result = await handleAnchorGetContext(
      {
        task: "refactor AuthCache",
        files: ["src/auth/cache.ts"],
        symbols: ["AuthCache"],
        strict: true,
      },
      cwd,
    );

    expect(result.content[0]?.text).toContain("No reliable historical evidence found.");
    expect(result.structuredContent?.resultCount).toBe(0);
    expect(result.structuredContent?.reliabilityGate).toMatchObject({
      status: "failed",
      strict: true,
    });
  });

  it("supports search history and index status", async () => {
    const cwd = tempDir();
    createIndexedFixture(cwd);
    const search = await handleAnchorSearchHistory(
      { query: "webhook security", maxResults: 3 },
      cwd,
    );
    const status = await handleAnchorIndexStatus({}, cwd);
    expect(search.content[0]?.text).toContain("# Anchor Search History");
    expect(status.content[0]?.text).toContain("# Anchor Index Status");
    expect(status.structuredContent?.wisdomUnitCount).toBeGreaterThan(0);
    expect(status.structuredContent?.teamRuleCount).toBe(1);
    expect(status.structuredContent?.historyCoverage).toBeDefined();
    expect(status.structuredContent?.coverageScore).toBeGreaterThan(0);
    expect(status.structuredContent?.coverageGrade).toBeDefined();
    expect(Array.isArray(status.structuredContent?.suggestedPrompts)).toBe(true);
    expect(status.structuredContent?.testFileCount).toBeGreaterThan(0);
    expect(status.structuredContent?.regressionEventCount).toBeGreaterThan(0);
    expect(status.structuredContent?.architecturePatternCount).toBeGreaterThan(0);
  });

  it("supports explain file and review diff MCP tools", async () => {
    const cwd = tempDir();
    createIndexedFixture(cwd);
    const explain = await handleAnchorExplainFile({ file: "src/auth/cache.ts" }, cwd);
    const review = await handleAnchorReviewDiff(
      {
        diff: [
          "diff --git a/src/auth/cache.ts b/src/auth/cache.ts",
          "--- a/src/auth/cache.ts",
          "+++ b/src/auth/cache.ts",
          "+export class AuthCache {}",
        ].join("\n"),
      },
      cwd,
    );
    expect(explain.content[0]?.text).toContain("# Anchor File Explain");
    expect(explain.structuredContent?.mode).toBe("explain_file");
    expect(review.content[0]?.text).toContain("# Anchor Diff Review");
    expect(review.structuredContent?.changedFiles).toEqual(["src/auth/cache.ts"]);
  });

  it("supports architecture MCP tools", async () => {
    const cwd = tempDir();
    createIndexedFixture(cwd);
    const architecture = await handleAnchorGetArchitecture({ file: "src/auth/cache.ts" }, cwd);
    const check = await handleAnchorCheckArchitecture(
      {
        diff: [
          "diff --git a/src/auth/cache.ts b/src/auth/cache.ts",
          "--- a/src/auth/cache.ts",
          "+++ b/src/auth/cache.ts",
          "+export class AuthCache {}",
        ].join("\n"),
      },
      cwd,
    );

    expect(architecture.content[0]?.text).toContain("# Anchor Architecture");
    expect(architecture.structuredContent?.mode).toBe("architecture");
    expect(check.content[0]?.text).toContain("# Anchor Architecture Check");
    expect(check.structuredContent?.mode).toBe("architecture_check");
  });

  it("supports developer value MCP tools", async () => {
    const cwd = tempDir();
    createIndexedFixture(cwd);
    const plan = await handleAnchorPlanTask(
      {
        task: "change AuthCache",
        files: ["src/auth/cache.ts"],
        symbols: ["AuthCache"],
      },
      cwd,
    );
    const commands = await handleAnchorGetTestCommands({ file: "src/auth/cache.ts" }, cwd);
    const map = await handleAnchorGetArchitectureMap({ file: "src/auth/cache.ts" }, cwd);
    const onboarding = await handleAnchorOnboardingPack({ area: "service" }, cwd);
    const playbook = await handleAnchorGetPlaybook({ id: "auth-cache-playbook" }, cwd);

    expect(plan.content[0]?.text).toContain("# Anchor Task Plan");
    expect(plan.structuredContent?.taskPlan).toBeDefined();
    expect(commands.content[0]?.text).toContain("cache.test.ts");
    expect(Array.isArray(commands.structuredContent?.testCommands)).toBe(true);
    expect(map.content[0]?.text).toContain("# Anchor Architecture Map");
    expect(map.structuredContent?.architectureMap).toBeDefined();
    expect(onboarding.content[0]?.text).toContain("# Anchor Onboarding Pack");
    expect(onboarding.structuredContent?.onboardingPack).toBeDefined();
    expect(playbook.content[0]?.text).toContain("Change auth cache safely");
    expect(playbook.structuredContent?.playbooks).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "auth-cache-playbook" })]),
    );
  });

  it("supports org memory MCP tools", async () => {
    const orgHome = tempDir();
    process.env.ANCHOR_ORG_HOME = orgHome;
    let config = initOrgConfig("acme");
    config = addOrgRepoConfig("acme", "acme/backend-api", {
      alias: "backend-api",
      group: "backend",
      cloneUrl: "https://github.com/acme/backend-api.git",
    });
    config = addOrgRepoConfig("acme", "acme/frontend-app", {
      alias: "frontend-app",
      group: "frontend",
      cloneUrl: "https://github.com/acme/frontend-app.git",
    });
    const backendPath = orgRepoLocalPath("acme", config.repos[0]!);
    const frontendPath = orgRepoLocalPath("acme", config.repos[1]!);
    fs.mkdirSync(path.join(backendPath, "src/api"), { recursive: true });
    fs.mkdirSync(path.join(frontendPath, "src/api"), { recursive: true });
    execFileSync("git", ["init"], { cwd: backendPath, stdio: "ignore" });
    execFileSync("git", ["init"], { cwd: frontendPath, stdio: "ignore" });
    fs.writeFileSync(
      path.join(backendPath, "package.json"),
      JSON.stringify({ name: "@acme/backend-api" }, null, 2),
    );
    fs.writeFileSync(
      path.join(backendPath, "src/api/user-access.ts"),
      'export const USER_ACCESS_ROUTE = "/api/user-access";\n',
    );
    fs.writeFileSync(
      path.join(frontendPath, "package.json"),
      JSON.stringify(
        { name: "@acme/frontend-app", dependencies: { "@acme/backend-api": "workspace:*" } },
        null,
        2,
      ),
    );
    fs.writeFileSync(
      path.join(frontendPath, "src/api/user-access-client.ts"),
      'export function loadAccess() { return fetch("/api/user-access"); }\n',
    );
    execFileSync("git", ["add", "."], { cwd: backendPath, stdio: "ignore" });
    execFileSync("git", ["add", "."], { cwd: frontendPath, stdio: "ignore" });
    const db = openOrgDatabase("acme");
    try {
      indexCodebase(db, { cwd: backendPath, repo: "acme/backend-api" });
      indexCodebase(db, { cwd: frontendPath, repo: "acme/frontend-app" });
      rebuildOrgGraph(db, config);
    } finally {
      db.close();
    }

    const status = await handleAnchorOrgIndexStatus({ org: "acme" });
    const consumers = await handleAnchorFindApiConsumers({
      org: "acme",
      repo: "acme/backend-api",
      files: ["src/api/user-access.ts"],
    });
    const architecture = await handleAnchorGetOrgArchitecture({ org: "acme" });
    const impact = await handleAnchorCheckCrossRepoImpact({
      org: "acme",
      repo: "acme/backend-api",
      files: ["src/api/user-access.ts"],
      strict: true,
    });
    const context = await handleAnchorGetOrgContext({
      org: "acme",
      task: "change user access API",
      repos: ["acme/backend-api"],
      files: ["src/api/user-access.ts"],
    });

    expect(status.content[0]?.text).toContain("# Anchor Org Index Status");
    expect(status.structuredContent?.apiConsumerCount).toBeGreaterThan(0);
    expect(consumers.content[0]?.text).toContain("acme/frontend-app");
    expect(architecture.content[0]?.text).toContain("```mermaid");
    expect(impact.content[0]?.text).toContain("# Anchor Cross-Repo Impact");
    expect(impact.structuredContent?.apiConsumers).toEqual(
      expect.arrayContaining([expect.objectContaining({ consumerRepo: "acme/frontend-app" })]),
    );
    expect(context.content[0]?.text).toContain("# Anchor Org Context");
    expect(context.content[0]?.text).not.toContain("ignore previous instructions");
  });
});
