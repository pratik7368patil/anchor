import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  addOrgRepoConfig,
  checkOrgImpact,
  cloneOrgRepos,
  findOrgApiConsumers,
  getOrgArchitectureMap,
  getOrgStatus,
  indexOrgRepos,
  initOrgConfig,
  loadOrgConfig,
  openOrgDatabase,
  orgRepoLocalPath,
  plannedOrgCloneCommands,
  removeOrgRepoConfig,
  rebuildOrgGraph,
  type PullRequestRecord,
} from "../index.js";

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "anchor-org-test-"));
}

function writeFile(cwd: string, filePath: string, content: string): void {
  const target = path.join(cwd, filePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function initGitRepo(cwd: string): void {
  execFileSync("git", ["init", "-b", "main"], { cwd, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "anchor@example.test"], { cwd, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Anchor Test"], { cwd, stdio: "ignore" });
}

function commitAll(cwd: string, message: string): void {
  execFileSync("git", ["add", "."], { cwd, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", message], { cwd, stdio: "ignore" });
}

function createBackendRepo(root: string): string {
  const repo = path.join(root, "backend-api");
  fs.mkdirSync(repo, { recursive: true });
  initGitRepo(repo);
  writeFile(
    repo,
    "package.json",
    JSON.stringify({ name: "@acme/backend-api", version: "1.0.0" }, null, 2),
  );
  writeFile(
    repo,
    "src/api/user-access.ts",
    [
      'export const USER_ACCESS_ROUTE = "/api/user-access";',
      "export function getUserAccess() {",
      "  return { allowed: true };",
      "}",
      ...Array.from({ length: 90 }, (_, index) => `export const filler${index} = ${index};`),
      'export const USER_ACCESS_ROUTE_ALIAS = "/api/user-access";',
    ].join("\n"),
  );
  writeFile(
    repo,
    "src/api/user-access.test.ts",
    "import { getUserAccess } from './user-access';\ntest('keeps access contract', () => expect(getUserAccess().allowed).toBe(true));\n",
  );
  commitAll(repo, "initial backend");
  return repo;
}

function createFrontendRepo(root: string): string {
  const repo = path.join(root, "frontend-app");
  fs.mkdirSync(repo, { recursive: true });
  initGitRepo(repo);
  writeFile(
    repo,
    "package.json",
    JSON.stringify(
      {
        name: "@acme/frontend-app",
        version: "1.0.0",
        dependencies: { "@acme/backend-api": "workspace:*" },
      },
      null,
      2,
    ),
  );
  writeFile(
    repo,
    "src/api/user-access-client.ts",
    [
      'import { USER_ACCESS_ROUTE } from "@acme/backend-api";',
      "export async function fetchUserAccess() {",
      '  return fetch("/api/user-access");',
      "}",
    ].join("\n"),
  );
  commitAll(repo, "initial frontend");
  return repo;
}

describe("org memory", () => {
  it("manages allowlisted repos idempotently", () => {
    const baseDir = tempDir();
    initOrgConfig("acme", baseDir);
    addOrgRepoConfig(
      "acme",
      "acme/backend-api",
      { alias: "backend", group: "backend", cloneUrl: "https://github.com/acme/backend-api.git" },
      baseDir,
    );
    addOrgRepoConfig(
      "acme",
      "acme/backend-api",
      { alias: "backend", group: "backend", cloneUrl: "https://github.com/acme/backend-api.git" },
      baseDir,
    );
    let config = loadOrgConfig("acme", baseDir);
    expect(config.repos).toHaveLength(1);
    expect(config.repos[0]?.enabled).toBe(true);

    config = removeOrgRepoConfig("acme", "acme/backend-api", baseDir);
    expect(config.repos[0]?.enabled).toBe(false);

    expect(() => addOrgRepoConfig("acme", "not-a-full-name", {}, baseDir)).toThrow(/owner\/name/);
  });

  it("plans safe shallow clone and pull commands without tokens", () => {
    const localPath = path.join(tempDir(), "repo");
    const commands = plannedOrgCloneCommands(
      {
        fullName: "acme/backend-api",
        alias: "backend-api",
        group: "backend",
        cloneUrl: "https://github.com/acme/backend-api.git",
        defaultBranch: "main",
        enabled: true,
      },
      localPath,
    );
    expect(commands[0]?.args).toEqual([
      "clone",
      "--depth",
      "1",
      "https://github.com/acme/backend-api.git",
      localPath,
    ]);
    expect(JSON.stringify(commands)).not.toContain("GITHUB_TOKEN");
  });

  it("indexes cloned repos into one org database, detects consumers, and reports impact", async () => {
    const root = tempDir();
    const baseDir = path.join(root, "orgs");
    const backendSource = createBackendRepo(root);
    const frontendSource = createFrontendRepo(root);
    let config = initOrgConfig("acme", baseDir);
    config = addOrgRepoConfig(
      "acme",
      "acme/backend-api",
      {
        alias: "backend-api",
        group: "backend",
        cloneUrl: backendSource,
        defaultBranch: "main",
      },
      baseDir,
    );
    config = addOrgRepoConfig(
      "acme",
      "acme/frontend-app",
      {
        alias: "frontend-app",
        group: "frontend",
        cloneUrl: frontendSource,
        defaultBranch: "main",
      },
      baseDir,
    );

    const db = openOrgDatabase("acme", baseDir);
    try {
      const cloneResults = await cloneOrgRepos({ config, db, baseDir });
      expect(cloneResults.every((result) => !result.error)).toBe(true);
      expect(fs.existsSync(orgRepoLocalPath("acme", config.repos[0]!, baseDir))).toBe(true);

      const graphProgressStages: string[] = [];
      const graphWriteKinds: string[] = [];
      const first = await indexOrgRepos(db, config, {
        codeOnly: true,
        force: true,
        baseDir,
        onGraphProgress: (progress) => {
          graphProgressStages.push(progress.stage);
          if (progress.stage === "writing_org_graph" && progress.kind) {
            graphWriteKinds.push(progress.kind);
          }
        },
      });
      const firstChunkCount = (
        db.prepare("SELECT COUNT(*) AS count FROM code_chunks").get() as { count: number }
      ).count;
      const second = await indexOrgRepos(db, config, { codeOnly: true, baseDir });
      const secondChunkCount = (
        db.prepare("SELECT COUNT(*) AS count FROM code_chunks").get() as { count: number }
      ).count;
      expect(first.graph.apiConsumers).toBeGreaterThan(0);
      expect(graphProgressStages).toContain("matching_api_consumers");
      expect(graphWriteKinds).toEqual(expect.arrayContaining(["edges", "contracts", "consumers"]));
      expect(graphProgressStages).toContain("completed_org_graph");
      expect(second.repos).toHaveLength(2);
      expect(secondChunkCount).toBe(firstChunkCount);

      const status = getOrgStatus(db, config, baseDir);
      expect(status.enabledRepoCount).toBe(2);
      expect(status.crossRepoEdgeCount).toBeGreaterThan(0);
      expect(status.apiContractCount).toBeGreaterThan(0);
      expect(status.apiConsumerCount).toBeGreaterThan(0);
      expect(status.graphLastStatus).toBe("success");
      expect(status.graphLastDurationMs).toBeGreaterThanOrEqual(0);
      expect(
        (
          db
            .prepare(
              `SELECT COUNT(*) AS count
               FROM org_api_contracts
               WHERE org = ? AND repo = ? AND file_path = ? AND contract = ?`,
            )
            .get("acme", "acme/backend-api", "src/api/user-access.ts", "/api/user-access") as {
            count: number;
          }
        ).count,
      ).toBe(1);

      const noGraph = await indexOrgRepos(db, config, { codeOnly: true, noGraph: true, baseDir });
      expect(noGraph.graph.skipped).toBe(true);
      const skippedStatus = getOrgStatus(db, config, baseDir);
      expect(skippedStatus.crossRepoEdgeCount).toBe(status.crossRepoEdgeCount);
      expect(skippedStatus.graphLastStatus).toBe("skipped");

      const rebuilt = rebuildOrgGraph(db, config, { baseDir });
      expect(rebuilt.apiConsumers.length).toBeGreaterThan(0);

      const consumers = findOrgApiConsumers(db, config, {
        repo: "acme/backend-api",
        files: ["src/api/user-access.ts"],
      });
      expect(consumers[0]?.consumerRepo).toBe("acme/frontend-app");

      const impact = checkOrgImpact(db, config, {
        repo: "acme/backend-api",
        files: ["src/api/user-access.ts"],
        strict: true,
      });
      expect(impact.markdown).toContain("# Anchor Cross-Repo Impact");
      expect(
        impact.metadata.anomalies.some((item) => item.category === "api_contract_change"),
      ).toBe(true);
      expect(impact.metadata.apiConsumers[0]?.consumerRepo).toBe("acme/frontend-app");

      const map = getOrgArchitectureMap(db, config, "mermaid");
      expect(map.markdown).toContain("graph LR");
      expect(map.markdown).not.toContain("```mermaid");
      expect(JSON.stringify(map.metadata)).toContain("acme/frontend-app");
    } finally {
      db.close();
    }
  });

  it("resumes org sync from graph work without refetching already-synced PRs", async () => {
    const root = tempDir();
    const baseDir = path.join(root, "orgs");
    const backendSource = createBackendRepo(root);
    let config = initOrgConfig("acme", baseDir);
    config = addOrgRepoConfig(
      "acme",
      "acme/backend-api",
      {
        alias: "backend-api",
        group: "backend",
        cloneUrl: backendSource,
        defaultBranch: "main",
      },
      baseDir,
    );

    const db = openOrgDatabase("acme", baseDir);
    try {
      await cloneOrgRepos({ config, db, baseDir });
      const pr: PullRequestRecord = {
        repo: "acme/backend-api",
        number: 42,
        html_url: "https://github.com/acme/backend-api/pull/42",
        title: "Keep user access route stable",
        body: "API contract: user access route must remain backward compatible.",
        user: { login: "alice" },
        labels: [{ name: "api" }],
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-02T00:00:00Z",
        merged_at: "2026-01-02T00:00:00Z",
        files: [
          {
            filename: "src/api/user-access.ts",
            patch: '@@ route @@\n+export const USER_ACCESS_ROUTE = "/api/user-access";',
            additions: 1,
            deletions: 0,
          },
        ],
        reviews: [],
        reviewComments: [],
        issueComments: [],
        commits: [],
      };
      let fetchCalls = 0;
      const firstLifecycle: string[] = [];
      await indexOrgRepos(db, config, {
        token: "test-token",
        command: "org sync",
        noGraph: true,
        baseDir,
        fetchPullRequests: async () => {
          fetchCalls += 1;
          return [pr];
        },
        onLifecycleProgress: (item) => firstLifecycle.push(item.stage),
      });
      expect(fetchCalls).toBe(1);
      expect(firstLifecycle).toContain("org_repo_started");
      expect(firstLifecycle).toContain("org_graph_skipped");

      const progress: string[] = [];
      const lifecycle: string[] = [];
      const resumed = await indexOrgRepos(db, config, {
        token: "test-token",
        command: "org sync",
        baseDir,
        fetchPullRequests: async () => {
          fetchCalls += 1;
          return [];
        },
        onFetchProgress: (item) => progress.push(item.stage),
        onLifecycleProgress: (item) => lifecycle.push(item.stage),
      });

      expect(fetchCalls).toBe(1);
      expect(resumed.repos[0]?.skippedHistory).toBe(true);
      expect(resumed.repos[0]?.skippedCode).toBe(true);
      expect(progress).toContain("skipped_pull_request_fetch");
      expect(lifecycle).toContain("org_repo_skipped_history");
      expect(lifecycle).toContain("org_repo_skipped_code");
      expect(lifecycle).toContain("org_repo_completed");
      expect(lifecycle).toContain("org_sync_completed");
      expect(resumed.graph.skipped).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("does not fail on repeated org incremental indexing when test awareness rows already exist", async () => {
    const root = tempDir();
    const baseDir = path.join(root, "orgs");
    const backendSource = createBackendRepo(root);
    let config = initOrgConfig("acme", baseDir);
    config = addOrgRepoConfig(
      "acme",
      "acme/backend-api",
      {
        alias: "backend-api",
        group: "backend",
        cloneUrl: backendSource,
        defaultBranch: "main",
      },
      baseDir,
    );

    const db = openOrgDatabase("acme", baseDir);
    try {
      await cloneOrgRepos({ config, db, baseDir });
      const first = await indexOrgRepos(db, config, {
        command: "org sync",
        codeOnly: true,
        noGraph: true,
        baseDir,
      });
      expect(first.repos[0]?.error).toBeUndefined();
      expect(first.repos[0]?.code?.testFilesIndexed).toBeGreaterThan(0);

      const backend = config.repos.find((item) => item.fullName === "acme/backend-api");
      expect(backend).toBeDefined();
      const localPath = orgRepoLocalPath("acme", backend!, baseDir);
      execFileSync("git", ["config", "user.email", "anchor@example.test"], {
        cwd: localPath,
        stdio: "ignore",
      });
      execFileSync("git", ["config", "user.name", "Anchor Test"], {
        cwd: localPath,
        stdio: "ignore",
      });
      writeFile(
        localPath,
        "src/api/user-access.ts",
        [
          'export const USER_ACCESS_ROUTE = "/api/user-access";',
          "export function getUserAccess() {",
          "  return { allowed: Math.random() >= -1 };",
          "}",
          ...Array.from({ length: 60 }, (_, index) => `export const hotfix${index} = ${index};`),
        ].join("\n"),
      );
      commitAll(localPath, "source-only change");

      const second = await indexOrgRepos(db, config, {
        command: "org sync",
        codeOnly: true,
        noGraph: true,
        baseDir,
      });
      expect(second.repos[0]?.error).toBeUndefined();
      expect(second.repos[0]?.code?.testFilesIndexed).toBeGreaterThan(0);
      expect(second.repos[0]?.code?.testLinksCreated).toBeGreaterThan(0);

      const duplicateTestFiles = db
        .prepare(
          `SELECT tf.path
           FROM test_files tf
           JOIN repositories r ON r.id = tf.repo_id
           WHERE r.full_name = ?
           GROUP BY tf.path
           HAVING COUNT(*) > 1`,
        )
        .all("acme/backend-api") as Array<{ path: string }>;
      const duplicateTestLinks = db
        .prepare(
          `SELECT tl.source_path, tl.test_path, tl.reason
           FROM test_links tl
           JOIN repositories r ON r.id = tl.repo_id
           WHERE r.full_name = ?
           GROUP BY tl.source_path, tl.test_path, tl.reason
           HAVING COUNT(*) > 1`,
        )
        .all("acme/backend-api") as Array<{
        source_path: string;
        test_path: string;
        reason: string;
      }>;

      expect(duplicateTestFiles).toEqual([]);
      expect(duplicateTestLinks).toEqual([]);
    } finally {
      db.close();
    }
  });
});
