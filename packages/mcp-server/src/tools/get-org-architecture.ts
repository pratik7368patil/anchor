import { z } from "zod";
import { getOrgArchitectureMap } from "@pratik7368patil/anchor-core";
import { mcpError, openOrgToolContext } from "./org-helpers.js";

export const AnchorGetOrgArchitectureSchema = z.object({
  org: z.string().min(1).optional(),
  format: z.enum(["mermaid", "json"]).default("mermaid").optional(),
});

export async function handleAnchorGetOrgArchitecture(input: unknown) {
  const parsed = AnchorGetOrgArchitectureSchema.safeParse(input);
  if (!parsed.success) {
    return mcpError(`Invalid anchor_get_org_architecture input: ${parsed.error.message}`);
  }
  try {
    const { config, db } = openOrgToolContext(parsed.data.org);
    try {
      const result = getOrgArchitectureMap(db, config, parsed.data.format ?? "mermaid");
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
