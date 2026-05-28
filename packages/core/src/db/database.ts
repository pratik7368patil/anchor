import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { SCHEMA_SQL } from "./migrations.js";
import type {
  ArchitectureIndexData,
  CodeChunk,
  CodeFileRecord,
  CodeImport,
  CodeIndexProgress,
  CodeIndexSummary,
  IndexRunRecord,
  IndexStatus,
  GitHubGraphQLFetchCheckpoint,
  PullRequestRecord,
  RegressionEvent,
  SourceType,
  WisdomCategory,
  TestFileRecord,
  TestLink,
  WisdomUnit,
} from "../types.js";
import { redactedHistoricalText, sanitizeHistoricalText } from "../security/sanitize.js";
import { resolveGitHubToken } from "../utils/github-token.js";
import { countValidTeamRules } from "../rules/team-rules.js";
import { inferTestAwareness, isTestFilePath } from "../indexer/test-awareness.js";
import { calculateCoverage } from "../engagement/coverage.js";

export type AnchorDatabase = Database.Database;

type CountRow = { count: number };
type RepoRow = { id: number; full_name: string };
type PrRow = { id: number };
type CodeFileRow = { id: number; path: string };
type RowIdRow = { rowid: number };
type CodeFileStateRow = {
  path: string;
  language?: string | null;
  size_bytes: number;
  content_hash: string;
  updated_at: string;
};
type CodeChunkStateRow = {
  id: string;
  file_path: string;
  language?: string | null;
  start_line: number;
  end_line: number;
  sanitized_text: string;
  symbols_json: string;
  content_hash: string;
  updated_at: string;
};
type CodeImportRow = {
  source_path: string;
  specifier: string;
  imported_path?: string | null;
  imported_symbols_json: string;
  kind: "static" | "dynamic" | "require";
};
type SyncRow = {
  last_sync_at?: string | null;
  history_coverage?: "limited" | "all" | "unknown" | null;
  history_limit?: number | null;
  graphql_cursor?: string | null;
  graphql_cursor_scope?: string | null;
  graphql_cursor_scanned_prs?: number | null;
  graphql_cursor_matched_prs?: number | null;
  graphql_cursor_page_size?: number | null;
  graphql_cursor_reset_at?: string | null;
  graphql_cursor_reason?: string | null;
  graphql_cursor_updated_at?: string | null;
};
type CodeIndexStateRow = {
  repo?: string | null;
  last_indexed_at?: string | null;
  indexed_files?: number | null;
  code_chunks?: number | null;
  skipped_files?: number | null;
  last_indexed_commit?: string | null;
};
type ArchitectureIndexStateRow = { last_indexed_at?: string | null };
type WisdomFilePathsRow = { file_paths_json: string };
type LastRunRow = { finished_at?: string | null; failures_json?: string | null };
const CODE_WRITE_PROGRESS_INTERVAL = 150;
const FTS_DELETE_BATCH_SIZE = 500;

type CodeIndexWriteOptions = {
  onProgress?: (progress: CodeIndexProgress) => void;
  deletedPaths?: string[];
  changedImports?: CodeImport[];
  currentCommit?: string;
  testAwareness?: { testFiles: TestFileRecord[]; testLinks: TestLink[] };
};

export type RepoCodeIndexState = {
  repo: string;
  lastIndexedAt?: string;
  indexedFiles: number;
  codeChunks: number;
  skippedFiles: number;
  lastIndexedCommit?: string;
};

function shouldEmitCodeWriteProgress(current: number, total: number): boolean {
  return current === 0 || current === 1 || current === total || current % CODE_WRITE_PROGRESS_INTERVAL === 0;
}

function shouldEmitFtsDeleteProgress(current: number, total: number): boolean {
  return current === 0 || current === 1 || current === total || current % FTS_DELETE_BATCH_SIZE === 0;
}

function deleteFtsRowsByRowId(
  db: AnchorDatabase,
  ftsTable: "wisdom_units_fts" | "code_chunks_fts" | "architecture_patterns_fts",
  rowIds: number[],
  onProgress?: (current: number, total: number) => void,
): void {
  if (rowIds.length === 0) {
    onProgress?.(0, 0);
    return;
  }
  const deleteRow = db.prepare(`DELETE FROM ${ftsTable} WHERE rowid = ?`);
  onProgress?.(0, rowIds.length);
  for (const [index, rowId] of rowIds.entries()) {
    deleteRow.run(rowId);
    const current = index + 1;
    if (shouldEmitFtsDeleteProgress(current, rowIds.length)) {
      onProgress?.(current, rowIds.length);
    }
  }
}

export function defaultDatabasePath(cwd: string): string {
  return path.join(cwd, ".anchor", "index.sqlite");
}

export function openAnchorDatabase(
  cwd: string,
  databasePath = defaultDatabasePath(cwd),
): AnchorDatabase {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  db.pragma("busy_timeout = 5000");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  applyPerformancePragmas(db);
  return db;
}

export function openAnchorDatabaseReadOnly(databasePath: string): AnchorDatabase {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  applyPerformancePragmas(db);
  return db;
}

// Throughput tuning shared by both openers. synchronous=NORMAL is safe under WAL
// for a local, rebuildable index; cache_size is in KiB (negative), mmap_size in bytes.
function applyPerformancePragmas(db: AnchorDatabase): void {
  db.pragma("synchronous = NORMAL");
  db.pragma("cache_size = -65536");
  db.pragma("mmap_size = 268435456");
  db.pragma("temp_store = MEMORY");
}

export function runDatabaseMaintenance(db: AnchorDatabase): void {
  try {
    db.exec("ANALYZE");
    db.pragma("optimize");
    db.pragma("wal_checkpoint(TRUNCATE)");
  } catch {
    // Best effort maintenance only.
  }
}

export function initializeSchema(db: AnchorDatabase): void {
  db.exec(SCHEMA_SQL);
  ensureColumn(db, "sync_state", "history_coverage", "TEXT");
  ensureColumn(db, "sync_state", "history_limit", "INTEGER");
  ensureColumn(db, "sync_state", "history_since", "TEXT");
  ensureColumn(db, "sync_state", "graphql_cursor", "TEXT");
  ensureColumn(db, "sync_state", "graphql_cursor_scope", "TEXT");
  ensureColumn(db, "sync_state", "graphql_cursor_scanned_prs", "INTEGER");
  ensureColumn(db, "sync_state", "graphql_cursor_matched_prs", "INTEGER");
  ensureColumn(db, "sync_state", "graphql_cursor_page_size", "INTEGER");
  ensureColumn(db, "sync_state", "graphql_cursor_reset_at", "TEXT");
  ensureColumn(db, "sync_state", "graphql_cursor_reason", "TEXT");
  ensureColumn(db, "sync_state", "graphql_cursor_updated_at", "TEXT");
  ensureColumn(db, "code_index_state", "last_indexed_commit", "TEXT");
}

function ensureColumn(
  db: AnchorDatabase,
  tableName: string,
  columnName: string,
  definition: string,
): void {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

export function checkSchema(db: AnchorDatabase): boolean {
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual') AND name = ?")
      .all("wisdom_units_fts");
    const codeTables = db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual') AND name = ?")
      .all("code_chunks_fts");
    const wisdom = db.prepare("SELECT name FROM sqlite_master WHERE name = ?").all("wisdom_units");
    const code = db.prepare("SELECT name FROM sqlite_master WHERE name = ?").all("code_chunks");
    const tests = db.prepare("SELECT name FROM sqlite_master WHERE name = ?").all("test_files");
    const regressions = db
      .prepare("SELECT name FROM sqlite_master WHERE name = ?")
      .all("regression_events");
    const architecture = db
      .prepare("SELECT name FROM sqlite_master WHERE name = ?")
      .all("architecture_patterns");
    const architectureFts = db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual') AND name = ?")
      .all("architecture_patterns_fts");
    const developerValueTables = [
      "architecture_map_edges",
      "test_commands",
      "retrieval_evals",
      "feedback_events",
      "playbooks",
      "watch_state",
      "org_repositories",
      "org_repo_state",
      "org_cross_repo_edges",
      "org_api_consumers",
      "org_anomaly_events",
      "org_graph_state",
    ].every(
      (tableName) =>
        db.prepare("SELECT name FROM sqlite_master WHERE name = ?").all(tableName).length > 0,
    );
    return (
      tables.length > 0 &&
      wisdom.length > 0 &&
      codeTables.length > 0 &&
      code.length > 0 &&
      tests.length > 0 &&
      regressions.length > 0 &&
      architecture.length > 0 &&
      architectureFts.length > 0 &&
      developerValueTables
    );
  } catch {
    return false;
  }
}

export function ensureRepository(db: AnchorDatabase, fullName: string): number {
  const [owner, name] = fullName.split("/");
  db.prepare(
    `INSERT INTO repositories (full_name, owner, name, url)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(full_name) DO UPDATE SET owner = excluded.owner, name = excluded.name, url = excluded.url`,
  ).run(fullName, owner ?? "", name ?? "", `https://github.com/${fullName}`);
  const row = db
    .prepare("SELECT id, full_name FROM repositories WHERE full_name = ?")
    .get(fullName) as RepoRow | undefined;
  if (!row) throw new Error(`Failed to create repository row for ${fullName}`);
  return row.id;
}

function getRepositoryId(db: AnchorDatabase, fullName: string): number | undefined {
  const row = db
    .prepare("SELECT id FROM repositories WHERE full_name = ?")
    .get(fullName) as { id: number } | undefined;
  return row?.id;
}

export function getLastSyncTime(db: AnchorDatabase, repo: string): string | undefined {
  const row = db.prepare("SELECT last_sync_at FROM sync_state WHERE repo = ?").get(repo) as
    | SyncRow
    | undefined;
  return row?.last_sync_at ?? undefined;
}

export function getCodeIndexStateForRepo(
  db: AnchorDatabase,
  repo: string,
): RepoCodeIndexState | undefined {
  initializeSchema(db);
  const row = db
    .prepare(
      `SELECT repo, last_indexed_at, indexed_files, code_chunks, skipped_files, last_indexed_commit
       FROM code_index_state
       WHERE repo = ?`,
    )
    .get(repo) as CodeIndexStateRow | undefined;
  if (!row?.repo) return undefined;
  return {
    repo: row.repo,
    lastIndexedAt: row.last_indexed_at ?? undefined,
    indexedFiles: row.indexed_files ?? 0,
    codeChunks: row.code_chunks ?? 0,
    skippedFiles: row.skipped_files ?? 0,
    lastIndexedCommit: row.last_indexed_commit ?? undefined,
  };
}

export function getRepoCodeFileHashes(
  db: AnchorDatabase,
  repo: string,
): Map<string, string> {
  initializeSchema(db);
  const repoId = getRepositoryId(db, repo);
  if (!repoId) return new Map();
  const rows = db
    .prepare("SELECT path, content_hash FROM code_files WHERE repo_id = ?")
    .all(repoId) as Array<{ path: string; content_hash: string }>;
  return new Map(rows.map((row) => [row.path, row.content_hash]));
}

export function getRepoCodeFiles(db: AnchorDatabase, repo: string): CodeFileRecord[] {
  initializeSchema(db);
  const repoId = getRepositoryId(db, repo);
  if (!repoId) return [];
  const rows = db
    .prepare(
      `SELECT path, language, size_bytes, content_hash, updated_at
       FROM code_files
       WHERE repo_id = ?`,
    )
    .all(repoId) as CodeFileStateRow[];
  return rows.map((row) => ({
    repo,
    path: row.path,
    language: row.language ?? undefined,
    sizeBytes: row.size_bytes,
    contentHash: row.content_hash,
    updatedAt: row.updated_at,
  }));
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function getRepoCodeChunkSymbols(db: AnchorDatabase, repo: string): CodeChunk[] {
  initializeSchema(db);
  const repoId = getRepositoryId(db, repo);
  if (!repoId) return [];
  const rows = db
    .prepare(
      `SELECT id, file_path, language, start_line, end_line, symbols_json, content_hash, updated_at
       FROM code_chunks
       WHERE repo_id = ?`,
    )
    .all(repoId) as Array<
    Omit<CodeChunkStateRow, "sanitized_text"> & { symbols_json: string }
  >;
  return rows.map((row) => ({
    id: row.id,
    repo,
    filePath: row.file_path,
    language: row.language ?? undefined,
    startLine: row.start_line,
    endLine: row.end_line,
    sanitizedText: "",
    symbols: parseJsonArray(row.symbols_json),
    contentHash: row.content_hash,
    updatedAt: row.updated_at,
  }));
}

export function getRepoTestChunks(db: AnchorDatabase, repo: string): CodeChunk[] {
  initializeSchema(db);
  const repoId = getRepositoryId(db, repo);
  if (!repoId) return [];
  const rows = db
    .prepare(
      `SELECT id, file_path, language, start_line, end_line, sanitized_text, symbols_json, content_hash, updated_at
       FROM code_chunks
       WHERE repo_id = ? AND file_path IN (
         SELECT path FROM test_files WHERE repo_id = ?
       )`,
    )
    .all(repoId, repoId) as CodeChunkStateRow[];
  return rows.map((row) => ({
    id: row.id,
    repo,
    filePath: row.file_path,
    language: row.language ?? undefined,
    startLine: row.start_line,
    endLine: row.end_line,
    sanitizedText: row.sanitized_text,
    symbols: parseJsonArray(row.symbols_json),
    contentHash: row.content_hash,
    updatedAt: row.updated_at,
  }));
}

export function getRepoCodeImports(db: AnchorDatabase, repo: string): CodeImport[] {
  initializeSchema(db);
  const repoId = getRepositoryId(db, repo);
  if (!repoId) return [];
  const rows = db
    .prepare(
      `SELECT source_path, specifier, imported_path, imported_symbols_json, kind
       FROM code_imports
       WHERE repo_id = ?`,
    )
    .all(repoId) as CodeImportRow[];
  return rows.map((row) => ({
    repo,
    sourcePath: row.source_path,
    specifier: row.specifier,
    importedPath: row.imported_path ?? undefined,
    importedSymbols: parseJsonArray(row.imported_symbols_json),
    kind: row.kind,
  }));
}

export function getRepoCodeCounts(
  db: AnchorDatabase,
  repo: string,
): { files: number; chunks: number } {
  initializeSchema(db);
  const repoId = getRepositoryId(db, repo);
  if (!repoId) return { files: 0, chunks: 0 };
  const files = (
    db.prepare("SELECT COUNT(*) AS count FROM code_files WHERE repo_id = ?").get(repoId) as CountRow
  ).count;
  const chunks = (
    db.prepare("SELECT COUNT(*) AS count FROM code_chunks WHERE repo_id = ?").get(repoId) as CountRow
  ).count;
  return { files, chunks };
}

export function touchCodeIndexState(
  db: AnchorDatabase,
  repo: string,
  skippedFiles: number,
  currentCommit?: string,
): { files: number; chunks: number } {
  initializeSchema(db);
  const counts = getRepoCodeCounts(db, repo);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO code_index_state
     (repo, last_indexed_at, indexed_files, code_chunks, skipped_files, last_indexed_commit)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(repo) DO UPDATE SET
       last_indexed_at = excluded.last_indexed_at,
       indexed_files = excluded.indexed_files,
       code_chunks = excluded.code_chunks,
       skipped_files = excluded.skipped_files,
       last_indexed_commit = excluded.last_indexed_commit`,
  ).run(repo, now, counts.files, counts.chunks, skippedFiles, currentCommit ?? null);
  return counts;
}

export function updateSyncState(
  db: AnchorDatabase,
  repo: string,
  lastIndexedPr?: number,
  metadata: {
    historyCoverage?: "limited" | "all" | "unknown";
    historyLimit?: number;
    historySince?: string;
  } = {},
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO sync_state
     (repo, last_sync_at, last_indexed_pr, history_coverage, history_limit, history_since, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(repo) DO UPDATE SET
       last_sync_at = excluded.last_sync_at,
       last_indexed_pr = excluded.last_indexed_pr,
       history_coverage = excluded.history_coverage,
       history_limit = excluded.history_limit,
       history_since = excluded.history_since,
       updated_at = excluded.updated_at`,
  ).run(
    repo,
    now,
    lastIndexedPr ?? null,
    metadata.historyCoverage ?? "unknown",
    metadata.historyLimit ?? null,
    metadata.historySince ?? null,
    now,
  );
}

export function graphQLFetchCheckpointScope(input: {
  repo: string;
  all?: boolean;
  limit?: number;
  since?: string;
}): string {
  const historyScope = input.all ? "all" : `limit:${input.limit ?? 200}`;
  return `${input.repo}|${historyScope}|since:${input.since ?? ""}`;
}

export function getGraphQLFetchCheckpoint(
  db: AnchorDatabase,
  repo: string,
  scope: string,
): GitHubGraphQLFetchCheckpoint | undefined {
  initializeSchema(db);
  const row = db
    .prepare(
      `SELECT graphql_cursor, graphql_cursor_scope, graphql_cursor_scanned_prs,
              graphql_cursor_matched_prs, graphql_cursor_page_size, graphql_cursor_reset_at,
              graphql_cursor_reason, graphql_cursor_updated_at
       FROM sync_state
       WHERE repo = ?`,
    )
    .get(repo) as SyncRow | undefined;
  if (!row?.graphql_cursor_scope || row.graphql_cursor_scope !== scope) return undefined;
  return {
    repo,
    scope,
    cursor: row.graphql_cursor ?? null,
    scannedPullRequests: row.graphql_cursor_scanned_prs ?? 0,
    matchedMergedPullRequests: row.graphql_cursor_matched_prs ?? 0,
    pageSize: row.graphql_cursor_page_size ?? 50,
    resetAt: row.graphql_cursor_reset_at ?? undefined,
    reason: row.graphql_cursor_reason ?? "GraphQL budget checkpoint",
    updatedAt: row.graphql_cursor_updated_at ?? new Date(0).toISOString(),
  };
}

export function saveGraphQLFetchCheckpoint(
  db: AnchorDatabase,
  checkpoint: GitHubGraphQLFetchCheckpoint,
): void {
  initializeSchema(db);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO sync_state
     (repo, last_sync_at, last_indexed_pr, history_coverage, history_limit, history_since,
      graphql_cursor, graphql_cursor_scope, graphql_cursor_scanned_prs,
      graphql_cursor_matched_prs, graphql_cursor_page_size, graphql_cursor_reset_at,
      graphql_cursor_reason, graphql_cursor_updated_at, updated_at)
     VALUES (?, NULL, NULL, 'unknown', NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(repo) DO UPDATE SET
       graphql_cursor = excluded.graphql_cursor,
       graphql_cursor_scope = excluded.graphql_cursor_scope,
       graphql_cursor_scanned_prs = excluded.graphql_cursor_scanned_prs,
       graphql_cursor_matched_prs = excluded.graphql_cursor_matched_prs,
       graphql_cursor_page_size = excluded.graphql_cursor_page_size,
       graphql_cursor_reset_at = excluded.graphql_cursor_reset_at,
       graphql_cursor_reason = excluded.graphql_cursor_reason,
       graphql_cursor_updated_at = excluded.graphql_cursor_updated_at,
       updated_at = excluded.updated_at`,
  ).run(
    checkpoint.repo,
    checkpoint.cursor ?? null,
    checkpoint.scope,
    checkpoint.scannedPullRequests,
    checkpoint.matchedMergedPullRequests,
    checkpoint.pageSize,
    checkpoint.resetAt ?? null,
    checkpoint.reason,
    checkpoint.updatedAt,
    now,
  );
}

export function clearGraphQLFetchCheckpoint(
  db: AnchorDatabase,
  repo: string,
  scope?: string,
): void {
  initializeSchema(db);
  const row = db.prepare("SELECT graphql_cursor_scope FROM sync_state WHERE repo = ?").get(repo) as
    | SyncRow
    | undefined;
  if (scope && row?.graphql_cursor_scope && row.graphql_cursor_scope !== scope) return;
  db.prepare(
    `UPDATE sync_state SET
       graphql_cursor = NULL,
       graphql_cursor_scope = NULL,
       graphql_cursor_scanned_prs = NULL,
       graphql_cursor_matched_prs = NULL,
       graphql_cursor_page_size = NULL,
       graphql_cursor_reset_at = NULL,
       graphql_cursor_reason = NULL,
       graphql_cursor_updated_at = NULL,
       updated_at = ?
     WHERE repo = ?`,
  ).run(new Date().toISOString(), repo);
}

function deleteExistingPrData(db: AnchorDatabase, prId: number): void {
  const wisdomRowIds = db
    .prepare("SELECT rowid FROM wisdom_units WHERE pr_id = ?")
    .all(prId) as RowIdRow[];
  deleteFtsRowsByRowId(
    db,
    "wisdom_units_fts",
    wisdomRowIds.map((row) => row.rowid),
  );
  db.prepare("DELETE FROM regression_events WHERE pr_id = ?").run(prId);
  db.prepare("DELETE FROM wisdom_units WHERE pr_id = ?").run(prId);
  db.prepare("DELETE FROM pr_comments WHERE pr_id = ?").run(prId);
  db.prepare("DELETE FROM pr_files WHERE pr_id = ?").run(prId);
}

export function upsertPullRequest(
  db: AnchorDatabase,
  pr: PullRequestRecord,
  wisdomUnits: WisdomUnit[],
  regressionEvents: RegressionEvent[] = [],
): { files: number; comments: number; wisdom: number; regressions: number } {
  const repoId = ensureRepository(db, pr.repo);
  const author = pr.user?.login ?? "unknown";
  const labels = (pr.labels ?? [])
    .map((label) => (typeof label === "string" ? label : label.name))
    .filter(Boolean);
  const titleText = redactedHistoricalText(pr.title);
  const bodyText = redactedHistoricalText(pr.body ?? "");
  const bodySanitized = sanitizeHistoricalText(pr.body ?? "");

  const transaction = db.transaction(() => {
    db.prepare(
      `INSERT INTO pull_requests
       (repo_id, number, url, title, body_text, body_sanitized, author, labels_json, created_at, merged_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(repo_id, number) DO UPDATE SET
         url = excluded.url,
         title = excluded.title,
         body_text = excluded.body_text,
         body_sanitized = excluded.body_sanitized,
         author = excluded.author,
         labels_json = excluded.labels_json,
         created_at = excluded.created_at,
         merged_at = excluded.merged_at,
         updated_at = excluded.updated_at`,
    ).run(
      repoId,
      pr.number,
      pr.html_url,
      titleText,
      bodyText,
      bodySanitized,
      author,
      JSON.stringify(labels),
      pr.created_at,
      pr.merged_at ?? null,
      pr.updated_at ?? null,
    );

    const prRow = db
      .prepare("SELECT id FROM pull_requests WHERE repo_id = ? AND number = ?")
      .get(repoId, pr.number) as PrRow | undefined;
    if (!prRow) throw new Error(`Failed to upsert PR #${pr.number}`);

    deleteExistingPrData(db, prRow.id);

    const insertFile = db.prepare(
      "INSERT INTO pr_files (pr_id, path, additions, deletions, patch_sanitized) VALUES (?, ?, ?, ?, ?)",
    );
    for (const file of pr.files) {
      insertFile.run(
        prRow.id,
        file.filename,
        file.additions ?? 0,
        file.deletions ?? 0,
        file.patch ? sanitizeHistoricalText(file.patch) : null,
      );
    }
    insertPrCochangeTestLinks(
      db,
      repoId,
      pr.files.map((file) => file.filename),
    );

    const insertComment = db.prepare(
      `INSERT INTO pr_comments
       (pr_id, source_type, author, body_text, sanitized_text, file_path, created_at, is_reviewer)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const comments: Array<{
      sourceType: SourceType;
      author: string;
      body: string;
      path?: string | null;
      createdAt?: string | null;
      reviewer: boolean;
    }> = [
      ...(pr.reviews ?? []).map((comment) => ({
        sourceType: "review_summary" as const,
        author: comment.user?.login ?? "unknown",
        body: comment.body ?? "",
        path: undefined,
        createdAt: comment.submitted_at ?? comment.created_at,
        reviewer: true,
      })),
      ...(pr.reviewComments ?? []).map((comment) => ({
        sourceType: "review_comment" as const,
        author: comment.user?.login ?? "unknown",
        body: comment.body ?? "",
        path: comment.path,
        createdAt: comment.created_at,
        reviewer: true,
      })),
      ...(pr.issueComments ?? []).map((comment) => ({
        sourceType: "issue_comment" as const,
        author: comment.user?.login ?? "unknown",
        body: comment.body ?? "",
        path: undefined,
        createdAt: comment.created_at,
        reviewer: false,
      })),
    ];

    for (const comment of comments.filter((comment) => comment.body.trim())) {
      insertComment.run(
        prRow.id,
        comment.sourceType,
        comment.author,
        redactedHistoricalText(comment.body),
        sanitizeHistoricalText(comment.body),
        comment.path ?? null,
        comment.createdAt ?? null,
        comment.reviewer ? 1 : 0,
      );
    }

    const insertWisdom = db.prepare(
      `INSERT INTO wisdom_units
       (id, repo_id, pr_id, repo, pr_number, pr_url, source_type, category, text, sanitized_text,
        file_paths_json, symbols_json, authors_json, created_at, merged_at, confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertFts = db.prepare(
      `INSERT INTO wisdom_units_fts
       (rowid, unitId, sanitizedText, filePaths, symbols, prTitle, prBody, category)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const unit of wisdomUnits) {
      const wisdomInsert = insertWisdom.run(
        unit.id,
        repoId,
        prRow.id,
        unit.repo,
        unit.prNumber,
        unit.prUrl,
        unit.sourceType,
        unit.category,
        unit.text,
        unit.sanitizedText,
        JSON.stringify(unit.filePaths),
        JSON.stringify(unit.symbols),
        JSON.stringify(unit.authors),
        unit.createdAt,
        unit.mergedAt ?? null,
        unit.confidence,
      );
      insertFts.run(
        Number(wisdomInsert.lastInsertRowid),
        unit.id,
        unit.sanitizedText,
        unit.filePaths.join(" "),
        unit.symbols.join(" "),
        titleText,
        bodySanitized,
        unit.category,
      );
    }

    const insertRegression = db.prepare(
      `INSERT INTO regression_events
       (id, repo_id, pr_id, repo, pr_number, pr_url, summary_sanitized, file_paths_json,
        symbols_json, test_paths_json, authors_json, labels_json, signals_json, created_at,
        merged_at, confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const event of regressionEvents) {
      insertRegression.run(
        event.id,
        repoId,
        prRow.id,
        event.repo,
        event.prNumber,
        event.prUrl,
        event.summary,
        JSON.stringify(event.filePaths),
        JSON.stringify(event.symbols),
        JSON.stringify(event.testPaths),
        JSON.stringify(event.authors),
        JSON.stringify(event.labels),
        JSON.stringify(event.signals),
        event.createdAt,
        event.mergedAt ?? null,
        event.confidence,
      );
    }
  });

  transaction();

  const comments =
    (pr.reviews?.length ?? 0) + (pr.reviewComments?.length ?? 0) + (pr.issueComments?.length ?? 0);
  return {
    files: pr.files.length,
    comments,
    wisdom: wisdomUnits.length,
    regressions: regressionEvents.length,
  };
}

export function replaceCodeIndex(
  db: AnchorDatabase,
  repo: string,
  codeFiles: CodeFileRecord[],
  codeChunks: CodeChunk[],
  skippedFiles: number,
  cwd: string,
  architecture: ArchitectureIndexData = { components: [], patterns: [], imports: [] },
  options: CodeIndexWriteOptions = {},
): CodeIndexSummary {
  initializeSchema(db);
  const repoId = ensureRepository(db, repo);
  const now = new Date().toISOString();
  const deletedPaths = options.deletedPaths ?? [];
  const changedImports = options.changedImports;
  const testAwareness =
    options.testAwareness ??
    inferTestAwareness(repo, codeFiles, codeChunks, {
      onProgress: options.onProgress,
    });
  options.onProgress?.({ stage: "writing_code_index", repo, phase: "Writing code index" });
  const changedPaths = [...new Set(codeFiles.map((file) => file.path))];
  const affectedPaths = [...new Set([...changedPaths, ...deletedPaths])];

  const transaction = db.transaction(() => {
    let existingChunkRowIds: RowIdRow[] = [];
    if (affectedPaths.length > 0) {
      const placeholders = affectedPaths.map(() => "?").join(", ");
      existingChunkRowIds = db
        .prepare(
          `SELECT rowid
           FROM code_chunks
           WHERE repo_id = ? AND file_path IN (${placeholders})`,
        )
        .all(repoId, ...affectedPaths) as RowIdRow[];
    }
    const existingPatternRowIds = db
      .prepare("SELECT rowid FROM architecture_patterns WHERE repo_id = ?")
      .all(repoId) as RowIdRow[];
    options.onProgress?.({
      stage: "deleting_existing_code_index",
      repo,
      chunks: existingChunkRowIds.length,
      patterns: existingPatternRowIds.length,
    });
    deleteFtsRowsByRowId(
      db,
      "code_chunks_fts",
      existingChunkRowIds.map((row) => row.rowid),
      (current, total) =>
        options.onProgress?.({
          stage: "deleting_code_fts",
          repo,
          current,
          total,
          chunks: existingChunkRowIds.length,
        }),
    );

    if (affectedPaths.length > 0) {
      const placeholders = affectedPaths.map(() => "?").join(", ");
      db.prepare(
        `DELETE FROM code_chunks
         WHERE repo_id = ? AND file_path IN (${placeholders})`,
      ).run(repoId, ...affectedPaths);
      db.prepare(
        `DELETE FROM code_files
         WHERE repo_id = ? AND path IN (${placeholders})`,
      ).run(repoId, ...affectedPaths);
      db.prepare(
        `DELETE FROM test_links
         WHERE repo_id = ?
           AND reason != 'PR co-change'
           AND (source_path IN (${placeholders}) OR test_path IN (${placeholders}))`,
      ).run(repoId, ...affectedPaths, ...affectedPaths);
      db.prepare(
        `DELETE FROM test_files
         WHERE repo_id = ? AND path IN (${placeholders})`,
      ).run(repoId, ...affectedPaths);
      if (changedImports) {
        db.prepare(
          `DELETE FROM code_imports
           WHERE repo_id = ? AND source_path IN (${placeholders})`,
        ).run(repoId, ...affectedPaths);
      }
    }

    deleteExistingArchitectureData(db, repoId, repo, existingPatternRowIds, options);

    if (changedImports) {
      const insertImport = db.prepare(
        `INSERT INTO code_imports
         (repo_id, source_path, specifier, imported_path, imported_symbols_json, kind)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const item of changedImports) {
        insertImport.run(
          repoId,
          item.sourcePath,
          item.specifier,
          item.importedPath ?? null,
          JSON.stringify(item.importedSymbols),
          item.kind,
        );
      }
    }

    const insertFile = db.prepare(
      `INSERT INTO code_files
       (repo_id, path, language, size_bytes, content_hash, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    options.onProgress?.({
      stage: "writing_code_files",
      repo,
      current: 0,
      total: codeFiles.length,
    });
    for (const [index, file] of codeFiles.entries()) {
      insertFile.run(
        repoId,
        file.path,
        file.language ?? null,
        file.sizeBytes,
        file.contentHash,
        file.updatedAt,
      );
      const current = index + 1;
      if (shouldEmitCodeWriteProgress(current, codeFiles.length)) {
        options.onProgress?.({
          stage: "writing_code_files",
          repo,
          current,
          total: codeFiles.length,
          filePath: file.path,
        });
      }
    }

    const fileRows = db
      .prepare("SELECT id, path FROM code_files WHERE repo_id = ?")
      .all(repoId) as CodeFileRow[];
    const fileIds = new Map(fileRows.map((row) => [row.path, row.id]));

    const insertChunk = db.prepare(
      `INSERT INTO code_chunks
       (id, repo_id, file_id, repo, file_path, language, start_line, end_line, sanitized_text,
        symbols_json, content_hash, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertFts = db.prepare(
      `INSERT INTO code_chunks_fts
       (rowid, chunkId, sanitizedText, filePath, symbols, language)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    options.onProgress?.({
      stage: "writing_code_chunks",
      repo,
      current: 0,
      total: codeChunks.length,
      chunks: 0,
    });
    let writtenChunks = 0;
    for (const [index, chunk] of codeChunks.entries()) {
      const fileId = fileIds.get(chunk.filePath);
      if (!fileId) continue;
      const chunkInsert = insertChunk.run(
        chunk.id,
        repoId,
        fileId,
        chunk.repo,
        chunk.filePath,
        chunk.language ?? null,
        chunk.startLine,
        chunk.endLine,
        chunk.sanitizedText,
        JSON.stringify(chunk.symbols),
        chunk.contentHash,
        chunk.updatedAt,
      );
      insertFts.run(
        Number(chunkInsert.lastInsertRowid),
        chunk.id,
        chunk.sanitizedText,
        chunk.filePath,
        chunk.symbols.join(" "),
        chunk.language ?? "",
      );
      writtenChunks += 1;
      const current = index + 1;
      if (shouldEmitCodeWriteProgress(current, codeChunks.length)) {
        options.onProgress?.({
          stage: "writing_code_chunks",
          repo,
          current,
          total: codeChunks.length,
          filePath: chunk.filePath,
          chunks: writtenChunks,
        });
      }
    }

    insertTestAwareness(db, repoId, repo, testAwareness.testFiles, testAwareness.testLinks, options);
    insertArchitectureData(db, repoId, repo, architecture, options, !changedImports);
    insertArchitectureMapEdges(db, repoId, repo, architecture, testAwareness.testLinks, options);

    options.onProgress?.({ stage: "writing_code_index", repo, phase: "Updating index state" });
    const totalFileCount = (
      db.prepare("SELECT COUNT(*) AS count FROM code_files WHERE repo_id = ?").get(repoId) as CountRow
    ).count;
    const totalChunkCount = (
      db.prepare("SELECT COUNT(*) AS count FROM code_chunks WHERE repo_id = ?").get(repoId) as CountRow
    ).count;
    db.prepare(
      `INSERT INTO code_index_state
       (repo, last_indexed_at, indexed_files, code_chunks, skipped_files, last_indexed_commit)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(repo) DO UPDATE SET
         last_indexed_at = excluded.last_indexed_at,
         indexed_files = excluded.indexed_files,
         code_chunks = excluded.code_chunks,
         skipped_files = excluded.skipped_files,
         last_indexed_commit = excluded.last_indexed_commit`,
    ).run(repo, now, totalFileCount, totalChunkCount, skippedFiles, options.currentCommit ?? null);

    db.prepare(
      `INSERT INTO architecture_index_state (repo, last_indexed_at, components, patterns, imports)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(repo) DO UPDATE SET
         last_indexed_at = excluded.last_indexed_at,
         components = excluded.components,
         patterns = excluded.patterns,
         imports = excluded.imports`,
    ).run(
      repo,
      now,
      architecture.components.length,
      architecture.patterns.length,
      architecture.imports.length,
    );
  });

  transaction();
  const counts = getRepoCodeCounts(db, repo);

  return {
    indexedFiles: counts.files,
    codeChunksCreated: counts.chunks,
    testFilesIndexed: testAwareness.testFiles.length,
    testLinksCreated: testAwareness.testLinks.length,
    architectureComponentsIndexed: architecture.components.length,
    architecturePatternsIndexed: architecture.patterns.length,
    architectureImportsIndexed: architecture.imports.length,
    skippedFiles,
    databasePath: defaultDatabasePath(cwd),
  };
}

function deleteExistingArchitectureData(
  db: AnchorDatabase,
  repoId: number,
  repo: string,
  patternRowIds: RowIdRow[],
  options: CodeIndexWriteOptions = {},
): void {
  deleteFtsRowsByRowId(
    db,
    "architecture_patterns_fts",
    patternRowIds.map((row) => row.rowid),
    (current, total) =>
      options.onProgress?.({
        stage: "deleting_architecture_fts",
        repo,
        current,
        total,
        patterns: patternRowIds.length,
      }),
  );
  db.prepare("DELETE FROM architecture_patterns WHERE repo_id = ?").run(repoId);
  db.prepare("DELETE FROM architecture_components WHERE repo_id = ?").run(repoId);
  db.prepare("DELETE FROM architecture_map_edges WHERE repo_id = ?").run(repoId);
}

function insertArchitectureData(
  db: AnchorDatabase,
  repoId: number,
  repo: string,
  architecture: ArchitectureIndexData,
  options: CodeIndexWriteOptions = {},
  includeImports = true,
): void {
  if (includeImports) {
    const insertImport = db.prepare(
      `INSERT INTO code_imports
       (repo_id, source_path, specifier, imported_path, imported_symbols_json, kind)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    options.onProgress?.({
      stage: "writing_architecture_data",
      repo,
      current: 0,
      total: architecture.imports.length,
      kind: "imports",
    });
    for (const [index, item] of architecture.imports.entries()) {
      insertImport.run(
        repoId,
        item.sourcePath,
        item.specifier,
        item.importedPath ?? null,
        JSON.stringify(item.importedSymbols),
        item.kind,
      );
      const current = index + 1;
      if (shouldEmitCodeWriteProgress(current, architecture.imports.length)) {
        options.onProgress?.({
          stage: "writing_architecture_data",
          repo,
          current,
          total: architecture.imports.length,
          kind: "imports",
        });
      }
    }
  }

  const insertComponent = db.prepare(
    `INSERT INTO architecture_components
     (repo_id, path, area, kind, language, symbols_json, imports_json, related_tests_json,
      confidence, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  options.onProgress?.({
    stage: "writing_architecture_data",
    repo,
    current: 0,
    total: architecture.components.length,
    kind: "components",
  });
  for (const [index, component] of architecture.components.entries()) {
    insertComponent.run(
      repoId,
      component.path,
      component.area,
      component.kind,
      component.language ?? null,
      JSON.stringify(component.symbols),
      JSON.stringify(component.imports),
      JSON.stringify(component.relatedTests),
      component.confidence,
      component.updatedAt,
    );
    const current = index + 1;
    if (shouldEmitCodeWriteProgress(current, architecture.components.length)) {
      options.onProgress?.({
        stage: "writing_architecture_data",
        repo,
        current,
        total: architecture.components.length,
        kind: "components",
      });
    }
  }

  const insertPattern = db.prepare(
    `INSERT INTO architecture_patterns
     (id, repo_id, repo, area, name, summary_sanitized, source_files_json, symbols_json,
      evidence_json, confidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertFts = db.prepare(
    `INSERT INTO architecture_patterns_fts (rowid, patternId, summary, area, sourceFiles, symbols)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  options.onProgress?.({
    stage: "writing_architecture_data",
    repo,
    current: 0,
    total: architecture.patterns.length,
    kind: "patterns",
  });
  for (const [index, pattern] of architecture.patterns.entries()) {
    const patternInsert = insertPattern.run(
      pattern.id,
      repoId,
      pattern.repo,
      pattern.area,
      pattern.name,
      pattern.sanitizedSummary,
      JSON.stringify(pattern.sourceFiles),
      JSON.stringify(pattern.symbols),
      JSON.stringify(pattern.evidence),
      pattern.confidence,
      pattern.createdAt,
    );
    insertFts.run(
      Number(patternInsert.lastInsertRowid),
      pattern.id,
      pattern.sanitizedSummary,
      pattern.area,
      pattern.sourceFiles.join(" "),
      pattern.symbols.join(" "),
    );
    const current = index + 1;
    if (shouldEmitCodeWriteProgress(current, architecture.patterns.length)) {
      options.onProgress?.({
        stage: "writing_architecture_data",
        repo,
        current,
        total: architecture.patterns.length,
        kind: "patterns",
      });
    }
  }
}

function insertArchitectureMapEdges(
  db: AnchorDatabase,
  repoId: number,
  repo: string,
  architecture: ArchitectureIndexData,
  testLinks: TestLink[],
  options: CodeIndexWriteOptions = {},
): void {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO architecture_map_edges
     (id, repo_id, repo, source_path, target_path, relationship, weight, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const seen = new Set<string>();
  const addEdge = (
    sourcePath: string,
    targetPath: string,
    relationship: string,
    weight: number,
  ) => {
    if (!sourcePath || !targetPath || sourcePath === targetPath) return;
    const id = `${repo}:${sourcePath}->${targetPath}:${relationship}`;
    if (seen.has(id)) return;
    seen.add(id);
    insert.run(id, repoId, repo, sourcePath, targetPath, relationship, weight, now);
  };

  const total = architecture.imports.length + testLinks.length;
  let current = 0;
  options.onProgress?.({
    stage: "writing_architecture_map_edges",
    repo,
    current,
    total,
    edges: 0,
  });
  for (const item of architecture.imports) {
    if (item.importedPath) addEdge(item.sourcePath, item.importedPath, "imports", 0.9);
    current += 1;
    if (shouldEmitCodeWriteProgress(current, total)) {
      options.onProgress?.({
        stage: "writing_architecture_map_edges",
        repo,
        current,
        total,
        edges: seen.size,
      });
    }
  }
  for (const link of testLinks) {
    addEdge(link.sourcePath, link.testPath, "tested_by", link.strength);
    current += 1;
    if (shouldEmitCodeWriteProgress(current, total)) {
      options.onProgress?.({
        stage: "writing_architecture_map_edges",
        repo,
        current,
        total,
        edges: seen.size,
      });
    }
  }
}

function insertPrCochangeTestLinks(db: AnchorDatabase, repoId: number, filePaths: string[]): void {
  const testPaths = filePaths.filter(isTestFilePath);
  const sourcePaths = filePaths.filter((filePath) => !isTestFilePath(filePath));
  if (testPaths.length === 0 || sourcePaths.length === 0) return;
  const insert = db.prepare(
    `INSERT INTO test_links (repo_id, source_path, test_path, reason, strength)
     VALUES (?, ?, ?, 'PR co-change', 0.75)
     ON CONFLICT(repo_id, source_path, test_path, reason) DO UPDATE SET strength = excluded.strength`,
  );
  for (const sourcePath of sourcePaths) {
    for (const testPath of testPaths) insert.run(repoId, sourcePath, testPath);
  }
}

function insertTestAwareness(
  db: AnchorDatabase,
  repoId: number,
  repo: string,
  testFiles: TestFileRecord[],
  testLinks: TestLink[],
  options: CodeIndexWriteOptions = {},
): void {
  const dedupedTestFilesByPath = new Map<string, TestFileRecord>();
  for (const file of testFiles) dedupedTestFilesByPath.set(file.path, file);
  const dedupedTestFiles = [...dedupedTestFilesByPath.values()];

  const dedupedTestLinksByKey = new Map<string, TestLink>();
  for (const link of testLinks) {
    const key = `${link.sourcePath}\0${link.testPath}\0${link.reason}`;
    const existing = dedupedTestLinksByKey.get(key);
    if (!existing || link.strength > existing.strength) {
      dedupedTestLinksByKey.set(key, link);
    }
  }
  const dedupedTestLinks = [...dedupedTestLinksByKey.values()];

  const insertTestFile = db.prepare(
    `INSERT INTO test_files
     (repo_id, path, language, size_bytes, content_hash, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(repo_id, path) DO UPDATE SET
       language = excluded.language,
       size_bytes = excluded.size_bytes,
       content_hash = excluded.content_hash,
       updated_at = excluded.updated_at`,
  );
  options.onProgress?.({
    stage: "writing_test_awareness",
    repo,
    current: 0,
    total: dedupedTestFiles.length,
    kind: "test_files",
  });
  for (const [index, file] of dedupedTestFiles.entries()) {
    insertTestFile.run(
      repoId,
      file.path,
      file.language ?? null,
      file.sizeBytes,
      file.contentHash,
      file.updatedAt,
    );
    const current = index + 1;
    if (shouldEmitCodeWriteProgress(current, dedupedTestFiles.length)) {
      options.onProgress?.({
        stage: "writing_test_awareness",
        repo,
        current,
        total: dedupedTestFiles.length,
        kind: "test_files",
      });
    }
  }

  const insertTestLink = db.prepare(
    `INSERT INTO test_links (repo_id, source_path, test_path, reason, strength)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(repo_id, source_path, test_path, reason) DO UPDATE SET
       strength = excluded.strength`,
  );
  options.onProgress?.({
    stage: "writing_test_awareness",
    repo,
    current: 0,
    total: dedupedTestLinks.length,
    kind: "test_links",
  });
  for (const [index, link] of dedupedTestLinks.entries()) {
    insertTestLink.run(repoId, link.sourcePath, link.testPath, link.reason, link.strength);
    const current = index + 1;
    if (shouldEmitCodeWriteProgress(current, dedupedTestLinks.length)) {
      options.onProgress?.({
        stage: "writing_test_awareness",
        repo,
        current,
        total: dedupedTestLinks.length,
        kind: "test_links",
      });
    }
  }
}

export function recordIndexRun(db: AnchorDatabase, run: IndexRunRecord): void {
  initializeSchema(db);
  db.prepare(
    `INSERT INTO index_runs
     (command, repo, started_at, finished_at, history_coverage, history_limit, prs_fetched,
      prs_skipped, comments_indexed, code_files_indexed, test_files_indexed, failures_json, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    run.command,
    run.repo ?? null,
    run.startedAt,
    run.finishedAt ?? new Date().toISOString(),
    run.historyCoverage ?? null,
    run.historyLimit ?? null,
    run.prsFetched ?? null,
    run.prsSkipped ?? null,
    run.commentsIndexed ?? null,
    run.codeFilesIndexed ?? null,
    run.testFilesIndexed ?? null,
    JSON.stringify(run.failures ?? []),
    run.status,
  );
}

function withCoverage<
  T extends Omit<
    IndexStatus,
    "coverageScore" | "coverageGrade" | "coverageReasons" | "suggestedPrompts"
  >,
>(
  status: T,
): T &
  Pick<IndexStatus, "coverageScore" | "coverageGrade" | "coverageReasons" | "suggestedPrompts"> {
  const coverage = calculateCoverage({
    prCount: status.prCount,
    wisdomUnitCount: status.wisdomUnitCount,
    codeFileCount: status.codeFileCount,
    codeChunkCount: status.codeChunkCount,
    testLinkCount: status.testLinkCount,
    testCommandCount: status.testCommandCount,
    regressionEventCount: status.regressionEventCount,
    architecturePatternCount: status.architecturePatternCount,
    architectureMapEdgeCount: status.architectureMapEdgeCount,
    teamRuleCount: status.teamRuleCount,
    retrievalEvalCount: status.retrievalEvalCount,
    playbookCount: status.playbookCount,
    historyCoverage: status.historyCoverage,
    staleEvidenceCount: status.staleEvidenceCount,
    staleCodeIndex: status.staleCodeIndex,
  });
  return { ...status, ...coverage };
}

export function getIndexStatus(
  cwd: string,
  githubTokenConfigured = Boolean(resolveGitHubToken({ cwd }).token),
  databasePath = defaultDatabasePath(cwd),
): IndexStatus {
  if (!fs.existsSync(databasePath)) {
    const rules = countValidTeamRules(cwd);
    return withCoverage({
      databasePath,
      prCount: 0,
      fileCount: 0,
      commentCount: 0,
      wisdomUnitCount: 0,
      codeFileCount: 0,
      codeChunkCount: 0,
      testFileCount: 0,
      testLinkCount: 0,
      regressionEventCount: 0,
      architectureComponentCount: 0,
      architecturePatternCount: 0,
      architectureImportCount: 0,
      architectureMapEdgeCount: 0,
      testCommandCount: 0,
      retrievalEvalCount: 0,
      feedbackEventCount: 0,
      playbookCount: 0,
      historyCoverage: "unknown",
      staleEvidenceCount: 0,
      teamRuleCount: rules.count,
      lastRuleIndexTime: rules.lastRuleIndexTime,
      staleCodeIndex: true,
      githubTokenConfigured,
      health: "missing_database",
    });
  }

  const db = openAnchorDatabase(cwd, databasePath);
  try {
    initializeSchema(db);
    if (!checkSchema(db)) {
      const rules = countValidTeamRules(cwd);
      return withCoverage({
        databasePath,
        prCount: 0,
        fileCount: 0,
        commentCount: 0,
        wisdomUnitCount: 0,
        codeFileCount: 0,
        codeChunkCount: 0,
        testFileCount: 0,
        testLinkCount: 0,
        regressionEventCount: 0,
        architectureComponentCount: 0,
        architecturePatternCount: 0,
        architectureImportCount: 0,
        architectureMapEdgeCount: 0,
        testCommandCount: 0,
        retrievalEvalCount: 0,
        feedbackEventCount: 0,
        playbookCount: 0,
        historyCoverage: "unknown",
        staleEvidenceCount: 0,
        teamRuleCount: rules.count,
        lastRuleIndexTime: rules.lastRuleIndexTime,
        staleCodeIndex: true,
        githubTokenConfigured,
        health: "schema_invalid",
      });
    }
    const count = (table: string): number =>
      (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as CountRow).count;
    const repoRow = db.prepare("SELECT full_name FROM repositories ORDER BY id LIMIT 1").get() as
      | { full_name?: string }
      | undefined;
    const syncRow = db
      .prepare(
        "SELECT last_sync_at, history_coverage, history_limit FROM sync_state ORDER BY updated_at DESC LIMIT 1",
      )
      .get() as SyncRow | undefined;
    const codeIndexRow = db
      .prepare("SELECT last_indexed_at FROM code_index_state ORDER BY last_indexed_at DESC LIMIT 1")
      .get() as CodeIndexStateRow | undefined;
    const architectureIndexRow = db
      .prepare(
        "SELECT last_indexed_at FROM architecture_index_state ORDER BY last_indexed_at DESC LIMIT 1",
      )
      .get() as ArchitectureIndexStateRow | undefined;
    const watchIndexRow = db
      .prepare("SELECT last_indexed_at FROM watch_state ORDER BY last_indexed_at DESC LIMIT 1")
      .get() as CodeIndexStateRow | undefined;
    const wisdomUnitCount = count("wisdom_units");
    const codeChunkCount = count("code_chunks");
    const lastSuccessfulRun = db
      .prepare(
        "SELECT finished_at, failures_json FROM index_runs WHERE status = 'success' ORDER BY finished_at DESC LIMIT 1",
      )
      .get() as LastRunRow | undefined;
    const lastFailedRun = db
      .prepare(
        "SELECT finished_at, failures_json FROM index_runs WHERE status = 'failed' ORDER BY finished_at DESC LIMIT 1",
      )
      .get() as LastRunRow | undefined;
    const staleCodeIndex = isCodeIndexStale(codeIndexRow?.last_indexed_at ?? undefined);
    const rules = countValidTeamRules(cwd);
    const pullRequestCount = count("pull_requests");
    return withCoverage({
      repo: repoRow?.full_name,
      databasePath,
      prCount: pullRequestCount,
      fileCount: count("pr_files"),
      commentCount: count("pr_comments"),
      wisdomUnitCount,
      codeFileCount: count("code_files"),
      codeChunkCount,
      testFileCount: count("test_files"),
      testLinkCount: count("test_links"),
      regressionEventCount: count("regression_events"),
      architectureComponentCount: count("architecture_components"),
      architecturePatternCount: count("architecture_patterns"),
      architectureImportCount: count("code_imports"),
      architectureMapEdgeCount: count("architecture_map_edges"),
      testCommandCount: count("test_commands"),
      retrievalEvalCount: count("retrieval_evals"),
      feedbackEventCount: count("feedback_events"),
      playbookCount: count("playbooks"),
      historyCoverage: syncRow?.history_coverage ?? "unknown",
      historyLimit: syncRow?.history_limit ?? undefined,
      staleEvidenceCount: countStaleEvidence(db),
      teamRuleCount: rules.count,
      lastSyncTime: syncRow?.last_sync_at ?? undefined,
      lastCodeIndexTime: codeIndexRow?.last_indexed_at ?? undefined,
      lastArchitectureIndexTime: architectureIndexRow?.last_indexed_at ?? undefined,
      lastRuleIndexTime: rules.lastRuleIndexTime,
      lastWatchIndexTime: watchIndexRow?.last_indexed_at ?? undefined,
      lastSuccessfulRun: lastSuccessfulRun?.finished_at ?? undefined,
      lastFailedRun: lastFailedRun?.finished_at ?? undefined,
      staleCodeIndex,
      suggestedNextCommand: suggestedNextCommand({
        prCount: pullRequestCount,
        wisdomUnitCount,
        codeChunkCount,
        staleCodeIndex,
        historyCoverage: syncRow?.history_coverage ?? "unknown",
      }),
      githubTokenConfigured,
      health: wisdomUnitCount > 0 || codeChunkCount > 0 ? "ok" : "empty_index",
    });
  } finally {
    db.close();
  }
}

export function getWisdomCategoryCounts(db: AnchorDatabase): Record<WisdomCategory, number> {
  initializeSchema(db);
  const rows = db
    .prepare("SELECT category, COUNT(*) AS count FROM wisdom_units GROUP BY category")
    .all() as Array<{ category: WisdomCategory; count: number }>;
  return rows.reduce(
    (counts, row) => {
      counts[row.category] = row.count;
      return counts;
    },
    {} as Record<WisdomCategory, number>,
  );
}

function isCodeIndexStale(lastIndexedAt?: string | null): boolean {
  if (!lastIndexedAt) return true;
  const timestamp = Date.parse(lastIndexedAt);
  if (Number.isNaN(timestamp)) return true;
  return Date.now() - timestamp > 1000 * 60 * 60 * 24 * 7;
}

function suggestedNextCommand(input: {
  prCount: number;
  wisdomUnitCount: number;
  codeChunkCount: number;
  staleCodeIndex: boolean;
  historyCoverage: "limited" | "all" | "unknown";
}): string | undefined {
  if (input.prCount === 0 && input.wisdomUnitCount === 0) return "anchor index";
  if (input.codeChunkCount === 0 || input.staleCodeIndex) return "anchor index-code";
  if (input.historyCoverage !== "all") return "anchor index-all";
  return undefined;
}

function countStaleEvidence(db: AnchorDatabase): number {
  const codeFiles = new Set(
    (db.prepare("SELECT path FROM code_files").all() as Array<{ path: string }>).map(
      (row) => row.path,
    ),
  );
  if (codeFiles.size === 0) return 0;
  const rows = db.prepare("SELECT file_paths_json FROM wisdom_units").all() as WisdomFilePathsRow[];
  let stale = 0;
  for (const row of rows) {
    let paths: string[] = [];
    try {
      const parsed = JSON.parse(row.file_paths_json) as unknown;
      paths = Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string")
        : [];
    } catch {
      paths = [];
    }
    if (paths.length > 0 && !paths.some((filePath) => codeFiles.has(filePath))) stale += 1;
  }
  return stale;
}
