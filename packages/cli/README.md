# Anchor

Anchor is a local-first, Cursor-only MCP server that indexes merged GitHub pull request history plus the local codebase, then gives Cursor Agent concise context before code edits.

Install:

```bash
npm install -g @pratik7368patil/anchor
```

Try the offline demo before setting up GitHub auth:

```bash
npx @pratik7368patil/anchor demo
```

Anchor has no CLI telemetry. If it helps, public proof comes from voluntary signals like GitHub stars, forks, issues, and aggregate npm/GitHub traffic.

Use it inside a GitHub-backed repo:

```bash
gh auth login
anchor init
anchor demo
anchor prompts
anchor index
anchor index-all --concurrency 6
anchor index-code
anchor explain src/auth/cache.ts
anchor explain src/auth/cache.ts --share
anchor architecture
anchor architecture --file src/auth/cache.ts
anchor architecture --area api
anchor architecture --check
anchor review
anchor review --share
anchor health
anchor org init --org my-org
anchor org add-repo my-org/backend-api --org my-org --group backend
anchor org sync --org my-org
anchor org graph --org my-org
anchor org graph --org my-org --open
anchor org map --org my-org --open
anchor org impact --org my-org --repo my-org/backend-api --strict --open
anchor org ci --org my-org --strict --min-coverage 70 --html
anchor rules init
anchor rules validate
anchor rules suggest
anchor rules add --id api-contract --category api_contract --text "Keep API stable." --pr-number 123 --pr-url https://github.com/owner/repo/pull/123
anchor rules check-evidence
anchor doctor
```

## Which command should I run?

First-time setup:

```bash
anchor init
anchor index --limit 200
anchor doctor
```

Current-code context only, no GitHub auth:

```bash
anchor index-code
anchor architecture
anchor health
```

Full PR history:

```bash
anchor index-all --concurrency 2
```

Daily refresh:

```bash
anchor sync
```

Before Cursor edits:

```bash
anchor plan "Add API integration" --file src/api/routes.ts
anchor test-command src/api/routes.ts
anchor explain src/api/routes.ts
```

Before API, auth, access, schema, SDK, shared-package, or cross-repo work:

```bash
anchor org sync --org my-org --no-graph --concurrency 2
anchor org graph --org my-org
anchor org impact --org my-org --repo my-org/backend-api --strict --open
```

## Command-specific options

`anchor index`:
Use `--repo owner/name` when git remote detection is unavailable, `--limit 50` for a fast first pass, `--all` for full history through the normal command, `--since YYYY-MM-DD` for targeted backfill, `--force` to rebuild local derived records, `--no-code` to skip code indexing, and `--concurrency 1-10` to tune patch enrichment pressure.

`anchor index-all`:
Use for complete merged PR history. Prefer `--concurrency 1` or `--concurrency 2` on large repos. Use `--no-code` when code context is already fresh.

`anchor sync`:
Use after the first index. It is incremental and safe to rerun. Add `--all` for a full catch-up from the sync cursor, `--since YYYY-MM-DD` for a specific window, `--no-code` for PR-only refresh, and `--concurrency 1-10` when tuning rate-limit pressure.

`anchor index-code`:
Use when you only need current-code context or do not have GitHub auth. Add `--force` when `anchor health` reports stale code records.

Anchor automatically chooses progress output: modern live progress in interactive terminals, plain line logs in CI/non-TTY shells, and no progress for JSON output. Org commands show the active repo, phase, counts, elapsed time, and last update age across GitHub fetches, PR SQLite indexing, code indexing, architecture indexing, and graph creation.

`anchor plan`:
Use `--file path` for a likely target file, `--symbol name` for a likely contract or implementation point, `--strict` for high-risk work, and `--json` for automation.

`anchor explain` and `anchor review`:
Use `--share` for Slack or PR-comment Markdown. Use `--diff-file change.diff` on review when checking a saved diff. Use `--strict` for risky diffs and `--json` for tooling.

`anchor architecture`:
Use `--file path` for file-level guidance, `--area api` for one architecture area, `--check` for the current diff, `--diff-file change.diff` for saved diffs, `--map --format mermaid` for docs, `--map --format json` for tooling, and `--write-doc` only when you intentionally want `ANCHOR_ARCHITECTURE.md`.

`anchor org ...`:
Use `--org my-org` on every org command. Use `--group` and `--alias` with `org add-repo`, `--repo` to retry one repo, `--code-only` or `--prs-only` with `org index`, `--no-graph` with `org index`/`org sync` to postpone cross-repo graph rebuilds, `org graph` to rebuild only edges/API consumers, `org graph --open` to inspect the graph in a local browser UI, `--concurrency 1-3` with `org clone` and `org sync`, `--diff-file` and `--strict` with `org impact`, `--min-coverage` with `org ci`, and `--html`/`--open`/`--output` with `org map`, `org impact`, and `org ci` to generate local human-readable HTML reports.

Then reload Cursor and use the MCP tools `anchor_get_context`, `anchor_explain_file`, `anchor_review_diff`, `anchor_get_architecture`, `anchor_check_architecture`, and `anchor_check_cross_repo_impact`.

Existing PR indexing commands use GitHub GraphQL first for batched PR metadata, comments, reviews, commits, labels, and changed files. Anchor uses REST only to enrich PR file patches, caps GraphQL page size below GitHub's nested node ceiling, adapts GraphQL page size from live rate-limit cost, and saves a local resume checkpoint for full-history runs, so `anchor index`, `anchor index-all`, and `anchor sync` are more efficient without adding another command. Transient GraphQL network/HTML gateway failures retry before Anchor falls back or fails clearly; GraphQL rate/resource limits reduce page size or defer instead of using the older REST PR-detail crawler.

Use `anchor_get_context` with `strict: true` when Cursor should only receive non-stale, high-confidence evidence.

Anchor indexes PR history, local code chunks, likely related tests, regression memory, architecture patterns, and team-approved rules. `anchor health` and `anchor_index_status` include a local coverage score. All data stays in `.anchor/index.sqlite` on your machine.

Org Memory is opt-in. `anchor org ...` commands store allowlisted repo clones and one org SQLite database under `~/.anchor/orgs/<org>/`, then expose cross-repo context through `anchor_get_org_context`, `anchor_check_cross_repo_impact`, `anchor_find_api_consumers`, `anchor_get_org_architecture`, and `anchor_org_index_status`.

Cross-repo edges and API consumers are created during the org graph phase. If a large `anchor org sync` is taking too long after repo indexing completes, run `anchor org status --org my-org` in another terminal to see the heartbeat, then split future runs with `anchor org sync --org my-org --no-graph` and `anchor org graph --org my-org --open`. If a recent sync is interrupted after PR/code indexing but before graph completion, rerunning `anchor org sync` resumes graph work and skips redundant PR fetches for repos that already completed PR sync.

Architecture Memory is refreshed by `anchor index`, `anchor index-all`, `anchor sync`, and `anchor index-code`. It gives Cursor deterministic current-code guidance about file areas, import direction, symbols, repeated folder patterns, and nearby test conventions before adding APIs, services, components, hooks, tests, or refactors.

`anchor demo` runs offline with bundled fixtures and sample code. `--share` on `explain` and `review` produces compact Markdown for Slack or PR comments.

Docs, adoption signals, and feedback links: https://anchor-mcp.netlify.app

`anchor init` also adds `.anchor/` to `.git/info/exclude`, keeping the local SQLite index out of git without changing `.gitignore`.

Full documentation: https://github.com/pratik7368patil/anchor#readme
