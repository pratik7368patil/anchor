import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { getIndexStatus } from "@pratik7368patil/anchor-core";
import { runIndexCode } from "./index.js";
import { runRulesInit, runRulesList, runRulesValidate } from "./rules.js";

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

describe("rules commands", () => {
  it("initializes, validates, and lists committed team rules", () => {
    const cwd = tempDir();
    const init = runRulesInit(cwd);
    expect(fs.existsSync(init.path)).toBe(true);
    expect(init.created).toBe(true);
    expect(runRulesValidate(cwd).ok).toBe(true);

    fs.writeFileSync(
      path.join(cwd, "anchor.rules.json"),
      JSON.stringify(
        {
          version: 1,
          rules: [
            {
              id: "api-contract",
              category: "api_contract",
              text: "Keep `createMembership` backward compatible.",
              symbols: ["createMembership"],
              evidence: [
                {
                  prNumber: 10,
                  prUrl: "https://github.com/owner/repo/pull/10",
                  sourceType: "pr_body",
                },
              ],
            },
          ],
        },
        null,
        2,
      ),
    );

    const listed = runRulesList(cwd);
    expect(listed.rules).toHaveLength(1);
    expect(listed.rules[0]?.id).toBe("api-contract");
  });
});
