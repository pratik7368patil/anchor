import fs from "node:fs";
import { z } from "zod";
import {
  buildOnboardingPack,
  defaultDatabasePath,
  initializeSchema,
  openAnchorDatabase,
} from "@pratik7368patil/anchor-core";

export const AnchorOnboardingPackSchema = z.object({
  file: z.string().min(1).max(500).optional(),
  area: z
    .enum([
      "api",
      "service",
      "component",
      "hook",
      "route",
      "store",
      "test",
      "schema",
      "type",
      "config",
      "util",
      "unknown",
    ])
    .optional(),
});

export async function handleAnchorOnboardingPack(input: unknown, cwd: string) {
  const parsed = AnchorOnboardingPackSchema.safeParse(input);
  if (!parsed.success) {
    return {
      content: [{ type: "text" as const, text: `Invalid anchor_onboarding_pack input: ${parsed.error.message}` }],
      isError: true,
    };
  }
  const databasePath = defaultDatabasePath(cwd);
  if (!fs.existsSync(databasePath)) {
    return {
      content: [{ type: "text" as const, text: `Anchor index not found at ${databasePath}. Run anchor index-code first.` }],
      isError: true,
    };
  }
  const db = openAnchorDatabase(cwd, databasePath);
  try {
    initializeSchema(db);
    const formatted = buildOnboardingPack(db, cwd, parsed.data);
    return {
      content: [{ type: "text" as const, text: formatted.markdown }],
      structuredContent: formatted.metadata,
    };
  } finally {
    db.close();
  }
}
