import { z } from "zod";
import { findOrgApiConsumers } from "@pratik7368patil/anchor-core";
import { mcpError, openOrgToolContext } from "./org-helpers.js";

export const AnchorFindApiConsumersSchema = z.object({
  org: z.string().min(1).optional(),
  repo: z.string().min(1).optional(),
  files: z.array(z.string().min(1)).max(100).optional(),
  query: z.string().max(500).optional(),
  maxResults: z.number().int().min(1).max(25).default(8).optional(),
});

export async function handleAnchorFindApiConsumers(input: unknown) {
  const parsed = AnchorFindApiConsumersSchema.safeParse(input);
  if (!parsed.success) {
    return mcpError(`Invalid anchor_find_api_consumers input: ${parsed.error.message}`);
  }
  try {
    const { config, db } = openOrgToolContext(parsed.data.org);
    try {
      const consumers = findOrgApiConsumers(db, config, parsed.data);
      const lines = ["# Anchor API Consumers", ""];
      if (consumers.length === 0) lines.push("- No matching API consumers found.");
      else {
        for (const consumer of consumers) {
          const evidence = consumer.evidence[0];
          const evidenceText =
            evidence?.prNumber && evidence.prNumber > 0
              ? `PR #${evidence.prNumber}`
              : evidence?.filePath
                ? `file ${evidence.filePath}`
                : "local org index";
          lines.push(
            `- ${consumer.consumerRepo}:${consumer.consumerPath} consumes ${consumer.providerRepo} ${consumer.contract}. Evidence: ${evidenceText}.`,
          );
        }
      }
      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        structuredContent: { org: config.org, apiConsumers: consumers },
      };
    } finally {
      db.close();
    }
  } catch (error) {
    return mcpError(error instanceof Error ? error.message : String(error));
  }
}
