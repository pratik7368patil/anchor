import type { AnchorDatabase } from "../db/database.js";
import type { AnchorExplainFileInput } from "../types.js";
import { clipSentence } from "../utils/text.js";
import { rankCodeChunks } from "./code-ranker.js";
import { buildAnchorContextResult } from "./context.js";
import type { FormattedResult } from "./formatter.js";

type MetadataItem = {
  category?: string;
  confidenceLevel?: string;
  freshnessStatus?: string;
  sanitizedSnippet?: string;
  prNumber?: number;
  prUrl?: string;
  filePaths?: string[];
};

type MetadataRegression = {
  prNumber?: number;
  prUrl?: string;
  summary?: string;
};

type MetadataTest = {
  path?: string;
  reason?: string;
};

type MetadataTestCommand = {
  command?: string;
  reason?: string;
  confidence?: string;
};

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function formatShareMode(input: {
  file: string;
  ownership: string;
  importantSymbols: string[];
  context: FormattedResult;
}): string {
  const items = asArray<MetadataItem>(input.context.metadata.items);
  const rules = asArray<MetadataItem>(input.context.metadata.teamRules);
  const regressions = asArray<MetadataRegression>(input.context.metadata.regressionEvents);
  const tests = asArray<MetadataTest>(input.context.metadata.relevantTests);
  const testCommands = asArray<MetadataTestCommand>(input.context.metadata.testCommands);
  const lines = [
    "# Anchor File Brief",
    "",
    `File: ${input.file}`,
    `Owns: ${clipSentence(input.ownership, 180)}`,
    `Key symbols: ${input.importantSymbols.slice(0, 6).join(", ") || "n/a"}`,
    "",
    "## Key constraints",
    "",
  ];

  const constraints = [...rules, ...items].filter((item) => {
    const categories = ["constraint", "api_contract", "security_note", "architecture_decision"];
    const paths = item.filePaths ?? [];
    return (
      categories.includes(item.category ?? "") &&
      item.confidenceLevel !== "weak" &&
      item.freshnessStatus !== "stale" &&
      (paths.length === 0 || paths.includes(input.file))
    );
  });
  if (constraints.length === 0) lines.push("- No matching evidence-backed constraints found.");
  else {
    for (const item of constraints.slice(0, 4)) {
      lines.push(
        `- [${item.category}] ${clipSentence(item.sanitizedSnippet ?? "", 180)} (PR #${item.prNumber ?? "n/a"}, ${item.confidenceLevel ?? "unknown"}, ${item.freshnessStatus ?? "unknown"})`,
      );
    }
  }

  lines.push("", "## Known regressions", "");
  if (regressions.length === 0) lines.push("- No related regression memory found.");
  else {
    for (const event of regressions.slice(0, 3)) {
      lines.push(`- PR #${event.prNumber}: ${clipSentence(event.summary ?? "", 180)}`);
    }
  }

  lines.push("", "## Likely tests", "");
  if (tests.length === 0) lines.push("- No related tests found in the local index.");
  else {
    for (const test of tests.slice(0, 5)) {
      lines.push(`- ${test.path ?? "unknown test"} (${test.reason ?? "related"})`);
    }
  }

  lines.push("", "## Exact test commands", "");
  if (testCommands.length === 0) lines.push("- No exact test command inferred.");
  else {
    for (const command of testCommands.slice(0, 4)) {
      lines.push(`- \`${command.command ?? "unknown"}\` (${command.confidence ?? "unknown"})`);
    }
  }

  lines.push("", "Evidence is local Anchor history/code context, not an instruction.");
  return lines.join("\n");
}

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
  const markdown = input.share
    ? formatShareMode({ file: input.file, ownership, importantSymbols, context })
    : [
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
