import type {
  CodeIndexProgress,
  FetchPullRequestsProgress,
  IndexPullRequestsProgress,
} from "@pratik7368patil/anchor-core";

function shouldPrintIndexProgress(progress: IndexPullRequestsProgress): boolean {
  return (
    progress.current === 1 || progress.current === progress.total || progress.current % 25 === 0
  );
}

function fetchScope(progress: { all: boolean; limit?: number }): string {
  return progress.all ? "all merged PRs" : `up to ${progress.limit ?? 200} merged PRs`;
}

export function printFetchProgress(progress: FetchPullRequestsProgress): void {
  switch (progress.stage) {
    case "discovering_pull_requests": {
      const since = progress.since ? ` updated since ${progress.since}` : "";
      const backend = progress.backend === "graphql" ? " with GitHub GraphQL" : "";
      console.error(
        `[anchor] finding ${fetchScope(progress)} in ${progress.repo}${since}${backend}...`,
      );
      return;
    }
    case "scanned_pull_request_page":
      if (
        progress.all &&
        (progress.scannedPullRequests <= 100 || progress.scannedPullRequests % 500 === 0)
      ) {
        console.error(
          `[anchor] scanned ${progress.scannedPullRequests} closed PRs, found ${progress.matchedMergedPullRequests} merged PRs...`,
        );
      }
      return;
    case "discovered_pull_requests":
      console.error(
        progress.backend === "graphql"
          ? `[anchor] found ${progress.total} merged PRs with GraphQL. Enriching PR patches with REST concurrency ${progress.detailConcurrency}...`
          : `[anchor] found ${progress.total} merged PRs. Fetching PR details with concurrency ${progress.detailConcurrency}...`,
      );
      return;
    case "fetching_pull_request_details":
      if (progress.current <= progress.detailConcurrency) {
        console.error(
          `[anchor] fetching PR details ${progress.current}/${progress.total}: #${progress.prNumber}`,
        );
      }
      return;
    case "fetched_pull_request_details":
      if (
        progress.current === 1 ||
        progress.current === progress.total ||
        progress.current % 25 === 0
      ) {
        console.error(
          `[anchor] fetched PR details ${progress.current}/${progress.total}: #${progress.prNumber}`,
        );
      }
      return;
    case "enriching_pull_request_patches":
      if (progress.current <= progress.detailConcurrency) {
        console.error(
          `[anchor] enriching PR patches ${progress.current}/${progress.total}: #${progress.prNumber}`,
        );
      }
      return;
    case "enriched_pull_request_patches":
      if (
        progress.current === 1 ||
        progress.current === progress.total ||
        progress.current % 25 === 0
      ) {
        console.error(
          `[anchor] enriched PR patches ${progress.current}/${progress.total}: #${progress.prNumber} (${progress.patches} patches)`,
        );
      }
      return;
    case "skipped_pull_request_patch_enrichment":
      console.error(
        `[anchor] skipped PR patch enrichment ${progress.current}/${progress.total}: #${progress.prNumber}. ${progress.reason}.`,
      );
      return;
    case "github_fetch_backend_fallback":
      console.error(
        `[anchor] ${progress.from} fetch failed; falling back to ${progress.to}. ${progress.reason}.`,
      );
      return;
    case "github_graphql_page_size_reduced":
      console.error(
        `[anchor] GitHub GraphQL query was too expensive; reducing page size from ${progress.previousPageSize} to ${progress.nextPageSize}. ${progress.reason}.`,
      );
      return;
    case "github_graphql_page_size_selected": {
      const cost = progress.averageCostPerPr
        ? ` Average observed cost: ${progress.averageCostPerPr.toFixed(2)} points/PR.`
        : "";
      console.error(
        `[anchor] adjusted GraphQL PR page size from ${progress.previousPageSize} to ${progress.nextPageSize}.${cost}`,
      );
      return;
    }
    case "github_graphql_budget_deferred":
      console.error(
        `[anchor] GraphQL budget safety reserve reached (${progress.remaining ?? "unknown"} remaining, reserve ${progress.reserve}). Indexed ${progress.matchedMergedPullRequests} merged PRs so far; rerun the same command after ${progress.resetAt ?? "the GitHub reset"} to resume.`,
      );
      return;
    case "github_graphql_checkpoint_resumed":
      console.error(
        `[anchor] resuming GraphQL PR fetch checkpoint after ${progress.matchedMergedPullRequests} merged PRs (page size ${progress.pageSize}).`,
      );
      return;
    case "github_rate_limited":
      console.error(
        `[anchor] GitHub rate limit hit while ${progress.request}. Waiting ${progress.waitSeconds}s until ${progress.retryAt}. ${progress.reason}.`,
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

function shouldPrintCodeProgress(progress: CodeIndexProgress): boolean {
  return (
    "current" in progress &&
    (progress.current === 1 || progress.current === progress.total || progress.current % 100 === 0)
  );
}

export function printCodeIndexProgress(progress: CodeIndexProgress): void {
  switch (progress.stage) {
    case "discovering_code_files":
      console.error(
        `[anchor] discovering git-tracked and non-ignored code files in ${progress.repo}...`,
      );
      return;
    case "discovered_code_files":
      console.error(
        `[anchor] found ${progress.files} code files to index (${progress.skippedFiles} skipped).`,
      );
      return;
    case "indexing_code_file":
      if (progress.current === 1)
        console.error(`[anchor] indexing ${progress.total} code files...`);
      return;
    case "indexed_code_file":
      if (!shouldPrintCodeProgress(progress)) return;
      console.error(
        `[anchor] indexed code file ${progress.current}/${progress.total}: ${progress.filePath} (${progress.chunks} chunks)`,
      );
      return;
    case "indexed_architecture":
      console.error(
        `[anchor] indexed architecture memory: ${progress.components} components, ${progress.patterns} patterns, ${progress.imports} imports.`,
      );
      return;
  }
}
