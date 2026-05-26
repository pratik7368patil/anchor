import {
  buildOnboardingPack,
  defaultDatabasePath,
  detectGitRoot,
  initializeSchema,
  openAnchorDatabase,
  type ArchitectureArea,
  type FormattedResult,
} from "@pratik7368patil/anchor-core";

export type OnboardingOptions = {
  file?: string;
  area?: ArchitectureArea;
  json?: boolean;
};

export function runOnboarding(cwd: string, options: OnboardingOptions = {}): FormattedResult {
  const root = detectGitRoot(cwd) ?? cwd;
  const db = openAnchorDatabase(root, defaultDatabasePath(root));
  try {
    initializeSchema(db);
    return buildOnboardingPack(db, root, {
      file: options.file,
      area: options.area,
    });
  } finally {
    db.close();
  }
}

export function printOnboarding(result: FormattedResult, options: OnboardingOptions = {}): void {
  if (options.json) {
    console.log(JSON.stringify(result.metadata.onboardingPack ?? result.metadata, null, 2));
    return;
  }
  console.log(result.markdown);
}
