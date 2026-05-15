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
//                                    copying hand-authored crate contents.
//   - `assignPersonasToSpawns(seed, personas)` — seeded permutation that
//                                    pairs each persona with a unique
//                                    spawnIndex ∈ [0, personas.length).
//
// Determinism contract (tested in `tests/engine/map.test.ts`):
//   `expandMap(d, "x")` deep-equals itself across calls.
//   `expandMap(d, "x")` deep-equals `expandMap(d, "y")` for crate contents.
//
// PRNG:
//   - `makeRng` is xmur3 + mulberry32 (re-exported from `loot.ts`).
//   - Persona-spawn seed: `rngSeed + ":spawnAssign"` so it doesn't collide
//     with future deterministic streams.

import {
  type AirdropState,
  type CrateState,
  type EvacZone,
  type MapDescriptor,
  type PersonaId,
  type Tile,
  type WorldState,
  type Wall,
} from "./types.js";
import { makeRng } from "./loot.js";
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
    crates: parsed.crates,
    airdrops: parsed.airdrops,
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
 * Turn a `MapDescriptor` into a `WorldState`.
 *
 * Per ADR §5/§6:
 *  - `walls` are passed through unchanged (terrain is static).
 *  - `coverClusters` are unrolled into `coverTiles[]`.
 *  - Each crate's `contents` is copied from the hand-authored descriptor.
 *  - `evac.revealedAtTurn` initialises to `null` (revealed at turn 30 by
 *    WP7/WP10 per concept-spec §15).
 *  - `corpses[]` initialises to empty (WP7 phase 6 fills it on death).
 *
 * Crate ids: stable coord-encoded ids (`Crate_<x>_<y>`) derived from the
 * descriptor position.
 */
export function expandMap(
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
