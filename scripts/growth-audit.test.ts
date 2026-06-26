import { describe, expect, it } from "vitest";
import {
  findStalePhrases,
  missingTopics,
  requiredTopics,
  runLiveAudit,
  type AuditCheck,
} from "./growth-audit.js";

describe("growth audit", () => {
  it("detects stale public positioning phrases", () => {
    const staleHeadline = ["Repo Memory for", "Cursor"].join(" ");
    expect(findStalePhrases(`Old card says ${staleHeadline}`)).toEqual([staleHeadline]);
    expect(findStalePhrases("Repo + Org Memory for AI Coding Agents")).toEqual([]);
  });

  it("reports missing GitHub topics", () => {
    expect(missingTopics(requiredTopics)).toEqual([]);
    expect(missingTopics(["mcp", "repo-memory"])).toContain("org-memory");
  });

  it("validates live public metadata from fixture responses", async () => {
    const checks = await runLiveAudit(
      fixtureFetch({
        "anchor-mcp.netlify.app/": `<html>
          <title>Anchor - Local repo and org memory for AI coding agents</title>
          <meta property="og:image" content="https://anchor-mcp.netlify.app/social-preview-repo-org.png" />
        </html>`,
        "registry.npmjs.org": {
          description:
            "Local-first MCP server and CLI for AI coding agents, repo memory, org memory, GitHub PR history, codebase indexing, regressions, and cross-repo impact.",
          "dist-tags": { latest: "0.1.40" },
        },
        "api.github.com": {
          description:
            "Local-first MCP server that gives AI coding agents repo and org memory from GitHub PR history, code, tests, regressions, architecture, and cross-repo impact.",
          topics: requiredTopics,
        },
      }),
    );

    expectFailedChecks(checks, []);
  });
});

function expectFailedChecks(checks: AuditCheck[], expectedNames: string[]): void {
  expect(checks.filter((check) => !check.ok).map((check) => check.name)).toEqual(expectedNames);
}

function fixtureFetch(fixtures: Record<string, unknown>) {
  return async (url: string) => {
    const key = Object.keys(fixtures).find((item) => url.includes(item));
    const value = key ? fixtures[key] : undefined;
    return {
      ok: value !== undefined,
      status: value === undefined ? 404 : 200,
      text: async () => (typeof value === "string" ? value : JSON.stringify(value)),
      json: async () => value,
    };
  };
}
