import type { Octokit } from "@octokit/rest";
import type { FetchPullRequestsProgress, PullRequestRecord } from "../types.js";
import { createGitHubClient } from "./client.js";
import { fetchPullRequestDetails } from "./fetch-pr-details.js";
import { fetchMergedPullRequestsWithGraphQL } from "./fetch-prs-graphql.js";
import type { GitHubGraphQLFetch } from "./graphql-client.js";
import type { GitHubRateLimitController } from "./rate-limit.js";
import { requestWithGitHubRateLimit } from "./rate-limit.js";

export type FetchPullRequestsOptions = {
  token: string;
  repo: string;
  limit?: number;
  all?: boolean;
  detailConcurrency?: number;
  since?: string;
  onProgress?: (progress: FetchPullRequestsProgress) => void;
  fetchImpl?: GitHubGraphQLFetch;
  restClient?: Octokit;
};

export function resolvePullRequestFetchLimit(
  options: Pick<FetchPullRequestsOptions, "all" | "limit">,
): number | undefined {
  return options.all ? undefined : Math.max(1, Math.min(options.limit ?? 200, 1000));
}

export function resolvePullRequestDetailConcurrency(
  options: Pick<FetchPullRequestsOptions, "detailConcurrency">,
): number {
  const value = options.detailConcurrency ?? 5;
  if (!Number.isFinite(value)) return 5;
  return Math.max(1, Math.min(Math.trunc(value), 10));
}

function createProgressRateLimitController(
  repo: string,
  onProgress?: (progress: FetchPullRequestsProgress) => void,
): GitHubRateLimitController {
  return {
    onRateLimit: (progress) =>
      onProgress?.({
        stage: "github_rate_limited",
        repo,
        ...progress,
      }),
  };
}

async function fetchPullRequestDetailsConcurrently(options: {
  octokit: ReturnType<typeof createGitHubClient>;
  repo: string;
  pullNumbers: number[];
  detailConcurrency: number;
  controller: GitHubRateLimitController;
  onProgress?: (progress: FetchPullRequestsProgress) => void;
}): Promise<PullRequestRecord[]> {
  const results: Array<PullRequestRecord | undefined> = new Array(options.pullNumbers.length);
  let nextIndex = 0;
  let completed = 0;
  const workerCount = Math.min(options.detailConcurrency, options.pullNumbers.length);

  async function worker(): Promise<void> {
    while (nextIndex < options.pullNumbers.length) {
      const index = nextIndex;
      nextIndex += 1;
      const pullNumber = options.pullNumbers[index];
      if (pullNumber === undefined) continue;

      options.onProgress?.({
        stage: "fetching_pull_request_details",
        repo: options.repo,
        current: index + 1,
        total: options.pullNumbers.length,
        prNumber: pullNumber,
        detailConcurrency: options.detailConcurrency,
      });
      results[index] = await fetchPullRequestDetails(
        options.octokit,
        options.repo,
        pullNumber,
        options.controller,
      );
      completed += 1;
      options.onProgress?.({
        stage: "fetched_pull_request_details",
        repo: options.repo,
        current: completed,
        total: options.pullNumbers.length,
        prNumber: pullNumber,
        detailConcurrency: options.detailConcurrency,
      });
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results.map((result, index) => {
    if (!result) {
      throw new Error(`Failed to fetch PR details at index ${index}.`);
    }
    return result;
  });
}

async function fetchMergedPullRequestsWithRest(
  options: FetchPullRequestsOptions,
  rateLimitController: GitHubRateLimitController,
): Promise<PullRequestRecord[]> {
  const [owner, repo] = options.repo.split("/");
  if (!owner || !repo) throw new Error(`Invalid repo '${options.repo}'. Expected owner/name.`);

  const octokit = options.restClient ?? createGitHubClient(options.token);
  const limit = resolvePullRequestFetchLimit(options);
  const detailConcurrency = resolvePullRequestDetailConcurrency(options);
  const sinceTime = options.since ? Date.parse(options.since) : undefined;
  const pullNumbers: number[] = [];
  let scannedPullRequests = 0;
  let reachedSinceBoundary = false;
  let page = 1;

  options.onProgress?.({
    stage: "discovering_pull_requests",
    repo: options.repo,
    all: limit === undefined,
    limit,
    since: options.since,
    backend: "rest",
  });

  while (true) {
    const response = await requestWithGitHubRateLimit(
      () =>
        octokit.pulls.list({
          owner,
          repo,
          state: "closed",
          sort: "updated",
          direction: "desc",
          per_page: 100,
          page,
        }),
      {
        controller: rateLimitController,
        requestName: `GET /repos/${options.repo}/pulls page ${page}`,
      },
    );
    scannedPullRequests += response.data.length;
    for (const pull of response.data) {
      if (sinceTime && Date.parse(pull.updated_at) < sinceTime) {
        reachedSinceBoundary = true;
        break;
      }
      if (!pull.merged_at) continue;
      pullNumbers.push(pull.number);
      if (limit !== undefined && pullNumbers.length >= limit) break;
    }
    options.onProgress?.({
      stage: "scanned_pull_request_page",
      repo: options.repo,
      all: limit === undefined,
      limit,
      scannedPullRequests,
      matchedMergedPullRequests: pullNumbers.length,
      backend: "rest",
    });
    const hasNextPage = String(response.headers.link ?? "").includes('rel="next"');
    if (
      reachedSinceBoundary ||
      (limit !== undefined && pullNumbers.length >= limit) ||
      !hasNextPage
    ) {
      break;
    }
    page += 1;
  }

  options.onProgress?.({
    stage: "discovered_pull_requests",
    repo: options.repo,
    all: limit === undefined,
    total: pullNumbers.length,
    limit,
    detailConcurrency,
    backend: "rest",
  });

  return fetchPullRequestDetailsConcurrently({
    octokit,
    repo: options.repo,
    pullNumbers,
    detailConcurrency,
    controller: rateLimitController,
    onProgress: options.onProgress,
  });
}

export async function fetchMergedPullRequests(
  options: FetchPullRequestsOptions,
): Promise<PullRequestRecord[]> {
  const limit = resolvePullRequestFetchLimit(options);
  const detailConcurrency = resolvePullRequestDetailConcurrency(options);
  const graphqlRateLimitController = createProgressRateLimitController(
    options.repo,
    options.onProgress,
  );
  const restRateLimitController = createProgressRateLimitController(options.repo, options.onProgress);

  try {
    return await fetchMergedPullRequestsWithGraphQL({
      token: options.token,
      repo: options.repo,
      limit,
      all: options.all,
      detailConcurrency,
      since: options.since,
      controller: graphqlRateLimitController,
      restController: restRateLimitController,
      onProgress: options.onProgress,
      fetchImpl: options.fetchImpl,
      restClient: options.restClient,
    });
  } catch (error) {
    options.onProgress?.({
      stage: "github_fetch_backend_fallback",
      repo: options.repo,
      from: "graphql",
      to: "rest",
      reason: error instanceof Error ? error.message : String(error),
    });
    return fetchMergedPullRequestsWithRest(options, restRateLimitController);
  }
}
