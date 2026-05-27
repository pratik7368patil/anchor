import fs from "node:fs";
import { fetchMergedPullRequests } from "../github/fetch-prs.js";
import { indexCodebase } from "../indexer/code-indexer.js";
import { indexPullRequests } from "../indexer/index-runner.js";
import type {
  FetchPullRequestsProgress,
  IndexPullRequestsProgress,
  CodeIndexProgress,
  OrgLifecycleProgress,
  OrgGraphProgress,
} from "../types.js";
import type { AnchorDatabase } from "../db/database.js";
import { getLastSyncTime, initializeSchema } from "../db/database.js";
import type { AnchorOrgConfig, CodeIndexSummary, IndexSummary } from "../types.js";
import { resolveGitHubToken } from "../utils/github-token.js";
import { orgRepoLocalPath } from "./config.js";
import { defaultGitCommandRunner, type GitCommandRunner } from "./clone.js";
import {
  getOrgRepoState,
  getOrgGraphState,
  getOrgGraphCounts,
  recordOrgIndexRun,
  recordOrgGraphState,
  syncOrgConfigToDatabase,
  updateOrgRepoState,
} from "./database.js";
import { rebuildOrgGraph } from "./graph.js";

const ORG_SYNC_RESUME_WINDOW_MS = 12 * 60 * 60 * 1000;

export type OrgRepoIndexResult = {
  repo: string;
  skippedCode: boolean;
  skippedHistory?: boolean;
  historySkippedReason?: string;
  currentCommit?: string;
  history?: IndexSummary;
  code?: CodeIndexSummary;
  error?: string;
};

export type OrgIndexResult = {
  org: string;
  repos: OrgRepoIndexResult[];
  graph: {
    edges: number;
    apiConsumers: number;
    apiContracts: number;
    skipped?: boolean;
    error?: string;
  };
};

export type OrgIndexOptions = {
  repo?: string;
  codeOnly?: boolean;
  prsOnly?: boolean;
  force?: boolean;
  noGraph?: boolean;
  since?: string;
  concurrency?: number;
  token?: string;
  command?: "org index" | "org sync";
  baseDir?: string;
  runner?: GitCommandRunner;
  fetchPullRequests?: typeof fetchMergedPullRequests;
  onFetchProgress?: (progress: FetchPullRequestsProgress) => void;
  onPrIndexProgress?: (progress: IndexPullRequestsProgress) => void;
  onCodeProgress?: (progress: CodeIndexProgress) => void;
  onGraphProgress?: (progress: OrgGraphProgress) => void;
  onLifecycleProgress?: (progress: OrgLifecycleProgress) => void;
};

function readCommit(runner: GitCommandRunner, cwd: string): string | undefined {
  try {
    return runner("git", ["rev-parse", "HEAD"], { cwd });
  } catch {
    return undefined;
  }
}

function missingCloneError(repo: string, localPath: string): string {
  return `Repo ${repo} is not cloned at ${localPath}. Run anchor org clone --repo ${repo} --org <org>.`;
}

function latestIsoDate(dates: Array<string | undefined>): string | undefined {
  return dates.filter((date): date is string => Boolean(date)).sort().at(-1);
}

function graphIsFreshForState(input: {
  graphBuiltAt?: string;
  graphStatus?: string;
  lastPrSyncAt?: string;
  lastCodeIndexedAt?: string;
}): boolean {
  const latestRepoIndexAt = latestIsoDate([input.lastPrSyncAt, input.lastCodeIndexedAt]);
  return Boolean(
    latestRepoIndexAt &&
      input.graphStatus === "success" &&
      input.graphBuiltAt &&
      input.graphBuiltAt >= latestRepoIndexAt,
  );
}

function isWithinResumeWindow(date: string): boolean {
  const parsed = Date.parse(date);
  return Number.isFinite(parsed) && Date.now() - parsed <= ORG_SYNC_RESUME_WINDOW_MS;
}

function shouldSkipPrFetchForResume(input: {
  options: OrgIndexOptions;
  lastPrSyncAt?: string;
  lastCodeIndexedAt?: string;
  graphBuiltAt?: string;
  graphStatus?: string;
}): boolean {
  if (input.options.command !== "org sync") return false;
  if (input.options.force || input.options.since || input.options.noGraph) return false;
  if (input.options.codeOnly || input.options.prsOnly) return false;
  if (!input.lastPrSyncAt) return false;
  if (!isWithinResumeWindow(input.lastPrSyncAt)) return false;
  return !graphIsFreshForState(input);
}

export async function indexOrgRepos(
  db: AnchorDatabase,
  config: AnchorOrgConfig,
  options: OrgIndexOptions = {},
): Promise<OrgIndexResult> {
  initializeSchema(db);
  syncOrgConfigToDatabase(db, config, options.baseDir);
  const repos = config.repos.filter(
    (repo) => repo.enabled && (!options.repo || repo.fullName === options.repo),
  );
  const runner = options.runner ?? defaultGitCommandRunner;
  const fetchPullRequests = options.fetchPullRequests ?? fetchMergedPullRequests;
  const auth = options.token ? { token: options.token } : resolveGitHubToken();
  const results: OrgRepoIndexResult[] = [];
  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();
  const graphState = getOrgGraphState(db, config.org);
  const command = options.command ?? "org index";
  const emit = (progress: OrgLifecycleProgress): void => options.onLifecycleProgress?.(progress);

  emit({
    stage: "org_sync_started",
    org: config.org,
    command,
    totalRepos: repos.length,
  });

  for (const [repoIndex, repo] of repos.entries()) {
    const repoPosition = repoIndex + 1;
    const localPath = orgRepoLocalPath(config.org, repo, options.baseDir);
    const repoStartedAt = new Date().toISOString();
    const repoStartedAtMs = Date.now();
    let prsIndexed = 0;
    let codeFilesIndexed = 0;
    try {
      emit({
        stage: "org_repo_started",
        org: config.org,
        command,
        repo: repo.fullName,
        current: repoPosition,
        total: repos.length,
      });
      if (!fs.existsSync(localPath)) throw new Error(missingCloneError(repo.fullName, localPath));
      emit({
        stage: "org_repo_phase",
        org: config.org,
        command,
        repo: repo.fullName,
        current: repoPosition,
        total: repos.length,
        phase: "Reading current commit",
      });
      const currentCommit = readCommit(runner, localPath);
      const state = getOrgRepoState(db, config.org, repo.fullName);
      let history: IndexSummary | undefined;
      let code: CodeIndexSummary | undefined;
      let skippedHistory = false;
      let historySkippedReason: string | undefined;
      const repoFailures: string[] = [];

      if (!options.codeOnly) {
        if (
          shouldSkipPrFetchForResume({
            options,
            lastPrSyncAt: state?.lastPrSyncAt,
            lastCodeIndexedAt: state?.lastCodeIndexedAt,
            graphBuiltAt: graphState?.lastBuiltAt,
            graphStatus: graphState?.lastStatus,
          })
        ) {
          skippedHistory = true;
          historySkippedReason =
            "PR history already synced; resuming unfinished org graph/index work.";
          emit({
            stage: "org_repo_skipped_history",
            org: config.org,
            command,
            repo: repo.fullName,
            current: repoPosition,
            total: repos.length,
            reason: historySkippedReason,
          });
          options.onFetchProgress?.({
            stage: "skipped_pull_request_fetch",
            repo: repo.fullName,
            reason: historySkippedReason,
          });
        } else if (!auth.token) {
          repoFailures.push(
            "GitHub authentication is required for org PR indexing. Run gh auth login, or export GITHUB_TOKEN/GH_TOKEN with read-only access.",
          );
        } else {
          try {
            emit({
              stage: "org_repo_phase",
              org: config.org,
              command,
              repo: repo.fullName,
              current: repoPosition,
              total: repos.length,
              phase: "Fetching PR history",
            });
            const since =
              options.since ??
              (options.command === "org sync"
                ? (state?.lastPrSyncAt ?? getLastSyncTime(db, repo.fullName))
                : undefined);
            const pullRequests = await fetchPullRequests({
              token: auth.token,
              repo: repo.fullName,
              limit: 200,
              since,
              detailConcurrency: options.concurrency,
              onProgress: options.onFetchProgress,
            });
            emit({
              stage: "org_repo_phase",
              org: config.org,
              command,
              repo: repo.fullName,
              current: repoPosition,
              total: repos.length,
              phase: "Indexing PR history into SQLite",
              detail: `${pullRequests.length} PR(s)`,
            });
            history = indexPullRequests(db, pullRequests, {
              cwd: localPath,
              repo: repo.fullName,
              historyCoverage: "limited",
              historyLimit: 200,
              historySince: since,
              onProgress: options.onPrIndexProgress,
            });
            prsIndexed = history.indexedPrs;
            updateOrgRepoState(db, {
              org: config.org,
              repo: repo.fullName,
              localPath,
              defaultBranch: repo.defaultBranch,
              currentCommit,
              lastPrSyncAt: new Date().toISOString(),
            });
          } catch (error) {
            repoFailures.push(error instanceof Error ? error.message : String(error));
          }
        }
      }

      const codeUnchanged =
        !options.force &&
        currentCommit &&
        state?.lastCodeIndexedCommit &&
        currentCommit === state.lastCodeIndexedCommit;
      if (!options.prsOnly && !codeUnchanged) {
        emit({
          stage: "org_repo_phase",
          org: config.org,
          command,
          repo: repo.fullName,
          current: repoPosition,
          total: repos.length,
          phase: "Indexing code and architecture",
        });
        code = indexCodebase(db, {
          cwd: localPath,
          repo: repo.fullName,
          onProgress: options.onCodeProgress,
        });
        codeFilesIndexed = code.indexedFiles;
        updateOrgRepoState(db, {
          org: config.org,
          repo: repo.fullName,
          localPath,
          defaultBranch: repo.defaultBranch,
          currentCommit,
          lastCodeIndexedCommit: currentCommit,
          lastCodeIndexedAt: new Date().toISOString(),
        });
      } else if (!options.prsOnly && codeUnchanged) {
        emit({
          stage: "org_repo_skipped_code",
          org: config.org,
          command,
          repo: repo.fullName,
          current: repoPosition,
          total: repos.length,
          reason: "Code skipped: current commit already indexed.",
        });
      } else if (options.prsOnly) {
        emit({
          stage: "org_repo_skipped_code",
          org: config.org,
          command,
          repo: repo.fullName,
          current: repoPosition,
          total: repos.length,
          reason: "Code skipped because --prs-only was passed.",
        });
      }
      if (repoFailures.length > 0) {
        updateOrgRepoState(db, {
          org: config.org,
          repo: repo.fullName,
          localPath,
          defaultBranch: repo.defaultBranch,
          currentCommit,
          lastError: repoFailures.join("; "),
        });
      }

      emit({
        stage: "org_repo_finalizing",
        org: config.org,
        command,
        repo: repo.fullName,
        current: repoPosition,
        total: repos.length,
      });
      results.push({
        repo: repo.fullName,
        skippedCode: Boolean(codeUnchanged || options.prsOnly),
        skippedHistory,
        historySkippedReason,
        currentCommit,
        history,
        code,
        error: repoFailures.join("; ") || undefined,
      });
      recordOrgIndexRun(db, {
        org: config.org,
        repo: repo.fullName,
        command,
        startedAt: repoStartedAt,
        finishedAt: new Date().toISOString(),
        status: repoFailures.length > 0 ? "partial" : "success",
        prsIndexed,
        codeFilesIndexed,
        failures: repoFailures,
      });
      emit({
        stage: "org_repo_completed",
        org: config.org,
        command,
        repo: repo.fullName,
        current: repoPosition,
        total: repos.length,
        skippedHistory,
        skippedCode: Boolean(codeUnchanged || options.prsOnly),
        prsIndexed,
        codeFilesIndexed,
        durationMs: Date.now() - repoStartedAtMs,
        error: repoFailures.join("; ") || undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateOrgRepoState(db, {
        org: config.org,
        repo: repo.fullName,
        localPath,
        defaultBranch: repo.defaultBranch,
        lastError: message,
      });
      recordOrgIndexRun(db, {
        org: config.org,
        repo: repo.fullName,
        command,
        startedAt: repoStartedAt,
        finishedAt: new Date().toISOString(),
        status: "failed",
        failures: [message],
      });
      results.push({
        repo: repo.fullName,
        skippedCode: false,
        error: message,
      });
      emit({
        stage: "org_repo_completed",
        org: config.org,
        command,
        repo: repo.fullName,
        current: repoPosition,
        total: repos.length,
        skippedHistory: false,
        skippedCode: false,
        prsIndexed,
        codeFilesIndexed,
        durationMs: Date.now() - repoStartedAtMs,
        error: message,
      });
    }
  }

  let graph: OrgIndexResult["graph"];
  if (options.noGraph) {
    const counts = getOrgGraphCounts(db, config.org);
    recordOrgGraphState(db, {
      org: config.org,
      status: "skipped",
      edgeCount: counts.edges,
      apiContractCount: counts.apiContracts,
      apiConsumerCount: counts.apiConsumers,
    });
    emit({
      stage: "org_graph_skipped",
      org: config.org,
      command,
      reason: "Graph skipped because --no-graph was passed.",
    });
    graph = { ...counts, skipped: true };
  } else {
    try {
      const rebuiltGraph = rebuildOrgGraph(db, config, {
        baseDir: options.baseDir,
        onProgress: options.onGraphProgress,
      });
      graph = {
        edges: rebuiltGraph.edges.length,
        apiConsumers: rebuiltGraph.apiConsumers.length,
        apiContracts: rebuiltGraph.apiContracts.length,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const counts = getOrgGraphCounts(db, config.org);
      graph = { ...counts, error: message };
    }
  }
  recordOrgIndexRun(db, {
    org: config.org,
    command,
    startedAt,
    finishedAt: new Date().toISOString(),
    status: results.some((result) => result.error) || graph.error ? "partial" : "success",
    prsIndexed: results.reduce((sum, result) => sum + (result.history?.indexedPrs ?? 0), 0),
    codeFilesIndexed: results.reduce((sum, result) => sum + (result.code?.indexedFiles ?? 0), 0),
    failures: results
      .map((result) => result.error)
      .concat(graph.error ? [graph.error] : [])
      .filter((error): error is string => Boolean(error)),
  });
  emit({
    stage: "org_sync_completed",
    org: config.org,
    command,
    totalRepos: repos.length,
    succeededRepos: results.filter((result) => !result.error).length,
    failedRepos: results.filter((result) => result.error).length,
    durationMs: Date.now() - startedAtMs,
  });

  return {
    org: config.org,
    repos: results.sort((a, b) => a.repo.localeCompare(b.repo)),
    graph,
  };
}
