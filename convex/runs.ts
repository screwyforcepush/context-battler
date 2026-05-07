// WP12 — `runs` row writer + reader.
//
// Default Convex runtime (no `"use node"`) — pure DB reads/writes; the
// aggregation logic lives in the engine layer (`convex/engine/runStats.ts`)
// which has zero Convex dependencies and is unit-tested directly.
//
// Public surface:
//   - `runs.aggregate({ matchId })` — mutation: walks the match's `turns`
//     ledger + `characters` rows, calls `aggregateRunStats` (pure), and
//     inserts a `runs` row. Idempotent: re-invoking on the same matchId
//     after the row exists is a no-op (returns the existing id). The
//     `runMatch.advanceTurn` completion branch schedules this — WP10's
//     boundary contract (ADR §6 / WP10 acceptance bullet "WP10 itself
//     does NOT call runs.aggregate's body — it only schedules the WP12
//     mutation").
//
//   - `runs.byMatch({ matchId })` — query: returns the `runs` row for a
//     matchId (or null). Used by the harness post-run hook to print the
//     per-match summary.
//
// Boundary contract (ADR §1):
//   - DB I/O lives here; counter logic lives in `engine/runStats.ts`.
//   - The mutation refuses to write a `runs` row for a match whose
//     status is not "completed" — failed matches don't get a `runs` row
//     per WP12 acceptance ("Failed matches do NOT get a `runs` row").
//
// Cross-references:
//   - ADR §6 — locks the `runs` table shape.
//   - work-packages.md WP12 — boundary contract + acceptance.
//   - convex/engine/runStats.ts — pure aggregator with unit tests.

import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import {
  aggregateRunStats,
  type AggregatorCharacterRow,
  type AggregatorTurnRow,
} from "./engine/runStats.js";
import type { PersonaId } from "./engine/types.js";

/**
 * `runs.aggregate({ matchId })` — compute and persist the aggregated
 * `runs` row for a completed match.
 *
 * Behaviour:
 *   - If a `runs` row for this matchId already exists, no-op and return
 *     the existing id (idempotent — chains can re-fire safely).
 *   - If the match is not in `status="completed"`, no-op and return null
 *     (failed matches don't get a row per WP12 acceptance).
 *   - Else: walk turns + characters via existing indexes, call the pure
 *     aggregator, insert the row, return the new id.
 *
 * The mutation is the SOLE writer to the `runs` table — WP10's
 * `advanceTurn` schedules this rather than computing the row inline,
 * keeping Gate-1 (engine smoke) decoupled from Gate-2 (per-match
 * aggregation) per ADR §6 / WP10 acceptance.
 */
export const aggregate = mutation({
  args: { matchId: v.id("matches") },
  returns: v.union(v.id("runs"), v.null()),
  handler: async (ctx, { matchId }) => {
    // Idempotency: bail early if the row already exists.
    const existing = await ctx.db
      .query("runs")
      .withIndex("by_match", (q) => q.eq("matchId", matchId))
      .unique();
    if (existing) return existing._id;

    // Refuse to aggregate non-completed matches.
    const matchRow = await ctx.db.get(matchId);
    if (!matchRow) return null;
    if (matchRow.status !== "completed") return null;

    // Read the turns ledger (ascending) + final character roster.
    const turnRows = await ctx.db
      .query("turns")
      .withIndex("by_match_turn", (q) => q.eq("matchId", matchId))
      .order("asc")
      .collect();

    const characterRows = await ctx.db
      .query("characters")
      .withIndex("by_match", (q) => q.eq("matchId", matchId))
      .collect();

    // Adapt rows to the pure-aggregator shapes (plain objects). Convex
    // Id values ARE strings at runtime so a direct cast suffices.
    const turns: AggregatorTurnRow[] = turnRows.map((t) => ({
      turn: t.turn,
      agentRecords: t.agentRecords.map((r) => ({
        characterId: r.characterId as string,
        personaId: r.personaId as PersonaId,
      })),
      resolution: {
        consumed: t.resolution.consumed.map((c) => ({
          characterId: c.characterId as string,
          item: { category: "consumable" as const, name: c.item.name },
        })),
        speech: t.resolution.speech.map((s) => ({
          characterId: s.characterId as string,
          text: s.text,
          heardBy: s.heardBy.map((h) => h as string),
        })),
        moves: t.resolution.moves.map((m) => ({
          characterId: m.characterId as string,
          from: m.from,
          to: m.to,
        })),
        actions: t.resolution.actions.map((a) => ({
          characterId: a.characterId as string,
          kind: a.kind,
          target: a.target,
          result: a.result,
        })),
        deaths: t.resolution.deaths.map((d) => d as string),
        visibilityUpdates: t.resolution.visibilityUpdates.map((u) => ({
          characterId: u.characterId as string,
          hidden: u.hidden,
          revealedBy: u.revealedBy,
        })),
      },
    }));

    const characters: AggregatorCharacterRow[] = characterRows.map((c) => ({
      _id: c._id as string,
      personaId: c.personaId as PersonaId,
      alive: c.alive,
      diedAtTurn: c.diedAtTurn,
      extractedAtTurn: c.extractedAtTurn,
    }));

    const summary = aggregateRunStats(turns, characters);

    // Insert the row. Schema (ADR §6 / convex/schema.ts):
    //   runs: { matchId, kills, extractions, equips, speechEvents, perPersona[8] }
    const runId = await ctx.db.insert("runs", {
      matchId,
      kills: summary.kills,
      extractions: summary.extractions,
      equips: summary.equips,
      speechEvents: summary.speechEvents,
      perPersona: summary.perPersona,
    });

    return runId;
  },
});

/**
 * `runs.byMatch({ matchId })` — fetch the `runs` row for a matchId, or
 * null. Used by the harness post-run hook to print the per-match summary.
 *
 * Single-match query → uses the `by_match` index for an O(log n)
 * lookup. Returns null if the row hasn't been written yet (e.g. the
 * scheduler hasn't fired `runs.aggregate` yet, or the match is failed).
 */
export const byMatch = query({
  args: { matchId: v.id("matches") },
  handler: async (ctx, { matchId }) => {
    return await ctx.db
      .query("runs")
      .withIndex("by_match", (q) => q.eq("matchId", matchId))
      .unique();
  },
});
