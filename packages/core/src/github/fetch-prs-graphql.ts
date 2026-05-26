import type { Octokit } from "@octokit/rest";
import type {
  FetchPullRequestsProgress,
  GitHubGraphQLFetchCheckpoint,
  PullRequestComment,
  PullRequestFile,
  PullRequestRecord,
} from "../types.js";
import { createGitHubClient } from "./client.js";
import {
  createGitHubGraphQLRequester,
  type GitHubGraphQLFetch,
  type GitHubGraphQLResponse,
} from "./graphql-client.js";
import type { GitHubRateLimitController, GitHubGraphQLRateLimitState } from "./rate-limit.js";
import {
  isGitHubRateLimitError,
  isGitHubGraphQLResourceLimitError,
  paginateWithGitHubRateLimit,
} from "./rate-limit.js";

const MIN_PULL_REQUEST_PAGE_SIZE = 5;
const INITIAL_PULL_REQUEST_PAGE_SIZE = 40;
const MAX_PULL_REQUEST_PAGE_SIZE = 45;
const REDUCED_PULL_REQUEST_PAGE_SIZES = [10, 5];
const CONNECTION_PAGE_SIZE = 100;
const GRAPHQL_RATE_LIMIT_RESERVE = 250;

type GraphQLPageInfo = {
  hasNextPage: boolean;
  endCursor?: string | null;
};

type GraphQLConnection<T> = {
  nodes?: Array<T | null> | null;
  pageInfo?: GraphQLPageInfo | null;
};

type GraphQLActor = {
  login?: string | null;
};

type GraphQLLabel = {
  name?: string | null;
};

type GraphQLChangedFile = {
  path?: string | null;
  additions?: number | null;
  deletions?: number | null;
};

type GraphQLIssueComment = {
  author?: GraphQLActor | null;
  body?: string | null;
  createdAt?: string | null;
};

type GraphQLReviewComment = {
  author?: GraphQLActor | null;
  body?: string | null;
  path?: string | null;
  createdAt?: string | null;
};

type GraphQLReview = {
  id: string;
  author?: GraphQLActor | null;
  body?: string | null;
  submittedAt?: string | null;
  comments?: GraphQLConnection<GraphQLReviewComment> | null;
};

type GraphQLCommitNode = {
  commit?: {
    message?: string | null;
  } | null;
};

type GraphQLPullRequest = {
  number: number;
  url: string;
  title: string;
  body?: string | null;
  author?: GraphQLActor | null;
  labels?: GraphQLConnection<GraphQLLabel> | null;
  createdAt: string;
  mergedAt?: string | null;
  updatedAt?: string | null;
  files?: GraphQLConnection<GraphQLChangedFile> | null;
  comments?: GraphQLConnection<GraphQLIssueComment> | null;
  reviews?: GraphQLConnection<GraphQLReview> | null;
  commits?: GraphQLConnection<GraphQLCommitNode> | null;
};

type PullRequestsQueryData = {
  repository?: {
    pullRequests?: GraphQLConnection<GraphQLPullRequest> | null;
  } | null;
  rateLimit?: GitHubGraphQLRateLimitState;
};

type PullRequestConnectionQueryData<TConnectionName extends string, TNode> = {
  repository?: {
    pullRequest?: Record<TConnectionName, GraphQLConnection<TNode> | null> | null;
  } | null;
  rateLimit?: GitHubGraphQLRateLimitState;
};

type PullRequestReviewCommentsQueryData = {
  node?: {
    comments?: GraphQLConnection<GraphQLReviewComment> | null;
  } | null;
  rateLimit?: GitHubGraphQLRateLimitState;
};

type RateLimitQueryData = {
  rateLimit?: GitHubGraphQLRateLimitState;
};

export type FetchMergedPullRequestsGraphQLOptions = {
  token: string;
  repo: string;
  limit?: number;
  all?: boolean;
  detailConcurrency: number;
  since?: string;
  controller: GitHubRateLimitController;
  restController?: GitHubRateLimitController;
  graphQLCheckpoint?: GitHubGraphQLFetchCheckpoint;
  onGraphQLCheckpoint?: (checkpoint: GitHubGraphQLFetchCheckpoint | null) => void;
  onProgress?: (progress: FetchPullRequestsProgress) => void;
  fetchImpl?: GitHubGraphQLFetch;
  restClient?: Octokit;
};

type RequestGraphQL = ReturnType<typeof createGitHubGraphQLRequester>;

type GraphQLBudgetDecision = {
  pageSize: number;
  averageCostPerPr?: number;
};

class GraphQLBudget {
  private activePageCost = 0;
  private averageCostPerPr: number | undefined;
  private latestRateLimit: GitHubGraphQLRateLimitState | undefined;

  constructor(private readonly reserve: number) {}

  beginPage(): void {
    this.activePageCost = 0;
  }

  observe(rateLimit: GitHubGraphQLRateLimitState | undefined): void {
    this.latestRateLimit = rateLimit ?? this.latestRateLimit;
    if (typeof rateLimit?.cost === "number" && Number.isFinite(rateLimit.cost)) {
      this.activePageCost += Math.max(0, rateLimit.cost);
    }
  }

  completePage(prCount: number): void {
    if (prCount <= 0 || this.activePageCost <= 0) return;
    const pageCostPerPr = this.activePageCost / prCount;
    this.averageCostPerPr =
      this.averageCostPerPr === undefined
        ? pageCostPerPr
        : this.averageCostPerPr * 0.65 + pageCostPerPr * 0.35;
  }

  shouldDefer(): boolean {
    const remaining = this.latestRateLimit?.remaining;
    return typeof remaining === "number" && remaining <= this.reserve;
  }

  rateLimit(): GitHubGraphQLRateLimitState | undefined {
    return this.latestRateLimit;
  }

  choosePageSize(currentPageSize: number, remainingPrs?: number): GraphQLBudgetDecision {
    const remaining = this.latestRateLimit?.remaining;
    const averageCostPerPr = this.averageCostPerPr;
    if (
      typeof remaining !== "number" ||
      remaining <= this.reserve ||
      averageCostPerPr === undefined ||
      averageCostPerPr <= 0
    ) {
      return { pageSize: currentPageSize, averageCostPerPr };
    }

    const safeBudget = Math.max(0, remaining - this.reserve);
    const budgetPageSize = Math.max(
      MIN_PULL_REQUEST_PAGE_SIZE,
      Math.min(MAX_PULL_REQUEST_PAGE_SIZE, Math.floor(safeBudget / averageCostPerPr)),
    );
    const growthLimitedPageSize =
      budgetPageSize > currentPageSize
        ? Math.min(budgetPageSize, currentPageSize * 2)
        : budgetPageSize;
    const cappedPageSize =
      remainingPrs === undefined
        ? growthLimitedPageSize
        : Math.min(growthLimitedPageSize, Math.max(MIN_PULL_REQUEST_PAGE_SIZE, remainingPrs));
    return {
      pageSize: Math.max(MIN_PULL_REQUEST_PAGE_SIZE, Math.min(MAX_PULL_REQUEST_PAGE_SIZE, cappedPageSize)),
      averageCostPerPr,
    };
  }
}

const PULL_REQUEST_FIELDS = `
  number
  url
  title
  body
  createdAt
  mergedAt
  updatedAt
  author { login }
  labels(first: 100) {
    nodes { name }
    pageInfo { hasNextPage endCursor }
  }
  files(first: 100) {
    nodes { path additions deletions }
    pageInfo { hasNextPage endCursor }
  }
  comments(first: 100) {
    nodes { author { login } body createdAt }
    pageInfo { hasNextPage endCursor }
  }
  reviews(first: 100) {
    nodes {
      id
      author { login }
      body
      submittedAt
      comments(first: 100) {
        nodes { author { login } body path createdAt }
        pageInfo { hasNextPage endCursor }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
  commits(first: 100) {
    nodes { commit { message } }
    pageInfo { hasNextPage endCursor }
  }
`;

const LIST_MERGED_PULL_REQUESTS_QUERY = `
query AnchorMergedPullRequests($owner: String!, $name: String!, $first: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: MERGED, orderBy: { field: UPDATED_AT, direction: DESC }, first: $first, after: $after) {
      nodes {
        ${PULL_REQUEST_FIELDS}
      }
      pageInfo { hasNextPage endCursor }
    }
  }
  rateLimit { cost remaining resetAt }
}
`;

const PULL_REQUEST_FILES_QUERY = `
query AnchorPullRequestFiles($owner: String!, $name: String!, $number: Int!, $first: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      files(first: $first, after: $after) {
        nodes { path additions deletions }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
  rateLimit { cost remaining resetAt }
}
`;

const PULL_REQUEST_COMMENTS_QUERY = `
query AnchorPullRequestComments($owner: String!, $name: String!, $number: Int!, $first: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      comments(first: $first, after: $after) {
        nodes { author { login } body createdAt }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
  rateLimit { cost remaining resetAt }
}
`;

const PULL_REQUEST_REVIEWS_QUERY = `
query AnchorPullRequestReviews($owner: String!, $name: String!, $number: Int!, $first: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviews(first: $first, after: $after) {
        nodes {
          id
          author { login }
          body
          submittedAt
          comments(first: 100) {
            nodes { author { login } body path createdAt }
            pageInfo { hasNextPage endCursor }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
  rateLimit { cost remaining resetAt }
}
`;

const PULL_REQUEST_COMMITS_QUERY = `
query AnchorPullRequestCommits($owner: String!, $name: String!, $number: Int!, $first: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      commits(first: $first, after: $after) {
        nodes { commit { message } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
  rateLimit { cost remaining resetAt }
}
`;

const REVIEW_COMMENTS_QUERY = `
query AnchorPullRequestReviewComments($reviewId: ID!, $first: Int!, $after: String) {
  node(id: $reviewId) {
    ... on PullRequestReview {
      comments(first: $first, after: $after) {
        nodes { author { login } body path createdAt }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
  rateLimit { cost remaining resetAt }
}
`;

const RATE_LIMIT_QUERY = `
query AnchorGraphQLRateLimit {
  rateLimit { cost remaining resetAt }
}
`;

function connectionNodes<T>(connection: GraphQLConnection<T> | null | undefined): T[] {
  return (connection?.nodes ?? []).filter((node): node is T => Boolean(node));
}

async function requestGraphQLWithBudget<T extends { rateLimit?: GitHubGraphQLRateLimitState }>(
  requestGraphQL: RequestGraphQL,
  query: string,
  variables: Record<string, unknown>,
  options: {
    controller: GitHubRateLimitController;
    requestName: string;
    budget: GraphQLBudget;
  },
): Promise<GitHubGraphQLResponse<T>> {
  const response = await requestGraphQL<T>(query, variables, {
    controller: options.controller,
    requestName: options.requestName,
  });
  options.budget.observe(response.data.rateLimit);
  return response;
}

function pageInfo(connection: GraphQLConnection<unknown> | null | undefined): GraphQLPageInfo {
  return connection?.pageInfo ?? { hasNextPage: false, endCursor: null };
}

function labelName(label: GraphQLLabel): { name: string } | undefined {
  return label.name ? { name: label.name } : undefined;
}

function mapChangedFile(file: GraphQLChangedFile): PullRequestFile | undefined {
  if (!file.path) return undefined;
  return {
    filename: file.path,
    additions: file.additions ?? 0,
    deletions: file.deletions ?? 0,
  };
}

function mapIssueComment(comment: GraphQLIssueComment): PullRequestComment {
  return {
    user: comment.author?.login ? { login: comment.author.login } : null,
    body: comment.body ?? "",
    created_at: comment.createdAt ?? undefined,
  };
}

function mapReviewComment(comment: GraphQLReviewComment): PullRequestComment {
  return {
    user: comment.author?.login ? { login: comment.author.login } : null,
    body: comment.body ?? "",
    path: comment.path ?? undefined,
    created_at: comment.createdAt ?? undefined,
  };
}

function mapReviewSummary(review: GraphQLReview): PullRequestComment {
  return {
    user: review.author?.login ? { login: review.author.login } : null,
    body: review.body ?? "",
    created_at: review.submittedAt ?? undefined,
    submitted_at: review.submittedAt ?? undefined,
  };
}

function mapPullRequest(repo: string, pull: GraphQLPullRequest): PullRequestRecord {
  return {
    repo,
    number: pull.number,
    html_url: pull.url,
    title: pull.title,
    body: pull.body ?? "",
    user: pull.author?.login ? { login: pull.author.login } : null,
    labels: connectionNodes(pull.labels).map(labelName).filter((label): label is { name: string } => Boolean(label)),
    created_at: pull.createdAt,
    merged_at: pull.mergedAt ?? undefined,
    updated_at: pull.updatedAt ?? pull.mergedAt ?? pull.createdAt,
    files: connectionNodes(pull.files)
      .map(mapChangedFile)
      .filter((file): file is PullRequestFile => Boolean(file)),
    reviews: connectionNodes(pull.reviews).map(mapReviewSummary),
    reviewComments: connectionNodes(pull.reviews).flatMap((review) =>
      connectionNodes(review.comments).map(mapReviewComment),
    ),
    issueComments: connectionNodes(pull.comments).map(mapIssueComment),
    commits: connectionNodes(pull.commits).map((commit) => ({
      commit: { message: commit.commit?.message ?? "" },
    })),
  };
}

async function requestConnection<TConnectionName extends string, TNode>(
  requestGraphQL: RequestGraphQL,
  query: string,
  connectionName: TConnectionName,
  variables: Record<string, unknown>,
  options: {
    controller: GitHubRateLimitController;
    requestName: string;
    budget: GraphQLBudget;
  },
): Promise<GraphQLConnection<TNode> | null | undefined> {
  const response: GitHubGraphQLResponse<PullRequestConnectionQueryData<TConnectionName, TNode>> =
    await requestGraphQLWithBudget(requestGraphQL, query, variables, options);
  return response.data.repository?.pullRequest?.[connectionName];
}

async function appendAdditionalFiles(
  requestGraphQL: RequestGraphQL,
  record: PullRequestRecord,
  initialConnection: GraphQLConnection<GraphQLChangedFile> | null | undefined,
  options: {
    owner: string;
    name: string;
    controller: GitHubRateLimitController;
    budget: GraphQLBudget;
  },
): Promise<void> {
  let info = pageInfo(initialConnection);
  while (info.hasNextPage && info.endCursor) {
    const connection = await requestConnection<"files", GraphQLChangedFile>(
      requestGraphQL,
      PULL_REQUEST_FILES_QUERY,
      "files",
      {
        owner: options.owner,
        name: options.name,
        number: record.number,
        first: CONNECTION_PAGE_SIZE,
        after: info.endCursor,
      },
      {
        controller: options.controller,
        requestName: `GraphQL /repos/${record.repo}/pulls/${record.number}/files`,
        budget: options.budget,
      },
    );
    record.files.push(
      ...connectionNodes(connection)
        .map(mapChangedFile)
        .filter((file): file is PullRequestFile => Boolean(file)),
    );
    info = pageInfo(connection);
  }
}

async function appendAdditionalIssueComments(
  requestGraphQL: RequestGraphQL,
  record: PullRequestRecord,
  initialConnection: GraphQLConnection<GraphQLIssueComment> | null | undefined,
  options: {
    owner: string;
    name: string;
    controller: GitHubRateLimitController;
    budget: GraphQLBudget;
  },
): Promise<void> {
  let info = pageInfo(initialConnection);
  while (info.hasNextPage && info.endCursor) {
    const connection = await requestConnection<"comments", GraphQLIssueComment>(
      requestGraphQL,
      PULL_REQUEST_COMMENTS_QUERY,
      "comments",
      {
        owner: options.owner,
        name: options.name,
        number: record.number,
        first: CONNECTION_PAGE_SIZE,
        after: info.endCursor,
      },
      {
        controller: options.controller,
        requestName: `GraphQL /repos/${record.repo}/issues/${record.number}/comments`,
        budget: options.budget,
      },
    );
    record.issueComments?.push(...connectionNodes(connection).map(mapIssueComment));
    info = pageInfo(connection);
  }
}

async function appendAdditionalCommits(
  requestGraphQL: RequestGraphQL,
  record: PullRequestRecord,
  initialConnection: GraphQLConnection<GraphQLCommitNode> | null | undefined,
  options: {
    owner: string;
    name: string;
    controller: GitHubRateLimitController;
    budget: GraphQLBudget;
  },
): Promise<void> {
  let info = pageInfo(initialConnection);
  while (info.hasNextPage && info.endCursor) {
    const connection = await requestConnection<"commits", GraphQLCommitNode>(
      requestGraphQL,
      PULL_REQUEST_COMMITS_QUERY,
      "commits",
      {
        owner: options.owner,
        name: options.name,
        number: record.number,
        first: CONNECTION_PAGE_SIZE,
        after: info.endCursor,
      },
      {
        controller: options.controller,
        requestName: `GraphQL /repos/${record.repo}/pulls/${record.number}/commits`,
        budget: options.budget,
      },
    );
    record.commits?.push(
      ...connectionNodes(connection).map((commit) => ({
        commit: { message: commit.commit?.message ?? "" },
      })),
    );
    info = pageInfo(connection);
  }
}

async function appendAdditionalReviewComments(
  requestGraphQL: RequestGraphQL,
  record: PullRequestRecord,
  review: GraphQLReview,
  options: {
    controller: GitHubRateLimitController;
    budget: GraphQLBudget;
  },
): Promise<void> {
  let info = pageInfo(review.comments);
  while (info.hasNextPage && info.endCursor) {
    const response: GitHubGraphQLResponse<PullRequestReviewCommentsQueryData> =
      await requestGraphQLWithBudget(
        requestGraphQL,
        REVIEW_COMMENTS_QUERY,
        {
          reviewId: review.id,
          first: CONNECTION_PAGE_SIZE,
          after: info.endCursor,
        },
        {
          controller: options.controller,
          requestName: `GraphQL /pull-request-reviews/${review.id}/comments`,
          budget: options.budget,
        },
      );
    const connection = response.data.node?.comments;
    record.reviewComments?.push(...connectionNodes(connection).map(mapReviewComment));
    info = pageInfo(connection);
  }
}

async function appendAdditionalReviews(
  requestGraphQL: RequestGraphQL,
  record: PullRequestRecord,
  initialConnection: GraphQLConnection<GraphQLReview> | null | undefined,
  options: {
    owner: string;
    name: string;
    controller: GitHubRateLimitController;
    budget: GraphQLBudget;
  },
): Promise<void> {
  const reviewsToHydrate = [...connectionNodes(initialConnection)];
  let info = pageInfo(initialConnection);
  while (info.hasNextPage && info.endCursor) {
    const connection = await requestConnection<"reviews", GraphQLReview>(
      requestGraphQL,
      PULL_REQUEST_REVIEWS_QUERY,
      "reviews",
      {
        owner: options.owner,
        name: options.name,
        number: record.number,
        first: CONNECTION_PAGE_SIZE,
        after: info.endCursor,
      },
      {
        controller: options.controller,
        requestName: `GraphQL /repos/${record.repo}/pulls/${record.number}/reviews`,
        budget: options.budget,
      },
    );
    const reviewNodes = connectionNodes(connection);
    reviewsToHydrate.push(...reviewNodes);
    record.reviews?.push(...reviewNodes.map(mapReviewSummary));
    record.reviewComments?.push(
      ...reviewNodes.flatMap((review) => connectionNodes(review.comments).map(mapReviewComment)),
    );
    info = pageInfo(connection);
  }

  for (const review of reviewsToHydrate) {
    await appendAdditionalReviewComments(requestGraphQL, record, review, {
      controller: options.controller,
      budget: options.budget,
    });
  }
}

async function hydratePullRequestNestedConnections(
  requestGraphQL: RequestGraphQL,
  record: PullRequestRecord,
  pull: GraphQLPullRequest,
  options: {
    owner: string;
    name: string;
    controller: GitHubRateLimitController;
    budget: GraphQLBudget;
  },
): Promise<void> {
  await appendAdditionalFiles(requestGraphQL, record, pull.files, options);
  await appendAdditionalIssueComments(requestGraphQL, record, pull.comments, options);
  await appendAdditionalReviews(requestGraphQL, record, pull.reviews, options);
  await appendAdditionalCommits(requestGraphQL, record, pull.commits, options);
}

function mergePatchFiles(record: PullRequestRecord, patchFiles: PullRequestFile[]): number {
  const byFilename = new Map(patchFiles.map((file) => [file.filename, file]));
  let patches = 0;
  record.files = record.files.map((file) => {
    const patchFile = byFilename.get(file.filename);
    if (!patchFile) return file;
    if (patchFile.patch) patches += 1;
    return {
      ...file,
      additions: patchFile.additions ?? file.additions,
      deletions: patchFile.deletions ?? file.deletions,
      patch: patchFile.patch ?? file.patch,
    };
  });

  const existing = new Set(record.files.map((file) => file.filename));
  for (const patchFile of patchFiles) {
    if (!existing.has(patchFile.filename)) {
      record.files.push(patchFile);
      if (patchFile.patch) patches += 1;
    }
  }
  return patches;
}

async function fetchPullRequestPatchFiles(
  octokit: Octokit,
  repoFullName: string,
  pullNumber: number,
  controller: GitHubRateLimitController,
): Promise<PullRequestFile[]> {
  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo) throw new Error(`Invalid repo '${repoFullName}'. Expected owner/name.`);
  const files = await paginateWithGitHubRateLimit(
    (page) =>
      octokit.pulls.listFiles({
        owner,
        repo,
        pull_number: pullNumber,
        per_page: 100,
        page,
      }),
    {
      controller,
      requestName: `GET /repos/${repoFullName}/pulls/${pullNumber}/files`,
      maxRetries: 0,
    },
  );
  return files.map((file) => ({
    filename: file.filename,
    patch: "patch" in file ? file.patch : undefined,
    additions: file.additions,
    deletions: file.deletions,
  }));
}

async function enrichPullRequestPatchesWithRest(options: {
  records: PullRequestRecord[];
  repo: string;
  token: string;
  detailConcurrency: number;
  controller: GitHubRateLimitController;
  onProgress?: (progress: FetchPullRequestsProgress) => void;
  restClient?: Octokit;
}): Promise<void> {
  const octokit = options.restClient ?? createGitHubClient(options.token);
  let nextIndex = 0;
  let completed = 0;
  const workerCount = Math.min(options.detailConcurrency, options.records.length);

  async function worker(): Promise<void> {
    while (nextIndex < options.records.length) {
      const index = nextIndex;
      nextIndex += 1;
      const record = options.records[index];
      if (!record) continue;
      options.onProgress?.({
        stage: "enriching_pull_request_patches",
        repo: options.repo,
        current: index + 1,
        total: options.records.length,
        prNumber: record.number,
        detailConcurrency: options.detailConcurrency,
      });
      try {
        const patchFiles = await fetchPullRequestPatchFiles(
          octokit,
          options.repo,
          record.number,
          options.controller,
        );
        const patches = mergePatchFiles(record, patchFiles);
        completed += 1;
        options.onProgress?.({
          stage: "enriched_pull_request_patches",
          repo: options.repo,
          current: completed,
          total: options.records.length,
          prNumber: record.number,
          detailConcurrency: options.detailConcurrency,
          patches,
        });
      } catch (error) {
        completed += 1;
        if (!isGitHubRateLimitError(error)) {
          options.onProgress?.({
            stage: "skipped_pull_request_patch_enrichment",
            repo: options.repo,
            current: completed,
            total: options.records.length,
            prNumber: record.number,
            reason: error instanceof Error ? error.message : String(error),
          });
          continue;
        }
        options.onProgress?.({
          stage: "skipped_pull_request_patch_enrichment",
          repo: options.repo,
          current: completed,
          total: options.records.length,
          prNumber: record.number,
          reason: "GitHub REST rate limit reached during patch enrichment",
        });
      }
    }
  }

  if (workerCount > 0) await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

function nextReducedPageSize(current: number): number | undefined {
  return REDUCED_PULL_REQUEST_PAGE_SIZES.find((candidate) => candidate < current);
}

function checkpointFromState(options: {
  repo: string;
  scope: string;
  cursor?: string | null;
  scannedPullRequests: number;
  matchedMergedPullRequests: number;
  pageSize: number;
  rateLimit?: GitHubGraphQLRateLimitState;
  reason: string;
}): GitHubGraphQLFetchCheckpoint {
  return {
    repo: options.repo,
    scope: options.scope,
    cursor: options.cursor ?? null,
    scannedPullRequests: options.scannedPullRequests,
    matchedMergedPullRequests: options.matchedMergedPullRequests,
    pageSize: options.pageSize,
    resetAt: options.rateLimit?.resetAt ?? undefined,
    reason: options.reason,
    updatedAt: new Date().toISOString(),
  };
}

export async function fetchMergedPullRequestsWithGraphQL(
  options: FetchMergedPullRequestsGraphQLOptions,
): Promise<PullRequestRecord[]> {
  const [owner, name] = options.repo.split("/");
  if (!owner || !name) throw new Error(`Invalid repo '${options.repo}'. Expected owner/name.`);

  const requestGraphQL = createGitHubGraphQLRequester({
    token: options.token,
    fetchImpl: options.fetchImpl,
  });
  const sinceTime = options.since ? Date.parse(options.since) : undefined;
  const records: PullRequestRecord[] = [];
  const checkpoint = options.graphQLCheckpoint;
  const baseScannedPullRequests = checkpoint?.scannedPullRequests ?? 0;
  const baseMatchedMergedPullRequests = checkpoint?.matchedMergedPullRequests ?? 0;
  let scannedPullRequests = baseScannedPullRequests;
  let reachedSinceBoundary = false;
  let cursor: string | null | undefined = checkpoint?.cursor ?? undefined;
  let pageSize = Math.min(
    MAX_PULL_REQUEST_PAGE_SIZE,
    checkpoint?.pageSize ?? Math.min(INITIAL_PULL_REQUEST_PAGE_SIZE, options.limit ?? INITIAL_PULL_REQUEST_PAGE_SIZE),
  );
  const budget = new GraphQLBudget(GRAPHQL_RATE_LIMIT_RESERVE);
  const checkpointScope =
    checkpoint?.scope ??
    `${options.repo}|${options.limit === undefined ? "all" : `limit:${options.limit}`}|since:${options.since ?? ""}`;

  options.onProgress?.({
    stage: "discovering_pull_requests",
    repo: options.repo,
    all: options.limit === undefined,
    limit: options.limit,
    since: options.since,
    backend: "graphql",
  });
  if (checkpoint) {
    options.onProgress?.({
      stage: "github_graphql_checkpoint_resumed",
      repo: options.repo,
      scannedPullRequests: checkpoint.scannedPullRequests,
      matchedMergedPullRequests: checkpoint.matchedMergedPullRequests,
      pageSize: checkpoint.pageSize,
      resetAt: checkpoint.resetAt,
    });
  }
  await requestGraphQLWithBudget<RateLimitQueryData>(
    requestGraphQL,
    RATE_LIMIT_QUERY,
    {},
    {
      controller: options.controller,
      requestName: "GraphQL rate limit preflight",
      budget,
    },
  );
  const preflightRateLimit = budget.rateLimit();
  if (budget.shouldDefer()) {
    options.onGraphQLCheckpoint?.(
      checkpointFromState({
        repo: options.repo,
        scope: checkpointScope,
        cursor: cursor ?? null,
        scannedPullRequests,
        matchedMergedPullRequests: baseMatchedMergedPullRequests,
        pageSize,
        rateLimit: preflightRateLimit,
        reason: "GraphQL budget safety reserve reached before fetching another page",
      }),
    );
    options.onProgress?.({
      stage: "github_graphql_budget_deferred",
      repo: options.repo,
      remaining: preflightRateLimit?.remaining,
      reserve: GRAPHQL_RATE_LIMIT_RESERVE,
      resetAt: preflightRateLimit?.resetAt,
      matchedMergedPullRequests: baseMatchedMergedPullRequests,
    });
    return records;
  }
  if (typeof preflightRateLimit?.remaining === "number") {
    const preflightPageSize = Math.max(
      MIN_PULL_REQUEST_PAGE_SIZE,
      Math.min(
        pageSize,
        Math.floor((preflightRateLimit.remaining - GRAPHQL_RATE_LIMIT_RESERVE) / 4),
      ),
    );
    if (preflightPageSize !== pageSize) {
      options.onProgress?.({
        stage: "github_graphql_page_size_selected",
        repo: options.repo,
        previousPageSize: pageSize,
        nextPageSize: preflightPageSize,
        remaining: preflightRateLimit.remaining,
      });
      pageSize = preflightPageSize;
    }
  }

  while (true) {
    let response: GitHubGraphQLResponse<PullRequestsQueryData>;
    budget.beginPage();
    try {
      response = await requestGraphQLWithBudget(
        requestGraphQL,
        LIST_MERGED_PULL_REQUESTS_QUERY,
        {
          owner,
          name,
          first: pageSize,
          after: cursor ?? null,
        },
        {
          controller: options.controller,
          requestName: `GraphQL /repos/${options.repo}/pullRequests`,
          budget,
        },
      );
    } catch (error) {
      const reducedPageSize = isGitHubGraphQLResourceLimitError(error)
        ? nextReducedPageSize(pageSize)
        : undefined;
      if (!reducedPageSize) throw error;
      options.onProgress?.({
        stage: "github_graphql_page_size_reduced",
        repo: options.repo,
        previousPageSize: pageSize,
        nextPageSize: reducedPageSize,
        reason: error instanceof Error ? error.message : String(error),
      });
      pageSize = reducedPageSize;
      continue;
    }

    const connection = response.data.repository?.pullRequests;
    const pullNodes = connectionNodes(connection);
    scannedPullRequests += pullNodes.length;
    const recordsBeforePage = records.length;
    for (const pull of pullNodes) {
      if (sinceTime && Date.parse(pull.updatedAt ?? pull.mergedAt ?? pull.createdAt) < sinceTime) {
        reachedSinceBoundary = true;
        break;
      }
      if (!pull.mergedAt) continue;
      const record = mapPullRequest(options.repo, pull);
      await hydratePullRequestNestedConnections(requestGraphQL, record, pull, {
        owner,
        name,
        controller: options.controller,
        budget,
      });
      records.push(record);
      if (options.limit !== undefined && records.length >= options.limit) break;
    }
    const pageMatchedPullRequests = records.length - recordsBeforePage;
    budget.completePage(pageMatchedPullRequests);

    options.onProgress?.({
      stage: "scanned_pull_request_page",
      repo: options.repo,
      all: options.limit === undefined,
      limit: options.limit,
      scannedPullRequests,
      matchedMergedPullRequests: baseMatchedMergedPullRequests + records.length,
      backend: "graphql",
      pageSize,
    });

    const info = pageInfo(connection);
    const totalMatchedMergedPullRequests = baseMatchedMergedPullRequests + records.length;
    if (info.hasNextPage && info.endCursor && budget.shouldDefer()) {
      const rateLimit = budget.rateLimit();
      const checkpointToSave = checkpointFromState({
        repo: options.repo,
        scope: checkpointScope,
        cursor: info.endCursor,
        scannedPullRequests,
        matchedMergedPullRequests: totalMatchedMergedPullRequests,
        pageSize,
        rateLimit,
        reason: "GraphQL budget safety reserve reached",
      });
      options.onGraphQLCheckpoint?.(checkpointToSave);
      options.onProgress?.({
        stage: "github_graphql_budget_deferred",
        repo: options.repo,
        remaining: rateLimit?.remaining,
        reserve: GRAPHQL_RATE_LIMIT_RESERVE,
        resetAt: rateLimit?.resetAt,
        matchedMergedPullRequests: totalMatchedMergedPullRequests,
      });
      break;
    }
    if (
      reachedSinceBoundary ||
      (options.limit !== undefined && records.length >= options.limit) ||
      !info.hasNextPage ||
      !info.endCursor
    ) {
      options.onGraphQLCheckpoint?.(null);
      break;
    }
    cursor = info.endCursor;
    const remainingPrs =
      options.limit === undefined
        ? undefined
        : Math.max(0, options.limit - records.length);
    const decision = budget.choosePageSize(pageSize, remainingPrs);
    if (decision.pageSize !== pageSize) {
      options.onProgress?.({
        stage: "github_graphql_page_size_selected",
        repo: options.repo,
        previousPageSize: pageSize,
        nextPageSize: decision.pageSize,
        remaining: budget.rateLimit()?.remaining,
        averageCostPerPr: decision.averageCostPerPr,
      });
      pageSize = decision.pageSize;
    }
  }

  options.onProgress?.({
    stage: "discovered_pull_requests",
    repo: options.repo,
    all: options.limit === undefined,
    total: records.length,
    limit: options.limit,
    detailConcurrency: options.detailConcurrency,
    backend: "graphql",
  });

  await enrichPullRequestPatchesWithRest({
    records,
    repo: options.repo,
    token: options.token,
    detailConcurrency: options.detailConcurrency,
    controller: options.restController ?? options.controller,
    onProgress: options.onProgress,
    restClient: options.restClient,
  });

  return records;
}
