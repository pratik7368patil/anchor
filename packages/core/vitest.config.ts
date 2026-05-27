import { defineConfig } from "vitest/config";

// Integration tests here spawn real git subprocesses (git init/add/ls-files) and
// index code end to end. The default 5s timeout flakes on loaded CI runners, so
// give these heavy tests more headroom. Passing tests are unaffected.
export default defineConfig({
  test: {
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
