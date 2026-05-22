export type SuggestedPrompt = {
  id: "before_edit" | "explain_file" | "strict_mode" | "review_diff";
  title: string;
  prompt: string;
};

export function getSuggestedPrompts(): SuggestedPrompt[] {
  return [
    {
      id: "before_edit",
      title: "Before edit",
      prompt:
        "Before making this non-trivial code change, call `anchor_get_context` with the task, target files, relevant symbols, and current diff if available. Summarize the historical constraints before editing.",
    },
    {
      id: "explain_file",
      title: "Explain file",
      prompt:
        "Before editing this file, call `anchor_explain_file` for the target file and summarize ownership, related PR decisions, regressions, and likely tests.",
    },
    {
      id: "strict_mode",
      title: "Strict mode",
      prompt:
        'For this risky refactor, call `anchor_get_context` with `strict: true` and `minConfidence: "moderate"`. Only use non-stale evidence and cite PRs that affect the implementation.',
    },
    {
      id: "review_diff",
      title: "Review diff",
      prompt:
        "After making the diff, call `anchor_review_diff` and list evidence-backed blockers, risks, historical constraints, regression checks, and recommended tests.",
    },
  ];
}

export function getSuggestedPromptTexts(): string[] {
  return getSuggestedPrompts().map((item) => item.prompt);
}
