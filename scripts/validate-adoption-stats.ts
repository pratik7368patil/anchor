import path from "node:path";
import {
  readJsonFile,
  validateAdoptionHistory,
  validateAdoptionStats,
} from "./adoption-stats.js";

const statsDir = path.resolve("apps/site/public/stats");
const statsPath = path.join(statsDir, "adoption.json");
const historyPath = path.join(statsDir, "adoption-history.json");

const stats = readJsonFile(statsPath, validateAdoptionStats);
const history = readJsonFile(historyPath, validateAdoptionHistory);

if (!stats) {
  throw new Error(`Invalid or missing adoption stats file: ${statsPath}`);
}

if (!history) {
  throw new Error(`Invalid or missing adoption history file: ${historyPath}`);
}

console.log(
  `Adoption stats valid: ${stats.project.packageName}, ${history.days.length} history day(s).`,
);
