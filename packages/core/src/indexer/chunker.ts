const HIGH_SIGNAL_PATTERN =
  /\b(because|we intentionally|do not|don't|must|should not|avoid|rejected|regression|breaking|contract|invariant|performance|security|secret|token|migration|compatibility|lazy|eager|thread-safe|race|deadlock|deprecated|backward compatible|do not change|this broke|root cause|architecture decision)\b/i;

export function hasHighSignalLanguage(text: string): boolean {
  return HIGH_SIGNAL_PATTERN.test(text);
}

export function chunkHistoricalText(text: string, maxChunkLength = 700): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const paragraphChunks = normalized
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  const chunks = paragraphChunks.length > 0 ? paragraphChunks : [normalized];
  const expanded: string[] = [];

  for (const chunk of chunks) {
    if (chunk.length <= maxChunkLength) {
      expanded.push(chunk);
      continue;
    }

    const sentences = chunk.split(/(?<=[.!?])\s+/);
    let current = "";
    for (const sentence of sentences) {
      if ((current + sentence).length > maxChunkLength && current) {
        expanded.push(current.trim());
        current = "";
      }
      current = `${current} ${sentence}`.trim();
    }
    if (current) expanded.push(current.trim());
  }

  return expanded.filter((chunk) => chunk.length >= 12 && hasHighSignalLanguage(chunk));
}
