import {
  getSuggestedPrompts,
  type PromptTarget,
  type SuggestedPrompt,
} from "@pratik7368patil/anchor-core";

export type PromptsOptions = {
  json?: boolean;
  target?: PromptTarget;
};

export function runPrompts(options: PromptsOptions = {}): SuggestedPrompt[] {
  return getSuggestedPrompts(normalizePromptTarget(options.target));
}

export function printPrompts(prompts: SuggestedPrompt[], options: PromptsOptions = {}): void {
  if (options.json) {
    console.log(JSON.stringify({ prompts }, null, 2));
    return;
  }

  console.log(`# Anchor ${labelForTarget(normalizePromptTarget(options.target))} Prompts`);
  console.log("");
  for (const prompt of prompts) {
    console.log(`## ${prompt.title}`);
    console.log(prompt.prompt);
    console.log("");
  }
}

function normalizePromptTarget(target?: string): PromptTarget {
  if (!target) return "cursor";
  if (
    target === "cursor" ||
    target === "claude-code" ||
    target === "codex" ||
    target === "vscode" ||
    target === "antigravity" ||
    target === "generic"
  ) {
    return target;
  }
  throw new Error("Invalid prompt target. Use cursor, claude-code, codex, vscode, antigravity, or generic.");
}

function labelForTarget(target: PromptTarget): string {
  const labels: Record<PromptTarget, string> = {
    cursor: "Cursor",
    "claude-code": "Claude Code",
    codex: "Codex",
    vscode: "VS Code",
    antigravity: "Antigravity",
    generic: "Generic Agent",
  };
  return labels[target];
}
