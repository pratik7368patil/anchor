import fs from "node:fs";
import path from "node:path";
import type {
  OrgRunHeartbeat,
  OrgRunHeartbeatStatus,
  OrgRunTimelineRepoSummary,
  OrgRunTimelineSnapshot,
  OrgRunTimelineStep,
  OrgRunTimelineStepStatus,
} from "../types.js";
import { orgRoot, validateOrgName } from "./config.js";

const HEARTBEAT_STALE_AFTER_MS = 2 * 60 * 1000;

export function orgHeartbeatPath(org: string, baseDir?: string): string {
  return path.join(orgRoot(validateOrgName(org), baseDir), "sync-heartbeat.json");
}

function atomicWriteJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

function processIsRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function parseHeartbeat(value: unknown): OrgRunHeartbeat | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<OrgRunHeartbeat>;
  if (
    typeof candidate.pid !== "number" ||
    typeof candidate.command !== "string" ||
    typeof candidate.org !== "string" ||
    typeof candidate.phase !== "string" ||
    typeof candidate.startedAt !== "string" ||
    typeof candidate.updatedAt !== "string"
  ) {
    return undefined;
  }
  return {
    pid: candidate.pid,
    command: candidate.command,
    org: candidate.org,
    repo: typeof candidate.repo === "string" ? candidate.repo : undefined,
    repoIndex: typeof candidate.repoIndex === "number" ? candidate.repoIndex : undefined,
    repoTotal: typeof candidate.repoTotal === "number" ? candidate.repoTotal : undefined,
    phase: candidate.phase,
    timeline: parseTimeline(candidate.timeline),
    startedAt: candidate.startedAt,
    updatedAt: candidate.updatedAt,
  };
}

function parseTimelineStatus(value: unknown): OrgRunTimelineStepStatus | undefined {
  if (
    value === "active" ||
    value === "done" ||
    value === "skipped" ||
    value === "warn" ||
    value === "fail" ||
    value === "wait"
  ) {
    return value;
  }
  return undefined;
}

function parseTimelineNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseTimelineStep(value: unknown): OrgRunTimelineStep | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<OrgRunTimelineStep>;
  const status = parseTimelineStatus(candidate.status);
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.label !== "string" ||
    !status ||
    typeof candidate.startedAt !== "string" ||
    typeof candidate.updatedAt !== "string"
  ) {
    return undefined;
  }
  return {
    id: candidate.id,
    label: candidate.label,
    status,
    startedAt: candidate.startedAt,
    updatedAt: candidate.updatedAt,
    completedAt: typeof candidate.completedAt === "string" ? candidate.completedAt : undefined,
    durationMs: parseTimelineNumber(candidate.durationMs),
    current: parseTimelineNumber(candidate.current),
    total: parseTimelineNumber(candidate.total),
    detail: typeof candidate.detail === "string" ? candidate.detail : undefined,
  };
}

function parseTimelineRepoSummary(value: unknown): OrgRunTimelineRepoSummary | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<OrgRunTimelineRepoSummary>;
  const status = parseTimelineStatus(candidate.status);
  if (typeof candidate.repo !== "string" || !status) return undefined;
  return {
    repo: candidate.repo,
    status,
    durationMs: parseTimelineNumber(candidate.durationMs) ?? 0,
    detail: typeof candidate.detail === "string" ? candidate.detail : undefined,
  };
}

function parseTimeline(value: unknown): OrgRunTimelineSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<OrgRunTimelineSnapshot>;
  if (!Array.isArray(candidate.steps) || !Array.isArray(candidate.recentRepos)) return undefined;
  const steps = candidate.steps.map(parseTimelineStep).filter((step) => step !== undefined);
  const recentRepos = candidate.recentRepos
    .map(parseTimelineRepoSummary)
    .filter((repo) => repo !== undefined);
  return {
    repo: typeof candidate.repo === "string" ? candidate.repo : undefined,
    repoIndex: parseTimelineNumber(candidate.repoIndex),
    repoTotal: parseTimelineNumber(candidate.repoTotal),
    activeStepId: typeof candidate.activeStepId === "string" ? candidate.activeStepId : undefined,
    steps,
    recentRepos,
  };
}

export function writeOrgHeartbeat(heartbeat: OrgRunHeartbeat, baseDir?: string): void {
  atomicWriteJson(orgHeartbeatPath(heartbeat.org, baseDir), heartbeat);
}

export function clearOrgHeartbeat(org: string, baseDir?: string): void {
  try {
    const filePath = orgHeartbeatPath(org, baseDir);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // Heartbeat cleanup must never fail the user-facing command.
  }
}

export function readOrgHeartbeat(org: string, baseDir?: string): OrgRunHeartbeatStatus | undefined {
  const filePath = orgHeartbeatPath(org, baseDir);
  if (!fs.existsSync(filePath)) return undefined;
  try {
    const heartbeat = parseHeartbeat(JSON.parse(fs.readFileSync(filePath, "utf8")));
    if (!heartbeat) return undefined;
    const now = Date.now();
    const startedAtMs = Date.parse(heartbeat.startedAt);
    const updatedAtMs = Date.parse(heartbeat.updatedAt);
    const pidRunning = processIsRunning(heartbeat.pid);
    const lastUpdateAgeSeconds = Number.isFinite(updatedAtMs)
      ? Math.max(0, Math.floor((now - updatedAtMs) / 1000))
      : 0;
    return {
      ...heartbeat,
      pidRunning,
      stale:
        !pidRunning ||
        !Number.isFinite(updatedAtMs) ||
        now - updatedAtMs > HEARTBEAT_STALE_AFTER_MS,
      elapsedSeconds: Number.isFinite(startedAtMs)
        ? Math.max(0, Math.floor((now - startedAtMs) / 1000))
        : 0,
      lastUpdateAgeSeconds,
    };
  } catch {
    return undefined;
  }
}
