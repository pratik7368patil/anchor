import type { AnchorDatabase } from "../db/database.js";
import { defaultDatabasePath, replaceCodeIndex } from "../db/database.js";
import type { CodeChunk, CodeIndexProgress, CodeIndexSummary } from "../types.js";
import { buildArchitectureIndex } from "./architecture-indexer.js";
import { chunkCodeFile } from "./code-chunker.js";
import { discoverCodeFiles } from "./code-file-discovery.js";

export function indexCodebase(
  db: AnchorDatabase,
  options: {
    cwd: string;
    repo: string;
    maxFileBytes?: number;
    onProgress?: (progress: CodeIndexProgress) => void;
  },
): CodeIndexSummary {
  options.onProgress?.({ stage: "discovering_code_files", repo: options.repo });
  const discovery = discoverCodeFiles(options.cwd, options.repo, {
    maxFileBytes: options.maxFileBytes,
  });
  options.onProgress?.({
    stage: "discovered_code_files",
    repo: options.repo,
    files: discovery.files.length,
    skippedFiles: discovery.skippedFiles,
  });

  const chunks: CodeChunk[] = [];
  for (const [index, file] of discovery.files.entries()) {
    options.onProgress?.({
      stage: "indexing_code_file",
      repo: options.repo,
      current: index + 1,
      total: discovery.files.length,
      filePath: file.path,
    });
    const fileChunks = chunkCodeFile(file);
    chunks.push(...fileChunks);
    options.onProgress?.({
      stage: "indexed_code_file",
      repo: options.repo,
      current: index + 1,
      total: discovery.files.length,
      filePath: file.path,
      chunks: fileChunks.length,
    });
  }

  const architecture = buildArchitectureIndex(options.repo, discovery.files, chunks);
  options.onProgress?.({
    stage: "indexed_architecture",
    repo: options.repo,
    components: architecture.components.length,
    patterns: architecture.patterns.length,
    imports: architecture.imports.length,
  });

  return replaceCodeIndex(
    db,
    options.repo,
    discovery.files.map(({ content: _content, absolutePath: _absolutePath, ...file }) => file),
    chunks,
    discovery.skippedFiles,
    options.cwd,
    architecture,
  );
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
