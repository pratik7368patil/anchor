import crypto from "node:crypto";
import type { AnchorDatabase } from "../db/database.js";
import { initializeSchema } from "../db/database.js";
import { sanitizeHistoricalText } from "../security/sanitize.js";
import type {
  AnchorOrgConfig,
  ConfidenceLevel,
  EvidenceRef,
  OrgAnomaly,
  OrgAnomalyCategory,
  OrgApiConsumer,
  OrgCrossRepoEdge,
} from "../types.js";
import { uniqueStrings } from "../utils/text.js";
import { filesFromDiff } from "../retrieval/review-diff.js";
import { getOrgStatus } from "./database.js";

type ImpactInput = {
  repo?: string;
  diff?: string;
  files?: string[];
  task?: string;
  strict?: boolean;
  maxResults?: number;
};

type ConsumerRow = {
  provider_repo: string;
  provider_path?: string | null;
  consumer_repo: string;
  consumer_path: string;
  contract: string;
  evidence_json: string;
  match_reasons_json?: string;
  evidence_count?: number;
  is_weak?: number;
  confidence: number;
};

type EdgeRow = {
  source_repo: string;
  source_path: string;
  target_repo: string;
  target_path?: string | null;
  layer: "file" | "repo";
  relationship: string;
  evidence_json: string;
  match_reasons_json?: string;
  evidence_count?: number;
  is_weak?: number;
  confidence: number;
};

type RegressionRow = {
  repo: string;
  pr_number: number;
  pr_url: string;
  summary_sanitized: string;
  file_paths_json: string;
  confidence: number;
};

type StateRow = {
  repo: string;
  current_commit?: string | null;
  last_code_indexed_commit?: string | null;
  last_code_indexed_at?: string | null;
};

export type OrgImpactResult = {
  markdown: string;
  metadata: {
    org: string;
    repo?: string;
    changedFiles: string[];
    anomalies: OrgAnomaly[];
    apiConsumers: OrgApiConsumer[];
    crossRepoEdges: OrgCrossRepoEdge[];
    coverageWarnings: string[];
    ok: boolean;
  };
};

function stableId(parts: string[]): string {
  return crypto.createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 24);
}

function parseEvidence(value: string): EvidenceRef[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is EvidenceRef => typeof item === "object" && item !== null);
  } catch {
    return [];
  }
}

function parseStringArray(value?: string): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function fileEvidence(repo: string, filePath: string, note: string): EvidenceRef {
  return {
    prNumber: 0,
    prUrl: `file:${repo}:${filePath}`,
    sourceType: "diff_context",
    filePath,
    note,
  };
}

function isSensitivePath(filePath: string): boolean {
  return /\b(auth|access|permission|permissions|role|roles|security|billing|entitlement|acl|rbac|user-access)\b/i.test(
    filePath,
  );
}

function isApiContractPath(filePath: string): boolean {
  return /\b(api|route|routes|controller|schema|dto|graphql|openapi|proto|sdk|client)\b/i.test(
    filePath,
  );
}

function isTestPath(filePath: string): boolean {
  return /(^|\/)(__tests__|tests?|spec)(\/|$)|\.(test|spec)\.[A-Za-z0-9]+$/i.test(filePath);
}

function confidenceFromScore(score: number): ConfidenceLevel {
  if (score >= 0.78) return "strong";
  if (score >= 0.55) return "moderate";
  return "weak";
}

function affectedConsumers(
  db: AnchorDatabase,
  org: string,
  repo: string | undefined,
  changedFiles: string[],
): OrgApiConsumer[] {
  const rows = db
    .prepare(
      `SELECT provider_repo, provider_path, consumer_repo, consumer_path, contract, evidence_json, confidence
       FROM org_api_consumers
       WHERE org = ? AND is_weak = 0`,
    )
    .all(org) as ConsumerRow[];
  return rows
    .filter((row) => !repo || row.provider_repo === repo || row.consumer_repo === repo)
    .filter((row) => {
      if (changedFiles.length === 0) return true;
      return changedFiles.some(
        (file) =>
          row.provider_path === file ||
          row.consumer_path === file ||
          file.includes(row.contract) ||
          row.contract.includes(file.split("/").pop() ?? ""),
      );
    })
    .map((row) => ({
      org,
      providerRepo: row.provider_repo,
      providerPath: row.provider_path ?? undefined,
      consumerRepo: row.consumer_repo,
      consumerPath: row.consumer_path,
      contract: sanitizeHistoricalText(row.contract),
      evidence: parseEvidence(row.evidence_json),
      matchReasons: parseStringArray(row.match_reasons_json),
      evidenceCount: row.evidence_count ?? parseEvidence(row.evidence_json).length,
      weak: (row.is_weak ?? 0) === 1,
      confidence: row.confidence,
    }));
}

function affectedEdges(
  db: AnchorDatabase,
  org: string,
  repo: string | undefined,
  changedFiles: string[],
): OrgCrossRepoEdge[] {
  const rows = db
    .prepare(
      `SELECT source_repo, source_path, target_repo, target_path, layer, relationship, evidence_json,
              match_reasons_json, evidence_count, is_weak, confidence
       FROM org_cross_repo_edges
       WHERE org = ? AND layer = 'file'`,
    )
    .all(org) as EdgeRow[];
  return rows
    .filter((row) => !repo || row.source_repo === repo || row.target_repo === repo)
    .filter((row) => {
      if (changedFiles.length === 0) return true;
      return changedFiles.some((file) => row.source_path === file || row.target_path === file);
    })
    .map((row) => ({
      org,
      sourceRepo: row.source_repo,
      sourcePath: row.source_path,
      targetRepo: row.target_repo,
      targetPath: row.target_path ?? undefined,
      layer: row.layer,
      relationship: row.relationship as OrgCrossRepoEdge["relationship"],
      evidence: parseEvidence(row.evidence_json),
      matchReasons: parseStringArray(row.match_reasons_json),
      evidenceCount: row.evidence_count ?? parseEvidence(row.evidence_json).length,
      weak: (row.is_weak ?? 0) === 1,
      confidence: row.confidence,
    }));
}

function regressionEvidence(
  db: AnchorDatabase,
  repo: string | undefined,
  changedFiles: string[],
): RegressionRow[] {
  const rows = db
    .prepare(
      `SELECT repo, pr_number, pr_url, summary_sanitized, file_paths_json, confidence
       FROM regression_events
       ORDER BY confidence DESC, created_at DESC
       LIMIT 200`,
    )
    .all() as RegressionRow[];
  return rows
    .filter((row) => !repo || row.repo === repo)
    .filter((row) => {
      if (changedFiles.length === 0) return true;
      return changedFiles.some((file) => row.file_paths_json.includes(file));
    })
    .slice(0, 8);
}

function staleRepos(db: AnchorDatabase, org: string, repos: string[]): string[] {
  const rows = db
    .prepare(
      "SELECT repo, current_commit, last_code_indexed_commit, last_code_indexed_at FROM org_repo_state WHERE org = ?",
    )
    .all(org) as StateRow[];
  const target = new Set(repos);
  return rows
    .filter((row) => target.size === 0 || target.has(row.repo))
    .filter(
      (row) =>
        !row.last_code_indexed_at ||
        (row.current_commit &&
          row.last_code_indexed_commit &&
          row.current_commit !== row.last_code_indexed_commit),
    )
    .map((row) => row.repo);
}

function createAnomaly(input: {
  org: string;
  category: OrgAnomalyCategory;
  severity: OrgAnomaly["severity"];
  summary: string;
  affectedRepos: string[];
  affectedFiles: string[];
  evidence: EvidenceRef[];
  recommendedChecks: string[];
  confidence: ConfidenceLevel;
}): OrgAnomaly {
  return {
    id: `oa_${stableId([
      input.org,
      input.category,
      input.severity,
      input.summary,
      ...input.affectedRepos,
      ...input.affectedFiles,
    ])}`,
    category: input.category,
    severity: input.severity,
    summary: sanitizeHistoricalText(input.summary),
    affectedRepos: uniqueStrings(input.affectedRepos),
    affectedFiles: uniqueStrings(input.affectedFiles),
    evidence: input.evidence,
    recommendedChecks: uniqueStrings(input.recommendedChecks),
    confidence: input.confidence,
  };
}

function storeAnomalies(db: AnchorDatabase, org: string, anomalies: OrgAnomaly[]): void {
  const now = new Date().toISOString();
  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM org_anomaly_events WHERE org = ?").run(org);
    const insert = db.prepare(
      `INSERT INTO org_anomaly_events
       (id, org, category, severity, summary_sanitized, affected_repos_json, affected_files_json,
        evidence_json, recommended_checks_json, confidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const anomaly of anomalies) {
      insert.run(
        anomaly.id,
        org,
        anomaly.category,
        anomaly.severity,
        anomaly.summary,
        JSON.stringify(anomaly.affectedRepos),
        JSON.stringify(anomaly.affectedFiles),
        JSON.stringify(anomaly.evidence),
        JSON.stringify(anomaly.recommendedChecks),
        anomaly.confidence,
        now,
      );
    }
  });
  transaction();
}

function formatEvidence(evidence: EvidenceRef[]): string {
  const first = evidence[0];
  if (!first) return "local org index";
  if (first.prNumber > 0) return `PR #${first.prNumber} (${first.sourceType})`;
  return first.filePath ? `file ${first.filePath}` : (first.note ?? "local file evidence");
}

export function checkOrgImpact(
  db: AnchorDatabase,
  config: AnchorOrgConfig,
  input: ImpactInput,
): OrgImpactResult {
  initializeSchema(db);
  const changedFiles = uniqueStrings([...(input.files ?? []), ...filesFromDiff(input.diff ?? "")]);
  const repo = input.repo ?? config.repos.find((item) => item.enabled)?.fullName;
  const consumers = affectedConsumers(db, config.org, repo, changedFiles);
  const edges = affectedEdges(db, config.org, repo, changedFiles);
  const regressions = regressionEvidence(db, repo, changedFiles);
  const changedRepos = uniqueStrings(
    [
      repo,
      ...consumers.flatMap((consumer) => [consumer.providerRepo, consumer.consumerRepo]),
      ...edges.flatMap((edge) => [edge.sourceRepo, edge.targetRepo]),
    ].filter(Boolean) as string[],
  );
  const stale = staleRepos(db, config.org, changedRepos);
  const changedTestFiles = changedFiles.filter(isTestPath);
  const anomalies: OrgAnomaly[] = [];

  for (const file of changedFiles.filter(isSensitivePath)) {
    anomalies.push(
      createAnomaly({
        org: config.org,
        category: "access_control_risk",
        severity: changedTestFiles.length === 0 ? "high" : "medium",
        summary: `Sensitive access/auth path changed: ${file}`,
        affectedRepos: repo ? [repo] : [],
        affectedFiles: [file],
        evidence: repo ? [fileEvidence(repo, file, "sensitive path changed")] : [],
        recommendedChecks: [
          "Run related access-control tests.",
          "Verify callers cannot trust client-provided access state.",
        ],
        confidence: "moderate",
      }),
    );
  }

  const apiChangedFiles = changedFiles.filter(isApiContractPath);
  if (apiChangedFiles.length > 0 && consumers.length > 0) {
    anomalies.push(
      createAnomaly({
        org: config.org,
        category: "api_contract_change",
        severity: "high",
        summary: "API/schema/client contract changed with known cross-repo consumers.",
        affectedRepos: uniqueStrings(
          consumers.flatMap((consumer) => [consumer.providerRepo, consumer.consumerRepo]),
        ),
        affectedFiles: uniqueStrings([
          ...apiChangedFiles,
          ...consumers.map((consumer) => consumer.consumerPath),
        ]),
        evidence: consumers.flatMap((consumer) => consumer.evidence),
        recommendedChecks: [
          "Update or verify downstream API clients.",
          "Run provider and consumer tests before merge.",
        ],
        confidence: confidenceFromScore(
          Math.max(...consumers.map((consumer) => consumer.confidence)),
        ),
      }),
    );
  }

  if (apiChangedFiles.length > 0 && consumers.length > 0) {
    const consumerRepos = uniqueStrings(consumers.map((consumer) => consumer.consumerRepo));
    const changedConsumerRepo = consumerRepos.some((consumerRepo) => consumerRepo === repo);
    if (!changedConsumerRepo) {
      anomalies.push(
        createAnomaly({
          org: config.org,
          category: "missing_consumer_update",
          severity: "medium",
          summary:
            "Changed API contract but no changed file from a known consumer repo is present.",
          affectedRepos: consumerRepos,
          affectedFiles: consumers.map((consumer) => consumer.consumerPath),
          evidence: consumers.flatMap((consumer) => consumer.evidence),
          recommendedChecks: ["Check generated SDKs, frontend clients, and contract tests."],
          confidence: "moderate",
        }),
      );
    }
  }

  const repoGroup = config.repos.find((item) => item.fullName === repo)?.group;
  if (repoGroup === "shared" && edges.length > 0) {
    anomalies.push(
      createAnomaly({
        org: config.org,
        category: "shared_package_blast_radius",
        severity: "high",
        summary: "Shared package change can affect downstream repos.",
        affectedRepos: uniqueStrings(edges.flatMap((edge) => [edge.sourceRepo, edge.targetRepo])),
        affectedFiles: uniqueStrings(
          edges.flatMap((edge) => [edge.sourcePath, edge.targetPath ?? ""]),
        ).filter(Boolean),
        evidence: edges.flatMap((edge) => edge.evidence),
        recommendedChecks: ["Run tests in downstream repos that import this package."],
        confidence: confidenceFromScore(Math.max(...edges.map((edge) => edge.confidence), 0.6)),
      }),
    );
  }

  if (
    (apiChangedFiles.length > 0 || changedFiles.some(isSensitivePath)) &&
    changedTestFiles.length === 0
  ) {
    anomalies.push(
      createAnomaly({
        org: config.org,
        category: "missing_tests",
        severity: "medium",
        summary: "Risk-sensitive files changed without test files in the diff.",
        affectedRepos: repo ? [repo] : [],
        affectedFiles: changedFiles,
        evidence: repo
          ? changedFiles.map((file) => fileEvidence(repo, file, "changed without test file"))
          : [],
        recommendedChecks: ["Add or run related unit/integration/contract tests."],
        confidence: "moderate",
      }),
    );
  }

  for (const regression of regressions) {
    anomalies.push(
      createAnomaly({
        org: config.org,
        category: "known_regression_match",
        severity: regression.confidence >= 0.8 ? "high" : "medium",
        summary: `Known regression memory matches this change: ${regression.summary_sanitized}`,
        affectedRepos: [regression.repo],
        affectedFiles: changedFiles,
        evidence: [
          {
            prNumber: regression.pr_number,
            prUrl: regression.pr_url,
            sourceType: "pr_body",
            note: "regression memory",
          },
        ],
        recommendedChecks: [
          "Read the cited regression PR before approving.",
          "Run the regression test path if available.",
        ],
        confidence: confidenceFromScore(regression.confidence),
      }),
    );
  }

  if (stale.length > 0) {
    anomalies.push(
      createAnomaly({
        org: config.org,
        category: "stale_org_index",
        severity: input.strict ? "high" : "low",
        summary: "One or more impacted repos have stale or missing org indexes.",
        affectedRepos: stale,
        affectedFiles: [],
        evidence: [],
        recommendedChecks: ["Run anchor org sync before relying on org-wide impact results."],
        confidence: "strong",
      }),
    );
  }

  storeAnomalies(db, config.org, anomalies);
  const status = getOrgStatus(db, config);
  const coverageWarnings =
    status.coverageScore < 70
      ? [`Org coverage is ${status.coverageScore}% (${status.coverageGrade}).`]
      : [];
  const strictFailures = anomalies.filter((anomaly) =>
    ["blocker", "high"].includes(anomaly.severity),
  );
  const ok = input.strict ? strictFailures.length === 0 : true;
  const visibleLimit = Math.max(1, Math.min(input.maxResults ?? 8, 12));

  const lines = ["# Anchor Cross-Repo Impact", ""];
  lines.push("## Blockers", "");
  const blockers = anomalies.filter((anomaly) => anomaly.severity === "blocker");
  if (blockers.length === 0) lines.push("- No blocker anomalies found.");
  else for (const anomaly of blockers.slice(0, visibleLimit)) lines.push(`- ${anomaly.summary}`);

  lines.push("", "## High-risk changes", "");
  const highRisk = anomalies.filter((anomaly) => anomaly.severity === "high");
  if (highRisk.length === 0) lines.push("- No high-risk anomalies found.");
  else {
    for (const anomaly of highRisk.slice(0, visibleLimit)) {
      lines.push(
        `- [${anomaly.category}] ${anomaly.summary} Evidence: ${formatEvidence(anomaly.evidence)}.`,
      );
    }
  }

  lines.push("", "## Affected repos", "");
  const affectedRepos = uniqueStrings(anomalies.flatMap((anomaly) => anomaly.affectedRepos));
  if (affectedRepos.length === 0)
    lines.push("- No affected repos found from the current org index.");
  else
    for (const affectedRepo of affectedRepos.slice(0, visibleLimit))
      lines.push(`- ${affectedRepo}`);

  lines.push("", "## API consumers", "");
  if (consumers.length === 0) lines.push("- No API consumers matched.");
  else {
    for (const consumer of consumers.slice(0, visibleLimit)) {
      lines.push(
        `- ${consumer.consumerRepo}:${consumer.consumerPath} consumes ${consumer.providerRepo} ${consumer.contract}. Evidence: ${formatEvidence(consumer.evidence)}.`,
      );
    }
  }

  lines.push("", "## Regression memory", "");
  const regressionAnomalies = anomalies.filter(
    (anomaly) => anomaly.category === "known_regression_match",
  );
  if (regressionAnomalies.length === 0) lines.push("- No matching regression memory found.");
  else
    for (const anomaly of regressionAnomalies.slice(0, visibleLimit))
      lines.push(`- ${anomaly.summary}`);

  lines.push("", "## Required checks", "");
  const checks = uniqueStrings(anomalies.flatMap((anomaly) => anomaly.recommendedChecks));
  if (checks.length === 0)
    lines.push("- Keep provider and consumer tests in sync when changing contracts.");
  else for (const check of checks.slice(0, visibleLimit)) lines.push(`- ${check}`);

  lines.push("", "## Index coverage warnings", "");
  if (coverageWarnings.length === 0)
    lines.push("- Org index coverage is sufficient for deterministic checks.");
  else for (const warning of coverageWarnings) lines.push(`- ${warning}`);

  return {
    markdown: lines.join("\n"),
    metadata: {
      org: config.org,
      repo,
      changedFiles,
      anomalies,
      apiConsumers: consumers,
      crossRepoEdges: edges,
      coverageWarnings,
      ok,
    },
  };
}
