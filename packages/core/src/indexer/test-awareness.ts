import path from "node:path";
import type { CodeChunk, CodeFileRecord, TestFileRecord, TestLink } from "../types.js";
import { uniqueStrings } from "../utils/text.js";

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function pathSegments(filePath: string): string[] {
  return normalizePath(filePath).split("/").filter(Boolean);
}

function basenameWithoutExtensions(filePath: string): string {
  const base = path.posix.basename(normalizePath(filePath));
  return base.replace(/\.(test|spec)\.[^.]+$/i, "").replace(/\.[^.]+$/i, "");
}

function sourceLikeDir(filePath: string): string[] {
  const segments = pathSegments(path.posix.dirname(normalizePath(filePath)));
  return segments.filter((segment) => !["__tests__", "test", "tests", "spec"].includes(segment));
}

export function isTestFilePath(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  const segments = pathSegments(normalized).map((segment) => segment.toLowerCase());
  const base = path.posix.basename(normalized).toLowerCase();
  return (
    /\.(test|spec)\.[^.]+$/i.test(base) ||
    segments.includes("__tests__") ||
    segments.includes("test") ||
    segments.includes("tests") ||
    segments.includes("spec")
  );
}

function testRecord(file: CodeFileRecord): TestFileRecord {
  return {
    repo: file.repo,
    path: file.path,
    language: file.language,
    sizeBytes: file.sizeBytes,
    contentHash: file.contentHash,
    updatedAt: file.updatedAt,
  };
}

function strengthFor(reason: string): number {
  if (reason === "same basename") return 1;
  if (reason === "imported source path") return 0.9;
  if (reason === "same directory") return 0.7;
  return 0.5;
}

function pathMentionedInTest(
  testPath: string,
  sourcePath: string,
  chunksByFile: Map<string, CodeChunk[]>,
): boolean {
  const text = (chunksByFile.get(testPath) ?? []).map((chunk) => chunk.sanitizedText).join("\n");
  if (!text) return false;
  const sourceNoExt = sourcePath.replace(/\.[^.]+$/i, "");
  const sourceBase = basenameWithoutExtensions(sourcePath);
  return (
    text.includes(sourcePath) ||
    text.includes(sourceNoExt) ||
    new RegExp(`from\\s+["'][^"']*${escapeRegExp(sourceBase)}["']`, "i").test(text) ||
    new RegExp(`require\\(["'][^"']*${escapeRegExp(sourceBase)}["']\\)`, "i").test(text)
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function inferTestAwareness(
  repo: string,
  codeFiles: CodeFileRecord[],
  codeChunks: CodeChunk[],
): { testFiles: TestFileRecord[]; testLinks: TestLink[] } {
  const testFiles = codeFiles.filter((file) => isTestFilePath(file.path));
  const sourceFiles = codeFiles.filter((file) => !isTestFilePath(file.path));
  const chunksByFile = new Map<string, CodeChunk[]>();
  for (const chunk of codeChunks) {
    const chunks = chunksByFile.get(chunk.filePath) ?? [];
    chunks.push(chunk);
    chunksByFile.set(chunk.filePath, chunks);
  }

  const linkMap = new Map<string, TestLink>();
  const addLink = (sourcePath: string, testPath: string, reason: string) => {
    const key = `${sourcePath}\0${testPath}\0${reason}`;
    linkMap.set(key, {
      repo,
      sourcePath,
      testPath,
      reason,
      strength: strengthFor(reason),
    });
  };

  for (const test of testFiles) {
    const testBase = basenameWithoutExtensions(test.path).toLowerCase();
    const testDir = sourceLikeDir(test.path).join("/");
    for (const source of sourceFiles) {
      const sourceBase = basenameWithoutExtensions(source.path).toLowerCase();
      const sourceDir = sourceLikeDir(source.path).join("/");
      if (testBase === sourceBase) addLink(source.path, test.path, "same basename");
      else if (testDir && sourceDir && testDir === sourceDir) {
        addLink(source.path, test.path, "same directory");
      }
      if (pathMentionedInTest(test.path, source.path, chunksByFile)) {
        addLink(source.path, test.path, "imported source path");
      }
    }
  }

  const dedupedTests = testFiles.map(testRecord);
  return {
    testFiles: dedupedTests,
    testLinks: uniqueStrings([...linkMap.keys()]).map((key) => linkMap.get(key)!),
  };
}
