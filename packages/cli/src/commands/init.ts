import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import {
  ANCHOR_AGENT_TARGETS,
  type AnchorAgentScope,
  type AnchorAgentTarget,
  type AutosyncInstallResult,
  type AutosyncMode,
  anchorMcpEntry,
  agentTargetLabel,
  configureAgentTargets,
  detectGitHubRepo,
  detectGitRoot,
  ensureAnchorGitExclude,
  installDefaultAutosync,
  parseAnchorAgentTargets,
  type AgentConfigResult,
} from "@pratik7368patil/anchor-core";

export type InitResult = {
  gitRoot: string;
  repo: string;
  gitExcludePath: string;
  gitExcludeUpdated: boolean;
  targets: AgentConfigResult[];
  autosync: AutosyncInstallResult;
};

export type InitOptions = {
  targets: AnchorAgentTarget[];
  scope?: AnchorAgentScope;
  autosync?: AutosyncMode;
};

export type InitCliOptions = {
  target?: string;
  allTargets?: boolean;
  scope?: AnchorAgentScope;
  autosync?: AutosyncMode | false;
};

function anchorMcpEntryForCurrentInstall(): Record<string, unknown> {
  const invokedPath = process.argv[1];
  if (
    invokedPath &&
    path.isAbsolute(invokedPath) &&
    fs.existsSync(invokedPath) &&
    !invokedPath.endsWith(".ts")
  ) {
    return anchorMcpEntry(invokedPath, ["serve"]);
  }
  return anchorMcpEntry("npx", ["-y", "@pratik7368patil/anchor@latest", "serve"]);
}

function anchorScriptPathForAutosync(): string {
  const invokedPath = process.argv[1];
  if (invokedPath && path.isAbsolute(invokedPath) && fs.existsSync(invokedPath) && !invokedPath.endsWith(".ts")) {
    return invokedPath;
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../index.js");
}

export function runInit(cwd: string, options: InitOptions): InitResult {
  const gitRoot = detectGitRoot(cwd);
  if (!gitRoot) {
    throw new Error(
      "No git repository detected. Run anchor init from inside the repository you use with your AI coding agent.",
    );
  }

  const repo = detectGitHubRepo(gitRoot);
  if (!repo) {
    throw new Error(
      "No GitHub origin remote detected. Set origin to a GitHub repo, then rerun anchor init.",
    );
  }

  if (options.targets.length === 0) {
    throw new Error("No Anchor agent targets selected. Rerun anchor init and select at least one target.");
  }

  const targets = configureAgentTargets({
    cwd: gitRoot,
    targets: options.targets,
    scope: options.scope ?? "project",
    anchorEntry: anchorMcpEntryForCurrentInstall(),
  });
  const gitExclude = ensureAnchorGitExclude(gitRoot);
  const autosync = installDefaultAutosync({
    cwd: gitRoot,
    mode: options.autosync ?? "daily",
    nodePath: process.execPath,
    anchorScriptPath: anchorScriptPathForAutosync(),
  });

  return {
    gitRoot,
    repo: repo.fullName,
    gitExcludePath: gitExclude.path,
    gitExcludeUpdated: gitExclude.updated,
    targets,
    autosync,
  };
}

export function printInitResult(result: InitResult): void {
  console.log("Anchor initialized for AI coding agents.");
  console.log(`Repo: ${result.repo}`);
  console.log(`Local git exclude: ${result.gitExcludePath}`);
  console.log("");
  for (const target of result.targets) {
    console.log(`${target.skipped ? "!" : "✓"} ${target.label}: ${target.message}`);
    for (const file of target.files) {
      const state = file.created ? "created" : file.updated ? "updated" : "already up to date";
      console.log(`  - ${file.path} (${state})`);
    }
    if (target.manualConfig) {
      console.log("  Manual MCP config:");
      console.log(indent(target.manualConfig, "    "));
    }
  }
  console.log("");
  console.log(`Anchor index exclude ${result.gitExcludeUpdated ? "added" : "already existed"}.`);
  console.log(
    "No GitHub token was written to disk. Anchor can use GITHUB_TOKEN, GH_TOKEN, or gh auth token for indexing.",
  );
  console.log("");
  if (result.autosync.enabled) {
    console.log("Autosync:");
    console.log(`  Config: ${result.autosync.configPath}`);
    for (const job of result.autosync.jobs) {
      console.log(
        `  ${job.installed ? "✓" : "!"} ${job.label} (${job.scheduler}, ${job.nextRunHint})`,
      );
      console.log(`    Logs: ${job.logPath}`);
      if (!job.installed) console.log(`    ${job.message}`);
    }
    if (result.autosync.warnings.length > 0) {
      for (const warning of result.autosync.warnings) console.log(`  Warning: ${warning}`);
    }
    console.log("  Opt out: anchor init --no-autosync");
  } else {
    console.log("Autosync: disabled.");
  }
  console.log("");
  console.log("Next commands:");
  console.log("1. anchor index-code");
  console.log("2. anchor index --limit 50");
  console.log("3. anchor health");
}

export function parseInitTargets(options: InitCliOptions): AnchorAgentTarget[] | undefined {
  if (options.allTargets) return [...ANCHOR_AGENT_TARGETS];
  if (options.target) return parseAnchorAgentTargets(options.target);
  return undefined;
}

export async function resolveInitTargets(
  options: InitCliOptions,
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stdout,
): Promise<AnchorAgentTarget[]> {
  const parsed = parseInitTargets(options);
  if (parsed) return parsed;
  if (!input.isTTY || !output.isTTY) {
    throw new Error("anchor init requires --target or --all-targets when not running interactively.");
  }
  return selectTargetsInteractively(input, output);
}

async function selectTargetsInteractively(
  input: NodeJS.ReadStream,
  output: NodeJS.WriteStream,
): Promise<AnchorAgentTarget[]> {
  readline.emitKeypressEvents(input);
  const wasRaw = input.isRaw;
  input.setRawMode(true);
  let cursor = 0;
  const selected = new Set<AnchorAgentTarget>();

  function render() {
    output.write("\x1b[?25l");
    output.write("\x1b[2J\x1b[H");
    output.write("Where do you want to configure Anchor?\n");
    output.write("Use ↑/↓, Space to select, Enter to confirm.\n\n");
    ANCHOR_AGENT_TARGETS.forEach((target, index) => {
      const active = index === cursor ? "›" : " ";
      const checked = selected.has(target) ? "x" : " ";
      output.write(`${active} [${checked}] ${agentTargetLabel(target)}\n`);
    });
  }

  render();
  try {
    return await new Promise((resolve, reject) => {
      const finish = () => {
        input.off("keypress", onKeypress);
        output.write("\x1b[?25h");
        output.write("\n");
      };
      function onKeypress(_chunk: string, key: readline.Key) {
        if (key.ctrl && key.name === "c") {
          finish();
          reject(new Error("anchor init canceled."));
          return;
        }
        if (key.name === "up") cursor = (cursor - 1 + ANCHOR_AGENT_TARGETS.length) % ANCHOR_AGENT_TARGETS.length;
        if (key.name === "down") cursor = (cursor + 1) % ANCHOR_AGENT_TARGETS.length;
        if (key.name === "space") {
          const target = ANCHOR_AGENT_TARGETS[cursor]!;
          if (selected.has(target)) selected.delete(target);
          else selected.add(target);
        }
        if (key.name === "return") {
          finish();
          resolve([...selected]);
          return;
        }
        render();
      }
      input.on("keypress", onKeypress);
    });
  } finally {
    input.setRawMode(wasRaw);
    output.write("\x1b[?25h");
  }
}

function indent(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}
