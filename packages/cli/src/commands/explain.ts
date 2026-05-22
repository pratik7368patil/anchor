import {
  defaultDatabasePath,
  detectGitRoot,
  explainFile,
  openAnchorDatabase,
  type FormattedResult,
} from "@pratik7368patil/anchor-core";

export type ExplainOptions = {
  strict?: boolean;
  json?: boolean;
  maxResults?: number;
  share?: boolean;
};

export function runExplain(
  cwd: string,
  file: string,
  options: ExplainOptions = {},
): FormattedResult {
  const root = detectGitRoot(cwd) ?? cwd;
  const db = openAnchorDatabase(root, defaultDatabasePath(root));
  try {
    return explainFile(db, root, {
      file,
      strict: options.strict,
      maxResults: options.maxResults,
      share: options.share,
    });
  } finally {
    db.close();
  }
}

export function printExplain(result: FormattedResult, options: ExplainOptions = {}): void {
  if (options.json) {
    console.log(JSON.stringify(result.metadata, null, 2));
    return;
  }
  console.log(result.markdown);
}
