import { Octokit } from "@octokit/rest";

export function createGitHubClient(token: string): Octokit {
  if (!token.trim()) {
    throw new Error("GITHUB_TOKEN is required. Use a read-only token for repository contents and pull requests.");
  }
  return new Octokit({
    auth: token,
    userAgent: "anchor-local-mcp",
  });
}
