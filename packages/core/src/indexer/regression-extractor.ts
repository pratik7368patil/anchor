import crypto from "node:crypto";
import type { PullRequestRecord, RegressionEvent } from "../types.js";
import { sanitizeHistoricalText } from "../security/sanitize.js";
import { canonicalizeText, clipSentence, uniqueStrings } from "../utils/text.js";
import { extractSymbols } from "./wisdom-extractor.js";
import { isTestFilePath } from "./test-awareness.js";

const REGRESSION_SIGNALS: Array<[string, RegExp]> = [
  ["regression", /\bregression\b/i],
  ["revert", /\b(revert|reverted)\b/i],
  ["rollback", /\brollback\b/i],
  ["hotfix", /\bhotfix\b/i],
  ["incident", /\bincident\b/i],
  ["root cause", /\broot cause\b/i],
  ["this broke", /\b(this broke|broke)\b/i],
  ["fixed by", /\bfixed by\b/i],
];

function labels(pr: PullRequestRecord): string[] {
  return (pr.labels ?? [])
    .map((label) => (typeof label === "string" ? label : label.name))
    .filter((label): label is string => Boolean(label));
}

function sourceTexts(pr: PullRequestRecord): string[] {
  return [
    pr.title,
    pr.body ?? "",
    ...labels(pr),
    ...(pr.reviews ?? []).map((item) => item.body ?? ""),
    ...(pr.reviewComments ?? []).map((item) => item.body ?? ""),
    ...(pr.issueComments ?? []).map((item) => item.body ?? ""),
    ...(pr.commits ?? []).map((item) => item.commit?.message ?? ""),
  ].filter((text) => text.trim());
}

function stableRegressionId(pr: PullRequestRecord, summary: string, signals: string[]): string {
  const hash = crypto
    .createHash("sha256")
    .update([pr.repo, pr.number, canonicalizeText(summary), signals.join("|")].join("\0"))
    .digest("hex")
    .slice(0, 24);
  return `re_${hash}`;
}

export function extractRegressionEvents(pr: PullRequestRecord): RegressionEvent[] {
  const allText = sourceTexts(pr).join("\n");
  const signals = REGRESSION_SIGNALS.filter(([, pattern]) => pattern.test(allText)).map(
    ([signal]) => signal,
  );
  if (signals.length === 0) return [];

  const files = uniqueStrings(pr.files.map((file) => file.filename));
  const testPaths = files.filter(isTestFilePath);
  const sanitizedSummary = sanitizeHistoricalText(
    clipSentence(`${pr.title}. ${pr.body ?? ""}`, 420),
  );
  if (!sanitizedSummary) return [];

  const reviewerCount = (pr.reviews ?? []).length + (pr.reviewComments ?? []).length;
  const confidence = Math.min(
    1,
    Number((0.58 + signals.length * 0.06 + (reviewerCount > 0 ? 0.08 : 0)).toFixed(2)),
  );
  const authors = uniqueStrings([
    pr.user?.login ?? "unknown",
    ...(pr.reviewComments ?? []).map((comment) => comment.user?.login ?? "unknown"),
  ]);
  const event: RegressionEvent = {
    id: stableRegressionId(pr, sanitizedSummary, signals),
    repo: pr.repo,
    prNumber: pr.number,
    prUrl: pr.html_url,
    summary: sanitizedSummary,
    filePaths: files,
    symbols: extractSymbols(`${sanitizedSummary}\n${files.join("\n")}`, files),
    testPaths,
    authors,
    labels: labels(pr),
    signals: uniqueStrings(signals),
    createdAt: pr.created_at,
    mergedAt: pr.merged_at ?? undefined,
    confidence,
  };
  return [event];
}
