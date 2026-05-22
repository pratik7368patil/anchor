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

Then reload Cursor and use the MCP tools `anchor_get_context`, `anchor_explain_file`, and `anchor_review_diff`.

Use `anchor_get_context` with `strict: true` when Cursor should only receive non-stale, high-confidence evidence.

Anchor indexes PR history, local code chunks, likely related tests, regression memory, and team-approved rules. `anchor health` and `anchor_index_status` include a local coverage score. All data stays in `.anchor/index.sqlite` on your machine.

`anchor demo` runs offline with bundled fixtures and sample code. `--share` on `explain` and `review` produces compact Markdown for Slack or PR comments.

`anchor init` also adds `.anchor/` to `.git/info/exclude`, keeping the local SQLite index out of git without changing `.gitignore`.

Full documentation: https://github.com/pratik7368patil/anchor#readme
