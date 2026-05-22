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

export type ConfidenceLevel = "strong" | "moderate" | "weak";

export type FreshnessStatus = "current" | "possibly_stale" | "stale";

export type EvidenceRef = {
  prNumber: number;
  prUrl: string;
  sourceType: SourceType;
  author?: string;
  filePath?: string;
  note?: string;
};

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

export type CodeFileRecord = {
  repo: string;
  path: string;
  language?: string;
  sizeBytes: number;
  contentHash: string;
  updatedAt: string;
};

export type CodeChunk = {
  id: string;
  repo: string;
  filePath: string;
  language?: string;
  startLine: number;
  endLine: number;
  sanitizedText: string;
  symbols: string[];
  contentHash: string;
  updatedAt: string;
};

export type RankedCodeChunk = CodeChunk & {
  score: number;
  scoreParts: {
    filePathMatch: number;
    symbolMatch: number;
    textMatch: number;
    recency: number;
  };
};

export type TeamRule = {
  id: string;
  category: WisdomCategory;
  text: string;
  sanitizedText: string;
  filePaths: string[];
  symbols: string[];
  evidence: EvidenceRef[];
  confidenceLevel: ConfidenceLevel;
};

export type RankedTeamRule = TeamRule & {
  score: number;
  freshnessStatus: FreshnessStatus;
  freshnessReason: string;
  confidenceReasons: string[];
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

export type FetchPullRequestsProgress =
  | {
      stage: "discovering_pull_requests";
      repo: string;
      all: boolean;
      limit?: number;
      since?: string;
    }
  | {
      stage: "scanned_pull_request_page";
      repo: string;
      all: boolean;
      limit?: number;
      scannedPullRequests: number;
      matchedMergedPullRequests: number;
    }
  | {
      stage: "discovered_pull_requests";
      repo: string;
      all: boolean;
      total: number;
      limit?: number;
      detailConcurrency: number;
    }
  | {
      stage: "fetching_pull_request_details";
      repo: string;
      current: number;
      total: number;
      prNumber: number;
      detailConcurrency: number;
    }
  | {
      stage: "fetched_pull_request_details";
      repo: string;
      current: number;
      total: number;
      prNumber: number;
      detailConcurrency: number;
    };

export type IndexPullRequestsProgress =
  | {
      stage: "indexing_pull_request";
      repo: string;
      current: number;
      total: number;
      prNumber: number;
    }
  | {
      stage: "indexed_pull_request";
      repo: string;
      current: number;
      total: number;
      prNumber: number;
      wisdomUnitsCreated: number;
    };

export type CodeIndexProgress =
  | {
      stage: "discovering_code_files";
      repo: string;
    }
  | {
      stage: "discovered_code_files";
      repo: string;
      files: number;
      skippedFiles: number;
    }
  | {
      stage: "indexing_code_file";
      repo: string;
      current: number;
      total: number;
      filePath: string;
    }
  | {
      stage: "indexed_code_file";
      repo: string;
      current: number;
      total: number;
      filePath: string;
      chunks: number;
    };

export type IndexSummary = {
  indexedPrs: number;
  indexedFiles: number;
  indexedComments: number;
  wisdomUnitsCreated: number;
  skippedItems: number;
  databasePath: string;
};

export type CodeIndexSummary = {
  indexedFiles: number;
  codeChunksCreated: number;
  skippedFiles: number;
  databasePath: string;
};

export type AnchorContextInput = {
  task: string;
  files?: string[];
  symbols?: string[];
  diff?: string;
  currentCode?: string;
  maxResults?: number;
  strict?: boolean;
  minConfidence?: ConfidenceLevel;
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
  claimKey: string;
  repeatedEvidenceCount: number;
  confidenceLevel: ConfidenceLevel;
  confidenceReasons: string[];
  freshnessStatus: FreshnessStatus;
  freshnessReason: string;
  evidence: EvidenceRef;
};

export type IndexStatus = {
  repo?: string;
  databasePath: string;
  prCount: number;
  fileCount: number;
  commentCount: number;
  wisdomUnitCount: number;
  codeFileCount: number;
  codeChunkCount: number;
  historyCoverage?: "limited" | "all" | "unknown";
  historyLimit?: number;
  staleEvidenceCount: number;
  teamRuleCount: number;
  lastSyncTime?: string;
  lastCodeIndexTime?: string;
  lastRuleIndexTime?: string;
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
