export type SourceType =
  | "pr_body"
  | "review_comment"
  | "issue_comment"
  | "review_summary"
  | "commit_message"
  | "diff_context";

export type WisdomCategory =
  | "architecture_decision"
  | "constraint"
  | "rejected_approach"
  | "bug_regression"
  | "testing_rule"
  | "api_contract"
  | "performance_note"
  | "security_note"
  | "style_convention"
  | "unknown";

export type WisdomUnit = {
  id: string;
  repo: string;
  prNumber: number;
  prUrl: string;
  sourceType: SourceType;
  category: WisdomCategory;
  text: string;
  sanitizedText: string;
  filePaths: string[];
  symbols: string[];
  authors: string[];
  createdAt: string;
  mergedAt?: string;
  confidence: number;
};

export type PullRequestFile = {
  filename: string;
  patch?: string | null;
  additions?: number;
  deletions?: number;
};

export type PullRequestPerson = {
  login: string;
};

export type PullRequestComment = {
  user?: PullRequestPerson | null;
  body?: string | null;
  path?: string | null;
  created_at?: string | null;
  submitted_at?: string | null;
};

export type PullRequestCommit = {
  commit?: {
    message?: string | null;
  };
};

export type PullRequestRecord = {
  repo: string;
  number: number;
  html_url: string;
  title: string;
  body?: string | null;
  user?: PullRequestPerson | null;
  labels?: Array<{ name?: string | null }> | string[];
  created_at: string;
  merged_at?: string | null;
  updated_at?: string | null;
  files: PullRequestFile[];
  reviews?: PullRequestComment[];
  reviewComments?: PullRequestComment[];
  issueComments?: PullRequestComment[];
  commits?: PullRequestCommit[];
};

export type IndexSummary = {
  indexedPrs: number;
  indexedFiles: number;
  indexedComments: number;
  wisdomUnitsCreated: number;
  skippedItems: number;
  databasePath: string;
};

export type AnchorContextInput = {
  task: string;
  files?: string[];
  symbols?: string[];
  diff?: string;
  currentCode?: string;
  maxResults?: number;
};

export type SearchHistoryInput = {
  query: string;
  files?: string[];
  categories?: WisdomCategory[];
  maxResults?: number;
};

export type RankedWisdomUnit = WisdomUnit & {
  score: number;
  scoreParts: {
    filePathMatch: number;
    symbolMatch: number;
    textMatch: number;
    reviewerOrAuthorSignal: number;
    recencyOrRepetition: number;
    categoryPriority: number;
  };
  duplicateCount: number;
};

export type IndexStatus = {
  repo?: string;
  databasePath: string;
  prCount: number;
  fileCount: number;
  commentCount: number;
  wisdomUnitCount: number;
  lastSyncTime?: string;
  githubTokenConfigured: boolean;
  health: "ok" | "missing_database" | "schema_invalid" | "empty_index";
};

export type DoctorCheck = {
  name: string;
  ok: boolean;
  message: string;
  fix?: string;
};

export type DoctorReport = {
  ok: boolean;
  checks: DoctorCheck[];
};
