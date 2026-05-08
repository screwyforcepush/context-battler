// Phase 02 / WP-A — singleton Convex client for the renderer.
//
// `convex/react`'s `ConvexReactClient` powers `useQuery` / `usePaginatedQuery`
// (the match picker uses `usePaginatedQuery`). WP-B will call
// `client.query(api.replay.getReplayBundle, ...)` directly on this same
// client instance for one-shot batch fetches per
// architecture-decisions.md §3.
//
// The URL comes from the runtime env (`VITE_CONVEX_URL`) so the user's own
// Convex dev deployment is the source. Missing URL throws a clear,
// human-readable error rather than crashing inside Convex's plumbing.

import { ConvexReactClient } from "convex/react";

function readConvexUrl(): string {
  const url = import.meta.env.VITE_CONVEX_URL as string | undefined;
  if (!url || url.length === 0) {
    throw new Error(
      [
        "VITE_CONVEX_URL is not set.",
        "",
        "The replay overseer connects to YOUR Convex dev deployment.",
        "Run `npx convex dev` in the repo root, copy the deployment URL",
        "it prints (https://<slug>.convex.cloud), and put it in",
        "`apps/replay/.env` as `VITE_CONVEX_URL=...`. Then restart Vite.",
        "",
        "See `apps/replay/.env.example` for the template.",
      ].join("\n"),
    );
  }
  return url;
}

export const convexClient = new ConvexReactClient(readConvexUrl());
