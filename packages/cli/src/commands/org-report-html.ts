import fs from "node:fs";
import path from "node:path";

export type OrgHtmlReportKind = "impact" | "ci" | "map";

export type OrgHtmlReportInput = {
  kind: OrgHtmlReportKind;
  org: string;
  markdown: string;
  metadata: unknown;
};

export type OrgHtmlReportResult = {
  filePath: string;
  title: string;
};

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
}

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function titleFor(kind: OrgHtmlReportKind): string {
  if (kind === "impact") return "Anchor Org Impact Report";
  if (kind === "ci") return "Anchor Org CI Report";
  return "Anchor Org Map Report";
}

export function renderOrgReportHtml(input: OrgHtmlReportInput): string {
  const payload = {
    kind: input.kind,
    org: input.org,
    markdown: input.markdown,
    metadata: input.metadata,
    generatedAt: new Date().toISOString(),
  };
  const title = titleFor(input.kind);
  const subtitle =
    input.kind === "impact"
      ? "Cross-repo risk summary for the current diff"
      : input.kind === "ci"
        ? "Coverage and reliability gate summary"
        : "Cross-repo architecture and dependency map";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${htmlEscape(title)} - ${htmlEscape(input.org)}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f4f7fb;
      --panel: #ffffff;
      --line: #d8dde4;
      --text: #17222d;
      --muted: #627181;
      --ok: #1f7a5b;
      --warn: #8a5a14;
      --danger: #8f2a2a;
      --accent: #2457a6;
      --shadow: 0 12px 32px rgba(13, 24, 36, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
      line-height: 1.45;
    }
    .page {
      width: min(1280px, 96vw);
      margin: 16px auto 28px;
      display: grid;
      gap: 12px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 10px;
      box-shadow: var(--shadow);
      padding: 14px;
    }
    .header-top {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: flex-start;
      flex-wrap: wrap;
    }
    h1 {
      margin: 0 0 4px;
      font-size: 21px;
      letter-spacing: 0;
    }
    .sub {
      color: var(--muted);
      font-size: 13px;
    }
    .meta {
      color: var(--muted);
      font-size: 12px;
      text-align: right;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 10px;
    }
    .stat {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
      background: #f8fbff;
    }
    .stat strong {
      display: block;
      font-size: 19px;
      line-height: 1.2;
    }
    .stat span {
      color: var(--muted);
      font-size: 12px;
    }
    .stat.ok strong { color: var(--ok); }
    .stat.warn strong { color: var(--warn); }
    .stat.danger strong { color: var(--danger); }
    .toolbar {
      display: grid;
      grid-template-columns: minmax(200px, 1fr) 220px auto;
      gap: 8px;
      align-items: center;
    }
    input, select {
      min-height: 36px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 0 10px;
      font: inherit;
      background: #fff;
      color: var(--text);
    }
    label {
      color: var(--muted);
      font-size: 13px;
      display: inline-flex;
      gap: 8px;
      align-items: center;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .section-title {
      margin: 0 0 8px;
      font-size: 16px;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .chip {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 4px 8px;
      font-size: 12px;
      color: var(--muted);
      background: #f8fafc;
    }
    .chip.risk { border-color: #f0c5c5; color: var(--danger); background: #fff7f7; }
    .chip.warn { border-color: #e7d6b9; color: var(--warn); background: #fffaf1; }
    .chip.ok { border-color: #bfe3d6; color: var(--ok); background: #f3fcf8; }
    .table-wrap {
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      max-height: 430px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    th, td {
      text-align: left;
      border-bottom: 1px solid #edf1f6;
      padding: 8px 9px;
      vertical-align: top;
    }
    th {
      position: sticky;
      top: 0;
      background: #f6f9fe;
      color: #2d445f;
      z-index: 1;
    }
    tr:last-child td { border-bottom: 0; }
    .mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      background: #f8fafd;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
    }
    .muted {
      color: var(--muted);
      font-size: 13px;
    }
    .hidden { display: none !important; }
    @media (max-width: 980px) {
      .grid { grid-template-columns: 1fr; }
      .toolbar { grid-template-columns: 1fr; }
      .meta { text-align: left; }
    }
  </style>
</head>
<body>
  <main class="page">
    <section class="card">
      <div class="header-top">
        <div>
          <h1>${htmlEscape(title)}</h1>
          <div class="sub">${htmlEscape(input.org)} • ${htmlEscape(subtitle)}</div>
        </div>
        <div class="meta" id="meta"></div>
      </div>
    </section>
    <section class="card">
      <div class="stats" id="stats"></div>
    </section>
    <section class="card">
      <div class="toolbar">
        <input id="search" type="search" placeholder="Filter by repo, path, summary, relationship..." />
        <select id="severity"></select>
        <label><input id="only-critical" type="checkbox" /> Only high/blocker</label>
      </div>
    </section>
    <section class="grid">
      <article class="card">
        <h2 class="section-title">Highlights</h2>
        <div class="chips" id="highlights"></div>
      </article>
      <article class="card">
        <h2 class="section-title">Coverage / Gate Notes</h2>
        <div class="chips" id="notes"></div>
      </article>
    </section>
    <section class="card">
      <h2 class="section-title">Details</h2>
      <div class="table-wrap"><table id="details-table"></table></div>
    </section>
    <section class="grid">
      <article class="card">
        <h2 class="section-title">Related Entities</h2>
        <div class="table-wrap"><table id="related-table"></table></div>
      </article>
      <article class="card">
        <h2 class="section-title">Markdown Output</h2>
        <pre class="mono" id="markdown"></pre>
      </article>
    </section>
  </main>
  <script>
    const payload = ${safeJson(payload)};
    const meta = document.getElementById("meta");
    const stats = document.getElementById("stats");
    const highlights = document.getElementById("highlights");
    const notes = document.getElementById("notes");
    const detailsTable = document.getElementById("details-table");
    const relatedTable = document.getElementById("related-table");
    const markdown = document.getElementById("markdown");
    const search = document.getElementById("search");
    const severity = document.getElementById("severity");
    const onlyCritical = document.getElementById("only-critical");

    function esc(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
    }

    function toneClass(tone) {
      if (tone === "danger") return "danger";
      if (tone === "warn") return "warn";
      if (tone === "ok") return "ok";
      return "";
    }

    function chip(text, tone) {
      return '<span class="chip ' + toneClass(tone) + '">' + esc(text) + "</span>";
    }

    function bySeverityOrder(level) {
      if (level === "blocker") return 4;
      if (level === "high") return 3;
      if (level === "medium") return 2;
      if (level === "low") return 1;
      return 0;
    }

    function scoreTone(score) {
      const n = Number(score) || 0;
      if (n >= 80) return "ok";
      if (n >= 60) return "warn";
      return "danger";
    }

    function confidenceTone(value) {
      const n = Number(value) || 0;
      if (n >= 0.78) return "ok";
      if (n >= 0.55) return "warn";
      return "danger";
    }

    function buildSeverityOptions(values) {
      const unique = [...new Set(values.filter(Boolean))].sort((a, b) => bySeverityOrder(b) - bySeverityOrder(a));
      severity.innerHTML =
        '<option value="">All severities</option>' +
        unique.map((value) => '<option value="' + esc(value) + '">' + esc(value) + "</option>").join("");
      severity.parentElement.classList.toggle("hidden", unique.length === 0);
      onlyCritical.parentElement.classList.toggle("hidden", unique.length === 0);
    }

    function renderStats(cards) {
      stats.innerHTML = cards
        .map((card) => {
          return (
            '<div class="stat ' +
            toneClass(card.tone) +
            '"><strong>' +
            esc(card.value) +
            "</strong><span>" +
            esc(card.label) +
            "</span></div>"
          );
        })
        .join("");
    }

    function renderChips(container, values, fallback) {
      if (!values || values.length === 0) {
        container.innerHTML = chip(fallback ?? "No items", "");
        return;
      }
      container.innerHTML = values.join("");
    }

    function renderTable(table, headers, rows) {
      const head = "<thead><tr>" + headers.map((header) => "<th>" + esc(header) + "</th>").join("") + "</tr></thead>";
      const bodyRows = rows.length
        ? rows.map((row) => "<tr>" + row.map((cell) => "<td>" + cell + "</td>").join("") + "</tr>").join("")
        : '<tr><td class="muted" colspan="' + headers.length + '">No rows</td></tr>';
      table.innerHTML = head + "<tbody>" + bodyRows + "</tbody>";
    }

    function renderMap() {
      const data = payload.metadata || {};
      const nodes = Array.isArray(data.nodes) ? data.nodes : [];
      const edges = Array.isArray(data.edges) ? data.edges : [];
      const relationships = [...new Set(edges.map((edge) => edge.relationship).filter(Boolean))];
      buildSeverityOptions([]);

      renderStats([
        { label: "nodes", value: String(nodes.length) },
        { label: "edges", value: String(edges.length) },
        { label: "relationships", value: String(relationships.length) },
        { label: "format", value: String(data.format || "mermaid"), tone: "ok" },
      ]);

      renderChips(
        highlights,
        relationships.slice(0, 20).map((item) => chip("relationship: " + item, "ok")),
        "No relationships found",
      );
      renderChips(
        notes,
        [
          chip("Generated from local org index", "ok"),
          chip("Mermaid preview included in markdown", "warn"),
        ],
        "No notes",
      );

      const term = (search.value || "").trim().toLowerCase();
      const filteredEdges = edges.filter((edge) => {
        if (!term) return true;
        return (
          String(edge.source || "").toLowerCase().includes(term) ||
          String(edge.target || "").toLowerCase().includes(term) ||
          String(edge.relationship || "").toLowerCase().includes(term) ||
          String(edge.sourcePath || "").toLowerCase().includes(term) ||
          String(edge.targetPath || "").toLowerCase().includes(term)
        );
      });

      renderTable(
        detailsTable,
        ["Source", "Target", "Relationship", "Confidence", "Source path", "Target path"],
        filteredEdges.slice(0, 1200).map((edge) => [
          esc(edge.source || ""),
          esc(edge.target || ""),
          esc(edge.relationship || ""),
          '<span class="chip ' + toneClass(confidenceTone(edge.confidence)) + '">' + esc((Number(edge.confidence) || 0).toFixed(2)) + "</span>",
          esc(edge.sourcePath || ""),
          esc(edge.targetPath || ""),
        ]),
      );

      renderTable(
        relatedTable,
        ["Repo", "Role", "Edge count"],
        nodes
          .map((node) => {
            const count = edges.filter((edge) => edge.source === node.id || edge.target === node.id).length;
            return [esc(node.label || node.id || ""), esc(node.id || ""), esc(count)];
          })
          .sort((a, b) => Number(b[2]) - Number(a[2]))
          .slice(0, 500),
      );
    }

    function renderImpactLike(kind) {
      const root = payload.metadata || {};
      const data = kind === "ci" ? (root.impact || {}) : root;
      const status = kind === "ci" ? (root.status || {}) : null;

      const anomalies = Array.isArray(data.anomalies) ? data.anomalies : [];
      const consumers = Array.isArray(data.apiConsumers) ? data.apiConsumers : [];
      const edges = Array.isArray(data.crossRepoEdges) ? data.crossRepoEdges : [];
      const changedFiles = Array.isArray(data.changedFiles) ? data.changedFiles : [];
      const warnings = Array.isArray(data.coverageWarnings) ? data.coverageWarnings : [];
      const ok = Boolean(data.ok);
      const severityValues = anomalies.map((item) => item.severity);
      buildSeverityOptions(severityValues);

      const blockers = anomalies.filter((item) => item.severity === "blocker").length;
      const high = anomalies.filter((item) => item.severity === "high").length;
      const moderate = anomalies.filter((item) => item.severity === "medium").length;
      const low = anomalies.filter((item) => item.severity === "low").length;
      const uniqueAffectedRepos = [...new Set(anomalies.flatMap((item) => item.affectedRepos || []))];

      const cards = [
        { label: "anomalies", value: String(anomalies.length), tone: anomalies.length > 0 ? "warn" : "ok" },
        { label: "blocker + high", value: String(blockers + high), tone: blockers + high > 0 ? "danger" : "ok" },
        { label: "API consumers", value: String(consumers.length), tone: consumers.length > 0 ? "warn" : "ok" },
        { label: "cross-repo edges", value: String(edges.length) },
        { label: "changed files", value: String(changedFiles.length) },
        { label: "gate", value: ok ? "pass" : "fail", tone: ok ? "ok" : "danger" },
      ];
      if (kind === "ci" && status) {
        cards.push({
          label: "coverage",
          value: String(status.coverageScore || 0) + "%",
          tone: scoreTone(status.coverageScore),
        });
      }
      renderStats(cards.slice(0, 8));

      renderChips(
        highlights,
        [
          chip("Blocker: " + blockers, blockers > 0 ? "danger" : "ok"),
          chip("High: " + high, high > 0 ? "danger" : "ok"),
          chip("Medium: " + moderate, moderate > 0 ? "warn" : "ok"),
          chip("Low: " + low, low > 0 ? "warn" : "ok"),
          chip("Affected repos: " + uniqueAffectedRepos.length, uniqueAffectedRepos.length > 0 ? "warn" : "ok"),
        ],
        "No anomaly highlights",
      );

      const noteChips = [];
      if (status && Array.isArray(status.coverageReasons)) {
        for (const reason of status.coverageReasons.slice(0, 8)) {
          noteChips.push(chip(reason, "warn"));
        }
      }
      for (const warning of warnings.slice(0, 8)) {
        noteChips.push(chip(warning, "risk"));
      }
      if (noteChips.length === 0) noteChips.push(chip("No extra warnings", "ok"));
      renderChips(notes, noteChips);

      const term = (search.value || "").trim().toLowerCase();
      const selectedSeverity = severity.value;
      const criticalOnly = onlyCritical.checked;
      const filteredAnomalies = anomalies
        .filter((item) => {
          if (criticalOnly && !["blocker", "high"].includes(String(item.severity || ""))) return false;
          if (selectedSeverity && String(item.severity || "") !== selectedSeverity) return false;
          if (!term) return true;
          const haystack = [
            item.category,
            item.summary,
            ...(item.affectedRepos || []),
            ...(item.affectedFiles || []),
            ...(item.recommendedChecks || []),
          ]
            .join(" ")
            .toLowerCase();
          return haystack.includes(term);
        })
        .sort((a, b) => bySeverityOrder(String(b.severity || "")) - bySeverityOrder(String(a.severity || "")));

      renderTable(
        detailsTable,
        ["Severity", "Category", "Summary", "Repos", "Files", "Checks"],
        filteredAnomalies.slice(0, 1200).map((item) => [
          '<span class="chip ' + toneClass(item.severity === "blocker" || item.severity === "high" ? "danger" : item.severity === "medium" ? "warn" : "ok") + '">' + esc(item.severity || "unknown") + "</span>",
          esc(item.category || ""),
          esc(item.summary || ""),
          esc((item.affectedRepos || []).join(", ")),
          esc((item.affectedFiles || []).join(", ")),
          esc((item.recommendedChecks || []).join(" | ")),
        ]),
      );

      const filteredConsumers = consumers.filter((item) => {
        if (!term) return true;
        return [item.providerRepo, item.consumerRepo, item.consumerPath, item.providerPath, item.contract]
          .join(" ")
          .toLowerCase()
          .includes(term);
      });

      renderTable(
        relatedTable,
        ["Provider", "Consumer", "Contract", "Confidence", "Evidence"],
        filteredConsumers.slice(0, 1200).map((item) => [
          esc(item.providerRepo || ""),
          esc((item.consumerRepo || "") + ":" + (item.consumerPath || "")),
          esc(item.contract || ""),
          '<span class="chip ' + toneClass(confidenceTone(item.confidence)) + '">' + esc((Number(item.confidence) || 0).toFixed(2)) + "</span>",
          esc(String(item.evidenceCount ?? (Array.isArray(item.evidence) ? item.evidence.length : 0))),
        ]),
      );
    }

    function render() {
      meta.textContent =
        "Generated " +
        new Date(payload.generatedAt).toLocaleString() +
        " • org " +
        (payload.org || "unknown");
      markdown.textContent = String(payload.markdown || "");

      if (payload.kind === "map") {
        renderMap();
      } else if (payload.kind === "ci") {
        renderImpactLike("ci");
      } else {
        renderImpactLike("impact");
      }
    }

    search.addEventListener("input", render);
    severity.addEventListener("change", render);
    onlyCritical.addEventListener("change", render);
    render();
  </script>
</body>
</html>`;
}

export function writeOrgReportHtml(
  input: OrgHtmlReportInput,
  outputPath: string,
): OrgHtmlReportResult {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, renderOrgReportHtml(input), "utf8");
  return {
    filePath: outputPath,
    title: titleFor(input.kind),
  };
}
