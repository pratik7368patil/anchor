import { getSuggestedPrompts, type SuggestedPrompt } from "@pratik7368patil/anchor-core";

export type PromptsOptions = {
  json?: boolean;
};

export function runPrompts(): SuggestedPrompt[] {
  return getSuggestedPrompts();
}

export function printPrompts(prompts: SuggestedPrompt[], options: PromptsOptions = {}): void {
  if (options.json) {
    console.log(JSON.stringify({ prompts }, null, 2));
    return;
  }

  console.log("# Anchor Cursor Prompts");
  console.log("");
  for (const prompt of prompts) {
    console.log(`## ${prompt.title}`);
    console.log(prompt.prompt);
    console.log("");
  }
}
