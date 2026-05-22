import type { Octokit } from "@octokit/rest";
import type { PullRequestRecord } from "../types.js";
import type { GitHubRateLimitController } from "./rate-limit.js";
import { paginateWithGitHubRateLimit, requestWithGitHubRateLimit } from "./rate-limit.js";

export async function fetchPullRequestDetails(
  octokit: Octokit,
  repoFullName: string,
  pullNumber: number,
  controller: GitHubRateLimitController = {},
): Promise<PullRequestRecord> {
  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo) throw new Error(`Invalid repo '${repoFullName}'. Expected owner/name.`);

  const { data: pull } = await requestWithGitHubRateLimit(
    () => octokit.pulls.get({ owner, repo, pull_number: pullNumber }),
    {
      controller,
      requestName: `GET /repos/${repoFullName}/pulls/${pullNumber}`,
    },
  );
  const files = await paginateWithGitHubRateLimit(
    (page) =>
      octokit.pulls.listFiles({
        owner,
        repo,
        pull_number: pullNumber,
        per_page: 100,
        page,
      }),
    {
      controller,
      requestName: `GET /repos/${repoFullName}/pulls/${pullNumber}/files`,
    },
  );
  const reviews = await paginateWithGitHubRateLimit(
    (page) =>
      octokit.pulls.listReviews({
        owner,
        repo,
        pull_number: pullNumber,
        per_page: 100,
        page,
      }),
    {
      controller,
      requestName: `GET /repos/${repoFullName}/pulls/${pullNumber}/reviews`,
    },
  );
  const reviewComments = await paginateWithGitHubRateLimit(
    (page) =>
      octokit.pulls.listReviewComments({
        owner,
        repo,
        pull_number: pullNumber,
        per_page: 100,
        page,
      }),
    {
      controller,
      requestName: `GET /repos/${repoFullName}/pulls/${pullNumber}/comments`,
    },
  );
  const issueComments = await paginateWithGitHubRateLimit(
    (page) =>
      octokit.issues.listComments({
        owner,
        repo,
        issue_number: pullNumber,
        per_page: 100,
        page,
      }),
    {
      controller,
      requestName: `GET /repos/${repoFullName}/issues/${pullNumber}/comments`,
    },
  );
  const commits = await paginateWithGitHubRateLimit(
    (page) =>
      octokit.pulls.listCommits({
        owner,
        repo,
        pull_number: pullNumber,
        per_page: 100,
        page,
      }),
    {
      controller,
      requestName: `GET /repos/${repoFullName}/pulls/${pullNumber}/commits`,
    },
  );

  return {
    repo: repoFullName,
    number: pull.number,
    html_url: pull.html_url,
    title: pull.title,
    body: pull.body ?? "",
    user: pull.user ? { login: pull.user.login } : null,
    labels: pull.labels.map((label) =>
      typeof label === "string" ? label : { name: "name" in label ? label.name : "" },
    ),
    created_at: pull.created_at,
    merged_at: pull.merged_at,
    updated_at: pull.updated_at,
    files: files.map((file) => ({
      filename: file.filename,
      patch: "patch" in file ? file.patch : undefined,
      additions: file.additions,
      deletions: file.deletions,
    })),
    reviews: reviews.map((review) => ({
      user: review.user ? { login: review.user.login } : null,
      body: review.body ?? "",
      created_at: review.submitted_at ?? undefined,
      submitted_at: review.submitted_at ?? undefined,
    })),
    reviewComments: reviewComments.map((comment) => ({
      user: comment.user ? { login: comment.user.login } : null,
      body: comment.body ?? "",
      path: comment.path,
      created_at: comment.created_at,
    })),
    issueComments: issueComments.map((comment) => ({
      user: comment.user ? { login: comment.user.login } : null,
      body: comment.body ?? "",
      created_at: comment.created_at,
    })),
    commits: commits.map((commit) => ({
      commit: {
        message: commit.commit.message,
      },
    })),
  };
}
