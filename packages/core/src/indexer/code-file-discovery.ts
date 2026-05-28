import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { CodeFileRecord } from "../types.js";

export const DEFAULT_MAX_CODE_FILE_BYTES = 512 * 1024;

export type DiscoveredCodeFile = CodeFileRecord & {
  absolutePath: string;
  content?: string;
};

export type CodeFileDiscoveryResult = {
  files: DiscoveredCodeFile[];
  skippedFiles: number;
};

export type CodeIndexChangePlan = {
  currentCommit?: string;
  trackedPaths: string[];
  changedPaths: string[];
  deletedPaths: string[];
  dirtyWorkingTree: boolean;
  fallbackToFullHashCompare: boolean;
  reason: string;
};

const HARD_EXCLUDED_SEGMENTS = new Set([
  ".git",
  ".anchor",
  ".cursor",
  ".codex",
  ".aws",
  ".ssh",
  "node_modules",
  ".nuxt",
  ".next",
  "dist",
  "build",
  "coverage",
  ".turbo",
]);

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".cjs": "javascript",
  ".css": "css",
  ".go": "go",
  ".html": "html",
  ".java": "java",
  ".js": "javascript",
  ".json": "json",
  ".jsx": "javascript",
  ".md": "markdown",
  ".mjs": "javascript",
  ".py": "python",
  ".rb": "ruby",
  ".rs": "rust",
  ".scss": "scss",
  ".sh": "shell",
  ".sql": "sql",
  ".svelte": "svelte",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".vue": "vue",
  ".yaml": "yaml",
  ".yml": "yaml",
};

function normalizeGitPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

export function isHardExcludedCodePath(filePath: string): boolean {
  const normalized = normalizeGitPath(filePath);
  const segments = normalized.split("/");
  if (segments.some((segment) => HARD_EXCLUDED_SEGMENTS.has(segment))) return true;

  const basename = path.posix.basename(normalized).toLowerCase();
  if ([".netrc", ".npmrc", ".pypirc", ".yarnrc"].includes(basename)) return true;
  if (basename === ".env" || basename.startsWith(".env.")) return true;
  if (
    basename === "id_rsa" ||
    basename === "id_rsa.pub" ||
    basename === "id_dsa" ||
    basename === "id_ecdsa" ||
    basename === "id_ed25519"
  ) {
    return true;
  }
  if (/\.(pem|key|p12|pfx)$/i.test(basename)) return true;
  return false;
}

function languageForPath(filePath: string): string | undefined {
  const extension = path.extname(filePath).toLowerCase();
  return LANGUAGE_BY_EXTENSION[extension];
}

function isProbablyBinary(buffer: Buffer): boolean {
  if (buffer.includes(0)) return true;
  if (buffer.length === 0) return false;

  let suspicious = 0;
  for (const byte of buffer) {
    const isAllowedControl = byte === 9 || byte === 10 || byte === 13;
    if (byte < 32 && !isAllowedControl) suspicious += 1;
  }
  return suspicious / buffer.length > 0.01;
}

function discoverGitFiles(cwd: string): string[] {
  const output = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return output
    .split("\n")
    .map((line) => normalizeGitPath(line.trim()))
    .filter(Boolean);
}

function discoverGitUntrackedFiles(cwd: string): string[] {
  const output = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return output
    .split("\n")
    .map((line) => normalizeGitPath(line.trim()))
    .filter(Boolean);
}

function execGitLines(cwd: string, args: string[]): string[] {
  const output = execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

export function readGitHeadCommit(cwd: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

export function hasDirtyWorkingTree(cwd: string): boolean {
  try {
    const status = execFileSync("git", ["status", "--porcelain"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return status.trim().length > 0;
  } catch {
    return true;
  }
}

function parseNameStatusLine(
  line: string,
): { status: string; previousPath?: string; path?: string } | undefined {
  const parts = line.split("\t").map((item) => normalizeGitPath(item));
  if (parts.length < 2) return undefined;
  const status = parts[0] ?? "";
  if (!status) return undefined;
  if (status.startsWith("R") || status.startsWith("C")) {
    return { status, previousPath: parts[1], path: parts[2] };
  }
  return { status, path: parts[1] };
}

export function planIncrementalCodeIndex(
  cwd: string,
  lastIndexedCommit: string | undefined,
  existingIndexedPaths: Set<string>,
): CodeIndexChangePlan {
  const currentCommit = readGitHeadCommit(cwd);
  const trackedPaths = discoverGitFiles(cwd);
  const trackedSet = new Set(trackedPaths);
  const deletedPaths = new Set<string>();
  const changedPaths = new Set<string>();
  const dirtyWorkingTree = hasDirtyWorkingTree(cwd);

  if (!lastIndexedCommit) {
    return {
      currentCommit,
      trackedPaths,
      changedPaths: trackedPaths,
      deletedPaths: [...existingIndexedPaths].filter((filePath) => !trackedSet.has(filePath)),
      dirtyWorkingTree,
      fallbackToFullHashCompare: true,
      reason: "No previous commit snapshot; using full hash comparison.",
    };
  }

  if (dirtyWorkingTree) {
    return {
      currentCommit,
      trackedPaths,
      changedPaths: trackedPaths,
      deletedPaths: [...existingIndexedPaths].filter((filePath) => !trackedSet.has(filePath)),
      dirtyWorkingTree,
      fallbackToFullHashCompare: true,
      reason: "Working tree is dirty; using full hash comparison for deterministic results.",
    };
  }

  try {
    const lines = execGitLines(cwd, ["diff", "--name-status", `${lastIndexedCommit}..HEAD`]);
    for (const line of lines) {
      const parsed = parseNameStatusLine(line);
      if (!parsed?.path) continue;
      const statusCode = parsed.status[0];
      const normalizedPath = normalizeGitPath(parsed.path);
      if (statusCode === "D") {
        deletedPaths.add(normalizedPath);
        continue;
      }
      if (trackedSet.has(normalizedPath)) changedPaths.add(normalizedPath);
    }
    for (const untrackedPath of discoverGitUntrackedFiles(cwd)) {
      if (trackedSet.has(untrackedPath)) changedPaths.add(untrackedPath);
    }
    for (const existingPath of existingIndexedPaths) {
      if (!trackedSet.has(existingPath)) deletedPaths.add(existingPath);
    }
    return {
      currentCommit,
      trackedPaths,
      changedPaths: [...changedPaths],
      deletedPaths: [...deletedPaths],
      dirtyWorkingTree: false,
      fallbackToFullHashCompare: false,
      reason: "Using git diff and untracked files against last indexed commit.",
    };
  } catch {
    return {
      currentCommit,
      trackedPaths,
      changedPaths: trackedPaths,
      deletedPaths: [...existingIndexedPaths].filter((filePath) => !trackedSet.has(filePath)),
      dirtyWorkingTree: true,
      fallbackToFullHashCompare: true,
      reason: "Unable to compute git diff; falling back to full hash comparison.",
    };
  }
}

const DISCOVERY_SCAN_INTERVAL = 200;

function discoverFromPaths(
  cwd: string,
  repo: string,
  inputPaths: string[],
  options: {
    includeContent?: boolean;
    maxFileBytes?: number;
    onScan?: (scanned: number, total: number) => void;
  } = {},
): CodeFileDiscoveryResult {
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_CODE_FILE_BYTES;
  const includeContent = options.includeContent ?? false;
  const rootPath = path.resolve(cwd);
  const files: DiscoveredCodeFile[] = [];
  let skippedFiles = 0;
  const candidatePaths = [...new Set(inputPaths.map((value) => normalizeGitPath(value)).filter(Boolean))];
  const total = candidatePaths.length;
  for (const [scanIndex, filePath] of candidatePaths.entries()) {
    const scanned = scanIndex + 1;
    if (scanned % DISCOVERY_SCAN_INTERVAL === 0 || scanned === total) {
      options.onScan?.(scanned, total);
    }
    if (isHardExcludedCodePath(filePath)) {
      skippedFiles += 1;
      continue;
    }

    const absolutePath = path.resolve(cwd, filePath);
    const relativeToRoot = path.relative(rootPath, absolutePath);
    if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
      skippedFiles += 1;
      continue;
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(absolutePath);
    } catch {
      skippedFiles += 1;
      continue;
    }

    if (!stat.isFile() || stat.size > maxFileBytes) {
      skippedFiles += 1;
      continue;
    }

    const buffer = fs.readFileSync(absolutePath);
    if (isProbablyBinary(buffer)) {
      skippedFiles += 1;
      continue;
    }

    files.push({
      repo,
      path: filePath,
      language: languageForPath(filePath),
      sizeBytes: stat.size,
      contentHash: crypto.createHash("sha256").update(buffer).digest("hex"),
      updatedAt: stat.mtime.toISOString(),
      absolutePath,
      ...(includeContent ? { content: buffer.toString("utf8") } : {}),
    });
  }
  return { files, skippedFiles };
}

export function discoverCodeFiles(
  cwd: string,
  repo: string,
  options: {
    includeContent?: boolean;
    maxFileBytes?: number;
    onScan?: (scanned: number, total: number) => void;
  } = {},
): CodeFileDiscoveryResult {
  return discoverFromPaths(cwd, repo, discoverGitFiles(cwd), options);
}

export function discoverCodeFilesByPaths(
  cwd: string,
  repo: string,
  filePaths: string[],
  options: {
    includeContent?: boolean;
    maxFileBytes?: number;
    onScan?: (scanned: number, total: number) => void;
  } = {},
): CodeFileDiscoveryResult {
  return discoverFromPaths(cwd, repo, filePaths, options);
}

export function readDiscoveredCodeFileContent(file: DiscoveredCodeFile): string {
  if (typeof file.content === "string") return file.content;
  return fs.readFileSync(file.absolutePath, "utf8");
}
