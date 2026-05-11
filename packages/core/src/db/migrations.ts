export const SCHEMA_SQL = String.raw`
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

CREATE TABLE IF NOT EXISTS sync_state (
  repo TEXT PRIMARY KEY,
  last_sync_at TEXT,
  last_indexed_pr INTEGER,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pull_requests_repo_number ON pull_requests(repo_id, number);
CREATE INDEX IF NOT EXISTS idx_pr_files_path ON pr_files(path);
CREATE INDEX IF NOT EXISTS idx_pr_comments_source ON pr_comments(source_type);
CREATE INDEX IF NOT EXISTS idx_wisdom_units_category ON wisdom_units(category);
CREATE INDEX IF NOT EXISTS idx_wisdom_units_pr ON wisdom_units(pr_id);
`;
