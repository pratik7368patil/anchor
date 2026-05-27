import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // CLI command tests spawn real git subprocesses and run full index flows. The
  // default 5s timeout flakes on loaded CI runners, so give them more headroom.
  test: {
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      "@pratik7368patil/anchor-core": path.resolve(__dirname, "../core/src/index.ts"),
      "@pratik7368patil/anchor-mcp-server": path.resolve(__dirname, "../mcp-server/src/server.ts"),
    },
  },
});
