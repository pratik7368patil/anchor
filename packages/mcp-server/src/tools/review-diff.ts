import fs from "node:fs";
import { z } from "zod";
import {
  defaultDatabasePath,
  initializeSchema,
  openAnchorDatabase,
  reviewDiff,
  truncateText,
} from "@pratik7368patil/anchor-core";

export const AnchorReviewDiffSchema = z.object({
  diff: z.string().min(1).max(50000),
  files: z.array(z.string().min(1)).max(50).optional(),
  strict: z.boolean().optional(),
  maxResults: z.number().int().min(1).max(12).default(8).optional(),
});

export async function handleAnchorReviewDiff(input: unknown, cwd: string) {
  const parsed = AnchorReviewDiffSchema.safeParse(input);
  if (!parsed.success) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Invalid anchor_review_diff input: ${parsed.error.message}`,
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
    const formatted = reviewDiff(db, cwd, {
      ...parsed.data,
      diff: truncateText(parsed.data.diff, 50000),
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
