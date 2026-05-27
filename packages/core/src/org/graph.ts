import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AnchorDatabase } from "../db/database.js";
import { initializeSchema } from "../db/database.js";
import { sanitizeHistoricalText } from "../security/sanitize.js";
import type {
  AnchorOrgConfig,
  EvidenceRef,
  OrgApiConsumer,
  OrgCrossRepoEdge,
  OrgGraphProgress,
} from "../types.js";
import { uniqueStrings } from "../utils/text.js";
import { orgRepoLocalPath } from "./config.js";
import { recordOrgGraphState } from "./database.js";

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

export type OrgGraphResult = {
  edges: OrgCrossRepoEdge[];
  apiConsumers: OrgApiConsumer[];
  apiContracts: Array<{
    repo: string;
    filePath: string;
    contract: string;
    evidence: EvidenceRef[];
    confidence: number;
  }>;
  durationMs: number;
};

export type RebuildOrgGraphOptions = {
  baseDir?: string;
  onProgress?: (progress: OrgGraphProgress) => void;
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

function shouldEmitProgress(current: number, total: number, interval = 100): boolean {
  return current === 1 || current === total || current % interval === 0;
}

function resolveOptions(
  baseDirOrOptions?: string | RebuildOrgGraphOptions,
): RebuildOrgGraphOptions {
  return typeof baseDirOrOptions === "string"
    ? { baseDir: baseDirOrOptions }
    : (baseDirOrOptions ?? {});
}

type ApiContract = OrgGraphResult["apiContracts"][number];

export function rebuildOrgGraph(
  db: AnchorDatabase,
  config: AnchorOrgConfig,
  baseDirOrOptions?: string | RebuildOrgGraphOptions,
): OrgGraphResult {
  initializeSchema(db);
  const options = resolveOptions(baseDirOrOptions);
  const startedAt = Date.now();
  try {
    options.onProgress?.({
      stage: "loading_package_manifests",
      org: config.org,
      totalRepos: config.repos.filter((repo) => repo.enabled).length,
    });
    const packageNames = repoPackageNames(config, options.baseDir);
    const enabledRepos = config.repos.filter((repo) => repo.enabled);
    const repoByName = new Map(enabledRepos.map((repo) => [repo.fullName, repo]));
    const packageToRepo = new Map<string, string>();
    for (const [repo, names] of packageNames.entries()) {
      for (const name of names) packageToRepo.set(name, repo);
    }
    options.onProgress?.({
      stage: "loaded_package_manifests",
      org: config.org,
      repos: enabledRepos.length,
      packageNames: packageToRepo.size,
    });

    const edges: OrgCrossRepoEdge[] = [];
    const edgeKeys = new Set<string>();
    const addEdge = (edge: OrgCrossRepoEdge): void => {
      if (edge.sourceRepo === edge.targetRepo) return;
      const key = [
        edge.sourceRepo,
        edge.sourcePath,
        edge.targetRepo,
        edge.targetPath ?? "",
        edge.relationship,
      ].join("\0");
      if (edgeKeys.has(key)) return;
      edgeKeys.add(key);
      edges.push(edge);
    };

    enabledRepos.forEach((repo, index) => {
      const manifest = readPackageManifest(orgRepoLocalPath(config.org, repo, options.baseDir));
      for (const dependency of dependenciesFor(manifest)) {
        const targetRepo = packageToRepo.get(dependency);
        if (!targetRepo || targetRepo === repo.fullName) continue;
        addEdge({
          org: config.org,
          sourceRepo: repo.fullName,
          sourcePath: "package.json",
          targetRepo,
          relationship: "depends_on_package",
          evidence: [
            fileEvidence(
              repo.fullName,
              "package.json",
              `depends on ${sanitizeHistoricalText(dependency)}`,
            ),
          ],
          confidence: 0.9,
        });
      }
      options.onProgress?.({
        stage: "building_package_edges",
        org: config.org,
        current: index + 1,
        total: enabledRepos.length,
        repo: repo.fullName,
        edges: edges.length,
      });
    });

    options.onProgress?.({ stage: "loading_imports", org: config.org });
    const imports = db
      .prepare(
        `SELECT r.full_name AS repo, ci.source_path, ci.specifier, ci.imported_path, ci.imported_symbols_json
         FROM code_imports ci
         JOIN repositories r ON r.id = ci.repo_id`,
      )
      .all() as ImportRow[];
    const packageMatchers = [...packageNames.entries()]
      .flatMap(([repo, names]) => names.map((name) => ({ repo, name })))
      .sort((a, b) => b.name.length - a.name.length);
    imports.forEach((item, index) => {
      const sourceRepo = repoByName.get(item.repo);
      if (!sourceRepo) return;
      for (const candidate of packageMatchers) {
        if (candidate.repo === item.repo) continue;
        const matched =
          item.specifier === candidate.name || item.specifier.startsWith(`${candidate.name}/`);
        if (!matched) continue;
        addEdge({
          org: config.org,
          sourceRepo: item.repo,
          sourcePath: item.source_path,
          targetRepo: candidate.repo,
          targetPath: item.imported_path ?? undefined,
          relationship: "imports",
          evidence: [
            fileEvidence(
              item.repo,
              item.source_path,
              `imports ${sanitizeHistoricalText(candidate.name)}`,
            ),
          ],
          confidence: parseJsonArray(item.imported_symbols_json).length > 0 ? 0.88 : 0.76,
        });
        break;
      }
      if (shouldEmitProgress(index + 1, imports.length)) {
        options.onProgress?.({
          stage: "building_import_edges",
          org: config.org,
          current: index + 1,
          total: imports.length,
          sourcePath: item.source_path,
          edges: edges.length,
        });
      }
    });

    options.onProgress?.({ stage: "loading_code_chunks", org: config.org });
    const chunks = db
      .prepare(
        `SELECT r.full_name AS repo, cc.file_path, cc.sanitized_text, cc.symbols_json
         FROM code_chunks cc
         JOIN repositories r ON r.id = cc.repo_id`,
      )
      .all() as ChunkRow[];

    const providerChunks = chunks.filter(
      (chunk) => repoByName.has(chunk.repo) && isApiProviderPath(chunk.file_path),
    );
    const apiContracts: ApiContract[] = [];
    const contractKeys = new Set<string>();
    const contractsByToken = new Map<string, ApiContract[]>();
    providerChunks.forEach((chunk, index) => {
      for (const contract of extractContracts(chunk.sanitized_text)) {
        const sanitizedContract = sanitizeHistoricalText(contract);
        const key = [chunk.repo, chunk.file_path, sanitizedContract].join("\0");
        if (contractKeys.has(key)) continue;
        contractKeys.add(key);
        const apiContract: ApiContract = {
          repo: chunk.repo,
          filePath: chunk.file_path,
          contract: sanitizedContract,
          evidence: [fileEvidence(chunk.repo, chunk.file_path, `defines ${sanitizedContract}`)],
          confidence: 0.74,
        };
        apiContracts.push(apiContract);
        const bucket = contractsByToken.get(sanitizedContract) ?? [];
        bucket.push(apiContract);
        contractsByToken.set(sanitizedContract, bucket);
      }
      if (shouldEmitProgress(index + 1, providerChunks.length)) {
        options.onProgress?.({
          stage: "extracting_api_contracts",
          org: config.org,
          current: index + 1,
          total: providerChunks.length,
          filePath: chunk.file_path,
          contracts: apiContracts.length,
        });
      }
    });

    const apiConsumers: OrgApiConsumer[] = [];
    const consumerKeys = new Set<string>();
    const consumerChunks = chunks.filter(
      (chunk) => repoByName.has(chunk.repo) && isApiConsumerText(chunk.sanitized_text),
    );
    consumerChunks.forEach((chunk, index) => {
      const consumerTokens = extractContracts(chunk.sanitized_text);
      let chunkMatches = 0;
      for (const token of consumerTokens) {
        const contracts = contractsByToken.get(sanitizeHistoricalText(token));
        if (!contracts) continue;
        for (const contract of contracts) {
          if (chunk.repo === contract.repo) continue;
          const consumerKey = [
            contract.repo,
            contract.filePath,
            chunk.repo,
            chunk.file_path,
            contract.contract,
          ].join("\0");
          if (consumerKeys.has(consumerKey)) continue;
          consumerKeys.add(consumerKey);
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
          chunkMatches += 1;
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
      if (shouldEmitProgress(index + 1, consumerChunks.length)) {
        options.onProgress?.({
          stage: "matching_api_consumers",
          org: config.org,
          current: index + 1,
          total: consumerChunks.length,
          filePath: chunk.file_path,
          matches: chunkMatches,
        });
      }
    });

    options.onProgress?.({
      stage: "writing_org_graph",
      org: config.org,
      edges: edges.length,
      apiContracts: apiContracts.length,
      apiConsumers: apiConsumers.length,
    });
    const now = new Date().toISOString();
    const transaction = db.transaction(() => {
      db.prepare("DELETE FROM org_cross_repo_edges WHERE org = ?").run(config.org);
      db.prepare("DELETE FROM org_api_contracts WHERE org = ?").run(config.org);
      db.prepare("DELETE FROM org_api_consumers WHERE org = ?").run(config.org);
      const insertEdge = db.prepare(
        `INSERT INTO org_cross_repo_edges
         (id, org, source_repo, source_path, target_repo, target_path, relationship, evidence_json, confidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           evidence_json = excluded.evidence_json,
           confidence = excluded.confidence,
           created_at = excluded.created_at`,
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
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           contract = excluded.contract,
           evidence_json = excluded.evidence_json,
           confidence = excluded.confidence,
           created_at = excluded.created_at`,
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
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           contract = excluded.contract,
           evidence_json = excluded.evidence_json,
           confidence = excluded.confidence,
           created_at = excluded.created_at`,
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

    const durationMs = Date.now() - startedAt;
    const finishedAt = new Date().toISOString();
    recordOrgGraphState(db, {
      org: config.org,
      status: "success",
      builtAt: finishedAt,
      durationMs,
      edgeCount: edges.length,
      apiContractCount: apiContracts.length,
      apiConsumerCount: apiConsumers.length,
    });
    options.onProgress?.({
      stage: "completed_org_graph",
      org: config.org,
      edges: edges.length,
      apiContracts: apiContracts.length,
      apiConsumers: apiConsumers.length,
      durationMs,
    });

    return {
      edges,
      apiConsumers,
      apiContracts,
      durationMs,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordOrgGraphState(db, {
      org: config.org,
      status: "failed",
      durationMs: Date.now() - startedAt,
      error: message,
    });
    throw error;
  }
}
