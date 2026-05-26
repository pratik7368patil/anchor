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
anchor plan "Add API integration" --file src/api/routes.ts
anchor test-command src/api/routes.ts
anchor explain src/api/routes.ts
anchor architecture --file src/api/routes.ts
anchor architecture --map --format mermaid
anchor architecture --check
anchor review --share
anchor onboarding --area api
anchor ci`;

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
        description:
          "Indexes recent merged GitHub PRs with GraphQL batching plus the local codebase. Default: 200 PRs.",
      },
      {
        command: "anchor index-all",
        description:
          "Indexes all merged PR history with GraphQL first and REST only for patch enrichment.",
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
        command: "anchor plan \"<task>\"",
        description:
          "Creates a deterministic edit plan with target files, likely symbols, risks, and exact checks.",
      },
      {
        command: "anchor test-command <file>",
        description:
          "Infers the most specific test command for a source or test file from scripts and test links.",
      },
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
        command: "anchor architecture --map",
        description: "Prints a Mermaid or JSON architecture graph from imports and test links.",
      },
      {
        command: "anchor review",
        description: "Reviews the current git diff against Anchor history and known risks.",
      },
      {
        command: "anchor review --share",
        description: "Creates a compact review summary for Slack or PR comments.",
      },
      {
        command: "anchor onboarding",
        description: "Builds a focused onboarding pack for a file, area, or repository.",
      },
    ],
  },
  {
    title: "Reliability and team workflows",
    intro: "Add deterministic gates, live refresh, local feedback, and repo playbooks.",
    commands: [
      {
        command: "anchor eval init",
        description: "Creates anchor.evals.json for golden retrieval checks.",
      },
      {
        command: "anchor eval add",
        description: "Adds a task-to-expected-evidence eval case.",
      },
      {
        command: "anchor eval run",
        description: "Runs retrieval evals and reports ranking drift or missing evidence.",
      },
      {
        command: "anchor watch",
        description: "Refreshes code, architecture, test links, and test commands while you work.",
      },
      {
        command: "anchor ci",
        description: "Runs rules, evidence, eval, stale-index, and coverage gates for CI.",
      },
      {
        command: "anchor feedback record",
        description: "Stores local-only useful/not-useful feedback for ranking transparency.",
      },
      {
        command: "anchor playbooks suggest",
        description: "Suggests workflow playbooks from repeated local evidence.",
      },
      {
        command: "anchor playbooks list",
        description: "Lists committed repo playbooks.",
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
  { name: "--concurrency 5", description: "Enrich PR patches and supplemental pages in parallel." },
  { name: "--no-code", description: "Skip codebase indexing." },
  { name: "--since YYYY-MM-DD", description: "Index PRs updated since a date." },
  { name: "--force", description: "Rebuild the local index." },
  {
    name: "--strict",
    description: "Fail closed unless evidence is non-stale, confident, and directly relevant.",
  },
  { name: "--file <path>", description: "Focus architecture or explain output on one file." },
  { name: "--area api", description: "Filter architecture patterns by area." },
  { name: "--check", description: "Check the current diff against architecture patterns." },
  { name: "--map", description: "Render an architecture map from imports and test links." },
  { name: "--format mermaid|json", description: "Choose architecture map output format." },
  { name: "--min-coverage 70", description: "Set the coverage threshold for anchor ci." },
  { name: "--interval 30", description: "Set watch-mode refresh interval in seconds." },
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
  {
    name: "anchor_plan_task",
    description: "Creates an evidence-backed deterministic edit plan for Cursor.",
  },
  {
    name: "anchor_get_test_commands",
    description: "Returns exact local test commands inferred for a file.",
  },
  {
    name: "anchor_get_architecture_map",
    description: "Returns Mermaid or JSON architecture graph data.",
  },
  {
    name: "anchor_onboarding_pack",
    description: "Summarizes areas, files, risks, tests, playbooks, and starter prompts.",
  },
  {
    name: "anchor_get_playbook",
    description: "Returns one committed repo playbook with cited evidence.",
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
  "Architecture maps in Mermaid or JSON",
  "Related test detection",
  "Exact test-command guidance",
  "Task planning before edits",
  "File onboarding with anchor explain",
  "Onboarding packs for files and areas",
  "Diff review with anchor review",
  "Golden retrieval evals",
  "Watch mode for fresh local code context",
  "CI reliability gate",
  "Local feedback for ranking transparency",
  "Repo playbooks for repeated workflows",
  "Team-approved rules via anchor.rules.json",
  "Strict mode with confidence and freshness checks",
  "Reliability gate for weak, stale, or loose matches",
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
  "Ask Anchor for the exact test command before and after edits.",
  "Build a deterministic implementation plan before Cursor starts changing files.",
  "Review a diff before opening a PR.",
  "Run Anchor in CI to catch stale indexes, invalid rules, and retrieval drift.",
  "Create onboarding packs for new developers or unfamiliar repo areas.",
  "Use repo playbooks for repeated tasks such as adding API integrations or tests.",
  "Check whether new code follows existing architecture patterns.",
  "Generate a local architecture briefing for onboarding or refactors.",
  "Convert repeated tribal knowledge into team-approved rules.",
  "Onboard new developers faster.",
  "Demo repo memory to the team without GitHub access.",
  "Keep Cursor grounded in actual repo history instead of guessing.",
  "Use strict mode for risky work so loose historical matches do not steer the agent.",
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
    path: "/docs/planning",
    title: "Planning and tests",
    description: "Plan tasks and get exact test commands before editing.",
    group: "Guide",
  },
  {
    path: "/docs/architecture",
    title: "Architecture Memory",
    description: "Understand file areas, import direction, symbols, and architecture checks.",
    group: "Guide",
  },
  {
    path: "/docs/onboarding",
    title: "Onboarding packs",
    description: "Create focused repo, file, and area onboarding briefs.",
    group: "Guide",
  },
  {
    path: "/docs/ci",
    title: "CI and evals",
    description: "Use retrieval evals and CI gates to keep Anchor reliable.",
    group: "Guide",
  },
  {
    path: "/docs/playbooks",
    title: "Playbooks",
    description: "Turn repeated evidence into repo workflow playbooks.",
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
