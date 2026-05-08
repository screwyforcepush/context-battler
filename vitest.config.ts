import { defineConfig } from "vitest/config";

// Vitest is parallel-by-default (per ADR §2). Pure-function engine tests will
// be the bulk of the suite (WP5/WP7), and integration tests gate on
// `VITEST_LLM=1` (WP6/WP10). Keep this config small for WP1.
export default defineConfig({
  test: {
    // Phase 02 / WP-A — extended to cover the apps/replay/ sub-package's
    // pure-TS unit tests (e.g. `useHashRoute` parser). The renderer's own
    // `tsconfig.json` lives at `apps/replay/tsconfig.json`; Vitest does
    // not need it because the test file imports a pure module without
    // touching React, the DOM, or Vite plugins.
    include: [
      "tests/**/*.test.ts",
      "apps/replay/src/**/*.test.ts",
      "apps/replay/src/**/*.test.tsx",
    ],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: [
        "convex/**/*.ts",
        "harness/**/*.ts",
        "apps/replay/src/**/*.ts",
        "apps/replay/src/**/*.tsx",
      ],
      exclude: ["convex/_generated/**", "**/*.test.ts", "**/*.test.tsx"],
    },
  },
});
