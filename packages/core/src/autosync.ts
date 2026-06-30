import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listOrgNames, loadOrgConfig } from "./org/config.js";
import { detectGitHubRepo, detectGitRoot } from "./utils/git.js";

export type AutosyncMode = "daily" | "off";
export type AutosyncJobKind = "repo" | "org" | "org-graph";
export type AutosyncSchedule = "daily" | "weekly";
export type AutosyncRunStatus = "success" | "failed" | "partial" | "skipped";

export type AutosyncRunRecord = {
  startedAt: string;
  finishedAt?: string;
  status: AutosyncRunStatus;
  message?: string;
  durationMs?: number;
};

export type AutosyncJob = {
  id: string;
  kind: AutosyncJobKind;
  label: string;
  schedule: AutosyncSchedule;
  enabled: boolean;
  repoRoot?: string;
  repo?: string;
  org?: string;
  nodePath: string;
  anchorScriptPath: string;
  args: string[];
  logPath: string;
  lockPath: string;
  timeoutMs: number;
  createdAt: string;
  updatedAt: string;
  lastRun?: AutosyncRunRecord;
};

export type AutosyncConfig = {
  version: 1;
  enabled: boolean;
  updatedAt: string;
  jobs: AutosyncJob[];
};

export type AutosyncInstallJobResult = {
  id: string;
  label: string;
  kind: AutosyncJobKind;
  schedule: AutosyncSchedule;
  scheduler: string;
  installed: boolean;
  nextRunHint: string;
  logPath: string;
  message: string;
};

export type AutosyncInstallResult = {
  enabled: boolean;
  configPath: string;
  jobs: AutosyncInstallJobResult[];
  warnings: string[];
};

export type AutosyncStatusJob = {
  id: string;
  label: string;
  kind: AutosyncJobKind;
  schedule: AutosyncSchedule;
  enabled: boolean;
  scheduler: string;
  schedulerDetected: boolean;
  logPath: string;
  lastRun?: AutosyncRunRecord;
  stale: boolean;
  failing: boolean;
};

export type AutosyncStatus = {
  enabled: boolean;
  configured: boolean;
  configPath: string;
  scheduler: string;
  jobs: AutosyncStatusJob[];
  lastRun?: AutosyncRunRecord;
  warnings: string[];
};

export type AutosyncInstallOptions = {
  cwd: string;
  mode?: AutosyncMode;
  nodePath?: string;
  anchorScriptPath: string;
  platform?: NodeJS.Platform;
  homeDir?: string;
  orgBaseDir?: string;
  runner?: CommandRunner;
};

export type CommandRunner = (
  command: string,
  args: string[],
  options?: { cwd?: string; input?: string },
) => string;

type SchedulerArtifact = {
  scheduler: string;
  filePath?: string;
  label?: string;
  nextRunHint: string;
};

const CONFIG_VERSION = 1;
const REPO_TIMEOUT_MS = 45 * 60 * 1000;
const ORG_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const GRAPH_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const STALE_RUN_MS = 36 * 60 * 60 * 1000;

export function autosyncRoot(homeDir = os.homedir()): string {
  return path.join(homeDir, ".anchor");
}

export function autosyncConfigPath(homeDir = os.homedir()): string {
  return path.join(autosyncRoot(homeDir), "autosync", "config.json");
}

export function autosyncLogsRoot(homeDir = os.homedir()): string {
  return path.join(autosyncRoot(homeDir), "logs", "autosync");
}

export function autosyncLocksRoot(homeDir = os.homedir()): string {
  return path.join(autosyncRoot(homeDir), "locks", "autosync");
}

export function autosyncJobIdForRepo(repoRoot: string): string {
  return `repo-${stableHashText(path.resolve(repoRoot))}`;
}

export function autosyncJobIdForOrg(org: string): string {
  return `org-${safeName(org)}`;
}

export function autosyncJobIdForOrgGraph(org: string): string {
  return `org-graph-${safeName(org)}`;
}

export function autosyncLockPath(jobId: string, homeDir = os.homedir()): string {
  return path.join(autosyncLocksRoot(homeDir), `${safeName(jobId)}.lock`);
}

export function defaultCommandRunner(
  command: string,
  args: string[],
  options: { cwd?: string; input?: string } = {},
): string {
  return execFileSync(command, args, {
    cwd: options.cwd,
    input: options.input,
    encoding: "utf8",
    stdio: options.input === undefined ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
  }).trim();
}

export function readAutosyncConfig(homeDir = os.homedir()): AutosyncConfig | undefined {
  const filePath = autosyncConfigPath(homeDir);
  if (!fs.existsSync(filePath)) return undefined;
  return normalizeAutosyncConfig(JSON.parse(fs.readFileSync(filePath, "utf8")));
}

export function writeAutosyncConfig(config: AutosyncConfig, homeDir = os.homedir()): void {
  const filePath = autosyncConfigPath(homeDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

export function installDefaultAutosync(options: AutosyncInstallOptions): AutosyncInstallResult {
  const homeDir = options.homeDir ?? os.homedir();
  if (options.mode === "off") return disableAutosync({ ...options, homeDir });

  const gitRoot = detectGitRoot(options.cwd);
  if (!gitRoot) {
    return {
      enabled: false,
      configPath: autosyncConfigPath(homeDir),
      jobs: [],
      warnings: ["Autosync was not installed because no git repository was detected."],
    };
  }

  const now = new Date().toISOString();
  const existing = readAutosyncConfig(homeDir) ?? {
    version: CONFIG_VERSION,
    enabled: true,
    updatedAt: now,
    jobs: [],
  };
  const repo = detectGitHubRepo(gitRoot)?.fullName;
  const nodePath = path.resolve(options.nodePath ?? process.execPath);
  const anchorScriptPath = path.resolve(options.anchorScriptPath);
  const jobs = new Map(existing.jobs.map((job) => [job.id, job]));
  const installJobs: AutosyncJob[] = [];

  const repoJob = buildRepoJob({
    repoRoot: gitRoot,
    repo,
    nodePath,
    anchorScriptPath,
    homeDir,
    now,
    previous: jobs.get(autosyncJobIdForRepo(gitRoot)),
  });
  jobs.set(repoJob.id, repoJob);
  installJobs.push(repoJob);

  for (const org of discoverConfiguredOrgs(options.orgBaseDir)) {
    const orgJob = buildOrgJob({
      org,
      nodePath,
      anchorScriptPath,
      homeDir,
      now,
      previous: jobs.get(autosyncJobIdForOrg(org)),
    });
    const graphJob = buildOrgGraphJob({
      org,
      nodePath,
      anchorScriptPath,
      homeDir,
      now,
      previous: jobs.get(autosyncJobIdForOrgGraph(org)),
    });
    jobs.set(orgJob.id, orgJob);
    jobs.set(graphJob.id, graphJob);
    installJobs.push(orgJob, graphJob);
  }

  const config: AutosyncConfig = {
    version: CONFIG_VERSION,
    enabled: true,
    updatedAt: now,
    jobs: [...jobs.values()].sort((a, b) => a.id.localeCompare(b.id)),
  };
  writeAutosyncConfig(config, homeDir);

  const warnings: string[] = [];
  const results = installJobs.map((job) => {
    try {
      return installSchedulerJob(job, {
        platform: options.platform ?? process.platform,
        homeDir,
        runner: options.runner ?? defaultCommandRunner,
      });
    } catch (error) {
      warnings.push(`${job.label}: ${error instanceof Error ? error.message : String(error)}`);
      const artifact = schedulerArtifactForJob(job, options.platform ?? process.platform, homeDir);
      return {
        id: job.id,
        label: job.label,
        kind: job.kind,
        schedule: job.schedule,
        scheduler: artifact.scheduler,
        installed: false,
        nextRunHint: artifact.nextRunHint,
        logPath: job.logPath,
        message: "Scheduler install failed; rerun anchor init after fixing local scheduler access.",
      };
    }
  });

  return {
    enabled: true,
    configPath: autosyncConfigPath(homeDir),
    jobs: results,
    warnings,
  };
}

export function disableAutosync(
  options: Pick<AutosyncInstallOptions, "homeDir" | "platform" | "runner"> = {},
): AutosyncInstallResult {
  const homeDir = options.homeDir ?? os.homedir();
  const config = readAutosyncConfig(homeDir);
  const warnings: string[] = [];
  if (config) {
    const disabled = {
      ...config,
      enabled: false,
      updatedAt: new Date().toISOString(),
      jobs: config.jobs.map((job) => ({ ...job, enabled: false, updatedAt: new Date().toISOString() })),
    };
    writeAutosyncConfig(disabled, homeDir);
    for (const job of config.jobs) {
      try {
        removeSchedulerJob(job, {
          platform: options.platform ?? process.platform,
          homeDir,
          runner: options.runner ?? defaultCommandRunner,
        });
      } catch (error) {
        warnings.push(`${job.label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return {
    enabled: false,
    configPath: autosyncConfigPath(homeDir),
    jobs: [],
    warnings,
  };
}

export function getAutosyncStatus(options: {
  cwd?: string;
  homeDir?: string;
  platform?: NodeJS.Platform;
} = {}): AutosyncStatus {
  const homeDir = options.homeDir ?? os.homedir();
  const platform = options.platform ?? process.platform;
  const config = readAutosyncConfig(homeDir);
  const scheduler = schedulerName(platform);
  if (!config) {
    return {
      enabled: false,
      configured: false,
      configPath: autosyncConfigPath(homeDir),
      scheduler,
      jobs: [],
      warnings: ["Autosync is not configured. Run anchor init to install local autosync."],
    };
  }

  const gitRoot = options.cwd ? detectGitRoot(options.cwd) : undefined;
  const matchingRepoJobId = gitRoot ? autosyncJobIdForRepo(gitRoot) : undefined;
  const jobs = config.jobs.map((job) => {
    const detected = schedulerArtifactExists(job, platform, homeDir);
    const stale = isAutosyncJobStale(job);
    const failing = job.lastRun?.status === "failed";
    return {
      id: job.id,
      label: job.label,
      kind: job.kind,
      schedule: job.schedule,
      enabled: job.enabled,
      scheduler,
      schedulerDetected: detected,
      logPath: job.logPath,
      lastRun: job.lastRun,
      stale,
      failing,
    };
  });
  const relevantJobs = matchingRepoJobId
    ? jobs.filter((job) => job.id === matchingRepoJobId || job.kind !== "repo")
    : jobs;
  const warnings: string[] = [];
  if (!config.enabled) warnings.push("Autosync is disabled.");
  if (matchingRepoJobId && !jobs.some((job) => job.id === matchingRepoJobId)) {
    warnings.push("Autosync is not installed for this repository. Run anchor init.");
  }
  for (const job of relevantJobs) {
    if (job.enabled && !job.schedulerDetected) {
      warnings.push(`${job.label} scheduler file is missing. Run anchor init.`);
    }
    if (job.failing) warnings.push(`${job.label} last run failed.`);
    if (job.stale) warnings.push(`${job.label} has not completed recently.`);
  }
  return {
    enabled: config.enabled,
    configured: true,
    configPath: autosyncConfigPath(homeDir),
    scheduler,
    jobs: relevantJobs,
    lastRun: latestAutosyncRun(
      relevantJobs.map((job) => job.lastRun).filter((run): run is AutosyncRunRecord => Boolean(run)),
    ),
    warnings,
  };
}

export function acquireAutosyncLock(
  jobId: string,
  homeDir = os.homedir(),
): { acquired: boolean; lockPath: string; release: () => void; message?: string } {
  const lockPath = autosyncLockPath(jobId, homeDir);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  try {
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), {
      flag: "wx",
      mode: 0o600,
    });
  } catch {
    const existing = readLock(lockPath);
    if (existing?.pid && processIsRunning(existing.pid)) {
      return {
        acquired: false,
        lockPath,
        release: () => undefined,
        message: `Autosync job ${jobId} is already running as pid ${existing.pid}.`,
      };
    }
    fs.rmSync(lockPath, { force: true });
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), {
      flag: "wx",
      mode: 0o600,
    });
  }
  return {
    acquired: true,
    lockPath,
    release: () => fs.rmSync(lockPath, { force: true }),
  };
}

export function recordAutosyncRun(
  jobId: string,
  run: AutosyncRunRecord,
  homeDir = os.homedir(),
): void {
  const config = readAutosyncConfig(homeDir);
  if (!config) return;
  writeAutosyncConfig(
    {
      ...config,
      updatedAt: new Date().toISOString(),
      jobs: config.jobs.map((job) =>
        job.id === jobId ? { ...job, lastRun: run, updatedAt: new Date().toISOString() } : job,
      ),
    },
    homeDir,
  );
}

export function resolveAutosyncJob(kind: AutosyncJobKind, input: { cwd?: string; org?: string }): AutosyncJob {
  const config = readAutosyncConfig();
  if (!config) throw new Error("Autosync is not configured. Run anchor init.");
  const jobId =
    kind === "repo"
      ? autosyncJobIdForRepo(input.cwd ?? process.cwd())
      : kind === "org"
        ? autosyncJobIdForOrg(requiredOrg(input.org))
        : autosyncJobIdForOrgGraph(requiredOrg(input.org));
  const job = config.jobs.find((item) => item.id === jobId);
  if (!job) throw new Error(`Autosync job ${jobId} is not configured. Run anchor init.`);
  return job;
}

function buildRepoJob(input: {
  repoRoot: string;
  repo?: string;
  nodePath: string;
  anchorScriptPath: string;
  homeDir: string;
  now: string;
  previous?: AutosyncJob;
}): AutosyncJob {
  const id = autosyncJobIdForRepo(input.repoRoot);
  return {
    id,
    kind: "repo",
    label: `Repo autosync${input.repo ? `: ${input.repo}` : ""}`,
    schedule: "daily",
    enabled: true,
    repoRoot: input.repoRoot,
    repo: input.repo,
    nodePath: input.nodePath,
    anchorScriptPath: input.anchorScriptPath,
    args: ["internal", "autosync-run", "--kind", "repo", "--cwd", input.repoRoot],
    logPath: path.join(autosyncLogsRoot(input.homeDir), `${id}.log`),
    lockPath: autosyncLockPath(id, input.homeDir),
    timeoutMs: REPO_TIMEOUT_MS,
    createdAt: input.previous?.createdAt ?? input.now,
    updatedAt: input.now,
    lastRun: input.previous?.lastRun,
  };
}

function buildOrgJob(input: {
  org: string;
  nodePath: string;
  anchorScriptPath: string;
  homeDir: string;
  now: string;
  previous?: AutosyncJob;
}): AutosyncJob {
  const id = autosyncJobIdForOrg(input.org);
  return {
    id,
    kind: "org",
    label: `Org autosync: ${input.org}`,
    schedule: "daily",
    enabled: true,
    org: input.org,
    nodePath: input.nodePath,
    anchorScriptPath: input.anchorScriptPath,
    args: ["internal", "autosync-run", "--kind", "org", "--org", input.org, "--no-graph"],
    logPath: path.join(autosyncLogsRoot(input.homeDir), `${id}.log`),
    lockPath: autosyncLockPath(id, input.homeDir),
    timeoutMs: ORG_TIMEOUT_MS,
    createdAt: input.previous?.createdAt ?? input.now,
    updatedAt: input.now,
    lastRun: input.previous?.lastRun,
  };
}

function buildOrgGraphJob(input: {
  org: string;
  nodePath: string;
  anchorScriptPath: string;
  homeDir: string;
  now: string;
  previous?: AutosyncJob;
}): AutosyncJob {
  const id = autosyncJobIdForOrgGraph(input.org);
  return {
    id,
    kind: "org-graph",
    label: `Org graph autosync: ${input.org}`,
    schedule: "weekly",
    enabled: true,
    org: input.org,
    nodePath: input.nodePath,
    anchorScriptPath: input.anchorScriptPath,
    args: ["internal", "autosync-run", "--kind", "org-graph", "--org", input.org],
    logPath: path.join(autosyncLogsRoot(input.homeDir), `${id}.log`),
    lockPath: autosyncLockPath(id, input.homeDir),
    timeoutMs: GRAPH_TIMEOUT_MS,
    createdAt: input.previous?.createdAt ?? input.now,
    updatedAt: input.now,
    lastRun: input.previous?.lastRun,
  };
}

function discoverConfiguredOrgs(baseDir?: string): string[] {
  return listOrgNames(baseDir).filter((org) => {
    try {
      return loadOrgConfig(org, baseDir).repos.some((repo) => repo.enabled);
    } catch {
      return false;
    }
  });
}

function installSchedulerJob(
  job: AutosyncJob,
  options: { platform: NodeJS.Platform; homeDir: string; runner: CommandRunner },
): AutosyncInstallJobResult {
  fs.mkdirSync(path.dirname(job.logPath), { recursive: true });
  const artifact = schedulerArtifactForJob(job, options.platform, options.homeDir);
  if (options.platform === "darwin") installLaunchdJob(job, artifact, options.runner);
  else if (options.platform === "linux") installLinuxJob(job, artifact, options);
  else if (options.platform === "win32") installWindowsJob(job, artifact, options.runner);
  else throw new Error(`Unsupported autosync scheduler platform: ${options.platform}`);
  return {
    id: job.id,
    label: job.label,
    kind: job.kind,
    schedule: job.schedule,
    scheduler: artifact.scheduler,
    installed: true,
    nextRunHint: artifact.nextRunHint,
    logPath: job.logPath,
    message: "Installed local scheduler job.",
  };
}

function removeSchedulerJob(
  job: AutosyncJob,
  options: { platform: NodeJS.Platform; homeDir: string; runner: CommandRunner },
): void {
  const artifact = schedulerArtifactForJob(job, options.platform, options.homeDir);
  if (options.platform === "darwin") {
    const uid = process.getuid?.();
    if (artifact.filePath && uid !== undefined) {
      try {
        options.runner("launchctl", ["bootout", `gui/${uid}`, artifact.filePath]);
      } catch {
        // Best effort cleanup.
      }
    }
    if (artifact.filePath) fs.rmSync(artifact.filePath, { force: true });
    return;
  }
  if (options.platform === "linux") {
    if (artifact.filePath) {
      const timerPath = artifact.filePath.replace(/\.service$/, ".timer");
      try {
        options.runner("systemctl", ["--user", "disable", "--now", path.basename(timerPath)]);
      } catch {
        // Best effort cleanup.
      }
      fs.rmSync(artifact.filePath, { force: true });
      fs.rmSync(timerPath, { force: true });
    }
    removeCronBlock(job.id, options.runner);
    return;
  }
  if (options.platform === "win32") {
    try {
      options.runner("schtasks", ["/Delete", "/F", "/TN", windowsTaskName(job)]);
    } catch {
      // Best effort cleanup.
    }
  }
}

function schedulerArtifactForJob(
  job: AutosyncJob,
  platform: NodeJS.Platform,
  homeDir: string,
): SchedulerArtifact {
  const time = scheduleTime(job);
  if (platform === "darwin") {
    const label = `com.anchor.autosync.${safeName(job.id)}`;
    return {
      scheduler: "launchd",
      label,
      filePath: path.join(homeDir, "Library", "LaunchAgents", `${label}.plist`),
      nextRunHint: `${job.schedule} around ${time.hourLabel}`,
    };
  }
  if (platform === "linux") {
    const unit = `anchor-autosync-${safeName(job.id)}`;
    return {
      scheduler: "systemd-user",
      label: unit,
      filePath: path.join(homeDir, ".config", "systemd", "user", `${unit}.service`),
      nextRunHint: `${job.schedule} around ${time.hourLabel}`,
    };
  }
  if (platform === "win32") {
    return {
      scheduler: "windows-task-scheduler",
      label: windowsTaskName(job),
      nextRunHint: `${job.schedule} around ${time.hourLabel}`,
    };
  }
  return { scheduler: "unsupported", nextRunHint: "n/a" };
}

function schedulerArtifactExists(job: AutosyncJob, platform: NodeJS.Platform, homeDir: string): boolean {
  const artifact = schedulerArtifactForJob(job, platform, homeDir);
  if (platform === "win32") return true;
  if (platform === "linux") {
    return Boolean(
      artifact.filePath &&
        (fs.existsSync(artifact.filePath) ||
          fs.existsSync(path.join(homeDir, ".config", "systemd", "user", `${artifact.label}.timer`)) ||
          cronHasBlock(job.id)),
    );
  }
  return Boolean(artifact.filePath && fs.existsSync(artifact.filePath));
}

function installLaunchdJob(job: AutosyncJob, artifact: SchedulerArtifact, runner: CommandRunner): void {
  if (!artifact.filePath || !artifact.label) throw new Error("Missing launchd artifact path.");
  fs.mkdirSync(path.dirname(artifact.filePath), { recursive: true });
  fs.writeFileSync(artifact.filePath, launchdPlist(job, artifact.label), { mode: 0o644 });
  const uid = process.getuid?.();
  if (uid === undefined) return;
  try {
    runner("launchctl", ["bootout", `gui/${uid}`, artifact.filePath]);
  } catch {
    // Replacing a missing job is normal.
  }
  runner("launchctl", ["bootstrap", `gui/${uid}`, artifact.filePath]);
  runner("launchctl", ["enable", `gui/${uid}/${artifact.label}`]);
}

function installLinuxJob(
  job: AutosyncJob,
  artifact: SchedulerArtifact,
  options: { homeDir: string; runner: CommandRunner },
): void {
  if (!artifact.filePath || !artifact.label) throw new Error("Missing systemd artifact path.");
  const timerPath = artifact.filePath.replace(/\.service$/, ".timer");
  fs.mkdirSync(path.dirname(artifact.filePath), { recursive: true });
  fs.writeFileSync(artifact.filePath, systemdService(job), { mode: 0o644 });
  fs.writeFileSync(timerPath, systemdTimer(job), { mode: 0o644 });
  try {
    options.runner("systemctl", ["--user", "daemon-reload"]);
    options.runner("systemctl", ["--user", "enable", "--now", path.basename(timerPath)]);
  } catch {
    installCronFallback(job, options.runner);
  }
}

function installWindowsJob(job: AutosyncJob, artifact: SchedulerArtifact, runner: CommandRunner): void {
  const time = scheduleTime(job);
  const args = [
    "/Create",
    "/F",
    "/TN",
    artifact.label ?? windowsTaskName(job),
    "/TR",
    `${quoteWindows(job.nodePath)} ${quoteWindows(job.anchorScriptPath)} ${job.args.map(quoteWindows).join(" ")}`,
    "/SC",
    job.schedule === "weekly" ? "WEEKLY" : "DAILY",
    "/ST",
    `${pad2(time.hour)}:${pad2(time.minute)}`,
  ];
  if (job.schedule === "weekly") args.push("/D", "MON");
  runner("schtasks", args);
}

function launchdPlist(job: AutosyncJob, label: string): string {
  const time = scheduleTime(job);
  const calendar =
    job.schedule === "weekly"
      ? `<dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>${time.hour}</integer><key>Minute</key><integer>${time.minute}</integer></dict>`
      : `<dict><key>Hour</key><integer>${time.hour}</integer><key>Minute</key><integer>${time.minute}</integer></dict>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xmlEscape(label)}</string>
  <key>ProgramArguments</key>
  <array>
${[job.nodePath, job.anchorScriptPath, ...job.args].map((arg) => `    <string>${xmlEscape(arg)}</string>`).join("\n")}
  </array>
  <key>StartCalendarInterval</key>${calendar}
  <key>StandardOutPath</key><string>${xmlEscape(job.logPath)}</string>
  <key>StandardErrorPath</key><string>${xmlEscape(job.logPath)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>${xmlEscape(os.homedir())}</string>
    <key>PATH</key><string>${xmlEscape(process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin")}</string>
    <key>SHELL</key><string>${xmlEscape(process.env.SHELL ?? "/bin/sh")}</string>
    <key>ANCHOR_PROGRESS</key><string>plain</string>
  </dict>
</dict>
</plist>
`;
}

function systemdService(job: AutosyncJob): string {
  return `[Unit]
Description=${job.label}

[Service]
Type=oneshot
Environment=ANCHOR_PROGRESS=plain
Environment=HOME=${systemdEscape(os.homedir())}
Environment=PATH=${systemdEscape(process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin")}
Environment=SHELL=${systemdEscape(process.env.SHELL ?? "/bin/sh")}
ExecStart=${systemdEscape(job.nodePath)} ${[job.anchorScriptPath, ...job.args].map(systemdEscape).join(" ")}
StandardOutput=append:${job.logPath}
StandardError=append:${job.logPath}
`;
}

function systemdTimer(job: AutosyncJob): string {
  const time = scheduleTime(job);
  const calendar =
    job.schedule === "weekly"
      ? `Mon *-*-* ${pad2(time.hour)}:${pad2(time.minute)}:00`
      : `*-*-* ${pad2(time.hour)}:${pad2(time.minute)}:00`;
  return `[Unit]
Description=${job.label} timer

[Timer]
OnCalendar=${calendar}
Persistent=true

[Install]
WantedBy=timers.target
`;
}

function installCronFallback(job: AutosyncJob, runner: CommandRunner): void {
  const existing = readCrontab(runner);
  const withoutBlock = removeCronBlockFromText(existing, job.id);
  const time = scheduleTime(job);
  const weekday = job.schedule === "weekly" ? "1" : "*";
  const command = `HOME=${shellQuote(os.homedir())} PATH=${shellQuote(process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin")} SHELL=${shellQuote(process.env.SHELL ?? "/bin/sh")} ANCHOR_PROGRESS=plain ${shellQuote(job.nodePath)} ${shellQuote(job.anchorScriptPath)} ${job.args.map(shellQuote).join(" ")} >> ${shellQuote(job.logPath)} 2>&1`;
  const block = [
    `# anchor autosync start ${job.id}`,
    `${time.minute} ${time.hour} * * ${weekday} ${command}`,
    `# anchor autosync end ${job.id}`,
  ].join("\n");
  runner("crontab", ["-"], { input: `${withoutBlock.trim()}\n${block}\n` });
}

function removeCronBlock(jobId: string, runner: CommandRunner): void {
  const existing = readCrontab(runner);
  const next = removeCronBlockFromText(existing, jobId);
  if (next !== existing) runner("crontab", ["-"], { input: next.trim() ? `${next.trim()}\n` : "" });
}

function readCrontab(runner: CommandRunner): string {
  try {
    return runner("crontab", ["-l"]);
  } catch {
    return "";
  }
}

function removeCronBlockFromText(text: string, jobId: string): string {
  const start = `# anchor autosync start ${jobId}`;
  const end = `# anchor autosync end ${jobId}`;
  const lines = text.split("\n");
  const kept: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (line.trim() === start) {
      skipping = true;
      continue;
    }
    if (line.trim() === end) {
      skipping = false;
      continue;
    }
    if (!skipping) kept.push(line);
  }
  return kept.join("\n").trim();
}

function cronHasBlock(_jobId: string): boolean {
  return false;
}

function scheduleTime(job: AutosyncJob): { hour: number; minute: number; hourLabel: string } {
  const offset = stableHashNumber(job.id) % 180;
  const baseHour = job.schedule === "weekly" ? 3 : 9;
  const hour = (baseHour + Math.floor(offset / 60)) % 24;
  const minute = offset % 60;
  return { hour, minute, hourLabel: `${pad2(hour)}:${pad2(minute)}` };
}

function isAutosyncJobStale(job: AutosyncJob): boolean {
  if (!job.enabled) return false;
  if (!job.lastRun?.finishedAt) return false;
  if (job.lastRun.status === "failed") return true;
  return Date.now() - Date.parse(job.lastRun.finishedAt) > STALE_RUN_MS;
}

function latestAutosyncRun(runs: AutosyncRunRecord[]): AutosyncRunRecord | undefined {
  return runs.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0];
}

function normalizeAutosyncConfig(value: unknown): AutosyncConfig {
  const candidate = value as AutosyncConfig;
  return {
    version: CONFIG_VERSION,
    enabled: Boolean(candidate.enabled),
    updatedAt: candidate.updatedAt ?? new Date().toISOString(),
    jobs: Array.isArray(candidate.jobs) ? candidate.jobs : [],
  };
}

function readLock(lockPath: string): { pid?: number } | undefined {
  try {
    return JSON.parse(fs.readFileSync(lockPath, "utf8")) as { pid?: number };
  } catch {
    return undefined;
  }
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function requiredOrg(org?: string): string {
  if (!org) throw new Error("Pass --org <org>.");
  return org;
}

function schedulerName(platform: NodeJS.Platform): string {
  if (platform === "darwin") return "launchd";
  if (platform === "linux") return "systemd-user";
  if (platform === "win32") return "windows-task-scheduler";
  return "unsupported";
}

function stableHashNumber(value: string): number {
  let hash = 5381;
  for (const char of value) hash = ((hash << 5) + hash + char.charCodeAt(0)) >>> 0;
  return hash;
}

function stableHashText(value: string): string {
  const hash = stableHashNumber(value);
  return hash.toString(36);
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, "-");
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function systemdEscape(value: string): string {
  return value.includes(" ") ? `"${value.replaceAll('"', '\\"')}"` : value;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function quoteWindows(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`;
}

function windowsTaskName(job: AutosyncJob): string {
  return `AnchorAutosync-${safeName(job.id)}`;
}
