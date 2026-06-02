import fs from "node:fs";
import path from "node:path";

export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

export type AdoptionStats = {
  schemaVersion: 1;
  generatedAt: string;
  project: {
    packageName: string;
    repository: string;
    statsStartDate: string;
  };
  npm: {
    downloads: {
      lastDay: number;
      lastWeek: number;
      lastMonth: number;
      sinceStartDate: number;
    };
  };
  github: {
    stars: number;
    forks: number;
    watchers: number;
    subscribers: number | null;
    openIssues: number;
    latestRelease: {
      tagName: string;
      name: string;
      publishedAt: string;
      url: string;
    } | null;
    traffic: {
      clones: TrafficSummary | null;
      views: TrafficSummary | null;
      referrers: TrafficReferrer[];
      paths: TrafficPath[];
    };
  };
  site: {
    analyticsProvider: "goatcounter";
    configured: boolean;
  };
  notes: string[];
  warnings: string[];
};

export type TrafficSummary = {
  count: number;
  uniques: number;
  periodDays: number;
};

export type TrafficReferrer = {
  referrer: string;
  count: number;
  uniques: number;
};

export type TrafficPath = {
  path: string;
  title: string;
  count: number;
  uniques: number;
};

export type AdoptionHistory = {
  schemaVersion: 1;
  updatedAt: string;
  days: AdoptionHistoryDay[];
};

export type AdoptionHistoryDay = {
  date: string;
  npmDownloads: {
    lastDay: number;
    lastWeek: number;
    lastMonth: number;
    sinceStartDate: number;
  };
  github: {
    stars: number;
    forks: number;
    cloneUniques: number | null;
    viewUniques: number | null;
    cloneCount: number | null;
    viewCount: number | null;
  };
  warningCount: number;
};

export type CollectAdoptionStatsOptions = {
  fetch: FetchLike;
  packageName: string;
  repository: string;
  statsStartDate: string;
  generatedAt: string;
  githubToken?: string;
  goatCounterCode?: string;
};

const npmBaseUrl = "https://api.npmjs.org/downloads";
const githubBaseUrl = "https://api.github.com";

export async function collectAdoptionStats(
  options: CollectAdoptionStatsOptions,
): Promise<AdoptionStats> {
  const warnings: string[] = [];
  const notes = [
    "Anchor CLI and MCP do not send telemetry.",
    "npm downloads are aggregate package tarball downloads, not unique users.",
    "GitHub traffic uniques are platform-provided aggregate signals and may include automated traffic.",
  ];

  const npmDownloads = {
    lastDay: await fetchNpmPoint(options, "last-day", warnings),
    lastWeek: await fetchNpmPoint(options, "last-week", warnings),
    lastMonth: await fetchNpmPoint(options, "last-month", warnings),
    sinceStartDate: await fetchNpmRangeTotal(options, warnings),
  };

  const repo = await fetchGitHubRepository(options, warnings);
  const latestRelease = await fetchLatestRelease(options, warnings);
  const traffic = await fetchGitHubTraffic(options, warnings);

  return {
    schemaVersion: 1,
    generatedAt: options.generatedAt,
    project: {
      packageName: options.packageName,
      repository: options.repository,
      statsStartDate: options.statsStartDate,
    },
    npm: {
      downloads: npmDownloads,
    },
    github: {
      stars: repo?.stars ?? 0,
      forks: repo?.forks ?? 0,
      watchers: repo?.watchers ?? 0,
      subscribers: repo?.subscribers ?? null,
      openIssues: repo?.openIssues ?? 0,
      latestRelease,
      traffic,
    },
    site: {
      analyticsProvider: "goatcounter",
      configured: Boolean(options.goatCounterCode),
    },
    notes,
    warnings,
  };
}

export function mergeAdoptionHistory(
  existing: AdoptionHistory | null,
  stats: AdoptionStats,
  date: string,
  maxDays = 365,
): AdoptionHistory {
  const nextDay: AdoptionHistoryDay = {
    date,
    npmDownloads: stats.npm.downloads,
    github: {
      stars: stats.github.stars,
      forks: stats.github.forks,
      cloneUniques: stats.github.traffic.clones?.uniques ?? null,
      viewUniques: stats.github.traffic.views?.uniques ?? null,
      cloneCount: stats.github.traffic.clones?.count ?? null,
      viewCount: stats.github.traffic.views?.count ?? null,
    },
    warningCount: stats.warnings.length,
  };
  const priorDays = existing?.days.filter((day) => day.date !== date) ?? [];
  const days = [...priorDays, nextDay]
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(Math.max(0, priorDays.length + 1 - maxDays));

  return {
    schemaVersion: 1,
    updatedAt: stats.generatedAt,
    days,
  };
}

export function validateAdoptionStats(value: unknown): value is AdoptionStats {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== 1) return false;
  if (typeof value.generatedAt !== "string") return false;
  if (!isRecord(value.project) || typeof value.project.packageName !== "string") return false;
  if (!isRecord(value.npm) || !isRecord(value.npm.downloads)) return false;
  if (!hasNumber(value.npm.downloads, "lastDay")) return false;
  if (!hasNumber(value.npm.downloads, "lastWeek")) return false;
  if (!hasNumber(value.npm.downloads, "lastMonth")) return false;
  if (!hasNumber(value.npm.downloads, "sinceStartDate")) return false;
  if (!isRecord(value.github) || !hasNumber(value.github, "stars")) return false;
  if (!isRecord(value.github.traffic)) return false;
  return Array.isArray(value.notes) && Array.isArray(value.warnings);
}

export function validateAdoptionHistory(value: unknown): value is AdoptionHistory {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== 1) return false;
  if (typeof value.updatedAt !== "string") return false;
  if (!Array.isArray(value.days)) return false;
  return value.days.every(
    (day) =>
      isRecord(day) &&
      typeof day.date === "string" &&
      isRecord(day.npmDownloads) &&
      hasNumber(day.npmDownloads, "lastDay") &&
      isRecord(day.github) &&
      hasNumber(day.github, "stars") &&
      typeof day.warningCount === "number",
  );
}

export function readJsonFile<T>(filePath: string, validator: (value: unknown) => value is T): T | null {
  if (!fs.existsSync(filePath)) return null;
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  return validator(parsed) ? parsed : null;
}

export function writeJsonFile(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function fetchNpmPoint(
  options: CollectAdoptionStatsOptions,
  period: "last-day" | "last-week" | "last-month",
  warnings: string[],
): Promise<number> {
  const result = await fetchJson(
    options,
    `${npmBaseUrl}/point/${period}/${encodeURIComponent(options.packageName)}`,
    warnings,
    `npm ${period}`,
  );
  return isRecord(result) && typeof result.downloads === "number" ? result.downloads : 0;
}

async function fetchNpmRangeTotal(
  options: CollectAdoptionStatsOptions,
  warnings: string[],
): Promise<number> {
  const endDate = options.generatedAt.slice(0, 10);
  const result = await fetchJson(
    options,
    `${npmBaseUrl}/range/${options.statsStartDate}:${endDate}/${encodeURIComponent(options.packageName)}`,
    warnings,
    "npm range",
  );
  if (!isRecord(result) || !Array.isArray(result.downloads)) return 0;
  return result.downloads.reduce((total, item) => {
    if (!isRecord(item) || typeof item.downloads !== "number") return total;
    return total + item.downloads;
  }, 0);
}

async function fetchGitHubRepository(
  options: CollectAdoptionStatsOptions,
  warnings: string[],
): Promise<{
  stars: number;
  forks: number;
  watchers: number;
  subscribers: number | null;
  openIssues: number;
} | null> {
  const result = await fetchJson(
    options,
    `${githubBaseUrl}/repos/${options.repository}`,
    warnings,
    "GitHub repository stats",
  );
  if (!isRecord(result)) return null;
  return {
    stars: readNumber(result.stargazers_count),
    forks: readNumber(result.forks_count),
    watchers: readNumber(result.watchers_count),
    subscribers: typeof result.subscribers_count === "number" ? result.subscribers_count : null,
    openIssues: readNumber(result.open_issues_count),
  };
}

async function fetchLatestRelease(
  options: CollectAdoptionStatsOptions,
  warnings: string[],
): Promise<AdoptionStats["github"]["latestRelease"]> {
  const result = await fetchJson(
    options,
    `${githubBaseUrl}/repos/${options.repository}/releases/latest`,
    warnings,
    "GitHub latest release",
  );
  if (!isRecord(result)) return null;
  return {
    tagName: typeof result.tag_name === "string" ? result.tag_name : "",
    name: typeof result.name === "string" ? result.name : "",
    publishedAt: typeof result.published_at === "string" ? result.published_at : "",
    url: typeof result.html_url === "string" ? result.html_url : "",
  };
}

async function fetchGitHubTraffic(
  options: CollectAdoptionStatsOptions,
  warnings: string[],
): Promise<AdoptionStats["github"]["traffic"]> {
  if (!options.githubToken) {
    warnings.push("GitHub traffic skipped because GH_TRAFFIC_TOKEN is not configured.");
    return { clones: null, views: null, referrers: [], paths: [] };
  }
  const clones = parseTrafficSummary(
    await fetchJson(
      options,
      `${githubBaseUrl}/repos/${options.repository}/traffic/clones`,
      warnings,
      "GitHub traffic clones",
    ),
  );
  const views = parseTrafficSummary(
    await fetchJson(
      options,
      `${githubBaseUrl}/repos/${options.repository}/traffic/views`,
      warnings,
      "GitHub traffic views",
    ),
  );
  const referrers = parseTrafficReferrers(
    await fetchJson(
      options,
      `${githubBaseUrl}/repos/${options.repository}/traffic/popular/referrers`,
      warnings,
      "GitHub traffic referrers",
    ),
  );
  const paths = parseTrafficPaths(
    await fetchJson(
      options,
      `${githubBaseUrl}/repos/${options.repository}/traffic/popular/paths`,
      warnings,
      "GitHub traffic paths",
    ),
  );
  return { clones, views, referrers, paths };
}

async function fetchJson(
  options: CollectAdoptionStatsOptions,
  url: string,
  warnings: string[],
  label: string,
): Promise<unknown> {
  try {
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "user-agent": "anchor-adoption-stats",
    };
    if (url.startsWith(githubBaseUrl) && options.githubToken) {
      headers.authorization = `Bearer ${options.githubToken}`;
      headers["x-github-api-version"] = "2022-11-28";
    }
    const response = await options.fetch(url, { headers });
    if (!response.ok) {
      warnings.push(`${label} failed with HTTP ${response.status}.`);
      return null;
    }
    return await response.json();
  } catch (error) {
    warnings.push(`${label} failed: ${error instanceof Error ? error.message : String(error)}.`);
    return null;
  }
}

function parseTrafficSummary(value: unknown): TrafficSummary | null {
  if (!isRecord(value)) return null;
  return {
    count: readNumber(value.count),
    uniques: readNumber(value.uniques),
    periodDays: Array.isArray(value.clones)
      ? value.clones.length
      : Array.isArray(value.views)
        ? value.views.length
        : 0,
  };
}

function parseTrafficReferrers(value: unknown): TrafficReferrer[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    referrer: typeof item.referrer === "string" ? item.referrer : "",
    count: readNumber(item.count),
    uniques: readNumber(item.uniques),
  }));
}

function parseTrafficPaths(value: unknown): TrafficPath[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    path: typeof item.path === "string" ? item.path : "",
    title: typeof item.title === "string" ? item.title : "",
    count: readNumber(item.count),
    uniques: readNumber(item.uniques),
  }));
}

function readNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function hasNumber(value: Record<string, unknown>, key: string): boolean {
  return typeof value[key] === "number";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
