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
// implementations are byte-equivalent to the engine module (they use the
// same `loot.ts` PRNG) so they round-trip with the engine's tests.
//
// `runMatch.ts` is the per-turn action and lives in the node runtime
// (`"use node"`) so it can call `loadPersonas()` per turn (WP9 contract).
//
// Cross-references:
//   - ADR §6 — locks the schema rows this module writes/reads.
//   - ADR §7 — the trace-introspection contract `status` exposes for harness.
//   - work-packages.md WP10 — defines the public surface (start/get/status).
//   - convex/engine/loot.ts — `makeRng`, `rollLoot` (pure, fs-free).
//   - convex/engine/types.ts — `PERSONA_IDS`, `MapDescriptor`.

import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import { api } from "./_generated/api.js";
// loot.ts is fs-free; safe to import from default-runtime module.
import { makeRng, rollLoot } from "./engine/loot.js";
import { PERSONA_IDS } from "./engine/types.js";
import type {
  ChestState,
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
    chests: parsed.chests,
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
// `loot.ts` primitives (`makeRng`, `rollLoot`) ARE fs-free and we re-use
// them directly. WP15 / future engine refactors that move
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
 * Mirror of `convex/engine/map.ts` `expandMap`. Pure; deterministic given
 * `rngSeed`. Chest ids are 1-indexed `chest_001`, `chest_002`, …, in
 * descriptor order. Per-chest seed: `rngSeed + ":chest:" + chestId`.
 */
function expandMapInline(
  descriptor: MapDescriptor,
  rngSeed: string,
): WorldState {
  const coverTiles: Tile[] = [];
  for (const cluster of descriptor.coverClusters) {
    coverTiles.push(...rectToTiles(cluster));
  }

  const chests: ChestState[] = descriptor.chests.map((c, i) => {
    const chestId = `chest_${String(i + 1).padStart(3, "0")}`;
    const rng = makeRng(`${rngSeed}:chest:${chestId}`);
    const contents = rollLoot(c.lootTable, rng);
    return {
      id: chestId,
      pos: { x: c.x, y: c.y },
      contents,
      opened: false,
      lootTable: c.lootTable,
    };
  });

  const evac: EvacZone = {
    centre: { x: descriptor.evac.x, y: descriptor.evac.y },
    revealedAtTurn: null,
  };

  return {
    size: descriptor.size,
    walls: descriptor.walls,
    coverTiles,
    chests,
    corpses: [],
    evac,
  };
}

/**
 * Mirror of `convex/engine/map.ts` `assignPersonasToSpawns`. Fisher–Yates
 * shuffle on `[0..N)` driven by `makeRng(seed + ":spawnAssign")`.
 * Determinism: same `seed` + same `personas` ordering → identical mapping.
 */
function assignPersonasToSpawnsInline(
  rngSeed: string,
  personas: readonly PersonaId[],
): Array<{ personaId: PersonaId; spawnIndex: number }> {
  const n = personas.length;
  const indices = Array.from({ length: n }, (_, i) => i);
  const rng = makeRng(`${rngSeed}:spawnAssign`);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const safeJ = j > i ? i : j;
    const tmp = indices[i] as number;
    indices[i] = indices[safeJ] as number;
    indices[safeJ] = tmp;
  }
  return personas.map((personaId, i) => ({
    personaId,
    spawnIndex: indices[i] as number,
  }));
}

/**
 * `matches.start` — public mutation: create a fresh match end-to-end.
 *
 * Steps:
 *   1. Insert `matches` row with `status="pending"`, `turn=0`,
 *      `mapId="reference"`, the resolved (or generated) `rngSeed`, and
 *      empty `outcome` / no `failure`.
 *   2. Build the `worldState` row by expanding the reference descriptor
 *      with `rngSeed` (deterministic per ADR §5).
 *   3. Compute persona-to-spawn permutation via the inline mirror of
 *      `assignPersonasToSpawns(rngSeed, PERSONA_IDS)`.
 *   4. Insert 8 `characters` rows (one per persona), seeded with HP 100,
 *      empty equipped slots (concept-spec §13 — no starter gear), empty
 *      scratchpad, hidden=false (start in the open per concept-spec §7),
 *      alive=true, lastKnown=[].
 *   5. Schedule `runMatch.advanceTurn` for turn 1 via
 *      `scheduler.runAfter(0, ...)` — kicks off the per-turn chain.
 *
 * Returns the new match id; the harness polls `matches.status` for terminal
 * state.
 */
export const start = mutation({
  args: {
    rngSeed: v.optional(v.string()),
  },
  returns: v.id("matches"),
  handler: async (ctx, args) => {
    const rngSeed = args.rngSeed ?? defaultRngSeed();
    const descriptor = getReferenceMapDescriptor();
    const world = expandMapInline(descriptor, rngSeed);

    // 1. Insert matches row.
    const matchId = await ctx.db.insert("matches", {
      status: "pending",
      turn: 0,
      startedAt: Date.now(),
      completedAt: null,
      mapId: "reference",
      rngSeed,
      outcome: {
        extracted: [],
        pointsByCharacter: [],
      },
    });

    // 2. Insert worldState row. ChestState carries `lootTable` for engine
    //    bookkeeping; the schema validator accepts the trimmed
    //    `{id, pos, contents, opened}` shape only — strip lootTable when
    //    persisting.
    await ctx.db.insert("worldState", {
      matchId,
      walls: world.walls,
      coverTiles: world.coverTiles,
      chests: world.chests.map((c) => ({
        id: c.id,
        pos: c.pos,
        contents: c.contents,
        opened: c.opened,
      })),
      corpses: [],
      evac: {
        centre: world.evac.centre,
        revealedAtTurn: world.evac.revealedAtTurn,
      },
    });

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
        displayName: `Player_${spawnIndex + 1}`,
        hp: 100,
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
