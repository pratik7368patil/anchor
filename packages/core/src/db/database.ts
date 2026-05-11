import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { SCHEMA_SQL } from "./migrations.js";
import type { IndexStatus, PullRequestRecord, SourceType, WisdomUnit } from "../types.js";
import { redactedHistoricalText, sanitizeHistoricalText } from "../security/sanitize.js";

export type AnchorDatabase = Database.Database;

type CountRow = { count: number };
type RepoRow = { id: number; full_name: string };
type PrRow = { id: number };
type SyncRow = { last_sync_at?: string | null };

export function defaultDatabasePath(cwd: string): string {
  return path.join(cwd, ".anchor", "index.sqlite");
}

export function openAnchorDatabase(cwd: string, databasePath = defaultDatabasePath(cwd)): AnchorDatabase {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

export function initializeSchema(db: AnchorDatabase): void {
  db.exec(SCHEMA_SQL);
}

export function checkSchema(db: AnchorDatabase): boolean {
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual') AND name = ?")
      .all("wisdom_units_fts");
    const wisdom = db.prepare("SELECT name FROM sqlite_master WHERE name = ?").all("wisdom_units");
    return tables.length > 0 && wisdom.length > 0;
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
  const row = db
    .prepare("SELECT last_sync_at FROM sync_state WHERE repo = ?")
    .get(repo) as SyncRow | undefined;
  return row?.last_sync_at ?? undefined;
}

export function updateSyncState(db: AnchorDatabase, repo: string, lastIndexedPr?: number): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO sync_state (repo, last_sync_at, last_indexed_pr, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(repo) DO UPDATE SET
       last_sync_at = excluded.last_sync_at,
       last_indexed_pr = excluded.last_indexed_pr,
       updated_at = excluded.updated_at`,
  ).run(repo, now, lastIndexedPr ?? null, now);
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
  const labels = (pr.labels ?? []).map((label) => (typeof label === "string" ? label : label.name)).filter(Boolean);
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

  const comments = (pr.reviews?.length ?? 0) + (pr.reviewComments?.length ?? 0) + (pr.issueComments?.length ?? 0);
  return { files: pr.files.length, comments, wisdom: wisdomUnits.length };
}

export function getIndexStatus(
  cwd: string,
  githubTokenConfigured = Boolean(process.env.GITHUB_TOKEN),
  databasePath = defaultDatabasePath(cwd),
): IndexStatus {
  if (!fs.existsSync(databasePath)) {
    return {
      databasePath,
      prCount: 0,
      fileCount: 0,
      commentCount: 0,
      wisdomUnitCount: 0,
      githubTokenConfigured,
      health: "missing_database",
    };
  }

  const db = openAnchorDatabase(cwd, databasePath);
  try {
    if (!checkSchema(db)) {
      return {
        databasePath,
        prCount: 0,
        fileCount: 0,
        commentCount: 0,
        wisdomUnitCount: 0,
        githubTokenConfigured,
        health: "schema_invalid",
      };
    }
    const count = (table: string): number =>
      (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as CountRow).count;
    const repoRow = db
      .prepare("SELECT full_name FROM repositories ORDER BY id LIMIT 1")
      .get() as { full_name?: string } | undefined;
    const syncRow = db
      .prepare("SELECT last_sync_at FROM sync_state ORDER BY updated_at DESC LIMIT 1")
      .get() as SyncRow | undefined;
    const wisdomUnitCount = count("wisdom_units");
    return {
      repo: repoRow?.full_name,
      databasePath,
      prCount: count("pull_requests"),
      fileCount: count("pr_files"),
      commentCount: count("pr_comments"),
      wisdomUnitCount,
      lastSyncTime: syncRow?.last_sync_at ?? undefined,
      githubTokenConfigured,
      health: wisdomUnitCount > 0 ? "ok" : "empty_index",
    };
  } finally {
    db.close();
  }
}
