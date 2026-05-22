import fs from "node:fs";
import { z } from "zod";
import {
  defaultDatabasePath,
  formatAnchorContext,
  getIndexStatus,
  initializeSchema,
  openAnchorDatabase,
  rankCodeChunks,
  rankTeamRules,
  rankWisdomUnits,
  truncateText,
} from "@pratik7368patil/anchor-core";

export const AnchorGetContextSchema = z.object({
  task: z.string().min(1).max(2000),
  files: z.array(z.string().min(1)).max(50).optional(),
  symbols: z.array(z.string().min(1)).max(100).optional(),
  diff: z.string().optional(),
  currentCode: z.string().optional(),
  maxResults: z.number().int().min(1).max(12).default(8).optional(),
  strict: z.boolean().optional(),
  minConfidence: z.enum(["strong", "moderate", "weak"]).optional(),
});

export async function handleAnchorGetContext(input: unknown, cwd: string) {
  const parsed = AnchorGetContextSchema.safeParse(input);
  if (!parsed.success) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Invalid anchor_get_context input: ${parsed.error.message}`,
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
    const query = {
      ...parsed.data,
      diff: truncateText(parsed.data.diff, 12000),
      currentCode: truncateText(parsed.data.currentCode, 12000),
      maxResults: parsed.data.maxResults ?? 8,
    };
    const units = rankWisdomUnits(db, query);
    const codeChunks = rankCodeChunks(db, query);
    const teamRules = rankTeamRules(db, cwd, query);
    const status = getIndexStatus(cwd);
    const warnings =
      query.strict && status.historyCoverage !== "all"
        ? [
            `Strict mode is using ${status.historyCoverage ?? "unknown"} history coverage; run anchor index-all for full-history evidence.`,
          ]
        : [];
    const formatted = formatAnchorContext(units, query, codeChunks, teamRules, warnings);
    return {
      content: [{ type: "text" as const, text: formatted.markdown }],
      structuredContent: formatted.metadata,
    };
  } finally {
    db.close();
  }
}
