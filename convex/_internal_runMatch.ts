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
    v.literal("dagger"),
    v.literal("sword"),
    v.literal("axe"),
    v.literal("greatsword"),
    v.literal("warhammer"),
  ),
});
const armourRefValidator = v.object({
  category: v.literal("armour"),
  name: v.union(
    v.literal("cloth"),
    v.literal("leather"),
    v.literal("chain"),
    v.literal("plate"),
    v.literal("riot_plate"),
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

const directionValidator = v.union(
  v.object({
    kind: v.union(v.literal("toward"), v.literal("away")),
    targetId: v.string(),
  }),
  v.object({
    kind: v.union(
      v.literal("N"),
      v.literal("NE"),
      v.literal("E"),
      v.literal("SE"),
      v.literal("S"),
      v.literal("SW"),
      v.literal("W"),
      v.literal("NW"),
    ),
  }),
);

const positionValidator = v.union(
  v.object({ kind: v.union(v.literal("overwatch"), v.literal("counter")) }),
  v.object({
    kind: v.literal("move"),
    direction: directionValidator,
    dist: v.number(),
  }),
);

const actionValidator = v.union(
  v.object({
    kind: v.union(v.literal("attack"), v.literal("loot")),
    targetId: v.string(),
  }),
  v.object({ kind: v.literal("none") }),
);

const decisionValidator = v.object({
  use: v.union(v.literal("consumable"), v.null()),
  position: positionValidator,
  action: actionValidator,
  say: v.union(v.string(), v.null()),
  scratchpad: v.union(v.string(), v.null()),
});

const useVariantValidator = v.union(
  v.literal("consumable_or_null"),
  v.literal("null_only"),
);

const validatorFieldErrorsValidator = v.object({
  use: v.optional(v.string()),
  position: v.optional(v.string()),
  action: v.optional(v.string()),
  say: v.optional(v.string()),
  scratchpad: v.optional(v.string()),
});

const agentInputValidator = v.object({
  systemPromptHash: v.string(),
  personaPromptHash: v.string(),
  visibleStateDigest: v.string(),
  scratchpadBefore: v.string(),
  useVariant: v.optional(useVariantValidator),
  status: v.object({
    hp: v.number(),
    pos: tileValidator,
    equipped: equippedValidator,
    insideEvac: v.boolean(),
  }),
  narrativeLines: v.array(v.string()),
  aliveCount: v.number(),
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
  validatorFieldErrors: v.optional(validatorFieldErrorsValidator),
  // Phase 7 WP-A1 mirror — optional retry-attempt marker.
  retried: v.optional(v.boolean()),
  // WP10.5 Pass F — mirrors `convex/schema.ts` agentLlmValidator. Captured
  // non-OK HTTP body (sanitised+truncated). Optional+additive.
  httpBodyExcerpt: v.optional(v.string()),
  // Phase-3 ADR §2 / PM lock D13 — mirrors `convex/schema.ts`
  // agentLlmValidator. Required-nullable (`v.union(v.string(), v.null())`),
  // NOT `v.optional(v.string())`. Persisted as `null` on every
  // non-captured path.
  reasoning: v.union(v.string(), v.null()),
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
      path: v.array(tileValidator),
      // Phase-3 ADR §9 mirror — wall-blocked move marker (optional).
      blockedBy: v.optional(v.literal("wall")),
      slide: v.optional(
        v.object({
          wallRectId: v.string(),
          axis: v.union(
            v.literal("N"),
            v.literal("E"),
            v.literal("S"),
            v.literal("W"),
          ),
          intent: v.string(),
        }),
      ),
      bodyCollision: v.optional(
        v.union(
          v.object({
            kind: v.literal("character"),
            defenderId: v.id("characters"),
          }),
          v.object({
            kind: v.literal("wall"),
            wallRectId: v.string(),
          }),
        ),
      ),
    }),
  ),
  actions: v.array(
    v.object({
      characterId: v.id("characters"),
      kind: v.union(
        v.literal("attack"),
        v.literal("loot"),
        v.literal("overwatch"),
        v.literal("counter"),
      ),
      target: v.string(),
      result: v.string(),
      triggeredByMovement: v.optional(v.boolean()),
      // Phase-4 WP-A mirror — strike-time weapon name on damage trace entries.
      weapon: v.optional(v.string()),
      // Phase 7 WP-A1 mirror — item name for successful loot traces.
      lootedItem: v.optional(v.string()),
      // Phase 7 WP-B mirror — discard flag when a weaker item is not equipped.
      discardedWeaker: v.optional(v.boolean()),
    }),
  ),
  deaths: v.array(v.id("characters")),
  environmentalDeaths: v.array(v.id("characters")),
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

const crateRowValidator = v.object({
  id: v.string(),
  pos: tileValidator,
  contents: v.union(itemRefValidator, v.null()),
  opened: v.boolean(),
});

const airdropRowValidator = v.object({
  id: v.string(),
  pos: tileValidator,
  landsAtTurn: v.number(),
  contents: itemRefValidator,
  looted: v.boolean(),
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
  crates: v.array(crateRowValidator),
  airdrops: v.array(airdropRowValidator),
  corpses: v.array(corpseRowValidator),
  evac: v.object({
    centre: tileValidator,
    revealedAtTurn: v.union(v.number(), v.null()),
  }),
});

const promptKindValidator = v.union(v.literal("system"), v.literal("persona"));

const promptTextValidator = v.object({
  kind: promptKindValidator,
  hash: v.string(),
  text: v.string(),
});

const outcomeValidator = v.object({
  extracted: v.array(v.id("characters")),
  lastSurvivor: v.optional(v.id("characters")),
  pointsByCharacter: v.array(
    v.object({ id: v.id("characters"), points: v.number() }),
  ),
});

type PromptKind = "system" | "persona";

type PromptRow = {
  _id: unknown;
  hash: string;
  kind: PromptKind;
  text: string;
};

type PromptIndexQuery = {
  eq(field: "hash" | "kind", value: string): PromptIndexQuery;
};

type PromptPersistenceContext = {
  db: {
    query(table: "prompts"): unknown;
    insert(
      table: "prompts",
      value: { hash: string; kind: PromptKind; text: string },
    ): Promise<unknown>;
  };
};

export class DataIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataIntegrityError";
  }
}

export async function getOrCreatePrompt(
  ctx: PromptPersistenceContext,
  args: { hash: string; kind: PromptKind; text: string },
): Promise<unknown> {
  const promptQuery = ctx.db.query("prompts") as {
    withIndex(
      indexName: "by_hash_kind",
      cb: (q: PromptIndexQuery) => unknown,
    ): { unique(): Promise<PromptRow | null> };
  };
  const existing = await promptQuery
    .withIndex("by_hash_kind", (q) =>
      q.eq("hash", args.hash).eq("kind", args.kind),
    )
    .unique();

  if (existing) {
    if (existing.text !== args.text) {
      throw new DataIntegrityError(
        `Prompt hash collision for ${args.kind}:${args.hash}`,
      );
    }
    return existing._id;
  }

  return await ctx.db.insert("prompts", args);
}

async function upsertPromptTexts(
  ctx: PromptPersistenceContext,
  promptTexts: Array<{ hash: string; kind: PromptKind; text: string }>,
): Promise<Map<string, string>> {
  const unique = new Map<
    string,
    { hash: string; kind: PromptKind; text: string }
  >();
  for (const prompt of promptTexts) {
    const key = `${prompt.kind}:${prompt.hash}`;
    const existing = unique.get(key);
    if (existing && existing.text !== prompt.text) {
      throw new DataIntegrityError(
        `Prompt hash collision within persistTurn args for ${key}`,
      );
    }
    unique.set(key, prompt);
  }

  for (const prompt of unique.values()) {
    await getOrCreatePrompt(ctx, prompt);
  }

  return new Map([...unique].map(([key, prompt]) => [key, prompt.text]));
}

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
 * Read immutable terrain for a match. Kept separate from `worldByMatch` so the
 * per-turn dynamic read does not ship walls/cover.
 */
export const worldStaticByMatch = query({
  args: { matchId: v.id("matches") },
  handler: async (ctx, { matchId }) => {
    return await ctx.db
      .query("worldStatic")
      .withIndex("by_match", (q) => q.eq("matchId", matchId))
      .unique();
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

/**
 * Read pinned Card persona prompt text by content hash for `advanceTurn`.
 * The action dedupes first; this query enforces the same bounded contract
 * and fails clearly if the match references a prompt row that is missing.
 */
export const personaPromptsByHashes = query({
  args: { hashes: v.array(v.string()) },
  handler: async (ctx, { hashes }) => {
    const distinctHashes = [...new Set(hashes)];
    if (distinctHashes.length > 8) {
      throw new Error(
        `runMatch.advanceTurn: expected at most 8 distinct cardPromptHash values, received ${distinctHashes.length}`,
      );
    }

    const rows: Array<{ hash: string; text: string }> = [];
    for (const hash of distinctHashes) {
      const row = await ctx.db
        .query("prompts")
        .withIndex("by_hash_kind", (q) =>
          q.eq("hash", hash).eq("kind", "persona"),
        )
        .unique();
      if (!row) {
        throw new Error(
          `runMatch.advanceTurn: persona prompt missing for cardPromptHash ${hash}`,
        );
      }
      rows.push({ hash: row.hash, text: row.text });
    }
    return rows;
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
 *   - Patch the worldState row (crates/corpses/evac may have flipped).
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
    promptTexts: v.array(promptTextValidator),
    resolution: resolutionValidator,
    characterPatches: v.array(characterPatchValidator),
    worldPatch: worldPatchValidator,
    nextTurn: v.number(),
    terminal: v.boolean(),
    outcome: v.optional(outcomeValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const promptLookup = await upsertPromptTexts(ctx, args.promptTexts);
    for (const record of args.agentRecords) {
      const systemKey = `system:${record.input.systemPromptHash}`;
      const personaKey = `persona:${record.input.personaPromptHash}`;
      if (!promptLookup.has(systemKey)) {
        throw new DataIntegrityError(
          `Missing system prompt text for hash ${record.input.systemPromptHash}`,
        );
      }
      if (!promptLookup.has(personaKey)) {
        throw new DataIntegrityError(
          `Missing persona prompt text for hash ${record.input.personaPromptHash}`,
        );
      }
    }

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
        crates: args.worldPatch.crates,
        airdrops: args.worldPatch.airdrops,
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
