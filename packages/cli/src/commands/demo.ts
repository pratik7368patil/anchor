import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  buildAnchorContextResult,
  defaultDatabasePath,
  DEMO_CODE_FILES,
  DEMO_PULL_REQUESTS,
  DEMO_REPO,
  explainFile,
  getIndexStatus,
  getSuggestedPrompts,
  indexCodebase,
  indexPullRequests,
  openAnchorDatabase,
  planTask,
  reviewDiff,
  type FormattedResult,
} from "@pratik7368patil/anchor-core";

export type DemoOptions = {
  json?: boolean;
  keep?: boolean;
  path?: string;
};

export type DemoResult = {
  path: string;
  kept: boolean;
  indexStatus: ReturnType<typeof getIndexStatus>;
  context: FormattedResult;
  explain: FormattedResult;
  review: FormattedResult;
  plan: FormattedResult;
  prompts: ReturnType<typeof getSuggestedPrompts>;
};

function writeDemoWorkspace(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(path.join(dir, ".git"))) {
    execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
  }
  for (const [relativePath, content] of Object.entries(DEMO_CODE_FILES)) {
    const filePath = path.join(dir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
  execFileSync("git", ["add", ...Object.keys(DEMO_CODE_FILES)], { cwd: dir, stdio: "ignore" });
}

function demoDiff(): string {
  return [
    "diff --git a/src/auth/cache.ts b/src/auth/cache.ts",
    "--- a/src/auth/cache.ts",
    "+++ b/src/auth/cache.ts",
    "@@",
    "-    if (!this.loaded) this.loadLazy();",
    "+    this.loadLazy();",
  ].join("\n");
}

function prepareDemoPath(options: DemoOptions): { dir: string; cleanup: boolean } {
  if (options.path) {
    return { dir: path.resolve(options.path), cleanup: false };
  }
  return {
    dir: fs.mkdtempSync(path.join(os.tmpdir(), "anchor-demo-")),
    cleanup: !options.keep,
  };
}

export function runDemo(options: DemoOptions = {}): DemoResult {
  const { dir, cleanup } = prepareDemoPath(options);
  let result: DemoResult | undefined;
  try {
    writeDemoWorkspace(dir);
    const db = openAnchorDatabase(dir, defaultDatabasePath(dir));
    try {
      indexPullRequests(db, DEMO_PULL_REQUESTS, {
        cwd: dir,
        repo: DEMO_REPO,
        historyCoverage: "all",
      });
      indexCodebase(db, { cwd: dir, repo: DEMO_REPO });
      const context = buildAnchorContextResult(db, dir, {
        task: "Refactor AuthCache to simplify token loading",
        files: ["src/auth/cache.ts"],
        symbols: ["AuthCache"],
      });
      const explain = explainFile(db, dir, { file: "src/auth/cache.ts", share: true });
      const review = reviewDiff(db, dir, { diff: demoDiff(), share: true });
      const plan = planTask(db, dir, {
        task: "Refactor AuthCache to simplify token loading",
        files: ["src/auth/cache.ts"],
        symbols: ["AuthCache"],
      });
      result = {
        path: dir,
        kept: !cleanup,
        indexStatus: getIndexStatus(dir, false),
        context,
        explain,
        review,
        plan,
        prompts: getSuggestedPrompts(),
      };
      return result;
    } finally {
      db.close();
    }
  } finally {
    if (cleanup) fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function printDemo(result: DemoResult, options: DemoOptions = {}): void {
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log("# Anchor 2-minute demo");
  console.log("");
  console.log(`Demo workspace: ${result.kept ? result.path : "temporary workspace cleaned up"}`);
  console.log(
    `Anchor coverage: ${result.indexStatus.coverageScore}% (${result.indexStatus.coverageGrade})`,
  );
  console.log("");
  console.log("## anchor_get_context");
  console.log(result.context.markdown);
  console.log("");
  console.log("## anchor_explain_file share output");
  console.log(result.explain.markdown);
  console.log("");
  console.log("## anchor_review_diff share output");
  console.log(result.review.markdown);
  console.log("");
  console.log("## anchor_plan_task");
  console.log(result.plan.markdown);
  console.log("");
  console.log("## Cursor prompts");
  for (const prompt of result.prompts) console.log(`- ${prompt.prompt}`);
  console.log("");
  console.log("## Next steps");
  console.log("- Run `anchor init` in a real repo, then `anchor index-code` or `anchor index --limit 200`.");
  console.log("- Ask Cursor: Before editing this file, call `anchor_get_context` first.");
  console.log("- Share the demo command with teammates: `npx @pratik7368patil/anchor demo`.");
  console.log("- Docs and feedback: https://anchor-mcp.netlify.app");
  console.log("- GitHub: https://github.com/pratik7368patil/anchor");
}
