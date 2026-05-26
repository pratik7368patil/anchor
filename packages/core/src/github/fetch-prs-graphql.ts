import type { Octokit } from "@octokit/rest";
import type {
  FetchPullRequestsProgress,
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

const INITIAL_PULL_REQUEST_PAGE_SIZE = 25;
const REDUCED_PULL_REQUEST_PAGE_SIZES = [10, 5];
const CONNECTION_PAGE_SIZE = 100;

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

export type FetchMergedPullRequestsGraphQLOptions = {
  token: string;
  repo: string;
  limit?: number;
  all?: boolean;
  detailConcurrency: number;
  since?: string;
  controller: GitHubRateLimitController;
  restController?: GitHubRateLimitController;
  onProgress?: (progress: FetchPullRequestsProgress) => void;
  fetchImpl?: GitHubGraphQLFetch;
  restClient?: Octokit;
};

type RequestGraphQL = ReturnType<typeof createGitHubGraphQLRequester>;

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

function connectionNodes<T>(connection: GraphQLConnection<T> | null | undefined): T[] {
  return (connection?.nodes ?? []).filter((node): node is T => Boolean(node));
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
  },
): Promise<GraphQLConnection<TNode> | null | undefined> {
  const response: GitHubGraphQLResponse<PullRequestConnectionQueryData<TConnectionName, TNode>> =
    await requestGraphQL(query, variables, options);
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
  },
): Promise<void> {
  let info = pageInfo(review.comments);
  while (info.hasNextPage && info.endCursor) {
    const response: GitHubGraphQLResponse<PullRequestReviewCommentsQueryData> =
      await requestGraphQL(
        REVIEW_COMMENTS_QUERY,
        {
          reviewId: review.id,
          first: CONNECTION_PAGE_SIZE,
          after: info.endCursor,
        },
        {
          controller: options.controller,
          requestName: `GraphQL /pull-request-reviews/${review.id}/comments`,
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
  let scannedPullRequests = 0;
  let reachedSinceBoundary = false;
  let cursor: string | null | undefined;
  let pageSize = Math.min(INITIAL_PULL_REQUEST_PAGE_SIZE, options.limit ?? INITIAL_PULL_REQUEST_PAGE_SIZE);

  options.onProgress?.({
    stage: "discovering_pull_requests",
    repo: options.repo,
    all: options.limit === undefined,
    limit: options.limit,
    since: options.since,
    backend: "graphql",
  });

  while (true) {
    let response: GitHubGraphQLResponse<PullRequestsQueryData>;
    try {
      response = await requestGraphQL(
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
      });
      records.push(record);
      if (options.limit !== undefined && records.length >= options.limit) break;
    }

    options.onProgress?.({
      stage: "scanned_pull_request_page",
      repo: options.repo,
      all: options.limit === undefined,
      limit: options.limit,
      scannedPullRequests,
      matchedMergedPullRequests: records.length,
      backend: "graphql",
      pageSize,
    });

    const info = pageInfo(connection);
    if (
      reachedSinceBoundary ||
      (options.limit !== undefined && records.length >= options.limit) ||
      !info.hasNextPage ||
      !info.endCursor
    ) {
      break;
    }
    cursor = info.endCursor;
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
