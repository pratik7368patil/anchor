import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  addOrgRepoConfig,
  initOrgConfig,
  loadOrgConfig,
  openOrgDatabase,
  recordOrgGraphState,
  syncOrgConfigToDatabase,
  updateOrgRepoState,
} from "@pratik7368patil/anchor-core";
import { runOrgDocs } from "./org.js";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "anchor-org-docs-cli-test-"));
}

function withOrgHome<T>(baseDir: string, fn: () => T): T {
  const previous = process.env.ANCHOR_ORG_HOME;
  process.env.ANCHOR_ORG_HOME = baseDir;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.ANCHOR_ORG_HOME;
    else process.env.ANCHOR_ORG_HOME = previous;
  }
}

function createCliFixture(baseDir: string): void {
  let config = initOrgConfig("acme", baseDir);
  config = addOrgRepoConfig(
    "acme",
    "acme/backend-api",
    { alias: "backend-api", group: "backend", cloneUrl: "https://github.com/acme/backend-api.git" },
    baseDir,
  );
  const db = openOrgDatabase("acme", baseDir);
  try {
    syncOrgConfigToDatabase(db, config, baseDir);
    updateOrgRepoState(db, {
      org: "acme",
      repo: "acme/backend-api",
      localPath: path.join(baseDir, "acme", "repos", "backend-api"),
      defaultBranch: "main",
      currentCommit: "backend-api-commit",
      lastCodeIndexedCommit: "backend-api-commit",
      lastCodeIndexedAt: "2026-01-03T00:00:00.000Z",
    });
    recordOrgGraphState(db, {
      org: "acme",
      status: "success",
      builtAt: "2026-01-03T00:00:00.000Z",
    });
  } finally {
    db.close();
  }
  expect(loadOrgConfig("acme", baseDir).repos).toHaveLength(1);
}

describe("org docs command", () => {
  it("generates docs at the requested output path", () => {
    const baseDir = tempDir();
    const outputDir = path.join(baseDir, "custom-docs");
    createCliFixture(baseDir);

    const result = withOrgHome(baseDir, () => runOrgDocs({ org: "acme", output: outputDir }));

    expect(result.metadata.ok).toBe(true);
    expect(result.metadata.outputDir).toBe(outputDir);
    expect(fs.existsSync(path.join(outputDir, "index.html"))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, "manifest.json"))).toBe(true);
  });

  it("uses the default docs-site directory and reports strict failures", () => {
    const baseDir = tempDir();
    createCliFixture(baseDir);
    const db = openOrgDatabase("acme", baseDir);
    try {
      recordOrgGraphState(db, {
        org: "acme",
        status: "failed",
        builtAt: "2026-01-04T00:00:00.000Z",
        error: "graph failed",
      });
    } finally {
      db.close();
    }

    const result = withOrgHome(baseDir, () =>
      runOrgDocs({ org: "acme", strict: true, changedOnly: true }),
    );

    expect(result.metadata.ok).toBe(false);
    expect(result.metadata.outputDir).toBe(path.join(baseDir, "acme", "docs-site"));
    expect(result.metadata.failures).toContain("Org graph status is failed.");
  });
});
