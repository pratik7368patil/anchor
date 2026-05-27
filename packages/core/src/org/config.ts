import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { AnchorOrgConfig, AnchorOrgRepoConfig, OrgRepoGroup } from "../types.js";

const ORG_REPO_GROUPS = ["backend", "frontend", "shared", "infra", "docs", "unknown"] as const;

const OrgRepoSchema = z.object({
  fullName: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  alias: z.string().min(1),
  group: z.enum(ORG_REPO_GROUPS),
  cloneUrl: z.string().min(1),
  defaultBranch: z.string().min(1),
  enabled: z.boolean(),
});

const OrgConfigSchema = z.object({
  version: z.literal(1),
  org: z.string().regex(/^[A-Za-z0-9_.-]+$/),
  repos: z.array(OrgRepoSchema),
});

export function validateOrgName(org: string): string {
  const trimmed = org.trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(trimmed)) {
    throw new Error("Invalid org name. Use only letters, numbers, dot, underscore, and hyphen.");
  }
  return trimmed;
}

export function validateOrgRepoFullName(fullName: string): string {
  const trimmed = fullName.trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(trimmed)) {
    throw new Error("Invalid repo name. Use owner/name.");
  }
  return trimmed;
}

export function validateOrgRepoGroup(group: string | undefined): OrgRepoGroup {
  if (!group) return "unknown";
  if (ORG_REPO_GROUPS.includes(group as OrgRepoGroup)) return group as OrgRepoGroup;
  throw new Error(`Invalid repo group: ${group}`);
}

export function defaultOrgBaseDir(): string {
  if (process.env.ANCHOR_ORG_HOME) return process.env.ANCHOR_ORG_HOME;
  return path.join(os.homedir(), ".anchor", "orgs");
}

export function orgRoot(org: string, baseDir = defaultOrgBaseDir()): string {
  return path.join(baseDir, validateOrgName(org));
}

export function orgConfigPath(org: string, baseDir = defaultOrgBaseDir()): string {
  return path.join(orgRoot(org, baseDir), "org.json");
}

export function orgDatabasePath(org: string, baseDir = defaultOrgBaseDir()): string {
  return path.join(orgRoot(org, baseDir), "org.sqlite");
}

export function orgReposRoot(org: string, baseDir = defaultOrgBaseDir()): string {
  return path.join(orgRoot(org, baseDir), "repos");
}

export function repoAliasFromFullName(fullName: string): string {
  return validateOrgRepoFullName(fullName).split("/")[1] ?? fullName.replace(/\W+/g, "-");
}

export function defaultOrgCloneUrl(fullName: string): string {
  return `https://github.com/${validateOrgRepoFullName(fullName)}.git`;
}

export function orgRepoLocalPath(
  org: string,
  repo: Pick<AnchorOrgRepoConfig, "alias" | "fullName">,
  baseDir = defaultOrgBaseDir(),
): string {
  const safeAlias =
    repo.alias.replace(/[^A-Za-z0-9_.-]/g, "-") || repoAliasFromFullName(repo.fullName);
  return path.join(orgReposRoot(org, baseDir), safeAlias);
}

function parseOrgConfig(text: string): AnchorOrgConfig {
  const parsed = OrgConfigSchema.parse(JSON.parse(text));
  return parsed;
}

function atomicWriteJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

export function loadOrgConfig(org: string, baseDir = defaultOrgBaseDir()): AnchorOrgConfig {
  const filePath = orgConfigPath(org, baseDir);
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Anchor org config not found at ${filePath}. Run anchor org init --org ${org}.`,
    );
  }
  return parseOrgConfig(fs.readFileSync(filePath, "utf8"));
}

export function maybeLoadOrgConfig(
  org: string,
  baseDir = defaultOrgBaseDir(),
): AnchorOrgConfig | undefined {
  const filePath = orgConfigPath(org, baseDir);
  if (!fs.existsSync(filePath)) return undefined;
  return loadOrgConfig(org, baseDir);
}

export function saveOrgConfig(
  config: AnchorOrgConfig,
  baseDir = defaultOrgBaseDir(),
): AnchorOrgConfig {
  const parsed = OrgConfigSchema.parse(config);
  atomicWriteJson(orgConfigPath(parsed.org, baseDir), parsed);
  return parsed;
}

export function initOrgConfig(org: string, baseDir = defaultOrgBaseDir()): AnchorOrgConfig {
  const normalizedOrg = validateOrgName(org);
  fs.mkdirSync(orgReposRoot(normalizedOrg, baseDir), { recursive: true });
  const existing = maybeLoadOrgConfig(normalizedOrg, baseDir);
  if (existing) return existing;
  return saveOrgConfig({ version: 1, org: normalizedOrg, repos: [] }, baseDir);
}

export function addOrgRepoConfig(
  org: string,
  repoFullName: string,
  input: {
    alias?: string;
    group?: string;
    cloneUrl?: string;
    defaultBranch?: string;
  } = {},
  baseDir = defaultOrgBaseDir(),
): AnchorOrgConfig {
  const config = initOrgConfig(org, baseDir);
  const fullName = validateOrgRepoFullName(repoFullName);
  const existing = config.repos.find((repo) => repo.fullName === fullName);
  const candidate: AnchorOrgRepoConfig = {
    fullName,
    alias: input.alias?.trim() || existing?.alias || repoAliasFromFullName(fullName),
    group: validateOrgRepoGroup(input.group ?? existing?.group),
    cloneUrl: input.cloneUrl?.trim() || existing?.cloneUrl || defaultOrgCloneUrl(fullName),
    defaultBranch: input.defaultBranch?.trim() || existing?.defaultBranch || "main",
    enabled: true,
  };
  const repos = existing
    ? config.repos.map((repo) => (repo.fullName === fullName ? candidate : repo))
    : [...config.repos, candidate];
  return saveOrgConfig(
    { ...config, repos: repos.sort((a, b) => a.fullName.localeCompare(b.fullName)) },
    baseDir,
  );
}

export function removeOrgRepoConfig(
  org: string,
  repoFullName: string,
  baseDir = defaultOrgBaseDir(),
): AnchorOrgConfig {
  const config = loadOrgConfig(org, baseDir);
  const fullName = validateOrgRepoFullName(repoFullName);
  return saveOrgConfig(
    {
      ...config,
      repos: config.repos.map((repo) =>
        repo.fullName === fullName ? { ...repo, enabled: false } : repo,
      ),
    },
    baseDir,
  );
}

export function listOrgNames(baseDir = defaultOrgBaseDir()): string[] {
  if (!fs.existsSync(baseDir)) return [];
  return fs
    .readdirSync(baseDir, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && fs.existsSync(path.join(baseDir, entry.name, "org.json")),
    )
    .map((entry) => entry.name)
    .sort();
}

export function resolveOrgForTool(org?: string, baseDir = defaultOrgBaseDir()): string {
  if (org) return validateOrgName(org);
  const names = listOrgNames(baseDir);
  if (names.length === 1) return names[0] ?? "";
  if (names.length === 0) {
    throw new Error("No Anchor org configured. Run anchor org init --org <org>.");
  }
  throw new Error(`Multiple Anchor orgs configured (${names.join(", ")}). Pass org explicitly.`);
}
