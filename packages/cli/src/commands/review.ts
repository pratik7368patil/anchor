import fs from "node:fs";
import { execFileSync } from "node:child_process";
import {
  defaultDatabasePath,
  detectGitRoot,
  openAnchorDatabase,
  reviewDiff,
  type FormattedResult,
} from "@pratik7368patil/anchor-core";

export type ReviewOptions = {
  base?: string;
  diffFile?: string;
  strict?: boolean;
  json?: boolean;
  maxResults?: number;
};

function readDiff(root: string, options: ReviewOptions): string {
  if (options.diffFile) return fs.readFileSync(options.diffFile, "utf8");
  const args = options.base ? ["diff", `${options.base}...HEAD`] : ["diff"];
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

export function runReview(cwd: string, options: ReviewOptions = {}): FormattedResult {
  const root = detectGitRoot(cwd) ?? cwd;
  const diff = readDiff(root, options);
  const db = openAnchorDatabase(root, defaultDatabasePath(root));
  try {
    return reviewDiff(db, root, {
      diff,
      strict: options.strict,
      maxResults: options.maxResults,
    });
  } finally {
    db.close();
  }
}

export function printReview(result: FormattedResult, options: ReviewOptions = {}): void {
  if (options.json) {
    console.log(JSON.stringify(result.metadata, null, 2));
    return;
  }
  console.log(result.markdown);
}
