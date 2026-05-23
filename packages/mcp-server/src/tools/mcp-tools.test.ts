import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import {
  indexCodebase,
  indexPullRequests,
  openAnchorDatabase,
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
});
