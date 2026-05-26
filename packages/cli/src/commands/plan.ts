import {
  defaultDatabasePath,
  detectGitRoot,
  initializeSchema,
  openAnchorDatabase,
  planTask,
  type FormattedResult,
} from "@pratik7368patil/anchor-core";

export type PlanOptions = {
  file?: string[];
  symbol?: string[];
  strict?: boolean;
  json?: boolean;
};

export function runPlan(cwd: string, task: string, options: PlanOptions = {}): FormattedResult {
  const root = detectGitRoot(cwd) ?? cwd;
  const db = openAnchorDatabase(root, defaultDatabasePath(root));
  try {
    initializeSchema(db);
    return planTask(db, root, {
      task,
      files: options.file,
      symbols: options.symbol,
      strict: options.strict,
      maxResults: 8,
    });
  } finally {
    db.close();
  }
}

export function printPlan(result: FormattedResult, options: PlanOptions = {}): void {
  if (options.json) {
    console.log(JSON.stringify(result.metadata.taskPlan ?? result.metadata, null, 2));
    return;
  }
  console.log(result.markdown);
}
