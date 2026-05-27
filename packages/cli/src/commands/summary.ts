import {
  getIndexStatus,
  getSuggestedPrompts,
  getWisdomCategoryCounts,
  type AnchorDatabase,
  type CodeIndexSummary,
  type IndexSummary,
} from "@pratik7368patil/anchor-core";
import { colorize, formatDurationMs, supportsColor, supportsUnicode } from "./progress.js";

type Stream = {
  isTTY?: boolean;
  columns?: number;
  write: (text: string) => boolean;
};

type Section = { label: string; value: string };

const SUMMARY_RULE_WIDTH = 48;

function bullet(unicode: boolean): string {
  return unicode ? " · " : " | ";
}

function renderSections(sections: Section[], color: boolean): string[] {
  const labelWidth = sections.reduce((max, section) => Math.max(max, section.label.length), 0);
  return sections.map(
    (section) =>
      ` ${colorize(color, "2", section.label.padEnd(labelWidth))}  ${section.value}`,
  );
}

/**
 * Persistent one-line banner printed before the live progress block (stderr by default),
 * replacing the older "Anchor X started / Repository / Database path" log lines.
 */
export function printRunHeader(input: {
  command: string;
  repo: string;
  databasePath: string;
  stream?: Stream;
}): void {
  const stream = input.stream ?? process.stderr;
  const color = supportsColor(stream);
  const unicode = supportsUnicode();
  const dot = colorize(color, "2", unicode ? "·" : "-");
  const brand = colorize(color, "1;36", unicode ? "⚓ Anchor" : "Anchor");
  stream.write(
    `${brand} ${dot} ${colorize(color, "1", input.command)} ${dot} ${input.repo}\n`,
  );
  stream.write(`${colorize(color, "2", input.databasePath)}\n`);
}

/**
 * Single structured end-of-run summary. Replaces the flat console.log dumps and the
 * separate index-outcome block so a run ends in exactly one grouped, aligned report.
 */
export function printIndexRunSummary(input: {
  cwd: string;
  db: AnchorDatabase;
  command: string;
  repo: string;
  durationMs: number;
  since?: string;
  history?: IndexSummary;
  code?: CodeIndexSummary;
  warn?: boolean;
  stream?: Stream;
}): void {
  const stream = input.stream ?? process.stdout;
  const color = supportsColor(stream);
  const unicode = supportsUnicode();
  const sep = bullet(unicode);
  const categories = getWisdomCategoryCounts(input.db);
  const status = getIndexStatus(input.cwd, false);
  const prompts = getSuggestedPrompts();
  const databasePath = input.history?.databasePath ?? input.code?.databasePath ?? "";

  const symbol = input.warn
    ? colorize(color, "33", unicode ? "!" : "warn")
    : colorize(color, "32", unicode ? "✓" : "ok");
  const headline = `${symbol} ${colorize(color, "1", `Anchor ${input.command} complete`)} ${colorize(
    color,
    "2",
    sep.trim(),
  )} ${input.repo} ${colorize(color, "2", `${sep.trim()} ${formatDurationMs(input.durationMs)}`)}`;

  const sections: Section[] = [];
  if (input.history) {
    const h = input.history;
    const parts = [
      `${h.indexedPrs} indexed`,
      `${h.indexedComments} comments`,
      `${h.wisdomUnitsCreated} wisdom`,
      `${h.regressionEventsCreated} regressions`,
    ];
    if (h.skippedItems > 0) parts.push(`${h.skippedItems} skipped`);
    sections.push({ label: "PR history", value: parts.join(sep) });
    sections.push({
      label: "Memory",
      value: [
        `${categories.architecture_decision ?? 0} decisions`,
        `${categories.constraint ?? 0} constraints`,
        `${categories.api_contract ?? 0} API contracts`,
        `${categories.security_note ?? 0} security notes`,
      ].join(sep),
    });
  }
  if (input.code) {
    const c = input.code;
    const codeParts = [
      `${c.indexedFiles} files`,
      `${c.codeChunksCreated} chunks`,
      `${c.testFilesIndexed} tests`,
      `${c.testLinksCreated} links`,
    ];
    if (c.skippedFiles > 0) codeParts.push(`${c.skippedFiles} skipped`);
    sections.push({ label: "Codebase", value: codeParts.join(sep) });
    sections.push({
      label: "Architecture",
      value: [
        `${c.architectureComponentsIndexed} components`,
        `${c.architecturePatternsIndexed} patterns`,
        `${c.architectureImportsIndexed} imports`,
      ].join(sep),
    });
  }
  sections.push({
    label: "Coverage",
    value: `${status.coverageScore}% ${colorize(color, "2", `(${status.coverageGrade})`)}`,
  });
  if (databasePath) sections.push({ label: "Database", value: colorize(color, "2", databasePath) });
  const nextPrompt = prompts[1]?.prompt ?? prompts[0]?.prompt;
  if (nextPrompt) sections.push({ label: "Next", value: colorize(color, "2", nextPrompt) });

  stream.write("\n");
  stream.write(`${headline}\n`);
  stream.write(`${colorize(color, "2", (unicode ? "─" : "-").repeat(SUMMARY_RULE_WIDTH))}\n`);
  for (const line of renderSections(sections, color)) stream.write(`${line}\n`);
}
