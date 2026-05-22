import fs from "node:fs";
import { z } from "zod";
import {
  defaultDatabasePath,
  getArchitectureContext,
  initializeSchema,
  openAnchorDatabase,
} from "@pratik7368patil/anchor-core";

export const AnchorGetArchitectureSchema = z.object({
  file: z.string().min(1).max(500).optional(),
  area: z
    .enum([
      "api",
      "service",
      "component",
      "hook",
      "route",
      "store",
      "test",
      "schema",
      "type",
      "config",
      "util",
      "unknown",
    ])
    .optional(),
  query: z.string().min(1).max(1000).optional(),
  maxResults: z.number().int().min(1).max(12).default(8).optional(),
});

export async function handleAnchorGetArchitecture(input: unknown, cwd: string) {
  const parsed = AnchorGetArchitectureSchema.safeParse(input);
  if (!parsed.success) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Invalid anchor_get_architecture input: ${parsed.error.message}`,
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
          text: `Anchor index not found at ${databasePath}. Run anchor index-code first.`,
        },
      ],
      isError: true,
    };
  }

  const db = openAnchorDatabase(cwd, databasePath);
  try {
    initializeSchema(db);
    const formatted = getArchitectureContext(db, cwd, {
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
