import { Octokit } from "@octokit/rest";

export function createGitHubClient(token: string): Octokit {
  if (!token.trim()) {
    throw new Error("GitHub authentication is required. Run gh auth login, or export GITHUB_TOKEN/GH_TOKEN.");
  }
  return new Octokit({
    auth: token,
    userAgent: "anchor-local-mcp",
  });
}
