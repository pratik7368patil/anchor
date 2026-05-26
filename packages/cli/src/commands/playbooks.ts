import {
  defaultDatabasePath,
  detectGitRoot,
  getPlaybook,
  initPlaybooks,
  initializeSchema,
  listPlaybooks,
  openAnchorDatabase,
  suggestPlaybooks,
  syncPlaybooksToDatabase,
  type Playbook,
} from "@pratik7368patil/anchor-core";

export function runPlaybooksInit(cwd: string): { path: string; created: boolean } {
  const root = detectGitRoot(cwd) ?? cwd;
  const result = initPlaybooks(root);
  const db = openAnchorDatabase(root, defaultDatabasePath(root));
  try {
    initializeSchema(db);
    syncPlaybooksToDatabase(db, root);
  } finally {
    db.close();
  }
  return result;
}

export function runPlaybooksSuggest(cwd: string): Playbook[] {
  const root = detectGitRoot(cwd) ?? cwd;
  const db = openAnchorDatabase(root, defaultDatabasePath(root));
  try {
    initializeSchema(db);
    return suggestPlaybooks(db, root);
  } finally {
    db.close();
  }
}

export function runPlaybooksList(cwd: string): Playbook[] {
  const root = detectGitRoot(cwd) ?? cwd;
  return listPlaybooks(root);
}

export function runPlaybooksGet(cwd: string, id: string): Playbook | undefined {
  const root = detectGitRoot(cwd) ?? cwd;
  return getPlaybook(root, id);
}

export function printPlaybooksInit(result: { path: string; created: boolean }): void {
  console.log(`${result.created ? "Created" : "Found"} ${result.path}`);
}

export function printPlaybooks(playbooks: Playbook[], options: { json?: boolean } = {}): void {
  if (options.json) {
    console.log(JSON.stringify({ playbooks }, null, 2));
    return;
  }
  if (playbooks.length === 0) {
    console.log("No playbooks found.");
    return;
  }
  for (const playbook of playbooks) {
    console.log(`- ${playbook.id}: ${playbook.title}`);
  }
}

export function printPlaybook(playbook: Playbook | undefined, options: { json?: boolean } = {}): void {
  if (options.json) {
    console.log(JSON.stringify({ playbook: playbook ?? null }, null, 2));
    return;
  }
  if (!playbook) {
    console.log("Playbook not found.");
    return;
  }
  console.log(`# ${playbook.title}`);
  console.log("");
  console.log(playbook.body);
  console.log("");
  console.log("Evidence:");
  for (const evidence of playbook.evidence) {
    console.log(`- PR #${evidence.prNumber}: ${evidence.prUrl}`);
  }
}
