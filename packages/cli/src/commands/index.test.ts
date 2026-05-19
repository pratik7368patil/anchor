import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { getIndexStatus } from "@pratik7368patil/anchor-core";
import { runIndexCode } from "./index.js";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anchor-cli-test-"));
  tempDirs.push(dir);
  return dir;
}

function writeFileEnsuringDir(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("index-code command", () => {
  it("indexes local code without GitHub authentication", async () => {
    const cwd = tempDir();
    execFileSync("git", ["init"], { cwd, stdio: "ignore" });
    execFileSync("git", ["remote", "add", "origin", "git@github.com:owner/repo.git"], {
      cwd,
      stdio: "ignore",
    });
    writeFileEnsuringDir(
      path.join(cwd, "src/index.ts"),
      "export function localContext() { return 'code'; }\n",
    );
    execFileSync("git", ["add", "src/index.ts"], { cwd, stdio: "ignore" });

    await runIndexCode(cwd, { token: undefined });

    const status = getIndexStatus(cwd, false);
    expect(status.codeFileCount).toBe(1);
    expect(status.codeChunkCount).toBeGreaterThan(0);
  });
});
