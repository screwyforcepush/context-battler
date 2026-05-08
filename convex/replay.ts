// Phase 02 / WP-A — Renderer-only Convex query module.
//
// This module owns the *renderer's* read contract against Convex state. It
// does NOT extend `convex/turns.ts` or `convex/matches.ts`; per
// `docs/project/phases/02-replay-overseer-v0/architecture-decisions.md` §3,
// the renderer's read surface lives in one auditable file so the slice
// boundary (renderer ↔ engine) is trivially greppable.
//
// Default Convex runtime — no `"use node"`, no fs, no fetch. Pure DB reads.
//
// WP-A scope: `listMatches` only. `getReplayBundle` lands in WP-B.
//
// Cross-references:
//   - architecture-decisions.md §3 — the locked contract for both queries.
//   - work-packages.md WP-A — the acceptance bullets this implementation hits.
//   - convex/schema.ts:461 — `matches.by_status` index used below.

import { paginationOptsValidator } from "convex/server";
import { query } from "./_generated/server.js";

/**
 * Paginate completed matches in reverse-chronological order.
 *
 * Filtering: `withIndex("by_status", q => q.eq("status", "completed"))`
 * narrows to terminal-status rows server-side. The `by_status` index is
 * defined at `convex/schema.ts:461`.
 *
 * Ordering: `.order("desc")` traverses the index in reverse `_creationTime`
 * order so the newest completed match surfaces first — the user's
 * "most recently played" intuition for the picker.
 *
 * Pagination: takes the standard `paginationOptsValidator` payload so the
 * renderer can use `usePaginatedQuery` from `convex/react` directly.
 *
 * No phase-1 / phase-2 schema change is required — the index already exists.
 */
export const listMatches = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    return await ctx.db
      .query("matches")
      .withIndex("by_status", (q) => q.eq("status", "completed"))
      .order("desc")
      .paginate(paginationOpts);
  },
});
