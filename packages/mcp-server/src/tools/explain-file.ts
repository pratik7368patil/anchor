import fs from "node:fs";
import { z } from "zod";
import {
  defaultDatabasePath,
  explainFile,
  initializeSchema,
  openAnchorDatabase,
} from "@pratik7368patil/anchor-core";

export const AnchorExplainFileSchema = z.object({
  file: z.string().min(1).max(500),
  symbols: z.array(z.string().min(1)).max(100).optional(),
  strict: z.boolean().optional(),
  maxResults: z.number().int().min(1).max(12).default(8).optional(),
});

export async function handleAnchorExplainFile(input: unknown, cwd: string) {
  const parsed = AnchorExplainFileSchema.safeParse(input);
  if (!parsed.success) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Invalid anchor_explain_file input: ${parsed.error.message}`,
        },
      ],
      isError: true,
    };
  }

  const databasePath = defaultDatabasePath(cwd);
  if (!fs.existsSync(databasePath)) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Anchor index not found at ${databasePath}. Run anchor index first.`,
        },
      ],
      isError: true,
    };
  }

  const db = openAnchorDatabase(cwd, databasePath);
  try {
    initializeSchema(db);
    const formatted = explainFile(db, cwd, {
      ...parsed.data,
      maxResults: parsed.data.maxResults ?? 8,
    });
    return {
      content: [{ type: "text" as const, text: formatted.markdown }],
      structuredContent: formatted.metadata,
    };
  } finally {
    db.close();
  }
}
