// WP10 — match lifecycle public surface (default Convex runtime).
//
// Three exports: `start` (mutation), `get` (query), `status` (query).
// All use the default Convex runtime — no `"use node"` directive — which
// means **no fs access** in this module. The map descriptor is therefore
// loaded via an `import` of `maps/reference.json` (resolved by `tsconfig`'s
// `resolveJsonModule: true`); the pure expansion + persona-spawn-assignment
// helpers are reimplemented INLINE here rather than imported from
// `convex/engine/map.ts`, because that module's top-level `node:fs` import
// is not resolvable by Convex's default-runtime bundler. The inline
// implementations are byte-equivalent to the engine module so they
// round-trip with the engine's tests.
//
// `runMatch.ts` is the per-turn action and lives in the node runtime
// (`"use node"`) so it can call `loadPersonas()` per turn (WP9 contract).
//
// Cross-references:
//   - ADR §6 — locks the schema rows this module writes/reads.
//   - ADR §7 — the trace-introspection contract `status` exposes for harness.
//   - work-packages.md WP10 — defines the public surface (start/get/status).
//   - convex/engine/loot.ts — `makeRng` (pure, fs-free).
//   - convex/engine/types.ts — `PERSONA_IDS`, `MapDescriptor`.

import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import { api } from "./_generated/api.js";
import type { Doc, Id } from "./_generated/dataModel.js";
import type { MutationCtx } from "./_generated/server.js";
import { reasoningEffortValidator } from "./schema.js";
// loot.ts is fs-free; safe to import from default-runtime module.
import { makeRng } from "./engine/loot.js";
import {
  CARD_MATCH_AGENT_COUNT,
  validateCardMatchAgentNames,
  type CardMatchAgentNameValidationError,
} from "./engine/cardMatchAgentNames.js";
import { CHARACTER_MAX_HP, PERSONA_IDS, titleCase } from "./engine/types.js";
import type {
  AirdropState,
  CrateState,
  EvacZone,
  MapDescriptor,
  PersonaId,
  Tile,
  Wall,
  WorldState,
} from "./engine/types.js";
// Inline JSON import of the reference map descriptor. tsconfig has
// `resolveJsonModule: true`; Convex's esbuild-based bundler also handles
// JSON imports natively, so this works in the default runtime without
// needing fs (which is unavailable outside `"use node"` files).
import referenceMapJson from "../maps/reference.json" with { type: "json" };

/**
 * Generate a fresh rng seed string when the caller doesn't supply one.
 * Concatenates `Date.now()` and a `Math.random()` slice — sufficient
 * uniqueness for phase-1 smoke runs (the seed only needs to vary across
 * concurrent runs the harness fans out, not be cryptographic).
 */
function defaultRngSeed(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Load the reference map descriptor from the inline JSON import. Strips
 * the `_comment` doc field if present so the returned shape matches
 * `MapDescriptor` exactly (mirrors `loadReferenceMap()`'s normalisation).
 */
function getReferenceMapDescriptor(): MapDescriptor {
  const parsed = referenceMapJson as MapDescriptor & { _comment?: string };
  return {
    size: parsed.size,
    walls: parsed.walls,
    coverClusters: parsed.coverClusters,
    crates: parsed.crates,
    airdrops: parsed.airdrops,
    spawns: parsed.spawns,
    evac: parsed.evac,
  };
}

// ─── Inline reimplementation of pure helpers from convex/engine/map.ts ────
//
// These are byte-equivalent to the engine module. They live here only
// because Convex's default-runtime bundler cannot resolve `node:fs` —
// which `convex/engine/map.ts` imports at module top-level for the
// `loadReferenceMap()` helper, even though we don't call that one. The
// `loot.ts`'s `makeRng` primitive IS fs-free and we re-use it directly
// for spawn assignment. WP15 / future engine refactors that move
// `loadReferenceMap` out of `engine/map.ts` can collapse this back into
// a direct import.

/** Unroll an axis-aligned rectangle into the list of `Tile`s it covers. */
function rectToTiles(rect: Wall): Tile[] {
  const tiles: Tile[] = [];
  for (let dx = 0; dx < rect.w; dx++) {
    for (let dy = 0; dy < rect.h; dy++) {
      tiles.push({ x: rect.x + dx, y: rect.y + dy });
    }
  }
  return tiles;
}

/**
 * Mirror of `convex/engine/map.ts` `expandMap`. Pure; crate ids are
 * coord-encoded (`Crate_<x>_<y>`) and contents are hand-authored.
 */
export function expandMapInline(
  descriptor: MapDescriptor,
  _rngSeed: string,
): WorldState {
  const coverTiles: Tile[] = [];
  for (const cluster of descriptor.coverClusters) {
    coverTiles.push(...rectToTiles(cluster));
  }

  const crates: CrateState[] = descriptor.crates.map((c) => {
    const crateId = `Crate_${c.x}_${c.y}`;
    return {
      id: crateId,
      pos: { x: c.x, y: c.y },
      contents: { ...c.contents },
      opened: false,
    };
  });

  const airdrops: AirdropState[] = descriptor.airdrops.map((drop) => ({
    id: `Crate_${drop.x}_${drop.y}`,
    pos: { x: drop.x, y: drop.y },
    landsAtTurn: drop.landsAtTurn,
    contents: { ...drop.contents },
    looted: false,
  }));

  const evac: EvacZone = {
    centre: { x: descriptor.evac.x, y: descriptor.evac.y },
    revealedAtTurn: null,
  };

  return {
    size: descriptor.size,
    walls: descriptor.walls,
    coverClusters: descriptor.coverClusters,
    coverTiles,
    crates,
    airdrops,
    corpses: [],
    evac,
  };
}

/**
 * Mirror of `convex/engine/map.ts` `assignPersonasToSpawns`. Fisher–Yates
 * shuffle on `[0..N)` driven by `makeRng(seed + ":spawnAssign")`.
 * Determinism: same `seed` + same `personas` ordering → identical mapping.
 */
export function assignItemsToSpawnsInline<T>(
  rngSeed: string,
  items: readonly T[],
): Array<{ item: T; spawnIndex: number }> {
  const n = items.length;
  const indices = Array.from({ length: n }, (_, i) => i);
  const rng = makeRng(`${rngSeed}:spawnAssign`);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const safeJ = j > i ? i : j;
    const tmp = indices[i] as number;
    indices[i] = indices[safeJ] as number;
    indices[safeJ] = tmp;
  }
  return items.map((item, i) => ({
    item,
    spawnIndex: indices[i] as number,
  }));
}

function assignPersonasToSpawnsInline(
  rngSeed: string,
  personas: readonly PersonaId[],
): Array<{ personaId: PersonaId; spawnIndex: number }> {
  return assignItemsToSpawnsInline(rngSeed, personas).map(
    ({ item: personaId, spawnIndex }) => ({
      personaId,
      spawnIndex,
    }),
  );
}

type MatchStartArgs = {
  rngSeed?: string;
  reasoningEffort?: "low" | "medium" | "high";
};

async function insertMatchScaffold(
  ctx: MutationCtx,
  args: { rngSeed: string; reasoningEffort?: "low" | "medium" | "high" },
): Promise<Id<"matches">> {
  return await ctx.db.insert("matches", {
    status: "pending",
    turn: 0,
    startedAt: Date.now(),
    completedAt: null,
    mapId: "reference",
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
 *      `mapId="reference"`, the resolved (or generated) `rngSeed`, and
 *      empty `outcome` / no `failure`.
 *   2. Build the world rows by expanding the reference descriptor
 *      with `rngSeed` (deterministic per ADR §5): static terrain goes to
 *      `worldStatic`, dynamic match entities go to `worldState`.
 *   3. Compute persona-to-spawn permutation via the inline mirror of
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
    // WP10.5 A5 — Azure `reasoning.effort` knob, plumbed end-to-end from the
    // harness CLI. Optional; defaults to "low" (de-risking.md "Reasoning
    // policy"). `runMatch.advanceTurn` reads this back from the matches row
    // and forwards it to `callDecisionTool` on every turn.
    reasoningEffort: v.optional(reasoningEffortValidator),
  },
  returns: v.id("matches"),
  handler: async (ctx, args) => {
    const rngSeed = args.rngSeed ?? defaultRngSeed();
    const descriptor = getReferenceMapDescriptor();
    const world = expandMapInline(descriptor, rngSeed);

    // 1. Insert matches row.
    const matchId = await insertMatchScaffold(ctx, { ...args, rngSeed });

    // 2. Insert world rows. Static terrain is immutable post-spawn and lives
    //    outside the per-turn worldState read path.
    await insertWorldRows(ctx, matchId, world);

    // 3. + 4. Insert 8 characters using the seeded persona-to-spawn map.
    const assignment = assignPersonasToSpawnsInline(rngSeed, PERSONA_IDS);
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
    reasoningEffort: v.optional(reasoningEffortValidator),
  },
  returns: v.id("matches"),
  handler: async (ctx, args: MatchStartArgs & { cardIds: Id<"cards">[] }) => {
    validateCardIds(args.cardIds);
    const cards = await loadCardsForMatch(ctx, args.cardIds);
    const displayNamesByCardId = validateCardDisplayNames(cards);
    await ensureCardPromptRowsExist(ctx, cards);

    const rngSeed = args.rngSeed ?? defaultRngSeed();
    const descriptor = getReferenceMapDescriptor();
    const world = expandMapInline(descriptor, rngSeed);
    const matchId = await insertMatchScaffold(ctx, { ...args, rngSeed });
    await insertWorldRows(ctx, matchId, world);

    const assignment = assignItemsToSpawnsInline(rngSeed, cards);
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
