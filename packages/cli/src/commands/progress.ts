import readline from "node:readline";
import type {
  CodeIndexProgress,
  FetchPullRequestsProgress,
  IndexPullRequestsProgress,
  OrgGraphProgress,
  OrgCloneProgress,
} from "@pratik7368patil/anchor-core";

export type ProgressMode = "pretty" | "plain" | "off";

type ProgressStream = {
  isTTY?: boolean;
  columns?: number;
  write: (text: string) => boolean;
};

type ProgressTask = {
  label: string;
  current?: number;
  total?: number;
  detail?: string;
};

export function parseProgressMode(value: string): ProgressMode {
  if (value === "pretty" || value === "plain" || value === "off") return value;
  throw new Error("Invalid progress mode. Use pretty, plain, or off.");
}

function progressModeFromEnvironment(): ProgressMode | undefined {
  const value = process.env.ANCHOR_PROGRESS;
  if (!value) return undefined;
  return parseProgressMode(value);
}

function resolveProgressMode(input?: {
  progress?: ProgressMode;
  json?: boolean;
  stream?: ProgressStream;
}): ProgressMode {
  if (input?.json) return "off";
  if (input?.progress) return input.progress;
  const envMode = progressModeFromEnvironment();
  if (envMode) return envMode;
  const stream = input?.stream ?? process.stderr;
  if (process.env.CI || !stream.isTTY) return "plain";
  return "pretty";
}

function formatElapsed(startedAt: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

function progressBar(current: number, total: number, width: number): string {
  if (total <= 0) return "";
  const ratio = Math.max(0, Math.min(1, current / total));
  const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
  return `[${"=".repeat(filled)}${filled < width ? ">" : ""}${"-".repeat(Math.max(0, width - filled - (filled < width ? 1 : 0)))}]`;
}

class PrettyProgressRenderer {
  private readonly startedAt = Date.now();
  private active = false;

  constructor(private readonly stream: ProgressStream) {}

  render(task: ProgressTask): void {
    const width = Math.max(12, Math.min(28, Math.floor((this.stream.columns ?? 100) / 4)));
    const elapsed = formatElapsed(this.startedAt);
    const count =
      typeof task.current === "number" && typeof task.total === "number"
        ? `${task.current}/${task.total}`
        : "";
    const bar =
      typeof task.current === "number" && typeof task.total === "number"
        ? `${progressBar(task.current, task.total, width)} `
        : "";
    const detail = task.detail ? ` ${task.detail}` : "";
    const line = `[anchor] ${task.label} ${bar}${count}${detail} elapsed ${elapsed}`;
    readline.clearLine(this.stream as NodeJS.WriteStream, 0);
    readline.cursorTo(this.stream as NodeJS.WriteStream, 0);
    this.stream.write(line.slice(0, Math.max(20, (this.stream.columns ?? 120) - 1)));
    this.active = true;
  }

  log(message: string): void {
    this.clear();
    this.stream.write(`${message}\n`);
  }

  close(): void {
    this.clear();
  }

  private clear(): void {
    if (!this.active) return;
    readline.clearLine(this.stream as NodeJS.WriteStream, 0);
    readline.cursorTo(this.stream as NodeJS.WriteStream, 0);
    this.active = false;
  }
}

export type AnchorProgressReporter = {
  mode: ProgressMode;
  log: (message: string) => void;
  close: () => void;
  onFetchProgress: (progress: FetchPullRequestsProgress) => void;
  onPrIndexProgress: (progress: IndexPullRequestsProgress) => void;
  onCodeProgress: (progress: CodeIndexProgress) => void;
  onGraphProgress: (progress: OrgGraphProgress) => void;
  onCloneProgress: (progress: OrgCloneProgress) => void;
};

export function createProgressReporter(input?: {
  progress?: ProgressMode;
  json?: boolean;
  stream?: ProgressStream;
}): AnchorProgressReporter {
  const stream = input?.stream ?? process.stderr;
  const mode = resolveProgressMode({ ...input, stream });
  const pretty = mode === "pretty" ? new PrettyProgressRenderer(stream) : undefined;
  const log = (message: string): void => {
    if (mode === "off") return;
    if (pretty) pretty.log(message);
    else stream.write(`${message}\n`);
  };
  const render = (task: ProgressTask): void => {
    if (mode === "off") return;
    pretty?.render(task);
  };
  return {
    mode,
    log,
    close: () => pretty?.close(),
    onFetchProgress: (progress) => {
      if (mode === "plain") printFetchProgress(progress);
      else render(fetchTask(progress));
    },
    onPrIndexProgress: (progress) => {
      if (mode === "plain") printIndexProgress(progress);
      else render(indexTask(progress));
    },
    onCodeProgress: (progress) => {
      if (mode === "plain") printCodeIndexProgress(progress);
      else render(codeTask(progress));
    },
    onGraphProgress: (progress) => {
      if (mode === "plain") printOrgGraphProgress(progress);
      else render(graphTask(progress));
    },
    onCloneProgress: (progress) => {
      if (mode === "plain") printOrgCloneProgress(progress);
      else render(cloneTask(progress));
    },
  };
}

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

export function printOrgGraphProgress(progress: OrgGraphProgress): void {
  switch (progress.stage) {
    case "loading_package_manifests":
      console.error(
        `[anchor] rebuilding org graph for ${progress.org}: reading ${progress.totalRepos} repo manifests...`,
      );
      return;
    case "loaded_package_manifests":
      console.error(
        `[anchor] loaded ${progress.packageNames} package name(s) across ${progress.repos} repo(s).`,
      );
      return;
    case "building_package_edges":
      if (progress.current === 1 || progress.current === progress.total) {
        console.error(
          `[anchor] building package edges ${progress.current}/${progress.total}: ${progress.repo} (${progress.edges} edges)`,
        );
      }
      return;
    case "loading_imports":
      console.error("[anchor] loading indexed imports for org graph...");
      return;
    case "building_import_edges":
      if (
        progress.current === 1 ||
        progress.current === progress.total ||
        progress.current % 500 === 0
      ) {
        console.error(
          `[anchor] building import edges ${progress.current}/${progress.total}: ${progress.sourcePath} (${progress.edges} edges)`,
        );
      }
      return;
    case "loading_code_chunks":
      console.error("[anchor] loading code chunks for API consumer detection...");
      return;
    case "extracting_api_contracts":
      if (
        progress.current === 1 ||
        progress.current === progress.total ||
        progress.current % 500 === 0
      ) {
        console.error(
          `[anchor] extracting API contracts ${progress.current}/${progress.total}: ${progress.filePath} (${progress.contracts} contracts)`,
        );
      }
      return;
    case "matching_api_consumers":
      if (
        progress.current === 1 ||
        progress.current === progress.total ||
        progress.current % 500 === 0
      ) {
        console.error(
          `[anchor] matching API consumers ${progress.current}/${progress.total}: ${progress.filePath} (${progress.matches} matches in file)`,
        );
      }
      return;
    case "writing_org_graph":
      console.error(
        `[anchor] writing org graph: ${progress.edges} edges, ${progress.apiContracts} API contracts, ${progress.apiConsumers} API consumers...`,
      );
      return;
    case "completed_org_graph":
      console.error(
        `[anchor] org graph complete in ${(progress.durationMs / 1000).toFixed(1)}s: ${progress.edges} edges, ${progress.apiContracts} API contracts, ${progress.apiConsumers} API consumers.`,
      );
      return;
  }
}

export function printOrgCloneProgress(progress: OrgCloneProgress): void {
  switch (progress.stage) {
    case "cloning_or_pulling_repo":
      console.error(
        `[anchor] cloning or pulling repo ${progress.current}/${progress.total}: ${progress.repo}`,
      );
      return;
    case "cloned_or_pulled_repo": {
      const state = progress.error
        ? `failed: ${progress.error}`
        : progress.cloned
          ? "cloned"
          : "pulled";
      console.error(
        `[anchor] repo ${progress.current}/${progress.total} ${state}: ${progress.repo}`,
      );
      return;
    }
  }
}

function fetchTask(progress: FetchPullRequestsProgress): ProgressTask {
  switch (progress.stage) {
    case "discovering_pull_requests":
      return {
        label: `finding ${fetchScope(progress)} in ${progress.repo}`,
        detail: progress.backend === "graphql" ? "GitHub GraphQL" : undefined,
      };
    case "scanned_pull_request_page":
      return {
        label: `scanning PR pages in ${progress.repo}`,
        current: progress.all ? progress.scannedPullRequests : progress.matchedMergedPullRequests,
        total: progress.all ? undefined : progress.limit,
        detail: `${progress.matchedMergedPullRequests} merged found`,
      };
    case "discovered_pull_requests":
      return {
        label: `found merged PRs in ${progress.repo}`,
        current: progress.total,
        total: progress.total,
        detail:
          progress.backend === "graphql"
            ? "enriching patches with REST"
            : `fetching details with concurrency ${progress.detailConcurrency}`,
      };
    case "fetching_pull_request_details":
      return {
        label: `fetching PR details in ${progress.repo}`,
        current: progress.current,
        total: progress.total,
        detail: `#${progress.prNumber}`,
      };
    case "fetched_pull_request_details":
      return {
        label: `fetched PR details in ${progress.repo}`,
        current: progress.current,
        total: progress.total,
        detail: `#${progress.prNumber}`,
      };
    case "enriching_pull_request_patches":
      return {
        label: `enriching PR patches in ${progress.repo}`,
        current: progress.current,
        total: progress.total,
        detail: `#${progress.prNumber}`,
      };
    case "enriched_pull_request_patches":
      return {
        label: `enriched PR patches in ${progress.repo}`,
        current: progress.current,
        total: progress.total,
        detail: `#${progress.prNumber} (${progress.patches} patches)`,
      };
    case "skipped_pull_request_patch_enrichment":
      return {
        label: `skipped PR patch enrichment in ${progress.repo}`,
        current: progress.current,
        total: progress.total,
        detail: `#${progress.prNumber}: ${progress.reason}`,
      };
    case "github_fetch_backend_fallback":
      return {
        label: `fallback from ${progress.from} to ${progress.to}`,
        detail: progress.reason,
      };
    case "github_graphql_page_size_reduced":
      return {
        label: "reducing GitHub GraphQL page size",
        detail: `${progress.previousPageSize} -> ${progress.nextPageSize}: ${progress.reason}`,
      };
    case "github_graphql_page_size_selected":
      return {
        label: "selected GitHub GraphQL page size",
        detail: `${progress.previousPageSize} -> ${progress.nextPageSize}`,
      };
    case "github_graphql_budget_deferred":
      return {
        label: "GraphQL budget reserve reached",
        current: progress.matchedMergedPullRequests,
        detail: `remaining ${progress.remaining ?? "unknown"}, reset ${progress.resetAt ?? "unknown"}`,
      };
    case "github_graphql_checkpoint_resumed":
      return {
        label: "resuming GraphQL checkpoint",
        current: progress.matchedMergedPullRequests,
        detail: `page size ${progress.pageSize}`,
      };
    case "github_rate_limited":
      return {
        label: "waiting for GitHub rate limit",
        detail: `${progress.waitSeconds}s until ${progress.retryAt}`,
      };
  }
}

function indexTask(progress: IndexPullRequestsProgress): ProgressTask {
  return {
    label:
      progress.stage === "indexing_pull_request"
        ? `indexing PR history in ${progress.repo}`
        : `indexed PR history in ${progress.repo}`,
    current: progress.current,
    total: progress.total,
    detail:
      progress.stage === "indexed_pull_request"
        ? `#${progress.prNumber} (${progress.wisdomUnitsCreated} wisdom units)`
        : `#${progress.prNumber}`,
  };
}

function codeTask(progress: CodeIndexProgress): ProgressTask {
  switch (progress.stage) {
    case "discovering_code_files":
      return { label: `discovering code files in ${progress.repo}` };
    case "discovered_code_files":
      return {
        label: `found code files in ${progress.repo}`,
        current: progress.files,
        total: progress.files,
        detail: `${progress.skippedFiles} skipped`,
      };
    case "indexing_code_file":
      return {
        label: `indexing code in ${progress.repo}`,
        current: progress.current,
        total: progress.total,
        detail: progress.filePath,
      };
    case "indexed_code_file":
      return {
        label: `indexed code in ${progress.repo}`,
        current: progress.current,
        total: progress.total,
        detail: `${progress.filePath} (${progress.chunks} chunks)`,
      };
    case "indexed_architecture":
      return {
        label: `indexed architecture in ${progress.repo}`,
        detail: `${progress.components} components, ${progress.patterns} patterns, ${progress.imports} imports`,
      };
  }
}

function graphTask(progress: OrgGraphProgress): ProgressTask {
  switch (progress.stage) {
    case "loading_package_manifests":
      return {
        label: `reading org manifests for ${progress.org}`,
        current: 0,
        total: progress.totalRepos,
      };
    case "loaded_package_manifests":
      return {
        label: `loaded org manifests for ${progress.org}`,
        current: progress.repos,
        total: progress.repos,
        detail: `${progress.packageNames} package names`,
      };
    case "building_package_edges":
      return {
        label: `building package edges for ${progress.org}`,
        current: progress.current,
        total: progress.total,
        detail: `${progress.repo} (${progress.edges} edges)`,
      };
    case "loading_imports":
      return { label: `loading imports for ${progress.org}` };
    case "building_import_edges":
      return {
        label: `building import edges for ${progress.org}`,
        current: progress.current,
        total: progress.total,
        detail: `${progress.edges} edges`,
      };
    case "loading_code_chunks":
      return { label: `loading code chunks for ${progress.org}` };
    case "extracting_api_contracts":
      return {
        label: `extracting API contracts for ${progress.org}`,
        current: progress.current,
        total: progress.total,
        detail: `${progress.contracts} contracts`,
      };
    case "matching_api_consumers":
      return {
        label: `matching API consumers for ${progress.org}`,
        current: progress.current,
        total: progress.total,
        detail: `${progress.matches} new matches`,
      };
    case "writing_org_graph":
      return {
        label: `writing org graph for ${progress.org}`,
        detail: `${progress.edges} edges, ${progress.apiContracts} contracts, ${progress.apiConsumers} consumers`,
      };
    case "completed_org_graph":
      return {
        label: `completed org graph for ${progress.org}`,
        detail: `${progress.edges} edges, ${progress.apiConsumers} consumers in ${(progress.durationMs / 1000).toFixed(1)}s`,
      };
  }
}

function cloneTask(progress: OrgCloneProgress): ProgressTask {
  if (progress.stage === "cloning_or_pulling_repo") {
    return {
      label: `cloning/pulling org repos for ${progress.org}`,
      current: progress.current,
      total: progress.total,
      detail: progress.repo,
    };
  }
  return {
    label: `cloned/pulled org repos for ${progress.org}`,
    current: progress.current,
    total: progress.total,
    detail: progress.error
      ? `${progress.repo} failed`
      : `${progress.repo} ${progress.cloned ? "cloned" : "pulled"}`,
  };
}
