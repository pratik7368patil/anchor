# Anchor

Anchor is a local-first, Cursor-only MCP server that indexes merged GitHub pull request history and gives Cursor Agent concise historical context before code edits.

Install:

```bash
npm install -g @pratik7368patil/anchor
```

Use it inside a GitHub-backed repo:

```bash
export GITHUB_TOKEN=your_read_only_token
anchor init
anchor index
anchor doctor
```

Then reload Cursor and use the MCP tool `anchor_get_context`.

Full documentation: https://github.com/pratik7368patil/anchor#readme
