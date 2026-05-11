import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { indexPullRequests, openAnchorDatabase, type PullRequestRecord } from "@pratik7368patil/anchor-core";
import { createAnchorMcpServer } from "../server.js";
import { handleAnchorGetContext } from "./get-context.js";
import { handleAnchorIndexStatus } from "./index-status.js";
import { handleAnchorSearchHistory } from "./search-history.js";

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
  const db = openAnchorDatabase(cwd);
  try {
    indexPullRequests(db, loadFixtures(), { cwd, repo: "owner/repo" });
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
    expect(result.content[0]?.text).toContain("Evidence: PR #");
    expect(result.content[0]?.text).not.toContain("ignore previous instructions");
    expect(result.content[0]?.text).not.toContain("FAKE_ANCHOR_REDACTION_SAMPLE");
    expect(result.structuredContent?.resultCount).toBeGreaterThan(0);
  });

  it("supports search history and index status", async () => {
    const cwd = tempDir();
    createIndexedFixture(cwd);
    const search = await handleAnchorSearchHistory({ query: "webhook security", maxResults: 3 }, cwd);
    const status = await handleAnchorIndexStatus({}, cwd);
    expect(search.content[0]?.text).toContain("# Anchor Search History");
    expect(status.content[0]?.text).toContain("# Anchor Index Status");
    expect(status.structuredContent?.wisdomUnitCount).toBeGreaterThan(0);
  });
});
