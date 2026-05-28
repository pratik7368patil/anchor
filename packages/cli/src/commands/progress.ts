import readline from "node:readline";
import { clearOrgHeartbeat, redactSecrets, writeOrgHeartbeat } from "@pratik7368patil/anchor-core";
import type {
  CodeIndexProgress,
  FetchPullRequestsProgress,
  IndexPullRequestsProgress,
  OrgGraphProgress,
  OrgCloneProgress,
  OrgLifecycleProgress,
  OrgRunHeartbeat,
  OrgRunTimelineSnapshot,
  OrgRunTimelineStepStatus,
} from "@pratik7368patil/anchor-core";

export type ProgressMode = "pretty" | "plain" | "off";

type ProgressStream = {
  isTTY?: boolean;
  columns?: number;
  write: (text: string) => boolean;
};

type ProgressTaskState = "active" | "done" | "skip" | "warn" | "fail" | "wait";

type ProgressTask = {
  key: string;
  label: string;
  phase?: string;
  current?: number;
  total?: number;
  detail?: string;
  state?: ProgressTaskState;
  pinned?: boolean;
  timelineStepId?: string;
  timelineLabel?: string;
  timelineRepo?: string;
  timelineRepoIndex?: number;
  timelineRepoTotal?: number;
};

type RenderedProgressTask = ProgressTask & {
  startedAt: number;
  updatedAt: number;
};

type TimelineStep = {
  id: string;
  label: string;
  status: ProgressTaskState;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  current?: number;
  total?: number;
  detail?: string;
};

type TimelineRepoSummary = {
  repo: string;
  status: ProgressTaskState;
  durationMs: number;
  detail?: string;
};

type TimelineSnapshot = {
  command: string;
  org: string;
  repo?: string;
  repoIndex?: number;
  repoTotal?: number;
  activeStepId?: string;
  steps: TimelineStep[];
  recentRepos: TimelineRepoSummary[];
  slowestSteps: Array<{ label: string; repo?: string; durationMs: number }>;
  startedAt: number;
  updatedAt: number;
  completed: boolean;
};

export function parseProgressMode(value: string): ProgressMode {
  if (value === "pretty" || value === "plain" || value === "off") return value;
  throw new Error("Invalid ANCHOR_PROGRESS value. Use pretty, plain, or off.");
}

function progressModeFromEnvironment(): ProgressMode | undefined {
  const value = process.env.ANCHOR_PROGRESS;
  if (!value) return undefined;
  return parseProgressMode(value);
}

function resolveProgressMode(input?: {
  progress?: ProgressMode;
  json?: boolean;
  stream?: ProgressStream;
}): ProgressMode {
  if (input?.json) return "off";
  if (input?.progress) return input.progress;
  const envMode = progressModeFromEnvironment();
  if (envMode) return envMode;
  const stream = input?.stream ?? process.stderr;
  if (process.env.CI || !stream.isTTY) return "plain";
  return "pretty";
}

function formatElapsed(startedAt: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

export function formatDurationMs(durationMs: number): string {
  if (durationMs < 1000) return `${Math.max(1, Math.round(durationMs))}ms`;
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${remainder}s`;
}

function timelineStatus(state: ProgressTaskState): OrgRunTimelineStepStatus {
  return state === "skip" ? "skipped" : state;
}

function sanitizeTimelineDetail(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return redactSecrets(value.replace(/\s+/g, " ")).slice(0, 220);
}

export function supportsColor(stream: ProgressStream): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== "0") return true;
  return Boolean(stream.isTTY);
}

export function supportsUnicode(): boolean {
  if (process.env.ANCHOR_ASCII_PROGRESS === "1") return false;
  if (process.env.TERM === "dumb") return false;
  return process.platform !== "win32" || Boolean(process.env.WT_SESSION || process.env.CI);
}

export function colorize(enabled: boolean, code: string, text: string): string {
  return enabled ? `\u001b[${code}m${text}\u001b[0m` : text;
}

function visibleLength(text: string): number {
  return text.replace(/\u001b\[[0-9;]*m/g, "").length;
}

function truncateEnd(text: string, maxLength: number): string {
  if (maxLength <= 0) return "";
  if (visibleLength(text) <= maxLength) return text;
  const plain = text.replace(/\u001b\[[0-9;]*m/g, "");
  return `${plain.slice(0, Math.max(0, maxLength - 1))}…`;
}

function truncateMiddle(text: string, maxLength: number): string {
  if (maxLength <= 0) return "";
  if (text.length <= maxLength) return text;
  if (maxLength < 8) return text.slice(0, maxLength);
  const left = Math.ceil((maxLength - 1) / 2);
  const right = Math.floor((maxLength - 1) / 2);
  return `${text.slice(0, left)}…${text.slice(text.length - right)}`;
}

function formatPercent(current?: number, total?: number): string {
  if (typeof current !== "number" || typeof total !== "number" || total <= 0) return "";
  return `${Math.round(Math.max(0, Math.min(1, current / total)) * 100)}%`;
}

function formatRate(task: RenderedProgressTask): string {
  if (typeof task.current !== "number" || task.current <= 0) return "";
  const seconds = Math.max(0.5, (Date.now() - task.startedAt) / 1000);
  if (seconds < 2) return "";
  const rate = task.current / seconds;
  if (rate >= 10) return `${Math.round(rate)}/s`;
  return `${rate.toFixed(1)}/s`;
}

function formatEta(task: RenderedProgressTask): string {
  if (
    typeof task.current !== "number" ||
    typeof task.total !== "number" ||
    task.current <= 0 ||
    task.current >= task.total
  ) {
    return "";
  }
  const seconds = Math.max(0.5, (Date.now() - task.startedAt) / 1000);
  if (seconds < 3) return "";
  const remaining = Math.ceil(((task.total - task.current) * seconds) / task.current);
  if (remaining < 60) return `${remaining}s left`;
  return `${Math.floor(remaining / 60)}m ${remaining % 60}s left`;
}

function progressBar(
  current: number | undefined,
  total: number | undefined,
  width: number,
  input: { unicode: boolean; color: boolean; state: ProgressTaskState },
): string {
  if (typeof current !== "number" || typeof total !== "number" || total <= 0 || width <= 0) {
    return "";
  }
  const ratio = Math.max(0, Math.min(1, current / total));
  const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
  const filledChar = input.unicode ? "━" : "=";
  const emptyChar = input.unicode ? "─" : "-";
  const headChar = input.unicode ? "╸" : ">";
  const full = filled >= width;
  const body = full
    ? filledChar.repeat(width)
    : `${filledChar.repeat(Math.max(0, filled))}${headChar}${emptyChar.repeat(
        Math.max(0, width - filled - 1),
      )}`;
  const color =
    input.state === "warn" || input.state === "wait"
      ? "33"
      : input.state === "fail"
        ? "31"
        : input.state === "skip"
          ? "2"
        : input.state === "done"
          ? "32"
          : "36";
  return colorize(input.color, color, body);
}

class ProgressTimelineTracker {
  private readonly startedAt = Date.now();
  private readonly steps = new Map<string, TimelineStep>();
  private readonly recentRepos: TimelineRepoSummary[] = [];
  private readonly slowestSteps: Array<{ label: string; repo?: string; durationMs: number }> = [];
  private currentRepo: string | undefined;
  private currentRepoIndex: number | undefined;
  private currentRepoTotal: number | undefined;
  private repoStartedAt = Date.now();
  private updatedAt = Date.now();
  private activeStepId: string | undefined;
  private completed = false;

  constructor(
    private readonly command: string,
    private readonly org: string,
  ) {}

  update(task: ProgressTask): string[] {
    const logs: string[] = [];
    const now = Date.now();
    this.updatedAt = now;
    this.completed = false;

    if (task.timelineRepo) {
      const isNewRepo = this.currentRepo !== task.timelineRepo;
      this.currentRepo = task.timelineRepo;
      this.currentRepoIndex = task.timelineRepoIndex;
      this.currentRepoTotal = task.timelineRepoTotal;
      if (isNewRepo) {
        this.steps.clear();
        this.repoStartedAt = now;
      }
    }

    if (task.timelineStepId) {
      logs.push(...this.updateStep(task, now));
    }

    if (task.timelineStepId === "repo_complete") {
      this.completeRepo(task, now);
    }

    if (task.timelineStepId === "run_complete" || task.timelineStepId === "run_failed") {
      this.completed = true;
    }

    return logs;
  }

  snapshot(): TimelineSnapshot {
    return {
      command: this.command,
      org: this.org,
      repo: this.currentRepo,
      repoIndex: this.currentRepoIndex,
      repoTotal: this.currentRepoTotal,
      activeStepId: this.activeStepId,
      steps: [...this.steps.values()],
      recentRepos: [...this.recentRepos],
      slowestSteps: [...this.slowestSteps],
      startedAt: this.startedAt,
      updatedAt: this.updatedAt,
      completed: this.completed,
    };
  }

  heartbeatSnapshot(): OrgRunTimelineSnapshot {
    const snapshot = this.snapshot();
    return {
      repo: snapshot.repo,
      repoIndex: snapshot.repoIndex,
      repoTotal: snapshot.repoTotal,
      activeStepId: snapshot.activeStepId,
      steps: snapshot.steps.slice(-12).map((step) => ({
        id: step.id,
        label: step.label,
        status: timelineStatus(step.status),
        startedAt: new Date(step.startedAt).toISOString(),
        updatedAt: new Date(step.updatedAt).toISOString(),
        completedAt: step.completedAt ? new Date(step.completedAt).toISOString() : undefined,
        durationMs: step.completedAt
          ? step.completedAt - step.startedAt
          : Math.max(0, Date.now() - step.startedAt),
        current: step.current,
        total: step.total,
        detail: sanitizeTimelineDetail(step.detail),
      })),
      recentRepos: snapshot.recentRepos.slice(-4).map((repo) => ({
        repo: repo.repo,
        status: timelineStatus(repo.status),
        durationMs: repo.durationMs,
        detail: sanitizeTimelineDetail(repo.detail),
      })),
    };
  }

  finalSummaryLines(): string[] {
    const lines: string[] = [];
    if (this.recentRepos.length > 0) {
      lines.push("[anchor] Org run timeline summary:");
      for (const repo of this.recentRepos.slice(-8)) {
        lines.push(
          `[anchor] ${statusText(repo.status)} ${repo.repo} in ${formatDurationMs(repo.durationMs)}${repo.detail ? ` (${repo.detail})` : ""}`,
        );
      }
    }
    if (this.slowestSteps.length > 0) {
      lines.push("[anchor] Slowest timeline steps:");
      for (const step of this.slowestSteps.slice(0, 5)) {
        const repo = step.repo ? `${step.repo}: ` : "";
        lines.push(`[anchor] ${repo}${step.label} took ${formatDurationMs(step.durationMs)}`);
      }
    }
    return lines;
  }

  private updateStep(task: ProgressTask, now: number): string[] {
    const id = task.timelineStepId ?? task.key;
    const status = task.state ?? "active";
    const previous = this.steps.get(id);
    const label = task.timelineLabel ?? task.label;
    const detail = sanitizeTimelineDetail(task.detail);
    const logs: string[] = [];
    const step: TimelineStep = {
      id,
      label,
      status,
      startedAt: previous?.startedAt ?? now,
      updatedAt: now,
      completedAt: previous?.completedAt,
      current: task.current,
      total: task.total,
      detail,
    };

    if (!previous) {
      this.completePreviousActiveStep(id, now);
      logs.push(`[anchor] ${timelineRepoLabel(this.snapshot(), task)}: ${statusText("active")} ${label} started`);
    }

    if (isTerminalTimelineState(status)) {
      step.completedAt = previous?.completedAt ?? now;
      this.recordSlowStep(step, task.timelineRepo ?? this.currentRepo);
      if (!previous?.completedAt) {
        logs.push(
          `[anchor] ${timelineRepoLabel(this.snapshot(), task)}: ${statusText(status)} ${label}${formatTimelineCount(task)} in ${formatDurationMs(step.completedAt - step.startedAt)}${detail ? ` (${detail})` : ""}`,
        );
      }
      if (this.activeStepId === id) this.activeStepId = undefined;
    } else {
      this.activeStepId = id;
    }

    this.steps.set(id, step);
    return logs;
  }

  private completeRepo(task: ProgressTask, now: number): void {
    if (!this.currentRepo) return;
    const status = task.state ?? "done";
    const durationMs = Math.max(0, now - this.repoStartedAt);
    this.recentRepos.push({
      repo: this.currentRepo,
      status,
      durationMs,
      detail: sanitizeTimelineDetail(task.detail),
    });
    if (this.recentRepos.length > 12) this.recentRepos.shift();
  }

  private completePreviousActiveStep(nextStepId: string, now: number): void {
    if (!this.activeStepId || this.activeStepId === nextStepId) return;
    const previous = this.steps.get(this.activeStepId);
    if (!previous || isTerminalTimelineState(previous.status)) return;
    previous.status = "done";
    previous.completedAt = previous.completedAt ?? now;
    previous.updatedAt = now;
    this.recordSlowStep(previous, this.currentRepo);
  }

  private recordSlowStep(step: TimelineStep, repo: string | undefined): void {
    if (!step.completedAt) return;
    const durationMs = step.completedAt - step.startedAt;
    this.slowestSteps.push({ label: step.label, repo, durationMs });
    this.slowestSteps.sort((a, b) => b.durationMs - a.durationMs);
    this.slowestSteps.splice(8);
  }
}

function isTerminalTimelineState(state: ProgressTaskState): boolean {
  return state === "done" || state === "skip" || state === "warn" || state === "fail";
}

function statusText(state: ProgressTaskState): string {
  const unicode = supportsUnicode();
  if (state === "done") return unicode ? "✓" : "ok";
  if (state === "skip") return unicode ? "◇" : "-";
  if (state === "warn") return "!";
  if (state === "fail") return unicode ? "×" : "fail";
  if (state === "wait") return unicode ? "…" : "wait";
  return unicode ? "›" : ">";
}

function timelineRepoLabel(snapshot: TimelineSnapshot, task: ProgressTask): string {
  return task.timelineRepo ?? snapshot.repo ?? snapshot.org;
}

function formatTimelineCount(task: ProgressTask): string {
  if (typeof task.current === "number" && typeof task.total === "number") {
    return ` ${task.current}/${task.total}`;
  }
  if (typeof task.current === "number") return ` ${task.current}`;
  return "";
}

const PAINT_THROTTLE_MS = 80;
const SPINNER_INTERVAL_MS = 80;
const REPAINT_TIMER_MS = 100;

class LiveProgressRenderer {
  private readonly startedAt = Date.now();
  private readonly color: boolean;
  private readonly unicode: boolean;
  private readonly spinnerFrames: string[];
  private readonly tasks = new Map<string, RenderedProgressTask>();
  private timeline: TimelineSnapshot | undefined;
  private active = false;
  private renderedLines = 0;
  private lastPaintAt = 0;
  private lastActiveStepId: string | undefined;
  private lastStepCount = 0;
  private lastCompleted = false;
  private repaintTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly stream: ProgressStream,
    private readonly title = "Anchor progress",
  ) {
    this.color = supportsColor(stream);
    this.unicode = supportsUnicode();
    this.spinnerFrames = this.unicode ? ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"] : ["-", "\\", "|", "/"];
  }

  render(task: ProgressTask): void {
    this.timeline = undefined;
    const previous = this.tasks.get(task.key);
    const isNewTask = !previous;
    const state = task.state ?? "active";
    this.tasks.set(task.key, {
      ...previous,
      ...task,
      state,
      startedAt: previous?.startedAt ?? Date.now(),
      updatedAt: Date.now(),
    });
    const force = isNewTask || isTerminalTimelineState(state) || state === "wait";
    this.requestPaint(force);
    this.startRepaintTimer();
    this.active = true;
  }

  renderTimeline(timeline: TimelineSnapshot): void {
    this.timeline = timeline;
    const force =
      timeline.activeStepId !== this.lastActiveStepId ||
      timeline.steps.length !== this.lastStepCount ||
      timeline.completed !== this.lastCompleted;
    this.lastActiveStepId = timeline.activeStepId;
    this.lastStepCount = timeline.steps.length;
    this.lastCompleted = timeline.completed;
    this.requestPaint(force);
    this.startRepaintTimer();
    this.active = true;
  }

  private requestPaint(force: boolean): void {
    const now = Date.now();
    if (!force && now - this.lastPaintAt < PAINT_THROTTLE_MS) return;
    this.lastPaintAt = now;
    this.paint();
  }

  log(message: string): void {
    this.clear();
    this.stream.write(`${colorize(this.color, "2", message)}\n`);
  }

  close(): void {
    if (this.repaintTimer) {
      clearInterval(this.repaintTimer);
      this.repaintTimer = undefined;
    }
    this.clear();
  }

  private startRepaintTimer(): void {
    if (this.repaintTimer) return;
    this.repaintTimer = setInterval(() => {
      if (this.tasks.size > 0 || this.timeline) this.requestPaint(false);
    }, REPAINT_TIMER_MS);
    this.repaintTimer.unref?.();
  }

  private paint(): void {
    this.clear();
    const lines = this.buildLines();
    if (lines.length === 0) return;
    this.stream.write(`${lines.join("\n")}\n`);
    this.renderedLines = lines.length;
    this.active = true;
  }

  private buildLines(): string[] {
    const width = Math.max(48, this.stream.columns ?? 100);
    const header = this.renderHeader(width);
    if (this.timeline) {
      return [header, ...this.renderTimelineLines(this.timeline, width)].map((line) =>
        truncateEnd(line, width),
      );
    }
    const tasks = this.visibleTasks();
    return [header, ...tasks.map((task) => this.renderTask(task, width))].map((line) =>
      truncateEnd(line, width),
    );
  }

  private renderHeader(width: number): string {
    const title = colorize(this.color, "1;36", "Anchor");
    const elapsed = colorize(this.color, "2", `elapsed ${formatElapsed(this.startedAt)}`);
    const latestUpdate = Math.max(
      this.startedAt,
      ...[...this.tasks.values()].map((task) => task.updatedAt),
    );
    const updateAge = Math.max(0, Math.floor((Date.now() - latestUpdate) / 1000));
    const lastUpdate = colorize(this.color, "2", `last update ${updateAge}s ago`);
    const label = colorize(this.color, "1", this.title);
    return truncateEnd(
      `${title} ${colorize(this.color, "2", "›")} ${label} ${elapsed} ${colorize(this.color, "2", "·")} ${lastUpdate}`,
      width,
    );
  }

  private visibleTasks(): RenderedProgressTask[] {
    const now = Date.now();
    const tasks = [...this.tasks.values()]
      .filter((task) => {
        if (task.pinned) return true;
        if (task.state === "active" || task.state === "wait") return true;
        if (task.state === "warn" || task.state === "fail") return now - task.updatedAt <= 30_000;
        return now - task.updatedAt <= 12_000;
      })
      .sort((a, b) => {
        const weight = (task: RenderedProgressTask) =>
          task.pinned
            ? -1
            : task.state === "active" || task.state === "wait"
              ? 0
              : task.state === "warn" || task.state === "fail"
                ? 1
                : 2;
        const byWeight = weight(a) - weight(b);
        return byWeight || b.updatedAt - a.updatedAt;
      });
    return tasks.slice(0, 6);
  }

  private renderTask(task: RenderedProgressTask, width: number): string {
    const state = task.state ?? "active";
    const symbol = this.statusSymbol(state);
    const phase = task.phase ? colorize(this.color, "2", `${task.phase} `) : "";
    const label = colorize(this.color, state === "active" || state === "wait" ? "0" : "2", task.label);
    const count =
      typeof task.current === "number" && typeof task.total === "number"
        ? `${task.current}/${task.total}`
        : typeof task.current === "number"
          ? `${task.current}`
          : "";
    const percent = formatPercent(task.current, task.total);
    const rate = formatRate(task);
    const eta = formatEta(task);
    const metrics = [count, percent, rate, eta].filter(Boolean).join(" ");
    const barWidth = width >= 96 ? 24 : width >= 72 ? 16 : 10;
    const bar = progressBar(task.current, task.total, barWidth, {
      unicode: this.unicode,
      color: this.color,
      state,
    });
    const detailBudget = Math.max(14, width - 56 - barWidth);
    const detail = task.detail
      ? colorize(this.color, "2", truncateMiddle(task.detail, detailBudget))
      : "";
    return [" ", symbol, phase + label, bar, colorize(this.color, "2", metrics), detail]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trimEnd();
  }

  private renderTimelineLines(timeline: TimelineSnapshot, width: number): string[] {
    const lines: string[] = [];
    // Multi-repo org runs show which repo is active; single-repo runs rely on the persistent banner.
    if (timeline.repo && timeline.repoIndex && timeline.repoTotal && timeline.repoTotal > 1) {
      lines.push(
        colorize(this.color, "1", `Repo ${timeline.repoIndex}/${timeline.repoTotal}  ${timeline.repo}`),
      );
      lines.push(colorize(this.color, "2", (this.unicode ? "─" : "-").repeat(Math.min(width, 48))));
    }

    const visibleSteps = timeline.steps.slice(-12);
    for (const step of visibleSteps) {
      lines.push(this.renderTimelineStep(step, width));
    }

    if (timeline.recentRepos.length > 0) {
      lines.push(colorize(this.color, "2", "Recent repos"));
      for (const repo of timeline.recentRepos.slice(-3).reverse()) {
        lines.push(
          `  ${this.statusSymbol(repo.status)} ${truncateMiddle(repo.repo, Math.max(18, width - 34))} ${colorize(
            this.color,
            "2",
            formatDurationMs(repo.durationMs),
          )}${repo.detail ? ` ${colorize(this.color, "2", truncateMiddle(repo.detail, 28))}` : ""}`,
        );
      }
    }

    if (timeline.completed && timeline.slowestSteps.length > 0) {
      lines.push(colorize(this.color, "2", "Slowest steps"));
      for (const step of timeline.slowestSteps.slice(0, 5)) {
        const label = `${step.repo ? `${step.repo}: ` : ""}${step.label}`;
        lines.push(
          `  ${colorize(this.color, "2", "•")} ${truncateMiddle(label, Math.max(18, width - 28))} ${colorize(
            this.color,
            "2",
            formatDurationMs(step.durationMs),
          )}`,
        );
      }
    }

    return lines;
  }

  private renderTimelineStep(step: TimelineStep, width: number): string {
    const state = step.status;
    const expanded = state === "active" || state === "wait";
    const symbol = this.statusSymbol(state);
    const connector = colorize(this.color, "2", this.unicode ? "│" : "|");
    const label = colorize(this.color, expanded ? "0" : "2", step.label);
    const count =
      typeof step.current === "number" && typeof step.total === "number"
        ? `${step.current}/${step.total}`
        : typeof step.current === "number"
          ? `${step.current}`
          : "";
    const duration = formatDurationMs(
      step.completedAt
        ? step.durationMs ?? step.completedAt - step.startedAt
        : Math.max(0, Date.now() - step.startedAt),
    );
    // Active steps expand with bar + live metrics; completed steps collapse to count + duration.
    const metrics = expanded
      ? [count, formatPercent(step.current, step.total), this.formatTimelineRate(step), this.formatTimelineEta(step), duration]
          .filter(Boolean)
          .join(" ")
      : [count, duration].filter(Boolean).join(" ");
    const barWidth = width >= 96 ? 18 : width >= 72 ? 12 : 8;
    const bar = expanded
      ? progressBar(step.current, step.total, barWidth, {
          unicode: this.unicode,
          color: this.color,
          state,
        })
      : "";
    const detailBudget = Math.max(12, width - 58 - barWidth);
    const detail =
      expanded && step.detail
        ? colorize(this.color, "2", truncateMiddle(step.detail, detailBudget))
        : "";
    return [" ", connector, symbol, label, bar, colorize(this.color, "2", metrics), detail]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trimEnd();
  }

  private formatTimelineRate(step: TimelineStep): string {
    if (typeof step.current !== "number" || step.current <= 0) return "";
    const seconds = Math.max(0.5, (Date.now() - step.startedAt) / 1000);
    if (seconds < 2) return "";
    const rate = step.current / seconds;
    if (rate >= 10) return `${Math.round(rate)}/s`;
    return `${rate.toFixed(1)}/s`;
  }

  private formatTimelineEta(step: TimelineStep): string {
    if (
      typeof step.current !== "number" ||
      typeof step.total !== "number" ||
      step.current <= 0 ||
      step.current >= step.total
    ) {
      return "";
    }
    const seconds = Math.max(0.5, (Date.now() - step.startedAt) / 1000);
    if (seconds < 3) return "";
    const remaining = Math.ceil(((step.total - step.current) * seconds) / step.current);
    if (remaining < 60) return `${remaining}s left`;
    return `${Math.floor(remaining / 60)}m ${remaining % 60}s left`;
  }

  private statusSymbol(state: ProgressTaskState): string {
    if (state === "active") {
      const frame =
        this.spinnerFrames[
          Math.floor(Date.now() / SPINNER_INTERVAL_MS) % this.spinnerFrames.length
        ] ?? "*";
      return colorize(this.color, "36", frame);
    }
    if (state === "done") return colorize(this.color, "32", this.unicode ? "✓" : "ok");
    if (state === "skip") return colorize(this.color, "2", this.unicode ? "◇" : "-");
    if (state === "warn") return colorize(this.color, "33", this.unicode ? "!" : "warn");
    if (state === "fail") return colorize(this.color, "31", this.unicode ? "×" : "fail");
    return colorize(this.color, "33", this.unicode ? "…" : "wait");
  }

  private clear(): void {
    if (!this.active) return;
    for (let i = 0; i < this.renderedLines; i += 1) {
      readline.moveCursor(this.stream as NodeJS.WriteStream, 0, -1);
      readline.clearLine(this.stream as NodeJS.WriteStream, 0);
    }
    this.active = false;
    this.renderedLines = 0;
  }
}

export type AnchorProgressReporter = {
  mode: ProgressMode;
  log: (message: string) => void;
  close: () => void;
  onOrgProgress: (progress: OrgLifecycleProgress) => void;
  onFetchProgress: (progress: FetchPullRequestsProgress) => void;
  onPrIndexProgress: (progress: IndexPullRequestsProgress) => void;
  onCodeProgress: (progress: CodeIndexProgress) => void;
  onGraphProgress: (progress: OrgGraphProgress) => void;
  onCloneProgress: (progress: OrgCloneProgress) => void;
};

export function createProgressReporter(input?: {
  progress?: ProgressMode;
  json?: boolean;
  stream?: ProgressStream;
  title?: string;
  heartbeat?: {
    org: string;
    command: string;
  };
}): AnchorProgressReporter {
  const stream = input?.stream ?? process.stderr;
  const mode = resolveProgressMode({ ...input, stream });
  const pretty = mode === "pretty" ? new LiveProgressRenderer(stream, input?.title) : undefined;
  // Every command renders through the timeline stepper. Heartbeat-file writes and
  // plain-mode timeline logs stay org-only to preserve single-repo CI output.
  const emitTimelinePlainLogs = Boolean(input?.heartbeat);
  const timeline = new ProgressTimelineTracker(
    input?.heartbeat?.command ?? input?.title ?? "anchor",
    input?.heartbeat?.org ?? "",
  );
  let heartbeat: OrgRunHeartbeat | undefined = input?.heartbeat
    ? {
        pid: process.pid,
        command: input.heartbeat.command,
        org: input.heartbeat.org,
        phase: "starting",
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    : undefined;
  let lastHeartbeatWriteAt = 0;
  const updateHeartbeat = (
    patch: Partial<
      Pick<OrgRunHeartbeat, "repo" | "repoIndex" | "repoTotal" | "phase" | "timeline">
    >,
    inputOptions: { force?: boolean } = {},
  ): void => {
    if (!heartbeat) return;
    const nowMs = Date.now();
    heartbeat = {
      ...heartbeat,
      ...patch,
      timeline: timeline?.heartbeatSnapshot() ?? patch.timeline,
      updatedAt: new Date().toISOString(),
    };
    if (!inputOptions.force && nowMs - lastHeartbeatWriteAt < 1000) return;
    try {
      writeOrgHeartbeat(heartbeat);
      lastHeartbeatWriteAt = nowMs;
    } catch {
      // Heartbeat is best-effort status metadata; progress must not fail commands.
    }
  };
  const log = (message: string): void => {
    if (mode === "off") return;
    if (pretty) pretty.log(message);
    else stream.write(`${message}\n`);
  };
  const updateTimeline = (task: ProgressTask): string[] => timeline?.update(task) ?? [];
  const render = (task: ProgressTask, timelineAlreadyUpdated = false): void => {
    if (mode === "off") return;
    if (timeline) {
      if (!timelineAlreadyUpdated) timeline.update(task);
      pretty?.renderTimeline(timeline.snapshot());
      return;
    }
    pretty?.render(task);
  };
  const writeTimelinePlainLogs = (logs: string[]): void => {
    if (!emitTimelinePlainLogs || mode !== "plain") return;
    for (const line of logs) stream.write(`${line}\n`);
  };
  let closed = false;
  return {
    mode,
    log,
    close: () => {
      if (closed) return;
      closed = true;
      if (heartbeat) updateHeartbeat({ phase: "completed" }, { force: true });
      pretty?.close();
      if (input?.heartbeat && mode !== "off") {
        for (const line of timeline.finalSummaryLines()) stream.write(`${line}\n`);
      }
      if (input?.heartbeat) clearOrgHeartbeat(input.heartbeat.org);
    },
    onOrgProgress: (progress) => {
      const task = orgLifecycleTask(progress);
      const timelineLogs = updateTimeline(task);
      updateHeartbeat(heartbeatPatchFromOrgProgress(progress), { force: true });
      if (mode === "plain") {
        writeTimelinePlainLogs(timelineLogs);
        printOrgLifecycleProgress(progress);
      } else render(task, true);
    },
    onFetchProgress: (progress) => {
      const task = fetchTask(progress);
      const timelineLogs = updateTimeline(task);
      updateHeartbeat(heartbeatPatchFromFetchProgress(progress));
      if (mode === "plain") {
        writeTimelinePlainLogs(timelineLogs);
        printFetchProgress(progress);
      } else render(task, true);
    },
    onPrIndexProgress: (progress) => {
      const task = indexTask(progress);
      const timelineLogs = updateTimeline(task);
      updateHeartbeat({
        repo: progress.repo,
        phase:
          progress.stage === "indexing_pull_request"
            ? "Indexing PR history into SQLite"
            : "Indexed PR history",
      });
      if (mode === "plain") {
        writeTimelinePlainLogs(timelineLogs);
        printIndexProgress(progress);
      } else render(task, true);
    },
    onCodeProgress: (progress) => {
      const task = codeTask(progress);
      const timelineLogs = updateTimeline(task);
      updateHeartbeat(heartbeatPatchFromCodeProgress(progress));
      if (mode === "plain") {
        writeTimelinePlainLogs(timelineLogs);
        printCodeIndexProgress(progress);
      } else render(task, true);
    },
    onGraphProgress: (progress) => {
      const task = graphTask(progress);
      const timelineLogs = updateTimeline(task);
      updateHeartbeat(heartbeatPatchFromGraphProgress(progress));
      if (mode === "plain") {
        writeTimelinePlainLogs(timelineLogs);
        printOrgGraphProgress(progress);
      } else render(task, true);
    },
    onCloneProgress: (progress) => {
      const task = cloneTask(progress);
      const timelineLogs = updateTimeline(task);
      updateHeartbeat({
        repo: progress.repo,
        repoIndex: progress.current,
        repoTotal: progress.total,
        phase:
          progress.stage === "cloning_or_pulling_repo"
            ? "Cloning or pulling repo"
            : "Repo clone/pull complete",
      });
      if (mode === "plain") {
        writeTimelinePlainLogs(timelineLogs);
        printOrgCloneProgress(progress);
      } else render(task, true);
    },
  };
}

function shouldPrintIndexProgress(progress: IndexPullRequestsProgress): boolean {
  return (
    progress.current === 1 || progress.current === progress.total || progress.current % 25 === 0
  );
}

function fetchScope(progress: { all: boolean; limit?: number }): string {
  return progress.all ? "all merged PRs" : `up to ${progress.limit ?? 200} merged PRs`;
}

function heartbeatPatchFromOrgProgress(
  progress: OrgLifecycleProgress,
): Partial<Pick<OrgRunHeartbeat, "repo" | "repoIndex" | "repoTotal" | "phase">> {
  switch (progress.stage) {
    case "org_sync_started":
      return { phase: "Starting org sync", repoIndex: 0, repoTotal: progress.totalRepos };
    case "org_repo_started":
      return {
        repo: progress.repo,
        repoIndex: progress.current,
        repoTotal: progress.total,
        phase: "Starting repo",
      };
    case "org_repo_phase":
      return {
        repo: progress.repo,
        repoIndex: progress.current,
        repoTotal: progress.total,
        phase: progress.phase,
      };
    case "org_repo_skipped_history":
      return {
        repo: progress.repo,
        repoIndex: progress.current,
        repoTotal: progress.total,
        phase: "PR history skipped",
      };
    case "org_repo_skipped_code":
      return {
        repo: progress.repo,
        repoIndex: progress.current,
        repoTotal: progress.total,
        phase: "Code skipped",
      };
    case "org_repo_finalizing":
      return {
        repo: progress.repo,
        repoIndex: progress.current,
        repoTotal: progress.total,
        phase: "Writing repo state",
      };
    case "org_repo_completed":
      return {
        repo: progress.repo,
        repoIndex: progress.current,
        repoTotal: progress.total,
        phase: progress.error ? "Repo completed with errors" : "Repo completed",
      };
    case "org_graph_skipped":
      return { phase: "Graph skipped" };
    case "org_sync_completed":
      return {
        phase: "Org sync completed",
        repoIndex: progress.totalRepos,
        repoTotal: progress.totalRepos,
      };
    case "org_sync_failed":
      return { phase: "Org sync failed" };
  }
}

function heartbeatPatchFromFetchProgress(
  progress: FetchPullRequestsProgress,
): Partial<Pick<OrgRunHeartbeat, "repo" | "phase">> {
  switch (progress.stage) {
    case "discovering_pull_requests":
    case "scanned_pull_request_page":
    case "discovered_pull_requests":
      return { repo: progress.repo, phase: "Fetching PR metadata" };
    case "fetching_pull_request_details":
    case "fetched_pull_request_details":
      return { repo: progress.repo, phase: "Fetching PR details" };
    case "enriching_pull_request_patches":
    case "enriched_pull_request_patches":
    case "skipped_pull_request_patch_enrichment":
      return { repo: progress.repo, phase: "Enriching PR patches" };
    case "github_graphql_retry":
      return { repo: progress.repo, phase: "Retrying GitHub GraphQL" };
    case "github_rate_limited":
      return { repo: progress.repo, phase: "Waiting for GitHub rate limit" };
    case "skipped_pull_request_fetch":
      return { repo: progress.repo, phase: "PR history skipped" };
    default:
      return { repo: progress.repo, phase: "Fetching PR history" };
  }
}

function heartbeatPatchFromCodeProgress(
  progress: CodeIndexProgress,
): Partial<Pick<OrgRunHeartbeat, "repo" | "phase">> {
  switch (progress.stage) {
    case "discovering_code_files":
    case "discovered_code_files":
      return { repo: progress.repo, phase: "Discovering code files" };
    case "indexing_code_file":
    case "indexed_code_file":
      return { repo: progress.repo, phase: "Indexing code files" };
    case "building_architecture_imports":
      return { repo: progress.repo, phase: "Building architecture imports" };
    case "building_architecture_components":
      return { repo: progress.repo, phase: "Building architecture components" };
    case "building_architecture_patterns":
      return { repo: progress.repo, phase: "Building architecture patterns" };
    case "indexed_architecture":
      return { repo: progress.repo, phase: "Indexing architecture memory" };
    case "writing_code_index":
      return { repo: progress.repo, phase: progress.phase };
    case "inferring_test_awareness":
      return { repo: progress.repo, phase: "Inferring test awareness" };
    case "deleting_existing_code_index":
      return { repo: progress.repo, phase: "Deleting old code index" };
    case "writing_code_files":
      return { repo: progress.repo, phase: "Writing code files" };
    case "writing_code_chunks":
      return { repo: progress.repo, phase: "Writing code chunks" };
    case "writing_test_awareness":
      return { repo: progress.repo, phase: "Writing test awareness" };
    case "writing_architecture_data":
      return { repo: progress.repo, phase: `Writing architecture ${progress.kind}` };
    case "writing_architecture_map_edges":
      return { repo: progress.repo, phase: "Writing architecture map edges" };
    case "refreshing_test_commands":
      return { repo: progress.repo, phase: "Refreshing test commands" };
    case "completed_code_index":
      return { repo: progress.repo, phase: "Code index completed" };
  }
}

function heartbeatPatchFromGraphProgress(
  progress: OrgGraphProgress,
): Partial<Pick<OrgRunHeartbeat, "phase">> {
  switch (progress.stage) {
    case "loading_package_manifests":
    case "loaded_package_manifests":
      return { phase: "Loading package manifests" };
    case "building_package_edges":
      return { phase: "Building package dependency edges" };
    case "loading_imports":
    case "building_import_edges":
      return { phase: "Building import edges" };
    case "loading_code_chunks":
    case "extracting_api_contracts":
      return { phase: "Extracting API contracts" };
    case "matching_api_consumers":
      return { phase: "Matching API consumers" };
    case "writing_org_graph":
      return { phase: "Writing org graph" };
    case "completed_org_graph":
      return { phase: "Org graph completed" };
  }
}

export function printOrgLifecycleProgress(progress: OrgLifecycleProgress): void {
  switch (progress.stage) {
    case "org_sync_started":
      console.error(`[anchor] ${progress.command} started for ${progress.totalRepos} repo(s).`);
      return;
    case "org_repo_started":
      console.error(`[anchor] repo ${progress.current}/${progress.total}: ${progress.repo}`);
      return;
    case "org_repo_phase":
      console.error(
        `[anchor] repo ${progress.current}/${progress.total} ${progress.repo}: ${progress.phase}${progress.detail ? ` (${progress.detail})` : ""}...`,
      );
      return;
    case "org_repo_skipped_history":
      console.error(
        `[anchor] repo ${progress.current}/${progress.total} ${progress.repo}: ${progress.reason}`,
      );
      return;
    case "org_repo_skipped_code":
      console.error(
        `[anchor] repo ${progress.current}/${progress.total} ${progress.repo}: ${progress.reason}`,
      );
      return;
    case "org_repo_finalizing":
      console.error(
        `[anchor] repo ${progress.current}/${progress.total} ${progress.repo}: writing index state...`,
      );
      return;
    case "org_repo_completed":
      console.error(
        `[anchor] repo ${progress.current}/${progress.total} ${progress.error ? "partial" : "complete"}: ${progress.repo} (${(progress.durationMs / 1000).toFixed(1)}s, ${progress.prsIndexed} PRs, ${progress.codeFilesIndexed} code files)${progress.error ? ` - ${progress.error}` : ""}`,
      );
      return;
    case "org_graph_skipped":
      console.error(`[anchor] ${progress.reason}`);
      return;
    case "org_sync_completed":
      console.error(
        `[anchor] ${progress.command} completed in ${(progress.durationMs / 1000).toFixed(1)}s: ${progress.succeededRepos} succeeded, ${progress.failedRepos} failed.`,
      );
      return;
    case "org_sync_failed":
      console.error(`[anchor] ${progress.command} failed: ${progress.error}`);
      return;
  }
}

export function printFetchProgress(progress: FetchPullRequestsProgress): void {
  switch (progress.stage) {
    case "discovering_pull_requests": {
      const since = progress.since ? ` updated since ${progress.since}` : "";
      const backend = progress.backend === "graphql" ? " with GitHub GraphQL" : "";
      console.error(
        `[anchor] finding ${fetchScope(progress)} in ${progress.repo}${since}${backend}...`,
      );
      return;
    }
    case "scanned_pull_request_page":
      if (
        progress.all &&
        (progress.scannedPullRequests <= 100 || progress.scannedPullRequests % 500 === 0)
      ) {
        console.error(
          `[anchor] scanned ${progress.scannedPullRequests} closed PRs, found ${progress.matchedMergedPullRequests} merged PRs...`,
        );
      }
      return;
    case "discovered_pull_requests":
      console.error(
        progress.backend === "graphql"
          ? `[anchor] found ${progress.total} merged PRs with GraphQL. Enriching PR patches with REST concurrency ${progress.detailConcurrency}...`
          : `[anchor] found ${progress.total} merged PRs. Fetching PR details with concurrency ${progress.detailConcurrency}...`,
      );
      return;
    case "fetching_pull_request_details":
      if (progress.current <= progress.detailConcurrency) {
        console.error(
          `[anchor] fetching PR details ${progress.current}/${progress.total}: #${progress.prNumber}`,
        );
      }
      return;
    case "fetched_pull_request_details":
      if (
        progress.current === 1 ||
        progress.current === progress.total ||
        progress.current % 25 === 0
      ) {
        console.error(
          `[anchor] fetched PR details ${progress.current}/${progress.total}: #${progress.prNumber}`,
        );
      }
      return;
    case "enriching_pull_request_patches":
      if (progress.current <= progress.detailConcurrency) {
        console.error(
          `[anchor] enriching PR patches ${progress.current}/${progress.total}: #${progress.prNumber}`,
        );
      }
      return;
    case "enriched_pull_request_patches":
      if (
        progress.current === 1 ||
        progress.current === progress.total ||
        progress.current % 25 === 0
      ) {
        console.error(
          `[anchor] enriched PR patches ${progress.current}/${progress.total}: #${progress.prNumber} (${progress.patches} patches)`,
        );
      }
      return;
    case "skipped_pull_request_patch_enrichment":
      console.error(
        `[anchor] skipped PR patch enrichment ${progress.current}/${progress.total}: #${progress.prNumber}. ${progress.reason}.`,
      );
      return;
    case "github_fetch_backend_fallback":
      console.error(
        `[anchor] ${progress.from} fetch failed; falling back to ${progress.to}. ${progress.reason}.`,
      );
      return;
    case "github_graphql_page_size_reduced":
      console.error(
        `[anchor] GitHub GraphQL query was too expensive; reducing page size from ${progress.previousPageSize} to ${progress.nextPageSize}. ${progress.reason}.`,
      );
      return;
    case "github_graphql_page_size_selected": {
      const cost = progress.averageCostPerPr
        ? ` Average observed cost: ${progress.averageCostPerPr.toFixed(2)} points/PR.`
        : "";
      console.error(
        `[anchor] adjusted GraphQL PR page size from ${progress.previousPageSize} to ${progress.nextPageSize}.${cost}`,
      );
      return;
    }
    case "github_graphql_budget_deferred":
      console.error(
        `[anchor] GraphQL budget safety reserve reached (${progress.remaining ?? "unknown"} remaining, reserve ${progress.reserve}). Indexed ${progress.matchedMergedPullRequests} merged PRs so far; rerun the same command after ${progress.resetAt ?? "the GitHub reset"} to resume.`,
      );
      return;
    case "github_graphql_checkpoint_resumed":
      console.error(
        `[anchor] resuming GraphQL PR fetch checkpoint after ${progress.matchedMergedPullRequests} merged PRs (page size ${progress.pageSize}).`,
      );
      return;
    case "github_graphql_retry":
      console.error(
        `[anchor] GitHub GraphQL transient failure. Retry ${progress.attempt}/${progress.maxAttempts - 1} in ${(progress.waitMs / 1000).toFixed(1)}s. ${progress.reason}.`,
      );
      return;
    case "github_rate_limited":
      console.error(
        `[anchor] GitHub rate limit hit while ${progress.request}. Waiting ${progress.waitSeconds}s until ${progress.retryAt}. ${progress.reason}.`,
      );
      return;
    case "skipped_pull_request_fetch":
      console.error(`[anchor] skipped PR fetch for ${progress.repo}. ${progress.reason}`);
      return;
  }
}

export function printIndexProgress(progress: IndexPullRequestsProgress): void {
  switch (progress.stage) {
    case "indexing_pull_request":
      if (progress.current === 1) console.error(`[anchor] indexing ${progress.total} PRs...`);
      return;
    case "indexed_pull_request":
      if (!shouldPrintIndexProgress(progress)) return;
      console.error(
        `[anchor] indexed PR ${progress.current}/${progress.total}: #${progress.prNumber} (${progress.wisdomUnitsCreated} wisdom units, ${progress.regressionEventsCreated} regressions)`,
      );
      return;
  }
}

function shouldPrintCodeProgress(progress: CodeIndexProgress): boolean {
  return (
    "current" in progress &&
    (progress.current === 1 || progress.current === progress.total || progress.current % 100 === 0)
  );
}

export function printCodeIndexProgress(progress: CodeIndexProgress): void {
  switch (progress.stage) {
    case "discovering_code_files":
      if (typeof progress.scanned === "number" && typeof progress.total === "number") {
        if (progress.scanned % 1000 === 0 || progress.scanned === progress.total) {
          console.error(
            `[anchor] scanning code files ${progress.scanned}/${progress.total} in ${progress.repo}...`,
          );
        }
        return;
      }
      console.error(
        `[anchor] discovering git-tracked and non-ignored code files in ${progress.repo}...`,
      );
      return;
    case "discovered_code_files":
      console.error(
        `[anchor] found ${progress.files} code files to index (${progress.skippedFiles} skipped).`,
      );
      return;
    case "indexing_code_file":
      if (progress.current === 1)
        console.error(`[anchor] indexing ${progress.total} code files...`);
      return;
    case "indexed_code_file":
      if (!shouldPrintCodeProgress(progress)) return;
      console.error(
        `[anchor] indexed code file ${progress.current}/${progress.total}: ${progress.filePath} (${progress.chunks} chunks)`,
      );
      return;
    case "building_architecture_imports":
      if (!shouldPrintCodeProgress(progress)) return;
      console.error(
        `[anchor] building architecture imports ${progress.current}/${progress.total}: ${progress.imports} import(s) found${progress.filePath ? ` (${progress.filePath})` : ""}`,
      );
      return;
    case "building_architecture_components":
      if (!shouldPrintCodeProgress(progress)) return;
      console.error(
        `[anchor] building architecture components ${progress.current}/${progress.total}: ${progress.components} component(s)${progress.filePath ? ` (${progress.filePath})` : ""}`,
      );
      return;
    case "building_architecture_patterns":
      if (!shouldPrintCodeProgress(progress)) return;
      console.error(
        `[anchor] building architecture patterns ${progress.current}/${progress.total}: ${progress.patterns} pattern(s)${progress.area ? ` (${progress.area})` : ""}`,
      );
      return;
    case "indexed_architecture":
      console.error(
        `[anchor] indexed architecture memory: ${progress.components} components, ${progress.patterns} patterns, ${progress.imports} imports.`,
      );
      return;
    case "writing_code_index":
      console.error(`[anchor] ${progress.repo}: ${progress.phase}...`);
      return;
    case "inferring_test_awareness":
      if (!shouldPrintCodeProgress(progress)) return;
      console.error(
        `[anchor] inferring test awareness ${progress.phase.replace("_", " ")} ${progress.current}/${progress.total}: ${progress.testFiles} tests, ${progress.testLinks} links${progress.filePath ? ` (${progress.filePath})` : ""}`,
      );
      return;
    case "deleting_existing_code_index":
      console.error(
        `[anchor] deleting existing code index for ${progress.repo}: ${progress.chunks} chunks, ${progress.patterns} architecture patterns...`,
      );
      return;
    case "writing_code_files":
      if (!shouldPrintCodeProgress(progress)) return;
      console.error(
        `[anchor] writing code files ${progress.current}/${progress.total}${progress.filePath ? `: ${progress.filePath}` : ""}`,
      );
      return;
    case "writing_code_chunks":
      if (!shouldPrintCodeProgress(progress)) return;
      console.error(
        `[anchor] writing code chunks ${progress.current}/${progress.total}: ${progress.chunks} chunk(s)${progress.filePath ? ` (${progress.filePath})` : ""}`,
      );
      return;
    case "writing_test_awareness":
      if (!shouldPrintCodeProgress(progress)) return;
      console.error(
        `[anchor] writing ${progress.kind.replace("_", " ")} ${progress.current}/${progress.total}`,
      );
      return;
    case "writing_architecture_data":
      if (!shouldPrintCodeProgress(progress)) return;
      console.error(
        `[anchor] writing architecture ${progress.kind} ${progress.current}/${progress.total}`,
      );
      return;
    case "writing_architecture_map_edges":
      if (!shouldPrintCodeProgress(progress)) return;
      console.error(
        `[anchor] writing architecture map edges ${progress.current}/${progress.total}: ${progress.edges} edge(s)`,
      );
      return;
    case "refreshing_test_commands":
      if (!shouldPrintCodeProgress(progress)) return;
      console.error(
        `[anchor] ${progress.phase === "detecting" ? "detecting" : "writing"} test commands ${progress.current}/${progress.total}: ${progress.commands} command(s)`,
      );
      return;
    case "completed_code_index":
      console.error(
        `[anchor] code index complete for ${progress.repo}: ${progress.files} files, ${progress.chunks} chunks, ${progress.testFiles} tests, ${progress.testLinks} test links, ${progress.skippedFiles} skipped.`,
      );
      return;
  }
}

export function printOrgGraphProgress(progress: OrgGraphProgress): void {
  switch (progress.stage) {
    case "loading_package_manifests":
      console.error(
        `[anchor] rebuilding org graph for ${progress.org}: reading ${progress.totalRepos} repo manifests...`,
      );
      return;
    case "loaded_package_manifests":
      console.error(
        `[anchor] loaded ${progress.packageNames} package name(s) across ${progress.repos} repo(s).`,
      );
      return;
    case "building_package_edges":
      if (progress.current === 1 || progress.current === progress.total) {
        console.error(
          `[anchor] building package edges ${progress.current}/${progress.total}: ${progress.repo} (${progress.edges} edges)`,
        );
      }
      return;
    case "loading_imports":
      console.error("[anchor] loading indexed imports for org graph...");
      return;
    case "building_import_edges":
      if (
        progress.current === 1 ||
        progress.current === progress.total ||
        progress.current % 500 === 0
      ) {
        console.error(
          `[anchor] building import edges ${progress.current}/${progress.total}: ${progress.sourcePath} (${progress.edges} edges)`,
        );
      }
      return;
    case "loading_code_chunks":
      console.error("[anchor] loading code chunks for API consumer detection...");
      return;
    case "extracting_api_contracts":
      if (
        progress.current === 1 ||
        progress.current === progress.total ||
        progress.current % 500 === 0
      ) {
        console.error(
          `[anchor] extracting API contracts ${progress.current}/${progress.total}: ${progress.filePath} (${progress.contracts} contracts)`,
        );
      }
      return;
    case "matching_api_consumers":
      if (
        progress.current === 1 ||
        progress.current === progress.total ||
        progress.current % 500 === 0
      ) {
        console.error(
          `[anchor] matching API consumers ${progress.current}/${progress.total}: ${progress.filePath} (${progress.matches} matches in file)`,
        );
      }
      return;
    case "writing_org_graph":
      console.error(
        progress.current !== undefined && progress.total !== undefined && progress.kind
          ? `[anchor] writing org graph ${progress.kind} ${progress.current}/${progress.total}: ${progress.edges} edges, ${progress.apiContracts} API contracts, ${progress.apiConsumers} API consumers...`
          : `[anchor] writing org graph: ${progress.edges} edges, ${progress.apiContracts} API contracts, ${progress.apiConsumers} API consumers...`,
      );
      return;
    case "completed_org_graph":
      console.error(
        `[anchor] org graph complete in ${(progress.durationMs / 1000).toFixed(1)}s: ${progress.edges} edges, ${progress.apiContracts} API contracts, ${progress.apiConsumers} API consumers.`,
      );
      return;
  }
}

export function printOrgCloneProgress(progress: OrgCloneProgress): void {
  switch (progress.stage) {
    case "cloning_or_pulling_repo":
      console.error(
        `[anchor] cloning or pulling repo ${progress.current}/${progress.total}: ${progress.repo}`,
      );
      return;
    case "cloned_or_pulled_repo": {
      const state = progress.error
        ? `failed: ${progress.error}`
        : progress.cloned
          ? "cloned"
          : "pulled";
      console.error(
        `[anchor] repo ${progress.current}/${progress.total} ${state}: ${progress.repo}`,
      );
      return;
    }
  }
}

function orgLifecycleTask(progress: OrgLifecycleProgress): ProgressTask {
  switch (progress.stage) {
    case "org_sync_started":
      return {
        key: `org:${progress.org}`,
        phase: "Org",
        label: "Starting org memory run",
        current: 0,
        total: progress.totalRepos,
        detail: progress.command,
        pinned: true,
        timelineStepId: "run_start",
        timelineLabel: "Org run started",
      };
    case "org_repo_started":
      return {
        key: `org:${progress.org}`,
        phase: "Repo",
        label: `${progress.current}/${progress.total} ${progress.repo}`,
        current: progress.current,
        total: progress.total,
        detail: "starting",
        pinned: true,
        timelineStepId: "repo_start",
        timelineLabel: "Repo started",
        timelineRepo: progress.repo,
        timelineRepoIndex: progress.current,
        timelineRepoTotal: progress.total,
      };
    case "org_repo_phase":
      return {
        key: `org:${progress.org}`,
        phase: "Repo",
        label: `${progress.current}/${progress.total} ${progress.repo}`,
        current: progress.current,
        total: progress.total,
        detail: progress.detail ? `${progress.phase}: ${progress.detail}` : progress.phase,
        pinned: true,
        timelineStepId: orgPhaseStepId(progress.phase),
        timelineLabel: progress.phase,
        timelineRepo: progress.repo,
        timelineRepoIndex: progress.current,
        timelineRepoTotal: progress.total,
      };
    case "org_repo_skipped_history":
      return {
        key: `history-skip:${progress.repo}`,
        phase: "GitHub",
        label: "PR history skipped",
        state: "skip",
        detail: progress.reason,
        timelineStepId: "github_pr_fetch",
        timelineLabel: "PR history",
        timelineRepo: progress.repo,
        timelineRepoIndex: progress.current,
        timelineRepoTotal: progress.total,
      };
    case "org_repo_skipped_code":
      return {
        key: `code-skip:${progress.repo}`,
        phase: "Code",
        label: "Code skipped",
        state: "skip",
        detail: progress.reason,
        timelineStepId: "code_index",
        timelineLabel: "Code index",
        timelineRepo: progress.repo,
        timelineRepoIndex: progress.current,
        timelineRepoTotal: progress.total,
      };
    case "org_repo_finalizing":
      return {
        key: `org:${progress.org}`,
        phase: "Repo",
        label: `${progress.current}/${progress.total} ${progress.repo}`,
        current: progress.current,
        total: progress.total,
        detail: "writing repo state",
        pinned: true,
        timelineStepId: "repo_finalizing",
        timelineLabel: "Finalizing repo state",
        timelineRepo: progress.repo,
        timelineRepoIndex: progress.current,
        timelineRepoTotal: progress.total,
      };
    case "org_repo_completed":
      return {
        key: `org:${progress.org}`,
        phase: "Repo",
        label: `${progress.current}/${progress.total} ${progress.repo}`,
        current: progress.current,
        total: progress.total,
        // A finished repo is done regardless of its position in the run; keying
        // off current/total left mid-run repos rendered as an active spinner.
        state: progress.error ? "warn" : "done",
        detail: `${progress.prsIndexed} PRs, ${progress.codeFilesIndexed} files, ${(progress.durationMs / 1000).toFixed(1)}s`,
        pinned: true,
        timelineStepId: "repo_complete",
        timelineLabel: "Repo complete",
        timelineRepo: progress.repo,
        timelineRepoIndex: progress.current,
        timelineRepoTotal: progress.total,
      };
    case "org_graph_skipped":
      return {
        key: `graph-skip:${progress.org}`,
        phase: "Org graph",
        label: "Graph skipped",
        state: "skip",
        detail: progress.reason,
        timelineStepId: "org_graph",
        timelineLabel: "Org graph",
      };
    case "org_sync_completed":
      return {
        key: `org:${progress.org}`,
        phase: "Org",
        label: "Org memory run complete",
        current: progress.totalRepos,
        total: progress.totalRepos,
        state: progress.failedRepos > 0 ? "warn" : "done",
        detail: `${progress.succeededRepos} succeeded, ${progress.failedRepos} failed, ${(progress.durationMs / 1000).toFixed(1)}s`,
        pinned: true,
        timelineStepId: "run_complete",
        timelineLabel: "Org run complete",
      };
    case "org_sync_failed":
      return {
        key: `org:${progress.org}`,
        phase: "Org",
        label: "Org memory run failed",
        state: "fail",
        detail: progress.error,
        pinned: true,
        timelineStepId: "run_failed",
        timelineLabel: "Org run failed",
      };
  }
}

function orgPhaseStepId(phase: string): string {
  const normalized = phase.toLowerCase();
  if (normalized.includes("commit")) return "commit_read";
  if (normalized.includes("fetching pr")) return "github_pr_fetch";
  if (normalized.includes("indexing pr")) return "sqlite_pr_index";
  if (normalized.includes("code")) return "code_index";
  return `phase:${normalized.replace(/[^a-z0-9]+/g, "_")}`;
}

function fetchTask(progress: FetchPullRequestsProgress): ProgressTask {
  switch (progress.stage) {
    case "discovering_pull_requests":
      return {
        key: `fetch:${progress.repo}`,
        phase: "GitHub",
        label: `Finding ${fetchScope(progress)}`,
        detail: progress.backend === "graphql" ? "GitHub GraphQL" : undefined,
        timelineStepId: "github_backend_fallback",
        timelineLabel: "GitHub backend fallback",
        timelineRepo: progress.repo,
      };
    case "scanned_pull_request_page":
      return {
        key: `fetch:${progress.repo}`,
        phase: "GitHub",
        label: "Scanning PR pages",
        current: progress.all ? progress.scannedPullRequests : progress.matchedMergedPullRequests,
        total: progress.all ? undefined : progress.limit,
        detail: `${progress.repo} · ${progress.matchedMergedPullRequests} merged found`,
        timelineStepId: "github_graphql_tuning",
        timelineLabel: "Tune GraphQL page size",
        timelineRepo: progress.repo,
      };
    case "discovered_pull_requests":
      return {
        key: `fetch:${progress.repo}`,
        phase: "GitHub",
        label: "PR metadata ready",
        current: progress.total,
        total: progress.total,
        state: "done",
        detail:
          progress.backend === "graphql"
            ? "enriching patches with REST"
            : `fetching details with concurrency ${progress.detailConcurrency}`,
        timelineStepId: "github_graphql_tuning",
        timelineLabel: "Tune GraphQL page size",
        timelineRepo: progress.repo,
      };
    case "fetching_pull_request_details":
      return {
        key: `details:${progress.repo}`,
        phase: "REST",
        label: "Fetching PR details",
        current: progress.current,
        total: progress.total,
        detail: `#${progress.prNumber}`,
        timelineStepId: "github_pr_fetch",
        timelineLabel: "Fetch PR details",
        timelineRepo: progress.repo,
      };
    case "fetched_pull_request_details":
      return {
        key: `details:${progress.repo}`,
        phase: "REST",
        label: "Fetched PR details",
        current: progress.current,
        total: progress.total,
        state: progress.current >= progress.total ? "done" : "active",
        detail: `#${progress.prNumber}`,
        timelineStepId: "github_pr_fetch",
        timelineLabel: "Fetch PR details",
        timelineRepo: progress.repo,
      };
    case "enriching_pull_request_patches":
      return {
        key: `patches:${progress.repo}`,
        phase: "REST",
        label: "Enriching PR patches",
        current: progress.current,
        total: progress.total,
        detail: `#${progress.prNumber}`,
        timelineStepId: "rest_patch_enrichment",
        timelineLabel: "REST patch enrichment",
        timelineRepo: progress.repo,
      };
    case "enriched_pull_request_patches":
      return {
        key: `patches:${progress.repo}`,
        phase: "REST",
        label: "Enriched PR patches",
        current: progress.current,
        total: progress.total,
        state: progress.current >= progress.total ? "done" : "active",
        detail: `#${progress.prNumber} (${progress.patches} patches)`,
        timelineStepId: "rest_patch_enrichment",
        timelineLabel: "REST patch enrichment",
        timelineRepo: progress.repo,
      };
    case "skipped_pull_request_patch_enrichment":
      return {
        key: `patches:skipped:${progress.repo}:${progress.prNumber}`,
        phase: "REST",
        label: "Skipped PR patch enrichment",
        current: progress.current,
        total: progress.total,
        state: "warn",
        detail: `#${progress.prNumber}: ${progress.reason}`,
        timelineStepId: "rest_patch_enrichment",
        timelineLabel: "REST patch enrichment",
        timelineRepo: progress.repo,
      };
    case "github_fetch_backend_fallback":
      return {
        key: `fallback:${progress.repo}`,
        phase: "GitHub",
        label: `Fallback from ${progress.from} to ${progress.to}`,
        state: "warn",
        detail: progress.reason,
        timelineStepId: "github_graphql_checkpoint",
        timelineLabel: "Resume GraphQL checkpoint",
        timelineRepo: progress.repo,
      };
    case "github_graphql_page_size_reduced":
      return {
        key: `graphql-size:${progress.repo}`,
        phase: "GraphQL",
        label: "Reducing page size",
        state: "warn",
        detail: `${progress.previousPageSize} -> ${progress.nextPageSize}: ${progress.reason}`,
        timelineStepId: "github_pr_fetch",
        timelineLabel: "Fetch PR metadata",
        timelineRepo: progress.repo,
      };
    case "github_graphql_page_size_selected":
      return {
        key: `graphql-size:${progress.repo}`,
        phase: "GraphQL",
        label: "Selected page size",
        state: "done",
        detail: `${progress.previousPageSize} -> ${progress.nextPageSize}`,
        timelineStepId: "github_pr_fetch",
        timelineLabel: "Fetch PR metadata",
        timelineRepo: progress.repo,
      };
    case "github_graphql_budget_deferred":
      return {
        key: `graphql-budget:${progress.repo}`,
        phase: "GraphQL",
        label: "Budget reserve reached",
        current: progress.matchedMergedPullRequests,
        state: "warn",
        detail: `remaining ${progress.remaining ?? "unknown"}, reset ${progress.resetAt ?? "unknown"}`,
        timelineStepId: "github_pr_fetch",
        timelineLabel: "Fetch PR metadata",
        timelineRepo: progress.repo,
      };
    case "github_graphql_checkpoint_resumed":
      return {
        key: `graphql-checkpoint:${progress.repo}`,
        phase: "GraphQL",
        label: "Resuming checkpoint",
        current: progress.matchedMergedPullRequests,
        state: "done",
        detail: `page size ${progress.pageSize}`,
        timelineStepId: "github_pr_fetch",
        timelineLabel: "Fetch PR metadata",
        timelineRepo: progress.repo,
      };
    case "github_graphql_retry":
      return {
        key: `graphql-retry:${progress.repo}`,
        phase: "GraphQL",
        label: "Retrying transient failure",
        state: "wait",
        current: progress.attempt,
        total: progress.maxAttempts - 1,
        detail: `${(progress.waitMs / 1000).toFixed(1)}s: ${progress.reason}`,
        timelineStepId: "github_pr_fetch",
        timelineLabel: "Fetch PR metadata",
        timelineRepo: progress.repo,
      };
    case "github_rate_limited":
      return {
        key: `rate-limit:${progress.repo}`,
        phase: "GitHub",
        label: "Waiting for rate limit",
        state: "wait",
        detail: `${progress.waitSeconds}s until ${progress.retryAt}`,
        timelineStepId: "github_pr_fetch",
        timelineLabel: "Fetch PR metadata",
        timelineRepo: progress.repo,
      };
    case "skipped_pull_request_fetch":
      return {
        key: `fetch:${progress.repo}`,
        phase: "GitHub",
        label: "Skipped PR fetch",
        state: "skip",
        detail: progress.reason,
        timelineStepId: "github_pr_fetch",
        timelineLabel: "PR history",
        timelineRepo: progress.repo,
      };
  }
}

function indexTask(progress: IndexPullRequestsProgress): ProgressTask {
  return {
    key: `index-prs:${progress.repo}`,
    phase: "SQLite",
    label:
      progress.stage === "indexing_pull_request"
        ? "Indexing PR history"
        : "Indexed PR history",
    current: progress.current,
    total: progress.total,
    state:
      progress.stage === "indexed_pull_request" && progress.current >= progress.total
        ? "done"
        : "active",
    detail:
      progress.stage === "indexed_pull_request"
        ? `#${progress.prNumber} (${progress.wisdomUnitsCreated} wisdom, ${progress.regressionEventsCreated} regressions)`
        : `#${progress.prNumber}`,
    timelineStepId: "sqlite_pr_index",
    timelineLabel: "Index PR history",
    timelineRepo: progress.repo,
  };
}

function codeTask(progress: CodeIndexProgress): ProgressTask {
  switch (progress.stage) {
    case "discovering_code_files":
      return {
        key: `code:${progress.repo}`,
        phase: "Code",
        label: "Discovering code files",
        current: progress.scanned,
        total: progress.total,
        detail:
          typeof progress.scanned === "number" && typeof progress.total === "number"
            ? `scanned ${progress.scanned}/${progress.total}`
            : progress.repo,
        timelineStepId: "code_discovery",
        timelineLabel: "Discover code files",
        timelineRepo: progress.repo,
      };
    case "discovered_code_files":
      return {
        key: `code:${progress.repo}`,
        phase: "Code",
        label: "Code files discovered",
        current: progress.files,
        total: progress.files,
        state: "done",
        detail: `${progress.skippedFiles} skipped`,
        timelineStepId: "code_discovery",
        timelineLabel: "Discover code files",
        timelineRepo: progress.repo,
      };
    case "indexing_code_file":
      return {
        key: `code:${progress.repo}`,
        phase: "Code",
        label: "Indexing code",
        current: progress.current,
        total: progress.total,
        detail: progress.filePath,
        timelineStepId: "code_chunks",
        timelineLabel: "Build code chunks",
        timelineRepo: progress.repo,
      };
    case "indexed_code_file":
      return {
        key: `code:${progress.repo}`,
        phase: "Code",
        label: "Indexed code",
        current: progress.current,
        total: progress.total,
        state: progress.current >= progress.total ? "done" : "active",
        detail: `${progress.filePath} (${progress.chunks} chunks)`,
        timelineStepId: "code_chunks",
        timelineLabel: "Build code chunks",
        timelineRepo: progress.repo,
      };
    case "building_architecture_imports":
      return {
        key: `architecture-build:${progress.repo}`,
        phase: "Architecture",
        label: "Building imports",
        current: progress.current,
        total: progress.total,
        detail: `${progress.imports} imports${progress.filePath ? ` · ${progress.filePath}` : ""}`,
        timelineStepId: "architecture_imports",
        timelineLabel: "Build architecture imports",
        timelineRepo: progress.repo,
      };
    case "building_architecture_components":
      return {
        key: `architecture-build:${progress.repo}`,
        phase: "Architecture",
        label: "Building components",
        current: progress.current,
        total: progress.total,
        detail: `${progress.components} components${progress.filePath ? ` · ${progress.filePath}` : ""}`,
        timelineStepId: "architecture_components",
        timelineLabel: "Build architecture components",
        timelineRepo: progress.repo,
      };
    case "building_architecture_patterns":
      return {
        key: `architecture-build:${progress.repo}`,
        phase: "Architecture",
        label: "Building patterns",
        current: progress.current,
        total: progress.total,
        detail: `${progress.patterns} patterns${progress.area ? ` · ${progress.area}` : ""}`,
        timelineStepId: "architecture_patterns",
        timelineLabel: "Build architecture patterns",
        timelineRepo: progress.repo,
      };
    case "indexed_architecture":
      return {
        key: `architecture:${progress.repo}`,
        phase: "Architecture",
        label: "Indexed architecture memory",
        state: "done",
        detail: `${progress.components} components, ${progress.patterns} patterns, ${progress.imports} imports`,
        timelineStepId: "architecture_patterns",
        timelineLabel: "Build architecture patterns",
        timelineRepo: progress.repo,
      };
    case "writing_code_index":
      return {
        key: `code-write:${progress.repo}`,
        phase: "SQLite",
        label: progress.phase,
        timelineStepId: "sqlite_code_write",
        timelineLabel: progress.phase,
        timelineRepo: progress.repo,
      };
    case "inferring_test_awareness":
      return {
        key: `test-awareness-infer:${progress.repo}`,
        phase: "Tests",
        label: `Inferring test awareness: ${progress.phase.replace("_", " ")}`,
        current: progress.current,
        total: progress.total,
        state: progress.phase === "completed" ? "done" : "active",
        detail: `${progress.testFiles} tests, ${progress.testLinks} links${progress.filePath ? ` · ${progress.filePath}` : ""}`,
        timelineStepId: "test_awareness_inference",
        timelineLabel: "Infer test awareness",
        timelineRepo: progress.repo,
      };
    case "deleting_existing_code_index":
      return {
        key: `code-write:${progress.repo}`,
        phase: "SQLite",
        label: "Deleting old code index",
        state: "active",
        detail: `${progress.chunks} chunks, ${progress.patterns} patterns`,
        timelineStepId: "sqlite_code_delete",
        timelineLabel: "Delete old code index",
        timelineRepo: progress.repo,
      };
    case "writing_code_files":
      return {
        key: `code-write:${progress.repo}`,
        phase: "SQLite",
        label: "Writing code files",
        current: progress.current,
        total: progress.total,
        detail: progress.filePath,
        timelineStepId: "sqlite_code_files",
        timelineLabel: "Write code files",
        timelineRepo: progress.repo,
      };
    case "writing_code_chunks":
      return {
        key: `code-write:${progress.repo}`,
        phase: "SQLite",
        label: "Writing code chunks",
        current: progress.current,
        total: progress.total,
        detail: `${progress.chunks} chunks${progress.filePath ? ` · ${progress.filePath}` : ""}`,
        timelineStepId: "sqlite_code_chunks",
        timelineLabel: "Write code chunks",
        timelineRepo: progress.repo,
      };
    case "writing_test_awareness":
      return {
        key: `test-awareness:${progress.repo}:${progress.kind}`,
        phase: "Tests",
        label: `Writing ${progress.kind.replace("_", " ")}`,
        current: progress.current,
        total: progress.total,
        timelineStepId: "test_awareness",
        timelineLabel: "Write test awareness",
        timelineRepo: progress.repo,
      };
    case "writing_architecture_data":
      return {
        key: `architecture-write:${progress.repo}:${progress.kind}`,
        phase: "SQLite",
        label: `Writing architecture ${progress.kind}`,
        current: progress.current,
        total: progress.total,
        timelineStepId: "sqlite_architecture_data",
        timelineLabel: "Write architecture data",
        timelineRepo: progress.repo,
      };
    case "writing_architecture_map_edges":
      return {
        key: `architecture-map:${progress.repo}`,
        phase: "SQLite",
        label: "Writing architecture map",
        current: progress.current,
        total: progress.total,
        detail: `${progress.edges} edges`,
        timelineStepId: "architecture_map_edges",
        timelineLabel: "Write architecture map",
        timelineRepo: progress.repo,
      };
    case "refreshing_test_commands":
      return {
        key: `test-commands:${progress.repo}`,
        phase: "Tests",
        label: progress.phase === "detecting" ? "Detecting test commands" : "Writing test commands",
        current: progress.current,
        total: progress.total,
        detail: `${progress.commands} commands`,
        timelineStepId: "test_commands",
        timelineLabel: "Refresh test commands",
        timelineRepo: progress.repo,
      };
    case "completed_code_index":
      return {
        key: `code:${progress.repo}`,
        phase: "Code",
        label: "Code index complete",
        current: progress.files,
        total: progress.files,
        state: "done",
        detail: `${progress.chunks} chunks, ${progress.testFiles} tests, ${progress.testLinks} test links`,
        timelineStepId: "code_index_complete",
        timelineLabel: "Code index complete",
        timelineRepo: progress.repo,
      };
  }
}

function graphTask(progress: OrgGraphProgress): ProgressTask {
  switch (progress.stage) {
    case "loading_package_manifests":
      return {
        key: `graph:manifests:${progress.org}`,
        phase: "Org graph",
        label: "Reading package manifests",
        current: 0,
        total: progress.totalRepos,
        timelineStepId: "graph_manifests",
        timelineLabel: "Read package manifests",
        timelineRepo: `${progress.org} graph`,
      };
    case "loaded_package_manifests":
      return {
        key: `graph:manifests:${progress.org}`,
        phase: "Org graph",
        label: "Loaded package manifests",
        current: progress.repos,
        total: progress.repos,
        state: "done",
        detail: `${progress.packageNames} package names`,
        timelineStepId: "graph_manifests",
        timelineLabel: "Read package manifests",
        timelineRepo: `${progress.org} graph`,
      };
    case "building_package_edges":
      return {
        key: `graph:package-edges:${progress.org}`,
        phase: "Org graph",
        label: "Building package edges",
        current: progress.current,
        total: progress.total,
        state: progress.current >= progress.total ? "done" : "active",
        detail: `${progress.repo} (${progress.edges} edges)`,
        timelineStepId: "graph_package_edges",
        timelineLabel: "Build package edges",
        timelineRepo: `${progress.org} graph`,
      };
    case "loading_imports":
      return {
        key: `graph:imports:${progress.org}`,
        phase: "Org graph",
        label: "Loading imports",
        timelineStepId: "graph_imports",
        timelineLabel: "Load imports",
        timelineRepo: `${progress.org} graph`,
      };
    case "building_import_edges":
      return {
        key: `graph:imports:${progress.org}`,
        phase: "Org graph",
        label: "Building import edges",
        current: progress.current,
        total: progress.total,
        state: progress.current >= progress.total ? "done" : "active",
        detail: `${progress.edges} edges`,
        timelineStepId: "graph_import_edges",
        timelineLabel: "Build import edges",
        timelineRepo: `${progress.org} graph`,
      };
    case "loading_code_chunks":
      return {
        key: `graph:chunks:${progress.org}`,
        phase: "Org graph",
        label: "Loading code chunks",
        timelineStepId: "graph_code_chunks",
        timelineLabel: "Load code chunks",
        timelineRepo: `${progress.org} graph`,
      };
    case "extracting_api_contracts":
      return {
        key: `graph:contracts:${progress.org}`,
        phase: "Org graph",
        label: "Extracting API contracts",
        current: progress.current,
        total: progress.total,
        state: progress.current >= progress.total ? "done" : "active",
        detail: `${progress.contracts} contracts`,
        timelineStepId: "graph_api_contracts",
        timelineLabel: "Extract API contracts",
        timelineRepo: `${progress.org} graph`,
      };
    case "matching_api_consumers":
      return {
        key: `graph:consumers:${progress.org}`,
        phase: "Org graph",
        label: "Matching API consumers",
        current: progress.current,
        total: progress.total,
        state: progress.current >= progress.total ? "done" : "active",
        detail: `${progress.matches} new matches`,
        timelineStepId: "graph_api_consumers",
        timelineLabel: "Match API consumers",
        timelineRepo: `${progress.org} graph`,
      };
    case "writing_org_graph":
      return {
        key: `graph:write:${progress.org}`,
        phase: "Org graph",
        label: "Writing graph",
        current: progress.current,
        total: progress.total,
        detail: `${progress.edges} edges, ${progress.apiContracts} contracts, ${progress.apiConsumers} consumers`,
        timelineStepId: "graph_write",
        timelineLabel: "Write org graph",
        timelineRepo: `${progress.org} graph`,
      };
    case "completed_org_graph":
      return {
        key: `graph:write:${progress.org}`,
        phase: "Org graph",
        label: "Graph complete",
        state: "done",
        detail: `${progress.edges} edges, ${progress.apiConsumers} consumers in ${(progress.durationMs / 1000).toFixed(1)}s`,
        timelineStepId: "graph_write",
        timelineLabel: "Write org graph",
        timelineRepo: `${progress.org} graph`,
      };
  }
}

function cloneTask(progress: OrgCloneProgress): ProgressTask {
  if (progress.stage === "cloning_or_pulling_repo") {
    return {
      key: `clone:${progress.org}`,
      phase: "Git",
      label: "Cloning/pulling org repos",
      current: progress.current,
      total: progress.total,
      detail: progress.repo,
      timelineStepId: "clone_pull",
      timelineLabel: "Clone or pull repo",
      timelineRepo: progress.repo,
      timelineRepoIndex: progress.current,
      timelineRepoTotal: progress.total,
    };
  }
  return {
    key: `clone:${progress.org}`,
    phase: "Git",
    label: "Cloned/pulled org repos",
    current: progress.current,
    total: progress.total,
    state: progress.error ? "warn" : progress.current >= progress.total ? "done" : "active",
    detail: progress.error
      ? `${progress.repo} failed`
      : `${progress.repo} ${progress.cloned ? "cloned" : "pulled"}`,
    timelineStepId: "clone_pull",
    timelineLabel: "Clone or pull repo",
    timelineRepo: progress.repo,
    timelineRepoIndex: progress.current,
    timelineRepoTotal: progress.total,
  };
}
