import path from "node:path";
import type {
  ArchitectureArea,
  ArchitectureMap,
  ArchitectureMapEdge,
  ArchitectureMapFormat,
  ArchitectureMapNode,
} from "../types.js";
import type { AnchorDatabase } from "../db/database.js";
import { initializeSchema } from "../db/database.js";
import { uniqueStrings } from "../utils/text.js";

type ComponentRow = {
  path: string;
  area: ArchitectureArea;
  kind: string;
};

type EdgeRow = {
  source_path: string;
  target_path: string;
  relationship: string;
  weight: number;
};

export type ArchitectureMapInput = {
  file?: string;
  area?: ArchitectureArea;
  format?: ArchitectureMapFormat;
  maxNodes?: number;
};

function labelFor(filePath: string): string {
  return path.posix.basename(filePath) || filePath;
}

function nodeId(filePath: string): string {
  return filePath.replace(/[^a-zA-Z0-9_]/g, "_");
}

function toMermaid(nodes: ArchitectureMapNode[], edges: ArchitectureMapEdge[]): string {
  const lines = ["graph TD"];
  for (const node of nodes) {
    lines.push(`  ${node.id}["${node.label}<br/>${node.area}"]`);
  }
  for (const edge of edges) {
    lines.push(`  ${edge.source} -->|${edge.relationship}| ${edge.target}`);
  }
  return lines.join("\n");
}

function loadComponentRows(db: AnchorDatabase, input: ArchitectureMapInput): ComponentRow[] {
  if (input.file) {
    const fileDir = path.posix.dirname(input.file);
    return db
      .prepare(
        `SELECT path, area, kind
         FROM architecture_components
         WHERE path = ? OR path LIKE ?
         ORDER BY path
         LIMIT ?`,
      )
      .all(input.file, `${fileDir}/%`, input.maxNodes ?? 60) as ComponentRow[];
  }
  if (input.area) {
    return db
      .prepare(
        `SELECT path, area, kind
         FROM architecture_components
         WHERE area = ?
         ORDER BY path
         LIMIT ?`,
      )
      .all(input.area, input.maxNodes ?? 80) as ComponentRow[];
  }
  return db
    .prepare(
      `SELECT path, area, kind
       FROM architecture_components
       ORDER BY area, path
       LIMIT ?`,
    )
    .all(input.maxNodes ?? 100) as ComponentRow[];
}

function loadEdgeRows(db: AnchorDatabase, paths: string[]): EdgeRow[] {
  if (paths.length === 0) return [];
  const placeholders = paths.map(() => "?").join(", ");
  return db
    .prepare(
      `SELECT source_path, target_path, relationship, weight
       FROM architecture_map_edges
       WHERE source_path IN (${placeholders}) OR target_path IN (${placeholders})
       ORDER BY weight DESC, source_path, target_path
       LIMIT 160`,
    )
    .all(...paths, ...paths) as EdgeRow[];
}

export function buildArchitectureMap(
  db: AnchorDatabase,
  input: ArchitectureMapInput = {},
): ArchitectureMap {
  initializeSchema(db);
  const rows = loadComponentRows(db, input);
  const byPath = new Map<string, ComponentRow>(rows.map((row) => [row.path, row]));
  const edgeRows = loadEdgeRows(db, rows.map((row) => row.path));
  for (const edge of edgeRows) {
    if (!byPath.has(edge.source_path)) {
      byPath.set(edge.source_path, {
        path: edge.source_path,
        area: "unknown",
        kind: "external",
      });
    }
    if (!byPath.has(edge.target_path)) {
      byPath.set(edge.target_path, {
        path: edge.target_path,
        area: "unknown",
        kind: "external",
      });
    }
  }

  const nodes: ArchitectureMapNode[] = [...byPath.values()]
    .slice(0, input.maxNodes ?? 100)
    .map((row) => ({
      id: nodeId(row.path),
      label: labelFor(row.path),
      area: row.area,
      path: row.path,
    }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges: ArchitectureMapEdge[] = edgeRows
    .map((edge) => ({
      source: nodeId(edge.source_path),
      target: nodeId(edge.target_path),
      relationship: edge.relationship,
      weight: edge.weight,
    }))
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  const dedupedEdges = uniqueStrings(
    edges.map((edge) => `${edge.source}\0${edge.target}\0${edge.relationship}\0${edge.weight}`),
  ).map((key) => {
    const [source, target, relationship, weight] = key.split("\0");
    return {
      source: source ?? "",
      target: target ?? "",
      relationship: relationship ?? "",
      weight: Number(weight ?? 0),
    };
  });

  return {
    format: input.format ?? "json",
    nodes,
    edges: dedupedEdges,
    mermaid: toMermaid(nodes, dedupedEdges),
  };
}
