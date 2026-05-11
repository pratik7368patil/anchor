import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@anchor/core": path.resolve(__dirname, "../core/src/index.ts"),
    },
  },
});
