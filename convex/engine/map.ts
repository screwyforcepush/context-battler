// WP3 — reference map loader + deterministic descriptor expander.
//
// Convex's esbuild-based bundler resolves JSON imports natively, so the
// canonical `maps/reference.json` ships into the deployment via a direct
// `import … with { type: "json" }`. (`convex/matches.ts` already proves
// this path works in the default Convex runtime; WP10.5 A6 collapses the
// previously-inlined `convex/_data/map.ts` redundancy.) tsconfig has
// `resolveJsonModule: true`, so the same import is also valid for vitest
// + tsc.
//
// With fs gone, this module no longer needs the node runtime — there is
// no `"use node";` directive, which means default-runtime Convex
// queries/mutations could import these helpers in the future without
// bundler complaints. (Today `convex/matches.ts` still inlines an
// equivalent expander; the duplication is deliberate, see comments there.)
//
// Pure-function module per ADR §1; no Convex imports. Three exports:
//   - `loadReferenceMap()`         — return the bundled descriptor (cloned).
//   - `expandMap(descriptor, seed)`— turn a descriptor into a `WorldState`,
//                                    resolving chest contents deterministically.
//   - `assignPersonasToSpawns(seed, personas)` — seeded permutation that
//                                    pairs each persona with a unique
//                                    spawnIndex ∈ [0, personas.length).
//
// Determinism contract (tested in `tests/engine/map.test.ts`):
//   `expandMap(d, "x")` deep-equals itself across calls.
//   `expandMap(d, "x")` differs from `expandMap(d, "y")` in at least one
//   chest's resolved contents (probabilistic — seed plumbing is broken
//   if it doesn't).
//
// PRNG:
//   - `makeRng` is xmur3 + mulberry32 (re-exported from `loot.ts`).
//   - Per-chest seed: `rngSeed + ":chest:" + chestId` so two chests with
//     different ids never share a stream.
//   - Persona-spawn seed: `rngSeed + ":spawnAssign"` so it doesn't collide
//     with chest streams.

import {
  type ChestState,
  type EvacZone,
  type MapDescriptor,
  type PersonaId,
  type Tile,
  type WorldState,
  type Wall,
} from "./types.js";
import { makeRng, rollLoot } from "./loot.js";
// JSON import — Convex's esbuild-based bundler + tsconfig
// `resolveJsonModule: true` make this work in both deployment + vitest.
// The `_comment` doc field is stripped at the loader boundary below so the
// returned shape matches `MapDescriptor` exactly.
import referenceMapJson from "../../maps/reference.json" with { type: "json" };

// ─── Reference map loader ────────────────────────────────────────────────────

/**
 * Return the hand-authored reference map descriptor. The descriptor lives
 * at `maps/reference.json` and is JSON-imported above; we deep-clone via
 * JSON round-trip to preserve the contract that callers can mutate the
 * returned object without affecting subsequent calls.
 *
 * The `_comment` field that lives in the on-disk JSON is stripped here so
 * the returned shape matches `MapDescriptor` exactly.
 */
export function loadReferenceMap(): MapDescriptor {
  // Deep-clone via JSON round-trip + strip `_comment`. The clone preserves
  // the original mutate-safe contract from the fs-backed implementation.
  const parsed = JSON.parse(JSON.stringify(referenceMapJson)) as MapDescriptor & {
    _comment?: string;
  };
  return {
    size: parsed.size,
    walls: parsed.walls,
    coverClusters: parsed.coverClusters,
    chests: parsed.chests,
    spawns: parsed.spawns,
    evac: parsed.evac,
  };
}

// ─── Cover cluster expansion ─────────────────────────────────────────────────

/**
 * Unroll an axis-aligned rectangle into the list of `Tile`s it covers.
 * Used to expand `MapDescriptor.coverClusters` into `WorldState.coverTiles`.
 */
function rectToTiles(rect: Wall): Tile[] {
  const tiles: Tile[] = [];
  for (let dx = 0; dx < rect.w; dx++) {
    for (let dy = 0; dy < rect.h; dy++) {
      tiles.push({ x: rect.x + dx, y: rect.y + dy });
    }
  }
  return tiles;
}

// ─── expandMap ───────────────────────────────────────────────────────────────

/**
 * Turn a `MapDescriptor` into a `WorldState` deterministically given an
 * `rngSeed`.
 *
 * Per ADR §5/§6:
 *  - `walls` are passed through unchanged (terrain is static).
 *  - `coverClusters` are unrolled into `coverTiles[]`.
 *  - Each chest's `contents` is resolved by seeding a fresh PRNG with
 *    `rngSeed + ":chest:" + chestId` and calling `rollLoot(lootTable, rng)`.
 *    Different chests never share a stream — this means swapping a single
 *    chest's `lootTable` in the descriptor doesn't perturb other chests'
 *    contents, which keeps WP15's tuning iterations diff-friendly.
 *  - `evac.revealedAtTurn` initialises to `null` (revealed at turn 30 by
 *    WP7/WP10 per concept-spec §15).
 *  - `corpses[]` initialises to empty (WP7 phase 6 fills it on death).
 *
 * Chest ids: stable coord-encoded ids (`Chest_<x>_<y>`) derived from the
 * descriptor position.
 */
export function expandMap(
  descriptor: MapDescriptor,
  rngSeed: string,
): WorldState {
  const coverTiles: Tile[] = [];
  for (const cluster of descriptor.coverClusters) {
    coverTiles.push(...rectToTiles(cluster));
  }

  const chests: ChestState[] = descriptor.chests.map((c) => {
    const chestId = `Chest_${c.x}_${c.y}`;
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
    coverClusters: descriptor.coverClusters,
    coverTiles,
    chests,
    corpses: [],
    evac,
  };
}

// ─── assignPersonasToSpawns ──────────────────────────────────────────────────

/**
 * Produce a deterministic seeded mapping from personas to spawn slots.
 * Returns a list of `{ personaId, spawnIndex }` of length `personas.length`,
 * where `spawnIndex` is a permutation of `[0..personas.length)`.
 *
 * Algorithm: Fisher–Yates shuffle on `[0..N)` driven by `makeRng(seed +
 * ":spawnAssign")`. The shuffle pairs `personas[i]` with the i-th element
 * of the shuffled index list — i.e., the persona order is preserved and
 * the spawn slot is randomised. (This matches WP10's natural insertion
 * order: it iterates `PERSONA_IDS` and reads `spawnIndex` from the
 * mapping.)
 *
 * Determinism: same `seed` + same `personas` ordering → identical mapping.
 * Different seed → probabilistically different permutation.
 */
export function assignPersonasToSpawns(
  rngSeed: string,
  personas: readonly PersonaId[],
): Array<{ personaId: PersonaId; spawnIndex: number }> {
  const n = personas.length;
  const indices = Array.from({ length: n }, (_, i) => i);
  const rng = makeRng(`${rngSeed}:spawnAssign`);
  // Fisher–Yates shuffle — in-place, unbiased given a uniform rng.
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
