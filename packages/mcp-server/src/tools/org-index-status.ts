import { z } from "zod";
import { getOrgStatus } from "@pratik7368patil/anchor-core";
import { mcpError, openOrgToolContext } from "./org-helpers.js";

export const AnchorOrgIndexStatusSchema = z.object({
  org: z.string().min(1).optional(),
});

export async function handleAnchorOrgIndexStatus(input: unknown) {
  const parsed = AnchorOrgIndexStatusSchema.safeParse(input);
  if (!parsed.success) {
    return mcpError(`Invalid anchor_org_index_status input: ${parsed.error.message}`);
  }
  try {
    const { config, db } = openOrgToolContext(parsed.data.org);
    try {
      const status = getOrgStatus(db, config);
      const lines = [
        "# Anchor Org Index Status",
        "",
        `Org: ${status.org}`,
        `Repos: ${status.enabledRepoCount}/${status.repoCount} enabled`,
        `Cloned repos: ${status.clonedRepoCount}`,
        `Code files: ${status.codeFileCount}`,
        `Code chunks: ${status.codeChunkCount}`,
        `Wisdom units: ${status.wisdomUnitCount}`,
        `Cross-repo edges: ${status.crossRepoEdgeCount}`,
        `API consumers: ${status.apiConsumerCount}`,
        `Coverage: ${status.coverageScore}% (${status.coverageGrade})`,
      ];
      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        structuredContent: status,
      };
    } finally {
      db.close();
    }
  } catch (error) {
    return mcpError(error instanceof Error ? error.message : String(error));
  }
}
