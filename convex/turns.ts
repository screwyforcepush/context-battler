// WP10 — trace introspection queries.
//
// Default Convex runtime (no `"use node"` — pure read-only DB queries with
// no fs / fetch needed). Two public queries:
//
//   - `getAgentTurn({ matchId, turn, characterId })` — returns the full
//     self-contained agent record per ADR §7. Used by reviewing agents to
//     answer "what did Camper see and do on turn 23 of run #1?". Returns
//     null when either the turn row is missing OR the named characterId is
//     not present in `agentRecords[]` (e.g. a dead character that was
//     omitted from later turns per WP10 acceptance).
//
//   - `byMatch({ matchId })` — returns ALL turn rows for a match, sorted
//     ascending by turn. Helper for harness end-of-run summary + agent
//     post-mortem. Defensive cap is unnecessary in phase 1 (max 50 rows
//     per match).
//
// Cross-references:
//   - ADR §7 — trace shape; agentRecords[] entry shape this module returns.
//   - convex/schema.ts — `turns.by_match_turn` index is the lookup key.
//   - WP10 acceptance — `getAgentTurn(m, 23, "Camper")` returns the full
//     record; the harness consumes `byMatch` for end-of-run summary.

import { v } from "convex/values";
import { query } from "./_generated/server.js";

/**
 * `turns.getAgentTurn` — returns the full agent record for
 * `(matchId, turn, characterId)` per ADR §7, or `null` if the turn row is
 * absent or the character has no record on that turn (e.g. died before).
 *
 * Lookup uses the `by_match_turn` index → `.unique()`. Phase 1 guarantees
 * at most one row per `(matchId, turn)`.
 */
export const getAgentTurn = query({
  args: {
    matchId: v.id("matches"),
    turn: v.number(),
    characterId: v.id("characters"),
  },
  handler: async (ctx, { matchId, turn, characterId }) => {
    const turnRow = await ctx.db
      .query("turns")
      .withIndex("by_match_turn", (q) =>
        q.eq("matchId", matchId).eq("turn", turn),
      )
      .unique();
    if (!turnRow) return null;
    const record = turnRow.agentRecords.find(
      (r) => r.characterId === characterId,
    );
    return record ?? null;
  },
});

/**
 * `turns.byMatch` — returns all turn rows for a match, ascending by turn.
 * Convenience helper for the harness end-of-run summary; not on the WP10
 * critical path but documented in ADR §7's introspection contract.
 *
 * Phase 1 caps row count at 50 per match (concept-spec §15), so reading
 * all rows is bounded.
 */
export const byMatch = query({
  args: { matchId: v.id("matches") },
  handler: async (ctx, { matchId }) => {
    return await ctx.db
      .query("turns")
      .withIndex("by_match_turn", (q) => q.eq("matchId", matchId))
      .order("asc")
      .collect();
  },
});
