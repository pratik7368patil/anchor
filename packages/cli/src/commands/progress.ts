import type { FetchPullRequestsProgress, IndexPullRequestsProgress } from "@pratik7368patil/anchor-core";

function shouldPrintIndexProgress(progress: IndexPullRequestsProgress): boolean {
  return progress.current === 1 || progress.current === progress.total || progress.current % 25 === 0;
}

export function printFetchProgress(progress: FetchPullRequestsProgress): void {
  switch (progress.stage) {
    case "discovering_pull_requests": {
      const since = progress.since ? ` updated since ${progress.since}` : "";
      console.error(`[anchor] finding up to ${progress.limit} merged PRs in ${progress.repo}${since}...`);
      return;
    }
    case "discovered_pull_requests":
      console.error(`[anchor] found ${progress.total} merged PRs. Fetching PR details...`);
      return;
    case "fetching_pull_request_details":
      console.error(
        `[anchor] fetching PR details ${progress.current}/${progress.total}: #${progress.prNumber}`,
      );
      return;
  }
}

export function printIndexProgress(progress: IndexPullRequestsProgress): void {
  switch (progress.stage) {
    case "indexing_pull_request":
      if (progress.current === 1) console.error(`[anchor] indexing ${progress.total} PRs...`);
      return;
    case "indexed_pull_request":
      if (!shouldPrintIndexProgress(progress)) return;
      console.error(
        `[anchor] indexed PR ${progress.current}/${progress.total}: #${progress.prNumber} (${progress.wisdomUnitsCreated} wisdom units)`,
      );
      return;
  }
}
