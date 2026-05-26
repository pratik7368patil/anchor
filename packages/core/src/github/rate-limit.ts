export type GitHubRateLimitProgress = {
  waitSeconds: number;
  retryAt: string;
  reason: string;
  request: string;
  attempt: number;
};

export type GitHubRateLimitController = {
  onRateLimit?: (progress: GitHubRateLimitProgress) => void;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  blockedUntilMs?: number;
};

export type GitHubGraphQLRateLimitState = {
  cost?: number | null;
  remaining?: number | null;
  resetAt?: string | null;
};

export type GitHubRateLimitErrorLike = {
  status?: number;
  message?: string;
  response?: {
    headers?: Record<string, string | number | undefined>;
  };
};

type GitHubResponse<T> = {
  data: T;
  headers: Record<string, string | number | undefined>;
};

export function isGitHubRateLimitError(error: unknown): error is GitHubRateLimitErrorLike {
  const candidate = error as GitHubRateLimitErrorLike;
  if (candidate.status !== 403 && candidate.status !== 429) return false;
  const message = candidate.message?.toLowerCase() ?? "";
  const headers = candidate.response?.headers ?? {};
  return (
    candidate.status === 429 ||
    headers["retry-after"] !== undefined ||
    headers["x-ratelimit-remaining"] === "0" ||
    message.includes("rate limit") ||
    message.includes("secondary limit")
  );
}

export function getGitHubRateLimitDelayMs(
  error: GitHubRateLimitErrorLike,
  attempt: number,
  now = Date.now(),
): { delayMs: number; reason: string } {
  const headers = error.response?.headers ?? {};
  const retryAfter = Number(headers["retry-after"]);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return {
      delayMs: Math.ceil(retryAfter * 1000),
      reason: `retry-after header requested ${Math.ceil(retryAfter)} seconds`,
    };
  }

  const remaining = String(headers["x-ratelimit-remaining"] ?? "");
  const reset = Number(headers["x-ratelimit-reset"]);
  if (remaining === "0" && Number.isFinite(reset) && reset > 0) {
    const resetDelayMs = Math.max(0, reset * 1000 - now);
    return {
      delayMs: Math.ceil(resetDelayMs + 2000),
      reason: `primary rate limit resets at ${new Date(reset * 1000).toISOString()}`,
    };
  }

  const backoffSeconds = Math.min(900, 60 * 2 ** Math.max(0, attempt - 1));
  return {
    delayMs: backoffSeconds * 1000,
    reason: `secondary rate limit backoff for ${backoffSeconds} seconds`,
  };
}

export function isGitHubGraphQLResourceLimitError(error: unknown): boolean {
  const message = ((error as { message?: string }).message ?? "").toLowerCase();
  return (
    message.includes("resource limit") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("couldn't respond") ||
    message.includes("could not respond") ||
    (message.includes("exceeded") && message.includes("node")) ||
    (message.includes("exceeds") && message.includes("node")) ||
    message.includes("possible nodes") ||
    message.includes("maximum limit of 500,000")
  );
}

export function updateGitHubGraphQLRateLimitState(
  controller: GitHubRateLimitController,
  rateLimit: GitHubGraphQLRateLimitState | undefined,
  requestName: string,
): void {
  if (!rateLimit || rateLimit.remaining !== 0 || !rateLimit.resetAt) return;
  const resetAtMs = Date.parse(rateLimit.resetAt);
  if (!Number.isFinite(resetAtMs)) return;
  const now = controller.now?.() ?? Date.now();
  const retryAtMs = Math.max(resetAtMs + 2000, now);
  controller.blockedUntilMs = Math.max(controller.blockedUntilMs ?? 0, retryAtMs);
  controller.onRateLimit?.({
    waitSeconds: Math.ceil(Math.max(0, retryAtMs - now) / 1000),
    retryAt: new Date(retryAtMs).toISOString(),
    reason: `GraphQL rate limit exhausted${rateLimit.cost ? ` after query cost ${rateLimit.cost}` : ""}`,
    request: requestName,
    attempt: 1,
  });
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForGlobalBlock(controller: GitHubRateLimitController): Promise<void> {
  const now = controller.now?.() ?? Date.now();
  const waitMs = Math.max(0, (controller.blockedUntilMs ?? 0) - now);
  if (waitMs > 0) {
    await (controller.sleep ?? sleep)(waitMs);
  }
}

export async function requestWithGitHubRateLimit<T>(
  request: () => Promise<T>,
  options: {
    controller: GitHubRateLimitController;
    requestName: string;
    maxRetries?: number;
  },
): Promise<T> {
  const maxRetries = options.maxRetries ?? 8;
  for (let attempt = 1; ; attempt += 1) {
    await waitForGlobalBlock(options.controller);
    try {
      return await request();
    } catch (error) {
      if (!isGitHubRateLimitError(error) || attempt > maxRetries) throw error;
      const now = options.controller.now?.() ?? Date.now();
      const { delayMs, reason } = getGitHubRateLimitDelayMs(error, attempt, now);
      const retryAtMs = now + delayMs;
      options.controller.blockedUntilMs = Math.max(
        options.controller.blockedUntilMs ?? 0,
        retryAtMs,
      );
      options.controller.onRateLimit?.({
        waitSeconds: Math.ceil(delayMs / 1000),
        retryAt: new Date(retryAtMs).toISOString(),
        reason,
        request: options.requestName,
        attempt,
      });
      await (options.controller.sleep ?? sleep)(delayMs);
    }
  }
}

function hasNextPage(headers: Record<string, string | number | undefined>): boolean {
  return String(headers.link ?? "").includes('rel="next"');
}

export async function paginateWithGitHubRateLimit<T>(
  requestPage: (page: number) => Promise<GitHubResponse<T[]>>,
  options: {
    controller: GitHubRateLimitController;
    requestName: string;
    maxRetries?: number;
  },
): Promise<T[]> {
  const results: T[] = [];
  for (let page = 1; ; page += 1) {
    const response = await requestWithGitHubRateLimit(() => requestPage(page), {
      controller: options.controller,
      requestName: `${options.requestName} page ${page}`,
      maxRetries: options.maxRetries,
    });
    results.push(...response.data);
    if (!hasNextPage(response.headers) && response.data.length < 100) break;
    if (!hasNextPage(response.headers) && response.data.length === 0) break;
    if (!hasNextPage(response.headers)) break;
  }
  return results;
}
