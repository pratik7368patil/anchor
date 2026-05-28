import { describe, expect, it } from "vitest";
import type { AnchorOrgConfig, OrgGraphResult } from "@pratik7368patil/anchor-core";
import { renderOrgGraphHtml } from "./org-graph-html.js";

describe("org graph HTML", () => {
  it("renders a self-contained sanitized interactive graph page", () => {
    const config: AnchorOrgConfig = {
      version: 1,
      org: "acme",
      repos: [
        {
          fullName: "acme/backend",
          alias: "backend",
          group: "backend",
          cloneUrl: "https://github.com/acme/backend.git",
          defaultBranch: "main",
          enabled: true,
        },
        {
          fullName: "acme/frontend</script><script>alert(1)</script>",
          alias: "frontend",
          group: "frontend",
          cloneUrl: "https://github.com/acme/frontend.git",
          defaultBranch: "main",
          enabled: true,
        },
      ],
    };
    const graph: OrgGraphResult = {
      edges: [],
      repoEdges: [
        {
          org: "acme",
          sourceRepo: "acme/frontend</script><script>alert(1)</script>",
          sourcePath: "*",
          targetRepo: "acme/backend",
          relationship: "api_consumer",
          layer: "repo",
          evidence: [],
          matchReasons: ["matched_contract_token"],
          evidenceCount: 2,
          weak: false,
          confidence: 0.86,
        },
      ],
      fileEdges: [
        {
          org: "acme",
          sourceRepo: "acme/frontend</script><script>alert(1)</script>",
          sourcePath: "src/api/client.ts",
          targetRepo: "acme/backend",
          targetPath: "src/api/access.ts",
          relationship: "api_consumer",
          layer: "file",
          evidence: [],
          matchReasons: ["matched_contract_token"],
          evidenceCount: 2,
          weak: false,
          confidence: 0.86,
        },
      ],
      hiddenFileEdges: [],
      hiddenRepoEdges: [],
      apiConsumers: [
        {
          org: "acme",
          providerRepo: "acme/backend",
          providerPath: "src/api/access.ts",
          consumerRepo: "acme/frontend</script><script>alert(1)</script>",
          consumerPath: "src/api/client.ts",
          contract: "/api/access",
          evidence: [],
          matchReasons: ["matched_contract_token"],
          evidenceCount: 2,
          weak: false,
          confidence: 0.86,
        },
      ],
      apiContracts: [
        {
          repo: "acme/backend",
          filePath: "src/api/access.ts",
          contract: "/api/access",
          evidence: [],
          confidence: 0.74,
        },
      ],
      quality: {
        edgeConfidenceDistribution: { strong: 1, moderate: 0, weak: 0 },
        weakEdgesFiltered: 0,
        minVisibleConfidence: 0.7,
        minVisibleEvidence: 2,
      },
      durationMs: 12,
    };

    const html = renderOrgGraphHtml(config, graph);

    expect(html).toContain("Anchor Org Graph");
    expect(html).toContain("graphData");
    expect(html).toContain("edge-canvas");
    expect(html).toContain("requestAnimationFrame");
    expect(html).toContain("\\u003c/script\\u003e");
    expect(html).not.toContain("</script><script>alert(1)</script>");
  });
});
