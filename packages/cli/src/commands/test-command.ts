import {
  defaultDatabasePath,
  detectGitRoot,
  detectTestCommandsForFile,
  initializeSchema,
  openAnchorDatabase,
  type TestCommand,
} from "@pratik7368patil/anchor-core";

export type TestCommandOptions = {
  json?: boolean;
};

export function runTestCommand(cwd: string, file: string): TestCommand[] {
  const root = detectGitRoot(cwd) ?? cwd;
  const db = openAnchorDatabase(root, defaultDatabasePath(root));
  try {
    initializeSchema(db);
    return detectTestCommandsForFile(db, root, file);
  } finally {
    db.close();
  }
}

export function printTestCommand(commands: TestCommand[], options: TestCommandOptions = {}): void {
  if (options.json) {
    console.log(JSON.stringify({ testCommands: commands }, null, 2));
    return;
  }
  if (commands.length === 0) {
    console.log("No exact test command inferred.");
    return;
  }
  for (const command of commands) {
    console.log(`${command.command}`);
    console.log(`  ${command.reason} (${command.confidence})`);
  }
}
