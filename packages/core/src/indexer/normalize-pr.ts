import type { PullRequestRecord } from "../types.js";

export function normalizePullRequest(input: PullRequestRecord): PullRequestRecord {
  return {
    ...input,
    body: input.body ?? "",
    labels: input.labels ?? [],
    merged_at: input.merged_at ?? undefined,
    updated_at: input.updated_at ?? input.merged_at ?? input.created_at,
    files: input.files ?? [],
    reviews: input.reviews ?? [],
    reviewComments: input.reviewComments ?? [],
    issueComments: input.issueComments ?? [],
    commits: input.commits ?? [],
  };
}
