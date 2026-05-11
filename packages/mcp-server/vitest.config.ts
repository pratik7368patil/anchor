import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@pratik7368patil/anchor-core": path.resolve(__dirname, "../core/src/index.ts"),
    },
  },
});
