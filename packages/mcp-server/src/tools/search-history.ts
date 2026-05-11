import fs from "node:fs";
import { z } from "zod";
import {
  defaultDatabasePath,
  formatSearchHistory,
  openAnchorDatabase,
  rankWisdomUnits,
} from "@anchor/core";

const WisdomCategorySchema = z.enum([
  "architecture_decision",
  "constraint",
  "rejected_approach",
  "bug_regression",
  "testing_rule",
  "api_contract",
  "performance_note",
  "security_note",
  "style_convention",
  "unknown",
]);

export const AnchorSearchHistorySchema = z.object({
  query: z.string().min(1).max(2000),
  files: z.array(z.string().min(1)).max(50).optional(),
  categories: z.array(WisdomCategorySchema).max(10).optional(),
  maxResults: z.number().int().min(1).max(12).default(10).optional(),
});

export async function handleAnchorSearchHistory(input: unknown, cwd: string) {
  const parsed = AnchorSearchHistorySchema.safeParse(input);
  if (!parsed.success) {
    return {
      content: [{ type: "text" as const, text: `Invalid anchor_search_history input: ${parsed.error.message}` }],
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
    const units = rankWisdomUnits(db, { ...parsed.data, maxResults: parsed.data.maxResults ?? 10 });
    const formatted = formatSearchHistory(units);
    return {
      content: [{ type: "text" as const, text: formatted.markdown }],
      structuredContent: formatted.metadata,
    };
  } finally {
    db.close();
  }
}
