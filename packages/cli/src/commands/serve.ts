import { runAnchorServer } from "@anchor/mcp-server";

export async function runServe(cwd: string): Promise<void> {
  await runAnchorServer({ cwd });
}
