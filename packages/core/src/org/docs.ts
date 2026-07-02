import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AnchorDatabase } from "../db/database.js";
import type { AnchorOrgConfig, AnchorOrgRepoConfig, OrgRepoGroup } from "../types.js";
import { sanitizeHistoricalText } from "../security/sanitize.js";

const GENERATOR_VERSION = "1";

export type OrgDocsOptions = {
  outputDir: string;
  baseDir?: string;
  changedOnly?: boolean;
  force?: boolean;
  strict?: boolean;
  generatedAt?: string;
};

export type OrgDocsResult = {
  markdown: string;
  metadata: {
    ok: boolean;
    org: string;
    outputDir: string;
    indexPath: string;
    manifestPath: string;
    pageCount: number;
    generatedRepos: number;
    skippedRepos: number;
    warnings: string[];
    failures: string[];
  };
};

type RepoStateRow = {
  repo: string;
  current_commit?: string | null;
  last_code_indexed_commit?: string | null;
  last_code_indexed_at?: string | null;
  last_pr_sync_at?: string | null;
  last_error?: string | null;
};

type GraphStateRow = {
  last_built_at?: string | null;
  last_status?: string | null;
  visible_edge_count?: number | null;
  weak_edge_count?: number | null;
  api_contract_count?: number | null;
  api_consumer_count?: number | null;
  last_error?: string | null;
};

type CountByRepoRow = { repo: string; count: number };

type CodeChunkRow = {
  repo: string;
  file_path: string;
  start_line: number;
  end_line: number;
  sanitized_text: string;
  symbols_json: string;
};

type PatternRow = {
  repo: string;
  area: string;
  summary_sanitized: string;
  source_files_json: string;
  confidence: number;
};

type WisdomRow = {
  repo: string;
  pr_number: number;
  pr_url: string;
  source_type: string;
  category: string;
  sanitized_text: string;
  file_paths_json: string;
  confidence: number;
};

type RegressionRow = {
  repo: string;
  pr_number: number;
  pr_url: string;
  summary_sanitized: string;
  file_paths_json: string;
  test_paths_json: string;
  confidence: number;
};

type TestRow = {
  repo: string;
  path: string;
  command?: string | null;
  reason?: string | null;
};

type RepoEdgeRow = {
  source_repo: string;
  source_path: string;
  target_repo: string;
  target_path?: string | null;
  relationship: string;
  confidence: number;
};

type ApiContractRow = {
  repo: string;
  file_path: string;
  contract: string;
  confidence: number;
};

type ApiConsumerRow = {
  provider_repo: string;
  provider_path?: string | null;
  consumer_repo: string;
  consumer_path: string;
  contract: string;
  confidence: number;
};

type RepoDoc = {
  config: AnchorOrgRepoConfig;
  slug: string;
  state?: RepoStateRow;
  fingerprint: string;
  status: "generated" | "skipped" | "failed" | "stale";
  warnings: string[];
};

type PageEntry = { path: string; title: string; kind: string };
type SearchEntry = {
  title: string;
  path: string;
  repo?: string;
  kind: string;
  area?: string;
  text: string;
};

type Manifest = {
  version: 1;
  generatorVersion: string;
  org: string;
  generatedAt: string;
  graphFingerprint: string;
  coverage: {
    repos: number;
    generatedRepos: number;
    skippedRepos: number;
    repoEdges: number;
    apiContracts: number;
    apiConsumers: number;
    pages: number;
  };
  warnings: string[];
  failures: string[];
  repos: Array<{
    repo: string;
    alias: string;
    group: OrgRepoGroup;
    status: RepoDoc["status"];
    path: string;
    commit?: string;
    fingerprint: string;
    warnings: string[];
  }>;
  pages: PageEntry[];
};

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeExternalHref(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return htmlEscape(url.href);
  } catch {
    return "#";
  }
  return "#";
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

function parseStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function stableHash(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function repoSlug(repo: AnchorOrgRepoConfig, used: Set<string>): string {
  const base = repo.alias.replace(/[^A-Za-z0-9_.-]/g, "-") || repo.fullName.split("/").pop() || "repo";
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  const slug = `${base}-${stableHash(repo.fullName).slice(0, 6)}`;
  used.add(slug);
  return slug;
}

function writeText(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function readPreviousManifest(outputDir: string): Manifest | undefined {
  const filePath = path.join(outputDir, "manifest.json");
  if (!fs.existsSync(filePath)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Manifest;
    return parsed.version === 1 ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function rowsByRepo<T extends { repo: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const existing = map.get(row.repo) ?? [];
    existing.push(row);
    map.set(row.repo, existing);
  }
  return map;
}

function countMap(rows: CountByRepoRow[]): Map<string, number> {
  return new Map(rows.map((row) => [row.repo, row.count]));
}

function loadData(db: AnchorDatabase, org: string) {
  const repoStates = new Map(
    (
      db
        .prepare(
          `SELECT repo, current_commit, last_code_indexed_commit, last_code_indexed_at,
                  last_pr_sync_at, last_error
           FROM org_repo_state
           WHERE org = ?`,
        )
        .all(org) as RepoStateRow[]
    ).map((row) => [row.repo, row]),
  );
  const graphState = db
    .prepare(
      `SELECT last_built_at, last_status, visible_edge_count, weak_edge_count,
              api_contract_count, api_consumer_count, last_error
       FROM org_graph_state
       WHERE org = ?`,
    )
    .get(org) as GraphStateRow | undefined;
  const codeChunks = db
    .prepare(
      `SELECT repo, file_path, start_line, end_line, sanitized_text, symbols_json
       FROM code_chunks
       ORDER BY updated_at DESC
       LIMIT 1200`,
    )
    .all() as CodeChunkRow[];
  const patterns = db
    .prepare(
      `SELECT repo, area, summary_sanitized, source_files_json, confidence
       FROM architecture_patterns
       ORDER BY confidence DESC, created_at DESC
       LIMIT 600`,
    )
    .all() as PatternRow[];
  const wisdom = db
    .prepare(
      `SELECT repo, pr_number, pr_url, source_type, category, sanitized_text,
              file_paths_json, confidence
       FROM wisdom_units
       ORDER BY confidence DESC, created_at DESC
       LIMIT 800`,
    )
    .all() as WisdomRow[];
  const regressions = db
    .prepare(
      `SELECT repo, pr_number, pr_url, summary_sanitized, file_paths_json,
              test_paths_json, confidence
       FROM regression_events
       ORDER BY confidence DESC, created_at DESC
       LIMIT 400`,
    )
    .all() as RegressionRow[];
  const tests = db
    .prepare(
      `SELECT repositories.full_name AS repo, test_files.path AS path,
              test_commands.command AS command, test_commands.reason AS reason
       FROM test_files
       JOIN repositories ON repositories.id = test_files.repo_id
       LEFT JOIN test_commands
         ON test_commands.repo = repositories.full_name
        AND (test_commands.file_path = test_files.path OR test_commands.file_path IS NULL)
       ORDER BY test_files.path`,
    )
    .all() as TestRow[];
  const repoEdges = db
    .prepare(
      `SELECT source_repo, source_path, target_repo, target_path, relationship, confidence
       FROM org_cross_repo_edges
       WHERE org = ? AND layer = 'repo' AND is_weak = 0
       ORDER BY confidence DESC, source_repo, target_repo`,
    )
    .all(org) as RepoEdgeRow[];
  const apiContracts = db
    .prepare(
      `SELECT repo, file_path, contract, confidence
       FROM org_api_contracts
       WHERE org = ?
       ORDER BY confidence DESC, repo, file_path`,
    )
    .all(org) as ApiContractRow[];
  const apiConsumers = db
    .prepare(
      `SELECT provider_repo, provider_path, consumer_repo, consumer_path, contract, confidence
       FROM org_api_consumers
       WHERE org = ? AND is_weak = 0
       ORDER BY confidence DESC, provider_repo, consumer_repo`,
    )
    .all(org) as ApiConsumerRow[];
  const codeCounts = countMap(
    db
      .prepare(
        `SELECT repositories.full_name AS repo, COUNT(*) AS count
         FROM code_files
         JOIN repositories ON repositories.id = code_files.repo_id
         GROUP BY repositories.full_name`,
      )
      .all() as CountByRepoRow[],
  );
  const chunkCounts = countMap(
    db
      .prepare("SELECT repo, COUNT(*) AS count FROM code_chunks GROUP BY repo")
      .all() as CountByRepoRow[],
  );
  const wisdomCounts = countMap(
    db
      .prepare("SELECT repo, COUNT(*) AS count FROM wisdom_units GROUP BY repo")
      .all() as CountByRepoRow[],
  );
  return {
    repoStates,
    graphState,
    codeByRepo: rowsByRepo(codeChunks),
    patternsByRepo: rowsByRepo(patterns),
    wisdomByRepo: rowsByRepo(wisdom),
    regressionsByRepo: rowsByRepo(regressions),
    testsByRepo: rowsByRepo(tests),
    repoEdges,
    apiContracts,
    apiConsumers,
    codeCounts,
    chunkCounts,
    wisdomCounts,
  };
}

function repoFingerprint(input: {
  repo: AnchorOrgRepoConfig;
  state?: RepoStateRow;
  codeCount: number;
  chunkCount: number;
  wisdomCount: number;
  inboundEdges: RepoEdgeRow[];
  outboundEdges: RepoEdgeRow[];
  contracts: ApiContractRow[];
  consumers: ApiConsumerRow[];
}): string {
  return stableHash({
    fullName: input.repo.fullName,
    alias: input.repo.alias,
    group: input.repo.group,
    enabled: input.repo.enabled,
    currentCommit: input.state?.current_commit,
    codeCommit: input.state?.last_code_indexed_commit,
    codeCount: input.codeCount,
    chunkCount: input.chunkCount,
    wisdomCount: input.wisdomCount,
    inboundEdges: input.inboundEdges,
    outboundEdges: input.outboundEdges,
    contracts: input.contracts,
    consumers: input.consumers,
  });
}

function pageShell(input: {
  org: string;
  title: string;
  current: string;
  content: string;
  depth?: number;
}): string {
  const prefix = "../".repeat(input.depth ?? 0);
  const nav = [
    ["Overview", `${prefix}index.html`, "overview"],
    ["APIs", `${prefix}apis/`, "apis"],
    ["Graph", `${prefix}graph/`, "graph"],
    ["Search", `${prefix}search.html`, "search"],
  ];
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${htmlEscape(input.title)} - ${htmlEscape(input.org)}</title>
  <link rel="stylesheet" href="${prefix}assets/styles.css" />
</head>
<body>
  <aside class="sidebar">
    <a class="brand" href="${prefix}index.html">Anchor Docs</a>
    <div class="org">${htmlEscape(input.org)}</div>
    <nav>
      ${nav
        .map(
          ([label, href, key]) =>
            `<a class="${key === input.current ? "active" : ""}" href="${href}">${label}</a>`,
        )
        .join("")}
    </nav>
  </aside>
  <main class="page">
    ${input.content}
  </main>
</body>
</html>`;
}

function renderMetric(label: string, value: string | number): string {
  return `<div class="metric"><span>${htmlEscape(label)}</span><strong>${htmlEscape(String(value))}</strong></div>`;
}

function renderList(items: string[], empty: string): string {
  if (items.length === 0) return `<p class="muted">${htmlEscape(empty)}</p>`;
  return `<ul>${items.map((item) => `<li>${item}</li>`).join("")}</ul>`;
}

function renderIndexPage(input: {
  org: string;
  repos: RepoDoc[];
  edges: RepoEdgeRow[];
  contracts: ApiContractRow[];
  consumers: ApiConsumerRow[];
  graphState?: GraphStateRow;
  warnings: string[];
  failures: string[];
}): string {
  const groups = new Map<OrgRepoGroup, RepoDoc[]>();
  for (const repo of input.repos) groups.set(repo.config.group, [...(groups.get(repo.config.group) ?? []), repo]);
  const groupSections = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([group, repos]) => `
        <section class="panel">
          <h2>${htmlEscape(group)}</h2>
          <div class="repo-grid">
            ${repos
              .map(
                (repo) => `
                  <a class="repo-card" href="repos/${htmlEscape(repo.slug)}/">
                    <strong>${htmlEscape(repo.config.fullName)}</strong>
                    <span>${htmlEscape(repo.state?.current_commit ?? "commit unknown")}</span>
                  </a>`,
              )
              .join("")}
          </div>
        </section>`,
    )
    .join("");
  const content = `
    <header class="hero">
      <p class="eyebrow">Local org documentation</p>
      <h1>${htmlEscape(input.org)}</h1>
      <p>Generated from Anchor org memory, current code evidence, PR history, and cross-repo graph links.</p>
    </header>
    <section class="metrics">
      ${renderMetric("Repos", input.repos.length)}
      ${renderMetric("Graph status", input.graphState?.last_status ?? "unknown")}
      ${renderMetric("Repo edges", input.edges.length)}
      ${renderMetric("API contracts", input.contracts.length)}
      ${renderMetric("API consumers", input.consumers.length)}
    </section>
    ${
      input.failures.length > 0 || input.warnings.length > 0
        ? `<section class="panel warn"><h2>Coverage and freshness</h2>${renderList(
            [
              ...input.failures.map((item) => `<strong>Failure:</strong> ${htmlEscape(item)}`),
              ...input.warnings.map((item) => `<strong>Warning:</strong> ${htmlEscape(item)}`),
            ],
            "No warnings.",
          )}</section>`
        : ""
    }
    ${groupSections}`;
  return pageShell({ org: input.org, title: "Org Overview", current: "overview", content });
}

function renderRepoPage(input: {
  org: string;
  repo: RepoDoc;
  code: CodeChunkRow[];
  patterns: PatternRow[];
  wisdom: WisdomRow[];
  regressions: RegressionRow[];
  tests: TestRow[];
  inbound: RepoEdgeRow[];
  outbound: RepoEdgeRow[];
  contracts: ApiContractRow[];
  consumersProvided: ApiConsumerRow[];
  consumersUsed: ApiConsumerRow[];
  slugByRepo: Map<string, string>;
}): string {
  const repoLink = (repo: string): string => `../${htmlEscape(input.slugByRepo.get(repo) ?? repo)}/`;
  const content = `
    <header class="hero compact">
      <p class="eyebrow">${htmlEscape(input.repo.config.group)}</p>
      <h1>${htmlEscape(input.repo.config.fullName)}</h1>
      <p>Commit: ${htmlEscape(input.repo.state?.current_commit ?? "unknown")}</p>
    </header>
    <section class="metrics">
      ${renderMetric("Code chunks", input.code.length)}
      ${renderMetric("Architecture notes", input.patterns.length)}
      ${renderMetric("Tests", input.tests.length)}
      ${renderMetric("Contracts", input.contracts.length)}
    </section>
    <section class="panel"><h2>Important code</h2>${renderList(
      input.code.slice(0, 8).map((item) => {
        const symbols = parseStringArray(item.symbols_json).slice(0, 4).join(", ");
        return `<code>${htmlEscape(item.file_path)}:${item.start_line}</code> ${htmlEscape(symbols)}`;
      }),
      "No indexed code chunks for this repo.",
    )}</section>
    <section class="panel"><h2>Architecture</h2>${renderList(
      input.patterns
        .slice(0, 8)
        .map((item) => `<strong>${htmlEscape(item.area)}</strong> ${htmlEscape(item.summary_sanitized)}`),
      "No architecture patterns indexed.",
    )}</section>
    <section class="panel"><h2>Decisions and constraints</h2>${renderList(
      input.wisdom.slice(0, 8).map(
        (item) =>
          `<strong>${htmlEscape(item.category)}</strong> ${htmlEscape(sanitizeHistoricalText(item.sanitized_text))} <a href="${safeExternalHref(item.pr_url)}">PR #${item.pr_number}</a>`,
      ),
      "No PR-history decisions indexed.",
    )}</section>
    <section class="panel"><h2>Known regressions</h2>${renderList(
      input.regressions.slice(0, 6).map(
        (item) =>
          `${htmlEscape(sanitizeHistoricalText(item.summary_sanitized))} <a href="${safeExternalHref(item.pr_url)}">PR #${item.pr_number}</a>`,
      ),
      "No regression memory indexed.",
    )}</section>
    <section class="panel"><h2>Tests</h2>${renderList(
      input.tests
        .slice(0, 10)
        .map((item) => `<code>${htmlEscape(item.path)}</code>${item.command ? ` <span>${htmlEscape(item.command)}</span>` : ""}`),
      "No tests indexed.",
    )}</section>
    <section class="split">
      <div class="panel"><h2>Consumed by</h2>${renderList(
        input.inbound.map((edge) => `<a href="${repoLink(edge.source_repo)}">${htmlEscape(edge.source_repo)}</a> ${htmlEscape(edge.relationship)}`),
        "No strong inbound repo edges.",
      )}</div>
      <div class="panel"><h2>Depends on</h2>${renderList(
        input.outbound.map((edge) => `<a href="${repoLink(edge.target_repo)}">${htmlEscape(edge.target_repo)}</a> ${htmlEscape(edge.relationship)}`),
        "No strong outbound repo edges.",
      )}</div>
    </section>
    <section class="panel"><h2>APIs</h2>${renderList(
      [
        ...input.contracts.map(
          (item) => `<strong>Provides</strong> <code>${htmlEscape(item.contract)}</code> in ${htmlEscape(item.file_path)}`,
        ),
        ...input.consumersProvided.map(
          (item) =>
            `<strong>Provider</strong> <code>${htmlEscape(item.contract)}</code> used by <a href="${repoLink(item.consumer_repo)}">${htmlEscape(item.consumer_repo)}</a>`,
        ),
        ...input.consumersUsed.map(
          (item) =>
            `<strong>Consumer</strong> <code>${htmlEscape(item.contract)}</code> from <a href="${repoLink(item.provider_repo)}">${htmlEscape(item.provider_repo)}</a>`,
        ),
      ],
      "No API contracts or consumers indexed.",
    )}</section>`;
  return pageShell({
    org: input.org,
    title: input.repo.config.fullName,
    current: "overview",
    content,
    depth: 2,
  });
}

function renderApisPage(input: {
  org: string;
  contracts: ApiContractRow[];
  consumers: ApiConsumerRow[];
  slugByRepo: Map<string, string>;
}): string {
  const repoPath = (repo: string): string => `../repos/${htmlEscape(input.slugByRepo.get(repo) ?? repo)}/`;
  const content = `
    <header class="hero compact"><p class="eyebrow">Contracts and consumers</p><h1>APIs</h1></header>
    <section class="panel"><h2>Contracts</h2>${renderList(
      input.contracts.map(
        (item) =>
          `<a href="${repoPath(item.repo)}">${htmlEscape(item.repo)}</a> <code>${htmlEscape(item.contract)}</code> ${htmlEscape(item.file_path)}`,
      ),
      "No API contracts indexed.",
    )}</section>
    <section class="panel"><h2>Consumers</h2>${renderList(
      input.consumers.map(
        (item) =>
          `<a href="${repoPath(item.consumer_repo)}">${htmlEscape(item.consumer_repo)}</a> uses <a href="${repoPath(item.provider_repo)}">${htmlEscape(item.provider_repo)}</a> <code>${htmlEscape(item.contract)}</code>`,
      ),
      "No API consumers indexed.",
    )}</section>`;
  return pageShell({ org: input.org, title: "APIs", current: "apis", content, depth: 1 });
}

function renderGraphPage(input: {
  org: string;
  edges: RepoEdgeRow[];
  slugByRepo: Map<string, string>;
}): string {
  const repoPath = (repo: string): string => `../repos/${htmlEscape(input.slugByRepo.get(repo) ?? repo)}/`;
  const content = `
    <header class="hero compact"><p class="eyebrow">Strong cross-repo links</p><h1>Graph</h1></header>
    <section class="panel edge-list">${renderList(
      input.edges.map(
        (edge) =>
          `<a href="${repoPath(edge.source_repo)}">${htmlEscape(edge.source_repo)}</a> <span>${htmlEscape(edge.relationship)}</span> <a href="${repoPath(edge.target_repo)}">${htmlEscape(edge.target_repo)}</a> <small>${edge.confidence.toFixed(2)}</small>`,
      ),
      "No strong repo edges indexed.",
    )}</section>`;
  return pageShell({ org: input.org, title: "Graph", current: "graph", content, depth: 1 });
}

function renderSearchPage(org: string): string {
  const content = `
    <header class="hero compact"><p class="eyebrow">Offline search</p><h1>Search</h1></header>
    <section class="panel search-panel">
      <input id="search" type="search" placeholder="Search repos, APIs, files, tests, and decisions" autofocus />
      <div class="filters">
        <button data-filter="all" class="active">All</button>
        <button data-filter="repo">Repos</button>
        <button data-filter="api">APIs</button>
        <button data-filter="test">Tests</button>
        <button data-filter="regression">Regressions</button>
        <button data-filter="decision">Decisions</button>
        <button data-filter="file">Files</button>
      </div>
      <div id="results" class="results"></div>
    </section>
    <script src="assets/search-index.js"></script>
    <script>
      const data = window.__ANCHOR_DOCS_SEARCH__ || [];
      const input = document.getElementById("search");
      const results = document.getElementById("results");
      let filter = "all";
      function esc(value) {
        return String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
      }
      function render() {
        const q = input.value.trim().toLowerCase();
        const rows = data.filter(item => (filter === "all" || item.kind === filter) && (!q || (item.text + " " + item.title + " " + (item.repo || "")).toLowerCase().includes(q))).slice(0, 80);
        results.innerHTML = rows.map(item => '<a class="result" href="' + esc(item.path) + '"><strong>' + esc(item.title) + '</strong><span>' + esc(item.kind) + (item.repo ? " · " + esc(item.repo) : "") + '</span><p>' + esc(item.text).slice(0, 220) + '</p></a>').join("") || '<p class="muted">No results.</p>';
      }
      document.querySelectorAll("[data-filter]").forEach(button => button.addEventListener("click", () => {
        document.querySelectorAll("[data-filter]").forEach(item => item.classList.remove("active"));
        button.classList.add("active");
        filter = button.dataset.filter || "all";
        render();
      }));
      input.addEventListener("input", render);
      render();
    </script>`;
  return pageShell({ org, title: "Search", current: "search", content });
}

function renderStyles(): string {
  return `:root{color-scheme:light;--bg:#f5f7fb;--panel:#fff;--line:#d8dee8;--text:#182230;--muted:#66758a;--accent:#2057a8;--warn:#8a5a14;--danger:#922828}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;line-height:1.45}.sidebar{position:fixed;inset:0 auto 0 0;width:230px;padding:18px;background:#0f1724;color:white}.brand{display:block;color:white;font-weight:800;text-decoration:none;font-size:18px}.org{margin:4px 0 18px;color:#aab6c8;font-size:13px}.sidebar nav{display:grid;gap:6px}.sidebar a{color:#d8e2f2;text-decoration:none;padding:9px 10px;border-radius:8px}.sidebar a.active,.sidebar a:hover{background:#1f3150;color:white}.page{margin-left:230px;padding:22px;width:min(1200px,calc(100vw - 230px))}.hero{padding:26px 0 18px}.hero.compact{padding-top:8px}.eyebrow{text-transform:uppercase;letter-spacing:.08em;color:var(--accent);font-size:12px;font-weight:800;margin:0 0 6px}h1{font-size:34px;line-height:1.05;margin:0 0 8px}h2{font-size:18px;margin:0 0 10px}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:0 0 14px}.metric,.panel,.repo-card{background:var(--panel);border:1px solid var(--line);border-radius:8px}.metric{padding:12px}.metric span,.muted,small{color:var(--muted)}.metric strong{display:block;font-size:24px}.panel{padding:14px;margin:0 0 12px}.warn{border-color:#e6c57d}.repo-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}.repo-card{display:grid;gap:6px;text-decoration:none;color:var(--text);padding:12px}.repo-card:hover{border-color:var(--accent)}.repo-card span{color:var(--muted);font-size:12px}.split{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}ul{margin:0;padding-left:18px}li{margin:6px 0}code{background:#edf2f7;border:1px solid #d7e0ea;border-radius:5px;padding:1px 5px}a{color:var(--accent)}.edge-list li{list-style:none;margin:8px 0}.edge-list ul{padding:0}.edge-list span{display:inline-block;margin:0 8px;color:var(--muted)}input[type=search]{width:100%;padding:12px;border:1px solid var(--line);border-radius:8px;font-size:16px}.filters{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.filters button{border:1px solid var(--line);background:white;border-radius:7px;padding:7px 10px}.filters button.active{background:var(--accent);color:white}.result{display:block;border-top:1px solid var(--line);padding:12px 0;text-decoration:none;color:var(--text)}.result span{display:block;color:var(--muted);font-size:12px}.result p{margin:5px 0 0;color:var(--muted)}@media(max-width:760px){.sidebar{position:static;width:auto}.page{margin:0;width:100%;padding:16px}h1{font-size:28px}}`;
}

function buildSearchEntries(input: {
  repos: RepoDoc[];
  codeByRepo: Map<string, CodeChunkRow[]>;
  patternsByRepo: Map<string, PatternRow[]>;
  wisdomByRepo: Map<string, WisdomRow[]>;
  regressionsByRepo: Map<string, RegressionRow[]>;
  testsByRepo: Map<string, TestRow[]>;
  contracts: ApiContractRow[];
  consumers: ApiConsumerRow[];
}): SearchEntry[] {
  const entries: SearchEntry[] = [];
  for (const repo of input.repos) {
    entries.push({
      title: repo.config.fullName,
      repo: repo.config.fullName,
      kind: "repo",
      path: `repos/${repo.slug}/`,
      text: `${repo.config.group} ${repo.state?.current_commit ?? ""}`,
    });
    for (const item of input.codeByRepo.get(repo.config.fullName)?.slice(0, 40) ?? []) {
      entries.push({
        title: item.file_path,
        repo: repo.config.fullName,
        kind: "file",
        path: `repos/${repo.slug}/`,
        text: `${item.sanitized_text} ${parseStringArray(item.symbols_json).join(" ")}`,
      });
    }
    for (const item of input.patternsByRepo.get(repo.config.fullName) ?? []) {
      entries.push({
        title: `${repo.config.fullName} ${item.area}`,
        repo: repo.config.fullName,
        kind: "decision",
        area: item.area,
        path: `repos/${repo.slug}/`,
        text: item.summary_sanitized,
      });
    }
    for (const item of input.wisdomByRepo.get(repo.config.fullName) ?? []) {
      entries.push({
        title: `${item.category} PR #${item.pr_number}`,
        repo: repo.config.fullName,
        kind: "decision",
        path: `repos/${repo.slug}/`,
        text: item.sanitized_text,
      });
    }
    for (const item of input.regressionsByRepo.get(repo.config.fullName) ?? []) {
      entries.push({
        title: `Regression PR #${item.pr_number}`,
        repo: repo.config.fullName,
        kind: "regression",
        path: `repos/${repo.slug}/`,
        text: item.summary_sanitized,
      });
    }
    for (const item of input.testsByRepo.get(repo.config.fullName) ?? []) {
      entries.push({
        title: item.path,
        repo: repo.config.fullName,
        kind: "test",
        path: `repos/${repo.slug}/`,
        text: item.command ?? item.reason ?? item.path,
      });
    }
  }
  for (const contract of input.contracts) {
    entries.push({
      title: contract.contract,
      repo: contract.repo,
      kind: "api",
      path: "apis/",
      text: `${contract.repo} ${contract.file_path}`,
    });
  }
  for (const consumer of input.consumers) {
    entries.push({
      title: `${consumer.consumer_repo} uses ${consumer.contract}`,
      repo: consumer.consumer_repo,
      kind: "api",
      path: "apis/",
      text: `${consumer.provider_repo} ${consumer.provider_path ?? ""} ${consumer.consumer_path}`,
    });
  }
  return entries;
}

export function generateOrgDocsSite(
  db: AnchorDatabase,
  config: AnchorOrgConfig,
  options: OrgDocsOptions,
): OrgDocsResult {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const enabledRepos = config.repos.filter((repo) => repo.enabled);
  const data = loadData(db, config.org);
  const warnings: string[] = [];
  const failures: string[] = [];
  if (!data.graphState) warnings.push("Org graph has not been built yet.");
  if (data.graphState?.last_status && data.graphState.last_status !== "success") {
    failures.push(`Org graph status is ${data.graphState.last_status}.`);
  }

  const previous = readPreviousManifest(options.outputDir);
  const usedSlugs = new Set<string>();
  const slugByRepo = new Map<string, string>();
  const repos: RepoDoc[] = enabledRepos.map((repo): RepoDoc => {
    const slug = repoSlug(repo, usedSlugs);
    slugByRepo.set(repo.fullName, slug);
    const state = data.repoStates.get(repo.fullName);
    const inboundEdges = data.repoEdges.filter((edge) => edge.target_repo === repo.fullName);
    const outboundEdges = data.repoEdges.filter((edge) => edge.source_repo === repo.fullName);
    const contracts = data.apiContracts.filter((item) => item.repo === repo.fullName);
    const consumers = data.apiConsumers.filter(
      (item) => item.provider_repo === repo.fullName || item.consumer_repo === repo.fullName,
    );
    const fingerprint = repoFingerprint({
      repo,
      state,
      codeCount: data.codeCounts.get(repo.fullName) ?? 0,
      chunkCount: data.chunkCounts.get(repo.fullName) ?? 0,
      wisdomCount: data.wisdomCounts.get(repo.fullName) ?? 0,
      inboundEdges,
      outboundEdges,
      contracts,
      consumers,
    });
    const repoWarnings = [
      ...(state ? [] : ["Repo state is missing from org index."]),
      ...(state?.last_error ? [`Last index error: ${state.last_error}`] : []),
    ];
    if (repoWarnings.length > 0) warnings.push(`${repo.fullName}: ${repoWarnings.join("; ")}`);
    const previousRepo = previous?.repos.find((item) => item.repo === repo.fullName);
    const pagePath = path.join(options.outputDir, "repos", slug, "index.html");
    const unchanged =
      Boolean(options.changedOnly && !options.force) &&
      previousRepo?.fingerprint === fingerprint &&
      fs.existsSync(pagePath);
    return {
      config: repo,
      slug,
      state,
      fingerprint,
      status: unchanged ? "skipped" : repoWarnings.length > 0 ? "stale" : "generated",
      warnings: repoWarnings,
    };
  });

  fs.mkdirSync(options.outputDir, { recursive: true });
  writeText(path.join(options.outputDir, "assets", "styles.css"), renderStyles());

  const pages: PageEntry[] = [
    { path: "index.html", title: "Org Overview", kind: "overview" },
    { path: "apis/index.html", title: "APIs", kind: "api" },
    { path: "graph/index.html", title: "Graph", kind: "graph" },
    { path: "search.html", title: "Search", kind: "search" },
  ];
  writeText(
    path.join(options.outputDir, "index.html"),
    renderIndexPage({
      org: config.org,
      repos,
      edges: data.repoEdges,
      contracts: data.apiContracts,
      consumers: data.apiConsumers,
      graphState: data.graphState,
      warnings,
      failures,
    }),
  );
  writeText(
    path.join(options.outputDir, "apis", "index.html"),
    renderApisPage({
      org: config.org,
      contracts: data.apiContracts,
      consumers: data.apiConsumers,
      slugByRepo,
    }),
  );
  writeText(
    path.join(options.outputDir, "graph", "index.html"),
    renderGraphPage({ org: config.org, edges: data.repoEdges, slugByRepo }),
  );
  writeText(path.join(options.outputDir, "search.html"), renderSearchPage(config.org));

  for (const repo of repos) {
    pages.push({ path: `repos/${repo.slug}/index.html`, title: repo.config.fullName, kind: "repo" });
    if (repo.status === "skipped") continue;
    try {
      writeText(
        path.join(options.outputDir, "repos", repo.slug, "index.html"),
        renderRepoPage({
          org: config.org,
          repo,
          code: data.codeByRepo.get(repo.config.fullName) ?? [],
          patterns: data.patternsByRepo.get(repo.config.fullName) ?? [],
          wisdom: data.wisdomByRepo.get(repo.config.fullName) ?? [],
          regressions: data.regressionsByRepo.get(repo.config.fullName) ?? [],
          tests: data.testsByRepo.get(repo.config.fullName) ?? [],
          inbound: data.repoEdges.filter((edge) => edge.target_repo === repo.config.fullName),
          outbound: data.repoEdges.filter((edge) => edge.source_repo === repo.config.fullName),
          contracts: data.apiContracts.filter((item) => item.repo === repo.config.fullName),
          consumersProvided: data.apiConsumers.filter((item) => item.provider_repo === repo.config.fullName),
          consumersUsed: data.apiConsumers.filter((item) => item.consumer_repo === repo.config.fullName),
          slugByRepo,
        }),
      );
    } catch (error) {
      repo.status = "failed";
      const message = error instanceof Error ? error.message : String(error);
      repo.warnings.push(message);
      failures.push(`${repo.config.fullName}: ${message}`);
    }
  }

  const searchEntries = buildSearchEntries({
    repos,
    codeByRepo: data.codeByRepo,
    patternsByRepo: data.patternsByRepo,
    wisdomByRepo: data.wisdomByRepo,
    regressionsByRepo: data.regressionsByRepo,
    testsByRepo: data.testsByRepo,
    contracts: data.apiContracts,
    consumers: data.apiConsumers,
  });
  writeText(
    path.join(options.outputDir, "assets", "search-index.js"),
    `window.__ANCHOR_DOCS_SEARCH__ = ${safeJson(searchEntries)};\n`,
  );

  if (options.strict) {
    for (const repo of repos) {
      if (repo.status === "failed" || repo.status === "stale") {
        failures.push(`${repo.config.fullName} docs status is ${repo.status}.`);
      }
    }
    if (pages.length < enabledRepos.length + 4) failures.push("Docs page coverage is incomplete.");
  }

  const graphFingerprint = stableHash({
    status: data.graphState?.last_status ?? "unknown",
    builtAt: data.graphState?.last_built_at,
    edges: data.repoEdges,
    contracts: data.apiContracts,
    consumers: data.apiConsumers,
  });
  const manifest: Manifest = {
    version: 1,
    generatorVersion: GENERATOR_VERSION,
    org: config.org,
    generatedAt,
    graphFingerprint,
    coverage: {
      repos: enabledRepos.length,
      generatedRepos: repos.filter((repo) => repo.status === "generated").length,
      skippedRepos: repos.filter((repo) => repo.status === "skipped").length,
      repoEdges: data.repoEdges.length,
      apiContracts: data.apiContracts.length,
      apiConsumers: data.apiConsumers.length,
      pages: pages.length,
    },
    warnings,
    failures,
    repos: repos.map((repo) => ({
      repo: repo.config.fullName,
      alias: repo.config.alias,
      group: repo.config.group,
      status: repo.status,
      path: `repos/${repo.slug}/index.html`,
      commit: repo.state?.current_commit ?? undefined,
      fingerprint: repo.fingerprint,
      warnings: repo.warnings,
    })),
    pages,
  };
  writeText(path.join(options.outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  const ok = failures.length === 0;
  const markdown = [
    "# Anchor Org Docs",
    "",
    `Org: ${config.org}`,
    `Output: ${options.outputDir}`,
    `Pages: ${pages.length}`,
    `Repos: ${enabledRepos.length}`,
    `Generated repos: ${manifest.coverage.generatedRepos}`,
    `Skipped repos: ${manifest.coverage.skippedRepos}`,
    `Warnings: ${warnings.length}`,
    `Strict failures: ${failures.length}`,
    `Open: ${path.join(options.outputDir, "index.html")}`,
  ].join("\n");

  return {
    markdown,
    metadata: {
      ok,
      org: config.org,
      outputDir: options.outputDir,
      indexPath: path.join(options.outputDir, "index.html"),
      manifestPath: path.join(options.outputDir, "manifest.json"),
      pageCount: pages.length,
      generatedRepos: manifest.coverage.generatedRepos,
      skippedRepos: manifest.coverage.skippedRepos,
      warnings,
      failures,
    },
  };
}
