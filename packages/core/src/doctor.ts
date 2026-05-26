import fs from "node:fs";
import path from "node:path";
import type { Octokit } from "@octokit/rest";
import { checkSchema, defaultDatabasePath, openAnchorDatabase } from "./db/database.js";
import type { DoctorCheck, DoctorReport } from "./types.js";
import { createGitHubClient } from "./github/client.js";
import { createGitHubGraphQLRequester } from "./github/graphql-client.js";
import { githubAuthFixMessage, resolveGitHubToken } from "./utils/github-token.js";
import { detectGitHubRepo, detectGitRoot } from "./utils/git.js";

export type DoctorOptions = {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  githubClientFactory?: (token: string) => Pick<Octokit, "repos">;
  githubGraphQLCheck?: (token: string) => Promise<boolean> | boolean;
  mcpServerCheck?: () => Promise<boolean> | boolean;
};

function check(name: string, ok: boolean, message: string, fix?: string): DoctorCheck {
  return { name, ok, message, fix: ok ? undefined : fix };
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const env = options.env ?? process.env;
  const cwd = options.cwd;
  const checks: DoctorCheck[] = [];
  const gitRoot = detectGitRoot(cwd);
  const repo = gitRoot ? detectGitHubRepo(gitRoot) : undefined;

  checks.push(
    check(
      "git repo detected",
      Boolean(gitRoot),
      gitRoot ? `Git root: ${gitRoot}` : "No git repository detected.",
      "Run Anchor from inside a git repository.",
    ),
  );

  checks.push(
    check(
      "GitHub remote detected",
      Boolean(repo),
      repo ? `GitHub repo: ${repo.fullName}` : "No GitHub origin remote detected.",
      "Set origin to a GitHub repo, for example: git remote add origin git@github.com:owner/name.git",
    ),
  );

  const auth = resolveGitHubToken({ cwd: gitRoot ?? cwd, env });
  const token = auth.token;
  checks.push(
    check(
      "GitHub auth token available",
      Boolean(token),
      token ? `GitHub token resolved from ${auth.source}.` : "No GitHub token source found.",
      githubAuthFixMessage(),
    ),
  );

  if (token && repo) {
    try {
      const client = options.githubClientFactory?.(token) ?? createGitHubClient(token);
      await client.repos.get({ owner: repo.owner, repo: repo.name });
      checks.push(check("GitHub API reachable", true, "GitHub API is reachable for this repo."));
    } catch (error) {
      checks.push(
        check(
          "GitHub API reachable",
          false,
          `GitHub API check failed: ${error instanceof Error ? error.message : String(error)}`,
          "Check token scope, network access, and rate limits. Use read-only repo access.",
        ),
      );
    }
  } else {
    checks.push(
      check(
        "GitHub API reachable",
        false,
        "Skipped because repo or token is missing.",
        `Fix the GitHub remote and authentication. ${githubAuthFixMessage()}`,
      ),
    );
  }

  if (token) {
    try {
      const graphqlOk =
        options.githubGraphQLCheck !== undefined
          ? Boolean(await options.githubGraphQLCheck(token))
          : options.githubClientFactory !== undefined
            ? true
            : Boolean(
                await createGitHubGraphQLRequester({ token })(
                  `query AnchorDoctorGraphQL {
                    viewer { login }
                    rateLimit { cost remaining resetAt }
                  }`,
                  {},
                  {
                    controller: {},
                    requestName: "GraphQL doctor reachability check",
                  },
                ),
              );
      checks.push(
        check(
          "GitHub GraphQL reachable",
          graphqlOk,
          graphqlOk
            ? "GitHub GraphQL API is reachable."
            : "GitHub GraphQL API check returned an unsuccessful result.",
          "Check token scope, network access, and GraphQL rate limits. Use read-only repo access.",
        ),
      );
    } catch (error) {
      checks.push(
        check(
          "GitHub GraphQL reachable",
          false,
          `GitHub GraphQL check failed: ${error instanceof Error ? error.message : String(error)}`,
          "Check token scope, network access, and GraphQL rate limits. Use read-only repo access.",
        ),
      );
    }
  } else {
    checks.push(
      check(
        "GitHub GraphQL reachable",
        false,
        "Skipped because token is missing.",
        githubAuthFixMessage(),
      ),
    );
  }

  const cursorConfigPath = path.join(gitRoot ?? cwd, ".cursor", "mcp.json");
  let cursorConfig: unknown;
  let cursorConfigValid = false;
  if (fs.existsSync(cursorConfigPath)) {
    try {
      cursorConfig = JSON.parse(fs.readFileSync(cursorConfigPath, "utf8")) as unknown;
      cursorConfigValid = true;
    } catch {
      cursorConfigValid = false;
    }
  }
  checks.push(
    check(
      ".cursor/mcp.json valid",
      fs.existsSync(cursorConfigPath) && cursorConfigValid,
      cursorConfigValid ? ".cursor/mcp.json exists and is valid JSON." : ".cursor/mcp.json is missing or invalid.",
      "Run anchor init. If the file is malformed, fix the JSON and rerun anchor init.",
    ),
  );

  const hasAnchorEntry =
    cursorConfigValid &&
    Boolean(
      cursorConfig &&
        typeof cursorConfig === "object" &&
        "mcpServers" in cursorConfig &&
        (cursorConfig as { mcpServers?: Record<string, unknown> }).mcpServers?.anchor,
    );
  checks.push(
    check(
      "Anchor MCP entry exists",
      hasAnchorEntry,
      hasAnchorEntry ? "Anchor MCP entry is configured." : "Anchor MCP entry is missing.",
      "Run anchor init to merge the Anchor MCP server into .cursor/mcp.json.",
    ),
  );

  const dbPath = defaultDatabasePath(gitRoot ?? cwd);
  const dbExists = fs.existsSync(dbPath);
  checks.push(
    check(
      ".anchor/index.sqlite exists",
      dbExists,
      dbExists ? `Database exists at ${dbPath}.` : "SQLite database is missing.",
      "Run anchor index --repo owner/name --limit 200.",
    ),
  );

  let schemaValid = false;
  if (dbExists) {
    try {
      const db = openAnchorDatabase(gitRoot ?? cwd, dbPath);
      try {
        schemaValid = checkSchema(db);
      } finally {
        db.close();
      }
    } catch {
      schemaValid = false;
    }
  }
  checks.push(
    check(
      "SQLite schema valid",
      schemaValid,
      schemaValid ? "SQLite schema is valid." : "SQLite schema is missing or invalid.",
      "Run anchor index --force to rebuild the local index.",
    ),
  );

  let mcpOk = false;
  try {
    mcpOk = options.mcpServerCheck ? Boolean(await options.mcpServerCheck()) : true;
  } catch {
    mcpOk = false;
  }
  checks.push(
    check(
      "MCP server can start",
      mcpOk,
      mcpOk ? "MCP server startup check passed." : "MCP server startup check failed.",
      "Run pnpm build, then try anchor serve from the repository.",
    ),
  );

  const rulePath = path.join(gitRoot ?? cwd, ".cursor", "rules", "anchor.mdc");
  checks.push(
    check(
      "Cursor rule file exists",
      fs.existsSync(rulePath),
      fs.existsSync(rulePath) ? "Cursor rule file exists." : "Cursor rule file is missing.",
      "Run anchor init to create .cursor/rules/anchor.mdc.",
    ),
  );

  return { ok: checks.every((item) => item.ok), checks };
}
