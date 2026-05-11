import crypto from "node:crypto";
import path from "node:path";
import type { PullRequestRecord, SourceType, WisdomCategory, WisdomUnit } from "../types.js";
import { redactedHistoricalText, sanitizeHistoricalText } from "../security/sanitize.js";
import { canonicalizeText, uniqueStrings } from "../utils/text.js";
import { chunkHistoricalText, hasHighSignalLanguage } from "./chunker.js";

type SourceEntry = {
  sourceType: SourceType;
  text: string;
  filePaths: string[];
  authors: string[];
  createdAt: string;
  reviewer: boolean;
};

const CATEGORY_KEYWORDS: Array<[WisdomCategory, RegExp]> = [
  ["security_note", /\b(security|secret|token|bearer|oauth|credential|xss|csrf|injection|sanitize|redact)\b/i],
  ["architecture_decision", /\b(architecture decision|architectural|we intentionally|design decision)\b/i],
  ["bug_regression", /\b(regression|this broke|broke|breaking|root cause|bug|incident)\b/i],
  ["api_contract", /\b(contract|api|backward compatible|compatibility|public interface|schema)\b/i],
  ["constraint", /\b(do not|don't|must|should not|avoid|invariant|do not change|required)\b/i],
  ["testing_rule", /\b(test|tests|testing|spec|coverage|fixture|snapshot)\b/i],
  ["performance_note", /\b(performance|latency|lazy|eager|cache|n\+1|memory|throughput)\b/i],
  ["rejected_approach", /\b(rejected|decided against|alternative|do not use|instead of)\b/i],
  ["style_convention", /\b(style|convention|format|lint|naming|prettier)\b/i],
];

export function categorizeWisdom(text: string): WisdomCategory {
  for (const [category, pattern] of CATEGORY_KEYWORDS) {
    if (pattern.test(text)) return category;
  }
  return "unknown";
}

export function extractSymbols(text: string, filePaths: string[]): string[] {
  const symbols: string[] = [];
  const backticks = text.matchAll(/`([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)`/g);
  for (const match of backticks) symbols.push(match[1] ?? "");

  const declarations = text.matchAll(/\b(?:class|function|interface|type|const|let|var|enum)\s+([A-Za-z_$][\w$]*)/g);
  for (const match of declarations) symbols.push(match[1] ?? "");

  const functions = text.matchAll(/\b([A-Za-z_$][\w$]{2,})\s*\(/g);
  for (const match of functions) {
    const candidate = match[1] ?? "";
    if (!["if", "for", "while", "switch", "return", "describe", "it"].includes(candidate)) {
      symbols.push(candidate);
    }
  }

  for (const filePath of filePaths) {
    const basename = path.basename(filePath).replace(/\.[^.]+$/, "");
    if (/^[A-Za-z_$][\w$]*$/.test(basename)) symbols.push(basename);
  }

  return uniqueStrings(symbols).slice(0, 30);
}

function confidenceFor(entry: SourceEntry, text: string, category: WisdomCategory, duplicateCount: number): number {
  const sourceBase: Record<SourceType, number> = {
    pr_body: 0.58,
    review_comment: 0.66,
    issue_comment: 0.42,
    review_summary: 0.6,
    commit_message: 0.5,
    diff_context: 0.46,
  };
  let confidence = sourceBase[entry.sourceType];
  if (entry.filePaths.length > 0) confidence += 0.08;
  if (entry.reviewer) confidence += 0.1;
  if (/\b(regression|this broke|broke|root cause)\b/i.test(text)) confidence += 0.08;
  if (/\b(do not|don't|must|should not|avoid|invariant|contract)\b/i.test(text)) confidence += 0.08;
  if (category === "security_note" || category === "api_contract") confidence += 0.04;
  if (duplicateCount > 1) confidence += Math.min(0.08, duplicateCount * 0.02);
  return Math.max(0, Math.min(1, Number(confidence.toFixed(2))));
}

function stableWisdomId(
  pr: PullRequestRecord,
  sourceType: SourceType,
  text: string,
  filePaths: string[],
  createdAt: string,
  authors: string[],
): string {
  const hash = crypto
    .createHash("sha256")
    .update(
      [pr.repo, pr.number, sourceType, canonicalizeText(text), filePaths.join("|"), createdAt, authors.join("|")].join(
        "\0",
      ),
    )
    .digest("hex")
    .slice(0, 24);
  return `wu_${hash}`;
}

function prFilePaths(pr: PullRequestRecord): string[] {
  return uniqueStrings(pr.files.map((file) => file.filename));
}

function collectSources(pr: PullRequestRecord): SourceEntry[] {
  const touchedFiles = prFilePaths(pr);
  const author = pr.user?.login ?? "unknown";
  const sources: SourceEntry[] = [];

  if (pr.body?.trim()) {
    sources.push({
      sourceType: "pr_body",
      text: pr.body,
      filePaths: touchedFiles,
      authors: [author],
      createdAt: pr.created_at,
      reviewer: false,
    });
  }

  for (const review of pr.reviews ?? []) {
    if (!review.body?.trim()) continue;
    sources.push({
      sourceType: "review_summary",
      text: review.body,
      filePaths: touchedFiles,
      authors: [review.user?.login ?? "unknown"],
      createdAt: review.submitted_at ?? review.created_at ?? pr.updated_at ?? pr.created_at,
      reviewer: true,
    });
  }

  for (const comment of pr.reviewComments ?? []) {
    if (!comment.body?.trim()) continue;
    sources.push({
      sourceType: "review_comment",
      text: comment.body,
      filePaths: uniqueStrings([comment.path ?? "", ...touchedFiles]),
      authors: [comment.user?.login ?? "unknown"],
      createdAt: comment.created_at ?? pr.updated_at ?? pr.created_at,
      reviewer: true,
    });
  }

  for (const comment of pr.issueComments ?? []) {
    if (!comment.body?.trim()) continue;
    sources.push({
      sourceType: "issue_comment",
      text: comment.body,
      filePaths: touchedFiles,
      authors: [comment.user?.login ?? "unknown"],
      createdAt: comment.created_at ?? pr.updated_at ?? pr.created_at,
      reviewer: false,
    });
  }

  for (const commit of pr.commits ?? []) {
    const message = commit.commit?.message;
    if (!message?.trim()) continue;
    sources.push({
      sourceType: "commit_message",
      text: message,
      filePaths: touchedFiles,
      authors: [author],
      createdAt: pr.updated_at ?? pr.merged_at ?? pr.created_at,
      reviewer: false,
    });
  }

  for (const file of pr.files) {
    if (!file.patch?.trim() || !hasHighSignalLanguage(file.patch)) continue;
    sources.push({
      sourceType: "diff_context",
      text: file.patch,
      filePaths: [file.filename],
      authors: [author],
      createdAt: pr.updated_at ?? pr.merged_at ?? pr.created_at,
      reviewer: false,
    });
  }

  return sources;
}

export function extractWisdomUnits(pr: PullRequestRecord): WisdomUnit[] {
  const sourceChunks = collectSources(pr).flatMap((source) =>
    chunkHistoricalText(source.text).map((chunk) => ({ source, chunk })),
  );
  const duplicateCounts = new Map<string, number>();
  for (const { chunk } of sourceChunks) {
    const key = canonicalizeText(sanitizeHistoricalText(chunk)).slice(0, 220);
    duplicateCounts.set(key, (duplicateCounts.get(key) ?? 0) + 1);
  }

  const units: WisdomUnit[] = [];
  const seenIds = new Set<string>();
  for (const { source, chunk } of sourceChunks) {
    const redactedText = redactedHistoricalText(chunk);
    const sanitizedText = sanitizeHistoricalText(chunk);
    if (!sanitizedText) continue;
    const category = categorizeWisdom(sanitizedText);
    const filePaths = uniqueStrings(source.filePaths);
    const symbols = extractSymbols(`${sanitizedText}\n${filePaths.join("\n")}`, filePaths);
    const duplicateKey = canonicalizeText(sanitizedText).slice(0, 220);
    const id = stableWisdomId(pr, source.sourceType, sanitizedText, filePaths, source.createdAt, source.authors);
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    units.push({
      id,
      repo: pr.repo,
      prNumber: pr.number,
      prUrl: pr.html_url,
      sourceType: source.sourceType,
      category,
      text: redactedText,
      sanitizedText,
      filePaths,
      symbols,
      authors: source.authors,
      createdAt: source.createdAt,
      mergedAt: pr.merged_at ?? undefined,
      confidence: confidenceFor(source, sanitizedText, category, duplicateCounts.get(duplicateKey) ?? 1),
    });
  }

  return units;
}
