# Anchor

Anchor is a local-first, Cursor-only MCP server that indexes merged GitHub pull request history plus the local codebase, then gives Cursor Agent concise context before code edits.

Install:

```bash
npm install -g @pratik7368patil/anchor
```

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
anchor rules init
anchor rules validate
anchor rules suggest
anchor rules add --id api-contract --category api_contract --text "Keep API stable." --pr-number 123 --pr-url https://github.com/owner/repo/pull/123
anchor rules check-evidence
anchor doctor
```

Then reload Cursor and use the MCP tools `anchor_get_context`, `anchor_explain_file`, `anchor_review_diff`, `anchor_get_architecture`, and `anchor_check_architecture`.

Existing PR indexing commands use GitHub GraphQL first for batched PR metadata, comments, reviews, commits, labels, and changed files. Anchor uses REST only to enrich PR file patches, adapts GraphQL page size from live rate-limit cost, and saves a local resume checkpoint for full-history runs, so `anchor index`, `anchor index-all`, and `anchor sync` are more efficient without adding another command. If GraphQL itself is rate-limited, Anchor defers or fails clearly instead of falling back to the older REST PR-detail crawler.

Use `anchor_get_context` with `strict: true` when Cursor should only receive non-stale, high-confidence evidence.

Anchor indexes PR history, local code chunks, likely related tests, regression memory, architecture patterns, and team-approved rules. `anchor health` and `anchor_index_status` include a local coverage score. All data stays in `.anchor/index.sqlite` on your machine.

Architecture Memory is refreshed by `anchor index`, `anchor index-all`, `anchor sync`, and `anchor index-code`. It gives Cursor deterministic current-code guidance about file areas, import direction, symbols, repeated folder patterns, and nearby test conventions before adding APIs, services, components, hooks, tests, or refactors.

`anchor demo` runs offline with bundled fixtures and sample code. `--share` on `explain` and `review` produces compact Markdown for Slack or PR comments.

`anchor init` also adds `.anchor/` to `.git/info/exclude`, keeping the local SQLite index out of git without changing `.gitignore`.

Full documentation: https://github.com/pratik7368patil/anchor#readme
