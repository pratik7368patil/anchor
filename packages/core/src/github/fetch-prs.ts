import type { PullRequestRecord } from "../types.js";
import { createGitHubClient } from "./client.js";
import { fetchPullRequestDetails } from "./fetch-pr-details.js";

export type FetchPullRequestsOptions = {
  token: string;
  repo: string;
  limit?: number;
  since?: string;
};

export async function fetchMergedPullRequests(
  options: FetchPullRequestsOptions,
): Promise<PullRequestRecord[]> {
  const [owner, repo] = options.repo.split("/");
  if (!owner || !repo) throw new Error(`Invalid repo '${options.repo}'. Expected owner/name.`);

  const octokit = createGitHubClient(options.token);
  const limit = Math.max(1, Math.min(options.limit ?? 200, 1000));
  const sinceTime = options.since ? Date.parse(options.since) : undefined;
  const pullNumbers: number[] = [];

  for await (const response of octokit.paginate.iterator(octokit.pulls.list, {
    owner,
    repo,
    state: "closed",
    sort: "updated",
    direction: "desc",
    per_page: 50,
  })) {
    for (const pull of response.data) {
      if (!pull.merged_at) continue;
      if (sinceTime && Date.parse(pull.updated_at) < sinceTime) {
        continue;
      }
      pullNumbers.push(pull.number);
      if (pullNumbers.length >= limit) break;
    }
    if (pullNumbers.length >= limit) break;
  }

  const details: PullRequestRecord[] = [];
  for (const pullNumber of pullNumbers) {
    details.push(await fetchPullRequestDetails(octokit, options.repo, pullNumber));
  }
  return details;
}
