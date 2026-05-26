import {
  defaultDatabasePath,
  detectGitRoot,
  initializeSchema,
  openAnchorDatabase,
  runAnchorCi,
  type FormattedResult,
} from "@pratik7368patil/anchor-core";

export type CiOptions = {
  strict?: boolean;
  minCoverage?: number;
  json?: boolean;
};

export function runCi(cwd: string, options: CiOptions = {}): FormattedResult {
  const root = detectGitRoot(cwd) ?? cwd;
  const db = openAnchorDatabase(root, defaultDatabasePath(root));
  try {
    initializeSchema(db);
    return runAnchorCi(db, root, {
      strict: options.strict,
      minCoverage: options.minCoverage,
    });
  } finally {
    db.close();
  }
}

export function printCi(result: FormattedResult, options: CiOptions = {}): void {
  if (options.json) {
    console.log(JSON.stringify(result.metadata, null, 2));
    return;
  }
  console.log(result.markdown);
}
