import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AnchorDatabase } from "../db/database.js";
import { initializeSchema } from "../db/database.js";
import { sanitizeHistoricalText } from "../security/sanitize.js";
import type { AnchorOrgConfig, EvidenceRef, OrgApiConsumer, OrgCrossRepoEdge } from "../types.js";
import { uniqueStrings } from "../utils/text.js";
import { orgRepoLocalPath } from "./config.js";

type ImportRow = {
  repo: string;
  source_path: string;
  specifier: string;
  imported_path?: string | null;
  imported_symbols_json: string;
};
type ChunkRow = {
  repo: string;
  file_path: string;
  sanitized_text: string;
  symbols_json: string;
};

type PackageManifest = {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

type OrgGraphResult = {
  edges: OrgCrossRepoEdge[];
  apiConsumers: OrgApiConsumer[];
  apiContracts: Array<{
    repo: string;
    filePath: string;
    contract: string;
    evidence: EvidenceRef[];
    confidence: number;
  }>;
};

function stableId(parts: string[]): string {
  return crypto.createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 32);
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

function readPackageManifest(repoPath: string): PackageManifest | undefined {
  const packagePath = path.join(repoPath, "package.json");
  if (!fs.existsSync(packagePath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(packagePath, "utf8")) as PackageManifest;
  } catch {
    return undefined;
  }
}

function repoPackageNames(config: AnchorOrgConfig, baseDir?: string): Map<string, string[]> {
  const names = new Map<string, string[]>();
  for (const repo of config.repos) {
    const manifest = readPackageManifest(orgRepoLocalPath(config.org, repo, baseDir));
    names.set(
      repo.fullName,
      uniqueStrings(
        [manifest?.name, repo.alias, repo.fullName.split("/")[1]].filter(Boolean) as string[],
      ),
    );
  }
  return names;
}

function dependenciesFor(manifest: PackageManifest | undefined): string[] {
  if (!manifest) return [];
  return uniqueStrings([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function extractContracts(text: string): string[] {
  const contracts: string[] = [];
  const routeMatches = text.matchAll(/["'`]((?:\/api)?\/[A-Za-z0-9_./:{}-]{2,})["'`]/g);
  for (const match of routeMatches) {
    const route = match[1];
    if (route && route.length <= 120 && !route.includes(" ")) contracts.push(route);
  }
  const gqlMatches = text.matchAll(/\b(query|mutation)\s+([A-Za-z0-9_]+)/g);
  for (const match of gqlMatches) {
    const operation = match[2];
    if (operation) contracts.push(operation);
  }
  return uniqueStrings(contracts).slice(0, 20);
}

function isApiProviderPath(filePath: string): boolean {
  const normalized = filePath.toLowerCase();
  return /(^|\/)(api|apis|routes?|controllers?|schemas?|dto|graphql|openapi|proto)(\/|\.|-|_)/.test(
    normalized,
  );
}

function isApiConsumerText(text: string): boolean {
  return /\b(fetch|axios|ky|graphql|gql|client|sdk|request)\b/i.test(text);
}

function evidenceJson(evidence: EvidenceRef[]): string {
  return JSON.stringify(evidence);
}

export function rebuildOrgGraph(
  db: AnchorDatabase,
  config: AnchorOrgConfig,
  baseDir?: string,
): OrgGraphResult {
  initializeSchema(db);
  const packageNames = repoPackageNames(config, baseDir);
  const enabledRepos = config.repos.filter((repo) => repo.enabled);
  const repoByName = new Map(enabledRepos.map((repo) => [repo.fullName, repo]));
  const packageToRepo = new Map<string, string>();
  for (const [repo, names] of packageNames.entries()) {
    for (const name of names) packageToRepo.set(name, repo);
  }

  const edges: OrgCrossRepoEdge[] = [];
  const addEdge = (edge: OrgCrossRepoEdge): void => {
    if (edge.sourceRepo === edge.targetRepo) return;
    const key = [
      edge.sourceRepo,
      edge.sourcePath,
      edge.targetRepo,
      edge.targetPath ?? "",
      edge.relationship,
    ].join("\0");
    if (
      edges.some(
        (existing) =>
          [
            existing.sourceRepo,
            existing.sourcePath,
            existing.targetRepo,
            existing.targetPath ?? "",
            existing.relationship,
          ].join("\0") === key,
      )
    ) {
      return;
    }
    edges.push(edge);
  };

  for (const repo of enabledRepos) {
    const manifest = readPackageManifest(orgRepoLocalPath(config.org, repo, baseDir));
    for (const dependency of dependenciesFor(manifest)) {
      const targetRepo = packageToRepo.get(dependency);
      if (!targetRepo || targetRepo === repo.fullName) continue;
      addEdge({
        org: config.org,
        sourceRepo: repo.fullName,
        sourcePath: "package.json",
        targetRepo,
        relationship: "depends_on_package",
        evidence: [fileEvidence(repo.fullName, "package.json", `depends on ${dependency}`)],
        confidence: 0.9,
      });
    }
  }

  const imports = db
    .prepare(
      `SELECT r.full_name AS repo, ci.source_path, ci.specifier, ci.imported_path, ci.imported_symbols_json
       FROM code_imports ci
       JOIN repositories r ON r.id = ci.repo_id`,
    )
    .all() as ImportRow[];
  for (const item of imports) {
    const sourceRepo = repoByName.get(item.repo);
    if (!sourceRepo) continue;
    for (const [targetRepo, names] of packageNames.entries()) {
      if (targetRepo === item.repo) continue;
      const matchedName = names.find(
        (name) => item.specifier === name || item.specifier.startsWith(`${name}/`),
      );
      if (!matchedName) continue;
      addEdge({
        org: config.org,
        sourceRepo: item.repo,
        sourcePath: item.source_path,
        targetRepo,
        targetPath: item.imported_path ?? undefined,
        relationship: "imports",
        evidence: [
          fileEvidence(
            item.repo,
            item.source_path,
            `imports ${sanitizeHistoricalText(matchedName)}`,
          ),
        ],
        confidence: parseJsonArray(item.imported_symbols_json).length > 0 ? 0.88 : 0.76,
      });
    }
  }

  const chunks = db
    .prepare(
      `SELECT r.full_name AS repo, cc.file_path, cc.sanitized_text, cc.symbols_json
       FROM code_chunks cc
       JOIN repositories r ON r.id = cc.repo_id`,
    )
    .all() as ChunkRow[];
  const apiContracts = chunks
    .filter((chunk) => repoByName.has(chunk.repo) && isApiProviderPath(chunk.file_path))
    .flatMap((chunk) =>
      extractContracts(chunk.sanitized_text).map((contract) => ({
        repo: chunk.repo,
        filePath: chunk.file_path,
        contract,
        evidence: [fileEvidence(chunk.repo, chunk.file_path, `defines ${contract}`)],
        confidence: 0.74,
      })),
    );

  const apiConsumers: OrgApiConsumer[] = [];
  for (const contract of apiContracts) {
    for (const chunk of chunks) {
      if (chunk.repo === contract.repo || !repoByName.has(chunk.repo)) continue;
      if (!isApiConsumerText(chunk.sanitized_text)) continue;
      if (!chunk.sanitized_text.includes(contract.contract)) continue;
      const consumer: OrgApiConsumer = {
        org: config.org,
        providerRepo: contract.repo,
        providerPath: contract.filePath,
        consumerRepo: chunk.repo,
        consumerPath: chunk.file_path,
        contract: contract.contract,
        evidence: [
          ...contract.evidence,
          fileEvidence(chunk.repo, chunk.file_path, `consumes ${contract.contract}`),
        ],
        confidence: 0.86,
      };
      apiConsumers.push(consumer);
      addEdge({
        org: config.org,
        sourceRepo: chunk.repo,
        sourcePath: chunk.file_path,
        targetRepo: contract.repo,
        targetPath: contract.filePath,
        relationship: "api_consumer",
        evidence: consumer.evidence,
        confidence: consumer.confidence,
      });
    }
  }

  const now = new Date().toISOString();
  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM org_cross_repo_edges WHERE org = ?").run(config.org);
    db.prepare("DELETE FROM org_api_contracts WHERE org = ?").run(config.org);
    db.prepare("DELETE FROM org_api_consumers WHERE org = ?").run(config.org);
    const insertEdge = db.prepare(
      `INSERT INTO org_cross_repo_edges
       (id, org, source_repo, source_path, target_repo, target_path, relationship, evidence_json, confidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const edge of edges) {
      insertEdge.run(
        `oge_${stableId([edge.org, edge.sourceRepo, edge.sourcePath, edge.targetRepo, edge.targetPath ?? "", edge.relationship])}`,
        edge.org,
        edge.sourceRepo,
        edge.sourcePath,
        edge.targetRepo,
        edge.targetPath ?? null,
        edge.relationship,
        evidenceJson(edge.evidence),
        edge.confidence,
        now,
      );
    }
    const insertContract = db.prepare(
      `INSERT INTO org_api_contracts
       (id, org, repo, file_path, contract, evidence_json, confidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const contract of apiContracts) {
      insertContract.run(
        `oac_${stableId([config.org, contract.repo, contract.filePath, contract.contract])}`,
        config.org,
        contract.repo,
        contract.filePath,
        sanitizeHistoricalText(contract.contract),
        evidenceJson(contract.evidence),
        contract.confidence,
        now,
      );
    }
    const insertConsumer = db.prepare(
      `INSERT INTO org_api_consumers
       (id, org, provider_repo, provider_path, consumer_repo, consumer_path, contract, evidence_json, confidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const consumer of apiConsumers) {
      insertConsumer.run(
        `oap_${stableId([
          consumer.org,
          consumer.providerRepo,
          consumer.providerPath ?? "",
          consumer.consumerRepo,
          consumer.consumerPath,
          consumer.contract,
        ])}`,
        consumer.org,
        consumer.providerRepo,
        consumer.providerPath ?? null,
        consumer.consumerRepo,
        consumer.consumerPath,
        sanitizeHistoricalText(consumer.contract),
        evidenceJson(consumer.evidence),
        consumer.confidence,
        now,
      );
    }
  });
  transaction();

  return {
    edges,
    apiConsumers,
    apiContracts,
  };
}
