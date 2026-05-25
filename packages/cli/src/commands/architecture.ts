import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  checkArchitecture,
  defaultDatabasePath,
  detectGitRoot,
  getArchitectureContext,
  initializeSchema,
  openAnchorDatabase,
  truncateText,
  type ArchitectureArea,
  type FormattedResult,
} from "@pratik7368patil/anchor-core";

export type ArchitectureOptions = {
  file?: string;
  area?: ArchitectureArea;
  check?: boolean;
  diffFile?: string;
  writeDoc?: boolean;
  json?: boolean;
  map?: boolean;
  format?: "mermaid" | "json";
  maxResults?: number;
};

function readDiff(root: string, options: ArchitectureOptions): string {
  if (options.diffFile) return fs.readFileSync(options.diffFile, "utf8");
  return execFileSync("git", ["diff"], { cwd: root, encoding: "utf8" });
}

export function runArchitecture(cwd: string, options: ArchitectureOptions = {}): FormattedResult {
  const root = detectGitRoot(cwd) ?? cwd;
  const db = openAnchorDatabase(root, defaultDatabasePath(root));
  try {
    initializeSchema(db);
    const result = options.check
      ? checkArchitecture(db, root, {
          diff: truncateText(readDiff(root, options), 50000) ?? "",
          maxResults: options.maxResults,
        })
      : getArchitectureContext(db, root, {
          file: options.file,
          area: options.area,
          map: options.map,
          format: options.format,
          maxResults: options.maxResults,
        });
    if (options.writeDoc) {
      fs.writeFileSync(path.join(root, "ANCHOR_ARCHITECTURE.md"), `${result.markdown}\n`);
    }
    return result;
  } finally {
    db.close();
  }
}

export function printArchitecture(
  result: FormattedResult,
  options: ArchitectureOptions = {},
): void {
  if (options.json) {
    console.log(JSON.stringify(result.metadata, null, 2));
    return;
  }
  console.log(result.markdown);
  if (options.writeDoc) console.log("\nWrote ANCHOR_ARCHITECTURE.md");
}
