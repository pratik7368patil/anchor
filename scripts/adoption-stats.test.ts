import { describe, expect, it } from "vitest";
import {
  collectAdoptionStats,
  mergeAdoptionHistory,
  type AdoptionStats,
  type AdoptionHistory,
  type FetchLike,
} from "./adoption-stats.js";

const baseOptions = {
  packageName: "@pratik7368patil/anchor",
  repository: "pratik7368patil/anchor",
  statsStartDate: "2026-05-01",
  generatedAt: "2026-06-02T00:00:00.000Z",
};

describe("adoption stats", () => {
  it("normalizes npm and GitHub aggregate stats", async () => {
    const stats = await collectAdoptionStats({
      ...baseOptions,
      fetch: fixtureFetch({
        "downloads/point/last-day": { downloads: 12 },
        "downloads/point/last-week": { downloads: 84 },
        "downloads/point/last-month": { downloads: 300 },
        "downloads/range": { downloads: [{ downloads: 10 }, { downloads: 20 }] },
        "/repos/pratik7368patil/anchor/releases/latest": {
          tag_name: "v0.1.36",
          name: "Anchor 0.1.36",
          published_at: "2026-06-01T00:00:00Z",
          html_url: "https://github.com/pratik7368patil/anchor/releases/tag/v0.1.36",
        },
        "/repos/pratik7368patil/anchor/traffic/clones": {
          count: 5,
          uniques: 3,
          clones: [{}, {}],
        },
        "/repos/pratik7368patil/anchor/traffic/views": {
          count: 9,
          uniques: 7,
          views: [{}, {}, {}],
        },
        "/repos/pratik7368patil/anchor/traffic/popular/referrers": [
          { referrer: "Google", count: 4, uniques: 2 },
        ],
        "/repos/pratik7368patil/anchor/traffic/popular/paths": [
          { path: "/pratik7368patil/anchor", title: "Anchor", count: 6, uniques: 5 },
        ],
        "/repos/pratik7368patil/anchor": {
          stargazers_count: 42,
          forks_count: 8,
          watchers_count: 42,
          subscribers_count: 11,
          open_issues_count: 2,
        },
      }),
      githubToken: "test-token",
      goatCounterCode: "anchor-mcp",
    });

    expect(stats.npm.downloads).toEqual({
      lastDay: 12,
      lastWeek: 84,
      lastMonth: 300,
      sinceStartDate: 30,
    });
    expect(stats.github.stars).toBe(42);
    expect(stats.github.traffic.clones?.uniques).toBe(3);
    expect(stats.github.traffic.views?.periodDays).toBe(3);
    expect(stats.github.latestRelease?.tagName).toBe("v0.1.36");
    expect(stats.site.configured).toBe(true);
    expect(stats.warnings).toEqual([]);
  });

  it("keeps partial stats and records warnings when sources fail", async () => {
    const stats = await collectAdoptionStats({
      ...baseOptions,
      fetch: fixtureFetch({
        "downloads/point/last-day": { downloads: 12 },
        "downloads/point/last-week": { downloads: 84 },
        "downloads/point/last-month": { downloads: 300 },
        "downloads/range": { downloads: [{ downloads: 10 }] },
        "/repos/pratik7368patil/anchor": {
          stargazers_count: 42,
          forks_count: 8,
          watchers_count: 42,
          open_issues_count: 2,
        },
      }),
    });

    expect(stats.npm.downloads.lastWeek).toBe(84);
    expect(stats.github.stars).toBe(42);
    expect(stats.github.traffic.clones).toBeNull();
    expect(stats.warnings).toContain(
      "GitHub traffic skipped because GH_TRAFFIC_TOKEN is not configured.",
    );
  });

  it("merges daily history without duplicate dates and trims old rows", () => {
    const existing: AdoptionHistory = {
      schemaVersion: 1,
      updatedAt: "2026-06-01T00:00:00.000Z",
      days: [
        historyDay("2026-05-31", 10),
        historyDay("2026-06-01", 20),
        historyDay("2026-06-02", 30),
      ],
    };
    const stats: AdoptionStats = {
      schemaVersion: 1,
      generatedAt: "2026-06-02T12:00:00.000Z",
      project: {
        packageName: "@pratik7368patil/anchor",
        repository: "pratik7368patil/anchor",
        statsStartDate: "2026-05-01",
      },
      npm: {
        downloads: {
          lastDay: 99,
          lastWeek: 120,
          lastMonth: 400,
          sinceStartDate: 800,
        },
      },
      github: {
        stars: 50,
        forks: 9,
        watchers: 50,
        subscribers: null,
        openIssues: 1,
        latestRelease: null,
        traffic: {
          clones: { count: 12, uniques: 6, periodDays: 14 },
          views: { count: 20, uniques: 11, periodDays: 14 },
          referrers: [],
          paths: [],
        },
      },
      site: { analyticsProvider: "goatcounter" as const, configured: false },
      notes: [],
      warnings: ["traffic warning"],
    };

    const history = mergeAdoptionHistory(existing, stats, "2026-06-02", 2);

    expect(history.days).toHaveLength(2);
    expect(history.days.map((day) => day.date)).toEqual(["2026-06-01", "2026-06-02"]);
    expect(history.days[1]?.npmDownloads.lastDay).toBe(99);
    expect(history.days[1]?.github.cloneUniques).toBe(6);
    expect(history.days[1]?.warningCount).toBe(1);
  });
});

function fixtureFetch(fixtures: Record<string, unknown>): FetchLike {
  return async (url) => {
    const key = Object.keys(fixtures)
      .sort((left, right) => right.length - left.length)
      .find((candidate) => url.includes(candidate));
    if (!key) {
      return {
        ok: false,
        status: 404,
        json: async () => ({ message: "not found" }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => fixtures[key],
    };
  };
}

function historyDay(date: string, lastDay: number) {
  return {
    date,
    npmDownloads: {
      lastDay,
      lastWeek: lastDay * 7,
      lastMonth: lastDay * 30,
      sinceStartDate: lastDay * 50,
    },
    github: {
      stars: lastDay,
      forks: 1,
      cloneUniques: null,
      viewUniques: null,
      cloneCount: null,
      viewCount: null,
    },
    warningCount: 0,
  };
}
