import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  defaultDatabasePath,
  openAnchorDatabase,
  type AnchorDatabase,
  type CodeIndexSummary,
} from "@pratik7368patil/anchor-core";
import { runDemo } from "./demo.js";
import { printIndexRunSummary, printRunHeader } from "./summary.js";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anchor-summary-test-"));
  tempDirs.push(dir);
  return dir;
}

function captureStream(): PassThrough & { isTTY: boolean; columns: number; text: () => string } {
  const stream = new PassThrough() as PassThrough & {
    isTTY: boolean;
    columns: number;
    text: () => string;
  };
  stream.isTTY = true;
  stream.columns = 100;
  let output = "";
  stream.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
  });
  stream.text = () => output;
  return stream;
}

function fakeCodeSummary(databasePath: string): CodeIndexSummary {
  return {
    indexedFiles: 3500,
    codeChunksCreated: 12400,
    testFilesIndexed: 240,
    testLinksCreated: 310,
    architectureComponentsIndexed: 180,
    architecturePatternsIndexed: 64,
    architectureImportsIndexed: 5200,
    skippedFiles: 12,
    databasePath,
  };
}

let previousNoColor: string | undefined;

beforeEach(() => {
  previousNoColor = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
});

afterEach(() => {
  if (previousNoColor === undefined) delete process.env.NO_COLOR;
  else process.env.NO_COLOR = previousNoColor;
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("printRunHeader", () => {
  it("prints a single banner line with command, repo, and database path", () => {
    const stream = captureStream();
    printRunHeader({
      command: "index",
      repo: "owner/repo",
      databasePath: "/tmp/.anchor/index.sqlite",
      stream,
    });
    const output = stream.text();
    expect(output).toContain("Anchor");
    expect(output).toContain("index");
    expect(output).toContain("owner/repo");
    expect(output).toContain("/tmp/.anchor/index.sqlite");
    expect(output).not.toMatch(/\[[0-9;]*m/);
  });
});

describe("printIndexRunSummary", () => {
  it("renders one grouped summary with codebase, coverage, and database sections", () => {
    const cwd = tempDir();
    runDemo({ path: cwd });
    const databasePath = defaultDatabasePath(cwd);
    const db: AnchorDatabase = openAnchorDatabase(cwd, databasePath);
    const stream = captureStream();
    try {
      printIndexRunSummary({
        cwd,
        db,
        command: "index-code",
        repo: "owner/repo",
        durationMs: 64000,
        code: fakeCodeSummary(databasePath),
        stream,
      });
    } finally {
      db.close();
    }
    const output = stream.text();
    expect(output).toContain("Anchor index-code complete");
    expect(output).toContain("owner/repo");
    expect(output).toContain("Codebase");
    expect(output).toContain("3500 files");
    expect(output).toContain("Architecture");
    expect(output).toContain("Coverage");
    expect(output).toContain("Database");
    expect(output).toContain(databasePath);
    // Single grouped block: no legacy flat "Indexed code files:" key/value dump.
    expect(output).not.toContain("Indexed code files:");
    expect(output).not.toMatch(/\[[0-9;]*m/);
  });
});
