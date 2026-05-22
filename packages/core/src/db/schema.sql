PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS repositories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL UNIQUE,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT
);

CREATE TABLE IF NOT EXISTS pull_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  body_text TEXT,
  body_sanitized TEXT,
  author TEXT,
  labels_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  merged_at TEXT,
  updated_at TEXT,
  UNIQUE(repo_id, number)
);

CREATE TABLE IF NOT EXISTS pr_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pr_id INTEGER NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  additions INTEGER NOT NULL DEFAULT 0,
  deletions INTEGER NOT NULL DEFAULT 0,
  patch_sanitized TEXT
);

CREATE TABLE IF NOT EXISTS pr_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pr_id INTEGER NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  author TEXT,
  body_text TEXT NOT NULL,
  sanitized_text TEXT NOT NULL,
  file_path TEXT,
  created_at TEXT,
  is_reviewer INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS wisdom_units (
  id TEXT PRIMARY KEY,
  repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  pr_id INTEGER NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
  repo TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  pr_url TEXT NOT NULL,
  source_type TEXT NOT NULL,
  category TEXT NOT NULL,
  text TEXT NOT NULL,
  sanitized_text TEXT NOT NULL,
  file_paths_json TEXT NOT NULL,
  symbols_json TEXT NOT NULL,
  authors_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  merged_at TEXT,
  confidence REAL NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS wisdom_units_fts USING fts5(
  unitId UNINDEXED,
  sanitizedText,
  filePaths,
  symbols,
  prTitle,
  prBody,
  category
);

CREATE TABLE IF NOT EXISTS code_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  language TEXT,
  size_bytes INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(repo_id, path)
);

CREATE TABLE IF NOT EXISTS code_chunks (
  id TEXT PRIMARY KEY,
  repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  file_id INTEGER NOT NULL REFERENCES code_files(id) ON DELETE CASCADE,
  repo TEXT NOT NULL,
  file_path TEXT NOT NULL,
  language TEXT,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  sanitized_text TEXT NOT NULL,
  symbols_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS code_chunks_fts USING fts5(
  chunkId UNINDEXED,
  sanitizedText,
  filePath,
  symbols,
  language
);

CREATE TABLE IF NOT EXISTS code_index_state (
  repo TEXT PRIMARY KEY,
  last_indexed_at TEXT NOT NULL,
  indexed_files INTEGER NOT NULL,
  code_chunks INTEGER NOT NULL,
  skipped_files INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS test_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  language TEXT,
  size_bytes INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(repo_id, path)
);

CREATE TABLE IF NOT EXISTS test_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  source_path TEXT NOT NULL,
  test_path TEXT NOT NULL,
  reason TEXT NOT NULL,
  strength REAL NOT NULL,
  UNIQUE(repo_id, source_path, test_path, reason)
);

CREATE TABLE IF NOT EXISTS regression_events (
  id TEXT PRIMARY KEY,
  repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  pr_id INTEGER REFERENCES pull_requests(id) ON DELETE CASCADE,
  repo TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  pr_url TEXT NOT NULL,
  summary_sanitized TEXT NOT NULL,
  file_paths_json TEXT NOT NULL,
  symbols_json TEXT NOT NULL,
  test_paths_json TEXT NOT NULL,
  authors_json TEXT NOT NULL,
  labels_json TEXT NOT NULL,
  signals_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  merged_at TEXT,
  confidence REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS index_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  command TEXT NOT NULL,
  repo TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  history_coverage TEXT,
  history_limit INTEGER,
  prs_fetched INTEGER,
  prs_skipped INTEGER,
  comments_indexed INTEGER,
  code_files_indexed INTEGER,
  test_files_indexed INTEGER,
  failures_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_state (
  repo TEXT PRIMARY KEY,
  last_sync_at TEXT,
  last_indexed_pr INTEGER,
  history_coverage TEXT,
  history_limit INTEGER,
  history_since TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pull_requests_repo_number ON pull_requests(repo_id, number);
CREATE INDEX IF NOT EXISTS idx_pr_files_path ON pr_files(path);
CREATE INDEX IF NOT EXISTS idx_pr_comments_source ON pr_comments(source_type);
CREATE INDEX IF NOT EXISTS idx_wisdom_units_category ON wisdom_units(category);
CREATE INDEX IF NOT EXISTS idx_wisdom_units_pr ON wisdom_units(pr_id);
CREATE INDEX IF NOT EXISTS idx_code_files_path ON code_files(path);
CREATE INDEX IF NOT EXISTS idx_code_chunks_file_path ON code_chunks(file_path);
CREATE INDEX IF NOT EXISTS idx_test_files_path ON test_files(path);
CREATE INDEX IF NOT EXISTS idx_test_links_source ON test_links(source_path);
CREATE INDEX IF NOT EXISTS idx_test_links_test ON test_links(test_path);
CREATE INDEX IF NOT EXISTS idx_regression_events_pr ON regression_events(pr_id);
CREATE INDEX IF NOT EXISTS idx_index_runs_started ON index_runs(started_at);
