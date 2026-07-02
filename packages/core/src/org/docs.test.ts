import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  addOrgRepoConfig,
  generateOrgDocsSite,
  initOrgConfig,
  loadOrgConfig,
  openOrgDatabase,
  recordOrgGraphState,
  syncOrgConfigToDatabase,
  updateOrgRepoState,
} from "../index.js";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "anchor-org-docs-test-"));
}

function insertRepository(
  db: ReturnType<typeof openOrgDatabase>,
  fullName: string,
): { repoId: number; prId: number } {
  const [owner = "acme", name = fullName] = fullName.split("/");
  db.prepare(
    `INSERT INTO repositories (full_name, owner, name, url)
     VALUES (?, ?, ?, ?)`,
  ).run(fullName, owner, name, `https://github.com/${fullName}`);
  const repoId = (
    db.prepare("SELECT id FROM repositories WHERE full_name = ?").get(fullName) as { id: number }
  ).id;
  db.prepare(
    `INSERT INTO pull_requests
     (repo_id, number, url, title, body_text, body_sanitized, author, labels_json, created_at, merged_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    repoId,
    42,
    `https://github.com/${fullName}/pull/42`,
    "Document access contract",
    "Keep the access route stable",
    "Keep the access route stable",
    "maintainer",
    "[]",
    "2026-01-01T00:00:00.000Z",
    "2026-01-02T00:00:00.000Z",
    "2026-01-02T00:00:00.000Z",
  );
  const prId = (
    db.prepare("SELECT id FROM pull_requests WHERE repo_id = ? AND number = 42").get(repoId) as {
      id: number;
    }
  ).id;
  return { repoId, prId };
}

function seedDocsData(db: ReturnType<typeof openOrgDatabase>): void {
  const backend = insertRepository(db, "acme/backend-api");
  const frontend = insertRepository(db, "acme/frontend-app");
  const now = "2026-01-03T00:00:00.000Z";

  db.prepare(
    `INSERT INTO code_files (repo_id, path, language, size_bytes, content_hash, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(backend.repoId, "src/api/user-access.ts", "typescript", 120, "backend-file", now);
  const backendFileId = (
    db.prepare("SELECT id FROM code_files WHERE repo_id = ? AND path = ?").get(
      backend.repoId,
      "src/api/user-access.ts",
    ) as { id: number }
  ).id;
  db.prepare(
    `INSERT INTO code_chunks
     (id, repo_id, file_id, repo, file_path, language, start_line, end_line, sanitized_text, symbols_json, content_hash, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "backend-chunk",
    backend.repoId,
    backendFileId,
    "acme/backend-api",
    "src/api/user-access.ts",
    "typescript",
    1,
    12,
    "export const USER_ACCESS_ROUTE = '/api/user-access';",
    JSON.stringify(["USER_ACCESS_ROUTE", "getUserAccess"]),
    "backend-chunk-hash",
    now,
  );
  db.prepare(
    `INSERT INTO code_files (repo_id, path, language, size_bytes, content_hash, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(frontend.repoId, "src/api/user-access-client.ts", "typescript", 100, "frontend-file", now);
  const frontendFileId = (
    db.prepare("SELECT id FROM code_files WHERE repo_id = ? AND path = ?").get(
      frontend.repoId,
      "src/api/user-access-client.ts",
    ) as { id: number }
  ).id;
  db.prepare(
    `INSERT INTO code_chunks
     (id, repo_id, file_id, repo, file_path, language, start_line, end_line, sanitized_text, symbols_json, content_hash, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "frontend-chunk",
    frontend.repoId,
    frontendFileId,
    "acme/frontend-app",
    "src/api/user-access-client.ts",
    "typescript",
    1,
    8,
    "fetch('/api/user-access')",
    JSON.stringify(["fetchUserAccess"]),
    "frontend-chunk-hash",
    now,
  );
  db.prepare(
    `INSERT INTO test_files (repo_id, path, language, size_bytes, content_hash, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(backend.repoId, "src/api/user-access.test.ts", "typescript", 80, "backend-test", now);
  db.prepare(
    `INSERT INTO test_links (repo_id, source_path, test_path, reason, strength)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(backend.repoId, "src/api/user-access.ts", "src/api/user-access.test.ts", "basename", 0.95);
  db.prepare(
    `INSERT INTO test_commands (id, repo, file_path, command, reason, confidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "backend-test-command",
    "acme/backend-api",
    "src/api/user-access.ts",
    "pnpm test src/api/user-access.test.ts",
    "matched nearby test",
    "strong",
    now,
  );
  db.prepare(
    `INSERT INTO architecture_patterns
     (id, repo_id, repo, area, name, summary_sanitized, source_files_json, symbols_json, evidence_json, confidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "backend-api-pattern",
    backend.repoId,
    "acme/backend-api",
    "api",
    "API route constants",
    "API routes are exported as constants before client use.",
    JSON.stringify(["src/api/user-access.ts"]),
    JSON.stringify(["USER_ACCESS_ROUTE"]),
    "[]",
    0.9,
    now,
  );
  db.prepare(
    `INSERT INTO wisdom_units
     (id, repo_id, pr_id, repo, pr_number, pr_url, source_type, category, text, sanitized_text, file_paths_json, symbols_json, authors_json, created_at, merged_at, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "backend-wisdom",
    backend.repoId,
    backend.prId,
    "acme/backend-api",
    42,
    "https://github.com/acme/backend-api/pull/42",
    "review_comment",
    "api_contract",
    "Keep the user access route stable </script><script>alert(1)</script>.",
    "Keep the user access route stable </script><script>alert(1)</script>.",
    JSON.stringify(["src/api/user-access.ts"]),
    JSON.stringify(["USER_ACCESS_ROUTE"]),
    JSON.stringify(["maintainer"]),
    now,
    now,
    0.95,
  );
  db.prepare(
    `INSERT INTO regression_events
     (id, repo_id, repo, pr_number, pr_url, summary_sanitized, file_paths_json, symbols_json, test_paths_json, authors_json, labels_json, signals_json, created_at, merged_at, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "backend-regression",
    backend.repoId,
    "acme/backend-api",
    42,
    "https://github.com/acme/backend-api/pull/42",
    "Changing the access route broke the frontend before.",
    JSON.stringify(["src/api/user-access.ts"]),
    JSON.stringify(["USER_ACCESS_ROUTE"]),
    JSON.stringify(["src/api/user-access.test.ts"]),
    JSON.stringify(["maintainer"]),
    JSON.stringify(["regression"]),
    JSON.stringify(["regression"]),
    now,
    now,
    0.88,
  );
  db.prepare(
    `INSERT INTO org_cross_repo_edges
     (id, org, source_repo, source_path, target_repo, target_path, layer, relationship, evidence_json, match_reasons_json, evidence_count, is_weak, confidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "edge-frontend-backend",
    "acme",
    "acme/frontend-app",
    "*",
    "acme/backend-api",
    "*",
    "repo",
    "api_consumer",
    "[]",
    JSON.stringify(["matched_contract_token"]),
    2,
    0,
    0.91,
    now,
  );
  db.prepare(
    `INSERT INTO org_api_contracts
     (id, org, repo, file_path, contract, evidence_json, confidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "contract-user-access",
    "acme",
    "acme/backend-api",
    "src/api/user-access.ts",
    "/api/user-access",
    "[]",
    0.87,
    now,
  );
  db.prepare(
    `INSERT INTO org_api_consumers
     (id, org, provider_repo, provider_path, consumer_repo, consumer_path, contract, evidence_json, match_reasons_json, evidence_count, is_weak, confidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "consumer-user-access",
    "acme",
    "acme/backend-api",
    "src/api/user-access.ts",
    "acme/frontend-app",
    "src/api/user-access-client.ts",
    "/api/user-access",
    "[]",
    JSON.stringify(["matched_contract_token"]),
    2,
    0,
    0.91,
    now,
  );
  recordOrgGraphState(db, {
    org: "acme",
    status: "success",
    builtAt: now,
    edgeCount: 1,
    visibleEdgeCount: 1,
    weakEdgeCount: 0,
    apiContractCount: 1,
    apiConsumerCount: 1,
  });
}

function createFixture(): { baseDir: string; db: ReturnType<typeof openOrgDatabase> } {
  const baseDir = path.join(tempDir(), "orgs");
  let config = initOrgConfig("acme", baseDir);
  config = addOrgRepoConfig(
    "acme",
    "acme/backend-api",
    { alias: "backend-api", group: "backend", cloneUrl: "https://github.com/acme/backend-api.git" },
    baseDir,
  );
  config = addOrgRepoConfig(
    "acme",
    "acme/frontend-app",
    { alias: "frontend-app", group: "frontend", cloneUrl: "https://github.com/acme/frontend-app.git" },
    baseDir,
  );
  const db = openOrgDatabase("acme", baseDir);
  syncOrgConfigToDatabase(db, loadOrgConfig("acme", baseDir), baseDir);
  for (const repo of config.repos) {
    updateOrgRepoState(db, {
      org: "acme",
      repo: repo.fullName,
      localPath: path.join(baseDir, "acme", "repos", repo.alias),
      defaultBranch: repo.defaultBranch,
      currentCommit: `${repo.alias}-commit`,
      lastCodeIndexedCommit: `${repo.alias}-commit`,
      lastCodeIndexedAt: "2026-01-03T00:00:00.000Z",
      lastPrSyncAt: "2026-01-03T00:00:00.000Z",
    });
  }
  seedDocsData(db);
  return { baseDir, db };
}

describe("org docs site generation", () => {
  it("generates linked offline docs with a manifest and search bundle", () => {
    const { baseDir, db } = createFixture();
    const outputDir = path.join(baseDir, "acme", "docs-site");
    try {
      const result = generateOrgDocsSite(db, loadOrgConfig("acme", baseDir), {
        outputDir,
        baseDir,
      });
      const manifestPath = path.join(outputDir, "manifest.json");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
        org: string;
        coverage: { repos: number; generatedRepos: number; repoEdges: number; apiContracts: number };
        repos: Array<{ repo: string; status: string; path: string }>;
        pages: Array<{ path: string; title: string }>;
      };

      expect(result.metadata.ok).toBe(true);
      expect(manifest.org).toBe("acme");
      expect(manifest.coverage.repos).toBe(2);
      expect(manifest.coverage.generatedRepos).toBe(2);
      expect(manifest.coverage.repoEdges).toBe(1);
      expect(manifest.coverage.apiContracts).toBe(1);
      expect(manifest.repos.map((repo) => repo.repo)).toEqual([
        "acme/backend-api",
        "acme/frontend-app",
      ]);
      expect(manifest.repos.every((repo) => repo.status === "generated")).toBe(true);
      expect(manifest.pages.map((page) => page.path)).toEqual(
        expect.arrayContaining([
          "index.html",
          "apis/index.html",
          "graph/index.html",
          "search.html",
          "repos/backend-api/index.html",
          "repos/frontend-app/index.html",
        ]),
      );

      const backendHtml = fs.readFileSync(
        path.join(outputDir, "repos", "backend-api", "index.html"),
        "utf8",
      );
      expect(backendHtml).toContain("acme/backend-api");
      expect(backendHtml).toContain("Consumed by");
      expect(backendHtml).toContain("../frontend-app/");
      expect(backendHtml).toContain("/api/user-access");
      expect(backendHtml).toContain("Changing the access route broke the frontend before.");
      expect(backendHtml).not.toContain("</script><script>alert(1)</script>");

      const frontendHtml = fs.readFileSync(
        path.join(outputDir, "repos", "frontend-app", "index.html"),
        "utf8",
      );
      expect(frontendHtml).toContain("Depends on");
      expect(frontendHtml).toContain("../backend-api/");

      const searchBundle = fs.readFileSync(path.join(outputDir, "assets", "search-index.js"), "utf8");
      expect(searchBundle).toContain("window.__ANCHOR_DOCS_SEARCH__");
      expect(searchBundle).toContain("\\u003c");
      expect(searchBundle).not.toContain("</script>");
    } finally {
      db.close();
    }
  });

  it("fails strict mode when graph state is not successful", () => {
    const { baseDir, db } = createFixture();
    const outputDir = path.join(baseDir, "acme", "strict-docs-site");
    try {
      recordOrgGraphState(db, {
        org: "acme",
        status: "failed",
        builtAt: "2026-01-04T00:00:00.000Z",
        error: "graph failed",
      });
      const result = generateOrgDocsSite(db, loadOrgConfig("acme", baseDir), {
        outputDir,
        baseDir,
        strict: true,
      });

      expect(result.metadata.ok).toBe(false);
      expect(result.metadata.failures).toContain("Org graph status is failed.");
      expect(result.markdown).toContain("Strict failures: 1");
    } finally {
      db.close();
    }
  });

  it("marks unchanged repos as skipped when changed-only is requested", () => {
    const { baseDir, db } = createFixture();
    const outputDir = path.join(baseDir, "acme", "changed-only-docs-site");
    try {
      generateOrgDocsSite(db, loadOrgConfig("acme", baseDir), { outputDir, baseDir });
      const result = generateOrgDocsSite(db, loadOrgConfig("acme", baseDir), {
        outputDir,
        baseDir,
        changedOnly: true,
      });
      const manifest = JSON.parse(
        fs.readFileSync(path.join(outputDir, "manifest.json"), "utf8"),
      ) as { repos: Array<{ repo: string; status: string }> };

      expect(result.metadata.skippedRepos).toBe(2);
      expect(manifest.repos.map((repo) => repo.status)).toEqual(["skipped", "skipped"]);
      expect(fs.existsSync(path.join(outputDir, "repos", "backend-api", "index.html"))).toBe(true);
    } finally {
      db.close();
    }
  });
});
