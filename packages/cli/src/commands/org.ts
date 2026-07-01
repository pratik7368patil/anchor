import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as readline from "node:readline";
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
  maybeLoadOrgConfig,
  orgConfigPath,
  openOrgDatabase,
  openOrgDatabaseReadOnly,
  orgDatabasePath,
  readOrgHeartbeat,
  rebuildOrgGraph,
  removeOrgRepoConfig,
  resolveGitHubToken,
  syncOrgConfigToDatabase,
  validateOrgRepoFullName,
  validateOrgRepoGroup,
} from "@pratik7368patil/anchor-core";
import type {
  AnchorOrgRepoConfig,
  OrgRepoGroup,
  OrgRunTimelineSnapshot,
  OrgRunTimelineStepStatus,
} from "@pratik7368patil/anchor-core";
import { createProgressReporter, type ProgressMode } from "./progress.js";
import { writeOrgGraphHtml } from "./org-graph-html.js";
import { writeOrgReportHtml } from "./org-report-html.js";

type OrgOptions = {
  org?: string;
  repo?: string;
  alias?: string;
  group?: string;
  search?: string;
  includeArchived?: boolean;
  concurrency?: number;
  all?: boolean;
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
  command?: "org index" | "org sync" | "org clone" | "org graph";
};

type GitHubRepoMetadata = {
  cloneUrl?: string;
  defaultBranch?: string;
};

export type GitHubOrgRepo = GitHubRepoMetadata & {
  fullName: string;
  archived: boolean;
  private: boolean;
  description?: string;
};

type GitHubRepoDiscoveryOptions = {
  includeArchived?: boolean;
  token?: string;
  fetchImpl?: typeof fetch;
};

type OrgAddRepoAction = {
  repo: AnchorOrgRepoConfig;
  action: "added" | "updated" | "skipped";
};

type OrgAddRepoResult = {
  config: ReturnType<typeof addOrgRepoConfig>;
  repos: AnchorOrgRepoConfig[];
  actions: OrgAddRepoAction[];
  added: number;
  updated: number;
  skipped: number;
};

type PickerIo = {
  input?: NodeJS.ReadStream;
  output?: NodeJS.WriteStream;
};

function requireOrg(options: OrgOptions): string {
  if (!options.org) throw new Error("Pass --org <org>.");
  return options.org;
}

function shouldWriteHtml(options: OrgOptions): boolean {
  return Boolean(options.html || options.open || options.output);
}

function resolveOrgHtmlOutput(
  org: string,
  options: OrgOptions,
  defaultFileName: string,
): string {
  if (options.output) return options.output;
  return path.join(path.dirname(orgDatabasePath(org)), defaultFileName);
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

export function inferOrgRepoGroup(fullNameOrName: string): OrgRepoGroup {
  const name = fullNameOrName.includes("/")
    ? (fullNameOrName.split("/").pop() ?? fullNameOrName)
    : fullNameOrName;
  const normalized = name.toLowerCase();
  if (/\b(docs?|documentation|handbook)\b/.test(normalized)) return "docs";
  if (/(infra|infrastructure|terraform|helm|k8s|kubernetes|ops|devops)/.test(normalized)) {
    return "infra";
  }
  if (/(backend|api|server|service|worker|gateway)/.test(normalized)) return "backend";
  if (/(frontend|web|ui|app|client|portal|dashboard)/.test(normalized)) return "frontend";
  if (/(shared|core|common|sdk|lib|library|package|types?)/.test(normalized)) return "shared";
  return "unknown";
}

export function filterGitHubOrgRepos(repos: GitHubOrgRepo[], query?: string): GitHubOrgRepo[] {
  const normalized = query?.trim().toLowerCase();
  if (!normalized) return repos;
  return repos.filter((repo) =>
    [repo.fullName, repo.fullName.split("/").pop() ?? "", repo.description ?? ""].some((value) =>
      value.toLowerCase().includes(normalized),
    ),
  );
}

export async function fetchGitHubOrgRepos(
  org: string,
  options: GitHubRepoDiscoveryOptions = {},
): Promise<GitHubOrgRepo[]> {
  const authToken = options.token ?? resolveGitHubToken().token;
  if (!authToken) {
    throw new Error(
      "GitHub authentication is required to search org repos. Run gh auth login, export GITHUB_TOKEN/GH_TOKEN, or pass owner/name explicitly.",
    );
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const repos: GitHubOrgRepo[] = [];
  for (let page = 1; ; page += 1) {
    const url = `https://api.github.com/orgs/${encodeURIComponent(org)}/repos?type=all&sort=updated&per_page=100&page=${page}`;
    const response = await fetchImpl(url, {
      headers: {
        authorization: `Bearer ${authToken}`,
        accept: "application/vnd.github+json",
        "user-agent": "anchor-local-mcp",
      },
    });
    if (!response.ok) {
      throw new Error(
        `Could not list repositories for ${org} (${response.status}). Check org access, run gh auth login, or pass owner/name explicitly.`,
      );
    }
    const pageItems = (await response.json()) as Array<{
      full_name?: string;
      clone_url?: string;
      default_branch?: string;
      archived?: boolean;
      private?: boolean;
      description?: string | null;
    }>;
    for (const item of pageItems) {
      if (!item.full_name) continue;
      if (item.archived && !options.includeArchived) continue;
      repos.push({
        fullName: validateOrgRepoFullName(item.full_name),
        cloneUrl: item.clone_url,
        defaultBranch: item.default_branch,
        archived: Boolean(item.archived),
        private: Boolean(item.private),
        description: item.description ?? undefined,
      });
    }
    if (pageItems.length < 100) break;
  }
  return repos.sort((a, b) => a.fullName.localeCompare(b.fullName));
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
  const metadata = await resolveRepoMetadata(repoFullName);
  const result = runOrgAddRepos(
    [
      {
        fullName: validateOrgRepoFullName(repoFullName),
        archived: false,
        private: false,
        cloneUrl: metadata.cloneUrl,
        defaultBranch: metadata.defaultBranch,
      },
    ],
    options,
  );
  return { ...result, repo: result.repos[0] };
}

export async function runOrgAddRepoCommand(
  repoFullName: string | undefined,
  options: OrgOptions,
  io: PickerIo = {},
): Promise<OrgAddRepoResult & { repo?: AnchorOrgRepoConfig }> {
  if (repoFullName) return runOrgAddRepo(repoFullName, options);
  if (options.alias) {
    throw new Error("--alias can only be used when adding one explicit owner/name repo.");
  }
  const org = requireOrg(options);
  const input = io.input ?? process.stdin;
  const output = io.output ?? process.stderr;
  if (!input.isTTY || !output.isTTY) {
    throw new Error(
      "Interactive repo selection requires a terminal. Pass owner/name explicitly, for example: anchor org add-repo owner/name --org " +
        org,
    );
  }
  const discovered = await fetchGitHubOrgRepos(org, {
    includeArchived: options.includeArchived,
  });
  const candidates = filterGitHubOrgRepos(discovered, options.search);
  if (candidates.length === 0) {
    const suffix = options.search ? ` matching "${options.search}"` : "";
    throw new Error(`No readable GitHub repositories found for ${org}${suffix}.`);
  }
  const selected = await selectOrgReposInteractively(discovered, {
    initialSearch: options.search,
    input,
    output,
  });
  if (selected.length === 0) {
    throw new Error("No repositories selected. Anchor org config was not changed.");
  }
  return runOrgAddRepos(selected, options);
}

export function runOrgAddRepos(repos: GitHubOrgRepo[], options: OrgOptions): OrgAddRepoResult {
  const org = requireOrg(options);
  const groupOverride = options.group ? validateOrgRepoGroup(options.group) : undefined;
  if (options.alias && repos.length !== 1) {
    throw new Error("--alias can only be used when adding one explicit owner/name repo.");
  }
  const before = maybeLoadOrgConfig(org);
  const beforeByFullName = new Map(before?.repos.map((repo) => [repo.fullName, repo]) ?? []);
  const actions: OrgAddRepoAction[] = [];
  let config = before ?? initOrgConfig(org);
  for (const repo of repos) {
    const fullName = validateOrgRepoFullName(repo.fullName);
    const existing = beforeByFullName.get(fullName);
    const group = groupOverride ?? existing?.group ?? inferOrgRepoGroup(fullName);
    config = addOrgRepoConfig(org, fullName, {
      alias: options.alias,
      group,
      cloneUrl: repo.cloneUrl,
      defaultBranch: repo.defaultBranch,
    });
    const saved = config.repos.find((item) => item.fullName === fullName);
    if (!saved) continue;
    actions.push({
      repo: saved,
      action: classifyOrgRepoAction(existing, saved),
    });
  }
  const db = openOrgDatabase(config.org);
  try {
    syncOrgConfigToDatabase(db, config);
    const added = actions.filter((item) => item.action === "added").length;
    const updated = actions.filter((item) => item.action === "updated").length;
    const skipped = actions.filter((item) => item.action === "skipped").length;
    return {
      config,
      repos: actions.map((item) => item.repo),
      actions,
      added,
      updated,
      skipped,
    };
  } finally {
    db.close();
  }
}

function classifyOrgRepoAction(
  before: AnchorOrgRepoConfig | undefined,
  after: AnchorOrgRepoConfig,
): OrgAddRepoAction["action"] {
  if (!before) return "added";
  const same =
    before.alias === after.alias &&
    before.group === after.group &&
    before.cloneUrl === after.cloneUrl &&
    before.defaultBranch === after.defaultBranch &&
    before.enabled === after.enabled;
  return same ? "skipped" : "updated";
}

async function selectOrgReposInteractively(
  candidates: GitHubOrgRepo[],
  options: PickerIo & { initialSearch?: string },
): Promise<GitHubOrgRepo[]> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stderr;
  readline.emitKeypressEvents(input);
  const rawInput = input as NodeJS.ReadStream & { isRaw?: boolean };
  const wasRaw = Boolean(rawInput.isRaw);
  if (input.setRawMode) input.setRawMode(true);
  let query = options.initialSearch?.trim() ?? "";
  let cursor = 0;
  const selected = new Set<string>();

  return await new Promise((resolve, reject) => {
    let closed = false;
    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      input.off("keypress", onKey);
      if (input.setRawMode) input.setRawMode(wasRaw);
      output.write("\x1b[?25h\n");
    };
    const currentRows = (): GitHubOrgRepo[] => filterGitHubOrgRepos(candidates, query);
    const render = (): void => {
      const rows = currentRows();
      if (cursor >= rows.length) cursor = Math.max(0, rows.length - 1);
      const width = output.columns && output.columns > 20 ? output.columns : 100;
      const visible = visibleWindow(rows, cursor, 12);
      output.write("\x1b[?25l\x1b[2J\x1b[H");
      output.write("Anchor › Select org repositories\n\n");
      output.write(`Search: ${query || "(type to filter)"}\n`);
      output.write("Use ↑/↓ to move, space to select, enter to confirm, esc to cancel.\n\n");
      if (rows.length === 0) {
        output.write("No repositories match your search.\n");
        return;
      }
      for (const { repo, index } of visible) {
        const active = index === cursor ? "›" : " ";
        const checked = selected.has(repo.fullName) ? "[x]" : "[ ]";
        const group = inferOrgRepoGroup(repo.fullName);
        const flags = [repo.private ? "private" : "public", repo.archived ? "archived" : undefined]
          .filter(Boolean)
          .join(", ");
        const detail = flags ? ` ${flags}` : "";
        output.write(
          `${active} ${checked} ${truncate(repo.fullName, Math.max(24, width - 34))} [${group}]${detail}\n`,
        );
      }
      output.write(`\nSelected: ${selected.size}\n`);
    };
    const onKey = (str: string, key: readline.Key): void => {
      try {
        const rows = currentRows();
        if (key.ctrl && key.name === "c") {
          cleanup();
          reject(new Error("Repository selection cancelled."));
          return;
        }
        if (key.name === "escape") {
          cleanup();
          resolve([]);
          return;
        }
        if (key.name === "return") {
          const selectedRepos = candidates.filter((repo) => selected.has(repo.fullName));
          cleanup();
          resolve(selectedRepos);
          return;
        }
        if (key.name === "up") {
          cursor = Math.max(0, cursor - 1);
          render();
          return;
        }
        if (key.name === "down") {
          cursor = Math.min(Math.max(0, rows.length - 1), cursor + 1);
          render();
          return;
        }
        if (key.name === "space") {
          const repo = rows[cursor];
          if (repo) {
            if (selected.has(repo.fullName)) selected.delete(repo.fullName);
            else selected.add(repo.fullName);
          }
          render();
          return;
        }
        if (key.name === "backspace" || key.name === "delete") {
          query = query.slice(0, -1);
          cursor = 0;
          render();
          return;
        }
        if (str && str >= " " && str !== "\x7f" && !key.ctrl && !key.meta) {
          query += str;
          cursor = 0;
          render();
        }
      } catch (error) {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
    input.on("keypress", onKey);
    render();
  });
}

function visibleWindow(
  rows: GitHubOrgRepo[],
  cursor: number,
  size: number,
): Array<{ repo: GitHubOrgRepo; index: number }> {
  const start = Math.max(0, Math.min(cursor - Math.floor(size / 2), rows.length - size));
  return rows.slice(start, start + size).map((repo, offset) => ({ repo, index: start + offset }));
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  if (maxLength <= 1) return value.slice(0, maxLength);
  return `${value.slice(0, maxLength - 1)}…`;
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
  const progress = createProgressReporter({
    ...options,
    title: "Cloning org repos",
    heartbeat: { org: config.org, command: options.command ?? "org clone" },
  });
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
  const command = options.command ?? "org index";
  const progress = createProgressReporter({
    ...options,
    title: command === "org sync" ? "Syncing org memory" : "Indexing org memory",
    heartbeat: { org: config.org, command },
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
      all: options.all,
      command,
      onLifecycleProgress: progress.onOrgProgress,
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
  const config = loadOrgConfig(requireOrg(options));
  const activeRun = readOrgHeartbeat(config.org);
  try {
    const db = openOrgDatabaseReadOnly(config.org);
    try {
      return getOrgStatus(db, config, undefined, { syncConfig: false, activeRun });
    } finally {
      db.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const enabledRepos = config.repos.filter((repo) => repo.enabled);
    return {
      org: config.org,
      root: path.dirname(orgDatabasePath(config.org)),
      databasePath: orgDatabasePath(config.org),
      statusReadError: message,
      activeRun,
      repoCount: config.repos.length,
      enabledRepoCount: enabledRepos.length,
      clonedRepoCount: 0,
      codeFileCount: 0,
      codeChunkCount: 0,
      wisdomUnitCount: 0,
      crossRepoEdgeCount: 0,
      apiContractCount: 0,
      apiConsumerCount: 0,
      anomalyCount: 0,
      graphVisibleEdgeCount: 0,
      graphWeakEdgeCount: 0,
      graphRenderPrepMs: undefined,
      graphEdgeConfidenceDistribution: { strong: 0, moderate: 0, weak: 0 },
      coverageScore: 0,
      coverageGrade: "empty" as const,
      coverageReasons: [
        activeRun
          ? "Status database is locked or unavailable, but an Anchor org command heartbeat is active."
          : "Status database is locked or unavailable.",
      ],
      repos: config.repos.map((repo) => ({
        ...repo,
        localPath: "",
        cloned: false,
      })),
    };
  }
}

export function runOrgGraph(options: OrgOptions) {
  const config = loadOrgConfig(requireOrg(options));
  const db = openOrgDatabase(config.org);
  const progress = createProgressReporter({
    ...options,
    title: "Building org graph",
    heartbeat: { org: config.org, command: "org graph" },
  });
  try {
    const graph = rebuildOrgGraph(db, config, {
      onProgress: progress.onGraphProgress,
    });
    const totalRepoEdges = graph.repoEdges.length + graph.hiddenRepoEdges.length;
    const metadata = {
      org: config.org,
      edges: graph.edges.length,
      totalRepoEdges,
      weakEdgesHidden: graph.hiddenRepoEdges.length,
      fileEdges: graph.fileEdges.length,
      hiddenFileEdges: graph.hiddenFileEdges.length,
      apiContracts: graph.apiContracts.length,
      apiConsumers: graph.apiConsumers.length,
      edgeConfidenceDistribution: graph.quality.edgeConfidenceDistribution,
      renderPrepMs: graph.quality.lastRenderPrepMs,
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
        `Cross-repo edges: ${metadata.edges} visible (${metadata.totalRepoEdges} total)`,
        `Weak edges hidden: ${metadata.weakEdgesHidden}`,
        `File-level edges: ${metadata.fileEdges} visible (${metadata.hiddenFileEdges} hidden)`,
        `API contracts: ${metadata.apiContracts}`,
        `API consumers: ${metadata.apiConsumers}`,
        `Confidence: strong ${metadata.edgeConfidenceDistribution.strong}, moderate ${metadata.edgeConfidenceDistribution.moderate}, weak ${metadata.edgeConfidenceDistribution.weak}`,
        `Duration: ${(metadata.durationMs / 1000).toFixed(1)}s`,
        ...(metadata.renderPrepMs !== undefined
          ? [`Render prep: ${(metadata.renderPrepMs / 1000).toFixed(2)}s`]
          : []),
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
    const result = getOrgArchitectureMap(db, config, options.format ?? "mermaid");
    if (!shouldWriteHtml(options)) return result;
    const htmlResult = writeOrgReportHtml(
      {
        kind: "map",
        org: config.org,
        markdown: result.markdown,
        metadata: result.metadata,
      },
      resolveOrgHtmlOutput(config.org, options, "org-map.html"),
    );
    if (options.open) openLocalFile(htmlResult.filePath);
    return {
      markdown: [
        result.markdown,
        "",
        `HTML report: ${htmlResult.filePath}`,
        options.open ? "Opened in your default browser." : "Open this file in a browser.",
      ].join("\n"),
      metadata: { ...result.metadata, htmlPath: htmlResult.filePath, opened: Boolean(options.open) },
    };
  } finally {
    db.close();
  }
}

export function runOrgImpact(options: OrgOptions) {
  const config = loadOrgConfig(requireOrg(options));
  const db = openOrgDatabase(config.org);
  try {
    const result = checkOrgImpact(db, config, {
      repo: options.repo,
      diff: readCurrentDiff(options.diffFile),
      strict: options.strict,
    });
    if (!shouldWriteHtml(options)) return result;
    const htmlResult = writeOrgReportHtml(
      {
        kind: "impact",
        org: config.org,
        markdown: result.markdown,
        metadata: result.metadata,
      },
      resolveOrgHtmlOutput(config.org, options, "org-impact.html"),
    );
    if (options.open) openLocalFile(htmlResult.filePath);
    return {
      markdown: [
        result.markdown,
        "",
        `HTML report: ${htmlResult.filePath}`,
        options.open ? "Opened in your default browser." : "Open this file in a browser.",
      ].join("\n"),
      metadata: { ...result.metadata, htmlPath: htmlResult.filePath, opened: Boolean(options.open) },
    };
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
    const result = {
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
    if (!shouldWriteHtml(options)) return result;
    const htmlResult = writeOrgReportHtml(
      {
        kind: "ci",
        org: config.org,
        markdown: result.markdown,
        metadata: result.metadata,
      },
      resolveOrgHtmlOutput(config.org, options, "org-ci.html"),
    );
    if (options.open) openLocalFile(htmlResult.filePath);
    return {
      markdown: [
        result.markdown,
        "",
        `HTML report: ${htmlResult.filePath}`,
        options.open ? "Opened in your default browser." : "Open this file in a browser.",
      ].join("\n"),
      metadata: { ...result.metadata, htmlPath: htmlResult.filePath, opened: Boolean(options.open) },
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
      graphVisibleEdgeCount: number;
      graphWeakEdgeCount: number;
      graphRenderPrepMs?: number;
      graphEdgeConfidenceDistribution: { strong: number; moderate: number; weak: number };
      statusReadError?: string;
      activeRun?: {
        pid: number;
        command: string;
        repo?: string;
        repoIndex?: number;
        repoTotal?: number;
        phase: string;
        pidRunning: boolean;
        stale: boolean;
        elapsedSeconds: number;
        lastUpdateAgeSeconds: number;
        timeline?: OrgRunTimelineSnapshot;
      };
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
    console.log(`Weak edges filtered: ${status.graphWeakEdgeCount}`);
    console.log(
      `Graph: ${status.graphLastStatus ?? "unknown"}${status.graphLastBuiltAt ? ` at ${status.graphLastBuiltAt}` : ""}`,
    );
    if (status.graphLastDurationMs !== undefined) {
      console.log(`Graph duration: ${(status.graphLastDurationMs / 1000).toFixed(1)}s`);
    }
    if (status.graphRenderPrepMs !== undefined) {
      console.log(`Graph render prep: ${(status.graphRenderPrepMs / 1000).toFixed(2)}s`);
    }
    console.log(
      `Graph confidence: strong ${status.graphEdgeConfidenceDistribution.strong}, moderate ${status.graphEdgeConfidenceDistribution.moderate}, weak ${status.graphEdgeConfidenceDistribution.weak}`,
    );
    if (status.graphLastError) console.log(`Graph error: ${status.graphLastError}`);
    if (status.statusReadError) console.log(`Status warning: ${status.statusReadError}`);
    if (status.activeRun) {
      const state = status.activeRun.stale
        ? "stale"
        : status.activeRun.pidRunning
          ? "running"
          : "not running";
      const repo =
        status.activeRun.repo && status.activeRun.repoIndex && status.activeRun.repoTotal
          ? `, repo ${status.activeRun.repoIndex}/${status.activeRun.repoTotal}: ${status.activeRun.repo}`
          : status.activeRun.repo
            ? `, repo: ${status.activeRun.repo}`
            : "";
      console.log(
        `Active run: ${status.activeRun.command} (${state}, pid ${status.activeRun.pid})${repo}`,
      );
      console.log(
        `Active phase: ${status.activeRun.phase}, elapsed ${status.activeRun.elapsedSeconds}s, last update ${status.activeRun.lastUpdateAgeSeconds}s ago`,
      );
      if (status.activeRun.timeline) printActiveTimeline(status.activeRun.timeline);
    }
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

function printActiveTimeline(timeline: OrgRunTimelineSnapshot): void {
  const repo =
    timeline.repo && timeline.repoIndex && timeline.repoTotal
      ? `${timeline.repoIndex}/${timeline.repoTotal}: ${timeline.repo}`
      : (timeline.repo ?? "current run");
  console.log(`Active timeline: ${repo}`);
  for (const step of timeline.steps.slice(-8)) {
    const count =
      typeof step.current === "number" && typeof step.total === "number"
        ? ` ${step.current}/${step.total}`
        : typeof step.current === "number"
          ? ` ${step.current}`
          : "";
    const duration =
      typeof step.durationMs === "number" ? `, ${formatStatusDuration(step.durationMs)}` : "";
    const detail = step.detail ? ` - ${step.detail}` : "";
    console.log(`  ${timelineStatusSymbol(step.status)} ${step.label}${count}${duration}${detail}`);
  }
  if (timeline.recentRepos.length > 0) {
    console.log("Recent repo completions:");
    for (const repoSummary of timeline.recentRepos.slice(-3)) {
      const detail = repoSummary.detail ? ` - ${repoSummary.detail}` : "";
      console.log(
        `  ${timelineStatusSymbol(repoSummary.status)} ${repoSummary.repo}, ${formatStatusDuration(repoSummary.durationMs)}${detail}`,
      );
    }
  }
}

function timelineStatusSymbol(status: OrgRunTimelineStepStatus): string {
  if (status === "done") return "✓";
  if (status === "skipped") return "◇";
  if (status === "warn") return "!";
  if (status === "fail") return "×";
  if (status === "wait") return "…";
  return "›";
}

function formatStatusDuration(durationMs: number): string {
  if (durationMs < 1000) return `${Math.max(1, Math.round(durationMs))}ms`;
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

export function printOrgInit(result: ReturnType<typeof runOrgInit>): void {
  console.log(`Anchor org initialized: ${result.config.org}`);
  console.log(`Config: ${orgConfigPath(result.config.org)}`);
  console.log(`Database: ${result.databasePath}`);
  console.log("Next: anchor org add-repo --org " + result.config.org);
}

export function printOrgAddRepo(
  result: Awaited<ReturnType<typeof runOrgAddRepoCommand>>,
): void {
  const total = result.repos.length;
  console.log(
    `Anchor org repos updated: ${total} repo${total === 1 ? "" : "s"} (${result.added} added, ${result.updated} updated, ${result.skipped} skipped)`,
  );
  for (const item of result.actions) {
    console.log(`- ${item.action}: ${item.repo.fullName} [${item.repo.group}]`);
  }
  console.log("");
  console.log("Next:");
  console.log(`1. anchor org sync --org ${result.config.org} --no-graph`);
  console.log(`2. anchor org graph --org ${result.config.org} --open`);
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
