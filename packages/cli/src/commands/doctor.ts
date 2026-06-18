import { parseAnchorAgentTargets, runDoctor } from "@pratik7368patil/anchor-core";
import { createAnchorMcpServer } from "@pratik7368patil/anchor-mcp-server";

export type DoctorCommandOptions = {
  target?: string;
};

export async function runDoctorCommand(
  cwd: string,
  options: DoctorCommandOptions = {},
): Promise<boolean> {
  const report = await runDoctor({
    cwd,
    targets: options.target ? parseAnchorAgentTargets(options.target) : undefined,
    mcpServerCheck: () => Boolean(createAnchorMcpServer({ cwd })),
  });
  console.log("Anchor doctor");
  for (const item of report.checks) {
    console.log(`${item.ok ? "✓" : "✗"} ${item.name}: ${item.message}`);
    if (!item.ok && item.fix) console.log(`  Fix: ${item.fix}`);
  }
  return report.ok;
}
