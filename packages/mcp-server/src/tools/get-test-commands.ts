import fs from "node:fs";
import { z } from "zod";
import {
  defaultDatabasePath,
  detectTestCommandsForFile,
  initializeSchema,
  openAnchorDatabase,
} from "@pratik7368patil/anchor-core";

export const AnchorGetTestCommandsSchema = z.object({
  file: z.string().min(1).max(500),
});

export async function handleAnchorGetTestCommands(input: unknown, cwd: string) {
  const parsed = AnchorGetTestCommandsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      content: [{ type: "text" as const, text: `Invalid anchor_get_test_commands input: ${parsed.error.message}` }],
      isError: true,
    };
  }
  const databasePath = defaultDatabasePath(cwd);
  if (!fs.existsSync(databasePath)) {
    return {
      content: [{ type: "text" as const, text: `Anchor index not found at ${databasePath}. Run anchor index-code first.` }],
      isError: true,
    };
  }
  const db = openAnchorDatabase(cwd, databasePath);
  try {
    initializeSchema(db);
    const commands = detectTestCommandsForFile(db, cwd, parsed.data.file);
    const markdown =
      commands.length === 0
        ? "No exact test command inferred."
        : commands
            .map((command) => `- \`${command.command}\` - ${command.reason} (${command.confidence})`)
            .join("\n");
    return {
      content: [{ type: "text" as const, text: markdown }],
      structuredContent: { testCommands: commands },
    };
  } finally {
    db.close();
  }
}
