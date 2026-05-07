// ESLint flat config (per ADR §2 — flat, not legacy .eslintrc).
// Minimal set for WP1; later WPs may extend with stricter rules as the
// engine surface grows.
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "convex/_generated/**",
      "coverage/**",
      "dist/**",
      "build/**",
      "**/*.cjs",
      // Agent harness tooling is not project code — owned by .agents/ and
      // shipped pre-built. Excluded from project lint/typecheck per ADR §1
      // (single-package project layout — convex/, harness/, tests/ only).
      ".agents/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.mts"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
