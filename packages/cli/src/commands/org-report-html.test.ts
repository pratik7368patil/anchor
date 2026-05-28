import { describe, expect, it } from "vitest";
import { renderOrgReportHtml } from "./org-report-html.js";

describe("org report HTML", () => {
  it("renders a safe, standalone impact report page", () => {
    const html = renderOrgReportHtml({
      kind: "impact",
      org: "acme<script>alert(1)</script>",
      markdown: "# Impact\n\n- test",
      metadata: {
        org: "acme",
        ok: false,
        changedFiles: ["src/api/client.ts"],
        anomalies: [
          {
            severity: "high",
            category: "api_contract_change",
            summary: "Bad </script><script>alert('xss')</script>",
            affectedRepos: ["acme/backend"],
            affectedFiles: ["src/api/client.ts"],
            recommendedChecks: ["Run tests"],
          },
        ],
        apiConsumers: [],
        crossRepoEdges: [],
        coverageWarnings: [],
      },
    });

    expect(html).toContain("Anchor Org Impact Report");
    expect(html).toContain("payload");
    expect(html).toContain("details-table");
    expect(html).toContain("\\u003c/script\\u003e");
    expect(html).not.toContain("</script><script>alert('xss')</script>");
  });
});
