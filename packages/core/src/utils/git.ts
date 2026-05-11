import { execFileSync } from "node:child_process";

export type GitHubRepo = {
  owner: string;
  name: string;
  fullName: string;
};

export function parseGitHubRemote(remoteUrl: string): GitHubRepo | undefined {
  const trimmed = remoteUrl.trim();
  const patterns = [
    /^git@github\.com:(?<owner>[^/\s]+)\/(?<name>[^/\s]+?)(?:\.git)?$/i,
    /^ssh:\/\/git@github\.com\/(?<owner>[^/\s]+)\/(?<name>[^/\s]+?)(?:\.git)?$/i,
    /^https:\/\/github\.com\/(?<owner>[^/\s]+)\/(?<name>[^/\s]+?)(?:\.git)?(?:\/)?$/i,
    /^git:\/\/github\.com\/(?<owner>[^/\s]+)\/(?<name>[^/\s]+?)(?:\.git)?$/i,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    const owner = match?.groups?.owner;
    const name = match?.groups?.name;
    if (owner && name) {
      return { owner, name, fullName: `${owner}/${name}` };
    }
  }

  return undefined;
}

export function detectGitRoot(cwd: string): string | undefined {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

export function detectGitHubRepo(cwd: string): GitHubRepo | undefined {
  try {
    const remote = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return parseGitHubRemote(remote);
  } catch {
    return undefined;
  }
}
