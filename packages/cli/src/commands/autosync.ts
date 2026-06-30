import {
  acquireAutosyncLock,
  recordAutosyncRun,
  resolveAutosyncJob,
  type AutosyncJobKind,
  type AutosyncRunStatus,
} from "@pratik7368patil/anchor-core";
import { runIndexCode } from "./index.js";
import { runSync } from "./sync.js";
import { runOrgClone, runOrgGraph, runOrgIndex } from "./org.js";

export type AutosyncRunOptions = {
  kind?: AutosyncJobKind;
  cwd?: string;
  org?: string;
  graph?: boolean;
};

export async function runAutosyncInternal(options: AutosyncRunOptions): Promise<void> {
  const kind = options.kind;
  if (!kind || !["repo", "org", "org-graph"].includes(kind)) {
    throw new Error("Pass --kind repo, --kind org, or --kind org-graph.");
  }
  const job = resolveAutosyncJob(kind, { cwd: options.cwd, org: options.org });
  const lock = acquireAutosyncLock(job.id);
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  if (!lock.acquired) {
    const run = {
      startedAt,
      finishedAt: new Date().toISOString(),
      status: "skipped" as const,
      message: lock.message ?? "Autosync job is already running.",
      durationMs: Date.now() - startedMs,
    };
    recordAutosyncRun(job.id, run);
    console.log(run.message);
    return;
  }

  const timeout = setTimeout(() => {
    const run = {
      startedAt,
      finishedAt: new Date().toISOString(),
      status: "failed" as const,
      message: `Autosync timed out after ${Math.round(job.timeoutMs / 60000)} minutes.`,
      durationMs: Date.now() - startedMs,
    };
    recordAutosyncRun(job.id, run);
    lock.release();
    console.error(run.message);
    process.exit(124);
  }, job.timeoutMs);

  try {
    const result = await executeAutosyncJob(kind, options);
    const run = {
      startedAt,
      finishedAt: new Date().toISOString(),
      status: result.status,
      message: result.message,
      durationMs: Date.now() - startedMs,
    };
    recordAutosyncRun(job.id, run);
    console.log(result.message);
    if (result.status === "failed") process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordAutosyncRun(job.id, {
      startedAt,
      finishedAt: new Date().toISOString(),
      status: "failed",
      message,
      durationMs: Date.now() - startedMs,
    });
    throw error;
  } finally {
    clearTimeout(timeout);
    lock.release();
  }
}

async function executeAutosyncJob(
  kind: AutosyncJobKind,
  options: AutosyncRunOptions,
): Promise<{ status: AutosyncRunStatus; message: string }> {
  if (kind === "repo") return runRepoAutosync(options.cwd ?? process.cwd());
  if (kind === "org") return runOrgAutosync(requiredOrg(options.org), options.graph === false);
  return runOrgGraphAutosync(requiredOrg(options.org));
}

async function runRepoAutosync(cwd: string): Promise<{ status: AutosyncRunStatus; message: string }> {
  try {
    await runSync(cwd, {
      all: true,
      concurrency: 2,
      progress: "plain",
    });
    return { status: "success", message: "Repo autosync completed." };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("GitHub authentication is required")) throw error;
    await runIndexCode(cwd, {
      progress: "plain",
    });
    return {
      status: "partial",
      message:
        "Repo autosync refreshed code only because GitHub auth was unavailable; PR memory may be stale.",
    };
  }
}

async function runOrgAutosync(
  org: string,
  noGraph: boolean,
): Promise<{ status: AutosyncRunStatus; message: string }> {
  await runOrgClone({
    org,
    concurrency: 1,
    progress: "plain",
    command: "org sync",
  });
  const result = await runOrgIndex({
    org,
    concurrency: 1,
    graph: !noGraph,
    all: true,
    progress: "plain",
    command: "org sync",
  });
  const failedRepos = result.repos.filter((repo) => repo.error).length;
  return {
    status: failedRepos > 0 || result.graph.error ? "partial" : "success",
    message:
      failedRepos > 0
        ? `Org autosync completed with ${failedRepos} repo issue(s).`
        : "Org autosync completed.",
  };
}

function runOrgGraphAutosync(org: string): { status: AutosyncRunStatus; message: string } {
  const result = runOrgGraph({
    org,
    progress: "plain",
  });
  const metadata = result.metadata as { edges?: number } | undefined;
  return {
    status: "success",
    message: `Org graph autosync completed${metadata?.edges !== undefined ? ` with ${metadata.edges} edge(s)` : ""}.`,
  };
}

function requiredOrg(org?: string): string {
  if (!org) throw new Error("Pass --org <org>.");
  return org;
}
