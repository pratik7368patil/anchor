import path from "node:path";
import {
  collectAdoptionStats,
  mergeAdoptionHistory,
  readJsonFile,
  validateAdoptionHistory,
  writeJsonFile,
} from "./adoption-stats.js";

const packageName = process.env.ADOPTION_PACKAGE_NAME ?? "@pratik7368patil/anchor";
const repository = process.env.ADOPTION_REPOSITORY ?? "pratik7368patil/anchor";
const statsStartDate = process.env.ADOPTION_START_DATE ?? "2026-05-01";
const generatedAt = new Date().toISOString();
const statsDir = path.resolve("apps/site/public/stats");
const statsPath = path.join(statsDir, "adoption.json");
const historyPath = path.join(statsDir, "adoption-history.json");

const stats = await collectAdoptionStats({
  fetch,
  packageName,
  repository,
  statsStartDate,
  generatedAt,
  githubToken: process.env.GH_TRAFFIC_TOKEN,
  goatCounterCode: process.env.VITE_GOATCOUNTER_CODE,
});
const history = mergeAdoptionHistory(
  readJsonFile(historyPath, validateAdoptionHistory),
  stats,
  generatedAt.slice(0, 10),
);

writeJsonFile(statsPath, stats);
writeJsonFile(historyPath, history);

console.log(
  `Collected adoption stats for ${packageName}: ${stats.npm.downloads.lastWeek} npm downloads last week, ${stats.github.stars} stars, ${stats.warnings.length} warning(s).`,
);
