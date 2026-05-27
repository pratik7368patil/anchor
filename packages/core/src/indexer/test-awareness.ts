import path from "node:path";
import type {
  CodeChunk,
  CodeFileRecord,
  CodeIndexProgress,
  TestFileRecord,
  TestLink,
} from "../types.js";
import { uniqueStrings } from "../utils/text.js";

const TEST_AWARENESS_PROGRESS_INTERVAL = 500;

type TestAwarenessOptions = {
  onProgress?: (progress: CodeIndexProgress) => void;
};

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

function shouldEmitProgress(current: number, total: number): boolean {
  return (
    current === 0 ||
    current === 1 ||
    current === total ||
    current % TEST_AWARENESS_PROGRESS_INTERVAL === 0
  );
}

function addToMap<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function withoutExtension(filePath: string): string {
  return normalizePath(filePath).replace(/\.[^.]+$/i, "");
}

function testText(testPath: string, chunksByFile: Map<string, CodeChunk[]>): string {
  return (chunksByFile.get(testPath) ?? []).map((chunk) => chunk.sanitizedText).join("\n");
}

function importSpecifiers(text: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (match[1]) specifiers.push(match[1]);
    }
  }
  return uniqueStrings(specifiers);
}

function pathLikeMentions(text: string): string[] {
  const mentions = new Set<string>();
  const pattern = /[A-Za-z0-9_@./-]+(?:\.[A-Za-z0-9_@./-]+)?/g;
  for (const match of text.matchAll(pattern)) {
    const value = match[0];
    if (value.includes("/") || /\.[A-Za-z0-9]+$/.test(value)) mentions.add(value);
  }
  return [...mentions];
}

function sourceCandidatesForSpecifier(
  testPath: string,
  specifier: string,
  sourcesByBase: Map<string, CodeFileRecord[]>,
  sourcesByPath: Map<string, CodeFileRecord[]>,
  sourcesByNoExt: Map<string, CodeFileRecord[]>,
): CodeFileRecord[] {
  const normalizedSpecifier = normalizePath(specifier);
  const candidates: CodeFileRecord[] = [];
  const add = (items: CodeFileRecord[] | undefined) => {
    if (items) candidates.push(...items);
  };

  add(sourcesByPath.get(normalizedSpecifier));
  add(sourcesByNoExt.get(normalizedSpecifier));

  if (normalizedSpecifier.startsWith(".")) {
    const resolved = normalizePath(path.posix.join(path.posix.dirname(testPath), normalizedSpecifier));
    add(sourcesByPath.get(resolved));
    add(sourcesByNoExt.get(resolved));
  }

  const base = basenameWithoutExtensions(normalizedSpecifier).toLowerCase();
  if (base) add(sourcesByBase.get(base));

  return uniqueStrings(candidates.map((source) => source.path))
    .map((sourcePath) => sourcesByPath.get(sourcePath)?.[0])
    .filter((source): source is CodeFileRecord => source !== undefined);
}

export function inferTestAwareness(
  repo: string,
  codeFiles: CodeFileRecord[],
  codeChunks: CodeChunk[],
  options: TestAwarenessOptions = {},
): { testFiles: TestFileRecord[]; testLinks: TestLink[] } {
  const testFiles: CodeFileRecord[] = [];
  const sourceFiles: CodeFileRecord[] = [];
  options.onProgress?.({
    stage: "inferring_test_awareness",
    repo,
    phase: "classifying_files",
    current: 0,
    total: codeFiles.length,
    testFiles: 0,
    testLinks: 0,
  });
  for (const [index, file] of codeFiles.entries()) {
    if (isTestFilePath(file.path)) testFiles.push(file);
    else sourceFiles.push(file);
    const current = index + 1;
    if (shouldEmitProgress(current, codeFiles.length)) {
      options.onProgress?.({
        stage: "inferring_test_awareness",
        repo,
        phase: "classifying_files",
        current,
        total: codeFiles.length,
        filePath: file.path,
        testFiles: testFiles.length,
        testLinks: 0,
      });
    }
  }

  const chunksByFile = new Map<string, CodeChunk[]>();
  for (const chunk of codeChunks) {
    const chunks = chunksByFile.get(chunk.filePath) ?? [];
    chunks.push(chunk);
    chunksByFile.set(chunk.filePath, chunks);
  }

  const sourcesByBase = new Map<string, CodeFileRecord[]>();
  const sourcesByDir = new Map<string, CodeFileRecord[]>();
  const sourcesByPath = new Map<string, CodeFileRecord[]>();
  const sourcesByNoExt = new Map<string, CodeFileRecord[]>();
  options.onProgress?.({
    stage: "inferring_test_awareness",
    repo,
    phase: "indexing_sources",
    current: 0,
    total: sourceFiles.length,
    testFiles: testFiles.length,
    testLinks: 0,
  });
  for (const [index, source] of sourceFiles.entries()) {
    addToMap(sourcesByBase, basenameWithoutExtensions(source.path).toLowerCase(), source);
    addToMap(sourcesByDir, sourceLikeDir(source.path).join("/"), source);
    addToMap(sourcesByPath, normalizePath(source.path), source);
    addToMap(sourcesByNoExt, withoutExtension(source.path), source);
    const current = index + 1;
    if (shouldEmitProgress(current, sourceFiles.length)) {
      options.onProgress?.({
        stage: "inferring_test_awareness",
        repo,
        phase: "indexing_sources",
        current,
        total: sourceFiles.length,
        filePath: source.path,
        testFiles: testFiles.length,
        testLinks: 0,
      });
    }
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

  options.onProgress?.({
    stage: "inferring_test_awareness",
    repo,
    phase: "linking_tests",
    current: 0,
    total: testFiles.length,
    testFiles: testFiles.length,
    testLinks: 0,
  });
  for (const [index, test] of testFiles.entries()) {
    const testBase = basenameWithoutExtensions(test.path).toLowerCase();
    const testDir = sourceLikeDir(test.path).join("/");
    for (const source of sourcesByBase.get(testBase) ?? []) {
      addLink(source.path, test.path, "same basename");
    }
    if (testDir) {
      for (const source of sourcesByDir.get(testDir) ?? []) {
        if (basenameWithoutExtensions(source.path).toLowerCase() === testBase) continue;
        addLink(source.path, test.path, "same directory");
      }
    }

    const text = testText(test.path, chunksByFile);
    const importedSources = new Map<string, CodeFileRecord>();
    for (const specifier of importSpecifiers(text)) {
      for (const source of sourceCandidatesForSpecifier(
        test.path,
        specifier,
        sourcesByBase,
        sourcesByPath,
        sourcesByNoExt,
      )) {
        importedSources.set(source.path, source);
      }
    }
    for (const mention of pathLikeMentions(text)) {
      for (const source of sourceCandidatesForSpecifier(
        test.path,
        mention,
        sourcesByBase,
        sourcesByPath,
        sourcesByNoExt,
      )) {
        importedSources.set(source.path, source);
      }
    }
    for (const source of importedSources.values()) {
        addLink(source.path, test.path, "imported source path");
    }

    const current = index + 1;
    if (shouldEmitProgress(current, testFiles.length)) {
      options.onProgress?.({
        stage: "inferring_test_awareness",
        repo,
        phase: "linking_tests",
        current,
        total: testFiles.length,
        filePath: test.path,
        testFiles: testFiles.length,
        testLinks: linkMap.size,
      });
    }
  }

  const dedupedTests = testFiles.map(testRecord);
  options.onProgress?.({
    stage: "inferring_test_awareness",
    repo,
    phase: "completed",
    current: testFiles.length,
    total: testFiles.length,
    testFiles: dedupedTests.length,
    testLinks: linkMap.size,
  });
  return {
    testFiles: dedupedTests,
    testLinks: uniqueStrings([...linkMap.keys()]).map((key) => linkMap.get(key)!),
  };
}
