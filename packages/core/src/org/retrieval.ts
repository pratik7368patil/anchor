import type { AnchorDatabase } from "../db/database.js";
import { initializeSchema } from "../db/database.js";
import { sanitizeHistoricalText } from "../security/sanitize.js";
import type { AnchorOrgConfig, EvidenceRef, OrgApiConsumer } from "../types.js";
import { uniqueStrings } from "../utils/text.js";
import { checkOrgImpact } from "./impact.js";

type OrgContextInput = {
  task: string;
  repos?: string[];
  files?: string[];
  symbols?: string[];
  diff?: string;
  strict?: boolean;
  maxResults?: number;
};

type WisdomRow = {
  repo: string;
  pr_number: number;
  pr_url: string;
  source_type: string;
  category: string;
  sanitized_text: string;
  file_paths_json: string;
  confidence: number;
};

type CodeRow = {
  repo: string;
  file_path: string;
  start_line: number;
  end_line: number;
  sanitized_text: string;
  symbols_json: string;
};

type PatternRow = {
  repo: string;
  area: string;
  summary_sanitized: string;
  source_files_json: string;
  confidence: number;
};

type ConsumerRow = {
  provider_repo: string;
  provider_path?: string | null;
  consumer_repo: string;
  consumer_path: string;
  contract: string;
  evidence_json: string;
  confidence: number;
};

type EdgeRow = {
  source_repo: string;
  source_path: string;
  target_repo: string;
  target_path?: string | null;
  relationship: string;
  confidence: number;
};

function parseEvidence(value: string): EvidenceRef[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is EvidenceRef => typeof item === "object" && item !== null)
      : [];
  } catch {
    return [];
  }
}

function evidenceLabel(evidence: EvidenceRef[]): string {
  const first = evidence[0];
  if (!first) return "local org index";
  if (first.prNumber > 0) return `PR #${first.prNumber}`;
  return first.filePath ? `file ${first.filePath}` : (first.note ?? "local file evidence");
}

export type OrgFormattedResult = {
  markdown: string;
  metadata: Record<string, unknown>;
};

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function queryTerms(input: OrgContextInput): string[] {
  return uniqueStrings(
    [
      ...input.task.split(/[^A-Za-z0-9_/-]+/),
      ...(input.files ?? []).flatMap((file) => file.split(/[/._-]+/)),
      ...(input.symbols ?? []),
    ]
      .map((term) => term.trim())
      .filter((term) => term.length >= 3)
      .slice(0, 30),
  );
}

function matchesRepo(repo: string, repos?: string[]): boolean {
  return !repos || repos.length === 0 || repos.includes(repo);
}

function rowScore(
  input: OrgContextInput,
  text: string,
  files: string[],
  symbols: string[],
  lowerTerms: string[],
): number {
  let score = 0;
  // Lowercase the row text once; callers pass pre-lowercased query terms so we don't
  // rebuild the term list or re-lowercase per row across hundreds of candidates.
  const lowerText = text.toLowerCase();
  for (const file of input.files ?? []) {
    if (files.includes(file)) score += 5;
    else if (files.some((candidate) => candidate.endsWith(`/${file.split("/").pop() ?? file}`)))
      score += 2;
  }
  for (const symbol of input.symbols ?? []) {
    if (symbols.includes(symbol)) score += 4;
    else if (lowerText.includes(symbol.toLowerCase())) score += 1;
  }
  for (const term of lowerTerms) {
    if (lowerText.includes(term)) score += 0.5;
  }
  return score;
}

function getWisdom(db: AnchorDatabase, input: OrgContextInput, limit: number): WisdomRow[] {
  const rows = db
    .prepare(
      `SELECT repo, pr_number, pr_url, source_type, category, sanitized_text, file_paths_json, confidence
       FROM wisdom_units
       ORDER BY confidence DESC, created_at DESC
       LIMIT 500`,
    )
    .all() as WisdomRow[];
  const lowerTerms = queryTerms(input).map((term) => term.toLowerCase());
  return rows
    .filter((row) => matchesRepo(row.repo, input.repos))
    .map((row) => ({
      row,
      score: rowScore(input, row.sanitized_text, parseStringArray(row.file_paths_json), [], lowerTerms),
    }))
    .filter((item) => item.score > 0 || (input.files ?? []).length === 0)
    .sort((a, b) => b.score - a.score || b.row.confidence - a.row.confidence)
    .slice(0, limit)
    .map((item) => item.row);
}

function getCodeEvidence(db: AnchorDatabase, input: OrgContextInput, limit: number): CodeRow[] {
  const rows = db
    .prepare(
      `SELECT repo, file_path, start_line, end_line, sanitized_text, symbols_json
       FROM code_chunks
       ORDER BY updated_at DESC
       LIMIT 800`,
    )
    .all() as CodeRow[];
  const lowerTerms = queryTerms(input).map((term) => term.toLowerCase());
  return rows
    .filter((row) => matchesRepo(row.repo, input.repos))
    .map((row) => ({
      row,
      score: rowScore(
        input,
        row.sanitized_text,
        [row.file_path],
        parseStringArray(row.symbols_json),
        lowerTerms,
      ),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.row);
}

function getArchitecture(db: AnchorDatabase, input: OrgContextInput, limit: number): PatternRow[] {
  const rows = db
    .prepare(
      `SELECT repo, area, summary_sanitized, source_files_json, confidence
       FROM architecture_patterns
       ORDER BY confidence DESC, created_at DESC
       LIMIT 300`,
    )
    .all() as PatternRow[];
  const lowerTerms = queryTerms(input).map((term) => term.toLowerCase());
  return rows
    .filter((row) => matchesRepo(row.repo, input.repos))
    .map((row) => ({
      row,
      score: rowScore(
        input,
        row.summary_sanitized,
        parseStringArray(row.source_files_json),
        [],
        lowerTerms,
      ),
    }))
    .filter((item) => item.score > 0 || (input.files ?? []).length === 0)
    .sort((a, b) => b.score - a.score || b.row.confidence - a.row.confidence)
    .slice(0, limit)
    .map((item) => item.row);
}

export function findOrgApiConsumers(
  db: AnchorDatabase,
  config: AnchorOrgConfig,
  input: { repo?: string; files?: string[]; query?: string; maxResults?: number },
): OrgApiConsumer[] {
  initializeSchema(db);
  // Push the repo filter into SQL so the (org, provider_repo)/(org, consumer_repo)
  // composite indexes are used instead of loading every consumer row for the org.
  const repoClause = input.repo ? " AND (provider_repo = ? OR consumer_repo = ?)" : "";
  const repoParams = input.repo ? [input.repo, input.repo] : [];
  const rows = db
    .prepare(
      `SELECT provider_repo, provider_path, consumer_repo, consumer_path, contract, evidence_json, confidence
       FROM org_api_consumers
       WHERE org = ?${repoClause}
       ORDER BY confidence DESC`,
    )
    .all(config.org, ...repoParams) as ConsumerRow[];
  const limit = Math.max(1, Math.min(input.maxResults ?? 8, 25));
  return rows
    .filter((row) => {
      const files = input.files ?? [];
      if (files.length === 0 && !input.query) return true;
      return (
        files.some((file) => row.provider_path === file || row.consumer_path === file) ||
        Boolean(input.query && row.contract.toLowerCase().includes(input.query.toLowerCase()))
      );
    })
    .slice(0, limit)
    .map((row) => ({
      org: config.org,
      providerRepo: row.provider_repo,
      providerPath: row.provider_path ?? undefined,
      consumerRepo: row.consumer_repo,
      consumerPath: row.consumer_path,
      contract: sanitizeHistoricalText(row.contract),
      evidence: parseEvidence(row.evidence_json),
      confidence: row.confidence,
    }));
}

export function getOrgArchitectureMap(
  db: AnchorDatabase,
  config: AnchorOrgConfig,
  format: "mermaid" | "json" = "mermaid",
): OrgFormattedResult {
  initializeSchema(db);
  const rows = db
    .prepare(
      `SELECT source_repo, source_path, target_repo, target_path, relationship, confidence
       FROM org_cross_repo_edges
       WHERE org = ?
       ORDER BY confidence DESC, source_repo, target_repo`,
    )
    .all(config.org) as EdgeRow[];
  const nodes = uniqueStrings(rows.flatMap((row) => [row.source_repo, row.target_repo])).map(
    (repo) => ({
      id: repo,
      label: repo,
    }),
  );
  const edges = rows.map((row) => ({
    source: row.source_repo,
    target: row.target_repo,
    relationship: row.relationship,
    sourcePath: row.source_path,
    targetPath: row.target_path ?? undefined,
    confidence: row.confidence,
  }));
  const mermaid = [
    "graph LR",
    ...edges.slice(0, 80).map((edge) => {
      const source = edge.source.replace(/[^A-Za-z0-9_]/g, "_");
      const target = edge.target.replace(/[^A-Za-z0-9_]/g, "_");
      return `  ${source}["${edge.source}"] -->|${edge.relationship}| ${target}["${edge.target}"]`;
    }),
  ].join("\n");
  const markdown =
    format === "json"
      ? JSON.stringify({ nodes, edges }, null, 2)
      : ["# Anchor Org Architecture", "", "```mermaid", mermaid, "```"].join("\n");
  return {
    markdown,
    metadata: { org: config.org, format, nodes, edges, mermaid },
  };
}

export function buildOrgContextResult(
  db: AnchorDatabase,
  config: AnchorOrgConfig,
  input: OrgContextInput,
): OrgFormattedResult {
  initializeSchema(db);
  const limit = Math.max(1, Math.min(input.maxResults ?? 8, 12));
  const impact = checkOrgImpact(db, config, {
    repo: input.repos?.[0],
    files: input.files,
    diff: input.diff,
    task: input.task,
    strict: input.strict,
    maxResults: limit,
  });
  const wisdom = getWisdom(db, input, limit);
  const code = getCodeEvidence(db, input, limit);
  const architecture = getArchitecture(db, input, limit);
  const consumers = impact.metadata.apiConsumers.slice(0, limit);
  const anomalies = impact.metadata.anomalies.slice(0, limit);

  const lines = ["# Anchor Org Context", ""];
  lines.push("## Must know", "");
  if (wisdom.length === 0)
    lines.push("- No matching PR-history evidence found across the org index.");
  else {
    for (const item of wisdom) {
      lines.push(
        `- [${item.repo}] [${item.category}] ${item.sanitized_text.slice(0, 220)} Evidence: PR #${item.pr_number}, ${item.source_type}. Link: ${item.pr_url}`,
      );
    }
  }

  lines.push("", "## Cross-repo impact", "");
  if (anomalies.length === 0) lines.push("- No cross-repo anomalies matched this task.");
  else for (const anomaly of anomalies) lines.push(`- [${anomaly.severity}] ${anomaly.summary}`);

  lines.push("", "## API consumers", "");
  if (consumers.length === 0) lines.push("- No matching API consumers found.");
  else {
    for (const consumer of consumers) {
      lines.push(
        `- ${consumer.consumerRepo}:${consumer.consumerPath} uses ${consumer.providerRepo} ${consumer.contract}. Evidence: ${evidenceLabel(consumer.evidence)}.`,
      );
    }
  }

  lines.push("", "## Known regressions", "");
  const regressions = anomalies.filter((anomaly) => anomaly.category === "known_regression_match");
  if (regressions.length === 0) lines.push("- No matching regression memory found.");
  else for (const anomaly of regressions) lines.push(`- ${anomaly.summary}`);

  lines.push("", "## Architecture guidance", "");
  if (architecture.length === 0) lines.push("- No matching architecture patterns found.");
  else {
    for (const pattern of architecture) {
      const files = parseStringArray(pattern.source_files_json);
      lines.push(
        `- [${pattern.repo}] [${pattern.area}] ${pattern.summary_sanitized} Evidence: ${files[0] ?? "indexed current code"}.`,
      );
    }
  }

  lines.push("", "## Relevant tests", "");
  const testEvidence = code.filter((chunk) => isTestPath(chunk.file_path));
  if (testEvidence.length === 0) lines.push("- No matching test chunks found in the org index.");
  else {
    for (const chunk of testEvidence.slice(0, limit)) {
      lines.push(`- ${chunk.repo}:${chunk.file_path}:${chunk.start_line}-${chunk.end_line}`);
    }
  }

  lines.push("", "## Recommended checks", "");
  const checks = uniqueStrings(anomalies.flatMap((anomaly) => anomaly.recommendedChecks));
  if (checks.length === 0) lines.push("- Run repo-local tests and any impacted consumer tests.");
  else for (const check of checks.slice(0, limit)) lines.push(`- ${check}`);

  return {
    markdown: lines.join("\n"),
    metadata: {
      ...impact.metadata,
      queryTerms: queryTerms(input),
      items: wisdom,
      codeEvidence: code,
      architecturePatterns: architecture,
    },
  };
}

function isTestPath(filePath: string): boolean {
  return /(^|\/)(__tests__|tests?|spec)(\/|$)|\.(test|spec)\.[A-Za-z0-9]+$/i.test(filePath);
}
