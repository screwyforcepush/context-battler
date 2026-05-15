// Phase 02 / WP-A + WP-B — Renderer-only Convex query module.
//
// This module owns the *renderer's* read contract against Convex state. It
// does NOT extend `convex/turns.ts` or `convex/matches.ts`; per
// `docs/project/phases/02-replay-overseer-v0/architecture-decisions.md` §3,
// the renderer's read surface lives in one auditable file so the slice
// boundary (renderer ↔ engine) is trivially greppable.
//
// Default Convex runtime — no `"use node"`, no fs, no fetch. Pure DB reads.
//
// WP-A scope: `listMatches`. WP-B scope: `getReplayBundle` (this file).
//
// Cross-references:
//   - architecture-decisions.md §3 — the locked contract for both queries.
//   - work-packages.md WP-A / WP-B — acceptance bullets this hits.
//   - convex/schema.ts:461 — `matches.by_status` index used by listMatches.
//   - convex/schema.ts:487/495 — `characters.by_match` and
//     `turns.by_match_turn` indexes used by getReplayBundle.
//   - convex/schema.ts:498-508 — `worldState` table has NO `by_match` index;
//     v0 uses `.filter()` with `.unique()` (1:1 with matches; ~50 rows in
//     dev — trivial scan).

import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel.js";
import { query, type QueryCtx } from "./_generated/server.js";

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

/**
 * Single batch fetch — the entire data set the replay route needs in ONE
 * round trip. Returns `null` when the matchId does not resolve.
 *
 * Per `architecture-decisions.md` §3, this is the renderer's only mid-replay
 * read; "no mid-replay round-trips" is enforced at the contract layer by
 * exposing only this whole-bundle query.
 *
 * Index choices (verified against `convex/schema.ts`):
 *   - `turns` uses `by_match_turn` and `.order("asc")` so the ledger comes
 *     back ascending by `turn`. The walk in `apps/replay/src/lib/reconstruct.ts`
 *     keys by `row.turn` (not array position) per D-P2-13, but the sort
 *     keeps debug-printing intuitive.
 *   - `characters` uses `by_match` (8 rows per match — one per agent).
 *   - `worldState` has no `by_match` index in the phase-1 schema; we
 *     `.filter()` + `.unique()` for the 1:1 lookup. The `.unique()` call
 *     enforces "one row per match"; a missing or duplicate row throws.
 *   - Phase 11 joins `worldStatic` back into the single `worldState` bundle
 *     field and joins prompt hashes into `promptsLookup` so the replay app
 *     can render the full prompt/world from the slim persisted shape.
 */
export const getReplayBundle = query({
  args: { matchId: v.id("matches") },
  handler: async (ctx, { matchId }) => {
    const match = await ctx.db.get(matchId);
    if (!match) return null;
    const turns = await ctx.db
      .query("turns")
      .withIndex("by_match_turn", (q) => q.eq("matchId", matchId))
      .order("asc")
      .collect();
    const characters = await ctx.db
      .query("characters")
      .withIndex("by_match", (q) => q.eq("matchId", matchId))
      .collect();
    const worldState = await ctx.db
      .query("worldState")
      .filter((q) => q.eq(q.field("matchId"), matchId))
      .unique();
    const worldStatic = await ctx.db
      .query("worldStatic")
      .withIndex("by_match", (q) => q.eq("matchId", matchId))
      .unique();
    if (worldState && !worldStatic) {
      throw new Error(
        `replay.getReplayBundle: missing worldStatic row for match ${matchId}`,
      );
    }
    const promptsLookup = await buildPromptsLookup(ctx, turns);
    const mergedWorldState =
      worldState && worldStatic ? { ...worldStatic, ...worldState } : worldState;
    return { match, turns, characters, worldState: mergedWorldState, promptsLookup };
  },
});

type PromptKind = "system" | "persona";
type PromptLookup = {
  system: Record<string, string>;
  persona: Record<string, string>;
};

async function buildPromptsLookup(
  ctx: QueryCtx,
  turns: Array<Doc<"turns">>,
): Promise<PromptLookup> {
  const requested = new Map<string, { kind: PromptKind; hash: string }>();
  for (const turn of turns) {
    for (const record of turn.agentRecords) {
      requested.set(promptKey("system", record.input.systemPromptHash), {
        kind: "system",
        hash: record.input.systemPromptHash,
      });
      requested.set(promptKey("persona", record.input.personaPromptHash), {
        kind: "persona",
        hash: record.input.personaPromptHash,
      });
    }
  }

  const lookup: PromptLookup = { system: {}, persona: {} };
  for (const { kind, hash } of requested.values()) {
    const row = await ctx.db
      .query("prompts")
      .withIndex("by_hash_kind", (q) => q.eq("hash", hash).eq("kind", kind))
      .unique();
    if (row) lookup[kind][hash] = row.text;
  }
  return lookup;
}

function promptKey(kind: PromptKind, hash: string): string {
  return `${kind}:${hash}`;
}
