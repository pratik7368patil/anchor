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
      edges: [
        {
          org: "acme",
          sourceRepo: "acme/frontend</script><script>alert(1)</script>",
          sourcePath: "src/api/client.ts",
          targetRepo: "acme/backend",
          targetPath: "src/api/access.ts",
          relationship: "api_consumer",
          evidence: [],
          confidence: 0.86,
        },
      ],
      apiConsumers: [
        {
          org: "acme",
          providerRepo: "acme/backend",
          providerPath: "src/api/access.ts",
          consumerRepo: "acme/frontend</script><script>alert(1)</script>",
          consumerPath: "src/api/client.ts",
          contract: "/api/access",
          evidence: [],
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
      durationMs: 12,
    };

    const html = renderOrgGraphHtml(config, graph);

    expect(html).toContain("Anchor Org Graph");
    expect(html).toContain("graphData");
    expect(html).toContain("\\u003c/script\\u003e");
    expect(html).not.toContain("</script><script>alert(1)</script>");
  });
});
