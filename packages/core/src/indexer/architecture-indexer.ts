import crypto from "node:crypto";
import path from "node:path";
import type {
  ArchitectureArea,
  ArchitectureComponent,
  ArchitectureIndexData,
  ArchitecturePattern,
  CodeChunk,
  CodeImport,
} from "../types.js";
import type { ChunkableCodeFile } from "./code-chunker.js";
import { isTestFilePath } from "./test-awareness.js";
import { sanitizeHistoricalText } from "../security/sanitize.js";
import { uniqueStrings } from "../utils/text.js";

const KNOWN_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json"];

export function classifyArchitectureArea(
  filePath: string,
  language?: string,
  content = "",
): ArchitectureArea {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  const basename = path.basename(normalized);
  if (isTestFilePath(normalized)) return "test";
  if (/\b(route|routes|router|pages|app)\b/.test(normalized) || basename === "route.ts") {
    return "route";
  }
  if (/\/(api|apis)\//.test(normalized) || /\b(api|client|request|graphql|rest)\b/.test(basename)) {
    return "api";
  }
  if (/\/(services?|clients?|repositories?)\//.test(normalized)) return "service";
  if (/\/(hooks?)\//.test(normalized) || /^use[A-Z]/.test(path.basename(filePath))) return "hook";
  if (
    /\/(components?|ui)\//.test(normalized) ||
    language === "tsx" ||
    /\bjsx?\b/.test(language ?? "")
  ) {
    return "component";
  }
  if (/\/(stores?|state|redux|zustand)\//.test(normalized)) return "store";
  if (
    /\/(schemas?|validation|validators?)\//.test(normalized) ||
    /\b(schema|zod)\b/.test(content)
  ) {
    return "schema";
  }
  if (/\/(types?|interfaces?|models?)\//.test(normalized) || normalized.endsWith(".d.ts")) {
    return "type";
  }
  if (/\/(configs?|settings)\//.test(normalized) || /\b(config|rc)\b/.test(basename)) {
    return "config";
  }
  if (/\/(utils?|helpers?|lib)\//.test(normalized)) return "util";
  return "unknown";
}

function stablePatternId(
  repo: string,
  area: ArchitectureArea,
  name: string,
  sourceFiles: string[],
): string {
  const hash = crypto
    .createHash("sha256")
    .update([repo, area, name, ...sourceFiles].join("\0"))
    .digest("hex")
    .slice(0, 24);
  return `ap_${hash}`;
}

function parseImportedSymbols(importClause: string): string[] {
  const symbols: string[] = [];
  const named = importClause.match(/\{([^}]+)\}/)?.[1];
  if (named) {
    for (const item of named.split(",")) {
      const symbol = item
        .trim()
        .split(/\s+as\s+/i)[0]
        ?.trim();
      if (symbol) symbols.push(symbol);
    }
  }
  const defaultImport = importClause
    .replace(/\{[^}]+\}/g, "")
    .split(",")[0]
    ?.trim()
    .replace(/^type\s+/, "");
  if (defaultImport && /^[A-Za-z_$][\w$]*$/.test(defaultImport)) symbols.push(defaultImport);
  return uniqueStrings(symbols).slice(0, 20);
}

function resolveRelativeImport(
  sourcePath: string,
  specifier: string,
  codePaths: Set<string>,
): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const sourceDir = path.posix.dirname(sourcePath.replace(/\\/g, "/"));
  const base = path.posix.normalize(path.posix.join(sourceDir, specifier));
  const candidates = [
    base,
    ...KNOWN_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...KNOWN_EXTENSIONS.map((extension) => path.posix.join(base, `index${extension}`)),
  ];
  return candidates.find((candidate) => codePaths.has(candidate));
}

export function extractCodeImports(
  sourcePath: string,
  content: string,
  codePaths: Set<string>,
  repo = "",
): CodeImport[] {
  const imports: CodeImport[] = [];
  const staticImports = content.matchAll(
    /import\s+(?:type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']/g,
  );
  for (const match of staticImports) {
    const importClause = match[1] ?? "";
    const specifier = match[2] ?? "";
    const sanitizedSpecifier = sanitizeHistoricalText(specifier);
    imports.push({
      repo,
      sourcePath,
      specifier: sanitizedSpecifier,
      importedPath: resolveRelativeImport(sourcePath, specifier, codePaths),
      importedSymbols: parseImportedSymbols(importClause),
      kind: "static",
    });
  }

  const dynamicImports = content.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g);
  for (const match of dynamicImports) {
    const specifier = match[1] ?? "";
    const sanitizedSpecifier = sanitizeHistoricalText(specifier);
    imports.push({
      repo,
      sourcePath,
      specifier: sanitizedSpecifier,
      importedPath: resolveRelativeImport(sourcePath, specifier, codePaths),
      importedSymbols: [],
      kind: "dynamic",
    });
  }

  const requireImports = content.matchAll(/require\s*\(\s*["']([^"']+)["']\s*\)/g);
  for (const match of requireImports) {
    const specifier = match[1] ?? "";
    const sanitizedSpecifier = sanitizeHistoricalText(specifier);
    imports.push({
      repo,
      sourcePath,
      specifier: sanitizedSpecifier,
      importedPath: resolveRelativeImport(sourcePath, specifier, codePaths),
      importedSymbols: [],
      kind: "require",
    });
  }

  const seen = new Set<string>();
  return imports.filter((item) => {
    const key = `${item.sourcePath}:${item.specifier}:${item.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function relatedTestsFor(filePath: string, allPaths: string[]): string[] {
  if (isTestFilePath(filePath)) return [];
  const parsed = path.posix.parse(filePath);
  const basename = parsed.name.replace(/\.(test|spec)$/i, "");
  return allPaths
    .filter((candidate) => isTestFilePath(candidate))
    .filter((candidate) => {
      const candidateParsed = path.posix.parse(candidate);
      const candidateBase = candidateParsed.name.replace(/\.(test|spec)$/i, "");
      return (
        candidateBase === basename ||
        candidate.startsWith(`${parsed.dir}/`) ||
        candidate.includes(`/${basename}.`)
      );
    })
    .slice(0, 8);
}

function directoryLabel(filePath: string): string {
  const directory = path.posix.dirname(filePath.replace(/\\/g, "/"));
  return directory === "." ? "repo root" : directory;
}

function topDirectories(files: string[]): string[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    const directory = directoryLabel(file);
    counts.set(directory, (counts.get(directory) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([directory]) => directory);
}

function createPattern(input: {
  repo: string;
  area: ArchitectureArea;
  name: string;
  summary: string;
  sourceFiles: string[];
  symbols: string[];
  confidence: number;
}): ArchitecturePattern {
  const sourceFiles = uniqueStrings(input.sourceFiles).slice(0, 12);
  const sanitizedSummary = sanitizeHistoricalText(input.summary);
  return {
    id: stablePatternId(input.repo, input.area, input.name, sourceFiles),
    repo: input.repo,
    area: input.area,
    name: input.name,
    summary: sanitizedSummary,
    sanitizedSummary,
    sourceFiles,
    symbols: uniqueStrings(input.symbols).slice(0, 30),
    evidence: [],
    confidence: Number(Math.min(0.95, Math.max(0.35, input.confidence)).toFixed(2)),
    createdAt: new Date().toISOString(),
  };
}

export function buildArchitectureIndex(
  repo: string,
  files: ChunkableCodeFile[],
  chunks: CodeChunk[],
): ArchitectureIndexData {
  const allPaths = files.map((file) => file.path);
  const codePaths = new Set(allPaths);
  const symbolsByPath = new Map<string, string[]>();
  for (const chunk of chunks) {
    const existing = symbolsByPath.get(chunk.filePath) ?? [];
    symbolsByPath.set(chunk.filePath, uniqueStrings([...existing, ...chunk.symbols]).slice(0, 40));
  }

  const imports = files.flatMap((file) =>
    extractCodeImports(file.path, file.content, codePaths, repo),
  );
  const importsByPath = new Map<string, CodeImport[]>();
  for (const item of imports) {
    const existing = importsByPath.get(item.sourcePath) ?? [];
    existing.push(item);
    importsByPath.set(item.sourcePath, existing);
  }

  const components: ArchitectureComponent[] = files.map((file) => {
    const area = classifyArchitectureArea(file.path, file.language, file.content);
    const fileImports = importsByPath.get(file.path) ?? [];
    const symbols = symbolsByPath.get(file.path) ?? [];
    return {
      repo,
      path: file.path,
      area,
      kind: area,
      language: file.language,
      symbols,
      imports: uniqueStrings(
        fileImports.map((item) => item.importedPath ?? item.specifier).filter(Boolean),
      ).slice(0, 20),
      relatedTests: relatedTestsFor(file.path, allPaths),
      confidence: area === "unknown" ? 0.45 : 0.82,
      updatedAt: file.updatedAt,
    };
  });

  const componentByPath = new Map(components.map((component) => [component.path, component]));
  const patterns: ArchitecturePattern[] = [];
  const componentsByArea = new Map<ArchitectureArea, ArchitectureComponent[]>();
  for (const component of components) {
    const existing = componentsByArea.get(component.area) ?? [];
    existing.push(component);
    componentsByArea.set(component.area, existing);
  }

  for (const [area, areaComponents] of componentsByArea.entries()) {
    const filesForArea = areaComponents.map((component) => component.path);
    const directories = topDirectories(filesForArea);
    const symbols = areaComponents.flatMap((component) => component.symbols);
    patterns.push(
      createPattern({
        repo,
        area,
        name: `${area} area placement`,
        summary: `${area} code is represented by ${filesForArea.length} file(s), commonly under ${directories.join(", ")}. Use these files as current architecture evidence before adding or changing similar code.`,
        sourceFiles: filesForArea,
        symbols,
        confidence: 0.55 + Math.min(0.3, filesForArea.length * 0.04),
      }),
    );
  }

  const importDirectionCounts = new Map<
    string,
    { count: number; files: string[]; symbols: string[] }
  >();
  for (const item of imports) {
    if (!item.importedPath) continue;
    const source = componentByPath.get(item.sourcePath);
    const target = componentByPath.get(item.importedPath);
    if (!source || !target || source.area === target.area) continue;
    const key = `${source.area}->${target.area}`;
    const existing = importDirectionCounts.get(key) ?? { count: 0, files: [], symbols: [] };
    existing.count += 1;
    existing.files.push(source.path, target.path);
    existing.symbols.push(...item.importedSymbols);
    importDirectionCounts.set(key, existing);
  }

  for (const [key, value] of importDirectionCounts.entries()) {
    const [sourceArea, targetArea] = key.split("->") as [ArchitectureArea, ArchitectureArea];
    patterns.push(
      createPattern({
        repo,
        area: sourceArea,
        name: `${sourceArea} imports ${targetArea}`,
        summary: `${sourceArea} files import ${targetArea} files in ${value.count} observed edge(s). Prefer this direction when adding similar code unless cited repo evidence says otherwise.`,
        sourceFiles: value.files,
        symbols: value.symbols,
        confidence: 0.62 + Math.min(0.25, value.count * 0.05),
      }),
    );
  }

  const testedComponents = components.filter((component) => component.relatedTests.length > 0);
  if (testedComponents.length > 0) {
    patterns.push(
      createPattern({
        repo,
        area: "test",
        name: "source files have nearby tests",
        summary: `${testedComponents.length} source file(s) have nearby tests. When editing these areas, update or add sibling tests that match the existing placement.`,
        sourceFiles: testedComponents.flatMap((component) => [
          component.path,
          ...component.relatedTests,
        ]),
        symbols: testedComponents.flatMap((component) => component.symbols),
        confidence: 0.72,
      }),
    );
  }

  return { components, patterns, imports };
}
