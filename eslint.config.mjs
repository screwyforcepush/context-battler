// ESLint flat config (per ADR §2 — flat, not legacy .eslintrc).
// Minimal set for WP1; later WPs may extend with stricter rules as the
// engine surface grows.
//
// Phase 02 / WP-A additions:
//   - A `files` block for `apps/replay/src/**/*.{ts,tsx}` enables JSX
//     parsing (TSX files) under @typescript-eslint/parser.
//   - A `no-restricted-imports` rule blocks runtime imports of the engine
//     slice (`convex/engine/**`, `convex/llm/**`, `convex/runMatch`,
//     `convex/_internal_runMatch`) from the renderer. Type-only imports
//     across the slice boundary are allowed via `allowTypeImports: true`
//     (architecture-decisions.md §7).

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
      // The replay sub-package's build artefacts and node_modules.
      "apps/replay/node_modules/**",
      "apps/replay/dist/**",
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
  // Phase 02 / WP-A — renderer slice. JSX/TSX files in `apps/replay/src/`
  // need TSX parsing AND the slice-boundary import rule.
  {
    files: ["apps/replay/src/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      // Block runtime imports of engine/LLM/runMatch from the renderer
      // (architecture.md §1 / pillar 7 — renderer subscribes to State only).
      // Type-only imports across the slice are explicitly allowed.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/convex/engine/**",
                "**/convex/llm/**",
                "**/convex/runMatch",
                "**/convex/_internal_runMatch",
              ],
              message:
                "Renderer must not import runtime values from convex/engine|llm|runMatch (architecture.md §1 / pillar 7). Use type-only imports via `import type` if you need shared types.",
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
);
