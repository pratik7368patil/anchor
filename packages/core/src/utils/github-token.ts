import { execFileSync } from "node:child_process";

export type GitHubTokenSource = "GITHUB_TOKEN" | "GH_TOKEN" | "gh";

export type GitHubTokenResolution = {
  token?: string;
  source?: GitHubTokenSource;
};

export type GitHubTokenResolverOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  allowGitHubCli?: boolean;
};

export function resolveGitHubToken(options: GitHubTokenResolverOptions = {}): GitHubTokenResolution {
  const env = options.env ?? process.env;
  const githubToken = env.GITHUB_TOKEN?.trim();
  if (githubToken) return { token: githubToken, source: "GITHUB_TOKEN" };

  const ghToken = env.GH_TOKEN?.trim();
  if (ghToken) return { token: ghToken, source: "GH_TOKEN" };

  if (options.allowGitHubCli === false) return {};

  try {
    const token = execFileSync("gh", ["auth", "token"], {
      cwd: options.cwd,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    }).trim();
    return token ? { token, source: "gh" } : {};
  } catch {
    return {};
  }
}

export function githubAuthFixMessage(): string {
  return "Run gh auth login, or export GITHUB_TOKEN/GH_TOKEN with a read-only GitHub token.";
}
