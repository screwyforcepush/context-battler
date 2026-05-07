import { defineConfig } from "vitest/config";

// Vitest is parallel-by-default (per ADR §2). Pure-function engine tests will
// be the bulk of the suite (WP5/WP7), and integration tests gate on
// `VITEST_LLM=1` (WP6/WP10). Keep this config small for WP1.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["convex/**/*.ts", "harness/**/*.ts"],
      exclude: ["convex/_generated/**", "**/*.test.ts"],
    },
  },
});
