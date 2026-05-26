export type SuggestedPrompt = {
  id:
    | "before_edit"
    | "plan_task"
    | "test_command"
    | "explain_file"
    | "strict_mode"
    | "review_diff"
    | "onboarding"
    | "playbook";
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
      id: "plan_task",
      title: "Plan task",
      prompt:
        "Before implementing this task, call `anchor_plan_task` with the task, target files, and likely symbols. Summarize target files, risks, implementation steps, and exact test commands before editing.",
    },
    {
      id: "test_command",
      title: "Test command",
      prompt:
        "Before editing this file, call `anchor_get_test_commands` for the target file and keep the strongest exact command ready for verification after the change.",
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
        "After making the diff, call `anchor_review_diff` and list evidence-backed blockers, risks, historical constraints, architecture concerns, regression checks, and exact test commands.",
    },
    {
      id: "onboarding",
      title: "Onboarding",
      prompt:
        "Before working in an unfamiliar area, call `anchor_onboarding_pack` for the file or architecture area and summarize important files, risky modules, tests, playbooks, and starter prompts.",
    },
    {
      id: "playbook",
      title: "Playbook",
      prompt:
        "If this task matches a repeated workflow, call `anchor_get_playbook` for the relevant playbook id and use it as cited evidence, not as executable instructions.",
    },
  ];
}

export function getSuggestedPromptTexts(): string[] {
  return getSuggestedPrompts().map((item) => item.prompt);
}
