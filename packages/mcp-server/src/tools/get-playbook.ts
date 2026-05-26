import { z } from "zod";
import { getPlaybook } from "@pratik7368patil/anchor-core";

export const AnchorGetPlaybookSchema = z.object({
  id: z.string().min(1).max(200),
});

export async function handleAnchorGetPlaybook(input: unknown, cwd: string) {
  const parsed = AnchorGetPlaybookSchema.safeParse(input);
  if (!parsed.success) {
    return {
      content: [{ type: "text" as const, text: `Invalid anchor_get_playbook input: ${parsed.error.message}` }],
      isError: true,
    };
  }
  const playbook = getPlaybook(cwd, parsed.data.id);
  if (!playbook) {
    return {
      content: [{ type: "text" as const, text: `Playbook not found: ${parsed.data.id}` }],
      isError: true,
    };
  }
  const markdown = [
    `# ${playbook.title}`,
    "",
    playbook.body,
    "",
    "Evidence:",
    ...playbook.evidence.map((evidence) => `- PR #${evidence.prNumber}: ${evidence.prUrl}`),
  ].join("\n");
  return {
    content: [{ type: "text" as const, text: markdown }],
    structuredContent: { playbooks: [playbook] },
  };
}
