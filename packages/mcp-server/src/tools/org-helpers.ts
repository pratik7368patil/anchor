import {
  type AnchorDatabase,
  type AnchorOrgConfig,
  loadOrgConfig,
  openOrgDatabase,
  resolveOrgForTool,
} from "@pratik7368patil/anchor-core";

export function openOrgToolContext(org?: string): { config: AnchorOrgConfig; db: AnchorDatabase } {
  const resolvedOrg = resolveOrgForTool(org);
  const config = loadOrgConfig(resolvedOrg);
  const db = openOrgDatabase(config.org);
  return { config, db };
}

export function mcpError(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}
