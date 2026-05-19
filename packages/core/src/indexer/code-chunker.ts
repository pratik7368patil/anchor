import crypto from "node:crypto";
import path from "node:path";
import type { CodeChunk, CodeFileRecord } from "../types.js";
import { sanitizeHistoricalText } from "../security/sanitize.js";
import { uniqueStrings } from "../utils/text.js";

const DEFAULT_CHUNK_LINES = 80;
const DEFAULT_OVERLAP_LINES = 8;

const FUNCTION_CALL_STOP_WORDS = new Set([
  "catch",
  "describe",
  "for",
  "if",
  "it",
  "return",
  "switch",
  "test",
  "while",
]);

export type ChunkableCodeFile = CodeFileRecord & {
  content: string;
};

function stableCodeChunkId(file: CodeFileRecord, startLine: number, endLine: number): string {
  const hash = crypto
    .createHash("sha256")
    .update([file.repo, file.path, file.contentHash, startLine, endLine].join("\0"))
    .digest("hex")
    .slice(0, 24);
  return `cc_${hash}`;
}

export function extractCodeSymbols(text: string, filePath: string): string[] {
  const symbols: string[] = [];

  const declarations = text.matchAll(
    /\b(?:export\s+)?(?:async\s+)?(?:class|function|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/g,
  );
  for (const match of declarations) symbols.push(match[1] ?? "");

  const objectMethods = text.matchAll(
    /\b([A-Za-z_$][\w$]{2,})\s*[:=]\s*(?:async\s*)?\([^)]*\)\s*=>/g,
  );
  for (const match of objectMethods) symbols.push(match[1] ?? "");

  const calls = text.matchAll(/\b([A-Za-z_$][\w$]{2,})\s*\(/g);
  for (const match of calls) {
    const candidate = match[1] ?? "";
    if (!FUNCTION_CALL_STOP_WORDS.has(candidate)) symbols.push(candidate);
  }

  const basename = path.basename(filePath).replace(/\.[^.]+$/, "");
  if (/^[A-Za-z_$][\w$-]*$/.test(basename)) symbols.push(basename);

  return uniqueStrings(symbols).slice(0, 40);
}

export function chunkCodeFile(
  file: ChunkableCodeFile,
  options: { chunkLines?: number; overlapLines?: number } = {},
): CodeChunk[] {
  const chunkLines = options.chunkLines ?? DEFAULT_CHUNK_LINES;
  const overlapLines = Math.max(
    0,
    Math.min(options.overlapLines ?? DEFAULT_OVERLAP_LINES, chunkLines - 1),
  );
  const lines = file.content.replace(/\r\n/g, "\n").split("\n");
  const chunks: CodeChunk[] = [];

  for (let startIndex = 0; startIndex < lines.length; ) {
    const endIndex = Math.min(lines.length, startIndex + chunkLines);
    const rawText = lines.slice(startIndex, endIndex).join("\n");
    const sanitizedText = sanitizeHistoricalText(rawText);
    if (sanitizedText) {
      chunks.push({
        id: stableCodeChunkId(file, startIndex + 1, endIndex),
        repo: file.repo,
        filePath: file.path,
        language: file.language,
        startLine: startIndex + 1,
        endLine: endIndex,
        sanitizedText,
        symbols: extractCodeSymbols(sanitizedText, file.path),
        contentHash: file.contentHash,
        updatedAt: file.updatedAt,
      });
    }

    if (endIndex >= lines.length) break;
    startIndex = Math.max(startIndex + 1, endIndex - overlapLines);
  }

  return chunks;
}
