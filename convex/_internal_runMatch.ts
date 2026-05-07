// WP10 — internal mutations + queries used by `runMatch.advanceTurn`.
//
// `runMatch.ts` is a `"use node"` module (it calls `loadPersonas()` which
// uses node:fs). Convex requires queries/mutations to live OUTSIDE the
// node runtime, so this companion module hosts the small set of internal
// reads/writes the action delegates to via `ctx.runQuery` / `ctx.runMutation`.
//
// Module name `_internal_runMatch.ts` is deliberate: it shows up at
// `api._internal_runMatch.*` so the dependency from runMatch.ts is
// explicit, but the underscore-prefixed name signals "internal helper —
// not a public API surface for the harness." The harness only ever uses
// `api.matches.*`, `api.runMatch.advanceTurn`, `api.turns.*`.
//
// All exports here are PUBLIC mutations/queries (rather than
// `internalMutation` / `internalQuery`) because Convex actions invoking
// internal-runtime functions across module boundaries via `ctx.runQuery /
// ctx.runMutation` need a reference resolvable through the API. The module
// name itself functions as the access boundary; the harness has no reason
// to call these directly and doing so would be benign anyway (every
// mutation here is idempotent or chain-internal).

import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";

// Re-import the validators so the public mutation argument shapes stay
// in lockstep with `convex/schema.ts` (single source of truth — ADR §6).
import {
  failureReasonValidator,
  matchStatusValidator as _matchStatusValidator,
  personaIdValidator,
  revealedByValidator,
} from "./schema.js";
void _matchStatusValidator;

// ─── Local validator re-builds (mirror schema; kept inline so the
//      argument validators don't re-export private references). ───────────

const tileValidator = v.object({ x: v.number(), y: v.number() });

const weaponRefValidator = v.object({
  category: v.literal("weapon"),
  name: v.union(
    v.literal("rusty_blade"),
    v.literal("sword"),
    v.literal("axe"),
    v.literal("greatsword"),
  ),
});
const armourRefValidator = v.object({
  category: v.literal("armour"),
  name: v.union(
    v.literal("cloth"),
    v.literal("leather"),
    v.literal("chain"),
    v.literal("plate"),
  ),
});
const consumableRefValidator = v.object({
  category: v.literal("consumable"),
  name: v.union(v.literal("heal"), v.literal("speed")),
});
const itemRefValidator = v.union(
  weaponRefValidator,
  armourRefValidator,
  consumableRefValidator,
);
const equippedValidator = v.object({
  weapon: v.optional(weaponRefValidator),
  armour: v.optional(armourRefValidator),
  consumable: v.optional(consumableRefValidator),
});

const moveValidator = v.union(
  v.object({
    kind: v.literal("relative"),
    dx: v.number(),
    dy: v.number(),
  }),
  v.object({
    kind: v.literal("toward_entity"),
    targetCharacterId: v.string(),
  }),
  v.object({
    kind: v.literal("away_from_entity"),
    targetCharacterId: v.string(),
  }),
  v.object({
    kind: v.literal("toward_object"),
    targetObjectId: v.string(),
  }),
  v.object({ kind: v.literal("toward_evac") }),
  v.object({ kind: v.literal("none") }),
);

const actionValidator = v.union(
  v.object({
    kind: v.literal("attack"),
    targetCharacterId: v.string(),
  }),
  v.object({
    kind: v.literal("interact"),
    targetObjectId: v.string(),
  }),
  v.object({
    kind: v.literal("loot"),
    targetCorpseId: v.string(),
  }),
  v.object({ kind: v.literal("none") }),
);

const decisionValidator = v.object({
  consume: v.union(v.literal("none"), v.literal("heal"), v.literal("speed")),
  primary: v.union(
    v.literal("move"),
    v.literal("stationary_action"),
    v.literal("overwatch"),
  ),
  move: moveValidator,
  action: actionValidator,
  say: v.union(v.string(), v.null()),
  overwatch_priority: v.union(v.string(), v.null()),
  scratchpad_update: v.union(v.string(), v.null()),
});

const agentInputValidator = v.object({
  systemPromptHash: v.string(),
  systemPromptText: v.string(),
  personaPromptHash: v.string(),
  personaPromptText: v.string(),
  visibleStateDigest: v.string(),
  scratchpadBefore: v.string(),
});

const agentLlmValidator = v.object({
  responseId: v.union(v.string(), v.null()),
  callId: v.union(v.string(), v.null()),
  rawArguments: v.union(v.string(), v.null()),
  usage: v.union(v.any(), v.null()),
  latencyMs: v.number(),
  httpStatus: v.union(v.number(), v.null()),
  fellBackToSafeDefault: v.boolean(),
  failureReason: v.optional(failureReasonValidator),
  // WP10.5 Pass B.3 — mirrors `convex/schema.ts` agentLlmValidator. Engine
  // validator rejection reason; optional so legacy rows validate cleanly.
  validatorReason: v.optional(v.string()),
  // WP10.5 Pass F — mirrors `convex/schema.ts` agentLlmValidator. Captured
  // non-OK HTTP body (sanitised+truncated). Optional+additive.
  httpBodyExcerpt: v.optional(v.string()),
});

const agentRecordValidator = v.object({
  characterId: v.id("characters"),
  personaId: personaIdValidator,
  input: agentInputValidator,
  decision: decisionValidator,
  scratchpadAfter: v.string(),
  llm: agentLlmValidator,
});

const resolutionValidator = v.object({
  consumed: v.array(
    v.object({
      characterId: v.id("characters"),
      item: consumableRefValidator,
    }),
  ),
  speech: v.array(
    v.object({
      characterId: v.id("characters"),
      text: v.string(),
      heardBy: v.array(v.id("characters")),
    }),
  ),
  moves: v.array(
    v.object({
      characterId: v.id("characters"),
      from: tileValidator,
      to: tileValidator,
    }),
  ),
  actions: v.array(
    v.object({
      characterId: v.id("characters"),
      kind: v.string(),
      target: v.string(),
      result: v.string(),
    }),
  ),
  deaths: v.array(v.id("characters")),
  visibilityUpdates: v.array(
    v.object({
      characterId: v.id("characters"),
      hidden: v.boolean(),
      revealedBy: v.optional(revealedByValidator),
    }),
  ),
});

const characterPatchValidator = v.object({
  id: v.id("characters"),
  hp: v.number(),
  pos: tileValidator,
  equipped: equippedValidator,
  scratchpad: v.string(),
  hidden: v.boolean(),
  alive: v.boolean(),
  diedAtTurn: v.optional(v.number()),
  extractedAtTurn: v.optional(v.number()),
  lastKnown: v.array(
    v.object({
      characterId: v.id("characters"),
      pos: tileValidator,
      atTurn: v.number(),
    }),
  ),
});

const chestRowValidator = v.object({
  id: v.string(),
  pos: tileValidator,
  contents: v.union(itemRefValidator, v.null()),
  opened: v.boolean(),
});

const corpseRowValidator = v.object({
  characterId: v.id("characters"),
  pos: tileValidator,
  contents: v.object({
    weapon: v.optional(weaponRefValidator),
    armour: v.optional(armourRefValidator),
    consumable: v.optional(consumableRefValidator),
  }),
});

const worldPatchValidator = v.object({
  chests: v.array(chestRowValidator),
  corpses: v.array(corpseRowValidator),
  evac: v.object({
    centre: tileValidator,
    revealedAtTurn: v.union(v.number(), v.null()),
  }),
});

const outcomeValidator = v.object({
  extracted: v.array(v.id("characters")),
  lastSurvivor: v.optional(v.id("characters")),
  pointsByCharacter: v.array(
    v.object({ id: v.id("characters"), points: v.number() }),
  ),
});

// ─── Internal queries ─────────────────────────────────────────────────────

/**
 * Read all `characters` rows for a match. Used by `runMatch.advanceTurn`
 * to build the engine MatchState. Order matches insertion order via the
 * `by_match` index (deterministic).
 */
export const charactersByMatch = query({
  args: { matchId: v.id("matches") },
  handler: async (ctx, { matchId }) => {
    return await ctx.db
      .query("characters")
      .withIndex("by_match", (q) => q.eq("matchId", matchId))
      .collect();
  },
});

/**
 * Read the `worldState` row for a match (or null). The schema currently
 * exposes no index on worldState; we filter by matchId. There's exactly
 * one row per match.
 */
export const worldByMatch = query({
  args: { matchId: v.id("matches") },
  handler: async (ctx, { matchId }) => {
    const rows = await ctx.db
      .query("worldState")
      .filter((q) => q.eq(q.field("matchId"), matchId))
      .collect();
    return rows[0] ?? null;
  },
});

/**
 * Read a turn row by (matchId, turn). Used to fetch the prior turn's
 * speech list for the heard-last-turn filter. Returns null when no row
 * exists (e.g. before turn 1).
 */
export const turnByMatchTurn = query({
  args: {
    matchId: v.id("matches"),
    turn: v.number(),
  },
  handler: async (ctx, { matchId, turn }) => {
    return await ctx.db
      .query("turns")
      .withIndex("by_match_turn", (q) =>
        q.eq("matchId", matchId).eq("turn", turn),
      )
      .unique();
  },
});

// ─── Internal mutations ────────────────────────────────────────────────────

/**
 * Flip a match's status from "pending" to "running". Idempotent: no-op if
 * the match is already running, completed, or failed.
 */
export const markRunning = mutation({
  args: { matchId: v.id("matches") },
  returns: v.null(),
  handler: async (ctx, { matchId }) => {
    const row = await ctx.db.get(matchId);
    if (!row) return null;
    if (row.status === "pending") {
      await ctx.db.patch(matchId, { status: "running" });
    }
    return null;
  },
});

/**
 * Mark a match as failed with a populated `failure = { turn, reason }`.
 * Sets `completedAt` to the failure timestamp. Always sets status="failed"
 * unless the match has already terminated cleanly (in which case we leave
 * the existing terminal state alone — defensive).
 */
export const markFailed = mutation({
  args: {
    matchId: v.id("matches"),
    turn: v.number(),
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { matchId, turn, reason }) => {
    const row = await ctx.db.get(matchId);
    if (!row) return null;
    if (row.status === "completed" || row.status === "failed") return null;
    await ctx.db.patch(matchId, {
      status: "failed",
      failure: { turn, reason },
      completedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Persist a single turn's full output:
 *   - Insert the `turns` row (agentRecords[] + resolution).
 *   - Patch each character row (hp/pos/equipped/scratchpad/hidden/alive/
 *     diedAtTurn?/extractedAtTurn?/lastKnown).
 *   - Patch the worldState row (chests/corpses/evac may have flipped).
 *   - Update matches.turn to `nextTurn`.
 *   - On `terminal=true`: also flip status to "completed" + populate
 *     outcome + completedAt.
 *
 * Phase-1 atomicity: this single mutation owns all DB writes for one turn,
 * so a single Convex transaction guarantees we never have a partial-write
 * "turns row exists but characters not patched" state on disk.
 */
export const persistTurn = mutation({
  args: {
    matchId: v.id("matches"),
    turn: v.number(),
    agentRecords: v.array(agentRecordValidator),
    resolution: resolutionValidator,
    characterPatches: v.array(characterPatchValidator),
    worldPatch: worldPatchValidator,
    nextTurn: v.number(),
    terminal: v.boolean(),
    outcome: v.optional(outcomeValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // 1. Insert turns row (one per turn).
    await ctx.db.insert("turns", {
      matchId: args.matchId,
      turn: args.turn,
      agentRecords: args.agentRecords,
      resolution: args.resolution,
    });

    // 2. Patch characters.
    for (const patch of args.characterPatches) {
      const update: {
        hp: number;
        pos: { x: number; y: number };
        equipped: typeof patch.equipped;
        scratchpad: string;
        hidden: boolean;
        alive: boolean;
        diedAtTurn?: number;
        extractedAtTurn?: number;
        lastKnown: typeof patch.lastKnown;
      } = {
        hp: patch.hp,
        pos: patch.pos,
        equipped: patch.equipped,
        scratchpad: patch.scratchpad,
        hidden: patch.hidden,
        alive: patch.alive,
        lastKnown: patch.lastKnown,
      };
      if (patch.diedAtTurn !== undefined) update.diedAtTurn = patch.diedAtTurn;
      if (patch.extractedAtTurn !== undefined)
        update.extractedAtTurn = patch.extractedAtTurn;
      await ctx.db.patch(patch.id, update);
    }

    // 3. Patch worldState (find by matchId; one row per match).
    const worldRows = await ctx.db
      .query("worldState")
      .filter((q) => q.eq(q.field("matchId"), args.matchId))
      .collect();
    const worldRow = worldRows[0];
    if (worldRow) {
      await ctx.db.patch(worldRow._id, {
        chests: args.worldPatch.chests,
        corpses: args.worldPatch.corpses,
        evac: args.worldPatch.evac,
      });
    }

    // 4. Update matches.turn (and optionally finalise).
    if (args.terminal) {
      await ctx.db.patch(args.matchId, {
        turn: args.nextTurn,
        status: "completed",
        completedAt: Date.now(),
        outcome: args.outcome ?? {
          extracted: [],
          pointsByCharacter: [],
        },
      });
    } else {
      await ctx.db.patch(args.matchId, { turn: args.nextTurn });
    }

    return null;
  },
});
