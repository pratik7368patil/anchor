import path from "node:path";
import type { AnchorContextInput, SearchHistoryInput } from "../types.js";
import { tokenizeSearchText, truncateText, uniqueStrings } from "../utils/text.js";

const CATEGORY_HINTS = [
  "security",
  "regression",
  "contract",
  "architecture",
  "constraint",
  "testing",
  "performance",
  "rejected",
];

function ftsToken(token: string): string | undefined {
  const clean = token.toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (clean.length < 3) return undefined;
  return `${clean}*`;
}

function testFilenameHints(filePath: string): string[] {
  const parsed = path.parse(filePath);
  const base = parsed.name.replace(/\.(test|spec)$/i, "");
  return [`${base}.test${parsed.ext}`, `${base}.spec${parsed.ext}`];
}

function diffHunkTerms(diff?: string): string[] {
  if (!diff) return [];
  const terms: string[] = [];
  const truncated = truncateText(diff, 5000) ?? "";
  for (const line of truncated.split("\n")) {
    if (line.startsWith("diff --git")) {
      terms.push(...line.split(/[\\/]/).slice(-4));
    }
    if (line.startsWith("@@")) {
      terms.push(line.replace(/^@@[^@]*@@/, ""));
    }
    if (/^[+-]\s*(?:export\s+)?(?:class|function|const|let|var|type|interface)\s+/.test(line)) {
      terms.push(line);
    }
  }
  return terms;
}

export function buildQueryTerms(input: AnchorContextInput | SearchHistoryInput): string[] {
  const files = input.files ?? [];
  const symbols = "symbols" in input ? (input.symbols ?? []) : [];
  const categories = "categories" in input ? (input.categories ?? []) : [];
  const diff = "diff" in input ? truncateText(input.diff, 5000) : undefined;
  const currentCode = "currentCode" in input ? truncateText(input.currentCode, 5000) : undefined;
  const baseText = "task" in input ? input.task : input.query;
  const fileTerms = files.flatMap((file) => [
    file,
    path.basename(file),
    ...testFilenameHints(file),
    ...path.dirname(file).split(/[\\/]/).filter(Boolean),
  ]);
  return uniqueStrings([
    ...tokenizeSearchText(baseText, 24),
    ...tokenizeSearchText(fileTerms.join(" "), 24),
    ...tokenizeSearchText(symbols.join(" "), 24),
    ...tokenizeSearchText(categories.join(" "), 12),
    ...tokenizeSearchText(diff ?? "", 18),
    ...tokenizeSearchText(currentCode ?? "", 18),
    ...tokenizeSearchText(diffHunkTerms(diff).join(" "), 18),
    ...CATEGORY_HINTS,
    ...CATEGORY_HINTS.filter((hint) => baseText.toLowerCase().includes(hint)),
  ]).slice(0, 80);
}

export function buildFtsQuery(input: AnchorContextInput | SearchHistoryInput): string {
  const tokens = buildQueryTerms(input)
    .map(ftsToken)
    .filter((token): token is string => Boolean(token))
    .slice(0, 48);

  return tokens.join(" OR ");
}

export function clampMaxResults(value: number | undefined, defaultValue: number): number {
  const requested = value ?? defaultValue;
  return Math.max(1, Math.min(12, Math.floor(requested)));
}
