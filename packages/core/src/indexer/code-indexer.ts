import type { AnchorDatabase } from "../db/database.js";
import {
  defaultDatabasePath,
  ensureRepository,
  getCodeIndexStateForRepo,
  getRepoCodeChunkSymbols,
  getRepoCodeFileHashes,
  getRepoCodeFiles,
  getRepoCodeImports,
  getRepoTestChunks,
  replaceCodeIndex,
  touchCodeIndexState,
} from "../db/database.js";
import type { CodeChunk, CodeImport, CodeIndexProgress, CodeIndexSummary } from "../types.js";
import {
  buildArchitectureFromIndexedData,
  extractCodeImports,
} from "./architecture-indexer.js";
import { chunkCodeFile } from "./code-chunker.js";
import {
  discoverCodeFiles,
  discoverCodeFilesByPaths,
  planIncrementalCodeIndex,
  readDiscoveredCodeFileContent,
} from "./code-file-discovery.js";
import { refreshTestCommands } from "../retrieval/test-commands.js";
import { inferTestAwareness, isTestFilePath } from "./test-awareness.js";

export function indexCodebase(
  db: AnchorDatabase,
  options: {
    cwd: string;
    repo: string;
    maxFileBytes?: number;
    onProgress?: (progress: CodeIndexProgress) => void;
  },
): CodeIndexSummary {
  const state = getCodeIndexStateForRepo(db, options.repo);
  const existingHashes = getRepoCodeFileHashes(db, options.repo);
  const plan = planIncrementalCodeIndex(
    options.cwd,
    state?.lastIndexedCommit,
    new Set(existingHashes.keys()),
  );

  options.onProgress?.({ stage: "discovering_code_files", repo: options.repo });
  const discovery = plan.fallbackToFullHashCompare
    ? discoverCodeFiles(options.cwd, options.repo, {
        maxFileBytes: options.maxFileBytes,
        onScan: (scanned, total) =>
          options.onProgress?.({
            stage: "discovering_code_files",
            repo: options.repo,
            scanned,
            total,
          }),
      })
    : discoverCodeFilesByPaths(options.cwd, options.repo, plan.changedPaths, {
        maxFileBytes: options.maxFileBytes,
        onScan: (scanned, total) =>
          options.onProgress?.({
            stage: "discovering_code_files",
            repo: options.repo,
            scanned,
            total,
          }),
      });

  const changedFiles = discovery.files.filter(
    (file) => existingHashes.get(file.path) !== file.contentHash,
  );
  const discoveredPaths = new Set(discovery.files.map((file) => file.path));
  const deletedPaths = plan.fallbackToFullHashCompare
    ? [...existingHashes.keys()].filter((filePath) => !discoveredPaths.has(filePath))
    : plan.deletedPaths;

  options.onProgress?.({
    stage: "discovered_code_files",
    repo: options.repo,
    files: changedFiles.length,
    skippedFiles: discovery.skippedFiles,
  });

  if (changedFiles.length === 0 && deletedPaths.length === 0) {
    const counts = touchCodeIndexState(
      db,
      options.repo,
      discovery.skippedFiles,
      plan.currentCommit,
    );
    const repoId = ensureRepository(db, options.repo);
    const scopedCount = (table: string): number =>
      (
        db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE repo_id = ?`).get(repoId) as {
          count: number;
        }
      ).count;
    const summary = {
      indexedFiles: counts.files,
      codeChunksCreated: counts.chunks,
      testFilesIndexed: scopedCount("test_files"),
      testLinksCreated: scopedCount("test_links"),
      architectureComponentsIndexed: scopedCount("architecture_components"),
      architecturePatternsIndexed: scopedCount("architecture_patterns"),
      architectureImportsIndexed: scopedCount("code_imports"),
      skippedFiles: discovery.skippedFiles,
      databasePath: defaultDatabasePath(options.cwd),
    };
    options.onProgress?.({
      stage: "completed_code_index",
      repo: options.repo,
      files: summary.indexedFiles,
      chunks: summary.codeChunksCreated,
      skippedFiles: summary.skippedFiles,
      testFiles: summary.testFilesIndexed,
      testLinks: summary.testLinksCreated,
      architectureComponents: summary.architectureComponentsIndexed,
      architecturePatterns: summary.architecturePatternsIndexed,
      architectureImports: summary.architectureImportsIndexed,
    });
    return summary;
  }

  const changedChunks: CodeChunk[] = [];
  const changedImports: CodeImport[] = [];
  const projectedIndexedPaths = new Set(
    [...existingHashes.keys()].filter((filePath) => !deletedPaths.includes(filePath)),
  );
  for (const file of changedFiles) projectedIndexedPaths.add(file.path);

  for (const [index, file] of changedFiles.entries()) {
    options.onProgress?.({
      stage: "indexing_code_file",
      repo: options.repo,
      current: index + 1,
      total: changedFiles.length,
      filePath: file.path,
    });
    const content = readDiscoveredCodeFileContent(file);
    const fileWithContent = { ...file, content };
    const fileChunks = chunkCodeFile(fileWithContent);
    changedChunks.push(...fileChunks);
    changedImports.push(
      ...extractCodeImports(file.path, content, projectedIndexedPaths, options.repo),
    );
    options.onProgress?.({
      stage: "indexed_code_file",
      repo: options.repo,
      current: index + 1,
      total: changedFiles.length,
      filePath: file.path,
      chunks: fileChunks.length,
    });
  }

  const affectedPaths = new Set([
    ...deletedPaths,
    ...changedFiles.map((file) => file.path),
  ]);
  const allFilesByPath = new Map(getRepoCodeFiles(db, options.repo).map((file) => [file.path, file]));
  for (const filePath of deletedPaths) allFilesByPath.delete(filePath);
  for (const file of changedFiles) {
    allFilesByPath.set(file.path, {
      repo: file.repo,
      path: file.path,
      language: file.language,
      sizeBytes: file.sizeBytes,
      contentHash: file.contentHash,
      updatedAt: file.updatedAt,
    });
  }
  const allFiles = [...allFilesByPath.values()];

  const allSymbolChunks = getRepoCodeChunkSymbols(db, options.repo).filter(
    (chunk) => !affectedPaths.has(chunk.filePath),
  );
  allSymbolChunks.push(...changedChunks);

  const allImports = getRepoCodeImports(db, options.repo).filter(
    (item) => !affectedPaths.has(item.sourcePath),
  );
  allImports.push(...changedImports);

  const testChunks = getRepoTestChunks(db, options.repo).filter(
    (chunk) => !affectedPaths.has(chunk.filePath),
  );
  for (const chunk of changedChunks) {
    if (isTestFilePath(chunk.filePath)) testChunks.push(chunk);
  }
  const testAwareness = inferTestAwareness(options.repo, allFiles, testChunks, {
    onProgress: options.onProgress,
  });

  options.onProgress?.({
    stage: "building_architecture_imports",
    repo: options.repo,
    current: allFiles.length,
    total: allFiles.length,
    imports: allImports.length,
  });
  const architecture = buildArchitectureFromIndexedData(
    options.repo,
    allFiles,
    allSymbolChunks,
    allImports,
    { onProgress: options.onProgress },
  );
  options.onProgress?.({
    stage: "indexed_architecture",
    repo: options.repo,
    components: architecture.components.length,
    patterns: architecture.patterns.length,
    imports: architecture.imports.length,
  });

  const summary = replaceCodeIndex(
    db,
    options.repo,
    changedFiles.map(({ content: _content, absolutePath: _absolutePath, ...file }) => file),
    changedChunks,
    discovery.skippedFiles,
    options.cwd,
    architecture,
    {
      onProgress: options.onProgress,
      deletedPaths,
      changedImports,
      currentCommit: plan.currentCommit,
      testAwareness,
    },
  );
  refreshTestCommands(db, options.cwd, options.repo, [], {
    onProgress: options.onProgress,
  });
  options.onProgress?.({
    stage: "completed_code_index",
    repo: options.repo,
    files: summary.indexedFiles,
    chunks: summary.codeChunksCreated,
    skippedFiles: summary.skippedFiles,
    testFiles: summary.testFilesIndexed,
    testLinks: summary.testLinksCreated,
    architectureComponents: summary.architectureComponentsIndexed,
    architecturePatterns: summary.architecturePatternsIndexed,
    architectureImports: summary.architectureImportsIndexed,
  });
  return summary;
}

export function emptyCodeIndexSummary(cwd: string): CodeIndexSummary {
  return {
    indexedFiles: 0,
    codeChunksCreated: 0,
    testFilesIndexed: 0,
    testLinksCreated: 0,
    architectureComponentsIndexed: 0,
    architecturePatternsIndexed: 0,
    architectureImportsIndexed: 0,
    skippedFiles: 0,
    databasePath: defaultDatabasePath(cwd),
  };
}
