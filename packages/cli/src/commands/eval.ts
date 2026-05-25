import {
  addRetrievalEval,
  defaultDatabasePath,
  detectGitRoot,
  initRetrievalEvals,
  initializeSchema,
  openAnchorDatabase,
  runRetrievalEvals,
  type RetrievalEvalCase,
  type RetrievalEvalRunResult,
  type WisdomCategory,
} from "@pratik7368patil/anchor-core";

export type EvalAddOptions = {
  task: string;
  file?: string[];
  expectPr?: number[];
  category?: WisdomCategory[];
};

export function runEvalInit(cwd: string): { path: string; created: boolean } {
  return initRetrievalEvals(detectGitRoot(cwd) ?? cwd);
}

export function runEvalAdd(cwd: string, options: EvalAddOptions): RetrievalEvalCase {
  const root = detectGitRoot(cwd) ?? cwd;
  const db = openAnchorDatabase(root, defaultDatabasePath(root));
  try {
    initializeSchema(db);
    return addRetrievalEval(db, root, {
      task: options.task,
      files: options.file,
      expectedPrs: options.expectPr,
      expectedCategories: options.category,
    });
  } finally {
    db.close();
  }
}

export function runEvalRun(cwd: string): RetrievalEvalRunResult {
  const root = detectGitRoot(cwd) ?? cwd;
  const db = openAnchorDatabase(root, defaultDatabasePath(root));
  try {
    initializeSchema(db);
    return runRetrievalEvals(db, root);
  } finally {
    db.close();
  }
}

export function printEvalInit(result: { path: string; created: boolean }): void {
  console.log(`${result.created ? "Created" : "Found"} ${result.path}`);
}

export function printEvalAdd(result: RetrievalEvalCase): void {
  console.log(`Added eval ${result.id}`);
  console.log(`Task: ${result.task}`);
  console.log(`Expected PRs: ${result.expectedPrs.join(", ") || "n/a"}`);
}

export function printEvalRun(result: RetrievalEvalRunResult, options: { json?: boolean } = {}): void {
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`# Anchor Eval`);
  console.log(`${result.passed}/${result.total} eval(s) passed`);
  for (const item of result.results) {
    console.log(`- ${item.passed ? "PASS" : "FAIL"} ${item.id}: ${item.task}`);
    if (item.missingPrs.length > 0) console.log(`  Missing PRs: ${item.missingPrs.join(", ")}`);
    if (item.missingCategories.length > 0) {
      console.log(`  Missing categories: ${item.missingCategories.join(", ")}`);
    }
  }
}
