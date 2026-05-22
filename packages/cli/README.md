# Anchor

Anchor is a local-first, Cursor-only MCP server that indexes merged GitHub pull request history and gives Cursor Agent concise historical context before code edits.

Install:

```bash
npm install -g @pratik7368patil/anchor
```

Use it inside a GitHub-backed repo:

```bash
gh auth login
anchor init
anchor index
anchor index-all --concurrency 6
anchor index-code
anchor explain src/auth/cache.ts
anchor review
anchor health
anchor rules init
anchor rules validate
anchor rules add --id api-contract --category api_contract --text "Keep API stable." --pr-number 123 --pr-url https://github.com/owner/repo/pull/123
anchor rules check-evidence
anchor doctor
```

Then reload Cursor and use the MCP tools `anchor_get_context`, `anchor_explain_file`, and `anchor_review_diff`.

Use `anchor_get_context` with `strict: true` when Cursor should only receive non-stale, high-confidence evidence.

Anchor indexes PR history, local code chunks, likely related tests, regression memory, and team-approved rules. All data stays in `.anchor/index.sqlite` on your machine.

`anchor init` also adds `.anchor/` to `.git/info/exclude`, keeping the local SQLite index out of git without changing `.gitignore`.

Full documentation: https://github.com/pratik7368patil/anchor#readme
