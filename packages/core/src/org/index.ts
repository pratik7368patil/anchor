import fs from "node:fs";
import { fetchMergedPullRequests } from "../github/fetch-prs.js";
import { indexCodebase } from "../indexer/code-indexer.js";
import { indexPullRequests } from "../indexer/index-runner.js";
import type {
  FetchPullRequestsProgress,
  IndexPullRequestsProgress,
  CodeIndexProgress,
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
  getOrgGraphCounts,
  recordOrgIndexRun,
  recordOrgGraphState,
  syncOrgConfigToDatabase,
  updateOrgRepoState,
} from "./database.js";
import { rebuildOrgGraph } from "./graph.js";

export type OrgRepoIndexResult = {
  repo: string;
  skippedCode: boolean;
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
  onFetchProgress?: (progress: FetchPullRequestsProgress) => void;
  onPrIndexProgress?: (progress: IndexPullRequestsProgress) => void;
  onCodeProgress?: (progress: CodeIndexProgress) => void;
  onGraphProgress?: (progress: OrgGraphProgress) => void;
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
  const auth = options.token ? { token: options.token } : resolveGitHubToken();
  const results: OrgRepoIndexResult[] = [];
  const startedAt = new Date().toISOString();

  for (const repo of repos) {
    const localPath = orgRepoLocalPath(config.org, repo, options.baseDir);
    const repoStartedAt = new Date().toISOString();
    let prsIndexed = 0;
    let codeFilesIndexed = 0;
    try {
      if (!fs.existsSync(localPath)) throw new Error(missingCloneError(repo.fullName, localPath));
      const currentCommit = readCommit(runner, localPath);
      const state = getOrgRepoState(db, config.org, repo.fullName);
      let history: IndexSummary | undefined;
      let code: CodeIndexSummary | undefined;
      const repoFailures: string[] = [];

      if (!options.codeOnly) {
        if (!auth.token) {
          repoFailures.push(
            "GitHub authentication is required for org PR indexing. Run gh auth login, or export GITHUB_TOKEN/GH_TOKEN with read-only access.",
          );
        } else {
          try {
            const since =
              options.since ??
              (options.command === "org sync"
                ? (state?.lastPrSyncAt ?? getLastSyncTime(db, repo.fullName))
                : undefined);
            const pullRequests = await fetchMergedPullRequests({
              token: auth.token,
              repo: repo.fullName,
              limit: 200,
              since,
              detailConcurrency: options.concurrency,
              onProgress: options.onFetchProgress,
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

      results.push({
        repo: repo.fullName,
        skippedCode: Boolean(codeUnchanged || options.prsOnly),
        currentCommit,
        history,
        code,
        error: repoFailures.join("; ") || undefined,
      });
      recordOrgIndexRun(db, {
        org: config.org,
        repo: repo.fullName,
        command: options.command ?? "org index",
        startedAt: repoStartedAt,
        finishedAt: new Date().toISOString(),
        status: repoFailures.length > 0 ? "partial" : "success",
        prsIndexed,
        codeFilesIndexed,
        failures: repoFailures,
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
        command: options.command ?? "org index",
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
    command: options.command ?? "org index",
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

  return {
    org: config.org,
    repos: results.sort((a, b) => a.repo.localeCompare(b.repo)),
    graph,
  };
}
