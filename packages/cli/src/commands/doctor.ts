import { runDoctor } from "@anchor/core";
import { createAnchorMcpServer } from "@anchor/mcp-server";

export async function runDoctorCommand(cwd: string): Promise<boolean> {
  const report = await runDoctor({
    cwd,
    mcpServerCheck: () => Boolean(createAnchorMcpServer({ cwd })),
  });
  console.log("Anchor doctor");
  for (const item of report.checks) {
    console.log(`${item.ok ? "✓" : "✗"} ${item.name}: ${item.message}`);
    if (!item.ok && item.fix) console.log(`  Fix: ${item.fix}`);
  }
  return report.ok;
}
