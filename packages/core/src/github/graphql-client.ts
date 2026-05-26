import type { GitHubRateLimitController, GitHubGraphQLRateLimitState } from "./rate-limit.js";
import {
  requestWithGitHubRateLimit,
  updateGitHubGraphQLRateLimitState,
} from "./rate-limit.js";

export type GitHubGraphQLFetch = typeof fetch;

export type GitHubGraphQLResponse<T> = {
  data: T;
  headers: Record<string, string | number | undefined>;
};

type GitHubGraphQLErrorItem = {
  message?: string;
  type?: string;
};

type GitHubGraphQLRawResponse<T> = {
  data?: T;
  errors?: GitHubGraphQLErrorItem[];
};

export class GitHubGraphQLError extends Error {
  readonly status: number;
  readonly response: { headers: Record<string, string | number | undefined> };

  constructor(
    message: string,
    options: {
      status: number;
      headers: Record<string, string | number | undefined>;
    },
  ) {
    super(message);
    this.name = "GitHubGraphQLError";
    this.status = options.status;
    this.response = { headers: options.headers };
  }
}

function headersToRecord(headers: Headers): Record<string, string | number | undefined> {
  const result: Record<string, string | number | undefined> = {};
  headers.forEach((value, key) => {
    result[key.toLowerCase()] = value;
  });
  return result;
}

function errorStatus(status: number, errors: GitHubGraphQLErrorItem[] | undefined): number {
  if (status === 403 || status === 429) return status;
  const message = (errors ?? []).map((error) => error.message ?? "").join("\n").toLowerCase();
  if (message.includes("rate limit") || message.includes("secondary limit")) return 403;
  return status >= 400 ? status : 500;
}

function errorMessage(status: number, errors: GitHubGraphQLErrorItem[] | undefined): string {
  const messages = (errors ?? [])
    .map((error) => error.message)
    .filter((message): message is string => Boolean(message?.trim()));
  if (messages.length > 0) return messages.join("; ");
  return `GitHub GraphQL request failed with status ${status}.`;
}

export function createGitHubGraphQLRequester(options: {
  token: string;
  fetchImpl?: GitHubGraphQLFetch;
}) {
  if (!options.token.trim()) {
    throw new Error("GitHub authentication is required. Run gh auth login, or export GITHUB_TOKEN/GH_TOKEN.");
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) throw new Error("Global fetch is unavailable in this Node.js runtime.");

  return async function requestGitHubGraphQL<T extends { rateLimit?: GitHubGraphQLRateLimitState }>(
    query: string,
    variables: Record<string, unknown>,
    requestOptions: {
      controller: GitHubRateLimitController;
      requestName: string;
      maxRetries?: number;
    },
  ): Promise<GitHubGraphQLResponse<T>> {
    return requestWithGitHubRateLimit(
      async () => {
        const response = await fetchImpl("https://api.github.com/graphql", {
          method: "POST",
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${options.token}`,
            "content-type": "application/json",
            "user-agent": "anchor-local-mcp",
          },
          body: JSON.stringify({ query, variables }),
        });
        const headers = headersToRecord(response.headers);
        const raw = (await response.json()) as GitHubGraphQLRawResponse<T>;
        if (!response.ok || raw.errors?.length) {
          throw new GitHubGraphQLError(errorMessage(response.status, raw.errors), {
            status: errorStatus(response.status, raw.errors),
            headers,
          });
        }
        if (!raw.data) {
          throw new GitHubGraphQLError("GitHub GraphQL response did not include data.", {
            status: response.status,
            headers,
          });
        }
        updateGitHubGraphQLRateLimitState(
          requestOptions.controller,
          raw.data.rateLimit,
          requestOptions.requestName,
        );
        return { data: raw.data, headers };
      },
      {
        controller: requestOptions.controller,
        requestName: requestOptions.requestName,
        maxRetries: requestOptions.maxRetries,
      },
    );
  };
}
