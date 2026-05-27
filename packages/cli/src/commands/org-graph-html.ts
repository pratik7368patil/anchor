import fs from "node:fs";
import path from "node:path";
import type { AnchorOrgConfig, OrgGraphResult } from "@pratik7368patil/anchor-core";

type GraphNode = {
  id: string;
  label: string;
  group: string;
  edgeCount: number;
};

type GraphEdge = {
  source: string;
  target: string;
  relationship: string;
  confidence: number;
  sourcePath: string;
  targetPath?: string;
};

type GraphData = {
  org: string;
  generatedAt: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  apiConsumers: number;
  apiContracts: number;
};

export type OrgGraphHtmlResult = {
  filePath: string;
  nodes: number;
  edges: number;
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

function buildGraphData(config: AnchorOrgConfig, graph: OrgGraphResult): GraphData {
  const repoGroups = new Map(config.repos.map((repo) => [repo.fullName, repo.group]));
  const edgeCounts = new Map<string, number>();
  for (const edge of graph.edges) {
    edgeCounts.set(edge.sourceRepo, (edgeCounts.get(edge.sourceRepo) ?? 0) + 1);
    edgeCounts.set(edge.targetRepo, (edgeCounts.get(edge.targetRepo) ?? 0) + 1);
  }
  const repos = new Set([
    ...config.repos.filter((repo) => repo.enabled).map((repo) => repo.fullName),
    ...graph.edges.flatMap((edge) => [edge.sourceRepo, edge.targetRepo]),
  ]);
  return {
    org: config.org,
    generatedAt: new Date().toISOString(),
    nodes: [...repos].sort().map((repo) => ({
      id: repo,
      label: repo.split("/")[1] ?? repo,
      group: repoGroups.get(repo) ?? "unknown",
      edgeCount: edgeCounts.get(repo) ?? 0,
    })),
    edges: graph.edges.map((edge) => ({
      source: edge.sourceRepo,
      target: edge.targetRepo,
      relationship: edge.relationship,
      confidence: edge.confidence,
      sourcePath: edge.sourcePath,
      targetPath: edge.targetPath,
    })),
    apiConsumers: graph.apiConsumers.length,
    apiContracts: graph.apiContracts.length,
  };
}

export function renderOrgGraphHtml(config: AnchorOrgConfig, graph: OrgGraphResult): string {
  const data = buildGraphData(config, graph);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Anchor Org Graph - ${htmlEscape(config.org)}</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --text: #17202a;
      --muted: #657180;
      --line: #d7dce2;
      --accent: #1f7a5b;
      --accent-2: #2457a6;
      --warn: #a85d00;
      --shadow: 0 10px 28px rgba(23, 32, 42, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    .app {
      min-height: 100vh;
      display: grid;
      grid-template-columns: minmax(0, 1fr) 360px;
    }
    header {
      grid-column: 1 / -1;
      padding: 18px 22px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      background: var(--panel);
      border-bottom: 1px solid var(--line);
    }
    h1 {
      margin: 0;
      font-size: 20px;
      line-height: 1.2;
      letter-spacing: 0;
    }
    .subtitle {
      margin-top: 4px;
      color: var(--muted);
      font-size: 13px;
    }
    .stats {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .stat {
      background: #eef2f4;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 8px 10px;
      min-width: 92px;
    }
    .stat strong {
      display: block;
      font-size: 18px;
    }
    .stat span {
      color: var(--muted);
      font-size: 12px;
    }
    main {
      min-width: 0;
      padding: 16px;
    }
    .toolbar {
      display: grid;
      grid-template-columns: minmax(180px, 1fr) 190px 150px;
      gap: 10px;
      margin-bottom: 12px;
    }
    input, select, button {
      min-height: 38px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 0 11px;
      font: inherit;
      background: var(--panel);
      color: var(--text);
    }
    button {
      cursor: pointer;
      background: #eef5f2;
      color: var(--accent);
      font-weight: 650;
    }
    .canvas-wrap {
      position: relative;
      height: calc(100vh - 148px);
      min-height: 560px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 12px;
      overflow: hidden;
      box-shadow: var(--shadow);
    }
    svg {
      width: 100%;
      height: 100%;
      display: block;
      cursor: grab;
      background:
        linear-gradient(rgba(23, 32, 42, 0.035) 1px, transparent 1px),
        linear-gradient(90deg, rgba(23, 32, 42, 0.035) 1px, transparent 1px);
      background-size: 28px 28px;
    }
    svg.dragging { cursor: grabbing; }
    .edge {
      stroke: #aeb8c2;
      stroke-width: 1.4;
      opacity: 0.65;
    }
    .edge.active {
      stroke: var(--accent-2);
      stroke-width: 2.8;
      opacity: 1;
    }
    .node circle {
      stroke: #ffffff;
      stroke-width: 2;
      filter: drop-shadow(0 4px 8px rgba(23, 32, 42, 0.16));
    }
    .node text {
      font-size: 12px;
      font-weight: 650;
      paint-order: stroke;
      stroke: #ffffff;
      stroke-width: 4px;
      stroke-linecap: round;
      stroke-linejoin: round;
      pointer-events: none;
    }
    .node.dim, .edge.dim { opacity: 0.12; }
    aside {
      border-left: 1px solid var(--line);
      background: var(--panel);
      padding: 18px;
      overflow: auto;
      max-height: calc(100vh - 75px);
    }
    .panel-title {
      margin: 0 0 8px;
      font-size: 16px;
    }
    .empty {
      color: var(--muted);
      font-size: 14px;
      line-height: 1.5;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 4px 8px;
      margin: 4px 4px 0 0;
      font-size: 12px;
      color: var(--muted);
      background: #f8fafb;
    }
    .edge-list {
      display: grid;
      gap: 10px;
      margin-top: 14px;
    }
    .edge-card {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
      background: #fbfcfd;
    }
    .edge-card strong {
      display: block;
      margin-bottom: 4px;
      font-size: 13px;
    }
    .edge-card div {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
      margin-top: 14px;
    }
    .dot {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      display: inline-block;
    }
    @media (max-width: 900px) {
      .app { grid-template-columns: 1fr; }
      aside {
        border-left: 0;
        border-top: 1px solid var(--line);
        max-height: none;
      }
      .toolbar { grid-template-columns: 1fr; }
      .canvas-wrap { height: 620px; }
      header { align-items: flex-start; flex-direction: column; }
      .stats { justify-content: flex-start; }
    }
  </style>
</head>
<body>
  <div class="app">
    <header>
      <div>
        <h1>Anchor Org Graph</h1>
        <div class="subtitle">${htmlEscape(config.org)} - generated locally from SQLite evidence</div>
      </div>
      <div class="stats">
        <div class="stat"><strong id="node-count">0</strong><span>repos</span></div>
        <div class="stat"><strong id="edge-count">0</strong><span>edges</span></div>
        <div class="stat"><strong id="consumer-count">0</strong><span>API consumers</span></div>
        <div class="stat"><strong id="contract-count">0</strong><span>API contracts</span></div>
      </div>
    </header>
    <main>
      <div class="toolbar">
        <input id="search" type="search" placeholder="Search repo, path, relationship..." />
        <select id="relationship"></select>
        <button id="reset" type="button">Reset view</button>
      </div>
      <div class="canvas-wrap">
        <svg id="graph" role="img" aria-label="Interactive org dependency graph"></svg>
      </div>
    </main>
    <aside>
      <h2 class="panel-title">Graph details</h2>
      <div id="details" class="empty">Click a repo node to see connected relationships. Drag nodes to rearrange the map.</div>
      <div class="legend" id="legend"></div>
    </aside>
  </div>
  <script>
    const graphData = ${safeJson(data)};
    const colors = {
      backend: "#1f7a5b",
      frontend: "#2457a6",
      shared: "#7457a6",
      infra: "#8a5a14",
      docs: "#657180",
      unknown: "#53606d"
    };
    const svg = document.getElementById("graph");
    const search = document.getElementById("search");
    const relationship = document.getElementById("relationship");
    const details = document.getElementById("details");
    const resetButton = document.getElementById("reset");
    const width = () => svg.clientWidth || 900;
    const height = () => svg.clientHeight || 620;
    let selected = null;
    let dragged = null;
    let positions = new Map();

    document.getElementById("node-count").textContent = graphData.nodes.length;
    document.getElementById("edge-count").textContent = graphData.edges.length;
    document.getElementById("consumer-count").textContent = graphData.apiConsumers;
    document.getElementById("contract-count").textContent = graphData.apiContracts;

    function relationshipOptions() {
      const values = [...new Set(graphData.edges.map(edge => edge.relationship))].sort();
      relationship.innerHTML = '<option value="">All relationships</option>' + values.map(value =>
        '<option value="' + escapeHtml(value) + '">' + escapeHtml(value.replaceAll("_", " ")) + '</option>'
      ).join("");
    }

    function escapeHtml(value) {
      return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
    }

    function initializePositions() {
      const cx = width() / 2;
      const cy = height() / 2;
      const radius = Math.max(180, Math.min(width(), height()) * 0.36);
      graphData.nodes.forEach((node, index) => {
        const angle = (Math.PI * 2 * index) / Math.max(1, graphData.nodes.length) - Math.PI / 2;
        positions.set(node.id, {
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius
        });
      });
    }

    function nodeRadius(node) {
      return 15 + Math.min(18, Math.sqrt(node.edgeCount || 1) * 4);
    }

    function visibleData() {
      const term = search.value.trim().toLowerCase();
      const rel = relationship.value;
      const edges = graphData.edges.filter(edge => {
        const haystack = [edge.source, edge.target, edge.relationship, edge.sourcePath, edge.targetPath || ""].join(" ").toLowerCase();
        return (!rel || edge.relationship === rel) && (!term || haystack.includes(term));
      });
      const visibleNodeIds = new Set(edges.flatMap(edge => [edge.source, edge.target]));
      const nodes = graphData.nodes.filter(node => {
        const ownMatch = !term || [node.id, node.label, node.group].join(" ").toLowerCase().includes(term);
        return visibleNodeIds.has(node.id) || (ownMatch && !rel);
      });
      return { nodes, edges };
    }

    function render() {
      const { nodes, edges } = visibleData();
      const nodeIds = new Set(nodes.map(node => node.id));
      const connected = selected
        ? new Set(edges.filter(edge => edge.source === selected || edge.target === selected).flatMap(edge => [edge.source, edge.target]))
        : null;
      svg.innerHTML = "";
      const edgeLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
      const nodeLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
      svg.append(edgeLayer, nodeLayer);
      for (const edge of edges) {
        if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
        const source = positions.get(edge.source);
        const target = positions.get(edge.target);
        if (!source || !target) continue;
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", source.x);
        line.setAttribute("y1", source.y);
        line.setAttribute("x2", target.x);
        line.setAttribute("y2", target.y);
        line.setAttribute("class", "edge" + (selected && (edge.source === selected || edge.target === selected) ? " active" : selected ? " dim" : ""));
        line.dataset.source = edge.source;
        line.dataset.target = edge.target;
        edgeLayer.append(line);
      }
      for (const node of nodes) {
        const pos = positions.get(node.id);
        if (!pos) continue;
        const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
        const dim = connected && !connected.has(node.id) && selected !== node.id;
        group.setAttribute("class", "node" + (dim ? " dim" : ""));
        group.setAttribute("transform", "translate(" + pos.x + " " + pos.y + ")");
        group.dataset.id = node.id;
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("r", nodeRadius(node));
        circle.setAttribute("fill", colors[node.group] || colors.unknown);
        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.setAttribute("x", nodeRadius(node) + 8);
        label.setAttribute("y", 4);
        label.textContent = node.label;
        group.append(circle, label);
        group.addEventListener("pointerdown", event => {
          dragged = node.id;
          selected = node.id;
          svg.classList.add("dragging");
          group.setPointerCapture(event.pointerId);
          showDetails(node.id);
          render();
        });
        group.addEventListener("pointermove", event => {
          if (dragged !== node.id) return;
          const rect = svg.getBoundingClientRect();
          positions.set(node.id, { x: event.clientX - rect.left, y: event.clientY - rect.top });
          render();
        });
        group.addEventListener("pointerup", () => {
          dragged = null;
          svg.classList.remove("dragging");
        });
        nodeLayer.append(group);
      }
      if (!selected) showOverview(nodes, edges);
    }

    function showOverview(nodes, edges) {
      details.className = "";
      details.innerHTML =
        '<p class="empty">Showing ' + nodes.length + ' repo(s) and ' + edges.length + ' relationship(s). Click a repo to inspect connected edges.</p>' +
        '<div class="edge-list">' +
        edges.slice(0, 10).map(edgeCard).join("") +
        '</div>';
    }

    function showDetails(nodeId) {
      const node = graphData.nodes.find(item => item.id === nodeId);
      const edges = graphData.edges.filter(edge => edge.source === nodeId || edge.target === nodeId);
      details.className = "";
      details.innerHTML =
        '<h3>' + escapeHtml(nodeId) + '</h3>' +
        '<span class="pill">' + escapeHtml(node?.group || "unknown") + '</span>' +
        '<span class="pill">' + edges.length + ' relationship(s)</span>' +
        '<div class="edge-list">' + edges.map(edgeCard).join("") + '</div>';
    }

    function edgeCard(edge) {
      return '<div class="edge-card">' +
        '<strong>' + escapeHtml(edge.source) + ' -> ' + escapeHtml(edge.target) + '</strong>' +
        '<div>' + escapeHtml(edge.relationship.replaceAll("_", " ")) + ' - confidence ' + Math.round(edge.confidence * 100) + '%</div>' +
        '<div>' + escapeHtml(edge.sourcePath) + (edge.targetPath ? ' -> ' + escapeHtml(edge.targetPath) : '') + '</div>' +
      '</div>';
    }

    function renderLegend() {
      const legend = document.getElementById("legend");
      const groups = [...new Set(graphData.nodes.map(node => node.group))].sort();
      legend.innerHTML = groups.map(group =>
        '<span class="pill"><span class="dot" style="background:' + (colors[group] || colors.unknown) + '"></span>' + escapeHtml(group) + '</span>'
      ).join("");
    }

    search.addEventListener("input", () => { selected = null; render(); });
    relationship.addEventListener("change", () => { selected = null; render(); });
    resetButton.addEventListener("click", () => {
      selected = null;
      search.value = "";
      relationship.value = "";
      initializePositions();
      render();
    });
    window.addEventListener("resize", () => {
      initializePositions();
      render();
    });

    relationshipOptions();
    renderLegend();
    initializePositions();
    render();
  </script>
</body>
</html>
`;
}

export function writeOrgGraphHtml(
  config: AnchorOrgConfig,
  graph: OrgGraphResult,
  filePath: string,
): OrgGraphHtmlResult {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, renderOrgGraphHtml(config, graph));
  return {
    filePath,
    nodes: new Set(graph.edges.flatMap((edge) => [edge.sourceRepo, edge.targetRepo])).size,
    edges: graph.edges.length,
  };
}
