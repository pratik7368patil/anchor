import { runAnchorServer } from "@pratik7368patil/anchor-mcp-server";

export async function runServe(cwd: string): Promise<void> {
  await runAnchorServer({ cwd });
}
