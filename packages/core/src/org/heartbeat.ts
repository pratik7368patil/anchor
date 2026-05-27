import fs from "node:fs";
import path from "node:path";
import type { OrgRunHeartbeat, OrgRunHeartbeatStatus } from "../types.js";
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
    startedAt: candidate.startedAt,
    updatedAt: candidate.updatedAt,
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
