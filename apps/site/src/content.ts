export type Command = {
  command: string;
  description: string;
};

export type CommandOption = {
  name: string;
  description: string;
  useWhen: string;
  example: string;
};

export type CommandDetail = {
  recommendedUse: string;
  example: string;
  options?: CommandOption[];
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

export type WorkflowRecipe = {
  title: string;
  useWhen: string;
  commands: string[];
  notes: string;
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
anchor org sync --org my-org --no-graph
anchor org graph --org my-org --open
anchor org impact --org my-org --repo my-org/backend-api --strict
anchor onboarding --area api
anchor ci`;

export const workflowRecipes: WorkflowRecipe[] = [
  {
    title: "First-time setup in one repo",
    useWhen:
      "Use this when a developer installs Anchor for the first time in a GitHub-backed repo.",
    commands: ["anchor init", "anchor index --limit 200", "anchor doctor"],
    notes:
      "Run from the repository root, then reload Cursor so the MCP server and rule file are picked up.",
  },
  {
    title: "Code-only context without GitHub auth",
    useWhen:
      "Use this when GitHub auth is unavailable or you only need current-code architecture and tests.",
    commands: ["anchor index-code", "anchor architecture", "anchor health"],
    notes:
      "This skips PR history and still gives Cursor file areas, imports, symbols, test links, and code evidence.",
  },
  {
    title: "Full PR history safely",
    useWhen:
      "Use this when the default 200 PRs are not enough and you want complete historical memory.",
    commands: ["anchor index-all --concurrency 2", "anchor health"],
    notes:
      "Start with low concurrency for large repos. Anchor uses GraphQL first and stores resume checkpoints when rate limits require another run.",
  },
  {
    title: "Daily refresh",
    useWhen: "Use this after the first index to pick up new PRs and current code changes.",
    commands: ["anchor sync", "anchor health"],
    notes:
      "Sync is incremental and safe to run repeatedly. Add --no-code only when you want PR-only refresh.",
  },
  {
    title: "Before editing with Cursor",
    useWhen: "Use this before non-trivial refactors, tests, API changes, or unfamiliar files.",
    commands: [
      'anchor plan "Add API integration" --file src/api/routes.ts',
      "anchor test-command src/api/routes.ts",
      "anchor explain src/api/routes.ts",
    ],
    notes:
      "In Cursor, ask the agent to call anchor_get_context or anchor_plan_task before making the first edit.",
  },
  {
    title: "Before API, auth, access, or shared-package changes",
    useWhen: "Use this when the change can affect other repos or consumers.",
    commands: [
      "anchor org sync --org my-org --no-graph",
      "anchor org graph --org my-org --open",
      "anchor org impact --org my-org --repo my-org/backend-api --strict",
    ],
    notes:
      "Org Memory is explicit allowlist only. If a recent sync is interrupted after PR/code indexing, rerunning sync resumes unfinished graph work without redundant PR fetches for completed repos.",
  },
  {
    title: "Share context with the team",
    useWhen: "Use this when you want a short Slack or PR-comment summary.",
    commands: ["anchor explain src/api/routes.ts --share", "anchor review --share"],
    notes: "Share mode keeps the output compact, sanitized, and citation-focused.",
  },
  {
    title: "Measure reliability",
    useWhen:
      "Use this when you want to know whether Anchor's answers are trustworthy enough for CI.",
    commands: ["anchor health", "anchor eval run", "anchor ci --strict --min-coverage 70"],
    notes:
      "Health reports coverage and freshness. Evals catch retrieval drift. CI can fail on stale indexes, invalid rules, or low coverage.",
  },
];

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
          "Indexes all merged PR history with adaptive GraphQL batching and local resume checkpoints.",
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
        command: 'anchor plan "<task>"',
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
        command: "anchor playbooks init",
        description: "Creates anchor.playbooks.json for reviewed repo workflow playbooks.",
      },
      {
        command: "anchor playbooks suggest",
        description: "Suggests workflow playbooks from repeated local evidence.",
      },
      {
        command: "anchor playbooks list",
        description: "Lists committed repo playbooks.",
      },
      {
        command: "anchor playbooks get <id>",
        description: "Shows one committed playbook with cited evidence.",
      },
    ],
  },
  {
    title: "Org memory",
    intro:
      "Build a local allowlisted organization memory across repos for API, access, SDK, schema, and shared-package changes.",
    commands: [
      {
        command: "anchor org init --org <org>",
        description: "Creates ~/.anchor/orgs/<org>/org.json and org.sqlite.",
      },
      {
        command: "anchor org add-repo <owner/name>",
        description: "Allowlists one repo with an optional alias and group.",
      },
      {
        command: "anchor org list",
        description: "Lists allowlisted org repos and their configured aliases/groups.",
      },
      {
        command: "anchor org clone",
        description: "Shallow-clones missing repos and pulls existing managed clones.",
      },
      {
        command: "anchor org index",
        description: "Indexes allowlisted repo code and PR history into one local org database.",
      },
      {
        command: "anchor org sync",
        description: "Daily command: clone/pull, index, and rebuild the cross-repo graph.",
      },
      {
        command: "anchor org graph",
        description: "Rebuilds cross-repo edges and API consumers from already-indexed org data.",
      },
      {
        command: "anchor org status",
        description: "Shows org clone state, freshness, coverage, failures, and next commands.",
      },
      {
        command: "anchor org map",
        description: "Prints a Mermaid or JSON cross-repo architecture map.",
      },
      {
        command: "anchor org impact",
        description:
          "Checks a diff for cross-repo consumers, regressions, stale indexes, and anomalies.",
      },
      {
        command: "anchor org ci",
        description: "Runs org coverage and cross-repo anomaly gates for CI.",
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

const jsonOption = (example: string): CommandOption => ({
  name: "--json",
  description: "Print machine-readable JSON instead of Markdown.",
  useWhen: "Use it when piping Anchor output into scripts, CI, or another local tool.",
  example,
});

const strictOption = (example: string): CommandOption => ({
  name: "--strict",
  description: "Filter weak, stale, or loose matches and fail closed for risky checks.",
  useWhen:
    "Use it for auth, access, security, API contracts, shared packages, and broad refactors.",
  example,
});

const diffFileOption = (example: string): CommandOption => ({
  name: "--diff-file path",
  description: "Read a saved diff file instead of the current git diff.",
  useWhen: "Use it in CI, pre-PR review, or when reviewing a diff exported from another tool.",
  example,
});

export const commandDetails: Record<string, CommandDetail> = {
  "anchor init": {
    recommendedUse:
      "Run once from a repo root after installing Anchor. It merges Cursor MCP config, creates the Cursor rule, and locally excludes .anchor/ from git.",
    example: "anchor init",
  },
  "anchor demo": {
    recommendedUse:
      "Use this for a two-minute local demo or team walkthrough without GitHub access.",
    example: "anchor demo --keep --path /tmp/anchor-demo",
    options: [
      {
        name: "--json",
        description: "Return demo output as JSON.",
        useWhen: "Use it when validating demo output in scripts.",
        example: "anchor demo --json",
      },
      {
        name: "--keep",
        description: "Keep the temporary demo workspace after the run.",
        useWhen: "Use it when you want to inspect the demo database and sample files afterward.",
        example: "anchor demo --keep",
      },
      {
        name: "--path <dir>",
        description: "Create or reuse a specific demo directory.",
        useWhen: "Use it when presenting and you want a stable path across retries.",
        example: "anchor demo --path /tmp/anchor-demo --keep",
      },
    ],
  },
  "anchor prompts": {
    recommendedUse:
      "Use this to copy Cursor-ready prompts for before-edit, explain-file, review-diff, strict-mode, and org-impact workflows.",
    example: "anchor prompts",
    options: [jsonOption("anchor prompts --json")],
  },
  "anchor doctor": {
    recommendedUse:
      "Run when Cursor cannot see Anchor, indexing fails early, or you want to verify GitHub auth, MCP config, SQLite, and rule setup.",
    example: "anchor doctor",
  },
  "anchor serve": {
    recommendedUse:
      "Cursor runs this through .cursor/mcp.json. Humans usually run it only for MCP startup debugging.",
    example: "anchor serve",
  },
  "anchor index": {
    recommendedUse:
      "Default first index for most repos. It fetches recent merged PR evidence and refreshes local code, tests, and architecture memory.",
    example: "anchor index --repo owner/repo --limit 200 --concurrency 5",
    options: [
      {
        name: "--repo owner/name",
        description: "Index a specific GitHub repository instead of detecting origin.",
        useWhen: "Use it outside a repo root or when the git remote is missing/ambiguous.",
        example: "anchor index --repo owner/repo --limit 50",
      },
      {
        name: "--limit number",
        description: "Limit how many merged PRs are fetched for a normal run.",
        useWhen: "Use it for fast first setup, demos, or repos with heavy PR history.",
        example: "anchor index --limit 50",
      },
      {
        name: "--all",
        description: "Fetch every merged PR using the same command surface.",
        useWhen:
          "Use it only when you intentionally want full history; index-all is easier to remember.",
        example: "anchor index --all --concurrency 2",
      },
      {
        name: "--since YYYY-MM-DD",
        description: "Fetch PRs updated since a date.",
        useWhen: "Use it when backfilling a known period without scanning older history.",
        example: "anchor index --since 2026-01-01",
      },
      {
        name: "--force",
        description: "Rebuild the local index instead of preserving existing derived data.",
        useWhen:
          "Use it after schema changes, corrupted local state, or when health reports stale derived records.",
        example: "anchor index --force --limit 200",
      },
      {
        name: "--no-code",
        description: "Skip local code indexing after PR indexing.",
        useWhen: "Use it when you only want PR history and plan to run index-code separately.",
        example: "anchor index --no-code",
      },
      {
        name: "--concurrency 1-10",
        description: "Controls supplemental parallel work such as REST patch enrichment.",
        useWhen:
          "Use lower values for rate-limit safety and higher values for faster patch enrichment.",
        example: "anchor index --limit 200 --concurrency 2",
      },
    ],
  },
  "anchor index-all": {
    recommendedUse:
      "Use when you want complete merged PR history. Start with low concurrency on large repos to avoid rate-limit pressure.",
    example: "anchor index-all --repo owner/repo --concurrency 2",
    options: [
      {
        name: "--repo owner/name",
        description: "Index full history for a specific GitHub repo.",
        useWhen: "Use it when running outside the target repo or indexing a different remote.",
        example: "anchor index-all --repo owner/repo",
      },
      {
        name: "--since YYYY-MM-DD",
        description: "Limit full-history mode to PRs updated since a date.",
        useWhen: "Use it to backfill recent history first, then run a full pass later.",
        example: "anchor index-all --since 2025-01-01",
      },
      {
        name: "--force",
        description: "Rebuild full-history derived records.",
        useWhen: "Use it when health reports damaged or stale full-history data.",
        example: "anchor index-all --force --concurrency 1",
      },
      {
        name: "--no-code",
        description: "Skip local code indexing after PR indexing.",
        useWhen: "Use it when the code index is already fresh.",
        example: "anchor index-all --no-code",
      },
      {
        name: "--concurrency 1-10",
        description: "Controls supplemental patch enrichment parallelism.",
        useWhen: "Use 1-2 for safest full-history runs; use 5 only when rate limits are healthy.",
        example: "anchor index-all --concurrency 1",
      },
    ],
  },
  "anchor index-code": {
    recommendedUse:
      "Refresh only local code, test links, test commands, architecture patterns, and code snippets. No GitHub token is needed.",
    example: "anchor index-code",
    options: [
      {
        name: "--repo owner/name",
        description: "Record the code index under an explicit repo identity.",
        useWhen:
          "Use it when git remote detection is unavailable but you still want repo-scoped status.",
        example: "anchor index-code --repo owner/repo",
      },
      {
        name: "--force",
        description: "Rebuild current-code records even when the commit appears unchanged.",
        useWhen: "Use it after ignored-file changes, generated index issues, or health warnings.",
        example: "anchor index-code --force",
      },
    ],
  },
  "anchor sync": {
    recommendedUse:
      "Run after the first index. It fetches PRs updated since the last sync and refreshes current code by default.",
    example: "anchor sync --concurrency 2",
    options: [
      {
        name: "--repo owner/name",
        description: "Sync a specific repo instead of detecting origin.",
        useWhen: "Use it outside the repo root or when multiple remotes exist.",
        example: "anchor sync --repo owner/repo",
      },
      {
        name: "--all",
        description: "Fetch all merged PRs updated since the sync cursor.",
        useWhen: "Use it when the sync checkpoint is old and you want a complete catch-up.",
        example: "anchor sync --all --concurrency 2",
      },
      {
        name: "--since YYYY-MM-DD",
        description: "Override the sync cursor with a date.",
        useWhen: "Use it to recover from an interrupted sync or target a known window.",
        example: "anchor sync --since 2026-01-01",
      },
      {
        name: "--force",
        description: "Rebuild local data while syncing.",
        useWhen: "Use it when health reports stale or inconsistent local state.",
        example: "anchor sync --force",
      },
      {
        name: "--no-code",
        description: "Skip the code refresh portion.",
        useWhen: "Use it when only PR history changed or code indexing is expensive in the moment.",
        example: "anchor sync --no-code",
      },
      {
        name: "--concurrency 1-10",
        description: "Controls supplemental patch enrichment parallelism.",
        useWhen: "Use lower values if GitHub rate limits or secondary limits are close.",
        example: "anchor sync --concurrency 2",
      },
    ],
  },
  "anchor health": {
    recommendedUse:
      "Use after indexing or before CI to inspect coverage, freshness, failed runs, team rules, and the next recommended command.",
    example: "anchor health",
    options: [jsonOption("anchor health --json")],
  },
  'anchor plan "<task>"': {
    recommendedUse:
      "Use before Cursor edits. It turns Anchor evidence into target files, likely symbols, risks, steps, and exact checks.",
    example:
      'anchor plan "Add resource API integration" --file src/api/resource.ts --symbol createResource',
    options: [
      {
        name: "--file path",
        description: "Focus the plan on one likely target file.",
        useWhen: "Use it when you already know the file Cursor will edit.",
        example: 'anchor plan "Add API integration" --file src/api/routes.ts',
      },
      {
        name: "--symbol name",
        description:
          "Focus the plan on a likely function, class, hook, component, route, or API symbol.",
        useWhen: "Use it when the task names a specific contract or implementation point.",
        example: 'anchor plan "Refactor cache" --symbol AuthCache',
      },
      strictOption('anchor plan "Refactor auth cache" --file src/auth/cache.ts --strict'),
      jsonOption('anchor plan "Add API integration" --json'),
    ],
  },
  "anchor test-command <file>": {
    recommendedUse:
      "Use before and after edits to get the most specific test command Anchor can infer for a source or test file.",
    example: "anchor test-command src/services/resource.ts",
    options: [jsonOption("anchor test-command src/services/resource.ts --json")],
  },
  "anchor explain <file>": {
    recommendedUse:
      "Use before touching an unfamiliar file. It summarizes ownership, related PR decisions, regressions, tests, symbols, and architecture hints.",
    example: "anchor explain src/auth/cache.ts",
    options: [
      {
        name: "--share",
        description: "Output compact Markdown for Slack or PR comments.",
        useWhen: "Use it when sharing a file brief with the team.",
        example: "anchor explain src/auth/cache.ts --share",
      },
      jsonOption("anchor explain src/auth/cache.ts --json"),
    ],
  },
  "anchor explain <file> --share": {
    recommendedUse: "Use when you want a concise, sanitized file brief for Slack or a PR comment.",
    example: "anchor explain src/auth/cache.ts --share",
  },
  "anchor architecture": {
    recommendedUse:
      "Use to summarize current architecture patterns from the local code index before new files, refactors, or integrations.",
    example: "anchor architecture --area api",
    options: [
      {
        name: "--file path",
        description: "Explain architecture patterns for one file.",
        useWhen: "Use it before editing or moving a specific file.",
        example: "anchor architecture --file src/api/routes.ts",
      },
      {
        name: "--area api",
        description: "Filter architecture output to one detected area.",
        useWhen:
          "Use it before adding code to a known area such as api, service, component, hook, or test.",
        example: "anchor architecture --area service",
      },
      {
        name: "--check",
        description: "Check the current git diff against architecture patterns.",
        useWhen: "Use it before opening a PR or after Cursor changes files.",
        example: "anchor architecture --check",
      },
      {
        name: "--map",
        description: "Render an architecture graph.",
        useWhen: "Use it for onboarding, docs, or understanding import/test relationships.",
        example: "anchor architecture --map --format mermaid",
      },
      {
        name: "--format mermaid|json",
        description: "Choose graph output format.",
        useWhen: "Use mermaid for docs and json for tooling.",
        example: "anchor architecture --map --format json",
      },
      diffFileOption("anchor architecture --check --diff-file change.diff"),
      {
        name: "--write-doc",
        description: "Write ANCHOR_ARCHITECTURE.md from local evidence.",
        useWhen:
          "Use it only when you explicitly want a generated architecture document in the repo.",
        example: "anchor architecture --write-doc",
      },
      jsonOption("anchor architecture --json"),
    ],
  },
  "anchor architecture --file <file>": {
    recommendedUse:
      "Use for file-level placement, import, symbol, nearby-test, and pattern guidance.",
    example: "anchor architecture --file src/auth/cache.ts",
  },
  "anchor architecture --area api": {
    recommendedUse: "Use before adding or refactoring code in a specific architecture area.",
    example: "anchor architecture --area api",
  },
  "anchor architecture --check": {
    recommendedUse:
      "Use after changes to compare the current diff against indexed architecture patterns.",
    example: "anchor architecture --check",
    options: [diffFileOption("anchor architecture --check --diff-file change.diff")],
  },
  "anchor architecture --map": {
    recommendedUse: "Use for a visual or machine-readable map of imports, areas, and test links.",
    example: "anchor architecture --map --format mermaid",
    options: [
      {
        name: "--format mermaid|json",
        description: "Choose the graph format.",
        useWhen: "Use mermaid for human docs and json for tooling.",
        example: "anchor architecture --map --format json",
      },
    ],
  },
  "anchor review": {
    recommendedUse:
      "Use before opening a PR. It reviews the current git diff against history, rules, regressions, tests, and architecture patterns.",
    example: "anchor review --base main --strict",
    options: [
      {
        name: "--base branch",
        description: "Compare against a base branch instead of the working tree diff.",
        useWhen: "Use it before opening a PR from a feature branch.",
        example: "anchor review --base main",
      },
      diffFileOption("anchor review --diff-file change.diff"),
      strictOption("anchor review --strict"),
      {
        name: "--share",
        description: "Output compact Markdown for Slack or PR comments.",
        useWhen: "Use it when posting review context for teammates.",
        example: "anchor review --share",
      },
      jsonOption("anchor review --json"),
    ],
  },
  "anchor review --share": {
    recommendedUse: "Use when the review summary should fit in Slack or a PR comment.",
    example: "anchor review --share",
  },
  "anchor onboarding": {
    recommendedUse:
      "Use for a repo, area, or file briefing when a developer is new to a codebase or feature area.",
    example: "anchor onboarding --area api",
    options: [
      {
        name: "--file path",
        description: "Focus the onboarding brief on one file.",
        useWhen: "Use it for a new developer assigned to a specific file.",
        example: "anchor onboarding --file src/api/routes.ts",
      },
      {
        name: "--area api",
        description: "Focus the onboarding brief on one architecture area.",
        useWhen: "Use it for onboarding to an area such as api, service, component, hook, or test.",
        example: "anchor onboarding --area api",
      },
      jsonOption("anchor onboarding --area api --json"),
    ],
  },
  "anchor eval init": {
    recommendedUse: "Use when a team wants golden retrieval checks stored in anchor.evals.json.",
    example: "anchor eval init",
  },
  "anchor eval add": {
    recommendedUse: "Use to record a task that should retrieve expected PRs, files, or categories.",
    example:
      'anchor eval add --task "resource update contract" --file src/services/resource.ts --expect-pr 123',
    options: [
      {
        name: "--task text",
        description: "The retrieval task to evaluate.",
        useWhen: "Use a realistic developer prompt that should surface known evidence.",
        example: 'anchor eval add --task "auth cache lazy loading" --expect-pr 101',
      },
      {
        name: "--file path",
        description: "Expected target file for the eval case.",
        useWhen: "Use it when relevance depends on file-path ranking.",
        example:
          'anchor eval add --task "resource update contract" --file src/services/resource.ts',
      },
      {
        name: "--expect-pr number",
        description: "Expected PR evidence that should rank for the task.",
        useWhen: "Use it to pin important historical evidence against future ranking drift.",
        example: 'anchor eval add --task "resource update contract" --expect-pr 123',
      },
    ],
  },
  "anchor eval run": {
    recommendedUse:
      "Run locally or in CI to detect missing evidence, ranking drift, and reliability-gate failures.",
    example: "anchor eval run",
    options: [jsonOption("anchor eval run --json")],
  },
  "anchor watch": {
    recommendedUse:
      "Use during active development to refresh code, architecture, test links, and test commands while files change.",
    example: "anchor watch --interval 30",
    options: [
      {
        name: "--interval seconds",
        description: "Set the refresh interval.",
        useWhen: "Use a longer interval in large repos and a shorter one during rapid edits.",
        example: "anchor watch --interval 60",
      },
      {
        name: "--repo owner/name",
        description: "Set explicit repo identity for watch-mode state.",
        useWhen: "Use it when git remote detection is unavailable.",
        example: "anchor watch --repo owner/repo",
      },
    ],
  },
  "anchor ci": {
    recommendedUse:
      "Use in CI or before merge to validate rules, evidence, evals, stale index state, and coverage.",
    example: "anchor ci --strict --min-coverage 70",
    options: [
      strictOption("anchor ci --strict"),
      {
        name: "--min-coverage number",
        description: "Set the minimum coverage score required to pass.",
        useWhen: "Use it when adopting Anchor as a quality gate.",
        example: "anchor ci --min-coverage 70",
      },
      jsonOption("anchor ci --json"),
    ],
  },
  "anchor feedback record": {
    recommendedUse:
      "Use to store local-only useful/not-useful feedback for a result without hiding cited evidence.",
    example:
      'anchor feedback record --result-id anchor-result-id --rating useful --note "Good test match"',
    options: [
      {
        name: "--result-id id",
        description: "The Anchor result identifier to rate.",
        useWhen: "Use it after a context result was useful or misleading.",
        example: "anchor feedback record --result-id anchor-result-id --rating useful",
      },
      {
        name: "--rating useful|not-useful",
        description: "The local feedback rating.",
        useWhen: "Use useful for good matches and not-useful for noisy context.",
        example: "anchor feedback record --result-id anchor-result-id --rating not-useful",
      },
      {
        name: "--note text",
        description: "Optional local note.",
        useWhen: "Use it to explain why the result helped or missed.",
        example:
          'anchor feedback record --result-id anchor-result-id --rating useful --note "Found expected PR"',
      },
    ],
  },
  "anchor playbooks suggest": {
    recommendedUse:
      "Use to draft workflow playbooks from repeated local evidence. It does not write the playbook file.",
    example: "anchor playbooks suggest",
    options: [jsonOption("anchor playbooks suggest --json")],
  },
  "anchor playbooks init": {
    recommendedUse:
      "Use once when the repo wants committed workflow playbooks in anchor.playbooks.json.",
    example: "anchor playbooks init",
  },
  "anchor playbooks list": {
    recommendedUse: "Use to list committed repo playbooks from anchor.playbooks.json.",
    example: "anchor playbooks list",
  },
  "anchor playbooks get <id>": {
    recommendedUse: "Use to read one committed playbook before repeating a known workflow.",
    example: "anchor playbooks get add-api-integration",
  },
  "anchor org init --org <org>": {
    recommendedUse: "Run once to create the local org memory namespace under ~/.anchor/orgs/<org>.",
    example: "anchor org init --org my-org",
    options: [
      {
        name: "--org name",
        description: "Select the local org memory namespace.",
        useWhen: "Use it on every org command so Anchor knows which local org database to use.",
        example: "anchor org init --org my-org",
      },
    ],
  },
  "anchor org add-repo <owner/name>": {
    recommendedUse:
      "Use to explicitly allowlist one repo for org memory. Anchor never scans an org automatically.",
    example: "anchor org add-repo my-org/backend-api --org my-org --group backend --alias backend",
    options: [
      {
        name: "--org name",
        description: "Select the org namespace receiving the repo.",
        useWhen: "Use it when adding repos from anywhere outside the org cache.",
        example: "anchor org add-repo my-org/backend-api --org my-org",
      },
      {
        name: "--alias name",
        description: "Set a short display name for the repo.",
        useWhen: "Use it when full repo names are long or similar.",
        example: "anchor org add-repo my-org/backend-api --org my-org --alias backend",
      },
      {
        name: "--group backend|frontend|shared|infra|docs|unknown",
        description: "Classify the repo for maps and impact output.",
        useWhen: "Use it to make org maps and affected-repo summaries easier to scan.",
        example: "anchor org add-repo my-org/frontend-app --org my-org --group frontend",
      },
    ],
  },
  "anchor org list": {
    recommendedUse:
      "Use to inspect the explicit allowlist before cloning, indexing, or syncing org memory.",
    example: "anchor org list --org my-org",
    options: [
      {
        name: "--org name",
        description: "Select the org namespace.",
        useWhen: "Use it for every org list run.",
        example: "anchor org list --org my-org",
      },
      jsonOption("anchor org list --org my-org --json"),
    ],
  },
  "anchor org clone": {
    recommendedUse:
      "Use after allowlisting repos. It shallow-clones missing repos and pulls existing managed clones.",
    example: "anchor org clone --org my-org --concurrency 3",
    options: [
      {
        name: "--org name",
        description: "Select the org namespace.",
        useWhen: "Use it for every org clone run.",
        example: "anchor org clone --org my-org",
      },
      {
        name: "--repo owner/name",
        description: "Clone or pull one allowlisted repo.",
        useWhen: "Use it to retry one failed repo without touching others.",
        example: "anchor org clone --org my-org --repo my-org/backend-api",
      },
      {
        name: "--concurrency number",
        description: "Control how many repos clone or pull at once.",
        useWhen: "Use 1-3 for safer local/network load.",
        example: "anchor org clone --org my-org --concurrency 2",
      },
    ],
  },
  "anchor org index": {
    recommendedUse:
      "Use to index allowlisted repo code and PR history into the org database without necessarily pulling first.",
    example: "anchor org index --org my-org --repo my-org/backend-api",
    options: [
      {
        name: "--org name",
        description: "Select the org namespace.",
        useWhen: "Use it for every org index run.",
        example: "anchor org index --org my-org",
      },
      {
        name: "--repo owner/name",
        description: "Index one allowlisted repo.",
        useWhen: "Use it to retry or refresh one repo after a partial failure.",
        example: "anchor org index --org my-org --repo my-org/backend-api",
      },
      {
        name: "--code-only",
        description: "Refresh org code records and skip PR history.",
        useWhen: "Use it when GitHub auth is unavailable or code changed but PR history is fresh.",
        example: "anchor org index --org my-org --code-only",
      },
      {
        name: "--prs-only",
        description: "Fetch PR evidence and skip current-code refresh.",
        useWhen: "Use it when managed clones are already fresh or unavailable.",
        example: "anchor org index --org my-org --prs-only",
      },
      {
        name: "--no-graph",
        description: "Skip the final cross-repo graph rebuild.",
        useWhen:
          "Use it for large orgs when you want indexing to finish first and graph rebuild to run separately.",
        example: "anchor org index --org my-org --no-graph",
      },
      {
        name: "--force",
        description: "Rebuild derived org records for selected repos.",
        useWhen: "Use it after failed runs, schema changes, or stale org status warnings.",
        example: "anchor org index --org my-org --repo my-org/backend-api --force",
      },
    ],
  },
  "anchor org sync": {
    recommendedUse:
      "Daily org command. It clone/pulls, indexes changed repos, syncs PR evidence, and rebuilds the cross-repo graph.",
    example: "anchor org sync --org my-org --concurrency 3",
    options: [
      {
        name: "--org name",
        description: "Select the org namespace.",
        useWhen: "Use it for every org sync run.",
        example: "anchor org sync --org my-org",
      },
      {
        name: "--repo owner/name",
        description: "Sync one allowlisted repo.",
        useWhen: "Use it after one repo failed or only one repo changed.",
        example: "anchor org sync --org my-org --repo my-org/backend-api",
      },
      {
        name: "--concurrency number",
        description: "Control repo-level clone/index parallelism.",
        useWhen: "Use lower values for large repos or constrained machines.",
        example: "anchor org sync --org my-org --concurrency 2",
      },
      {
        name: "--since YYYY-MM-DD",
        description: "Sync PR history updated since a date.",
        useWhen: "Use it for targeted catch-up or after a failed historical backfill.",
        example: "anchor org sync --org my-org --since 2026-01-01",
      },
      {
        name: "--no-graph",
        description: "Skip the final cross-repo graph rebuild.",
        useWhen:
          "Use it when many repos are syncing and you want to run `anchor org graph` as its own visible step.",
        example: "anchor org sync --org my-org --no-graph --concurrency 2",
      },
      {
        name: "--force",
        description: "Force refresh selected org repo records.",
        useWhen: "Use it when status reports stale or inconsistent org data.",
        example: "anchor org sync --org my-org --repo my-org/backend-api --force",
      },
    ],
  },
  "anchor org graph": {
    recommendedUse:
      "Use after org indexing to rebuild cross-repo edges, API contracts, and API consumers without refetching GitHub or reindexing code.",
    example: "anchor org graph --org my-org",
    options: [
      {
        name: "--org name",
        description: "Select the org namespace.",
        useWhen: "Use it for every org graph run.",
        example: "anchor org graph --org my-org",
      },
      {
        name: "--repo owner/name",
        description:
          "Accepted for command compatibility; graph relationships are still rebuilt from the org database.",
        useWhen: "Use the full org graph for best cross-repo results.",
        example: "anchor org graph --org my-org --repo my-org/backend-api",
      },
      {
        name: "--html",
        description: "Write a standalone interactive HTML graph page under the local org cache.",
        useWhen: "Use it when you want to inspect or share the local graph file manually.",
        example: "anchor org graph --org my-org --html",
      },
      {
        name: "--open",
        description: "Write the HTML graph and open it in the default browser.",
        useWhen: "Use it for demos and visual debugging of cross-repo relationships.",
        example: "anchor org graph --org my-org --open",
      },
      {
        name: "--output path",
        description: "Choose where the generated HTML graph is written.",
        useWhen: "Use it when saving graph snapshots for local docs or demos.",
        example: "anchor org graph --org my-org --html --output /tmp/anchor-org-graph.html",
      },
      jsonOption("anchor org graph --org my-org --json"),
    ],
  },
  "anchor org status": {
    recommendedUse:
      "Use after org clone/index/sync to inspect freshness, coverage, failures, and suggested next commands.",
    example: "anchor org status --org my-org",
    options: [
      {
        name: "--org name",
        description: "Select the org namespace.",
        useWhen: "Use it for every org status run.",
        example: "anchor org status --org my-org",
      },
      jsonOption("anchor org status --org my-org --json"),
    ],
  },
  "anchor org map": {
    recommendedUse:
      "Use to inspect cross-repo architecture, package, import, API, schema, and test relationships.",
    example: "anchor org map --org my-org --format mermaid",
    options: [
      {
        name: "--org name",
        description: "Select the org namespace.",
        useWhen: "Use it for every org map run.",
        example: "anchor org map --org my-org",
      },
      {
        name: "--format mermaid|json",
        description: "Choose human-readable or machine-readable graph output.",
        useWhen: "Use mermaid for docs and json for tooling.",
        example: "anchor org map --org my-org --format json",
      },
    ],
  },
  "anchor org impact": {
    recommendedUse:
      "Use before API, auth, access, schema, SDK, shared-package, or broad refactor changes.",
    example:
      "anchor org impact --org my-org --repo my-org/backend-api --diff-file change.diff --strict",
    options: [
      {
        name: "--org name",
        description: "Select the org namespace.",
        useWhen: "Use it for every org impact run.",
        example: "anchor org impact --org my-org",
      },
      {
        name: "--repo owner/name",
        description: "Identify the repo whose diff is being checked.",
        useWhen: "Use it when running impact checks outside the managed clone.",
        example: "anchor org impact --org my-org --repo my-org/backend-api",
      },
      diffFileOption("anchor org impact --org my-org --diff-file change.diff"),
      strictOption("anchor org impact --org my-org --strict"),
      jsonOption("anchor org impact --org my-org --json"),
    ],
  },
  "anchor org ci": {
    recommendedUse:
      "Use in CI to validate org config, clone/index freshness, coverage, and cross-repo anomalies.",
    example: "anchor org ci --org my-org --strict --min-coverage 70",
    options: [
      {
        name: "--org name",
        description: "Select the org namespace.",
        useWhen: "Use it for every org CI run.",
        example: "anchor org ci --org my-org",
      },
      strictOption("anchor org ci --org my-org --strict"),
      {
        name: "--min-coverage number",
        description: "Set the minimum org coverage score.",
        useWhen: "Use it when adopting org memory as a merge gate.",
        example: "anchor org ci --org my-org --min-coverage 70",
      },
    ],
  },
  "anchor rules init": {
    recommendedUse: "Use once when your repo wants committed team-approved rules.",
    example: "anchor rules init",
  },
  "anchor rules validate": {
    recommendedUse: "Use after editing anchor.rules.json to validate schema and required evidence.",
    example: "anchor rules validate",
  },
  "anchor rules list": {
    recommendedUse: "Use to inspect committed team-approved rules.",
    example: "anchor rules list",
  },
  "anchor rules add": {
    recommendedUse:
      "Use to add one reviewed team rule with required PR evidence. Prefer running validate afterward.",
    example:
      'anchor rules add --id api-contract --category api_contract --text "Keep API stable." --pr-number 123 --pr-url https://github.com/owner/repo/pull/123',
    options: [
      {
        name: "--id id",
        description: "Stable rule identifier.",
        useWhen: "Use a short id that reviewers can recognize.",
        example: "anchor rules add --id api-contract --category api_contract",
      },
      {
        name: "--category category",
        description:
          "Rule category such as constraint, api_contract, security_note, or testing_rule.",
        useWhen: "Use the category that matches the evidence.",
        example: "anchor rules add --category api_contract",
      },
      {
        name: "--text text",
        description: "The rule text.",
        useWhen: "Use concise wording that can be reviewed and cited.",
        example: 'anchor rules add --text "Keep this API backward compatible."',
      },
      {
        name: "--pr-number number",
        description: "PR evidence number.",
        useWhen: "Use it so the rule can be checked against the local index.",
        example: "anchor rules add --pr-number 123",
      },
      {
        name: "--pr-url url",
        description: "PR evidence URL.",
        useWhen: "Use it so humans and Cursor can trace the rule back to evidence.",
        example: "anchor rules add --pr-url https://github.com/owner/repo/pull/123",
      },
      {
        name: "--source-type type",
        description: "Evidence source type such as review_comment, pr_body, or issue_comment.",
        useWhen: "Use it when the rule came from a specific evidence source.",
        example: "anchor rules add --source-type review_comment",
      },
      {
        name: "--file path",
        description: "Associate the rule with a file path.",
        useWhen: "Use it when the rule applies to specific files.",
        example: "anchor rules add --file src/api/routes.ts",
      },
      {
        name: "--symbol name",
        description: "Associate the rule with a symbol.",
        useWhen: "Use it when the rule applies to a function, class, component, hook, or contract.",
        example: "anchor rules add --symbol createResource",
      },
    ],
  },
  "anchor rules check-evidence": {
    recommendedUse: "Use to confirm cited PR evidence exists in the local Anchor index.",
    example: "anchor rules check-evidence",
  },
  "anchor rules suggest": {
    recommendedUse:
      "Use to find draft rules from repeated high-confidence constraints, API contracts, security notes, and regressions.",
    example: "anchor rules suggest --min-confidence moderate",
    options: [
      jsonOption("anchor rules suggest --json"),
      {
        name: "--category category",
        description: "Suggest rules for one category.",
        useWhen:
          "Use it when you want focused suggestions for API, security, testing, or constraints.",
        example: "anchor rules suggest --category api_contract",
      },
      {
        name: "--min-confidence strong|moderate|weak",
        description: "Set the minimum evidence confidence for suggestions.",
        useWhen: "Use strong for low-noise team adoption and moderate for exploration.",
        example: "anchor rules suggest --min-confidence strong",
      },
    ],
  },
};

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
  {
    name: "anchor_get_org_context",
    description: "Returns concise context across allowlisted org repos for broad work.",
  },
  {
    name: "anchor_check_cross_repo_impact",
    description: "Checks API/auth/shared/schema diffs for cross-repo impact and anomalies.",
  },
  {
    name: "anchor_find_api_consumers",
    description:
      "Finds repos and files that consume a provider API, schema, route, or SDK contract.",
  },
  {
    name: "anchor_get_org_architecture",
    description: "Returns a local cross-repo architecture map.",
  },
  {
    name: "anchor_org_index_status",
    description: "Shows org memory freshness, coverage, cloned repos, edges, and consumers.",
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
  "Local org memory across allowlisted repos",
  "Managed shallow clones under ~/.anchor/orgs",
  "Cross-repo impact and anomaly detection",
  "API consumer detection across repos",
  "Org architecture maps",
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
  "Before API/access/shared package changes, ask Anchor for cross-repo impact.",
  "Find frontend, SDK, or service consumers before changing backend contracts.",
  "Run org CI to block high-risk cross-repo anomalies before merge.",
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
    path: "/docs/org-memory",
    title: "Org Memory",
    description: "Allowlist repos, build local org memory, and check cross-repo impact.",
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
    description: "All Anchor commands with command-specific options and examples.",
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
