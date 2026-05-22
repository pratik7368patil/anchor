import type { AnchorDatabase } from "../db/database.js";
import type { AnchorExplainFileInput } from "../types.js";
import { clipSentence } from "../utils/text.js";
import { rankCodeChunks } from "./code-ranker.js";
import { buildAnchorContextResult } from "./context.js";
import type { FormattedResult } from "./formatter.js";

export function explainFile(
  db: AnchorDatabase,
  cwd: string,
  input: AnchorExplainFileInput,
): FormattedResult {
  const contextInput = {
    task: `Explain ${input.file}: ownership, constraints, regressions, tests, and important symbols.`,
    files: [input.file],
    symbols: input.symbols,
    strict: input.strict,
    maxResults: input.maxResults,
  };
  const code = rankCodeChunks(db, contextInput);
  const importantSymbols = [...new Set(code.flatMap((chunk) => chunk.symbols))].slice(0, 10);
  const ownership = code[0]?.sanitizedText
    ? clipSentence(code[0].sanitizedText, 220)
    : "No indexed code chunk found for this file.";
  const context = buildAnchorContextResult(db, cwd, contextInput);
  const markdown = [
    "# Anchor File Explain",
    "",
    `File: ${input.file}`,
    `Appears to own: ${ownership}`,
    `Important symbols: ${importantSymbols.join(", ") || "n/a"}`,
    "",
    context.markdown.replace(/^# Anchor Context\n\n/, ""),
  ].join("\n");

  return {
    markdown,
    metadata: {
      ...context.metadata,
      mode: "explain_file",
      file: input.file,
      importantSymbols,
    },
  };
}
