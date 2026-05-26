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

export type CoverageGrade = "empty" | "poor" | "fair" | "good" | "excellent";

export type ArchitectureArea =
  | "api"
  | "service"
  | "component"
  | "hook"
  | "route"
  | "store"
  | "test"
  | "schema"
  | "type"
  | "config"
  | "util"
  | "unknown";

export type ReliabilityGateStatus = "passed" | "weak" | "failed";

export type GitHubFetchBackend = "graphql" | "rest";

export type GitHubGraphQLFetchCheckpoint = {
  repo: string;
  scope: string;
  cursor?: string | null;
  scannedPullRequests: number;
  matchedMergedPullRequests: number;
  pageSize: number;
  resetAt?: string | null;
  reason: string;
  updatedAt: string;
};

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

export type CodeImport = {
  repo: string;
  sourcePath: string;
  specifier: string;
  importedPath?: string;
  importedSymbols: string[];
  kind: "static" | "dynamic" | "require";
};

export type ArchitectureComponent = {
  repo: string;
  path: string;
  area: ArchitectureArea;
  kind: string;
  language?: string;
  symbols: string[];
  imports: string[];
  relatedTests: string[];
  confidence: number;
  updatedAt: string;
};

export type ArchitecturePattern = {
  id: string;
  repo: string;
  area: ArchitectureArea;
  name: string;
  summary: string;
  sanitizedSummary: string;
  sourceFiles: string[];
  symbols: string[];
  evidence: EvidenceRef[];
  confidence: number;
  createdAt: string;
};

export type RankedArchitecturePattern = ArchitecturePattern & {
  score: number;
  matchReasons: string[];
  rankSignals: Record<string, number>;
};

export type ArchitectureIndexData = {
  components: ArchitectureComponent[];
  patterns: ArchitecturePattern[];
  imports: CodeImport[];
};

export type RankedCodeChunk = CodeChunk & {
  score: number;
  scoreParts: {
    filePathMatch: number;
    symbolMatch: number;
    textMatch: number;
    recency: number;
  };
  matchReasons: string[];
  rankSignals: Record<string, number>;
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

export type TeamRuleSuggestion = TeamRule & {
  repeatedEvidenceCount: number;
  reason: string;
};

export type RankedTeamRule = TeamRule & {
  score: number;
  freshnessStatus: FreshnessStatus;
  freshnessReason: string;
  confidenceReasons: string[];
  matchReasons: string[];
  rankSignals: Record<string, number>;
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

export type TestFileRecord = {
  repo: string;
  path: string;
  language?: string;
  sizeBytes: number;
  contentHash: string;
  updatedAt: string;
};

export type TestLink = {
  repo: string;
  sourcePath: string;
  testPath: string;
  reason: string;
  strength: number;
};

export type RankedTestFile = TestFileRecord & {
  sourcePath?: string;
  reason: string;
  strength: number;
  score: number;
  matchedSymbols: string[];
};

export type RegressionEvent = {
  id: string;
  repo: string;
  prNumber: number;
  prUrl: string;
  summary: string;
  filePaths: string[];
  symbols: string[];
  testPaths: string[];
  authors: string[];
  labels: string[];
  signals: string[];
  createdAt: string;
  mergedAt?: string;
  confidence: number;
};

export type RankedRegressionEvent = RegressionEvent & {
  score: number;
  matchReasons: string[];
  rankSignals: Record<string, number>;
};

export type TestCommand = {
  command: string;
  reason: string;
  confidence: ConfidenceLevel;
  filePath?: string;
};

export type TaskPlan = {
  targetFiles: string[];
  likelySymbols: string[];
  implementationSteps: string[];
  risks: string[];
  recommendedTests: string[];
  evidence: EvidenceRef[];
  testCommands: TestCommand[];
};

export type ArchitectureMapFormat = "mermaid" | "json";

export type ArchitectureMapNode = {
  id: string;
  label: string;
  area: ArchitectureArea;
  path?: string;
};

export type ArchitectureMapEdge = {
  source: string;
  target: string;
  relationship: string;
  weight: number;
};

export type ArchitectureMap = {
  format: ArchitectureMapFormat;
  nodes: ArchitectureMapNode[];
  edges: ArchitectureMapEdge[];
  mermaid?: string;
};

export type RetrievalEvalCase = {
  id: string;
  task: string;
  files: string[];
  expectedPrs: number[];
  expectedCategories: WisdomCategory[];
};

export type RetrievalEvalResult = {
  id: string;
  task: string;
  passed: boolean;
  expectedPrs: number[];
  foundPrs: number[];
  missingPrs: number[];
  expectedCategories: WisdomCategory[];
  foundCategories: WisdomCategory[];
  missingCategories: WisdomCategory[];
};

export type RetrievalEvalRunResult = {
  ok: boolean;
  path: string;
  total: number;
  passed: number;
  failed: number;
  results: RetrievalEvalResult[];
};

export type FeedbackRating = "useful" | "not-useful";

export type FeedbackEvent = {
  resultId: string;
  rating: FeedbackRating;
  note?: string;
  createdAt: string;
};

export type Playbook = {
  id: string;
  title: string;
  body: string;
  evidence: EvidenceRef[];
  createdAt: string;
};

export type OnboardingPack = {
  title: string;
  areas: Array<{ area: ArchitectureArea; files: string[]; patternCount: number }>;
  importantFiles: string[];
  riskyModules: string[];
  relevantTests: string[];
  topRules: TeamRule[];
  playbooks: Playbook[];
  starterPrompts: string[];
  architectureMap: ArchitectureMap;
};

export type FetchPullRequestsProgress =
  | {
      stage: "discovering_pull_requests";
      repo: string;
      all: boolean;
      limit?: number;
      since?: string;
      backend?: GitHubFetchBackend;
    }
  | {
      stage: "scanned_pull_request_page";
      repo: string;
      all: boolean;
      limit?: number;
      scannedPullRequests: number;
      matchedMergedPullRequests: number;
      backend?: GitHubFetchBackend;
      pageSize?: number;
    }
  | {
      stage: "discovered_pull_requests";
      repo: string;
      all: boolean;
      total: number;
      limit?: number;
      detailConcurrency: number;
      backend?: GitHubFetchBackend;
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
    }
  | {
      stage: "enriching_pull_request_patches";
      repo: string;
      current: number;
      total: number;
      prNumber: number;
      detailConcurrency: number;
    }
  | {
      stage: "enriched_pull_request_patches";
      repo: string;
      current: number;
      total: number;
      prNumber: number;
      detailConcurrency: number;
      patches: number;
    }
  | {
      stage: "skipped_pull_request_patch_enrichment";
      repo: string;
      current: number;
      total: number;
      prNumber: number;
      reason: string;
    }
  | {
      stage: "github_fetch_backend_fallback";
      repo: string;
      from: GitHubFetchBackend;
      to: GitHubFetchBackend;
      reason: string;
    }
  | {
      stage: "github_graphql_page_size_reduced";
      repo: string;
      previousPageSize: number;
      nextPageSize: number;
      reason: string;
    }
  | {
      stage: "github_graphql_page_size_selected";
      repo: string;
      previousPageSize: number;
      nextPageSize: number;
      remaining?: number | null;
      averageCostPerPr?: number;
    }
  | {
      stage: "github_graphql_budget_deferred";
      repo: string;
      remaining?: number | null;
      reserve: number;
      resetAt?: string | null;
      matchedMergedPullRequests: number;
    }
  | {
      stage: "github_graphql_checkpoint_resumed";
      repo: string;
      scannedPullRequests: number;
      matchedMergedPullRequests: number;
      pageSize: number;
      resetAt?: string | null;
    }
  | {
      stage: "github_rate_limited";
      repo: string;
      waitSeconds: number;
      retryAt: string;
      reason: string;
      request: string;
      attempt: number;
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
    }
  | {
      stage: "indexed_architecture";
      repo: string;
      components: number;
      patterns: number;
      imports: number;
    };

export type IndexSummary = {
  indexedPrs: number;
  indexedFiles: number;
  indexedComments: number;
  wisdomUnitsCreated: number;
  regressionEventsCreated: number;
  skippedItems: number;
  databasePath: string;
};

export type CodeIndexSummary = {
  indexedFiles: number;
  codeChunksCreated: number;
  testFilesIndexed: number;
  testLinksCreated: number;
  architectureComponentsIndexed: number;
  architecturePatternsIndexed: number;
  architectureImportsIndexed: number;
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
  regressionsOnly?: boolean;
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
  matchReasons: string[];
  rankSignals: Record<string, number>;
};

export type ReliabilityGateRejection = {
  id: string;
  prNumber: number;
  category: WisdomCategory;
  confidenceLevel: ConfidenceLevel;
  freshnessStatus: FreshnessStatus;
  reasons: string[];
  rankSignals: Record<string, number>;
};

export type ReliabilityGate = {
  status: ReliabilityGateStatus;
  strict: boolean;
  minConfidence: ConfidenceLevel;
  acceptedHistoryCount: number;
  rejectedHistoryCount: number;
  acceptedTeamRuleCount: number;
  strongCurrentCodeSignals: number;
  strongArchitectureSignals: number;
  reasons: string[];
  warnings: string[];
};

export type AnchorExplainFileInput = {
  file: string;
  symbols?: string[];
  strict?: boolean;
  maxResults?: number;
  share?: boolean;
};

export type AnchorReviewDiffInput = {
  diff: string;
  files?: string[];
  strict?: boolean;
  maxResults?: number;
  share?: boolean;
};

export type IndexRunRecord = {
  id?: number;
  command: string;
  repo?: string;
  startedAt: string;
  finishedAt?: string;
  historyCoverage?: "limited" | "all" | "unknown";
  historyLimit?: number;
  prsFetched?: number;
  prsSkipped?: number;
  commentsIndexed?: number;
  codeFilesIndexed?: number;
  testFilesIndexed?: number;
  failures?: string[];
  status: "success" | "failed";
};

export type AnchorIndexHealth = {
  status: "ok" | "warning" | "error";
  warnings: string[];
  suggestedNextCommand?: string;
  historyCoverage: "limited" | "all" | "unknown";
  staleCodeIndex: boolean;
  lastSuccessfulRun?: string;
  lastFailedRun?: string;
  coverageScore: number;
  coverageGrade: CoverageGrade;
  coverageReasons: string[];
  suggestedPrompts: string[];
};

export type SemanticStatus = {
  enabled: boolean;
  mode: "disabled" | "local";
  available: boolean;
  reason: string;
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
  testFileCount: number;
  testLinkCount: number;
  regressionEventCount: number;
  architectureComponentCount: number;
  architecturePatternCount: number;
  architectureImportCount: number;
  architectureMapEdgeCount: number;
  testCommandCount: number;
  retrievalEvalCount: number;
  feedbackEventCount: number;
  playbookCount: number;
  historyCoverage?: "limited" | "all" | "unknown";
  historyLimit?: number;
  staleEvidenceCount: number;
  teamRuleCount: number;
  lastSyncTime?: string;
  lastCodeIndexTime?: string;
  lastArchitectureIndexTime?: string;
  lastRuleIndexTime?: string;
  lastWatchIndexTime?: string;
  lastSuccessfulRun?: string;
  lastFailedRun?: string;
  staleCodeIndex?: boolean;
  suggestedNextCommand?: string;
  coverageScore: number;
  coverageGrade: CoverageGrade;
  coverageReasons: string[];
  suggestedPrompts: string[];
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
