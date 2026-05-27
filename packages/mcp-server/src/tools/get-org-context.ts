import { z } from "zod";
import { buildOrgContextResult, truncateText } from "@pratik7368patil/anchor-core";
import { mcpError, openOrgToolContext } from "./org-helpers.js";

export const AnchorGetOrgContextSchema = z.object({
  org: z.string().min(1).optional(),
  task: z.string().min(1).max(2000),
  repos: z.array(z.string().min(1)).max(25).optional(),
  files: z.array(z.string().min(1)).max(100).optional(),
  symbols: z.array(z.string().min(1)).max(100).optional(),
  diff: z.string().optional(),
  strict: z.boolean().optional(),
  maxResults: z.number().int().min(1).max(12).default(8).optional(),
});

export async function handleAnchorGetOrgContext(input: unknown) {
  const parsed = AnchorGetOrgContextSchema.safeParse(input);
  if (!parsed.success) {
    return mcpError(`Invalid anchor_get_org_context input: ${parsed.error.message}`);
  }
  try {
    const { config, db } = openOrgToolContext(parsed.data.org);
    try {
      const result = buildOrgContextResult(db, config, {
        ...parsed.data,
        diff: truncateText(parsed.data.diff, 12000),
        maxResults: parsed.data.maxResults ?? 8,
      });
      return {
        content: [{ type: "text" as const, text: result.markdown }],
        structuredContent: result.metadata,
      };
    } finally {
      db.close();
    }
  } catch (error) {
    return mcpError(error instanceof Error ? error.message : String(error));
  }
}
