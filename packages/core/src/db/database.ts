import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { SCHEMA_SQL } from "./migrations.js";
import type {
  ArchitectureIndexData,
  CodeChunk,
  CodeFileRecord,
  CodeIndexSummary,
  IndexRunRecord,
  IndexStatus,
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
type SyncRow = {
  last_sync_at?: string | null;
  history_coverage?: "limited" | "all" | "unknown" | null;
  history_limit?: number | null;
};
type CodeIndexStateRow = { last_indexed_at?: string | null };
type ArchitectureIndexStateRow = { last_indexed_at?: string | null };
type WisdomFilePathsRow = { file_paths_json: string };
type LastRunRow = { finished_at?: string | null; failures_json?: string | null };

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
): CodeIndexSummary {
  initializeSchema(db);
  const repoId = ensureRepository(db, repo);
  const now = new Date().toISOString();
  const testAwareness = inferTestAwareness(repo, codeFiles, codeChunks);

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
    db.prepare("DELETE FROM test_links WHERE repo_id = ? AND reason != 'PR co-change'").run(repoId);
    db.prepare("DELETE FROM test_files WHERE repo_id = ?").run(repoId);
    deleteExistingArchitectureData(db, repoId);

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

    insertTestAwareness(db, repoId, testAwareness.testFiles, testAwareness.testLinks);
    insertArchitectureData(db, repoId, architecture);
    insertArchitectureMapEdges(db, repoId, repo, architecture, testAwareness.testLinks);

    db.prepare(
      `INSERT INTO code_index_state (repo, last_indexed_at, indexed_files, code_chunks, skipped_files)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(repo) DO UPDATE SET
         last_indexed_at = excluded.last_indexed_at,
         indexed_files = excluded.indexed_files,
         code_chunks = excluded.code_chunks,
         skipped_files = excluded.skipped_files`,
    ).run(repo, now, codeFiles.length, codeChunks.length, skippedFiles);

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

  return {
    indexedFiles: codeFiles.length,
    codeChunksCreated: codeChunks.length,
    testFilesIndexed: testAwareness.testFiles.length,
    testLinksCreated: testAwareness.testLinks.length,
    architectureComponentsIndexed: architecture.components.length,
    architecturePatternsIndexed: architecture.patterns.length,
    architectureImportsIndexed: architecture.imports.length,
    skippedFiles,
    databasePath: defaultDatabasePath(cwd),
  };
}

function deleteExistingArchitectureData(db: AnchorDatabase, repoId: number): void {
  const patternRows = db
    .prepare("SELECT id FROM architecture_patterns WHERE repo_id = ?")
    .all(repoId) as Array<{ id: string }>;
  const deleteFts = db.prepare("DELETE FROM architecture_patterns_fts WHERE patternId = ?");
  for (const row of patternRows) deleteFts.run(row.id);
  db.prepare("DELETE FROM architecture_patterns WHERE repo_id = ?").run(repoId);
  db.prepare("DELETE FROM architecture_components WHERE repo_id = ?").run(repoId);
  db.prepare("DELETE FROM code_imports WHERE repo_id = ?").run(repoId);
  db.prepare("DELETE FROM architecture_map_edges WHERE repo_id = ?").run(repoId);
}

function insertArchitectureData(
  db: AnchorDatabase,
  repoId: number,
  architecture: ArchitectureIndexData,
): void {
  const insertImport = db.prepare(
    `INSERT INTO code_imports
     (repo_id, source_path, specifier, imported_path, imported_symbols_json, kind)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const item of architecture.imports) {
    insertImport.run(
      repoId,
      item.sourcePath,
      item.specifier,
      item.importedPath ?? null,
      JSON.stringify(item.importedSymbols),
      item.kind,
    );
  }

  const insertComponent = db.prepare(
    `INSERT INTO architecture_components
     (repo_id, path, area, kind, language, symbols_json, imports_json, related_tests_json,
      confidence, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const component of architecture.components) {
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
  }

  const insertPattern = db.prepare(
    `INSERT INTO architecture_patterns
     (id, repo_id, repo, area, name, summary_sanitized, source_files_json, symbols_json,
      evidence_json, confidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertFts = db.prepare(
    `INSERT INTO architecture_patterns_fts (patternId, summary, area, sourceFiles, symbols)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (const pattern of architecture.patterns) {
    insertPattern.run(
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
      pattern.id,
      pattern.sanitizedSummary,
      pattern.area,
      pattern.sourceFiles.join(" "),
      pattern.symbols.join(" "),
    );
  }
}

function insertArchitectureMapEdges(
  db: AnchorDatabase,
  repoId: number,
  repo: string,
  architecture: ArchitectureIndexData,
  testLinks: TestLink[],
): void {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO architecture_map_edges
     (id, repo_id, repo, source_path, target_path, relationship, weight, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const seen = new Set<string>();
  const addEdge = (sourcePath: string, targetPath: string, relationship: string, weight: number) => {
    if (!sourcePath || !targetPath || sourcePath === targetPath) return;
    const id = `${repo}:${sourcePath}->${targetPath}:${relationship}`;
    if (seen.has(id)) return;
    seen.add(id);
    insert.run(id, repoId, repo, sourcePath, targetPath, relationship, weight, now);
  };

  for (const item of architecture.imports) {
    if (item.importedPath) addEdge(item.sourcePath, item.importedPath, "imports", 0.9);
  }
  for (const link of testLinks) {
    addEdge(link.sourcePath, link.testPath, "tested_by", link.strength);
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
  testFiles: TestFileRecord[],
  testLinks: TestLink[],
): void {
  const insertTestFile = db.prepare(
    `INSERT INTO test_files
     (repo_id, path, language, size_bytes, content_hash, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const file of testFiles) {
    insertTestFile.run(
      repoId,
      file.path,
      file.language ?? null,
      file.sizeBytes,
      file.contentHash,
      file.updatedAt,
    );
  }

  const insertTestLink = db.prepare(
    `INSERT INTO test_links (repo_id, source_path, test_path, reason, strength)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (const link of testLinks) {
    insertTestLink.run(repoId, link.sourcePath, link.testPath, link.reason, link.strength);
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
