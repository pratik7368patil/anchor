import {
  defaultDatabasePath,
  detectGitRoot,
  initializeSchema,
  openAnchorDatabase,
  refreshWatchIndex,
  watchCodebase,
  type CodeIndexSummary,
} from "@pratik7368patil/anchor-core";

export type WatchOptions = {
  interval?: number;
  repo?: string;
  once?: boolean;
};

function printSummary(summary: CodeIndexSummary): void {
  console.log(
    `Indexed ${summary.indexedFiles} file(s), ${summary.codeChunksCreated} chunk(s), ${summary.testLinksCreated} test link(s), ${summary.architecturePatternsIndexed} architecture pattern(s).`,
  );
}

export function runWatch(cwd: string, options: WatchOptions = {}): void {
  const root = detectGitRoot(cwd) ?? cwd;
  const db = openAnchorDatabase(root, defaultDatabasePath(root));
  initializeSchema(db);
  if (options.once) {
    printSummary(refreshWatchIndex(db, { cwd: root, repo: options.repo }));
    db.close();
    return;
  }
  console.log(`Watching ${root} every ${options.interval ?? 30}s. Press Ctrl+C to stop.`);
  const stop = watchCodebase(db, {
    cwd: root,
    repo: options.repo,
    intervalSeconds: options.interval,
    onRefresh: printSummary,
  });
  const shutdown = () => {
    stop();
    db.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
