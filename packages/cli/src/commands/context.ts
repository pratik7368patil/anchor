import fs from "node:fs";
import {
  buildAnchorContextResult,
  defaultDatabasePath,
  initializeSchema,
  openAnchorDatabase,
  truncateText,
  type AnchorContextInput,
  type FormattedResult,
} from "@pratik7368patil/anchor-core";

export type ContextOptions = {
  file?: string[];
  symbol?: string[];
  diffFile?: string;
  strict?: boolean;
  minConfidence?: "strong" | "moderate" | "weak";
  maxResults?: number;
  json?: boolean;
};

export function runContext(cwd: string, task: string, options: ContextOptions): FormattedResult {
  const databasePath = defaultDatabasePath(cwd);
  if (!fs.existsSync(databasePath)) {
    throw new Error(`Anchor index not found at ${databasePath}. Run anchor index first.`);
  }

  const input: AnchorContextInput = {
    task,
    files: options.file,
    symbols: options.symbol,
    diff: options.diffFile ? truncateText(fs.readFileSync(options.diffFile, "utf8"), 12000) : undefined,
    maxResults: options.maxResults,
    strict: options.strict,
    minConfidence: options.minConfidence,
  };

  const db = openAnchorDatabase(cwd, databasePath);
  try {
    initializeSchema(db);
    return buildAnchorContextResult(db, cwd, input);
  } finally {
    db.close();
  }
}

export function printContext(result: FormattedResult, options: ContextOptions): void {
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(result.markdown);
}
