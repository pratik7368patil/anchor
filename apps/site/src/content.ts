export type Command = {
  command: string;
  description: string;
};

export type CommandGroup = {
  title: string;
  intro: string;
  commands: Command[];
};

export type TableItem = {
  name: string;
  description: string;
};

export type DocsPage = {
  path: string;
  title: string;
  description: string;
  group: string;
};

export const repoUrl = "https://github.com/pratik7368patil/anchor";

export const installCommand = `npm install -g @pratik7368patil/anchor
gh auth login
anchor init
anchor index
anchor doctor`;

export const workflowCommand = `anchor demo
anchor prompts
anchor explain src/api/routes.ts
anchor architecture --file src/api/routes.ts
anchor architecture --check
anchor review --share`;

export const commandGroups: CommandGroup[] = [
  {
    title: "Setup",
    intro:
      "Start with a real repo, or run the offline demo when you want to show the idea without GitHub access.",
    commands: [
      {
        command: "anchor init",
        description:
          "Sets up Cursor MCP config and the Cursor rule that tells Cursor when to ask Anchor for context.",
      },
      {
        command: "anchor demo",
        description: "Runs an offline demo with sample PR and code data. No GitHub token needed.",
      },
      {
        command: "anchor prompts",
        description: "Prints ready-to-use Cursor prompts for common Anchor workflows.",
      },
      {
        command: "anchor doctor",
        description: "Checks git repo, GitHub auth, Cursor config, database, and MCP server setup.",
      },
      {
        command: "anchor serve",
        description: "Starts the MCP stdio server used by Cursor.",
      },
    ],
  },
  {
    title: "Indexing",
    intro: "Build the repo memory that Cursor can query before edits.",
    commands: [
      {
        command: "anchor index",
        description: "Indexes recent merged GitHub PRs and the local codebase. Default: 200 PRs.",
      },
      {
        command: "anchor index-all",
        description: "Indexes all merged PR history. Useful when you want full repo memory.",
      },
      {
        command: "anchor index-code",
        description: "Indexes only the local codebase. No GitHub token needed.",
      },
      {
        command: "anchor sync",
        description: "Incrementally syncs new or updated PR history and refreshes the code index.",
      },
      {
        command: "anchor health",
        description:
          "Shows index quality, freshness, coverage score, and the next recommended command.",
      },
    ],
  },
  {
    title: "Context and review",
    intro:
      "Use these when you want a concise briefing before edits, refactors, onboarding, or PR review.",
    commands: [
      {
        command: "anchor explain <file>",
        description:
          "Explains a file using PR history, local code, tests, regressions, and team rules.",
      },
      {
        command: "anchor explain <file> --share",
        description: "Creates compact Markdown for Slack or PR comments.",
      },
      {
        command: "anchor architecture",
        description: "Summarizes deterministic architecture patterns from the local code index.",
      },
      {
        command: "anchor architecture --file <file>",
        description: "Explains placement, imports, symbols, and test patterns for one file.",
      },
      {
        command: "anchor architecture --check",
        description: "Checks the current git diff against indexed architecture patterns.",
      },
      {
        command: "anchor review",
        description: "Reviews the current git diff against Anchor history and known risks.",
      },
      {
        command: "anchor review --share",
        description: "Creates a compact review summary for Slack or PR comments.",
      },
    ],
  },
  {
    title: "Team rules",
    intro: "Turn repeated historical evidence into explicit, reviewed repo rules.",
    commands: [
      {
        command: "anchor rules init",
        description: "Creates anchor.rules.json.",
      },
      {
        command: "anchor rules validate",
        description: "Validates team-approved rules.",
      },
      {
        command: "anchor rules list",
        description: "Lists team-approved rules.",
      },
      {
        command: "anchor rules add",
        description: "Adds a rule with required PR evidence.",
      },
      {
        command: "anchor rules check-evidence",
        description: "Checks that rule PR citations exist in the local index.",
      },
      {
        command: "anchor rules suggest",
        description: "Suggests draft rules from repeated, high-confidence local evidence.",
      },
    ],
  },
];

export const options: TableItem[] = [
  { name: "--repo owner/name", description: "Index a specific GitHub repo." },
  { name: "--limit 50", description: "Limit the number of PRs indexed." },
  { name: "--all", description: "Fetch all merged PRs." },
  { name: "--concurrency 5", description: "Fetch PR details in parallel." },
  { name: "--no-code", description: "Skip codebase indexing." },
  { name: "--since YYYY-MM-DD", description: "Index PRs updated since a date." },
  { name: "--force", description: "Rebuild the local index." },
  { name: "--strict", description: "Only return stronger, non-stale evidence." },
  { name: "--file <path>", description: "Focus architecture or explain output on one file." },
  { name: "--area api", description: "Filter architecture patterns by area." },
  { name: "--check", description: "Check the current diff against architecture patterns." },
  { name: "--diff-file path", description: "Read a saved diff instead of the current git diff." },
  { name: "--write-doc", description: "Write ANCHOR_ARCHITECTURE.md from architecture output." },
  { name: "--json", description: "Output machine-readable JSON." },
  { name: "--share", description: "Output short Markdown for sharing." },
];

export const mcpTools: TableItem[] = [
  {
    name: "anchor_get_context",
    description: "Main tool. Gives historical and code context before Cursor edits.",
  },
  {
    name: "anchor_search_history",
    description: "Manual search over indexed PR history.",
  },
  {
    name: "anchor_index_status",
    description: "Shows local index status and coverage.",
  },
  {
    name: "anchor_explain_file",
    description: "Explains one file before editing.",
  },
  {
    name: "anchor_review_diff",
    description: "Reviews a diff against repo history.",
  },
  {
    name: "anchor_get_architecture",
    description:
      "Returns deterministic current-code architecture patterns for a file, area, or query.",
  },
  {
    name: "anchor_check_architecture",
    description: "Checks a diff against indexed placement, import, and test patterns.",
  },
];

export const features = [
  "Local-first PR history index",
  "Local codebase index",
  "Cursor-only MCP server",
  "SQLite + FTS search",
  "Evidence-backed answers with PR citations",
  "Prompt-injection neutralization",
  "Secret redaction",
  "Regression memory",
  "Architecture Memory from local code",
  "Related test detection",
  "File onboarding with anchor explain",
  "Diff review with anchor review",
  "Team-approved rules via anchor.rules.json",
  "Strict mode with confidence and freshness checks",
  "Coverage score via anchor health",
  "Offline demo via anchor demo",
  "Shareable Slack and PR summaries",
];

export const useCases = [
  "Before refactoring a file, ask Cursor to call anchor_get_context.",
  "Understand why a file exists or why it is designed a certain way.",
  "Find historical constraints before changing APIs.",
  "Avoid repeating regressions from old PRs.",
  "Discover likely related tests to run.",
  "Review a diff before opening a PR.",
  "Check whether new code follows existing architecture patterns.",
  "Generate a local architecture briefing for onboarding or refactors.",
  "Convert repeated tribal knowledge into team-approved rules.",
  "Onboard new developers faster.",
  "Demo repo memory to the team without GitHub access.",
  "Keep Cursor grounded in actual repo history instead of guessing.",
];

export const docsPages: DocsPage[] = [
  {
    path: "/docs",
    title: "Introduction",
    description: "How Anchor is organized and where to start.",
    group: "Start",
  },
  {
    path: "/docs/quickstart",
    title: "Installation",
    description: "Install Anchor, configure Cursor, and build the first local index.",
    group: "Start",
  },
  {
    path: "/docs/workflows",
    title: "Workflows",
    description: "Use Anchor before edits, file onboarding, reviews, and team sharing.",
    group: "Guide",
  },
  {
    path: "/docs/architecture",
    title: "Architecture Memory",
    description: "Understand file areas, import direction, symbols, and architecture checks.",
    group: "Guide",
  },
  {
    path: "/docs/rules",
    title: "Configuration",
    description: "Turn repeated historical evidence into reviewed repository rules.",
    group: "Guide",
  },
  {
    path: "/docs/cli",
    title: "CLI reference",
    description: "All Anchor commands grouped by the job they perform.",
    group: "Reference",
  },
  {
    path: "/docs/options",
    title: "Options",
    description: "Useful flags for indexing, filtering, machine output, and sharing.",
    group: "Reference",
  },
  {
    path: "/docs/mcp",
    title: "MCP tools",
    description: "The Cursor-facing tools exposed by the Anchor MCP server.",
    group: "Reference",
  },
  {
    path: "/docs/privacy",
    title: "Privacy and safety",
    description: "The local-first, read-only, sanitized evidence model.",
    group: "Safety",
  },
  {
    path: "/docs/features",
    title: "Features",
    description: "The product capabilities in one scannable reference.",
    group: "Safety",
  },
  {
    path: "/docs/use-cases",
    title: "Use cases",
    description: "Where Anchor should become part of the team workflow.",
    group: "Safety",
  },
];
