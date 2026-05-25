import fs from "node:fs";
import { z } from "zod";
import {
  defaultDatabasePath,
  getArchitectureMapContext,
  initializeSchema,
  openAnchorDatabase,
} from "@pratik7368patil/anchor-core";

export const AnchorGetArchitectureMapSchema = z.object({
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
  format: z.enum(["mermaid", "json"]).default("mermaid").optional(),
});

export async function handleAnchorGetArchitectureMap(input: unknown, cwd: string) {
  const parsed = AnchorGetArchitectureMapSchema.safeParse(input);
  if (!parsed.success) {
    return {
      content: [{ type: "text" as const, text: `Invalid anchor_get_architecture_map input: ${parsed.error.message}` }],
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
    const formatted = getArchitectureMapContext(db, parsed.data);
    return {
      content: [{ type: "text" as const, text: formatted.markdown }],
      structuredContent: formatted.metadata,
    };
  } finally {
    db.close();
  }
}
