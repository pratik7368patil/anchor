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
  skipped_files INTEGER NOT NULL,
  last_indexed_commit TEXT
);

CREATE TABLE IF NOT EXISTS code_imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  source_path TEXT NOT NULL,
  specifier TEXT NOT NULL,
  imported_path TEXT,
  imported_symbols_json TEXT NOT NULL,
  kind TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS architecture_components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  area TEXT NOT NULL,
  kind TEXT NOT NULL,
  language TEXT,
  symbols_json TEXT NOT NULL,
  imports_json TEXT NOT NULL,
  related_tests_json TEXT NOT NULL,
  confidence REAL NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(repo_id, path)
);

CREATE TABLE IF NOT EXISTS architecture_patterns (
  id TEXT PRIMARY KEY,
  repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  repo TEXT NOT NULL,
  area TEXT NOT NULL,
  name TEXT NOT NULL,
  summary_sanitized TEXT NOT NULL,
  source_files_json TEXT NOT NULL,
  symbols_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  confidence REAL NOT NULL,
  created_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS architecture_patterns_fts USING fts5(
  patternId UNINDEXED,
  summary,
  area,
  sourceFiles,
  symbols
);

CREATE TABLE IF NOT EXISTS architecture_index_state (
  repo TEXT PRIMARY KEY,
  last_indexed_at TEXT NOT NULL,
  components INTEGER NOT NULL,
  patterns INTEGER NOT NULL,
  imports INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS architecture_map_edges (
  id TEXT PRIMARY KEY,
  repo_id INTEGER NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  repo TEXT NOT NULL,
  source_path TEXT NOT NULL,
  target_path TEXT NOT NULL,
  relationship TEXT NOT NULL,
  weight REAL NOT NULL,
  created_at TEXT NOT NULL
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

CREATE TABLE IF NOT EXISTS test_commands (
  id TEXT PRIMARY KEY,
  repo TEXT NOT NULL,
  file_path TEXT,
  command TEXT NOT NULL,
  reason TEXT NOT NULL,
  confidence TEXT NOT NULL,
  created_at TEXT NOT NULL
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

CREATE TABLE IF NOT EXISTS retrieval_evals (
  id TEXT PRIMARY KEY,
  task TEXT NOT NULL,
  files_json TEXT NOT NULL,
  expected_prs_json TEXT NOT NULL,
  expected_categories_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS feedback_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  result_id TEXT NOT NULL,
  rating TEXT NOT NULL,
  note_sanitized TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS playbooks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body_sanitized TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS watch_state (
  repo TEXT PRIMARY KEY,
  last_indexed_at TEXT NOT NULL,
  indexed_files INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_state (
  repo TEXT PRIMARY KEY,
  last_sync_at TEXT,
  last_indexed_pr INTEGER,
  history_coverage TEXT,
  history_limit INTEGER,
  history_since TEXT,
  graphql_cursor TEXT,
  graphql_cursor_scope TEXT,
  graphql_cursor_scanned_prs INTEGER,
  graphql_cursor_matched_prs INTEGER,
  graphql_cursor_page_size INTEGER,
  graphql_cursor_reset_at TEXT,
  graphql_cursor_reason TEXT,
  graphql_cursor_updated_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS org_repositories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org TEXT NOT NULL,
  full_name TEXT NOT NULL,
  alias TEXT NOT NULL,
  repo_group TEXT NOT NULL,
  clone_url TEXT NOT NULL,
  default_branch TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(org, full_name)
);

CREATE TABLE IF NOT EXISTS org_repo_state (
  org TEXT NOT NULL,
  repo TEXT NOT NULL,
  local_path TEXT NOT NULL,
  default_branch TEXT NOT NULL,
  current_commit TEXT,
  last_pulled_at TEXT,
  last_code_indexed_commit TEXT,
  last_code_indexed_at TEXT,
  last_pr_sync_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(org, repo)
);

CREATE TABLE IF NOT EXISTS org_index_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org TEXT NOT NULL,
  repo TEXT,
  command TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  prs_indexed INTEGER NOT NULL DEFAULT 0,
  code_files_indexed INTEGER NOT NULL DEFAULT 0,
  failures_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS org_cross_repo_edges (
  id TEXT PRIMARY KEY,
  org TEXT NOT NULL,
  source_repo TEXT NOT NULL,
  source_path TEXT NOT NULL,
  target_repo TEXT NOT NULL,
  target_path TEXT,
  relationship TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  confidence REAL NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS org_api_contracts (
  id TEXT PRIMARY KEY,
  org TEXT NOT NULL,
  repo TEXT NOT NULL,
  file_path TEXT NOT NULL,
  contract TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  confidence REAL NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS org_api_consumers (
  id TEXT PRIMARY KEY,
  org TEXT NOT NULL,
  provider_repo TEXT NOT NULL,
  provider_path TEXT,
  consumer_repo TEXT NOT NULL,
  consumer_path TEXT NOT NULL,
  contract TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  confidence REAL NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS org_anomaly_events (
  id TEXT PRIMARY KEY,
  org TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  summary_sanitized TEXT NOT NULL,
  affected_repos_json TEXT NOT NULL,
  affected_files_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  recommended_checks_json TEXT NOT NULL,
  confidence TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS org_graph_state (
  org TEXT PRIMARY KEY,
  last_built_at TEXT,
  last_status TEXT NOT NULL DEFAULT 'unknown',
  last_duration_ms INTEGER,
  edge_count INTEGER NOT NULL DEFAULT 0,
  api_contract_count INTEGER NOT NULL DEFAULT 0,
  api_consumer_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS org_sync_checkpoints (
  org TEXT NOT NULL,
  repo TEXT NOT NULL,
  checkpoint_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(org, repo, checkpoint_key)
);

CREATE INDEX IF NOT EXISTS idx_pull_requests_repo_number ON pull_requests(repo_id, number);
CREATE INDEX IF NOT EXISTS idx_pr_files_path ON pr_files(path);
CREATE INDEX IF NOT EXISTS idx_pr_comments_source ON pr_comments(source_type);
CREATE INDEX IF NOT EXISTS idx_wisdom_units_category ON wisdom_units(category);
CREATE INDEX IF NOT EXISTS idx_wisdom_units_pr ON wisdom_units(pr_id);
CREATE INDEX IF NOT EXISTS idx_code_files_path ON code_files(path);
CREATE INDEX IF NOT EXISTS idx_code_chunks_file_path ON code_chunks(file_path);
CREATE INDEX IF NOT EXISTS idx_code_imports_source ON code_imports(source_path);
CREATE INDEX IF NOT EXISTS idx_code_imports_imported ON code_imports(imported_path);
CREATE INDEX IF NOT EXISTS idx_architecture_components_path ON architecture_components(path);
CREATE INDEX IF NOT EXISTS idx_architecture_components_area ON architecture_components(area);
CREATE INDEX IF NOT EXISTS idx_architecture_patterns_area ON architecture_patterns(area);
CREATE INDEX IF NOT EXISTS idx_architecture_map_edges_source ON architecture_map_edges(source_path);
CREATE INDEX IF NOT EXISTS idx_architecture_map_edges_target ON architecture_map_edges(target_path);
CREATE INDEX IF NOT EXISTS idx_test_files_path ON test_files(path);
CREATE INDEX IF NOT EXISTS idx_test_links_source ON test_links(source_path);
CREATE INDEX IF NOT EXISTS idx_test_links_test ON test_links(test_path);
CREATE INDEX IF NOT EXISTS idx_test_commands_file ON test_commands(file_path);
CREATE INDEX IF NOT EXISTS idx_regression_events_pr ON regression_events(pr_id);
CREATE INDEX IF NOT EXISTS idx_index_runs_started ON index_runs(started_at);
CREATE INDEX IF NOT EXISTS idx_feedback_events_result ON feedback_events(result_id);
CREATE INDEX IF NOT EXISTS idx_org_repositories_org ON org_repositories(org);
CREATE INDEX IF NOT EXISTS idx_org_repo_state_org ON org_repo_state(org);
CREATE INDEX IF NOT EXISTS idx_org_edges_source ON org_cross_repo_edges(org, source_repo);
CREATE INDEX IF NOT EXISTS idx_org_edges_target ON org_cross_repo_edges(org, target_repo);
CREATE INDEX IF NOT EXISTS idx_org_consumers_provider ON org_api_consumers(org, provider_repo);
CREATE INDEX IF NOT EXISTS idx_org_consumers_consumer ON org_api_consumers(org, consumer_repo);
CREATE INDEX IF NOT EXISTS idx_org_anomalies_org ON org_anomaly_events(org, severity);
CREATE INDEX IF NOT EXISTS idx_org_graph_state_status ON org_graph_state(org, last_status);

-- Foreign-key indexes backing per-repo / per-PR bulk deletes and re-index scans.
CREATE INDEX IF NOT EXISTS idx_code_chunks_repo ON code_chunks(repo_id);
CREATE INDEX IF NOT EXISTS idx_code_files_repo ON code_files(repo_id);
CREATE INDEX IF NOT EXISTS idx_code_imports_repo ON code_imports(repo_id);
CREATE INDEX IF NOT EXISTS idx_test_files_repo ON test_files(repo_id);
CREATE INDEX IF NOT EXISTS idx_test_links_repo ON test_links(repo_id);
CREATE INDEX IF NOT EXISTS idx_architecture_components_repo ON architecture_components(repo_id);
CREATE INDEX IF NOT EXISTS idx_architecture_patterns_repo ON architecture_patterns(repo_id);
CREATE INDEX IF NOT EXISTS idx_architecture_map_edges_repo ON architecture_map_edges(repo_id);
CREATE INDEX IF NOT EXISTS idx_wisdom_units_repo ON wisdom_units(repo_id);
CREATE INDEX IF NOT EXISTS idx_regression_events_repo ON regression_events(repo_id);
CREATE INDEX IF NOT EXISTS idx_pr_files_pr ON pr_files(pr_id);
CREATE INDEX IF NOT EXISTS idx_pr_comments_pr ON pr_comments(pr_id);
