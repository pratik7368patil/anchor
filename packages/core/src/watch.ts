import type { AnchorDatabase } from "./db/database.js";
import { initializeSchema } from "./db/database.js";
import { indexCodebase } from "./indexer/code-indexer.js";
import type { CodeIndexSummary } from "./types.js";
import { detectGitHubRepo } from "./utils/git.js";
import { refreshTestCommands } from "./retrieval/test-commands.js";

export type WatchRefreshInput = {
  cwd: string;
  repo?: string;
};

export function refreshWatchIndex(
  db: AnchorDatabase,
  input: WatchRefreshInput,
): CodeIndexSummary {
  initializeSchema(db);
  const repo = input.repo ?? detectGitHubRepo(input.cwd)?.fullName ?? "local/repo";
  const summary = indexCodebase(db, { cwd: input.cwd, repo });
  refreshTestCommands(db, input.cwd, repo);
  db.prepare(
    `INSERT INTO watch_state (repo, last_indexed_at, indexed_files)
     VALUES (?, ?, ?)
     ON CONFLICT(repo) DO UPDATE SET
       last_indexed_at = excluded.last_indexed_at,
       indexed_files = excluded.indexed_files`,
  ).run(repo, new Date().toISOString(), summary.indexedFiles);
  return summary;
}

export function watchCodebase(
  db: AnchorDatabase,
  input: WatchRefreshInput & {
    intervalSeconds?: number;
    onRefresh?: (summary: CodeIndexSummary) => void;
  },
): () => void {
  const intervalMs = Math.max(5, input.intervalSeconds ?? 30) * 1000;
  let running = false;
  const refresh = () => {
    if (running) return;
    running = true;
    try {
      input.onRefresh?.(refreshWatchIndex(db, input));
    } finally {
      running = false;
    }
  };
  refresh();
  const timer = setInterval(refresh, intervalMs);
  return () => clearInterval(timer);
}
