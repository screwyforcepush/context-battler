// Phase 02 / WP-A — Vite config for the replay overseer renderer.
//
// `server.fs.allow` is REQUIRED: WP-B will `import '../../maps/reference.json'`
// from `reconstruct.ts` to resolve spawn coordinates, and Vite's default fs
// policy confines reads to the project root (`apps/replay/`). Allowing `..`
// (the workspace root via apps/) and `../..` (the repo root) keeps the
// cross-package JSON import working without disabling the policy.
//
// Hash routing (`#/match/<id>`) means we don't need an SPA fallback — the
// browser only ever requests `/`. No middleware required.
//
// Cross-references:
//   - architecture-decisions.md §1 — tech stack lock.
//   - work-packages.md WP-A scope M2 — `server.fs.allow` requirement.

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    fs: {
      // Allow imports from the parent `apps/` directory and the repo root.
      // Required so `apps/replay/src/lib/reconstruct.ts` (WP-B) can do
      // `import '../../../maps/reference.json'` without Vite denying the
      // read for crossing the project root boundary.
      allow: ["..", "../.."],
    },
  },
});
