import fs from "node:fs";
import path from "node:path";

export type AuditCheck = {
  name: string;
  ok: boolean;
  detail: string;
};

type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}>;

const expectedDescription =
  "Local-first MCP server that gives AI coding agents repo and org memory from GitHub PR history, code, tests, regressions, architecture, and cross-repo impact.";
const expectedPackageDescription =
  "Local-first MCP server and CLI for AI coding agents, repo memory, org memory, GitHub PR history, codebase indexing, regressions, and cross-repo impact.";
const expectedSocialImage = "social-preview-repo-org.png";
const packageName = "@pratik7368patil/anchor";
const repo = "pratik7368patil/anchor";
const siteUrl = "https://anchor-mcp.netlify.app";

export const requiredTopics = [
  "mcp",
  "mcp-server",
  "model-context-protocol",
  "ai-coding",
  "coding-agent",
  "repo-memory",
  "org-memory",
  "github-pr-history",
  "codebase-indexing",
  "cross-repo-impact",
  "cursor",
  "claude-code",
  "codex",
  "local-first",
  "sqlite",
  "typescript",
  "developer-tools",
  "regression-testing",
  "code-review",
  "architecture",
];

export const stalePhrases = [
  ["Cursor", "only"].join("-"),
  ["Repo Memory for", "Cursor"].join(" "),
  ["Local-first", "Cursor", "MCP server"].join(" "),
  `${siteUrl}/${["social-preview", "png"].join(".")}`,
];

export function findStalePhrases(text: string, phrases = stalePhrases): string[] {
  const lower = text.toLowerCase();
  return phrases.filter((phrase) => lower.includes(phrase.toLowerCase()));
}

export function missingTopics(topics: string[], required = requiredTopics): string[] {
  const normalized = new Set(topics.map((topic) => topic.toLowerCase()));
  return required.filter((topic) => !normalized.has(topic));
}

export function runLocalAudit(cwd: string): AuditCheck[] {
  const checks: AuditCheck[] = [];
  const content = readFile(cwd, "apps/site/src/content.ts");
  const indexHtml = readFile(cwd, "apps/site/index.html");
  const sitemap = readFile(cwd, "apps/site/public/sitemap.xml");
  const readme = readFile(cwd, "README.md");
  const settings = readFile(cwd, "docs/github-repo-settings.md");
  const growth = readFile(cwd, "docs/growth-playbook.md");
  const distribution = readFile(cwd, "docs/directory-submission-pack.md");
  const llms = readFile(cwd, "apps/site/public/llms.txt");
  const cliPackage = readJson<{ version?: string; description?: string }>(
    cwd,
    "packages/cli/package.json",
  );
  const corePackage = readJson<{ version?: string }>(cwd, "packages/core/package.json");
  const mcpPackage = readJson<{ version?: string }>(cwd, "packages/mcp-server/package.json");

  checks.push({
    name: "social preview asset",
    ok:
      fs.existsSync(path.join(cwd, "apps/site/public", expectedSocialImage)) &&
      fs.existsSync(path.join(cwd, "assets/marketing", expectedSocialImage)),
    detail: expectedSocialImage,
  });
  checks.push({
    name: "active site social metadata",
    ok: content.includes(expectedSocialImage) && indexHtml.includes(expectedSocialImage),
    detail: "site content and static HTML use cache-busted preview",
  });
  checks.push({
    name: "llms.txt",
    ok: llms.includes("local repo and org memory") && llms.includes("No CLI telemetry"),
    detail: "AI/search discovery file exists",
  });
  checks.push({
    name: "showcase route",
    ok: content.includes('path: "/docs/showcase"') && sitemap.includes("/docs/showcase"),
    detail: "showcase page is registered and listed",
  });
  checks.push({
    name: "package versions",
    ok:
      cliPackage.version === "0.1.40" &&
      corePackage.version === "0.1.40" &&
      mcpPackage.version === "0.1.40",
    detail: "all published packages should be 0.1.40",
  });
  checks.push({
    name: "package description",
    ok: cliPackage.description === expectedPackageDescription,
    detail: expectedPackageDescription,
  });
  checks.push({
    name: "repo settings copy",
    ok:
      settings.includes(expectedDescription) &&
      requiredTopics.every((topic) => settings.includes(topic)),
    detail: "description and topic checklist are current",
  });
  checks.push({
    name: "distribution pack",
    ok:
      distribution.includes("Directory Checklist") &&
      distribution.includes("Repo memory") &&
      distribution.includes("Org memory"),
    detail: "directory and community copy exists",
  });

  const staleScan = [
    readme,
    settings,
    growth,
    distribution,
    llms,
    content,
    indexHtml,
    sitemap,
  ].join("\n");
  const stale = findStalePhrases(staleScan);
  checks.push({
    name: "stale positioning scan",
    ok: stale.length === 0,
    detail: stale.length === 0 ? "no stale phrases found" : `found: ${stale.join(", ")}`,
  });

  return checks;
}

export async function runLiveAudit(fetchImpl: FetchLike = fetch): Promise<AuditCheck[]> {
  const checks: AuditCheck[] = [];
  const siteHtml = await fetchText(fetchImpl, `${siteUrl}/`);
  const npmPackage = await fetchJson<NpmPackage>(
    fetchImpl,
    `https://registry.npmjs.org/${encodeURIComponent(packageName)}`,
  );
  const repoData = await fetchJson<GitHubRepo>(
    fetchImpl,
    `https://api.github.com/repos/${repo}`,
    githubHeaders(),
  );

  checks.push({
    name: "live site social metadata",
    ok:
      siteHtml.includes(expectedSocialImage) &&
      siteHtml.includes("Local repo and org memory for AI coding agents"),
    detail: siteUrl,
  });
  checks.push({
    name: "live npm metadata",
    ok:
      npmPackage.description === expectedPackageDescription &&
      typeof npmPackage["dist-tags"]?.latest === "string",
    detail: `${packageName}@${npmPackage["dist-tags"]?.latest ?? "unknown"}`,
  });
  checks.push({
    name: "live GitHub description",
    ok: repoData.description === expectedDescription,
    detail: repoData.description ?? "missing description",
  });
  checks.push({
    name: "live GitHub topics",
    ok: missingTopics(repoData.topics ?? []).length === 0,
    detail: missingTopics(repoData.topics ?? []).join(", ") || "all required topics present",
  });

  return checks;
}

function readFile(cwd: string, relativePath: string): string {
  return fs.readFileSync(path.join(cwd, relativePath), "utf8");
}

function readJson<T>(cwd: string, relativePath: string): T {
  return JSON.parse(readFile(cwd, relativePath)) as T;
}

async function fetchText(fetchImpl: FetchLike, url: string): Promise<string> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Request failed ${response.status}: ${url}`);
  return response.text();
}

async function fetchJson<T>(
  fetchImpl: FetchLike,
  url: string,
  headers?: Record<string, string>,
): Promise<T> {
  const response = await fetchImpl(url, headers ? { headers } : undefined);
  if (!response.ok) throw new Error(`Request failed ${response.status}: ${url}`);
  return response.json() as Promise<T>;
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "anchor-growth-audit",
  };
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

function printChecks(checks: AuditCheck[]): void {
  for (const check of checks) {
    const marker = check.ok ? "✓" : "✗";
    console.log(`${marker} ${check.name}: ${check.detail}`);
  }
}

type NpmPackage = {
  description?: string;
  "dist-tags"?: {
    latest?: string;
  };
};

type GitHubRepo = {
  description?: string | null;
  topics?: string[];
};

async function main(): Promise<void> {
  const includeLive =
    process.argv.includes("--live") || process.env.ANCHOR_GROWTH_AUDIT_LIVE === "1";
  const checks = runLocalAudit(process.cwd());
  if (includeLive) {
    try {
      checks.push(...(await runLiveAudit()));
    } catch (error) {
      checks.push({
        name: "live public surface audit",
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
  printChecks(checks);
  if (checks.some((check) => !check.ok)) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to run growth audit: ${message}`);
    process.exitCode = 1;
  });
}
