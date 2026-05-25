import fs from "node:fs";
import { z } from "zod";
import {
  defaultDatabasePath,
  initializeSchema,
  openAnchorDatabase,
  planTask,
} from "@pratik7368patil/anchor-core";

export const AnchorPlanTaskSchema = z.object({
  task: z.string().min(1).max(2000),
  files: z.array(z.string().min(1)).max(50).optional(),
  symbols: z.array(z.string().min(1)).max(100).optional(),
  strict: z.boolean().optional(),
  maxResults: z.number().int().min(1).max(12).default(8).optional(),
});

export async function handleAnchorPlanTask(input: unknown, cwd: string) {
  const parsed = AnchorPlanTaskSchema.safeParse(input);
  if (!parsed.success) {
    return {
      content: [{ type: "text" as const, text: `Invalid anchor_plan_task input: ${parsed.error.message}` }],
      isError: true,
    };
  }
  const databasePath = defaultDatabasePath(cwd);
  if (!fs.existsSync(databasePath)) {
    return {
      content: [{ type: "text" as const, text: `Anchor index not found at ${databasePath}. Run anchor index first.` }],
      isError: true,
    };
  }
  const db = openAnchorDatabase(cwd, databasePath);
  try {
    initializeSchema(db);
    const formatted = planTask(db, cwd, parsed.data);
    return {
      content: [{ type: "text" as const, text: formatted.markdown }],
      structuredContent: formatted.metadata,
    };
  } finally {
    db.close();
  }
}
