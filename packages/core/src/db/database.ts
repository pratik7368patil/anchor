import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { SCHEMA_SQL } from "./migrations.js";
import type {
  CodeChunk,
  CodeFileRecord,
  CodeIndexSummary,
  IndexStatus,
  PullRequestRecord,
  SourceType,
  WisdomUnit,
} from "../types.js";
import { redactedHistoricalText, sanitizeHistoricalText } from "../security/sanitize.js";
import { resolveGitHubToken } from "../utils/github-token.js";
import { countValidTeamRules } from "../rules/team-rules.js";

export type AnchorDatabase = Database.Database;

type CountRow = { count: number };
type RepoRow = { id: number; full_name: string };
type PrRow = { id: number };
type CodeFileRow = { id: number; path: string };
type SyncRow = {
  last_sync_at?: string | null;
  history_coverage?: "limited" | "all" | "unknown" | null;
  history_limit?: number | null;
};
type CodeIndexStateRow = { last_indexed_at?: string | null };
type WisdomFilePathsRow = { file_paths_json: string };

export function defaultDatabasePath(cwd: string): string {
  return path.join(cwd, ".anchor", "index.sqlite");
}

export function openAnchorDatabase(
  cwd: string,
  databasePath = defaultDatabasePath(cwd),
): AnchorDatabase {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

export function initializeSchema(db: AnchorDatabase): void {
  db.exec(SCHEMA_SQL);
  ensureColumn(db, "sync_state", "history_coverage", "TEXT");
  ensureColumn(db, "sync_state", "history_limit", "INTEGER");
  ensureColumn(db, "sync_state", "history_since", "TEXT");
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
    return tables.length > 0 && wisdom.length > 0 && codeTables.length > 0 && code.length > 0;
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

export function getLastSyncTime(db: AnchorDatabase, repo: string): string | undefined {
  const row = db.prepare("SELECT last_sync_at FROM sync_state WHERE repo = ?").get(repo) as
    | SyncRow
    | undefined;
  return row?.last_sync_at ?? undefined;
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

function deleteExistingPrData(db: AnchorDatabase, prId: number): void {
  const unitRows = db.prepare("SELECT id FROM wisdom_units WHERE pr_id = ?").all(prId) as Array<{
    id: string;
  }>;
  const deleteFts = db.prepare("DELETE FROM wisdom_units_fts WHERE unitId = ?");
  for (const row of unitRows) deleteFts.run(row.id);
  db.prepare("DELETE FROM wisdom_units WHERE pr_id = ?").run(prId);
  db.prepare("DELETE FROM pr_comments WHERE pr_id = ?").run(prId);
  db.prepare("DELETE FROM pr_files WHERE pr_id = ?").run(prId);
}

export function upsertPullRequest(
  db: AnchorDatabase,
  pr: PullRequestRecord,
  wisdomUnits: WisdomUnit[],
): { files: number; comments: number; wisdom: number } {
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
       (unitId, sanitizedText, filePaths, symbols, prTitle, prBody, category)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const unit of wisdomUnits) {
      insertWisdom.run(
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
        unit.id,
        unit.sanitizedText,
        unit.filePaths.join(" "),
        unit.symbols.join(" "),
        titleText,
        bodySanitized,
        unit.category,
      );
    }
  });

  transaction();

  const comments =
    (pr.reviews?.length ?? 0) + (pr.reviewComments?.length ?? 0) + (pr.issueComments?.length ?? 0);
  return { files: pr.files.length, comments, wisdom: wisdomUnits.length };
}

export function replaceCodeIndex(
  db: AnchorDatabase,
  repo: string,
  codeFiles: CodeFileRecord[],
  codeChunks: CodeChunk[],
  skippedFiles: number,
  cwd: string,
): CodeIndexSummary {
  initializeSchema(db);
  const repoId = ensureRepository(db, repo);
  const now = new Date().toISOString();

  const transaction = db.transaction(() => {
    const existingChunks = db
      .prepare("SELECT id FROM code_chunks WHERE repo_id = ?")
      .all(repoId) as Array<{
      id: string;
    }>;
    const deleteFts = db.prepare("DELETE FROM code_chunks_fts WHERE chunkId = ?");
    for (const row of existingChunks) deleteFts.run(row.id);
    db.prepare("DELETE FROM code_chunks WHERE repo_id = ?").run(repoId);
    db.prepare("DELETE FROM code_files WHERE repo_id = ?").run(repoId);

    const insertFile = db.prepare(
      `INSERT INTO code_files
       (repo_id, path, language, size_bytes, content_hash, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const file of codeFiles) {
      insertFile.run(
        repoId,
        file.path,
        file.language ?? null,
        file.sizeBytes,
        file.contentHash,
        file.updatedAt,
      );
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
       (chunkId, sanitizedText, filePath, symbols, language)
       VALUES (?, ?, ?, ?, ?)`,
    );

    for (const chunk of codeChunks) {
      const fileId = fileIds.get(chunk.filePath);
      if (!fileId) continue;
      insertChunk.run(
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
        chunk.id,
        chunk.sanitizedText,
        chunk.filePath,
        chunk.symbols.join(" "),
        chunk.language ?? "",
      );
    }

    db.prepare(
      `INSERT INTO code_index_state (repo, last_indexed_at, indexed_files, code_chunks, skipped_files)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(repo) DO UPDATE SET
         last_indexed_at = excluded.last_indexed_at,
         indexed_files = excluded.indexed_files,
         code_chunks = excluded.code_chunks,
         skipped_files = excluded.skipped_files`,
    ).run(repo, now, codeFiles.length, codeChunks.length, skippedFiles);
  });

  transaction();

  return {
    indexedFiles: codeFiles.length,
    codeChunksCreated: codeChunks.length,
    skippedFiles,
    databasePath: defaultDatabasePath(cwd),
  };
}

export function getIndexStatus(
  cwd: string,
  githubTokenConfigured = Boolean(resolveGitHubToken({ cwd }).token),
  databasePath = defaultDatabasePath(cwd),
): IndexStatus {
  if (!fs.existsSync(databasePath)) {
    const rules = countValidTeamRules(cwd);
    return {
      databasePath,
      prCount: 0,
      fileCount: 0,
      commentCount: 0,
      wisdomUnitCount: 0,
      codeFileCount: 0,
      codeChunkCount: 0,
      historyCoverage: "unknown",
      staleEvidenceCount: 0,
      teamRuleCount: rules.count,
      lastRuleIndexTime: rules.lastRuleIndexTime,
      githubTokenConfigured,
      health: "missing_database",
    };
  }

  const db = openAnchorDatabase(cwd, databasePath);
  try {
    initializeSchema(db);
    if (!checkSchema(db)) {
      const rules = countValidTeamRules(cwd);
      return {
        databasePath,
        prCount: 0,
        fileCount: 0,
        commentCount: 0,
        wisdomUnitCount: 0,
        codeFileCount: 0,
        codeChunkCount: 0,
        historyCoverage: "unknown",
        staleEvidenceCount: 0,
        teamRuleCount: rules.count,
        lastRuleIndexTime: rules.lastRuleIndexTime,
        githubTokenConfigured,
        health: "schema_invalid",
      };
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
    const wisdomUnitCount = count("wisdom_units");
    const codeChunkCount = count("code_chunks");
    const rules = countValidTeamRules(cwd);
    return {
      repo: repoRow?.full_name,
      databasePath,
      prCount: count("pull_requests"),
      fileCount: count("pr_files"),
      commentCount: count("pr_comments"),
      wisdomUnitCount,
      codeFileCount: count("code_files"),
      codeChunkCount,
      historyCoverage: syncRow?.history_coverage ?? "unknown",
      historyLimit: syncRow?.history_limit ?? undefined,
      staleEvidenceCount: countStaleEvidence(db),
      teamRuleCount: rules.count,
      lastSyncTime: syncRow?.last_sync_at ?? undefined,
      lastCodeIndexTime: codeIndexRow?.last_indexed_at ?? undefined,
      lastRuleIndexTime: rules.lastRuleIndexTime,
      githubTokenConfigured,
      health: wisdomUnitCount > 0 || codeChunkCount > 0 ? "ok" : "empty_index",
    };
  } finally {
    db.close();
  }
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
