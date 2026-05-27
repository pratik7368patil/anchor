import fs from "node:fs";
import type { AnchorDatabase } from "../db/database.js";
import { initializeSchema, openAnchorDatabase } from "../db/database.js";
import type { AnchorOrgConfig, CoverageGrade, OrgRepoCloneState, OrgStatus } from "../types.js";
import { orgDatabasePath, orgRepoLocalPath, orgRoot } from "./config.js";

type CountRow = { count: number };
type RepoStateRow = {
  org: string;
  repo: string;
  local_path: string;
  default_branch: string;
  current_commit?: string | null;
  last_pulled_at?: string | null;
  last_code_indexed_commit?: string | null;
  last_code_indexed_at?: string | null;
  last_pr_sync_at?: string | null;
  last_error?: string | null;
};
type OrgGraphStateRow = {
  org: string;
  last_built_at?: string | null;
  last_status?: "success" | "failed" | "skipped" | "unknown" | null;
  last_duration_ms?: number | null;
  edge_count?: number | null;
  api_contract_count?: number | null;
  api_consumer_count?: number | null;
  last_error?: string | null;
};

export function openOrgDatabase(org: string, baseDir?: string): AnchorDatabase {
  const root = orgRoot(org, baseDir);
  const db = openAnchorDatabase(root, orgDatabasePath(org, baseDir));
  initializeSchema(db);
  return db;
}

export function syncOrgConfigToDatabase(
  db: AnchorDatabase,
  config: AnchorOrgConfig,
  baseDir?: string,
): void {
  initializeSchema(db);
  const now = new Date().toISOString();
  const upsertRepo = db.prepare(
    `INSERT INTO org_repositories
     (org, full_name, alias, repo_group, clone_url, default_branch, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(org, full_name) DO UPDATE SET
       alias = excluded.alias,
       repo_group = excluded.repo_group,
       clone_url = excluded.clone_url,
       default_branch = excluded.default_branch,
       enabled = excluded.enabled,
       updated_at = excluded.updated_at`,
  );
  const upsertState = db.prepare(
    `INSERT INTO org_repo_state
     (org, repo, local_path, default_branch, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(org, repo) DO UPDATE SET
       local_path = excluded.local_path,
       default_branch = excluded.default_branch,
       updated_at = excluded.updated_at`,
  );
  const transaction = db.transaction(() => {
    for (const repo of config.repos) {
      upsertRepo.run(
        config.org,
        repo.fullName,
        repo.alias,
        repo.group,
        repo.cloneUrl,
        repo.defaultBranch,
        repo.enabled ? 1 : 0,
        now,
        now,
      );
      upsertState.run(
        config.org,
        repo.fullName,
        orgRepoLocalPath(config.org, repo, baseDir),
        repo.defaultBranch,
        now,
      );
    }
  });
  transaction();
}

export function updateOrgRepoState(db: AnchorDatabase, state: OrgRepoCloneState): void {
  initializeSchema(db);
  db.prepare(
    `INSERT INTO org_repo_state
     (org, repo, local_path, default_branch, current_commit, last_pulled_at,
      last_code_indexed_commit, last_code_indexed_at, last_pr_sync_at, last_error, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(org, repo) DO UPDATE SET
       local_path = excluded.local_path,
       default_branch = excluded.default_branch,
       current_commit = COALESCE(excluded.current_commit, org_repo_state.current_commit),
       last_pulled_at = COALESCE(excluded.last_pulled_at, org_repo_state.last_pulled_at),
       last_code_indexed_commit = COALESCE(excluded.last_code_indexed_commit, org_repo_state.last_code_indexed_commit),
       last_code_indexed_at = COALESCE(excluded.last_code_indexed_at, org_repo_state.last_code_indexed_at),
       last_pr_sync_at = COALESCE(excluded.last_pr_sync_at, org_repo_state.last_pr_sync_at),
       last_error = excluded.last_error,
       updated_at = excluded.updated_at`,
  ).run(
    state.org,
    state.repo,
    state.localPath,
    state.defaultBranch,
    state.currentCommit ?? null,
    state.lastPulledAt ?? null,
    state.lastCodeIndexedCommit ?? null,
    state.lastCodeIndexedAt ?? null,
    state.lastPrSyncAt ?? null,
    state.lastError ?? null,
    new Date().toISOString(),
  );
}

export function getOrgRepoState(
  db: AnchorDatabase,
  org: string,
  repo: string,
): OrgRepoCloneState | undefined {
  initializeSchema(db);
  const row = db
    .prepare("SELECT * FROM org_repo_state WHERE org = ? AND repo = ?")
    .get(org, repo) as RepoStateRow | undefined;
  if (!row) return undefined;
  return {
    org: row.org,
    repo: row.repo,
    localPath: row.local_path,
    defaultBranch: row.default_branch,
    currentCommit: row.current_commit ?? undefined,
    lastPulledAt: row.last_pulled_at ?? undefined,
    lastCodeIndexedCommit: row.last_code_indexed_commit ?? undefined,
    lastCodeIndexedAt: row.last_code_indexed_at ?? undefined,
    lastPrSyncAt: row.last_pr_sync_at ?? undefined,
    lastError: row.last_error ?? undefined,
  };
}

export function recordOrgIndexRun(
  db: AnchorDatabase,
  input: {
    org: string;
    repo?: string;
    command: string;
    startedAt: string;
    finishedAt?: string;
    status: "success" | "failed" | "partial";
    prsIndexed?: number;
    codeFilesIndexed?: number;
    failures?: string[];
  },
): void {
  initializeSchema(db);
  db.prepare(
    `INSERT INTO org_index_runs
     (org, repo, command, started_at, finished_at, status, prs_indexed, code_files_indexed, failures_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.org,
    input.repo ?? null,
    input.command,
    input.startedAt,
    input.finishedAt ?? null,
    input.status,
    input.prsIndexed ?? 0,
    input.codeFilesIndexed ?? 0,
    JSON.stringify(input.failures ?? []),
  );
}

export function recordOrgGraphState(
  db: AnchorDatabase,
  input: {
    org: string;
    status: "success" | "failed" | "skipped" | "unknown";
    builtAt?: string;
    durationMs?: number;
    edgeCount?: number;
    apiContractCount?: number;
    apiConsumerCount?: number;
    error?: string;
  },
): void {
  initializeSchema(db);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO org_graph_state
     (org, last_built_at, last_status, last_duration_ms, edge_count, api_contract_count,
      api_consumer_count, last_error, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(org) DO UPDATE SET
       last_built_at = COALESCE(excluded.last_built_at, org_graph_state.last_built_at),
       last_status = excluded.last_status,
       last_duration_ms = COALESCE(excluded.last_duration_ms, org_graph_state.last_duration_ms),
       edge_count = excluded.edge_count,
       api_contract_count = excluded.api_contract_count,
       api_consumer_count = excluded.api_consumer_count,
       last_error = excluded.last_error,
       updated_at = excluded.updated_at`,
  ).run(
    input.org,
    input.builtAt ?? null,
    input.status,
    input.durationMs ?? null,
    input.edgeCount ?? 0,
    input.apiContractCount ?? 0,
    input.apiConsumerCount ?? 0,
    input.error ?? null,
    now,
  );
}

function count(db: AnchorDatabase, table: string, where = "", params: unknown[] = []): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`)
    .get(...params) as CountRow;
  return row.count;
}

export function getOrgGraphCounts(
  db: AnchorDatabase,
  org: string,
): { edges: number; apiContracts: number; apiConsumers: number } {
  initializeSchema(db);
  return {
    edges: count(db, "org_cross_repo_edges", "WHERE org = ?", [org]),
    apiContracts: count(db, "org_api_contracts", "WHERE org = ?", [org]),
    apiConsumers: count(db, "org_api_consumers", "WHERE org = ?", [org]),
  };
}

function grade(score: number): CoverageGrade {
  if (score <= 0) return "empty";
  if (score < 35) return "poor";
  if (score < 60) return "fair";
  if (score < 80) return "good";
  return "excellent";
}

export function getOrgStatus(
  db: AnchorDatabase,
  config: AnchorOrgConfig,
  baseDir?: string,
): OrgStatus {
  initializeSchema(db);
  syncOrgConfigToDatabase(db, config, baseDir);
  const enabledRepos = config.repos.filter((repo) => repo.enabled);
  const states = new Map(
    (
      db.prepare("SELECT * FROM org_repo_state WHERE org = ?").all(config.org) as RepoStateRow[]
    ).map((row) => [row.repo, row]),
  );
  const clonedRepoCount = enabledRepos.filter((repo) =>
    fs.existsSync(orgRepoLocalPath(config.org, repo, baseDir)),
  ).length;
  const codeFileCount = count(db, "code_files");
  const codeChunkCount = count(db, "code_chunks");
  const wisdomUnitCount = count(db, "wisdom_units");
  const crossRepoEdgeCount = count(db, "org_cross_repo_edges", "WHERE org = ?", [config.org]);
  const apiContractCount = count(db, "org_api_contracts", "WHERE org = ?", [config.org]);
  const apiConsumerCount = count(db, "org_api_consumers", "WHERE org = ?", [config.org]);
  const anomalyCount = count(db, "org_anomaly_events", "WHERE org = ?", [config.org]);
  const graphState = db.prepare("SELECT * FROM org_graph_state WHERE org = ?").get(config.org) as
    | OrgGraphStateRow
    | undefined;
  let score = 0;
  const reasons: string[] = [];
  if (enabledRepos.length > 0) {
    score += 15;
    reasons.push(`${enabledRepos.length} repo(s) allowlisted`);
  }
  if (clonedRepoCount === enabledRepos.length && enabledRepos.length > 0) score += 15;
  else if (clonedRepoCount > 0) score += 8;
  if (codeChunkCount > 0) {
    score += 20;
    reasons.push(`${codeChunkCount} code chunk(s) indexed`);
  }
  if (wisdomUnitCount > 0) {
    score += 20;
    reasons.push(`${wisdomUnitCount} PR wisdom unit(s) indexed`);
  }
  if (crossRepoEdgeCount > 0) {
    score += 15;
    reasons.push(`${crossRepoEdgeCount} cross-repo edge(s) detected`);
  }
  if (apiConsumerCount > 0) {
    score += 10;
    reasons.push(`${apiConsumerCount} API consumer relationship(s) detected`);
  }
  if (anomalyCount > 0) score += 5;
  score = Math.min(100, score);
  if (reasons.length === 0) reasons.push("No org repos have been indexed yet");

  return {
    org: config.org,
    root: orgRoot(config.org, baseDir),
    databasePath: orgDatabasePath(config.org, baseDir),
    repoCount: config.repos.length,
    enabledRepoCount: enabledRepos.length,
    clonedRepoCount,
    codeFileCount,
    codeChunkCount,
    wisdomUnitCount,
    crossRepoEdgeCount,
    apiContractCount,
    apiConsumerCount,
    anomalyCount,
    graphLastBuiltAt: graphState?.last_built_at ?? undefined,
    graphLastStatus: graphState?.last_status ?? undefined,
    graphLastDurationMs: graphState?.last_duration_ms ?? undefined,
    graphLastError: graphState?.last_error ?? undefined,
    coverageScore: score,
    coverageGrade: grade(score),
    coverageReasons: reasons,
    repos: config.repos.map((repo) => {
      const state = states.get(repo.fullName);
      const localPath = orgRepoLocalPath(config.org, repo, baseDir);
      return {
        ...repo,
        localPath,
        cloned: fs.existsSync(localPath),
        currentCommit: state?.current_commit ?? undefined,
        lastPulledAt: state?.last_pulled_at ?? undefined,
        lastCodeIndexedAt: state?.last_code_indexed_at ?? undefined,
        lastPrSyncAt: state?.last_pr_sync_at ?? undefined,
        lastError: state?.last_error ?? undefined,
      };
    }),
  };
}
