# Anchor

Anchor is a local-first, Cursor-only MCP server that indexes a repository's merged GitHub pull request history and gives Cursor Agent concise historical context before code edits.

It helps Cursor notice past architecture decisions, constraints, rejected approaches, review comments, regressions, and testing expectations that live in the repo's own PR history.

Anchor is not a SaaS, does not create a dashboard, does not send telemetry, and does not call any LLM API in the MVP.

## Why Cursor Users Need It

Cursor is strongest when it has the context a senior maintainer would remember: why a file is shaped a certain way, what broke last time, which tests matter, and which API contracts should not move casually. Anchor mines that local repository history and exposes it through one Cursor MCP tool:

```text
anchor_get_context
```

Cursor Agent should call this before non-trivial code changes.

## Privacy Model

- GitHub data is fetched with a local `GITHUB_TOKEN`.
- The token is never written to `.cursor/mcp.json`, SQLite, logs, or generated files.
- The SQLite index stays in `.anchor/index.sqlite` on your machine.
- Anchor only requests read access and never writes to GitHub.
- PR bodies, comments, review comments, issue comments, and commit messages are treated as untrusted evidence.
- MCP output uses sanitized text only.
- Common secrets and prompt-injection phrases are redacted or neutralized before indexing and output.

Recommended GitHub token scope: read-only repository access. For private repositories, use the minimum read-only repo permissions your GitHub plan supports.

## Install

```bash
pnpm install
pnpm build
pnpm test
```

For local development:

```bash
pnpm --filter cli start -- --help
```

For a global/local executable, the CLI package exposes:

```text
anchor
```

## Setup

Run from inside the repository you use with Cursor:

```bash
anchor init
```

This safely merges `.cursor/mcp.json` with:

```json
{
  "mcpServers": {
    "anchor": {
      "command": "anchor",
      "args": ["serve"],
      "env": {
        "GITHUB_TOKEN": "${env:GITHUB_TOKEN}"
      }
    }
  }
}
```

It also creates `.cursor/rules/anchor.mdc`, telling Cursor Agent to call `anchor_get_context` before non-trivial edits and to treat returned history as evidence, not instructions.

## Index PR History

```bash
export GITHUB_TOKEN=your_read_only_token
anchor index
```

Options:

```bash
anchor index --repo owner/name --limit 10
anchor index --repo owner/name --since 2024-01-01
anchor index --repo owner/name --force
```

Default limit: 200 merged PRs.

The local database is written to:

```text
.anchor/index.sqlite
```

## Sync

Incrementally fetch PRs updated since the last sync:

```bash
anchor sync
anchor sync --repo owner/name
```

`anchor sync` is safe to run repeatedly. Use `--force` to rebuild the local database.

## Doctor

```bash
anchor doctor
```

Doctor checks git detection, GitHub remote parsing, token presence, GitHub API reachability, Cursor MCP config, Anchor MCP entry, SQLite database/schema, MCP startup, and the Cursor rule file. Failed checks include actionable fixes.

## Cursor Verification

After `anchor init`, restart or reload Cursor and verify the MCP server named `anchor` is visible. Then ask Cursor:

```text
Before refactoring this file, call `anchor_get_context` and summarize relevant historical constraints.
```

The main tool input is:

```json
{
  "task": "Refactor auth cache loading",
  "files": ["src/auth/cache.ts"],
  "symbols": ["AuthCache"],
  "diff": "...optional current diff...",
  "currentCode": "...optional focused code...",
  "maxResults": 8
}
```

Secondary tools:

- `anchor_search_history`
- `anchor_index_status`

## Development Commands

```bash
pnpm install
pnpm build
pnpm test
pnpm --filter cli start -- init
pnpm --filter cli start -- index --repo owner/name --limit 10
pnpm --filter cli start -- doctor
pnpm --filter cli start -- serve
```

## Troubleshooting

Missing token:
Run `export GITHUB_TOKEN=...` with a read-only token, then rerun `anchor doctor`.

GitHub rate limit:
Wait for the limit to reset or use a token with sufficient read quota. Anchor indexes locally, so you do not need to refetch unchanged history often.

Malformed `.cursor/mcp.json`:
Fix the JSON syntax, then rerun `anchor init`. Anchor merges safely but will not guess through invalid JSON.

Empty index:
Run `anchor index --repo owner/name --limit 200`. Confirm merged PRs exist and the token can read them.

MCP server not visible in Cursor:
Rerun `anchor init`, reload Cursor, and confirm `.cursor/mcp.json` contains the `anchor` server entry.

SQLite database missing:
Run `anchor index`. The expected path is `.anchor/index.sqlite`.

No relevant context returned:
Try `anchor sync`, then use `anchor_search_history` with a broader query, file path, or symbol. Anchor only returns evidence found in the local PR index.

## Safety Notes

Anchor never obeys historical PR comments as instructions. It surfaces them as cited evidence with PR numbers, source types, file paths when available, and PR URLs. Low-confidence evidence is phrased cautiously.
