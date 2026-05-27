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

type ProgressTaskState = "active" | "done" | "warn" | "fail" | "wait";

type ProgressTask = {
  key: string;
  label: string;
  phase?: string;
  current?: number;
  total?: number;
  detail?: string;
  state?: ProgressTaskState;
};

type RenderedProgressTask = ProgressTask & {
  startedAt: number;
  updatedAt: number;
};

export function parseProgressMode(value: string): ProgressMode {
  if (value === "pretty" || value === "plain" || value === "off") return value;
  throw new Error("Invalid ANCHOR_PROGRESS value. Use pretty, plain, or off.");
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

function supportsColor(stream: ProgressStream): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== "0") return true;
  return Boolean(stream.isTTY);
}

function supportsUnicode(): boolean {
  if (process.env.ANCHOR_ASCII_PROGRESS === "1") return false;
  if (process.env.TERM === "dumb") return false;
  return process.platform !== "win32" || Boolean(process.env.WT_SESSION || process.env.CI);
}

function colorize(enabled: boolean, code: string, text: string): string {
  return enabled ? `\u001b[${code}m${text}\u001b[0m` : text;
}

function visibleLength(text: string): number {
  return text.replace(/\u001b\[[0-9;]*m/g, "").length;
}

function truncateEnd(text: string, maxLength: number): string {
  if (maxLength <= 0) return "";
  if (visibleLength(text) <= maxLength) return text;
  const plain = text.replace(/\u001b\[[0-9;]*m/g, "");
  return `${plain.slice(0, Math.max(0, maxLength - 1))}…`;
}

function truncateMiddle(text: string, maxLength: number): string {
  if (maxLength <= 0) return "";
  if (text.length <= maxLength) return text;
  if (maxLength < 8) return text.slice(0, maxLength);
  const left = Math.ceil((maxLength - 1) / 2);
  const right = Math.floor((maxLength - 1) / 2);
  return `${text.slice(0, left)}…${text.slice(text.length - right)}`;
}

function formatPercent(current?: number, total?: number): string {
  if (typeof current !== "number" || typeof total !== "number" || total <= 0) return "";
  return `${Math.round(Math.max(0, Math.min(1, current / total)) * 100)}%`;
}

function formatRate(task: RenderedProgressTask): string {
  if (typeof task.current !== "number" || task.current <= 0) return "";
  const seconds = Math.max(0.5, (Date.now() - task.startedAt) / 1000);
  if (seconds < 2) return "";
  const rate = task.current / seconds;
  if (rate >= 10) return `${Math.round(rate)}/s`;
  return `${rate.toFixed(1)}/s`;
}

function formatEta(task: RenderedProgressTask): string {
  if (
    typeof task.current !== "number" ||
    typeof task.total !== "number" ||
    task.current <= 0 ||
    task.current >= task.total
  ) {
    return "";
  }
  const seconds = Math.max(0.5, (Date.now() - task.startedAt) / 1000);
  if (seconds < 3) return "";
  const remaining = Math.ceil(((task.total - task.current) * seconds) / task.current);
  if (remaining < 60) return `${remaining}s left`;
  return `${Math.floor(remaining / 60)}m ${remaining % 60}s left`;
}

function progressBar(
  current: number | undefined,
  total: number | undefined,
  width: number,
  input: { unicode: boolean; color: boolean; state: ProgressTaskState },
): string {
  if (typeof current !== "number" || typeof total !== "number" || total <= 0 || width <= 0) {
    return "";
  }
  const ratio = Math.max(0, Math.min(1, current / total));
  const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
  const filledChar = input.unicode ? "━" : "=";
  const emptyChar = input.unicode ? "─" : "-";
  const headChar = input.unicode ? "╸" : ">";
  const full = filled >= width;
  const body = full
    ? filledChar.repeat(width)
    : `${filledChar.repeat(Math.max(0, filled))}${headChar}${emptyChar.repeat(
        Math.max(0, width - filled - 1),
      )}`;
  const color =
    input.state === "warn" || input.state === "wait"
      ? "33"
      : input.state === "fail"
        ? "31"
        : input.state === "done"
          ? "32"
          : "36";
  return colorize(input.color, color, body);
}

class LiveProgressRenderer {
  private readonly startedAt = Date.now();
  private readonly color: boolean;
  private readonly unicode: boolean;
  private readonly spinnerFrames: string[];
  private readonly tasks = new Map<string, RenderedProgressTask>();
  private active = false;
  private renderedLines = 0;
  private spinnerIndex = 0;

  constructor(
    private readonly stream: ProgressStream,
    private readonly title = "Anchor progress",
  ) {
    this.color = supportsColor(stream);
    this.unicode = supportsUnicode();
    this.spinnerFrames = this.unicode ? ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"] : ["-", "\\", "|", "/"];
  }

  render(task: ProgressTask): void {
    const previous = this.tasks.get(task.key);
    this.tasks.set(task.key, {
      ...previous,
      ...task,
      state: task.state ?? "active",
      startedAt: previous?.startedAt ?? Date.now(),
      updatedAt: Date.now(),
    });
    this.paint();
    this.active = true;
  }

  log(message: string): void {
    this.clear();
    this.stream.write(`${colorize(this.color, "2", message)}\n`);
  }

  close(): void {
    this.clear();
  }

  private paint(): void {
    this.clear();
    const lines = this.buildLines();
    if (lines.length === 0) return;
    this.stream.write(`${lines.join("\n")}\n`);
    this.renderedLines = lines.length;
    this.active = true;
    this.spinnerIndex = (this.spinnerIndex + 1) % this.spinnerFrames.length;
  }

  private buildLines(): string[] {
    const width = Math.max(48, this.stream.columns ?? 100);
    const header = this.renderHeader(width);
    const tasks = this.visibleTasks();
    return [header, ...tasks.map((task) => this.renderTask(task, width))].map((line) =>
      truncateEnd(line, width),
    );
  }

  private renderHeader(width: number): string {
    const title = colorize(this.color, "1;36", "Anchor");
    const elapsed = colorize(this.color, "2", `elapsed ${formatElapsed(this.startedAt)}`);
    const label = colorize(this.color, "1", this.title);
    return truncateEnd(`${title} ${colorize(this.color, "2", "›")} ${label} ${elapsed}`, width);
  }

  private visibleTasks(): RenderedProgressTask[] {
    const tasks = [...this.tasks.values()].sort((a, b) => {
      const weight = (task: RenderedProgressTask) =>
        task.state === "active" || task.state === "wait"
          ? 0
          : task.state === "warn" || task.state === "fail"
            ? 1
            : 2;
      const byWeight = weight(a) - weight(b);
      return byWeight || b.updatedAt - a.updatedAt;
    });
    return tasks.slice(0, 6);
  }

  private renderTask(task: RenderedProgressTask, width: number): string {
    const state = task.state ?? "active";
    const symbol = this.statusSymbol(state);
    const phase = task.phase ? colorize(this.color, "2", `${task.phase} `) : "";
    const label = colorize(this.color, state === "active" || state === "wait" ? "0" : "2", task.label);
    const count =
      typeof task.current === "number" && typeof task.total === "number"
        ? `${task.current}/${task.total}`
        : typeof task.current === "number"
          ? `${task.current}`
          : "";
    const percent = formatPercent(task.current, task.total);
    const rate = formatRate(task);
    const eta = formatEta(task);
    const metrics = [count, percent, rate, eta].filter(Boolean).join(" ");
    const barWidth = width >= 96 ? 24 : width >= 72 ? 16 : 10;
    const bar = progressBar(task.current, task.total, barWidth, {
      unicode: this.unicode,
      color: this.color,
      state,
    });
    const detailBudget = Math.max(14, width - 56 - barWidth);
    const detail = task.detail
      ? colorize(this.color, "2", truncateMiddle(task.detail, detailBudget))
      : "";
    return [" ", symbol, phase + label, bar, colorize(this.color, "2", metrics), detail]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trimEnd();
  }

  private statusSymbol(state: ProgressTaskState): string {
    if (state === "active") return colorize(this.color, "36", this.spinnerFrames[this.spinnerIndex] ?? "*");
    if (state === "done") return colorize(this.color, "32", this.unicode ? "✓" : "ok");
    if (state === "warn") return colorize(this.color, "33", this.unicode ? "!" : "warn");
    if (state === "fail") return colorize(this.color, "31", this.unicode ? "×" : "fail");
    return colorize(this.color, "33", this.unicode ? "…" : "wait");
  }

  private clear(): void {
    if (!this.active) return;
    for (let i = 0; i < this.renderedLines; i += 1) {
      readline.moveCursor(this.stream as NodeJS.WriteStream, 0, -1);
      readline.clearLine(this.stream as NodeJS.WriteStream, 0);
    }
    this.active = false;
    this.renderedLines = 0;
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
  title?: string;
}): AnchorProgressReporter {
  const stream = input?.stream ?? process.stderr;
  const mode = resolveProgressMode({ ...input, stream });
  const pretty = mode === "pretty" ? new LiveProgressRenderer(stream, input?.title) : undefined;
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
    case "skipped_pull_request_fetch":
      console.error(`[anchor] skipped PR fetch for ${progress.repo}. ${progress.reason}`);
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
        key: `fetch:${progress.repo}`,
        phase: "GitHub",
        label: `Finding ${fetchScope(progress)}`,
        detail: progress.backend === "graphql" ? "GitHub GraphQL" : undefined,
      };
    case "scanned_pull_request_page":
      return {
        key: `fetch:${progress.repo}`,
        phase: "GitHub",
        label: "Scanning PR pages",
        current: progress.all ? progress.scannedPullRequests : progress.matchedMergedPullRequests,
        total: progress.all ? undefined : progress.limit,
        detail: `${progress.repo} · ${progress.matchedMergedPullRequests} merged found`,
      };
    case "discovered_pull_requests":
      return {
        key: `fetch:${progress.repo}`,
        phase: "GitHub",
        label: "PR metadata ready",
        current: progress.total,
        total: progress.total,
        state: "done",
        detail:
          progress.backend === "graphql"
            ? "enriching patches with REST"
            : `fetching details with concurrency ${progress.detailConcurrency}`,
      };
    case "fetching_pull_request_details":
      return {
        key: `details:${progress.repo}`,
        phase: "REST",
        label: "Fetching PR details",
        current: progress.current,
        total: progress.total,
        detail: `#${progress.prNumber}`,
      };
    case "fetched_pull_request_details":
      return {
        key: `details:${progress.repo}`,
        phase: "REST",
        label: "Fetched PR details",
        current: progress.current,
        total: progress.total,
        state: progress.current >= progress.total ? "done" : "active",
        detail: `#${progress.prNumber}`,
      };
    case "enriching_pull_request_patches":
      return {
        key: `patches:${progress.repo}`,
        phase: "REST",
        label: "Enriching PR patches",
        current: progress.current,
        total: progress.total,
        detail: `#${progress.prNumber}`,
      };
    case "enriched_pull_request_patches":
      return {
        key: `patches:${progress.repo}`,
        phase: "REST",
        label: "Enriched PR patches",
        current: progress.current,
        total: progress.total,
        state: progress.current >= progress.total ? "done" : "active",
        detail: `#${progress.prNumber} (${progress.patches} patches)`,
      };
    case "skipped_pull_request_patch_enrichment":
      return {
        key: `patches:skipped:${progress.repo}:${progress.prNumber}`,
        phase: "REST",
        label: "Skipped PR patch enrichment",
        current: progress.current,
        total: progress.total,
        state: "warn",
        detail: `#${progress.prNumber}: ${progress.reason}`,
      };
    case "github_fetch_backend_fallback":
      return {
        key: `fallback:${progress.repo}`,
        phase: "GitHub",
        label: `Fallback from ${progress.from} to ${progress.to}`,
        state: "warn",
        detail: progress.reason,
      };
    case "github_graphql_page_size_reduced":
      return {
        key: `graphql-size:${progress.repo}`,
        phase: "GraphQL",
        label: "Reducing page size",
        state: "warn",
        detail: `${progress.previousPageSize} -> ${progress.nextPageSize}: ${progress.reason}`,
      };
    case "github_graphql_page_size_selected":
      return {
        key: `graphql-size:${progress.repo}`,
        phase: "GraphQL",
        label: "Selected page size",
        state: "done",
        detail: `${progress.previousPageSize} -> ${progress.nextPageSize}`,
      };
    case "github_graphql_budget_deferred":
      return {
        key: `graphql-budget:${progress.repo}`,
        phase: "GraphQL",
        label: "Budget reserve reached",
        current: progress.matchedMergedPullRequests,
        state: "warn",
        detail: `remaining ${progress.remaining ?? "unknown"}, reset ${progress.resetAt ?? "unknown"}`,
      };
    case "github_graphql_checkpoint_resumed":
      return {
        key: `graphql-checkpoint:${progress.repo}`,
        phase: "GraphQL",
        label: "Resuming checkpoint",
        current: progress.matchedMergedPullRequests,
        state: "done",
        detail: `page size ${progress.pageSize}`,
      };
    case "github_rate_limited":
      return {
        key: `rate-limit:${progress.repo}`,
        phase: "GitHub",
        label: "Waiting for rate limit",
        state: "wait",
        detail: `${progress.waitSeconds}s until ${progress.retryAt}`,
      };
    case "skipped_pull_request_fetch":
      return {
        key: `fetch:${progress.repo}`,
        phase: "GitHub",
        label: "Skipped PR fetch",
        state: "done",
        detail: progress.reason,
      };
  }
}

function indexTask(progress: IndexPullRequestsProgress): ProgressTask {
  return {
    key: `index-prs:${progress.repo}`,
    phase: "SQLite",
    label:
      progress.stage === "indexing_pull_request"
        ? "Indexing PR history"
        : "Indexed PR history",
    current: progress.current,
    total: progress.total,
    state:
      progress.stage === "indexed_pull_request" && progress.current >= progress.total
        ? "done"
        : "active",
    detail:
      progress.stage === "indexed_pull_request"
        ? `#${progress.prNumber} (${progress.wisdomUnitsCreated} wisdom units)`
        : `#${progress.prNumber}`,
  };
}

function codeTask(progress: CodeIndexProgress): ProgressTask {
  switch (progress.stage) {
    case "discovering_code_files":
      return {
        key: `code:${progress.repo}`,
        phase: "Code",
        label: "Discovering code files",
        detail: progress.repo,
      };
    case "discovered_code_files":
      return {
        key: `code:${progress.repo}`,
        phase: "Code",
        label: "Code files discovered",
        current: progress.files,
        total: progress.files,
        state: "done",
        detail: `${progress.skippedFiles} skipped`,
      };
    case "indexing_code_file":
      return {
        key: `code:${progress.repo}`,
        phase: "Code",
        label: "Indexing code",
        current: progress.current,
        total: progress.total,
        detail: progress.filePath,
      };
    case "indexed_code_file":
      return {
        key: `code:${progress.repo}`,
        phase: "Code",
        label: "Indexed code",
        current: progress.current,
        total: progress.total,
        state: progress.current >= progress.total ? "done" : "active",
        detail: `${progress.filePath} (${progress.chunks} chunks)`,
      };
    case "indexed_architecture":
      return {
        key: `architecture:${progress.repo}`,
        phase: "Architecture",
        label: "Indexed architecture memory",
        state: "done",
        detail: `${progress.components} components, ${progress.patterns} patterns, ${progress.imports} imports`,
      };
  }
}

function graphTask(progress: OrgGraphProgress): ProgressTask {
  switch (progress.stage) {
    case "loading_package_manifests":
      return {
        key: `graph:manifests:${progress.org}`,
        phase: "Org graph",
        label: "Reading package manifests",
        current: 0,
        total: progress.totalRepos,
      };
    case "loaded_package_manifests":
      return {
        key: `graph:manifests:${progress.org}`,
        phase: "Org graph",
        label: "Loaded package manifests",
        current: progress.repos,
        total: progress.repos,
        state: "done",
        detail: `${progress.packageNames} package names`,
      };
    case "building_package_edges":
      return {
        key: `graph:package-edges:${progress.org}`,
        phase: "Org graph",
        label: "Building package edges",
        current: progress.current,
        total: progress.total,
        state: progress.current >= progress.total ? "done" : "active",
        detail: `${progress.repo} (${progress.edges} edges)`,
      };
    case "loading_imports":
      return {
        key: `graph:imports:${progress.org}`,
        phase: "Org graph",
        label: "Loading imports",
      };
    case "building_import_edges":
      return {
        key: `graph:imports:${progress.org}`,
        phase: "Org graph",
        label: "Building import edges",
        current: progress.current,
        total: progress.total,
        state: progress.current >= progress.total ? "done" : "active",
        detail: `${progress.edges} edges`,
      };
    case "loading_code_chunks":
      return {
        key: `graph:chunks:${progress.org}`,
        phase: "Org graph",
        label: "Loading code chunks",
      };
    case "extracting_api_contracts":
      return {
        key: `graph:contracts:${progress.org}`,
        phase: "Org graph",
        label: "Extracting API contracts",
        current: progress.current,
        total: progress.total,
        state: progress.current >= progress.total ? "done" : "active",
        detail: `${progress.contracts} contracts`,
      };
    case "matching_api_consumers":
      return {
        key: `graph:consumers:${progress.org}`,
        phase: "Org graph",
        label: "Matching API consumers",
        current: progress.current,
        total: progress.total,
        state: progress.current >= progress.total ? "done" : "active",
        detail: `${progress.matches} new matches`,
      };
    case "writing_org_graph":
      return {
        key: `graph:write:${progress.org}`,
        phase: "Org graph",
        label: "Writing graph",
        detail: `${progress.edges} edges, ${progress.apiContracts} contracts, ${progress.apiConsumers} consumers`,
      };
    case "completed_org_graph":
      return {
        key: `graph:write:${progress.org}`,
        phase: "Org graph",
        label: "Graph complete",
        state: "done",
        detail: `${progress.edges} edges, ${progress.apiConsumers} consumers in ${(progress.durationMs / 1000).toFixed(1)}s`,
      };
  }
}

function cloneTask(progress: OrgCloneProgress): ProgressTask {
  if (progress.stage === "cloning_or_pulling_repo") {
    return {
      key: `clone:${progress.org}`,
      phase: "Git",
      label: "Cloning/pulling org repos",
      current: progress.current,
      total: progress.total,
      detail: progress.repo,
    };
  }
  return {
    key: `clone:${progress.org}`,
    phase: "Git",
    label: "Cloned/pulled org repos",
    current: progress.current,
    total: progress.total,
    state: progress.error ? "warn" : progress.current >= progress.total ? "done" : "active",
    detail: progress.error
      ? `${progress.repo} failed`
      : `${progress.repo} ${progress.cloned ? "cloned" : "pulled"}`,
  };
}
