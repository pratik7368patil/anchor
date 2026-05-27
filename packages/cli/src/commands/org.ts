import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  addOrgRepoConfig,
  buildOrgContextResult,
  checkOrgImpact,
  cloneOrgRepos,
  findOrgApiConsumers,
  getOrgArchitectureMap,
  getOrgStatus,
  indexOrgRepos,
  initOrgConfig,
  loadOrgConfig,
  orgConfigPath,
  openOrgDatabase,
  orgDatabasePath,
  rebuildOrgGraph,
  removeOrgRepoConfig,
  resolveGitHubToken,
  syncOrgConfigToDatabase,
  validateOrgRepoFullName,
  validateOrgRepoGroup,
} from "@pratik7368patil/anchor-core";
import { createProgressReporter, type ProgressMode } from "./progress.js";
import { writeOrgGraphHtml } from "./org-graph-html.js";

type OrgOptions = {
  org?: string;
  repo?: string;
  alias?: string;
  group?: string;
  concurrency?: number;
  codeOnly?: boolean;
  prsOnly?: boolean;
  graph?: boolean;
  force?: boolean;
  since?: string;
  json?: boolean;
  progress?: ProgressMode;
  html?: boolean;
  open?: boolean;
  output?: string;
  format?: "mermaid" | "json";
  diffFile?: string;
  strict?: boolean;
  minCoverage?: number;
};

type GitHubRepoMetadata = {
  cloneUrl?: string;
  defaultBranch?: string;
};

function requireOrg(options: OrgOptions): string {
  if (!options.org) throw new Error("Pass --org <org>.");
  return options.org;
}

function readCurrentDiff(diffFile?: string): string {
  if (diffFile) return fs.readFileSync(diffFile, "utf8");
  try {
    return execFileSync("git", ["diff", "--no-color"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}

async function resolveRepoMetadata(fullName: string): Promise<GitHubRepoMetadata> {
  const auth = resolveGitHubToken();
  if (!auth.token) return {};
  const [owner, repo] = validateOrgRepoFullName(fullName).split("/") as [string, string];
  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        authorization: `Bearer ${auth.token}`,
        accept: "application/vnd.github+json",
        "user-agent": "anchor-local-mcp",
      },
    });
    if (!response.ok) return {};
    const data = (await response.json()) as {
      clone_url?: string;
      default_branch?: string;
    };
    return {
      cloneUrl: data.clone_url,
      defaultBranch: data.default_branch,
    };
  } catch {
    return {};
  }
}

export function runOrgInit(options: OrgOptions) {
  const org = requireOrg(options);
  const config = initOrgConfig(org);
  const db = openOrgDatabase(config.org);
  try {
    syncOrgConfigToDatabase(db, config);
    return { config, databasePath: orgDatabasePath(config.org) };
  } finally {
    db.close();
  }
}

export async function runOrgAddRepo(repoFullName: string, options: OrgOptions) {
  const org = requireOrg(options);
  validateOrgRepoGroup(options.group);
  const metadata = await resolveRepoMetadata(repoFullName);
  const config = addOrgRepoConfig(org, repoFullName, {
    alias: options.alias,
    group: options.group,
    cloneUrl: metadata.cloneUrl,
    defaultBranch: metadata.defaultBranch,
  });
  const db = openOrgDatabase(config.org);
  try {
    syncOrgConfigToDatabase(db, config);
    return { config, repo: config.repos.find((item) => item.fullName === repoFullName) };
  } finally {
    db.close();
  }
}

export function runOrgRemoveRepo(repoFullName: string, options: OrgOptions) {
  const config = removeOrgRepoConfig(requireOrg(options), repoFullName);
  const db = openOrgDatabase(config.org);
  try {
    syncOrgConfigToDatabase(db, config);
    return { config };
  } finally {
    db.close();
  }
}

export function runOrgList(options: OrgOptions) {
  const config = loadOrgConfig(requireOrg(options));
  const db = openOrgDatabase(config.org);
  try {
    syncOrgConfigToDatabase(db, config);
    return getOrgStatus(db, config);
  } finally {
    db.close();
  }
}

export async function runOrgClone(options: OrgOptions) {
  const config = loadOrgConfig(requireOrg(options));
  const db = openOrgDatabase(config.org);
  const progress = createProgressReporter({ ...options, title: "Cloning org repos" });
  try {
    const results = await cloneOrgRepos({
      config,
      db,
      repo: options.repo,
      concurrency: options.concurrency,
      onProgress: progress.onCloneProgress,
    });
    return { org: config.org, results };
  } finally {
    progress.close();
    db.close();
  }
}

export async function runOrgIndex(options: OrgOptions & { command?: "org index" | "org sync" }) {
  const config = loadOrgConfig(requireOrg(options));
  const db = openOrgDatabase(config.org);
  const progress = createProgressReporter({
    ...options,
    title: options.command === "org sync" ? "Syncing org memory" : "Indexing org memory",
  });
  try {
    return await indexOrgRepos(db, config, {
      repo: options.repo,
      codeOnly: options.codeOnly,
      prsOnly: options.prsOnly,
      noGraph: options.graph === false,
      force: options.force,
      since: options.since,
      concurrency: options.concurrency,
      command: options.command ?? "org index",
      onFetchProgress: progress.onFetchProgress,
      onPrIndexProgress: progress.onPrIndexProgress,
      onCodeProgress: progress.onCodeProgress,
      onGraphProgress: progress.onGraphProgress,
    });
  } finally {
    progress.close();
    db.close();
  }
}

export function runOrgStatus(options: OrgOptions) {
  return runOrgList(options);
}

export function runOrgGraph(options: OrgOptions) {
  const config = loadOrgConfig(requireOrg(options));
  const db = openOrgDatabase(config.org);
  const progress = createProgressReporter({ ...options, title: "Building org graph" });
  try {
    const graph = rebuildOrgGraph(db, config, {
      onProgress: progress.onGraphProgress,
    });
    const metadata = {
      org: config.org,
      edges: graph.edges.length,
      apiContracts: graph.apiContracts.length,
      apiConsumers: graph.apiConsumers.length,
      durationMs: graph.durationMs,
      databasePath: orgDatabasePath(config.org),
    };
    const htmlPath =
      options.html || options.open
        ? (options.output ?? path.join(path.dirname(orgDatabasePath(config.org)), "org-graph.html"))
        : undefined;
    const htmlResult = htmlPath ? writeOrgGraphHtml(config, graph, htmlPath) : undefined;
    if (htmlResult && options.open) openLocalFile(htmlResult.filePath);
    return {
      markdown: [
        "# Anchor Org Graph",
        "",
        `Org: ${metadata.org}`,
        `Cross-repo edges: ${metadata.edges}`,
        `API contracts: ${metadata.apiContracts}`,
        `API consumers: ${metadata.apiConsumers}`,
        `Duration: ${(metadata.durationMs / 1000).toFixed(1)}s`,
        `Database: ${metadata.databasePath}`,
        ...(htmlResult
          ? [
              `HTML graph: ${htmlResult.filePath}`,
              options.open ? "Opened in your default browser." : "Open this file in a browser.",
            ]
          : []),
      ].join("\n"),
      metadata: { ...metadata, htmlPath: htmlResult?.filePath, opened: Boolean(options.open) },
    };
  } finally {
    progress.close();
    db.close();
  }
}

function openLocalFile(filePath: string): void {
  const url = pathToFileURL(filePath).href;
  try {
    if (process.platform === "darwin") {
      execFileSync("open", [url], { stdio: "ignore" });
      return;
    }
    if (process.platform === "win32") {
      execFileSync("cmd", ["/c", "start", "", url], { stdio: "ignore" });
      return;
    }
    execFileSync("xdg-open", [url], { stdio: "ignore" });
  } catch (error) {
    throw new Error(
      `Wrote graph HTML to ${filePath}, but could not open it automatically: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export function runOrgMap(options: OrgOptions) {
  const config = loadOrgConfig(requireOrg(options));
  const db = openOrgDatabase(config.org);
  try {
    return getOrgArchitectureMap(db, config, options.format ?? "mermaid");
  } finally {
    db.close();
  }
}

export function runOrgImpact(options: OrgOptions) {
  const config = loadOrgConfig(requireOrg(options));
  const db = openOrgDatabase(config.org);
  try {
    return checkOrgImpact(db, config, {
      repo: options.repo,
      diff: readCurrentDiff(options.diffFile),
      strict: options.strict,
    });
  } finally {
    db.close();
  }
}

export function runOrgCi(options: OrgOptions) {
  const config = loadOrgConfig(requireOrg(options));
  const db = openOrgDatabase(config.org);
  try {
    const impact = checkOrgImpact(db, config, {
      repo: options.repo,
      diff: readCurrentDiff(options.diffFile),
      strict: options.strict,
    });
    const status = getOrgStatus(db, config);
    const minCoverage = options.minCoverage ?? 70;
    const highAnomalies = impact.metadata.anomalies.filter((item) =>
      ["blocker", "high"].includes(item.severity),
    );
    const ok =
      status.coverageScore >= minCoverage && (!options.strict || highAnomalies.length === 0);
    return {
      markdown: [
        "# Anchor Org CI",
        "",
        `Org coverage: ${status.coverageScore}% (${status.coverageGrade})`,
        `High/blocker anomalies: ${highAnomalies.length}`,
        "",
        impact.markdown,
      ].join("\n"),
      metadata: { ok, status, impact: impact.metadata },
    };
  } finally {
    db.close();
  }
}

export function runOrgContext(
  options: OrgOptions & { task: string; files?: string[]; symbols?: string[] },
) {
  const config = loadOrgConfig(requireOrg(options));
  const db = openOrgDatabase(config.org);
  try {
    return buildOrgContextResult(db, config, {
      task: options.task,
      repos: options.repo ? [options.repo] : undefined,
      files: options.files,
      symbols: options.symbols,
      strict: options.strict,
    });
  } finally {
    db.close();
  }
}

export function runOrgFindConsumers(options: OrgOptions & { query?: string; files?: string[] }) {
  const config = loadOrgConfig(requireOrg(options));
  const db = openOrgDatabase(config.org);
  try {
    return findOrgApiConsumers(db, config, {
      repo: options.repo,
      query: options.query,
      files: options.files,
    });
  } finally {
    db.close();
  }
}

export function printJsonOrMarkdown(
  result: { markdown?: string; metadata?: unknown } | unknown,
  options: OrgOptions,
): void {
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result && typeof result === "object" && "markdown" in result) {
    console.log((result as { markdown: string }).markdown);
    return;
  }
  if (
    result &&
    typeof result === "object" &&
    "org" in result &&
    "repos" in result &&
    "coverageScore" in result
  ) {
    const status = result as {
      org: string;
      enabledRepoCount: number;
      repoCount: number;
      clonedRepoCount: number;
      coverageScore: number;
      coverageGrade: string;
      crossRepoEdgeCount: number;
      apiContractCount: number;
      apiConsumerCount: number;
      graphLastBuiltAt?: string;
      graphLastStatus?: string;
      graphLastDurationMs?: number;
      graphLastError?: string;
      repos: Array<{ fullName: string; group: string; cloned: boolean; enabled: boolean }>;
    };
    console.log(`# Anchor Org Status`);
    console.log(`Org: ${status.org}`);
    console.log(`Repos: ${status.enabledRepoCount}/${status.repoCount} enabled`);
    console.log(`Cloned repos: ${status.clonedRepoCount}`);
    console.log(`Coverage: ${status.coverageScore}% (${status.coverageGrade})`);
    console.log(`Cross-repo edges: ${status.crossRepoEdgeCount}`);
    console.log(`API contracts: ${status.apiContractCount}`);
    console.log(`API consumers: ${status.apiConsumerCount}`);
    console.log(
      `Graph: ${status.graphLastStatus ?? "unknown"}${status.graphLastBuiltAt ? ` at ${status.graphLastBuiltAt}` : ""}`,
    );
    if (status.graphLastDurationMs !== undefined) {
      console.log(`Graph duration: ${(status.graphLastDurationMs / 1000).toFixed(1)}s`);
    }
    if (status.graphLastError) console.log(`Graph error: ${status.graphLastError}`);
    console.log("");
    console.log("## Repos");
    for (const repo of status.repos) {
      console.log(
        `- ${repo.fullName} [${repo.group}] ${repo.enabled ? "enabled" : "disabled"}, ${repo.cloned ? "cloned" : "not cloned"}`,
      );
    }
    return;
  }
  console.log(JSON.stringify(result, null, 2));
}

export function printOrgInit(result: ReturnType<typeof runOrgInit>): void {
  console.log(`Anchor org initialized: ${result.config.org}`);
  console.log(`Config: ${orgConfigPath(result.config.org)}`);
  console.log(`Database: ${result.databasePath}`);
  console.log("Next: anchor org add-repo <owner/name> --org " + result.config.org);
}

export function printOrgAddRepo(result: Awaited<ReturnType<typeof runOrgAddRepo>>): void {
  console.log(`Added org repo: ${result.repo?.fullName ?? "unknown"}`);
  console.log(`Group: ${result.repo?.group ?? "unknown"}`);
  console.log("Next: anchor org clone --org " + result.config.org);
}

export function printOrgRemoveRepo(
  result: ReturnType<typeof runOrgRemoveRepo>,
  repo: string,
): void {
  console.log(`Disabled org repo: ${repo}`);
  console.log(
    `Remaining enabled repos: ${result.config.repos.filter((item) => item.enabled).length}`,
  );
}
