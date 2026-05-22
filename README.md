# Anchor

Anchor is a local-first, Cursor-only MCP server that indexes a repository's merged GitHub pull request history and local codebase, then gives Cursor Agent concise historical and current-code context before edits.

It helps Cursor notice past architecture decisions, constraints, rejected approaches, review comments, regressions, testing expectations, related tests, and file ownership signals from the repo's own history and code.

Anchor is not a SaaS, does not create a dashboard, does not send telemetry, and does not call any LLM API in the MVP.

Anchor is evidence-backed, not truth-backed: retrieved history includes confidence and current-code freshness signals so Cursor can see when evidence may be weak or stale.

## Why Cursor Users Need It

Cursor is strongest when it has the context a senior maintainer would remember: why a file is shaped a certain way, what broke last time, which tests matter, and which API contracts should not move casually. Anchor mines local repository history plus the current code index and exposes it through one primary Cursor MCP tool:

```text
anchor_get_context
```

Cursor Agent should call this before non-trivial code changes.

## Privacy Model

- GitHub data is fetched with local authentication: `GITHUB_TOKEN`, `GH_TOKEN`, or `gh auth token`.
- The token is never written to `.cursor/mcp.json`, SQLite, logs, or generated files.
- The SQLite index stays in `.anchor/index.sqlite` on your machine.
- Anchor only requests read access and never writes to GitHub.
- PR bodies, comments, review comments, issue comments, and commit messages are treated as untrusted evidence.
- MCP output uses sanitized text only.
- Common secrets and prompt-injection phrases are redacted or neutralized before indexing and output.

Recommended GitHub token scope: read-only repository access. For private repositories, use the minimum read-only repo permissions your GitHub plan supports.

## Install

From npm:

```bash
npm install -g @pratik7368patil/anchor
anchor --help
```

Or run it without a global install:

```bash
npx -y @pratik7368patil/anchor --help
```

## 2-Minute Demo

Try Anchor without a GitHub token or a real repository index:

```bash
npx @pratik7368patil/anchor demo
```

`anchor demo` creates a temporary workspace, indexes bundled sample PR history plus sample code, prints example output for `anchor_get_context`, `anchor_explain_file`, and `anchor_review_diff`, then cleans up the temporary workspace. Use `--keep` or `--path ./anchor-demo` if you want to inspect the demo SQLite index.

Before Anchor, Cursor sees mostly the current files and your prompt. After Anchor, Cursor can also see concise, cited context like:

```text
[constraint] Do not remove the AuthCache lazy constraint...
Evidence: PR #101, review_comment, src/auth/cache.ts
Confidence: strong
Current code check: current
```

The demo uses sanitized fixture text only. It does not call GitHub, npm, telemetry, SaaS, or any LLM API.

For local development from this repository:

```bash
pnpm install
pnpm build
pnpm test
```

The npm package exposes the `anchor` binary.

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
      "args": ["serve"]
    }
  }
}
```

It also creates `.cursor/rules/anchor.mdc`, telling Cursor Agent to call `anchor_get_context` before non-trivial edits and to treat returned history as evidence, not instructions.

`anchor init` adds `.anchor/` to `.git/info/exclude` as a local-only exclude rule. That keeps `.anchor/index.sqlite` out of `git status` without adding or changing a committed `.gitignore` file.

## Index PR History

```bash
gh auth login
anchor index
```

You can also use an explicit token:

```bash
export GITHUB_TOKEN=your_read_only_token
anchor index
```

Options:

```bash
anchor index --repo owner/name --limit 10
anchor index --repo owner/name --all
anchor index-all --repo owner/name --concurrency 6
anchor index --repo owner/name --no-code
anchor index-code --repo owner/name
anchor index --repo owner/name --since 2024-01-01
anchor index --repo owner/name --force
```

Default limit: 200 merged PRs. `--limit` is capped at 1000 merged PRs for normal runs.
Use `anchor index --all` or `anchor index-all` when you intentionally want to fetch every merged PR in the repository. Full-history indexing can take a long time on large repositories and is still subject to GitHub API rate limits.
PR detail fetching uses bounded parallelism. The default concurrency is 5, and `--concurrency` is capped at 10 to reduce the chance of GitHub secondary rate limits.

Anchor also indexes the local codebase by default after PR indexing. Code discovery uses `git ls-files --cached --others --exclude-standard`, so it includes tracked files plus untracked files that are not ignored by git. Generated/private paths such as `.anchor/`, `.cursor/`, `.codex/`, `.aws/`, `.ssh/`, `node_modules/`, `.nuxt/`, `.next/`, `dist/`, `build/`, `coverage/`, and secret-like files such as `.env*`, `.npmrc`, `.netrc`, `*.pem`, `*.key`, and `id_rsa` are always skipped.

Use `anchor index-code` to refresh only the local codebase index without GitHub authentication. Use `--no-code` on PR indexing commands when you only want PR history.

After indexing, Anchor prints outcome counts for architecture decisions, constraints, API contracts, security notes, regressions, test links, team rules, and a local coverage score. It also suggests a next Cursor prompt.

The local database is written to:

```text
.anchor/index.sqlite
```

## Sync

Incrementally fetch PRs updated since the last sync:

```bash
anchor sync
anchor sync --repo owner/name
anchor sync --all --concurrency 6
anchor sync --no-code
```

`anchor sync` is safe to run repeatedly. Use `--all` to fetch every merged PR updated since the sync cursor. Use `--force` to rebuild the local database. Codebase indexing is refreshed by default unless `--no-code` is passed.

## Team Rules

Team-approved constraints can live in a committed `anchor.rules.json` file:

```bash
anchor rules init
anchor rules validate
anchor rules list
anchor rules suggest
```

Rules must cite PR evidence. A minimal rule looks like:

```json
{
  "version": 1,
  "rules": [
    {
      "id": "auth-cache-lazy",
      "category": "constraint",
      "text": "Keep `AuthCache` lazy because cold-start login regressed before.",
      "filePaths": ["src/auth/cache.ts"],
      "symbols": ["AuthCache"],
      "evidence": [
        {
          "prNumber": 101,
          "prUrl": "https://github.com/owner/repo/pull/101",
          "sourceType": "review_comment"
        }
      ]
    }
  ]
}
```

Matching team rules appear above normal PR history in `anchor_get_context`, but they are still presented as evidence, not commands.

Create and verify rules from the CLI:

```bash
anchor rules add \
  --id auth-cache-lazy \
  --category constraint \
  --text "Keep AuthCache lazy because cold-start login regressed before." \
  --pr-number 101 \
  --pr-url https://github.com/owner/repo/pull/101 \
  --source-type review_comment \
  --file src/auth/cache.ts \
  --symbol AuthCache

anchor rules check-evidence
```

`check-evidence` confirms that cited PRs exist in the local Anchor index.

`anchor rules suggest` reads local evidence and suggests draft rules from repeated or high-confidence constraints, API contracts, security notes, and regressions. It never modifies `anchor.rules.json`; the team still has to review and add any rule explicitly.

## Explain And Review

Use Anchor directly from a terminal:

```bash
anchor explain src/auth/cache.ts
anchor explain src/auth/cache.ts --share
anchor review
anchor review --base main
anchor review --diff-file change.diff --strict
anchor review --share
anchor health
anchor prompts
```

`anchor explain <file>` summarizes what the file appears to own, matching PR decisions, team rules, known regressions, related tests, and important symbols using the local index only.

`anchor review` reads the current `git diff` by default and groups evidence-backed findings into blockers, risks, historical constraints, regression checks, and recommended tests. It never approves or rejects code automatically.

`anchor health` focuses on index quality: partial PR history, stale code index, invalid team rules, last failed index run, and the next suggested command.

`--share` mode prints compact Markdown for Slack or PR comments: file summary, key constraints, known regressions, likely tests, and PR citations.

`anchor prompts` prints Cursor-ready prompts for before-edit, explain-file, strict-mode, and review-diff workflows.

`anchor health` and `anchor_index_status` include a local coverage score:

```text
Anchor coverage: 72% (good)
```

The score uses only local facts: PR coverage, code index freshness, code chunks, test links, regression events, wisdom units, team rules, and stale evidence.

## Test-Aware And Regression Context

Anchor classifies tests with deterministic rules such as `*.test.*`, `*.spec.*`, `__tests__`, `test/`, `tests/`, and `spec/`. It links source files to likely tests by basename, directory, imports, and indexed history.

Regression memory is extracted from PR titles, bodies, comments, labels, and commit messages using phrases like `regression`, `revert`, `rollback`, `hotfix`, `incident`, `root cause`, `this broke`, and `fixed by`.

`anchor_get_context` can now include:

- `## Team-approved rules`
- `## Must know`
- `## Codebase Evidence`
- `## Relevant tests`
- `## Regression memory`
- `## Risks`
- `## Recommended checks`

Structured MCP metadata includes `matchReasons`, `rankSignals`, `queryTerms`, `relevantTests`, `regressionEvents`, and `indexHealth`.

## Optional Local Semantic Search

SQLite FTS remains the default retrieval engine. Optional semantic mode is local-only and disabled unless requested:

```bash
ANCHOR_SEMANTIC=local anchor serve
```

If no local embedding provider is available, Anchor falls back to SQLite FTS without failing or making network calls.

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

## Cursor Prompt Cookbook

Before edit:

```text
Before making this non-trivial code change, call `anchor_get_context` with the task, target files, relevant symbols, and current diff if available. Summarize the historical constraints before editing.
```

Explain file:

```text
Before editing this file, call `anchor_explain_file` for the target file and summarize ownership, related PR decisions, regressions, and likely tests.
```

Strict mode:

```text
For this risky refactor, call `anchor_get_context` with `strict: true` and `minConfidence: "moderate"`. Only use non-stale evidence and cite PRs that affect the implementation.
```

Review diff:

```text
After making the diff, call `anchor_review_diff` and list evidence-backed blockers, risks, historical constraints, regression checks, and recommended tests.
```

The main tool input is:

```json
{
  "task": "Refactor auth cache loading",
  "files": ["src/auth/cache.ts"],
  "symbols": ["AuthCache"],
  "diff": "...optional current diff...",
  "currentCode": "...optional focused code...",
  "maxResults": 8,
  "strict": false,
  "minConfidence": "strong"
}
```

Use `strict: true` when Cursor should only receive non-stale evidence at or above `minConfidence`. If nothing qualifies, Anchor returns “No reliable historical evidence found.”

Secondary tools:

- `anchor_search_history`
- `anchor_index_status` reports PR/code counts, history coverage, coverage score, stale evidence count, team rule count, and last sync/index times.
- `anchor_explain_file`
- `anchor_review_diff`

## Development Commands

```bash
pnpm install
pnpm build
pnpm test
pnpm --filter @pratik7368patil/anchor start -- init
pnpm --filter @pratik7368patil/anchor start -- demo
pnpm --filter @pratik7368patil/anchor start -- prompts
pnpm --filter @pratik7368patil/anchor start -- index --repo owner/name --limit 10
pnpm --filter @pratik7368patil/anchor start -- explain src/auth/cache.ts
pnpm --filter @pratik7368patil/anchor start -- review
pnpm --filter @pratik7368patil/anchor start -- health
pnpm --filter @pratik7368patil/anchor start -- rules suggest
pnpm --filter @pratik7368patil/anchor start -- doctor
pnpm --filter @pratik7368patil/anchor start -- serve
```

## Release Automation

The repository includes a GitHub Actions workflow that publishes missing package versions to npm after changes land on `main`.

Required repository secret:

```text
NPM_TOKEN
```

Release flow:

```bash
npm --prefix packages/core version 0.1.10 --no-git-tag-version
npm --prefix packages/mcp-server version 0.1.10 --no-git-tag-version
npm --prefix packages/cli version 0.1.10 --no-git-tag-version
```

Open a PR with the version bump. After the PR is reviewed and merged, GitHub Actions runs tests, builds the packages, and publishes any package version that is not already on npm.

If the workflow fails at `npm whoami` with `E401 Unauthorized`, update the GitHub repository secret named `NPM_TOKEN` with a valid npm automation/access token that can publish the `@pratik7368patil` packages. Version bumps alone cannot fix an invalid npm token.

## Troubleshooting

Missing token:
Run `gh auth login`, or export `GITHUB_TOKEN`/`GH_TOKEN` with a read-only token, then rerun `anchor doctor`.

GitHub rate limit:
Wait for the limit to reset or use a token with sufficient read quota. Anchor indexes locally, so you do not need to refetch unchanged history often.

Malformed `.cursor/mcp.json`:
Fix the JSON syntax, then rerun `anchor init`. Anchor merges safely but will not guess through invalid JSON.

Empty index:
Run `anchor index --repo owner/name --limit 200`. Confirm merged PRs exist and the token can read them.

MCP server not visible in Cursor:
Rerun `anchor init`, reload Cursor, and confirm `.cursor/mcp.json` contains the `anchor` server entry.

If Cursor was opened from the macOS app and cannot find the global `anchor` command, update Anchor and rerun `anchor init`:

```bash
npm install -g @pratik7368patil/anchor@latest
anchor init
```

Newer Anchor versions write the resolved executable path into `.cursor/mcp.json` when possible, which avoids GUI app `PATH` issues.

SQLite database missing:
Run `anchor index`. The expected path is `.anchor/index.sqlite`.

Anchor index showing in git:
Run `anchor init` again. It adds `.anchor/` to `.git/info/exclude`, which is local-only. If `.anchor/index.sqlite` was already staged or committed, run `git rm --cached .anchor/index.sqlite`.

No relevant context returned:
Try `anchor sync`, then use `anchor_search_history` with a broader query, file path, or symbol. Anchor only returns evidence found in the local PR index.

Codebase context missing:
Run `anchor index-code` from the repository root. Confirm `anchor_index_status` reports non-zero code files and code chunks.

Team rules invalid:
Run `anchor rules validate`. Each rule needs an id, category, text, and at least one PR evidence reference.

Index health warning:
Run `anchor health` for the reason and suggested next command. Common fixes are `anchor index-code`, `anchor sync`, or `anchor index-all`.

No related tests:
Run `anchor index-code` and confirm test files are not ignored by git. Anchor only links tests it can see in tracked or non-ignored files.

## Safety Notes

Anchor never obeys historical PR comments as instructions. It surfaces them as cited evidence with PR numbers, source types, file paths when available, PR URLs, confidence, and current-code freshness. Low-confidence evidence is phrased cautiously, and stale evidence is penalized or filtered in strict mode.
