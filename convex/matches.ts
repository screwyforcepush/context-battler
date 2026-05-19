// WP10 — match lifecycle public surface (default Convex runtime).
//
// Three exports: `start` (mutation), `get` (query), `status` (query).
// All use the default Convex runtime — no `"use node"` directive. Map
// descriptors, world expansion, and spawn assignment resolve through the
// fs-free registry in `convex/engine/map.ts`.
//
// `runMatch.ts` is the per-turn action and lives in the node runtime
// (`"use node"`) so it can call `loadPersonas()` per turn (WP9 contract).
//
// Cross-references:
//   - ADR §6 — locks the schema rows this module writes/reads.
//   - ADR §7 — the trace-introspection contract `status` exposes for harness.
//   - work-packages.md WP10 — defines the public surface (start/get/status).
//   - convex/engine/map.ts — descriptor registry, expander, spawn assignment.
//   - convex/engine/types.ts — `PERSONA_IDS`.

import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import { api } from "./_generated/api.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import type { MutationCtx } from "./_generated/server.js";
import { reasoningEffortValidator } from "./schema.js";
import {
  DEFAULT_MAP_ID,
  assignItemsToSpawns,
  assignPersonasToSpawns,
  expandMap,
  getMapDescriptor,
} from "./engine/map.js";
import {
  CARD_MATCH_AGENT_COUNT,
  validateCardMatchAgentNames,
  type CardMatchAgentNameValidationError,
} from "./engine/cardMatchAgentNames.js";
import { CHARACTER_MAX_HP, PERSONA_IDS, titleCase } from "./engine/types.js";
import type { WorldState } from "./engine/types.js";

/**
 * Generate a fresh rng seed string when the caller doesn't supply one.
 * Concatenates `Date.now()` and a `Math.random()` slice — sufficient
 * uniqueness for phase-1 smoke runs (the seed only needs to vary across
 * concurrent runs the harness fans out, not be cryptographic).
 */
function defaultRngSeed(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

type MatchStartArgs = {
  rngSeed?: string;
  reasoningEffort?: "low" | "medium" | "high";
  mapId?: string;
};

async function insertMatchScaffold(
  ctx: MutationCtx,
  args: {
    rngSeed: string;
    mapId: string;
    reasoningEffort?: "low" | "medium" | "high";
  },
): Promise<Id<"matches">> {
  return await ctx.db.insert("matches", {
    status: "pending",
    turn: 0,
    startedAt: Date.now(),
    completedAt: null,
    mapId: args.mapId,
    rngSeed: args.rngSeed,
    // Persist reasoning effort if supplied; absent → runMatch defaults
    // to "low". We only set the field when the caller passed a value so
    // historical rows (and absent-arg callers) stay sparse — the schema
    // marks the field optional for the same reason.
    ...(args.reasoningEffort !== undefined
      ? { reasoningEffort: args.reasoningEffort }
      : {}),
    outcome: {
      extracted: [],
      pointsByCharacter: [],
    },
  });
}

async function insertWorldRows(
  ctx: MutationCtx,
  matchId: Id<"matches">,
  world: WorldState,
): Promise<void> {
  // Static terrain is immutable post-spawn and lives outside the per-turn
  // worldState read path.
  await ctx.db.insert("worldStatic", {
    matchId,
    walls: world.walls,
    coverClusters: world.coverClusters,
    coverTiles: world.coverTiles,
  });
  // CrateState already matches the schema's `{id, pos, contents, opened}`
  // shape; contents are copied from the descriptor, not rolled.
  await ctx.db.insert("worldState", {
    matchId,
    crates: world.crates.map((c) => ({
      id: c.id,
      pos: c.pos,
      contents: c.contents,
      opened: c.opened,
    })),
    airdrops: world.airdrops.map((drop) => ({
      id: drop.id,
      pos: drop.pos,
      landsAtTurn: drop.landsAtTurn,
      contents: drop.contents,
      looted: drop.looted,
    })),
    corpses: [],
    evac: {
      centre: world.evac.centre,
      revealedAtTurn: world.evac.revealedAtTurn,
    },
  });
}

function validateCardIds(cardIds: readonly string[]): void {
  if (cardIds.length !== CARD_MATCH_AGENT_COUNT) {
    throw new Error(
      `matches.startFromCards: expected exactly ${CARD_MATCH_AGENT_COUNT} cardIds, received ${cardIds.length}`,
    );
  }

  if (new Set(cardIds).size !== cardIds.length) {
    throw new Error("matches.startFromCards: duplicate cardIds are not allowed");
  }
}

async function loadCardsForMatch(
  ctx: MutationCtx,
  cardIds: readonly Id<"cards">[],
): Promise<Doc<"cards">[]> {
  const cards: Doc<"cards">[] = [];
  for (const cardId of cardIds) {
    const card = await ctx.db.get(cardId);
    if (!card) {
      throw new Error(`matches.startFromCards: unknown card id ${cardId}`);
    }
    cards.push(card);
  }
  return cards;
}

function validateCardDisplayNames(
  cards: readonly Doc<"cards">[],
): Map<Id<"cards">, string> {
  const result = validateCardMatchAgentNames(
    cards.map((card) => ({
      cardId: card._id,
      agentName: card.agentName,
    })),
  );

  if (!result.ok) {
    throw new Error(
      `matches.startFromCards: invalid agentName(s): ${result.errors
        .map(formatAgentNameError)
        .join("; ")}`,
    );
  }

  return new Map(
    result.entries.map((entry) => [
      entry.cardId as Id<"cards">,
      entry.displayName,
    ]),
  );
}

function formatAgentNameError(
  error: CardMatchAgentNameValidationError,
): string {
  if (error.reason === "invalid_count") {
    return `${error.reason} expected=${error.expected} actual=${error.actual}`;
  }
  if (error.reason === "duplicate_agent_name") {
    return `${error.reason} normalised=${error.normalisedAgentName} cardIds=${error.cardIds.join(",")}`;
  }
  return `${error.reason} cardId=${error.cardId} agentName=${JSON.stringify(
    error.agentName,
  )}`;
}

async function ensureCardPromptRowsExist(
  ctx: MutationCtx,
  cards: readonly Doc<"cards">[],
): Promise<void> {
  const checked = new Set<string>();
  for (const card of cards) {
    if (checked.has(card.promptHash)) continue;
    checked.add(card.promptHash);

    const row = await ctx.db
      .query("prompts")
      .withIndex("by_hash_kind", (q) =>
        q.eq("hash", card.promptHash).eq("kind", "persona"),
      )
      .unique();
    if (!row) {
      throw new Error(
        `matches.startFromCards: prompt row missing for card ${card._id} hash ${card.promptHash}`,
      );
    }
  }
}

/**
 * `matches.start` — public mutation: create a fresh match end-to-end.
 *
 * Steps:
 *   1. Insert `matches` row with `status="pending"`, `turn=0`,
 *      the resolved `mapId`, the resolved (or generated) `rngSeed`, and
 *      empty `outcome` / no `failure`.
 *   2. Build the world rows by expanding the selected descriptor with
 *      `rngSeed` (deterministic per ADR §5): static terrain goes to
 *      `worldStatic`, dynamic match entities go to `worldState`.
 *   3. Compute persona-to-spawn permutation via
 *      `assignPersonasToSpawns(rngSeed, PERSONA_IDS)`.
 *   4. Insert 8 `characters` rows (one per persona), seeded with HP =
 *      `CHARACTER_MAX_HP` (the shared phase-1 tuning constant; see
 *      `convex/engine/types.ts`), empty equipped slots (concept-spec §13
 *      — no starter gear), empty scratchpad, hidden=false (start in the
 *      open per concept-spec §7), alive=true, lastKnown=[].
 *   5. Schedule `runMatch.advanceTurn` for turn 1 via
 *      `scheduler.runAfter(0, ...)` — kicks off the per-turn chain.
 *
 * Returns the new match id; the harness polls `matches.status` for terminal
 * state.
 */
export const start = mutation({
  args: {
    rngSeed: v.optional(v.string()),
    mapId: v.optional(v.string()),
    // WP10.5 A5 — Azure `reasoning.effort` knob, plumbed end-to-end from the
    // harness CLI. Optional; defaults to "low" (de-risking.md "Reasoning
    // policy"). `runMatch.advanceTurn` reads this back from the matches row
    // and forwards it to `callDecisionTool` on every turn.
    reasoningEffort: v.optional(reasoningEffortValidator),
  },
  returns: v.id("matches"),
  handler: async (ctx, args) => {
    const rngSeed = args.rngSeed ?? defaultRngSeed();
    const mapId = args.mapId ?? DEFAULT_MAP_ID;
    const descriptor = getMapDescriptor(mapId);
    const world = expandMap(descriptor, rngSeed);

    // 1. Insert matches row.
    const matchId = await insertMatchScaffold(ctx, {
      rngSeed,
      mapId,
      ...(args.reasoningEffort !== undefined
        ? { reasoningEffort: args.reasoningEffort }
        : {}),
    });

    // 2. Insert world rows. Static terrain is immutable post-spawn and lives
    //    outside the per-turn worldState read path.
    await insertWorldRows(ctx, matchId, world);

    // 3. + 4. Insert 8 characters using the seeded persona-to-spawn map.
    const assignment = assignPersonasToSpawns(rngSeed, PERSONA_IDS);
    const spawns = descriptor.spawns;
    for (const { personaId, spawnIndex } of assignment) {
      const spawn = spawns[spawnIndex];
      if (!spawn) {
        throw new Error(
          `matches.start: spawn index ${spawnIndex} missing from descriptor`,
        );
      }
      await ctx.db.insert("characters", {
        matchId,
        personaId,
        spawnIndex,
        displayName: titleCase(personaId),
        // Phase-1 tuning: shared HP constant (NOT a spec invariant).
        // `runMatch.buildMatchState` reads the same `CHARACTER_MAX_HP`
        // when populating in-memory `maxHp`, so new characters satisfy
        // `hp === maxHp === CHARACTER_MAX_HP` at turn 0.
        hp: CHARACTER_MAX_HP,
        pos: { x: spawn.x, y: spawn.y },
        equipped: {},
        scratchpad: "",
        hidden: false,
        alive: true,
        lastKnown: [],
      });
    }

    // 5. Schedule the first turn. Per ADR §3 the per-turn action chains via
    //    `runAfter(0, ...)` so each call is one turn — well within the
    //    Convex action timeout.
    await ctx.scheduler.runAfter(0, api.runMatch.advanceTurn, { matchId });

    return matchId;
  },
});

/**
 * `matches.startFromCards` — public Card-triggered mutation.
 *
 * Parallel to `matches.start`: callers must provide exactly 8 distinct Card
 * ids. The selected Cards are validated, their current prompt hashes are
 * verified against the `prompts` table, then pinned onto inserted characters.
 */
export const startFromCards = mutation({
  args: {
    cardIds: v.array(v.id("cards")),
    rngSeed: v.optional(v.string()),
    mapId: v.optional(v.string()),
    reasoningEffort: v.optional(reasoningEffortValidator),
  },
  returns: v.id("matches"),
  handler: async (ctx, args: MatchStartArgs & { cardIds: Id<"cards">[] }) => {
    validateCardIds(args.cardIds);
    const rngSeed = args.rngSeed ?? defaultRngSeed();
    const mapId = args.mapId ?? DEFAULT_MAP_ID;
    const descriptor = getMapDescriptor(mapId);
    const world = expandMap(descriptor, rngSeed);

    const cards = await loadCardsForMatch(ctx, args.cardIds);
    const displayNamesByCardId = validateCardDisplayNames(cards);
    await ensureCardPromptRowsExist(ctx, cards);

    const matchId = await insertMatchScaffold(ctx, {
      rngSeed,
      mapId,
      ...(args.reasoningEffort !== undefined
        ? { reasoningEffort: args.reasoningEffort }
        : {}),
    });
    await insertWorldRows(ctx, matchId, world);

    const assignment = assignItemsToSpawns(rngSeed, cards);
    const spawns = descriptor.spawns;
    for (const { item: card, spawnIndex } of assignment) {
      const spawn = spawns[spawnIndex];
      if (!spawn) {
        throw new Error(
          `matches.startFromCards: spawn index ${spawnIndex} missing from descriptor`,
        );
      }
      const displayName = displayNamesByCardId.get(card._id);
      if (!displayName) {
        throw new Error(
          `matches.startFromCards: displayName missing for card ${card._id}`,
        );
      }

      await ctx.db.insert("characters", {
        matchId,
        personaId: card.lineagePersonaId,
        spawnIndex,
        displayName,
        cardId: card._id,
        cardPromptHash: card.promptHash,
        hp: CHARACTER_MAX_HP,
        pos: { x: spawn.x, y: spawn.y },
        equipped: {},
        scratchpad: "",
        hidden: false,
        alive: true,
        lastKnown: [],
      });
    }

    await ctx.scheduler.runAfter(0, api.runMatch.advanceTurn, { matchId });

    return matchId;
  },
});

/**
 * `matches.get` — fetch the full match row by id, or `null`. Used by
 * smoke tests and harness for inspecting outcome / failure details.
 */
export const get = query({
  args: { id: v.id("matches") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

/**
 * `matches.status` — minimal status projection for harness polling.
 * Returns `null` if the match id is unknown.
 *
 * Returned shape mirrors the WP11 polling contract (ADR §3 / §7):
 *   - `status`       — "pending" | "running" | "completed" | "failed"
 *   - `turn`         — current turn (0..50)
 *   - `completedAt`  — ms timestamp or `null`
 *   - `failure`      — populated only on `status="failed"`
 *
 * Harness polls until `status` ∈ {"completed", "failed"} per WP11.
 */
export const status = query({
  args: { id: v.id("matches") },
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (!row) return null;
    return {
      status: row.status,
      turn: row.turn,
      completedAt: row.completedAt,
      failure: row.failure ?? null,
    };
  },
});
