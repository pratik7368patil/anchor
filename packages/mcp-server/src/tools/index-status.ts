import { z } from "zod";
import { formatIndexStatus, getIndexStatus } from "@pratik7368patil/anchor-core";

export const AnchorIndexStatusSchema = z.object({});

export async function handleAnchorIndexStatus(input: unknown, cwd: string) {
  const parsed = AnchorIndexStatusSchema.safeParse(input);
  if (!parsed.success) {
    return {
      content: [{ type: "text" as const, text: `Invalid anchor_index_status input: ${parsed.error.message}` }],
      isError: true,
    };
  }
  const formatted = formatIndexStatus(getIndexStatus(cwd));
  return {
    content: [{ type: "text" as const, text: formatted.markdown }],
    structuredContent: formatted.metadata,
  };
}
