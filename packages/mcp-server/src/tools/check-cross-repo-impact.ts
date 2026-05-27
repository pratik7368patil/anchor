import { z } from "zod";
import { checkOrgImpact, truncateText } from "@pratik7368patil/anchor-core";
import { mcpError, openOrgToolContext } from "./org-helpers.js";

export const AnchorCheckCrossRepoImpactSchema = z.object({
  org: z.string().min(1).optional(),
  repo: z.string().min(1).optional(),
  diff: z.string().optional(),
  files: z.array(z.string().min(1)).max(100).optional(),
  task: z.string().max(2000).optional(),
  strict: z.boolean().optional(),
  maxResults: z.number().int().min(1).max(12).default(8).optional(),
});

export async function handleAnchorCheckCrossRepoImpact(input: unknown) {
  const parsed = AnchorCheckCrossRepoImpactSchema.safeParse(input);
  if (!parsed.success) {
    return mcpError(`Invalid anchor_check_cross_repo_impact input: ${parsed.error.message}`);
  }
  try {
    const { config, db } = openOrgToolContext(parsed.data.org);
    try {
      const result = checkOrgImpact(db, config, {
        ...parsed.data,
        diff: truncateText(parsed.data.diff, 12000),
        maxResults: parsed.data.maxResults ?? 8,
      });
      return {
        content: [{ type: "text" as const, text: result.markdown }],
        structuredContent: result.metadata,
        isError: parsed.data.strict && !result.metadata.ok,
      };
    } finally {
      db.close();
    }
  } catch (error) {
    return mcpError(error instanceof Error ? error.message : String(error));
  }
}
