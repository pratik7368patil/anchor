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
  OrgEdgeConfidenceBucket,
  OrgGraphLayer,
  OrgGraphProgress,
  OrgGraphQualityStats,
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
type ContractKind = "route" | "graphql" | "schema";
type ContractToken = {
  raw: string;
  normalized: string;
  kind: ContractKind;
  symbols: string[];
};
type ApiContract = {
  repo: string;
  filePath: string;
  contract: string;
  normalizedContract: string;
  kind: ContractKind;
  symbols: string[];
  evidence: EvidenceRef[];
  confidence: number;
};
type EdgeDraft = Omit<OrgCrossRepoEdge, "evidenceCount" | "weak" | "layer"> & {
  layer?: OrgGraphLayer;
};
type UpsertEdgeResult = { inserted: boolean; updated: boolean };

const MIN_FILE_EDGE_CONFIDENCE = 0.62;
const MIN_REPO_EDGE_CONFIDENCE = 0.7;
const MIN_VISIBLE_EVIDENCE = 2;
const MIN_API_CONSUMER_CONFIDENCE = 0.68;
const MAX_EDGE_EVIDENCE = 8;
const MAX_EDGE_REASONS = 6;
const MAX_CONTRACTS_PER_CHUNK = 24;
const CONTRACT_IGNORE = new Set([
  "api",
  "v1",
  "v2",
  "v3",
  "graphql",
  "query",
  "mutation",
  "subscription",
  "schema",
  "route",
  "routes",
  "controller",
  "client",
  "request",
]);
const DEFAULT_EDGE_DISTRIBUTION: Record<OrgEdgeConfidenceBucket, number> = {
  strong: 0,
  moderate: 0,
  weak: 0,
};

export type OrgGraphResult = {
  edges: OrgCrossRepoEdge[];
  repoEdges: OrgCrossRepoEdge[];
  fileEdges: OrgCrossRepoEdge[];
  hiddenFileEdges: OrgCrossRepoEdge[];
  hiddenRepoEdges: OrgCrossRepoEdge[];
  apiConsumers: OrgApiConsumer[];
  apiContracts: Array<{
    repo: string;
    filePath: string;
    contract: string;
    evidence: EvidenceRef[];
    confidence: number;
  }>;
  quality: OrgGraphQualityStats;
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

function evidenceJson(evidence: EvidenceRef[]): string {
  return JSON.stringify(evidence);
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

function packageRootForSpecifier(specifier: string): string {
  const normalized = specifier.trim();
  if (!normalized) return "";
  const parts = normalized.split("/");
  if (normalized.startsWith("@") && parts.length >= 2) return `${parts[0]}/${parts[1]}`;
  return parts[0] ?? "";
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

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[{}()[\],:"'`]/g, "")
    .replace(/\/+/g, "/")
    .replace(/\/$/g, "")
    .replace(/^-+/g, "")
    .trim();
}

function splitTokenSymbols(value: string): string[] {
  return value
    .split(/[^A-Za-z0-9_/-]+/)
    .map((item) => normalizeToken(item))
    .filter((item) => item.length >= 3 && !CONTRACT_IGNORE.has(item))
    .slice(0, 12);
}

function normalizeContract(contract: string, kind: ContractKind): string {
  if (kind === "route") {
    const normalized = normalizeToken(contract);
    return normalized.startsWith("/") ? normalized : `/${normalized}`;
  }
  return normalizeToken(contract);
}

function isGenericRoute(route: string): boolean {
  const normalized = normalizeToken(route);
  if (!normalized.startsWith("/")) return true;
  const segments = normalized
    .split("/")
    .filter((segment) => segment && !segment.startsWith(":") && segment !== "*");
  if (segments.length === 0) return true;
  const informative = segments.filter((segment) => !CONTRACT_IGNORE.has(segment));
  return informative.length < 1;
}

function extractContracts(text: string): ContractToken[] {
  const tokens: ContractToken[] = [];
  const seen = new Set<string>();

  const pushToken = (rawValue: string, kind: ContractKind): void => {
    const sanitized = sanitizeHistoricalText(rawValue).slice(0, 180);
    if (!sanitized) return;
    const normalized = normalizeContract(sanitized, kind);
    if (!normalized || CONTRACT_IGNORE.has(normalized)) return;
    if (kind === "route" && isGenericRoute(normalized)) return;
    const key = `${kind}\0${normalized}`;
    if (seen.has(key)) return;
    seen.add(key);
    tokens.push({
      raw: sanitized,
      normalized,
      kind,
      symbols: splitTokenSymbols(sanitized),
    });
  };

  const routeMatches = text.matchAll(/["'`]((?:\/api)?\/[A-Za-z0-9_./:{}-]{3,})["'`]/g);
  for (const match of routeMatches) pushToken(match[1] ?? "", "route");

  const gqlMatches = text.matchAll(/\b(query|mutation|subscription)\s+([A-Za-z][A-Za-z0-9_]{2,})/g);
  for (const match of gqlMatches) pushToken(match[2] ?? "", "graphql");

  const schemaMatches = text.matchAll(/\b(?:type|interface|enum|input)\s+([A-Z][A-Za-z0-9_]{2,})\b/g);
  for (const match of schemaMatches) pushToken(match[1] ?? "", "schema");

  return tokens.slice(0, MAX_CONTRACTS_PER_CHUNK);
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

function clampConfidence(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(0.99, Number(value.toFixed(3))));
}

function confidenceBucket(confidence: number): OrgEdgeConfidenceBucket {
  if (confidence >= 0.82) return "strong";
  if (confidence >= 0.68) return "moderate";
  return "weak";
}

function uniqueEvidenceRefs(evidence: EvidenceRef[]): EvidenceRef[] {
  const map = new Map<string, EvidenceRef>();
  for (const item of evidence) {
    const key = `${item.prNumber}|${item.prUrl}|${item.sourceType}|${item.filePath ?? ""}|${item.note ?? ""}`;
    if (!map.has(key)) map.set(key, item);
  }
  return [...map.values()].slice(0, MAX_EDGE_EVIDENCE);
}

function mergeReasons(a: string[], b: string[]): string[] {
  return uniqueStrings([...a, ...b]).slice(0, MAX_EDGE_REASONS);
}

function updateWeakFlag(edge: OrgCrossRepoEdge, minConfidence: number, minEvidence: number): void {
  edge.evidence = uniqueEvidenceRefs(edge.evidence);
  edge.evidenceCount = edge.evidence.length;
  edge.confidence = clampConfidence(edge.confidence);
  edge.weak = edge.confidence < minConfidence || edge.evidenceCount < minEvidence;
}

function fileEdgeKey(edge: Pick<OrgCrossRepoEdge, "sourceRepo" | "sourcePath" | "targetRepo" | "targetPath" | "relationship" | "layer">): string {
  return [
    edge.layer,
    edge.sourceRepo,
    edge.sourcePath,
    edge.targetRepo,
    edge.targetPath ?? "",
    edge.relationship,
  ].join("\0");
}

function repoEdgeKey(edge: Pick<OrgCrossRepoEdge, "sourceRepo" | "targetRepo" | "relationship" | "layer">): string {
  return [edge.layer, edge.sourceRepo, edge.targetRepo, edge.relationship].join("\0");
}

function upsertEdge(
  map: Map<string, OrgCrossRepoEdge>,
  edge: EdgeDraft,
  minConfidence: number,
  minEvidence: number,
): UpsertEdgeResult {
  const layer = edge.layer ?? "file";
  if (edge.sourceRepo === edge.targetRepo) return { inserted: false, updated: false };
  const key =
    layer === "repo"
      ? repoEdgeKey({ ...edge, layer })
      : fileEdgeKey({ ...edge, layer });
  const existing = map.get(key);
  if (!existing) {
    const created: OrgCrossRepoEdge = {
      ...edge,
      layer,
      evidence: uniqueEvidenceRefs(edge.evidence),
      matchReasons: mergeReasons([], edge.matchReasons),
      evidenceCount: 0,
      weak: false,
    };
    updateWeakFlag(created, minConfidence, minEvidence);
    map.set(key, created);
    return { inserted: true, updated: false };
  }
  const merged: OrgCrossRepoEdge = {
    ...existing,
    sourcePath: existing.layer === "repo" ? "*" : existing.sourcePath,
    targetPath: existing.layer === "repo" ? undefined : (existing.targetPath ?? edge.targetPath),
    evidence: uniqueEvidenceRefs([...existing.evidence, ...edge.evidence]),
    matchReasons: mergeReasons(existing.matchReasons, edge.matchReasons),
    confidence: Math.max(existing.confidence, edge.confidence),
    evidenceCount: 0,
    weak: false,
  };
  updateWeakFlag(merged, minConfidence, minEvidence);
  map.set(key, merged);
  return { inserted: false, updated: true };
}

function scorePackageDependency(dependency: string): { confidence: number; reasons: string[] } {
  const normalized = sanitizeHistoricalText(dependency);
  const reasons = ["exact_package_dependency"];
  const confidence = normalized.startsWith("@") ? 0.93 : 0.9;
  return { confidence, reasons };
}

function scoreImportEdge(input: {
  specifier: string;
  importedPath?: string | null;
  importedSymbols: string[];
}): { confidence: number; reasons: string[] } {
  let score = 0.58;
  const reasons = ["cross_repo_import"];
  if (input.specifier.includes("/")) {
    score += 0.12;
    reasons.push("qualified_specifier");
  }
  if (input.importedPath) {
    score += 0.16;
    reasons.push("resolved_import_path");
  }
  if (input.importedSymbols.length > 0) {
    score += 0.11;
    reasons.push("explicit_import_symbols");
  }
  return { confidence: clampConfidence(score), reasons };
}

function scoreContract(input: { token: ContractToken; filePath: string }): number {
  let score = 0.66;
  if (input.token.kind === "route") score += 0.08;
  if (input.token.kind === "graphql") score += 0.06;
  if (input.token.kind === "schema") score += 0.03;
  if (/\b(route|controller|api|schema|client)\b/i.test(input.filePath)) score += 0.05;
  if (input.token.symbols.length > 0) score += 0.04;
  return clampConfidence(score);
}

function overlapScore(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const set = new Set(a);
  let overlaps = 0;
  for (const value of b) {
    if (set.has(value)) overlaps += 1;
  }
  return overlaps / Math.max(1, Math.min(a.length, b.length));
}

function scoreConsumerMatch(input: {
  consumerToken: ContractToken;
  contract: ApiContract;
  chunkSymbols: string[];
}): { confidence: number; reasons: string[] } {
  let score = 0.58;
  const reasons = ["matched_contract_token"];
  if (input.consumerToken.kind === input.contract.kind) {
    score += 0.12;
    reasons.push("matching_contract_kind");
  }
  const symbolOverlap = overlapScore(
    uniqueStrings([...input.contract.symbols, ...splitTokenSymbols(input.contract.contract)]),
    uniqueStrings([...input.chunkSymbols, ...input.consumerToken.symbols]),
  );
  if (symbolOverlap > 0) {
    score += Math.min(0.2, symbolOverlap * 0.22);
    reasons.push("symbol_overlap");
  }
  if (input.contract.kind === "route" && input.consumerToken.raw.includes("/")) {
    score += 0.08;
    reasons.push("route_literal_match");
  }
  return { confidence: clampConfidence(score), reasons };
}

function aggregateRepoEdges(fileEdges: OrgCrossRepoEdge[]): OrgCrossRepoEdge[] {
  const grouped = new Map<string, OrgCrossRepoEdge[]>();
  for (const edge of fileEdges) {
    const key = repoEdgeKey({
      layer: "repo",
      sourceRepo: edge.sourceRepo,
      targetRepo: edge.targetRepo,
      relationship: edge.relationship,
    });
    const bucket = grouped.get(key) ?? [];
    bucket.push(edge);
    grouped.set(key, bucket);
  }

  const repoEdges: OrgCrossRepoEdge[] = [];
  for (const [key, group] of grouped.entries()) {
    const [layerValue = "repo", sourceRepo = "", targetRepo = ""] = key.split("\0");
    const relationship = group[0]?.relationship ?? "imports";
    const confidences = group.map((edge) => edge.confidence);
    const maxConfidence = Math.max(...confidences);
    const avgConfidence = confidences.reduce((sum, value) => sum + value, 0) / confidences.length;
    const repetitionBoost = Math.min(0.18, Math.log2(group.length + 1) * 0.06);
    const confidence = clampConfidence(maxConfidence * 0.6 + avgConfidence * 0.25 + repetitionBoost);
    const evidence = uniqueEvidenceRefs(group.flatMap((edge) => edge.evidence));
    const matchReasons = mergeReasons([], group.flatMap((edge) => edge.matchReasons));
    const repoEdge: OrgCrossRepoEdge = {
      org: group[0]?.org ?? "",
      sourceRepo,
      sourcePath: "*",
      targetRepo,
      targetPath: undefined,
      layer: layerValue as OrgGraphLayer,
      relationship,
      evidence,
      matchReasons,
      evidenceCount: 0,
      weak: false,
      confidence,
    };
    updateWeakFlag(repoEdge, MIN_REPO_EDGE_CONFIDENCE, MIN_VISIBLE_EVIDENCE);
    repoEdges.push(repoEdge);
  }
  return repoEdges.sort((a, b) => b.confidence - a.confidence);
}

function buildQuality(
  repoEdges: OrgCrossRepoEdge[],
  hiddenRepoEdges: OrgCrossRepoEdge[],
): OrgGraphQualityStats {
  const distribution = { ...DEFAULT_EDGE_DISTRIBUTION };
  for (const edge of repoEdges) {
    distribution[confidenceBucket(edge.confidence)] += 1;
  }
  return {
    edgeConfidenceDistribution: distribution,
    weakEdgesFiltered: hiddenRepoEdges.length,
    minVisibleConfidence: MIN_REPO_EDGE_CONFIDENCE,
    minVisibleEvidence: MIN_VISIBLE_EVIDENCE,
  };
}

function isVisibleRepoEdge(edge: OrgCrossRepoEdge): boolean {
  return !edge.weak && edge.confidence >= MIN_REPO_EDGE_CONFIDENCE && edge.evidenceCount >= MIN_VISIBLE_EVIDENCE;
}

export function rebuildOrgGraph(
  db: AnchorDatabase,
  config: AnchorOrgConfig,
  baseDirOrOptions?: string | RebuildOrgGraphOptions,
): OrgGraphResult {
  initializeSchema(db);
  const options = resolveOptions(baseDirOrOptions);
  const startedAt = Date.now();

  try {
    const enabledRepos = config.repos.filter((repo) => repo.enabled);
    const repoByName = new Map(enabledRepos.map((repo) => [repo.fullName, repo]));
    options.onProgress?.({
      stage: "loading_package_manifests",
      org: config.org,
      totalRepos: enabledRepos.length,
    });

    const packageNames = repoPackageNames(config, options.baseDir);
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

    const fileEdgeMap = new Map<string, OrgCrossRepoEdge>();
    const addFileEdge = (edge: EdgeDraft): void => {
      upsertEdge(fileEdgeMap, { ...edge, layer: "file" }, MIN_FILE_EDGE_CONFIDENCE, 1);
    };

    enabledRepos.forEach((repo, index) => {
      const manifest = readPackageManifest(orgRepoLocalPath(config.org, repo, options.baseDir));
      for (const dependency of dependenciesFor(manifest)) {
        const targetRepo = packageToRepo.get(dependency);
        if (!targetRepo || targetRepo === repo.fullName) continue;
        const score = scorePackageDependency(dependency);
        addFileEdge({
          org: config.org,
          sourceRepo: repo.fullName,
          sourcePath: "package.json",
          targetRepo,
          targetPath: "package.json",
          relationship: "depends_on_package",
          evidence: [
            fileEvidence(
              repo.fullName,
              "package.json",
              `depends on ${sanitizeHistoricalText(dependency)}`,
            ),
          ],
          matchReasons: score.reasons,
          confidence: score.confidence,
        });
      }
      options.onProgress?.({
        stage: "building_package_edges",
        org: config.org,
        current: index + 1,
        total: enabledRepos.length,
        repo: repo.fullName,
        edges: fileEdgeMap.size,
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

    imports.forEach((item, index) => {
      const sourceRepo = repoByName.get(item.repo);
      if (!sourceRepo) return;
      const rootSpecifier = packageRootForSpecifier(item.specifier);
      const targetRepo = packageToRepo.get(rootSpecifier) ?? packageToRepo.get(item.specifier);
      if (targetRepo && targetRepo !== item.repo) {
        const importedSymbols = parseJsonArray(item.imported_symbols_json);
        const score = scoreImportEdge({
          specifier: item.specifier,
          importedPath: item.imported_path,
          importedSymbols,
        });
        addFileEdge({
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
              `imports ${sanitizeHistoricalText(rootSpecifier || item.specifier)}`,
            ),
          ],
          matchReasons: score.reasons,
          confidence: score.confidence,
        });
      }
      if (shouldEmitProgress(index + 1, imports.length)) {
        options.onProgress?.({
          stage: "building_import_edges",
          org: config.org,
          current: index + 1,
          total: imports.length,
          sourcePath: item.source_path,
          edges: fileEdgeMap.size,
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
    const contractByKey = new Map<string, ApiContract>();
    const contractsByToken = new Map<string, ApiContract[]>();

    providerChunks.forEach((chunk, index) => {
      for (const token of extractContracts(chunk.sanitized_text)) {
        const key = [chunk.repo, chunk.file_path, token.kind, token.normalized].join("\0");
        if (contractByKey.has(key)) continue;
        const contract: ApiContract = {
          repo: chunk.repo,
          filePath: chunk.file_path,
          contract: token.raw,
          normalizedContract: token.normalized,
          kind: token.kind,
          symbols: token.symbols,
          evidence: [fileEvidence(chunk.repo, chunk.file_path, `defines ${token.raw}`)],
          confidence: scoreContract({ token, filePath: chunk.file_path }),
        };
        contractByKey.set(key, contract);
        apiContracts.push(contract);
        const bucket = contractsByToken.get(contract.normalizedContract) ?? [];
        bucket.push(contract);
        contractsByToken.set(contract.normalizedContract, bucket);
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

    const consumerChunks = chunks.filter(
      (chunk) => repoByName.has(chunk.repo) && isApiConsumerText(chunk.sanitized_text),
    );
    const apiConsumers: OrgApiConsumer[] = [];
    const consumerKeySet = new Set<string>();
    consumerChunks.forEach((chunk, index) => {
      const chunkTokens = extractContracts(chunk.sanitized_text);
      const chunkSymbols = parseJsonArray(chunk.symbols_json);
      let matchesForChunk = 0;
      for (const consumerToken of chunkTokens) {
        const contracts = contractsByToken.get(consumerToken.normalized);
        if (!contracts?.length) continue;
        for (const contract of contracts) {
          if (chunk.repo === contract.repo) continue;
          const score = scoreConsumerMatch({
            consumerToken,
            contract,
            chunkSymbols,
          });
          if (score.confidence < MIN_API_CONSUMER_CONFIDENCE) continue;
          const consumerKey = [
            contract.repo,
            contract.filePath,
            chunk.repo,
            chunk.file_path,
            contract.normalizedContract,
          ].join("\0");
          if (consumerKeySet.has(consumerKey)) continue;
          consumerKeySet.add(consumerKey);
          const evidence = uniqueEvidenceRefs([
            ...contract.evidence,
            fileEvidence(chunk.repo, chunk.file_path, `consumes ${contract.contract}`),
          ]);
          const consumer: OrgApiConsumer = {
            org: config.org,
            providerRepo: contract.repo,
            providerPath: contract.filePath,
            consumerRepo: chunk.repo,
            consumerPath: chunk.file_path,
            contract: contract.contract,
            evidence,
            matchReasons: mergeReasons([], score.reasons),
            evidenceCount: evidence.length,
            weak:
              score.confidence < MIN_API_CONSUMER_CONFIDENCE || evidence.length < MIN_VISIBLE_EVIDENCE,
            confidence: score.confidence,
          };
          apiConsumers.push(consumer);
          matchesForChunk += 1;
          addFileEdge({
            org: config.org,
            sourceRepo: chunk.repo,
            sourcePath: chunk.file_path,
            targetRepo: contract.repo,
            targetPath: contract.filePath,
            relationship: "api_consumer",
            evidence,
            matchReasons: score.reasons,
            confidence: score.confidence,
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
          matches: matchesForChunk,
        });
      }
    });

    const allFileEdges = [...fileEdgeMap.values()].sort((a, b) => b.confidence - a.confidence);
    const repoEdges = aggregateRepoEdges(allFileEdges);
    const visibleRepoEdges = repoEdges.filter(isVisibleRepoEdge);
    const hiddenRepoEdges = repoEdges.filter((edge) => !isVisibleRepoEdge(edge));
    const hiddenFileEdges = allFileEdges.filter(
      (edge) => edge.confidence < MIN_FILE_EDGE_CONFIDENCE || edge.evidenceCount < 1,
    );
    const visibleFileEdges = allFileEdges.filter((edge) => !hiddenFileEdges.includes(edge));
    const quality = buildQuality(visibleRepoEdges, hiddenRepoEdges);

    options.onProgress?.({
      stage: "writing_org_graph",
      org: config.org,
      edges: repoEdges.length,
      apiContracts: apiContracts.length,
      apiConsumers: apiConsumers.length,
    });

    const now = new Date().toISOString();
    const renderPrepStartedAt = Date.now();
    const transaction = db.transaction(() => {
      db.prepare("DELETE FROM org_cross_repo_edges WHERE org = ?").run(config.org);
      db.prepare("DELETE FROM org_api_contracts WHERE org = ?").run(config.org);
      db.prepare("DELETE FROM org_api_consumers WHERE org = ?").run(config.org);

      const insertEdge = db.prepare(
        `INSERT INTO org_cross_repo_edges
         (id, org, source_repo, source_path, target_repo, target_path, layer, relationship,
          evidence_json, match_reasons_json, evidence_count, is_weak, confidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           source_path = excluded.source_path,
           target_path = excluded.target_path,
           layer = excluded.layer,
           evidence_json = excluded.evidence_json,
           match_reasons_json = excluded.match_reasons_json,
           evidence_count = excluded.evidence_count,
           is_weak = excluded.is_weak,
           confidence = excluded.confidence,
           created_at = excluded.created_at`,
      );
      const persistEdge = (edge: OrgCrossRepoEdge): void => {
        insertEdge.run(
          `oge_${stableId([
            edge.org,
            edge.layer,
            edge.sourceRepo,
            edge.sourcePath,
            edge.targetRepo,
            edge.targetPath ?? "",
            edge.relationship,
          ])}`,
          edge.org,
          edge.sourceRepo,
          edge.sourcePath,
          edge.targetRepo,
          edge.targetPath ?? null,
          edge.layer,
          edge.relationship,
          evidenceJson(edge.evidence),
          JSON.stringify(edge.matchReasons),
          edge.evidenceCount,
          edge.weak ? 1 : 0,
          edge.confidence,
          now,
        );
      };

      const persistedEdges = [...repoEdges, ...allFileEdges];
      for (const [index, edge] of persistedEdges.entries()) {
        persistEdge(edge);
        const current = index + 1;
        if (shouldEmitProgress(current, persistedEdges.length, 500)) {
          options.onProgress?.({
            stage: "writing_org_graph",
            org: config.org,
            edges: current,
            apiContracts: apiContracts.length,
            apiConsumers: apiConsumers.length,
            current,
            total: persistedEdges.length,
            kind: "edges",
          });
        }
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
      for (const [index, contract] of apiContracts.entries()) {
        insertContract.run(
          `oac_${stableId([config.org, contract.repo, contract.filePath, contract.normalizedContract])}`,
          config.org,
          contract.repo,
          contract.filePath,
          sanitizeHistoricalText(contract.contract),
          evidenceJson(contract.evidence),
          contract.confidence,
          now,
        );
        const current = index + 1;
        if (shouldEmitProgress(current, apiContracts.length, 500)) {
          options.onProgress?.({
            stage: "writing_org_graph",
            org: config.org,
            edges: persistedEdges.length,
            apiContracts: current,
            apiConsumers: apiConsumers.length,
            current,
            total: apiContracts.length,
            kind: "contracts",
          });
        }
      }

      const insertConsumer = db.prepare(
        `INSERT INTO org_api_consumers
         (id, org, provider_repo, provider_path, consumer_repo, consumer_path, contract, evidence_json,
          match_reasons_json, evidence_count, is_weak, confidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           contract = excluded.contract,
           evidence_json = excluded.evidence_json,
           match_reasons_json = excluded.match_reasons_json,
           evidence_count = excluded.evidence_count,
           is_weak = excluded.is_weak,
           confidence = excluded.confidence,
           created_at = excluded.created_at`,
      );
      for (const [index, consumer] of apiConsumers.entries()) {
        insertConsumer.run(
          `oap_${stableId([
            consumer.org,
            consumer.providerRepo,
            consumer.providerPath ?? "",
            consumer.consumerRepo,
            consumer.consumerPath,
            normalizeToken(consumer.contract),
          ])}`,
          consumer.org,
          consumer.providerRepo,
          consumer.providerPath ?? null,
          consumer.consumerRepo,
          consumer.consumerPath,
          sanitizeHistoricalText(consumer.contract),
          evidenceJson(consumer.evidence),
          JSON.stringify(consumer.matchReasons),
          consumer.evidenceCount,
          consumer.weak ? 1 : 0,
          consumer.confidence,
          now,
        );
        const current = index + 1;
        if (shouldEmitProgress(current, apiConsumers.length, 500)) {
          options.onProgress?.({
            stage: "writing_org_graph",
            org: config.org,
            edges: persistedEdges.length,
            apiContracts: apiContracts.length,
            apiConsumers: current,
            current,
            total: apiConsumers.length,
            kind: "consumers",
          });
        }
      }
    });
    transaction();
    const renderPrepMs = Date.now() - renderPrepStartedAt;

    const durationMs = Date.now() - startedAt;
    const finishedAt = new Date().toISOString();
    recordOrgGraphState(db, {
      org: config.org,
      status: "success",
      builtAt: finishedAt,
      durationMs,
      edgeCount: repoEdges.length,
      visibleEdgeCount: visibleRepoEdges.length,
      weakEdgeCount: hiddenRepoEdges.length,
      edgeConfidenceDistribution: quality.edgeConfidenceDistribution,
      lastRenderPrepMs: renderPrepMs,
      apiContractCount: apiContracts.length,
      apiConsumerCount: apiConsumers.length,
    });
    options.onProgress?.({
      stage: "completed_org_graph",
      org: config.org,
      edges: repoEdges.length,
      apiContracts: apiContracts.length,
      apiConsumers: apiConsumers.length,
      durationMs,
    });

    return {
      edges: visibleRepoEdges,
      repoEdges: visibleRepoEdges,
      fileEdges: visibleFileEdges,
      hiddenFileEdges,
      hiddenRepoEdges,
      apiConsumers,
      apiContracts: apiContracts.map((contract) => ({
        repo: contract.repo,
        filePath: contract.filePath,
        contract: contract.contract,
        evidence: contract.evidence,
        confidence: contract.confidence,
      })),
      quality: {
        ...quality,
        lastRenderPrepMs: renderPrepMs,
      },
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
