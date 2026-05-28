import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AnchorDatabase } from "../db/database.js";
import { initializeSchema } from "../db/database.js";
import type {
  RetrievalEvalCase,
  RetrievalEvalRunResult,
  WisdomCategory,
} from "../types.js";
import { buildAnchorContextResult } from "../retrieval/context.js";
import { uniqueStrings } from "../utils/text.js";

export const ANCHOR_EVALS_FILE = "anchor.evals.json";

type EvalFile = {
  version: 1;
  evals: RetrievalEvalCase[];
};

type MetadataItem = {
  prNumber?: number;
  category?: WisdomCategory;
};

const DEFAULT_EVAL_K = 8;

function evalsPath(cwd: string): string {
  return path.join(cwd, ANCHOR_EVALS_FILE);
}

function defaultEvalFile(): EvalFile {
  return { version: 1, evals: [] };
}

function asEvalFile(value: unknown): EvalFile {
  if (!value || typeof value !== "object") return defaultEvalFile();
  const record = value as Record<string, unknown>;
  const evals = Array.isArray(record.evals)
    ? record.evals
        .map((item): RetrievalEvalCase | undefined => {
          if (!item || typeof item !== "object") return undefined;
          const raw = item as Record<string, unknown>;
          if (typeof raw.id !== "string" || typeof raw.task !== "string") return undefined;
          return {
            id: raw.id,
            task: raw.task,
            files: Array.isArray(raw.files)
              ? raw.files.filter((file): file is string => typeof file === "string")
              : [],
            expectedPrs: Array.isArray(raw.expectedPrs)
              ? raw.expectedPrs.filter((pr): pr is number => typeof pr === "number")
              : [],
            expectedCategories: Array.isArray(raw.expectedCategories)
              ? raw.expectedCategories.filter(
                  (category): category is WisdomCategory => typeof category === "string",
                )
              : [],
          };
        })
        .filter((item): item is RetrievalEvalCase => Boolean(item))
    : [];
  return { version: 1, evals };
}

function readEvalFile(cwd: string): EvalFile {
  const filePath = evalsPath(cwd);
  if (!fs.existsSync(filePath)) return defaultEvalFile();
  try {
    return asEvalFile(JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown);
  } catch {
    return defaultEvalFile();
  }
}

function writeEvalFile(cwd: string, file: EvalFile): string {
  const filePath = evalsPath(cwd);
  fs.writeFileSync(filePath, `${JSON.stringify(file, null, 2)}\n`);
  return filePath;
}

function evalId(task: string, files: string[], expectedPrs: number[]): string {
  return crypto
    .createHash("sha256")
    .update(`${task}\0${files.join(",")}\0${expectedPrs.join(",")}`)
    .digest("hex")
    .slice(0, 16);
}

function isWisdomCategory(value: string): value is WisdomCategory {
  return [
    "architecture_decision",
    "constraint",
    "rejected_approach",
    "bug_regression",
    "testing_rule",
    "api_contract",
    "performance_note",
    "security_note",
    "style_convention",
    "unknown",
  ].includes(value);
}

export function initRetrievalEvals(cwd: string): { path: string; created: boolean } {
  const filePath = evalsPath(cwd);
  if (fs.existsSync(filePath)) return { path: filePath, created: false };
  return { path: writeEvalFile(cwd, defaultEvalFile()), created: true };
}

export function addRetrievalEval(
  db: AnchorDatabase,
  cwd: string,
  input: {
    task: string;
    files?: string[];
    expectedPrs?: number[];
    expectedCategories?: WisdomCategory[];
  },
): RetrievalEvalCase {
  initializeSchema(db);
  initRetrievalEvals(cwd);
  const file = readEvalFile(cwd);
  const next: RetrievalEvalCase = {
    id: evalId(input.task, input.files ?? [], input.expectedPrs ?? []),
    task: input.task,
    files: uniqueStrings(input.files ?? []),
    expectedPrs: uniqueStrings((input.expectedPrs ?? []).map(String)).map(Number),
    expectedCategories: uniqueStrings(input.expectedCategories ?? []).filter(isWisdomCategory),
  };
  const evals = [...file.evals.filter((item) => item.id !== next.id), next];
  writeEvalFile(cwd, { version: 1, evals });
  db.prepare(
    `INSERT INTO retrieval_evals
     (id, task, files_json, expected_prs_json, expected_categories_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       task = excluded.task,
       files_json = excluded.files_json,
       expected_prs_json = excluded.expected_prs_json,
       expected_categories_json = excluded.expected_categories_json`,
  ).run(
    next.id,
    next.task,
    JSON.stringify(next.files),
    JSON.stringify(next.expectedPrs),
    JSON.stringify(next.expectedCategories),
    new Date().toISOString(),
  );
  return next;
}

export function runRetrievalEvals(
  db: AnchorDatabase,
  cwd: string,
): RetrievalEvalRunResult {
  initializeSchema(db);
  const filePath = evalsPath(cwd);
  const evalFile = readEvalFile(cwd);
  const k = DEFAULT_EVAL_K;
  const results = evalFile.evals.map((item) => {
    const context = buildAnchorContextResult(db, cwd, {
      task: item.task,
      files: item.files,
      maxResults: 12,
    });
    const metadataItems = [
      ...((Array.isArray(context.metadata.items) ? context.metadata.items : []) as MetadataItem[]),
      ...((Array.isArray(context.metadata.teamRules)
        ? context.metadata.teamRules
        : []) as MetadataItem[]),
    ];
    const rankedPrs = uniqueStrings(
      metadataItems
        .map((metadata) => metadata.prNumber)
        .filter((prNumber): prNumber is number => typeof prNumber === "number")
        .map(String),
    ).map(Number);
    const foundPrs = uniqueStrings(
      metadataItems
        .map((metadata) => metadata.prNumber)
        .filter((prNumber): prNumber is number => typeof prNumber === "number")
        .map(String),
    ).map(Number);
    const foundCategories = uniqueStrings(
      metadataItems
        .map((metadata) => metadata.category)
        .filter((category): category is WisdomCategory => typeof category === "string"),
    ).filter(isWisdomCategory);
    const missingPrs = item.expectedPrs.filter((prNumber) => !foundPrs.includes(prNumber));
    const missingCategories = item.expectedCategories.filter(
      (category) => !foundCategories.includes(category),
    );
    const expectedPrRanks = item.expectedPrs.map((prNumber) => {
      const index = rankedPrs.indexOf(prNumber);
      return {
        prNumber,
        rank: index >= 0 ? index + 1 : undefined,
      };
    });
    const topK = rankedPrs.slice(0, k);
    const relevantInTopK = item.expectedPrs.filter((prNumber) => topK.includes(prNumber));
    const precisionAtK =
      k > 0 ? Number((relevantInTopK.length / k).toFixed(4)) : 0;
    const recallAtK =
      item.expectedPrs.length > 0
        ? Number((relevantInTopK.length / item.expectedPrs.length).toFixed(4))
        : 0;
    const reciprocalRank = (() => {
      if (item.expectedPrs.length === 0) return 0;
      const firstRank = expectedPrRanks
        .map((entry) => entry.rank)
        .filter((rank): rank is number => typeof rank === "number")
        .sort((a, b) => a - b)[0];
      if (!firstRank) return 0;
      return Number((1 / firstRank).toFixed(4));
    })();
    return {
      id: item.id,
      task: item.task,
      passed: missingPrs.length === 0 && missingCategories.length === 0,
      expectedPrs: item.expectedPrs,
      foundPrs,
      missingPrs,
      expectedPrRanks,
      expectedCategories: item.expectedCategories,
      foundCategories,
      missingCategories,
      precisionAtK,
      recallAtK,
      reciprocalRank,
    };
  });
  const passed = results.filter((result) => result.passed).length;
  const precisionAtK =
    results.length > 0
      ? Number(
          (
            results.reduce((sum, result) => sum + result.precisionAtK, 0) / results.length
          ).toFixed(4),
        )
      : 0;
  const recallAtK =
    results.length > 0
      ? Number(
          (results.reduce((sum, result) => sum + result.recallAtK, 0) / results.length).toFixed(4),
        )
      : 0;
  const mrr =
    results.length > 0
      ? Number(
          (
            results.reduce((sum, result) => sum + result.reciprocalRank, 0) / results.length
          ).toFixed(4),
        )
      : 0;
  return {
    ok: passed === results.length,
    path: filePath,
    total: results.length,
    passed,
    failed: results.length - passed,
    precisionAtK,
    recallAtK,
    mrr,
    k,
    results,
  };
}
