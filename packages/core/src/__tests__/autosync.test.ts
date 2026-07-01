import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireAutosyncLock,
  autosyncConfigPath,
  getAutosyncStatus,
  installDefaultAutosync,
  readAutosyncConfig,
  recordAutosyncRun,
} from "../index.js";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "anchor-autosync-test-"));
  tempDirs.push(dir);
  return dir;
}

function createGitRepo(): string {
  const dir = tempDir();
  execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["remote", "add", "origin", "https://github.com/owner/repo.git"], {
    cwd: dir,
    stdio: "ignore",
  });
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("autosync", () => {
  it("installs a repo autosync job with absolute paths and no token values", () => {
    const cwd = createGitRepo();
    const homeDir = tempDir();
    const commands: string[] = [];
    const result = installDefaultAutosync({
      cwd: fs.realpathSync(cwd),
      homeDir,
      orgBaseDir: path.join(homeDir, "orgs"),
      platform: "linux",
      nodePath: "/usr/local/bin/node",
      anchorScriptPath: "/usr/local/bin/anchor",
      runner: (command, args) => {
        commands.push([command, ...args].join(" "));
        if (command === "systemctl") throw new Error("systemd unavailable");
        if (command === "crontab" && args[0] === "-l") return "";
        return "";
      },
    });

    expect(result.enabled).toBe(true);
    expect(result.jobs.some((job) => job.kind === "repo" && job.installed)).toBe(true);
    expect(commands.some((command) => command.startsWith("crontab -"))).toBe(true);

    const rawConfig = fs.readFileSync(autosyncConfigPath(homeDir), "utf8");
    expect(rawConfig).toContain("/usr/local/bin/node");
    expect(rawConfig).toContain("/usr/local/bin/anchor");
    expect(rawConfig).not.toMatch(/GITHUB_TOKEN|GH_TOKEN|npm_/);

    const config = readAutosyncConfig(homeDir);
    expect(config?.jobs[0]?.args).toEqual([
      "internal",
      "autosync-run",
      "--kind",
      "repo",
      "--cwd",
      fs.realpathSync(cwd),
    ]);
  });

  it("can be disabled without leaving enabled jobs in config", () => {
    const cwd = createGitRepo();
    const homeDir = tempDir();
    installDefaultAutosync({
      cwd,
      homeDir,
      orgBaseDir: path.join(homeDir, "orgs"),
      platform: "linux",
      nodePath: "/usr/local/bin/node",
      anchorScriptPath: "/usr/local/bin/anchor",
      runner: () => "",
    });

    const disabled = installDefaultAutosync({
      cwd,
      homeDir,
      orgBaseDir: path.join(homeDir, "orgs"),
      platform: "linux",
      mode: "off",
      anchorScriptPath: "/usr/local/bin/anchor",
      runner: () => "",
    });

    expect(disabled.enabled).toBe(false);
    const config = readAutosyncConfig(homeDir);
    expect(config?.enabled).toBe(false);
    expect(config?.jobs.every((job) => !job.enabled)).toBe(true);
  });

  it("prevents overlapping runs with a lock file", () => {
    const homeDir = tempDir();
    const first = acquireAutosyncLock("repo-test", homeDir);
    const second = acquireAutosyncLock("repo-test", homeDir);

    expect(first.acquired).toBe(true);
    expect(second.acquired).toBe(false);
    expect(second.message).toContain("already running");

    first.release();
    const third = acquireAutosyncLock("repo-test", homeDir);
    expect(third.acquired).toBe(true);
    third.release();
  });

  it("reports failing autosync jobs in status", () => {
    const cwd = createGitRepo();
    const homeDir = tempDir();
    installDefaultAutosync({
      cwd,
      homeDir,
      orgBaseDir: path.join(homeDir, "orgs"),
      platform: "linux",
      nodePath: "/usr/local/bin/node",
      anchorScriptPath: "/usr/local/bin/anchor",
      runner: () => "",
    });
    const job = readAutosyncConfig(homeDir)?.jobs[0];
    expect(job).toBeDefined();
    recordAutosyncRun(
      job!.id,
      {
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        status: "failed",
        message: "network unavailable",
      },
      homeDir,
    );

    const status = getAutosyncStatus({ cwd, homeDir, platform: "linux" });
    expect(status.enabled).toBe(true);
    expect(status.jobs[0]?.failing).toBe(true);
    expect(status.warnings.join("\n")).toContain("last run failed");
  });
});
