import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { AnchorOrgConfig, AnchorOrgRepoConfig, OrgRepoCloneState } from "../types.js";
import type { AnchorDatabase } from "../db/database.js";
import { orgRepoLocalPath } from "./config.js";
import { syncOrgConfigToDatabase, updateOrgRepoState } from "./database.js";

export type GitCommandRunner = (
  command: string,
  args: string[],
  options: { cwd?: string },
) => string;

export type OrgCloneResult = {
  repo: string;
  localPath: string;
  cloned: boolean;
  pulled: boolean;
  currentCommit?: string;
  error?: string;
};

export function defaultGitCommandRunner(
  command: string,
  args: string[],
  options: { cwd?: string } = {},
): string {
  return execFileSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function currentCommit(runner: GitCommandRunner, localPath: string): string | undefined {
  try {
    return runner("git", ["rev-parse", "HEAD"], { cwd: localPath });
  } catch {
    return undefined;
  }
}

export function plannedOrgCloneCommands(
  repo: AnchorOrgRepoConfig,
  localPath: string,
): Array<{ command: string; args: string[]; cwd?: string }> {
  if (!fs.existsSync(path.join(localPath, ".git"))) {
    return [
      {
        command: "git",
        args: ["clone", "--depth", "1", repo.cloneUrl, localPath],
      },
    ];
  }
  return [
    {
      command: "git",
      args: ["fetch", "--depth", "1", "origin", repo.defaultBranch],
      cwd: localPath,
    },
    {
      command: "git",
      args: ["checkout", repo.defaultBranch],
      cwd: localPath,
    },
    {
      command: "git",
      args: ["reset", "--hard", `origin/${repo.defaultBranch}`],
      cwd: localPath,
    },
  ];
}

export function cloneOrPullOrgRepo(input: {
  org: string;
  repo: AnchorOrgRepoConfig;
  db?: AnchorDatabase;
  baseDir?: string;
  runner?: GitCommandRunner;
}): OrgCloneResult {
  const runner = input.runner ?? defaultGitCommandRunner;
  const localPath = orgRepoLocalPath(input.org, input.repo, input.baseDir);
  const existed = fs.existsSync(path.join(localPath, ".git"));
  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  const now = new Date().toISOString();
  try {
    const commands = plannedOrgCloneCommands(input.repo, localPath);
    for (const command of commands) runner(command.command, command.args, { cwd: command.cwd });
    const commit = currentCommit(runner, localPath);
    if (input.db) {
      updateOrgRepoState(input.db, {
        org: input.org,
        repo: input.repo.fullName,
        localPath,
        defaultBranch: input.repo.defaultBranch,
        currentCommit: commit,
        lastPulledAt: now,
      });
    }
    return {
      repo: input.repo.fullName,
      localPath,
      cloned: !existed,
      pulled: existed,
      currentCommit: commit,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (input.db) {
      updateOrgRepoState(input.db, {
        org: input.org,
        repo: input.repo.fullName,
        localPath,
        defaultBranch: input.repo.defaultBranch,
        lastError: message,
      });
    }
    return {
      repo: input.repo.fullName,
      localPath,
      cloned: false,
      pulled: false,
      error: message,
    };
  }
}

export async function cloneOrgRepos(input: {
  config: AnchorOrgConfig;
  db?: AnchorDatabase;
  repo?: string;
  concurrency?: number;
  baseDir?: string;
  runner?: GitCommandRunner;
  onProgress?: (message: string) => void;
}): Promise<OrgCloneResult[]> {
  if (input.db) syncOrgConfigToDatabase(input.db, input.config, input.baseDir);
  const repos = input.config.repos.filter(
    (repo) => repo.enabled && (!input.repo || repo.fullName === input.repo),
  );
  const limit = Math.max(1, Math.min(input.concurrency ?? 3, 6));
  const results: OrgCloneResult[] = [];
  let next = 0;
  async function worker(): Promise<void> {
    while (next < repos.length) {
      const repo = repos[next];
      next += 1;
      if (!repo) continue;
      input.onProgress?.(`cloning or pulling ${repo.fullName}`);
      results.push(
        cloneOrPullOrgRepo({
          org: input.config.org,
          repo,
          db: input.db,
          baseDir: input.baseDir,
          runner: input.runner,
        }),
      );
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, repos.length) }, () => worker()));
  return results.sort((a, b) => a.repo.localeCompare(b.repo));
}

export function orgCloneStateFromResult(
  org: string,
  repo: AnchorOrgRepoConfig,
  result: OrgCloneResult,
): OrgRepoCloneState {
  return {
    org,
    repo: repo.fullName,
    localPath: result.localPath,
    defaultBranch: repo.defaultBranch,
    currentCommit: result.currentCommit,
    lastPulledAt: result.error ? undefined : new Date().toISOString(),
    lastError: result.error,
  };
}
