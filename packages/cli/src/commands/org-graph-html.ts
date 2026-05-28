import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AnchorOrgConfig, OrgGraphResult } from "@pratik7368patil/anchor-core";

type GraphNode = {
  id: string;
  label: string;
  group: string;
  edgeCount: number;
};

type GraphFileEdge = {
  sourceRepo: string;
  targetRepo: string;
  sourcePath: string;
  targetPath?: string;
  relationship: string;
  confidence: number;
  evidenceCount: number;
  matchReasons: string[];
  hidden: boolean;
};

type GraphRepoEdge = {
  id: string;
  source: string;
  target: string;
  relationship: string;
  confidence: number;
  evidenceCount: number;
  matchReasons: string[];
  hidden: boolean;
  fileEdgeCount: number;
  examples: GraphFileEdge[];
};

type GraphData = {
  org: string;
  generatedAt: string;
  layoutHash: string;
  nodes: GraphNode[];
  repoEdges: GraphRepoEdge[];
  fileEdges: GraphFileEdge[];
  hiddenRepoEdges: number;
  hiddenFileEdges: number;
  apiConsumers: number;
  apiContracts: number;
  quality: OrgGraphResult["quality"];
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

function makeLayoutHash(config: AnchorOrgConfig, graph: OrgGraphResult): string {
  const key = JSON.stringify({
    org: config.org,
    repos: config.repos
      .filter((repo) => repo.enabled)
      .map((repo) => repo.fullName)
      .sort(),
    visibleRepoEdges: graph.repoEdges.map((edge) => ({
      source: edge.sourceRepo,
      target: edge.targetRepo,
      relationship: edge.relationship,
      confidence: edge.confidence,
      evidenceCount: edge.evidenceCount,
    })),
    hiddenRepoEdges: graph.hiddenRepoEdges.map((edge) => ({
      source: edge.sourceRepo,
      target: edge.targetRepo,
      relationship: edge.relationship,
      confidence: edge.confidence,
      evidenceCount: edge.evidenceCount,
    })),
  });
  return crypto.createHash("sha1").update(key).digest("hex").slice(0, 14);
}

function buildGraphData(config: AnchorOrgConfig, graph: OrgGraphResult): GraphData {
  const repoGroups = new Map(config.repos.map((repo) => [repo.fullName, repo.group]));
  const allFileEdges = graph.fileEdges
    .map((edge) => ({ ...edge, hidden: false }))
    .concat(graph.hiddenFileEdges.map((edge) => ({ ...edge, hidden: true })))
    .map((edge) => ({
      sourceRepo: edge.sourceRepo,
      targetRepo: edge.targetRepo,
      sourcePath: edge.sourcePath,
      targetPath: edge.targetPath,
      relationship: edge.relationship,
      confidence: edge.confidence,
      evidenceCount: edge.evidenceCount,
      matchReasons: edge.matchReasons,
      hidden: edge.hidden,
    }));
  const fileEdgeMap = new Map<string, GraphFileEdge[]>();
  for (const edge of allFileEdges) {
    const key = `${edge.sourceRepo}\0${edge.targetRepo}\0${edge.relationship}`;
    const bucket = fileEdgeMap.get(key) ?? [];
    bucket.push(edge);
    fileEdgeMap.set(key, bucket);
  }
  const repoEdgesRaw = graph.repoEdges
    .map((edge) => ({ ...edge, hidden: false }))
    .concat(graph.hiddenRepoEdges.map((edge) => ({ ...edge, hidden: true })));
  const repoEdges: GraphRepoEdge[] = repoEdgesRaw
    .map((edge, index) => {
      const key = `${edge.sourceRepo}\0${edge.targetRepo}\0${edge.relationship}`;
      const examples = (fileEdgeMap.get(key) ?? [])
        .slice()
        .sort((a, b) => b.confidence - a.confidence || b.evidenceCount - a.evidenceCount)
        .slice(0, 25);
      return {
        id: `e${index}_${edge.sourceRepo}_${edge.targetRepo}_${edge.relationship}`.replace(
          /[^A-Za-z0-9_]/g,
          "_",
        ),
        source: edge.sourceRepo,
        target: edge.targetRepo,
        relationship: edge.relationship,
        confidence: edge.confidence,
        evidenceCount: edge.evidenceCount,
        matchReasons: edge.matchReasons,
        hidden: edge.hidden,
        fileEdgeCount: (fileEdgeMap.get(key) ?? []).length,
        examples,
      };
    })
    .sort((a, b) => Number(a.hidden) - Number(b.hidden) || b.confidence - a.confidence);
  const edgeCounts = new Map<string, number>();
  for (const edge of repoEdges) {
    edgeCounts.set(edge.source, (edgeCounts.get(edge.source) ?? 0) + 1);
    edgeCounts.set(edge.target, (edgeCounts.get(edge.target) ?? 0) + 1);
  }
  const repos = new Set([
    ...config.repos.filter((repo) => repo.enabled).map((repo) => repo.fullName),
    ...repoEdges.flatMap((edge) => [edge.source, edge.target]),
  ]);
  const nodes: GraphNode[] = [...repos]
    .sort()
    .map((repo) => ({
      id: repo,
      label: repo.split("/")[1] ?? repo,
      group: repoGroups.get(repo) ?? "unknown",
      edgeCount: edgeCounts.get(repo) ?? 0,
    }));

  return {
    org: config.org,
    generatedAt: new Date().toISOString(),
    layoutHash: makeLayoutHash(config, graph),
    nodes,
    repoEdges,
    fileEdges: allFileEdges,
    hiddenRepoEdges: graph.hiddenRepoEdges.length,
    hiddenFileEdges: graph.hiddenFileEdges.length,
    apiConsumers: graph.apiConsumers.length,
    apiContracts: graph.apiContracts.length,
    quality: graph.quality,
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
      --bg: #f5f7fb;
      --panel: #ffffff;
      --line: #d7dce2;
      --text: #15212b;
      --muted: #66727f;
      --accent: #206356;
      --accent2: #285da8;
      --warn: #9a6a00;
      --danger: #8c2b2b;
      --shadow: 0 10px 30px rgba(14, 22, 30, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
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
      padding: 16px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      background: var(--panel);
      border-bottom: 1px solid var(--line);
    }
    h1 {
      margin: 0;
      font-size: 20px;
      letter-spacing: 0;
    }
    .subtitle {
      margin-top: 4px;
      color: var(--muted);
      font-size: 13px;
    }
    .stats {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
    }
    .stat {
      border: 1px solid var(--line);
      background: #eff3f8;
      border-radius: 8px;
      padding: 8px 10px;
      min-width: 96px;
    }
    .stat strong {
      display: block;
      font-size: 16px;
      line-height: 1.2;
    }
    .stat span {
      font-size: 12px;
      color: var(--muted);
    }
    main {
      min-width: 0;
      padding: 16px;
      display: grid;
      grid-template-rows: auto 1fr;
      gap: 12px;
    }
    .toolbar {
      display: grid;
      grid-template-columns: minmax(200px, 1fr) 220px 160px 160px 120px;
      gap: 10px;
      align-items: center;
    }
    input, select, button {
      min-height: 36px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 0 10px;
      font: inherit;
      background: var(--panel);
      color: var(--text);
    }
    button {
      cursor: pointer;
      background: #edf5ef;
      color: var(--accent);
      font-weight: 650;
    }
    label.toggle {
      display: inline-flex;
      gap: 8px;
      align-items: center;
      font-size: 13px;
      color: var(--muted);
      white-space: nowrap;
    }
    label.toggle input { min-height: auto; }
    .graph-wrap {
      position: relative;
      border: 1px solid var(--line);
      border-radius: 12px;
      overflow: hidden;
      background: var(--panel);
      box-shadow: var(--shadow);
      min-height: 620px;
      height: calc(100vh - 166px);
    }
    canvas, svg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      display: block;
    }
    canvas {
      background:
        linear-gradient(rgba(23, 32, 42, 0.03) 1px, transparent 1px),
        linear-gradient(90deg, rgba(23, 32, 42, 0.03) 1px, transparent 1px);
      background-size: 28px 28px;
      cursor: grab;
    }
    canvas.dragging { cursor: grabbing; }
    .node circle {
      stroke: #ffffff;
      stroke-width: 2;
      filter: drop-shadow(0 4px 8px rgba(12, 18, 25, 0.2));
      cursor: pointer;
    }
    .node text {
      font-size: 12px;
      font-weight: 650;
      fill: var(--text);
      paint-order: stroke;
      stroke: #ffffff;
      stroke-width: 4px;
      stroke-linejoin: round;
      pointer-events: none;
    }
    .node.dim { opacity: 0.18; }
    aside {
      border-left: 1px solid var(--line);
      background: var(--panel);
      padding: 16px;
      overflow-y: auto;
      max-height: calc(100vh - 73px);
    }
    .panel-title {
      margin: 0 0 8px;
      font-size: 16px;
    }
    .muted {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.5;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 4px 9px;
      margin: 4px 5px 0 0;
      font-size: 12px;
      color: var(--muted);
      background: #f7fafb;
    }
    .card-list {
      display: grid;
      gap: 10px;
      margin-top: 12px;
    }
    .card {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fbfcfd;
      padding: 10px;
    }
    .card strong {
      display: block;
      font-size: 13px;
      margin-bottom: 4px;
      overflow-wrap: anywhere;
    }
    .card div {
      font-size: 12px;
      color: var(--muted);
      line-height: 1.45;
      overflow-wrap: anywhere;
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 14px;
    }
    .dot {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      display: inline-block;
    }
    .warn { color: var(--warn); }
    .danger { color: var(--danger); }
    @media (max-width: 980px) {
      .app { grid-template-columns: 1fr; }
      aside {
        border-left: 0;
        border-top: 1px solid var(--line);
        max-height: none;
      }
      .toolbar { grid-template-columns: 1fr; }
      .graph-wrap { min-height: 540px; height: 68vh; }
      header { flex-direction: column; align-items: flex-start; }
      .stats { justify-content: flex-start; }
    }
  </style>
</head>
<body>
  <div class="app">
    <header>
      <div>
        <h1>Anchor Org Graph</h1>
        <div class="subtitle">${htmlEscape(config.org)} • repo-level summary with on-demand file drilldown</div>
      </div>
      <div class="stats">
        <div class="stat"><strong id="repo-count">0</strong><span>repos</span></div>
        <div class="stat"><strong id="edge-count">0</strong><span>repo edges</span></div>
        <div class="stat"><strong id="hidden-count">0</strong><span>weak hidden</span></div>
        <div class="stat"><strong id="consumer-count">0</strong><span>API consumers</span></div>
        <div class="stat"><strong id="contract-count">0</strong><span>API contracts</span></div>
      </div>
    </header>
    <main>
      <div class="toolbar">
        <input id="search" type="search" placeholder="Search repo, relationship, path, reason..." />
        <select id="relationship"></select>
        <label class="toggle"><input id="show-weak" type="checkbox" /> Show weak edges</label>
        <label class="toggle"><input id="drilldown" type="checkbox" /> File drilldown</label>
        <button id="reset" type="button">Reset</button>
      </div>
      <div class="graph-wrap" id="graph-wrap">
        <canvas id="edge-canvas" aria-label="Org graph edges"></canvas>
        <svg id="node-overlay" role="img" aria-label="Interactive org dependency graph"></svg>
      </div>
    </main>
    <aside>
      <h2 class="panel-title">Graph details</h2>
      <div id="details" class="muted">Select a repo node to inspect connected relationships and evidence reasons.</div>
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
    const canvas = document.getElementById("edge-canvas");
    const overlay = document.getElementById("node-overlay");
    const graphWrap = document.getElementById("graph-wrap");
    const ctx = canvas.getContext("2d");
    const searchInput = document.getElementById("search");
    const relationshipSelect = document.getElementById("relationship");
    const showWeakToggle = document.getElementById("show-weak");
    const drilldownToggle = document.getElementById("drilldown");
    const resetButton = document.getElementById("reset");
    const details = document.getElementById("details");
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const layoutStorageKey = "anchor-org-layout:" + graphData.layoutHash;
    const state = {
      selectedNode: null,
      selectedEdgeId: null,
      draggingNode: null,
      panning: false,
      pointerId: null,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      lastPointerX: 0,
      lastPointerY: 0,
      positions: new Map(),
      animationQueued: false
    };

    function escapeHtml(value) {
      return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
    }

    function width() {
      return graphWrap.clientWidth || 900;
    }

    function height() {
      return graphWrap.clientHeight || 640;
    }

    function setStats() {
      document.getElementById("repo-count").textContent = String(graphData.nodes.length);
      document.getElementById("edge-count").textContent = String(graphData.repoEdges.length);
      document.getElementById("hidden-count").textContent = String(graphData.hiddenRepoEdges);
      document.getElementById("consumer-count").textContent = String(graphData.apiConsumers);
      document.getElementById("contract-count").textContent = String(graphData.apiContracts);
    }

    function relationshipOptions() {
      const values = [...new Set(graphData.repoEdges.map((edge) => edge.relationship))].sort();
      relationshipSelect.innerHTML =
        '<option value="">All relationships</option>' +
        values
          .map((value) => '<option value="' + escapeHtml(value) + '">' + escapeHtml(value.replaceAll("_", " ")) + '</option>')
          .join("");
    }

    function resizeCanvas() {
      const w = width();
      const h = height();
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      overlay.setAttribute("viewBox", "0 0 " + w + " " + h);
      overlay.setAttribute("width", String(w));
      overlay.setAttribute("height", String(h));
      scheduleRender();
    }

    function nodeRadius(node) {
      return 14 + Math.min(16, Math.sqrt(node.edgeCount || 1) * 4);
    }

    function initializePositions() {
      const fromCache = readLayout();
      if (fromCache) {
        state.positions = fromCache;
        return;
      }
      const cx = width() / 2;
      const cy = height() / 2;
      const radius = Math.max(170, Math.min(width(), height()) * 0.34);
      const sorted = graphData.nodes.slice().sort((a, b) => a.id.localeCompare(b.id));
      sorted.forEach((node, index) => {
        const angle = (Math.PI * 2 * index) / Math.max(1, sorted.length) - Math.PI / 2;
        state.positions.set(node.id, {
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius
        });
      });
      persistLayout();
    }

    function readLayout() {
      try {
        const raw = localStorage.getItem(layoutStorageKey);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || !parsed.positions) return null;
        const map = new Map();
        const nodeIds = new Set(graphData.nodes.map((node) => node.id));
        for (const [key, value] of Object.entries(parsed.positions)) {
          if (!nodeIds.has(key)) continue;
          if (!value || typeof value !== "object") continue;
          const x = Number(value.x);
          const y = Number(value.y);
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          map.set(key, { x, y });
        }
        if (map.size !== graphData.nodes.length) return null;
        return map;
      } catch {
        return null;
      }
    }

    let persistTimer = 0;
    function persistLayout() {
      window.clearTimeout(persistTimer);
      persistTimer = window.setTimeout(() => {
        try {
          const positions = {};
          for (const [key, value] of state.positions.entries()) {
            positions[key] = { x: Number(value.x.toFixed(2)), y: Number(value.y.toFixed(2)) };
          }
          localStorage.setItem(
            layoutStorageKey,
            JSON.stringify({
              hash: graphData.layoutHash,
              updatedAt: Date.now(),
              positions
            }),
          );
        } catch {
          // Best effort cache only.
        }
      }, 250);
    }

    function worldToScreen(point) {
      return {
        x: point.x * state.scale + state.offsetX,
        y: point.y * state.scale + state.offsetY
      };
    }

    function screenToWorld(point) {
      return {
        x: (point.x - state.offsetX) / state.scale,
        y: (point.y - state.offsetY) / state.scale
      };
    }

    function zoomAt(screenX, screenY, zoomFactor) {
      const before = screenToWorld({ x: screenX, y: screenY });
      state.scale = Math.max(0.25, Math.min(3.4, state.scale * zoomFactor));
      const after = worldToScreen(before);
      state.offsetX += screenX - after.x;
      state.offsetY += screenY - after.y;
      scheduleRender();
    }

    function filters() {
      return {
        term: searchInput.value.trim().toLowerCase(),
        relationship: relationshipSelect.value,
        showWeak: showWeakToggle.checked,
        drilldown: drilldownToggle.checked
      };
    }

    function visibleRepoEdges() {
      const f = filters();
      return graphData.repoEdges.filter((edge) => {
        if (!f.showWeak && edge.hidden) return false;
        if (f.relationship && edge.relationship !== f.relationship) return false;
        if (!f.term) return true;
        const haystack = [
          edge.source,
          edge.target,
          edge.relationship,
          edge.matchReasons.join(" "),
          edge.examples.map((item) => item.sourcePath + " " + (item.targetPath || "")).join(" "),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(f.term);
      });
    }

    function visibleFileEdgesForSelection() {
      const f = filters();
      if (!f.drilldown || !state.selectedNode) return [];
      return graphData.fileEdges.filter((edge) => {
        if (!f.showWeak && edge.hidden) return false;
        if (f.relationship && edge.relationship !== f.relationship) return false;
        if (edge.sourceRepo !== state.selectedNode && edge.targetRepo !== state.selectedNode) return false;
        if (!f.term) return true;
        const haystack = [
          edge.sourceRepo,
          edge.targetRepo,
          edge.sourcePath,
          edge.targetPath || "",
          edge.relationship,
          edge.matchReasons.join(" ")
        ].join(" ").toLowerCase();
        return haystack.includes(f.term);
      });
    }

    function activeEdgeSet() {
      const fileDrilldownEdges = visibleFileEdgesForSelection();
      if (fileDrilldownEdges.length > 0) {
        return {
          type: "file",
          edges: fileDrilldownEdges.map((edge, index) => ({
            id: "f_" + index + "_" + edge.sourceRepo + "_" + edge.targetRepo + "_" + edge.relationship,
            source: edge.sourceRepo,
            target: edge.targetRepo,
            relationship: edge.relationship,
            confidence: edge.confidence,
            evidenceCount: edge.evidenceCount,
            hidden: edge.hidden,
            matchReasons: edge.matchReasons,
            sourcePath: edge.sourcePath,
            targetPath: edge.targetPath || "",
          })),
        };
      }
      return {
        type: "repo",
        edges: visibleRepoEdges().map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          relationship: edge.relationship,
          confidence: edge.confidence,
          evidenceCount: edge.evidenceCount,
          hidden: edge.hidden,
          matchReasons: edge.matchReasons,
          sourcePath: "",
          targetPath: "",
        })),
      };
    }

    function visibleNodes(edgeSet) {
      const ids = new Set(edgeSet.edges.flatMap((edge) => [edge.source, edge.target]));
      const f = filters();
      return graphData.nodes.filter((node) => {
        if (ids.has(node.id)) return true;
        if (!f.term) return edgeSet.edges.length === 0;
        return [node.id, node.label, node.group].join(" ").toLowerCase().includes(f.term);
      });
    }

    function adjacency(edges) {
      const map = new Map();
      for (const edge of edges) {
        const source = map.get(edge.source) || new Set();
        source.add(edge.target);
        map.set(edge.source, source);
        const target = map.get(edge.target) || new Set();
        target.add(edge.source);
        map.set(edge.target, target);
      }
      return map;
    }

    function edgeVisibleInViewport(from, to, margin) {
      const w = width();
      const h = height();
      if (from.x < -margin && to.x < -margin) return false;
      if (from.y < -margin && to.y < -margin) return false;
      if (from.x > w + margin && to.x > w + margin) return false;
      if (from.y > h + margin && to.y > h + margin) return false;
      return true;
    }

    function drawEdges(edgeSet, nodes) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width(), height());
      const visibleIds = new Set(nodes.map((node) => node.id));
      const activeEdges = edgeSet.edges.filter(
        (edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target),
      );
      const connectedSet = state.selectedNode
        ? new Set(
            activeEdges
              .filter((edge) => edge.source === state.selectedNode || edge.target === state.selectedNode)
              .flatMap((edge) => [edge.source, edge.target]),
          )
        : null;

      for (const edge of activeEdges) {
        const sourcePos = state.positions.get(edge.source);
        const targetPos = state.positions.get(edge.target);
        if (!sourcePos || !targetPos) continue;
        const source = worldToScreen(sourcePos);
        const target = worldToScreen(targetPos);
        if (!edgeVisibleInViewport(source, target, 90)) continue;

        const selected = state.selectedEdgeId === edge.id;
        const dimmed =
          state.selectedNode &&
          edge.source !== state.selectedNode &&
          edge.target !== state.selectedNode &&
          !selected;
        let stroke = "#a9b6c4";
        if (edge.confidence >= 0.82) stroke = "#1f7a5b";
        else if (edge.confidence >= 0.68) stroke = "#2d5da8";
        else stroke = "#8c6b1f";
        if (selected) stroke = "#8f36b7";
        ctx.strokeStyle = stroke;
        ctx.globalAlpha = dimmed ? 0.16 : selected ? 0.98 : 0.72;
        ctx.lineWidth = selected ? 2.9 : 1.3 + Math.min(1.7, edge.confidence * 1.2);
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();

        if (selected || (connectedSet && connectedSet.has(edge.source) && connectedSet.has(edge.target))) {
          const midX = (source.x + target.x) / 2;
          const midY = (source.y + target.y) / 2;
          ctx.fillStyle = "#334254";
          ctx.globalAlpha = 0.84;
          ctx.font = "11px Inter, system-ui, sans-serif";
          const label = edge.relationship.replaceAll("_", " ");
          ctx.fillText(label, midX + 4, midY - 4);
        }
      }
      ctx.globalAlpha = 1;
    }

    function renderNodes(edgeSet, nodes) {
      const connectedMap = adjacency(edgeSet.edges);
      const selectedConnected =
        state.selectedNode && connectedMap.has(state.selectedNode)
          ? new Set([state.selectedNode, ...connectedMap.get(state.selectedNode)])
          : null;

      overlay.innerHTML = "";
      const fragment = document.createDocumentFragment();
      for (const node of nodes) {
        const world = state.positions.get(node.id);
        if (!world) continue;
        const pos = worldToScreen(world);
        const radius = nodeRadius(node);
        const dimmed = selectedConnected && !selectedConnected.has(node.id);

        const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
        group.setAttribute("class", "node" + (dimmed ? " dim" : ""));
        group.setAttribute("transform", "translate(" + pos.x.toFixed(2) + " " + pos.y.toFixed(2) + ")");
        group.dataset.id = node.id;

        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("r", String(radius));
        circle.setAttribute("fill", colors[node.group] || colors.unknown);

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", String(radius + 7));
        text.setAttribute("y", "4");
        text.textContent = node.label;

        group.addEventListener("pointerdown", (event) => {
          event.stopPropagation();
          state.pointerId = event.pointerId;
          state.draggingNode = node.id;
          state.selectedNode = node.id;
          state.selectedEdgeId = null;
          state.lastPointerX = event.clientX;
          state.lastPointerY = event.clientY;
          canvas.classList.add("dragging");
          showDetails(edgeSet, nodes);
          scheduleRender();
        });
        group.addEventListener("pointermove", (event) => {
          if (state.draggingNode !== node.id || state.pointerId !== event.pointerId) return;
          const rect = overlay.getBoundingClientRect();
          const screenX = event.clientX - rect.left;
          const screenY = event.clientY - rect.top;
          state.positions.set(node.id, screenToWorld({ x: screenX, y: screenY }));
          state.lastPointerX = event.clientX;
          state.lastPointerY = event.clientY;
          persistLayout();
          scheduleRender();
        });
        group.addEventListener("pointerup", (event) => {
          if (state.pointerId !== event.pointerId) return;
          state.draggingNode = null;
          state.pointerId = null;
          canvas.classList.remove("dragging");
          persistLayout();
        });
        group.addEventListener("click", (event) => {
          event.stopPropagation();
          if (state.selectedNode === node.id) state.selectedNode = null;
          else state.selectedNode = node.id;
          state.selectedEdgeId = null;
          showDetails(edgeSet, nodes);
          scheduleRender();
        });

        group.append(circle, text);
        fragment.append(group);
      }
      overlay.append(fragment);
    }

    function sortedTopEdges(edgeSet, limit) {
      return edgeSet.edges
        .slice()
        .sort((a, b) => b.confidence - a.confidence || b.evidenceCount - a.evidenceCount)
        .slice(0, limit);
    }

    function showOverview(edgeSet, nodes) {
      const distribution = graphData.quality.edgeConfidenceDistribution;
      const kind = edgeSet.type === "file" ? "file-level" : "repo-level";
      details.className = "";
      details.innerHTML =
        '<div class="muted">Showing ' +
        nodes.length +
        " repo(s) and " +
        edgeSet.edges.length +
        " " +
        kind +
        ' edge(s). Select a repo to inspect exact path-level evidence.</div>' +
        '<div class="chip">strong ' + distribution.strong + '</div>' +
        '<div class="chip">moderate ' + distribution.moderate + '</div>' +
        '<div class="chip">weak hidden ' + graphData.hiddenRepoEdges + '</div>' +
        '<div class="card-list">' +
        sortedTopEdges(edgeSet, 8).map(edgeCard).join("") +
        "</div>";
    }

    function collectNodeEdges(edgeSet, nodeId) {
      return edgeSet.edges.filter((edge) => edge.source === nodeId || edge.target === nodeId);
    }

    function fileEvidenceCards(nodeId, limit) {
      const files = graphData.fileEdges
        .filter((edge) => edge.sourceRepo === nodeId || edge.targetRepo === nodeId)
        .slice()
        .sort((a, b) => b.confidence - a.confidence || b.evidenceCount - a.evidenceCount)
        .slice(0, limit);
      return files.map((edge) => {
        return (
          '<div class="card">' +
          '<strong>' + escapeHtml(edge.sourceRepo) + " → " + escapeHtml(edge.targetRepo) + "</strong>" +
          "<div>" + escapeHtml(edge.relationship.replaceAll("_", " ")) + " • confidence " + Math.round(edge.confidence * 100) + "% • evidence " + edge.evidenceCount + "</div>" +
          "<div>" + escapeHtml(edge.sourcePath) + (edge.targetPath ? " → " + escapeHtml(edge.targetPath) : "") + "</div>" +
          (edge.matchReasons.length ? "<div>" + escapeHtml(edge.matchReasons.join(", ")) + "</div>" : "") +
          "</div>"
        );
      });
    }

    function showDetails(edgeSet, nodes) {
      if (!state.selectedNode) {
        showOverview(edgeSet, nodes);
        return;
      }
      const node = graphData.nodes.find((item) => item.id === state.selectedNode);
      const edges = collectNodeEdges(edgeSet, state.selectedNode);
      details.className = "";
      details.innerHTML =
        "<h3>" + escapeHtml(state.selectedNode) + "</h3>" +
        '<span class="chip">' + escapeHtml(node ? node.group : "unknown") + "</span>" +
        '<span class="chip">' + edges.length + " active edge(s)</span>" +
        '<span class="chip">file drilldown ' + (drilldownToggle.checked ? "on" : "off") + "</span>" +
        '<div class="card-list">' + edges.slice(0, 10).map(edgeCard).join("") + "</div>" +
        "<h4 style='margin:14px 0 8px;font-size:14px;'>Codepath evidence</h4>" +
        '<div class="card-list">' + fileEvidenceCards(state.selectedNode, 10).join("") + "</div>";
    }

    function edgeCard(edge) {
      const sourcePath = edge.sourcePath ? "<div>" + escapeHtml(edge.sourcePath) + (edge.targetPath ? " → " + escapeHtml(edge.targetPath) : "") + "</div>" : "";
      const reasons = edge.matchReasons && edge.matchReasons.length
        ? "<div>" + escapeHtml(edge.matchReasons.join(", ")) + "</div>"
        : "";
      return (
        '<div class="card">' +
        "<strong>" + escapeHtml(edge.source) + " → " + escapeHtml(edge.target) + "</strong>" +
        "<div>" + escapeHtml(edge.relationship.replaceAll("_", " ")) + " • confidence " + Math.round(edge.confidence * 100) + "% • evidence " + edge.evidenceCount + "</div>" +
        sourcePath +
        reasons +
        "</div>"
      );
    }

    function renderLegend() {
      const legend = document.getElementById("legend");
      const groups = [...new Set(graphData.nodes.map((node) => node.group))].sort();
      legend.innerHTML = groups
        .map(
          (group) =>
            '<span class="chip"><span class="dot" style="background:' +
            (colors[group] || colors.unknown) +
            '"></span>' +
            escapeHtml(group) +
            "</span>",
        )
        .join("");
    }

    function scheduleRender() {
      if (state.animationQueued) return;
      state.animationQueued = true;
      window.requestAnimationFrame(() => {
        state.animationQueued = false;
        render();
      });
    }

    function render() {
      const edgeSet = activeEdgeSet();
      const nodes = visibleNodes(edgeSet);
      drawEdges(edgeSet, nodes);
      renderNodes(edgeSet, nodes);
      showDetails(edgeSet, nodes);
    }

    graphWrap.addEventListener("pointerdown", (event) => {
      if (event.target !== canvas) return;
      state.panning = true;
      state.pointerId = event.pointerId;
      state.lastPointerX = event.clientX;
      state.lastPointerY = event.clientY;
      canvas.classList.add("dragging");
    });

    graphWrap.addEventListener("pointermove", (event) => {
      if (!state.panning || state.pointerId !== event.pointerId) return;
      const dx = event.clientX - state.lastPointerX;
      const dy = event.clientY - state.lastPointerY;
      state.lastPointerX = event.clientX;
      state.lastPointerY = event.clientY;
      state.offsetX += dx;
      state.offsetY += dy;
      scheduleRender();
    });

    graphWrap.addEventListener("pointerup", (event) => {
      if (state.pointerId !== event.pointerId) return;
      state.panning = false;
      state.pointerId = null;
      canvas.classList.remove("dragging");
    });

    graphWrap.addEventListener("wheel", (event) => {
      event.preventDefault();
      const rect = graphWrap.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const factor = event.deltaY < 0 ? 1.08 : 1 / 1.08;
      zoomAt(x, y, factor);
    }, { passive: false });

    searchInput.addEventListener("input", () => {
      state.selectedEdgeId = null;
      scheduleRender();
    });
    relationshipSelect.addEventListener("change", () => {
      state.selectedEdgeId = null;
      scheduleRender();
    });
    showWeakToggle.addEventListener("change", () => scheduleRender());
    drilldownToggle.addEventListener("change", () => scheduleRender());
    resetButton.addEventListener("click", () => {
      searchInput.value = "";
      relationshipSelect.value = "";
      showWeakToggle.checked = false;
      drilldownToggle.checked = false;
      state.selectedNode = null;
      state.selectedEdgeId = null;
      state.scale = 1;
      state.offsetX = 0;
      state.offsetY = 0;
      initializePositions();
      scheduleRender();
    });
    window.addEventListener("resize", () => {
      resizeCanvas();
      scheduleRender();
    });

    setStats();
    relationshipOptions();
    renderLegend();
    resizeCanvas();
    initializePositions();
    scheduleRender();
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
    nodes: graph.repoEdges.length > 0
      ? new Set(graph.repoEdges.flatMap((edge) => [edge.sourceRepo, edge.targetRepo])).size
      : new Set(graph.edges.flatMap((edge) => [edge.sourceRepo, edge.targetRepo])).size,
    edges: graph.repoEdges.length,
  };
}
