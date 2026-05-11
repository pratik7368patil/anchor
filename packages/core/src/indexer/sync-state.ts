import type { AnchorDatabase } from "../db/database.js";
import { getLastSyncTime, updateSyncState } from "../db/database.js";

export { getLastSyncTime, updateSyncState };

export function shouldSyncSince(db: AnchorDatabase, repo: string, fallbackSince?: string): string | undefined {
  return getLastSyncTime(db, repo) ?? fallbackSince;
}
