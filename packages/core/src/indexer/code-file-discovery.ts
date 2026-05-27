import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { CodeFileRecord } from "../types.js";

export const DEFAULT_MAX_CODE_FILE_BYTES = 512 * 1024;

export type DiscoveredCodeFile = CodeFileRecord & {
  absolutePath: string;
  content: string;
};

export type CodeFileDiscoveryResult = {
  files: DiscoveredCodeFile[];
  skippedFiles: number;
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

const DISCOVERY_SCAN_INTERVAL = 200;

export function discoverCodeFiles(
  cwd: string,
  repo: string,
  options: { maxFileBytes?: number; onScan?: (scanned: number, total: number) => void } = {},
): CodeFileDiscoveryResult {
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_CODE_FILE_BYTES;
  const rootPath = path.resolve(cwd);
  const files: DiscoveredCodeFile[] = [];
  let skippedFiles = 0;

  const gitFiles = discoverGitFiles(cwd);
  const total = gitFiles.length;
  for (const [scanIndex, filePath] of gitFiles.entries()) {
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

    const content = buffer.toString("utf8");
    files.push({
      repo,
      path: filePath,
      language: languageForPath(filePath),
      sizeBytes: stat.size,
      contentHash: crypto.createHash("sha256").update(buffer).digest("hex"),
      updatedAt: stat.mtime.toISOString(),
      absolutePath,
      content,
    });
  }

  return { files, skippedFiles };
}
