import type { SemanticStatus } from "../types.js";

export type LocalEmbeddingProvider = {
  name: string;
  isAvailable(): boolean;
  embed(texts: string[]): Promise<number[][]>;
};

export function getSemanticStatus(
  env: NodeJS.ProcessEnv = process.env,
  provider?: LocalEmbeddingProvider,
): SemanticStatus {
  if (env.ANCHOR_SEMANTIC !== "local") {
    return {
      enabled: false,
      mode: "disabled",
      available: false,
      reason: "Semantic search is disabled; SQLite FTS is active.",
    };
  }

  if (!provider || !provider.isAvailable()) {
    return {
      enabled: true,
      mode: "local",
      available: false,
      reason:
        "Local semantic search requested, but no local embedding provider is available; falling back to SQLite FTS.",
    };
  }

  return {
    enabled: true,
    mode: "local",
    available: true,
    reason: `Using local embedding provider: ${provider.name}.`,
  };
}
