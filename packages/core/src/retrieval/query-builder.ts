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

export function buildFtsQuery(input: AnchorContextInput | SearchHistoryInput): string {
  const files = input.files ?? [];
  const symbols = "symbols" in input ? (input.symbols ?? []) : [];
  const categories = "categories" in input ? (input.categories ?? []) : [];
  const diff = "diff" in input ? truncateText(input.diff, 5000) : undefined;
  const currentCode = "currentCode" in input ? truncateText(input.currentCode, 5000) : undefined;
  const baseText = "task" in input ? input.task : input.query;
  const fileTerms = files.flatMap((file) => [
    file,
    path.basename(file),
    ...path.dirname(file).split(/[\\/]/).filter(Boolean),
  ]);
  const tokens = uniqueStrings([
    ...tokenizeSearchText(baseText, 24),
    ...tokenizeSearchText(fileTerms.join(" "), 24),
    ...tokenizeSearchText(symbols.join(" "), 24),
    ...tokenizeSearchText(categories.join(" "), 12),
    ...tokenizeSearchText(diff ?? "", 18),
    ...tokenizeSearchText(currentCode ?? "", 18),
    ...CATEGORY_HINTS.filter((hint) => baseText.toLowerCase().includes(hint)),
  ])
    .map(ftsToken)
    .filter((token): token is string => Boolean(token))
    .slice(0, 48);

  return tokens.join(" OR ");
}

export function clampMaxResults(value: number | undefined, defaultValue: number): number {
  const requested = value ?? defaultValue;
  return Math.max(1, Math.min(12, Math.floor(requested)));
}
