// WP14 — curated map registry + deterministic descriptor expander.
//
// Convex's esbuild-based bundler resolves JSON imports natively, so the
// canonical `maps/*.json` descriptors ship into the deployment via direct
// `import … with { type: "json" }`. tsconfig has
// `resolveJsonModule: true`, so the same import is also valid for vitest
// + tsc.
//
// With fs gone, this module no longer needs the node runtime — there is
// no `"use node";` directive, which means default-runtime Convex
// queries/mutations import these helpers without bundler complaints.
//
// Pure-function module per ADR §1; no Convex imports. Key exports:
//   - `getMapDescriptor(id)`       — return a bundled descriptor (cloned).
//   - `loadReferenceMap()`         — thin default/reference compatibility.
//   - `expandMap(descriptor, seed)`— turn a descriptor into a `WorldState`,
//                                    copying hand-authored crate contents.
//   - `assignItemsToSpawns(seed, items)` — seeded generic spawn permutation.
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
// The `_comment` doc field is stripped at the registry boundary below so
// returned shapes match `MapDescriptor` exactly.
import referenceMapJson from "../../maps/reference.json" with { type: "json" };
import splitBasinMapJson from "../../maps/split-basin.json" with { type: "json" };
import crosswindMapJson from "../../maps/crosswind.json" with { type: "json" };
import marketMazeMapJson from "../../maps/market-maze.json" with { type: "json" };
import faultlineMapJson from "../../maps/faultline.json" with { type: "json" };

// ─── Map registry ────────────────────────────────────────────────────────────

export const DEFAULT_MAP_ID = "reference";

export const MAP_IDS = [
  "reference",
  "split-basin",
  "crosswind",
  "market-maze",
  "faultline",
] as const;

export type MapId = (typeof MAP_IDS)[number];

type RawMapDescriptor = MapDescriptor & { _comment?: string };

const MAP_REGISTRY: Record<MapId, RawMapDescriptor> = {
  reference: referenceMapJson as RawMapDescriptor,
  "split-basin": splitBasinMapJson as RawMapDescriptor,
  crosswind: crosswindMapJson as RawMapDescriptor,
  "market-maze": marketMazeMapJson as RawMapDescriptor,
  faultline: faultlineMapJson as RawMapDescriptor,
};

function isMapId(id: string): id is MapId {
  return (MAP_IDS as readonly string[]).includes(id);
}

function normaliseMapDescriptor(raw: RawMapDescriptor): MapDescriptor {
  const parsed = JSON.parse(JSON.stringify(raw)) as RawMapDescriptor;
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

export function getMapDescriptor(id: string): MapDescriptor {
  if (!isMapId(id)) {
    throw new Error(
      `Unknown map id "${id}". Expected one of: ${MAP_IDS.join(", ")}`,
    );
  }
  return normaliseMapDescriptor(MAP_REGISTRY[id]);
}

/**
 * Return the hand-authored reference map descriptor. The descriptor lives
 * at `maps/reference.json`. Kept as a compatibility wrapper for existing
 * engine callers; all descriptor loading now flows through the registry.
 */
export function loadReferenceMap(): MapDescriptor {
  return getMapDescriptor(DEFAULT_MAP_ID);
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

// ─── Spawn assignment ────────────────────────────────────────────────────────

/**
 * Produce a deterministic seeded mapping from items to spawn slots.
 * Returns a list of `{ item, spawnIndex }` of length `items.length`,
 * where `spawnIndex` is a permutation of `[0..items.length)`.
 *
 * Algorithm: Fisher–Yates shuffle on `[0..N)` driven by `makeRng(seed +
 * ":spawnAssign")`. The shuffle pairs `items[i]` with the i-th element of
 * the shuffled index list, preserving item order while randomising slots.
 *
 * Determinism: same `seed` + same `items` ordering → identical mapping.
 * Different seed → probabilistically different permutation.
 */
export function assignItemsToSpawns<T>(
  rngSeed: string,
  items: readonly T[],
): Array<{ item: T; spawnIndex: number }> {
  const n = items.length;
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
  return items.map((item, i) => ({
    item,
    spawnIndex: indices[i] as number,
  }));
}

export function assignPersonasToSpawns(
  rngSeed: string,
  personas: readonly PersonaId[],
): Array<{ personaId: PersonaId; spawnIndex: number }> {
  return assignItemsToSpawns(rngSeed, personas).map(
    ({ item: personaId, spawnIndex }) => ({
      personaId,
      spawnIndex,
    }),
  );
}
