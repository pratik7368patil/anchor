export function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function truncateText(text: string | undefined, maxLength: number): string | undefined {
  if (!text) return undefined;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n[truncated by Anchor]`;
}

export function clipSentence(text: string, maxLength = 220): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

export function canonicalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^a-z0-9_./ -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeSearchText(text: string, maxTokens = 32): string[] {
  const tokens = text
    .toLowerCase()
    .match(/[a-z0-9_./-]{3,}/g);
  return uniqueStrings(tokens ?? []).slice(0, maxTokens);
}
