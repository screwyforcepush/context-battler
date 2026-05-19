// WP3 — pure-function unit tests for the reference map descriptor + expander.
//
// Tests are written FIRST per AOP (Red → Green → Refactor). They exercise:
//   1. Shape: 100x100 WorldState with 8 spawns, walkable spawns.
//   2. Reachability: crates + evac centre reachable from spawns via Chebyshev BFS.
//   3. Deterministic, hand-authored crate contents independent of seed.
//   4. Persona-to-spawn permutation determinism, seed sensitivity, full coverage.
//
// All tests are pure-function (no Convex imports) per ADR §1.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAP_ID,
  MAP_IDS,
  assignItemsToSpawns,
  expandMap,
  getMapDescriptor,
  loadReferenceMap,
  assignPersonasToSpawns,
} from "../../convex/engine/map.js";
import {
  ARMOUR,
  CONSUMABLES,
  PERSONA_IDS,
  WEAPONS,
  type ItemRef,
  type MapDescriptor,
  type Tile,
  type WorldState,
  type Wall,
} from "../../convex/engine/types.js";

// ─── Test helpers ────────────────────────────────────────────────────────────

/** Chebyshev (king-move) distance between two tiles. Inlined per WP3 brief —
 * `convex/engine/distance.ts` is owned by WP5; we must not pre-create it. */
function chebyshev(a: Tile, b: Tile): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** True iff tile (x,y) lies within wall rectangle `wall`. */
function tileInRect(x: number, y: number, wall: Wall): boolean {
  return (
    x >= wall.x &&
    x < wall.x + wall.w &&
    y >= wall.y &&
    y < wall.y + wall.h
  );
}

/** True iff (x,y) is in any wall rectangle. */
function isWall(x: number, y: number, walls: readonly Wall[]): boolean {
  for (const w of walls) {
    if (tileInRect(x, y, w)) return true;
  }
  return false;
}

/** Build a 2D walkable mask for the world. Floor + cover are walkable; walls
 * and out-of-bounds are not. */
function buildWalkable(world: WorldState): boolean[][] {
  const { w, h } = world.size;
  const grid: boolean[][] = [];
  for (let x = 0; x < w; x++) {
    const col: boolean[] = new Array(h).fill(true);
    grid.push(col);
  }
  for (const wall of world.walls) {
    for (let dx = 0; dx < wall.w; dx++) {
      for (let dy = 0; dy < wall.h; dy++) {
        const x = wall.x + dx;
        const y = wall.y + dy;
        if (x >= 0 && x < w && y >= 0 && y < h) {
          // Use non-null assertion: x bounds checked above, columns pre-filled.
          (grid[x] as boolean[])[y] = false;
        }
      }
    }
  }
  return grid;
}

/** Chebyshev BFS reachability from `start` to `target` through walkable tiles. */
function reachable(
  start: Tile,
  target: Tile,
  walkable: boolean[][],
  size: { w: number; h: number },
): boolean {
  if (start.x === target.x && start.y === target.y) return true;
  const startCol = walkable[start.x];
  const targetCol = walkable[target.x];
  if (!startCol || !startCol[start.y]) return false;
  if (!targetCol || !targetCol[target.y]) return false;

  const visited: boolean[][] = [];
  for (let i = 0; i < size.w; i++) {
    visited.push(new Array(size.h).fill(false));
  }
  const queue: Tile[] = [start];
  (visited[start.x] as boolean[])[start.y] = true;
  while (queue.length > 0) {
    const cur = queue.shift() as Tile;
    if (cur.x === target.x && cur.y === target.y) return true;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cur.x + dx;
        const ny = cur.y + dy;
        if (nx < 0 || ny < 0 || nx >= size.w || ny >= size.h) continue;
        const visCol = visited[nx] as boolean[];
        if (visCol[ny]) continue;
        const walkCol = walkable[nx] as boolean[];
        if (!walkCol[ny]) continue;
        visCol[ny] = true;
        queue.push({ x: nx, y: ny });
      }
    }
  }
  return false;
}

const EXPECTED_REFERENCE_CRATES: Array<{
  x: number;
  y: number;
  contents: ItemRef;
}> = [
  { x: 14, y: 14, contents: { category: "armour", name: "cloth" } },
  { x: 85, y: 14, contents: { category: "weapon", name: "dagger" } },
  { x: 14, y: 85, contents: { category: "weapon", name: "rusty_blade" } },
  { x: 85, y: 85, contents: { category: "armour", name: "leather" } },
  { x: 33, y: 33, contents: { category: "weapon", name: "sword" } },
  { x: 66, y: 33, contents: { category: "weapon", name: "axe" } },
  { x: 47, y: 46, contents: { category: "armour", name: "chain" } },
  { x: 49, y: 52, contents: { category: "weapon", name: "sword" } },
  { x: 33, y: 66, contents: { category: "weapon", name: "greatsword" } },
  { x: 66, y: 66, contents: { category: "armour", name: "plate" } },
  { x: 53, y: 54, contents: { category: "weapon", name: "warhammer" } },
  { x: 50, y: 25, contents: { category: "consumable", name: "heal" } },
];

const EXPECTED_REFERENCE_AIRDROPS: Array<{
  x: number;
  y: number;
  landsAtTurn: number;
  contents: ItemRef;
}> = [
  {
    x: 50,
    y: 50,
    landsAtTurn: 10,
    contents: { category: "armour", name: "leather" },
  },
  {
    x: 25,
    y: 75,
    landsAtTurn: 20,
    contents: { category: "weapon", name: "axe" },
  },
  {
    x: 75,
    y: 25,
    landsAtTurn: 30,
    contents: { category: "armour", name: "plate" },
  },
  {
    x: 48,
    y: 48,
    landsAtTurn: 40,
    contents: { category: "weapon", name: "greatsword" },
  },
];

function crateContentsSnapshot(world: WorldState) {
  return world.crates.map((crate) => ({
    id: crate.id,
    pos: crate.pos,
    contents: crate.contents,
    opened: crate.opened,
  }));
}

function coordKey(tile: Tile): string {
  return `${tile.x},${tile.y}`;
}

function assertInBounds(
  tile: Tile,
  size: { w: number; h: number },
  label: string,
): void {
  expect(tile.x, `${label} x out of bounds`).toBeGreaterThanOrEqual(0);
  expect(tile.x, `${label} x out of bounds`).toBeLessThan(size.w);
  expect(tile.y, `${label} y out of bounds`).toBeGreaterThanOrEqual(0);
  expect(tile.y, `${label} y out of bounds`).toBeLessThan(size.h);
}

function assertRectInBounds(
  rect: Wall,
  size: { w: number; h: number },
  label: string,
): void {
  expect(rect.w, `${label} width must be positive`).toBeGreaterThan(0);
  expect(rect.h, `${label} height must be positive`).toBeGreaterThan(0);
  assertInBounds({ x: rect.x, y: rect.y }, size, `${label} origin`);
  expect(rect.x + rect.w, `${label} right edge out of bounds`).toBeLessThanOrEqual(
    size.w,
  );
  expect(rect.y + rect.h, `${label} bottom edge out of bounds`).toBeLessThanOrEqual(
    size.h,
  );
}

function isLockedItemRef(item: ItemRef): boolean {
  switch (item.category) {
    case "weapon":
      return Object.prototype.hasOwnProperty.call(WEAPONS, item.name);
    case "armour":
      return Object.prototype.hasOwnProperty.call(ARMOUR, item.name);
    case "consumable":
      return Object.prototype.hasOwnProperty.call(CONSUMABLES, item.name);
  }
}

function topologySignature(descriptor: MapDescriptor): string {
  return JSON.stringify({
    size: descriptor.size,
    walls: descriptor.walls,
    coverClusters: descriptor.coverClusters,
    spawns: descriptor.spawns,
    evac: descriptor.evac,
    crates: descriptor.crates.map(({ x, y }) => ({ x, y })),
    airdrops: descriptor.airdrops.map(({ x, y, landsAtTurn }) => ({
      x,
      y,
      landsAtTurn,
    })),
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("WP14 — map registry", () => {
  it("pins the forward-only curated map id set and default", () => {
    expect(DEFAULT_MAP_ID).toBe("reference");
    expect(MAP_IDS).toEqual([
      "reference",
      "split-basin",
      "crosswind",
      "market-maze",
      "faultline",
    ]);
  });

  it("loads the reference descriptor through the same normalised registry path", () => {
    expect(getMapDescriptor("reference")).toEqual(loadReferenceMap());
  });

  it("returns mutate-safe descriptors and strips JSON-only _comment fields", () => {
    const first = getMapDescriptor("reference");
    const second = getMapDescriptor("reference");

    expect(first).not.toBe(second);
    expect("_comment" in first).toBe(false);
    first.size.w = 1;
    expect(second.size.w).toBe(100);
    expect(getMapDescriptor("reference").size.w).toBe(100);
  });

  it("throws a clear error for unknown map ids", () => {
    expect(() => getMapDescriptor("missing-map")).toThrow(
      'Unknown map id "missing-map"',
    );
  });

  it("keeps generic item-to-spawn assignment byte-aligned with persona assignment", () => {
    const seed = "phase14-spawn-assignment";

    expect(assignItemsToSpawns(seed, PERSONA_IDS)).toEqual(
      assignPersonasToSpawns(seed, PERSONA_IDS).map(
        ({ personaId: item, spawnIndex }) => ({ item, spawnIndex }),
      ),
    );
  });
});

describe("WP14 — all registered map descriptors satisfy structural invariants", () => {
  it.each(MAP_IDS)("%s is a valid 100x100 descriptor", (mapId) => {
    const descriptor = getMapDescriptor(mapId);
    const world = expandMap(descriptor, "phase14-validity");

    expect(descriptor.size).toEqual({ w: 100, h: 100 });
    expect(world.size).toEqual(descriptor.size);
    expect(descriptor.crates.length, `${mapId} must include static crates`).toBeGreaterThan(0);
    expect(descriptor.airdrops, `${mapId} must include four airdrop waves`).toHaveLength(4);

    descriptor.walls.forEach((wall, i) => {
      assertRectInBounds(wall, descriptor.size, `${mapId} wall ${i}`);
    });
    descriptor.coverClusters.forEach((cover, i) => {
      assertRectInBounds(cover, descriptor.size, `${mapId} cover ${i}`);
    });

    expect(descriptor.spawns).toHaveLength(8);
    const spawnCoords = new Set<string>();
    descriptor.spawns.forEach((spawn, i) => {
      assertInBounds(spawn, descriptor.size, `${mapId} spawn ${i}`);
      expect(
        isWall(spawn.x, spawn.y, descriptor.walls),
        `${mapId} spawn ${i} is inside a wall`,
      ).toBe(false);
      spawnCoords.add(coordKey(spawn));
    });
    expect(spawnCoords.size).toBe(8);
  });

  it.each(MAP_IDS)("%s has reachable crates and evac", (mapId) => {
    const descriptor = getMapDescriptor(mapId);
    const world = expandMap(descriptor, "phase14-reachability");
    const walkable = buildWalkable(world);

    for (const crate of world.crates) {
      assertInBounds(crate.pos, world.size, `${mapId} crate ${crate.id}`);
      const reachableFromAny = descriptor.spawns.some((spawn) =>
        reachable(spawn, crate.pos, walkable, world.size),
      );
      expect(
        reachableFromAny,
        `${mapId} crate ${crate.id} at (${crate.pos.x},${crate.pos.y}) ` +
          "is unreachable from every spawn",
      ).toBe(true);
    }

    assertInBounds(world.evac.centre, world.size, `${mapId} evac`);
    for (let i = 0; i < descriptor.spawns.length; i++) {
      const spawn = descriptor.spawns[i] as Tile;
      const ok = reachable(spawn, world.evac.centre, walkable, world.size);
      expect(
        ok,
        `${mapId} spawn ${i} at (${spawn.x},${spawn.y}) cannot reach evac ` +
          `at (${world.evac.centre.x},${world.evac.centre.y})`,
      ).toBe(true);
    }
  });

  it.each(MAP_IDS)("%s has valid crate and airdrop identities", (mapId) => {
    const descriptor = getMapDescriptor(mapId);
    const world = expandMap(descriptor, "phase14-crate-airdrop-validity");
    const staticCrateCoords = new Set<string>();

    for (const crate of world.crates) {
      const key = coordKey(crate.pos);
      expect(
        staticCrateCoords.has(key),
        `${mapId} has duplicate static crate coordinate ${key}`,
      ).toBe(false);
      staticCrateCoords.add(key);
      expect(crate.id).toBe(`Crate_${crate.pos.x}_${crate.pos.y}`);
      if (crate.contents === null) {
        throw new Error(`${mapId} ${crate.id} has null initial contents`);
      }
      expect(isLockedItemRef(crate.contents)).toBe(true);
    }

    for (const drop of world.airdrops) {
      const key = coordKey(drop.pos);
      assertInBounds(drop.pos, world.size, `${mapId} airdrop ${drop.id}`);
      expect(
        staticCrateCoords.has(key),
        `${mapId} ${drop.id} collides with a static crate`,
      ).toBe(false);
      expect(
        isWall(drop.pos.x, drop.pos.y, world.walls),
        `${mapId} ${drop.id} lands inside a wall`,
      ).toBe(false);
      expect(drop.id).toBe(`Crate_${drop.pos.x}_${drop.pos.y}`);
      expect(Number.isInteger(drop.landsAtTurn)).toBe(true);
      expect(drop.landsAtTurn).toBeGreaterThan(0);
      expect(drop.landsAtTurn).toBeLessThan(50);
      expect(isLockedItemRef(drop.contents)).toBe(true);
    }
  });

  it.each(MAP_IDS)("%s expands deterministically and seed-independently", (mapId) => {
    const descriptor = getMapDescriptor(mapId);
    const seedA = expandMap(descriptor, "phase14-seed-a");
    const seedARepeat = expandMap(getMapDescriptor(mapId), "phase14-seed-a");
    const seedB = expandMap(getMapDescriptor(mapId), "phase14-seed-b");

    expect(seedA).toEqual(seedARepeat);
    expect(seedA).toEqual(seedB);
  });

  it("keeps every registered topology structurally distinct", () => {
    const signatures = MAP_IDS.map((mapId) =>
      topologySignature(getMapDescriptor(mapId)),
    );

    expect(new Set(signatures).size).toBe(MAP_IDS.length);
  });
});

describe("WP3 — expandMap returns a valid 100x100 WorldState", () => {
  it("Test 1: WorldState has size.w === 100 && size.h === 100", () => {
    const descriptor = loadReferenceMap();
    const world = expandMap(descriptor, "seed1");
    expect(world.size.w).toBe(100);
    expect(world.size.h).toBe(100);
  });

  it("Phase 9 WP-A: preserves descriptor coverClusters alongside coverTiles", () => {
    const descriptor = loadReferenceMap();
    const world = expandMap(descriptor, "seed1");

    expect(world.coverClusters).toEqual(descriptor.coverClusters);
    const expandedTileCount = descriptor.coverClusters.reduce(
      (sum, cluster) => sum + cluster.w * cluster.h,
      0,
    );
    expect(world.coverTiles).toHaveLength(expandedTileCount);
  });

  it("Test 2: exactly 8 spawn points, all on walkable floor (not in wall rectangles)", () => {
    const descriptor = loadReferenceMap();
    expect(descriptor.spawns.length).toBe(8);
    for (const spawn of descriptor.spawns) {
      // Bounds check.
      expect(spawn.x).toBeGreaterThanOrEqual(0);
      expect(spawn.x).toBeLessThan(100);
      expect(spawn.y).toBeGreaterThanOrEqual(0);
      expect(spawn.y).toBeLessThan(100);
      // Not inside any wall rectangle.
      expect(isWall(spawn.x, spawn.y, descriptor.walls)).toBe(false);
    }
  });

  it("Test 3: all crates reachable from at least one spawn via Chebyshev BFS", () => {
    const descriptor = loadReferenceMap();
    const world = expandMap(descriptor, "seed1");
    const walkable = buildWalkable(world);
    for (const crate of world.crates) {
      const reachableFromAny = descriptor.spawns.some((spawn) =>
        reachable(spawn, crate.pos, walkable, world.size),
      );
      expect(
        reachableFromAny,
        `crate ${crate.id} at (${crate.pos.x},${crate.pos.y}) is unreachable from every spawn`,
      ).toBe(true);
    }
  });

  it("Test 3c: crate ids are coord-encoded from their expanded position", () => {
    const descriptor = loadReferenceMap();
    const world = expandMap(descriptor, "seed1");

    for (const crate of world.crates) {
      expect(crate.id).toBe(`Crate_${crate.pos.x}_${crate.pos.y}`);
    }
  });

  it("Test 4: evac centre reachable from all 8 spawns", () => {
    const descriptor = loadReferenceMap();
    const world = expandMap(descriptor, "seed1");
    const walkable = buildWalkable(world);
    for (let i = 0; i < descriptor.spawns.length; i++) {
      const spawn = descriptor.spawns[i] as Tile;
      const ok = reachable(spawn, world.evac.centre, walkable, world.size);
      expect(
        ok,
        `spawn ${i} at (${spawn.x},${spawn.y}) cannot reach evac at (${world.evac.centre.x},${world.evac.centre.y})`,
      ).toBe(true);
    }
  });

  // Inline a tiny chebyshev helper test to keep the import lint-clean
  // (the BFS uses absolute-difference math; chebyshev() is referenced for the
  //  comment-block contract — keep it exercised so static analysis doesn't
  //  drop the helper).
  it("Test 3b: chebyshev helper sanity (used for reachability discussion)", () => {
    expect(chebyshev({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(0);
    expect(chebyshev({ x: 0, y: 0 }, { x: 7, y: 3 })).toBe(7);
    expect(chebyshev({ x: 5, y: 5 }, { x: 2, y: 8 })).toBe(3);
  });
});

describe("WP3/WP-B — deterministic hand-authored crate contents", () => {
  it("Test 5: same rngSeed produces identical WorldState on repeat call", () => {
    const descriptor = loadReferenceMap();
    const a = expandMap(descriptor, "seed1");
    const b = expandMap(descriptor, "seed1");
    expect(a).toEqual(b);
  });

  it("WP-B: reference descriptor has the pinned 12 contents entries and no lootTable", () => {
    const descriptor = loadReferenceMap();

    expect(descriptor.crates).toEqual(EXPECTED_REFERENCE_CRATES);
    for (const crate of descriptor.crates) {
      expect(Object.keys(crate).sort()).toEqual(["contents", "x", "y"]);
    }
  });

  it("WP-B: expandMap crate contents are seed-independent", () => {
    const descriptor = loadReferenceMap();
    const a = expandMap(descriptor, "seed1");
    const b = expandMap(descriptor, "seed2");

    expect(a).toEqual(b);
    expect(crateContentsSnapshot(a)).toEqual(
      EXPECTED_REFERENCE_CRATES.map((crate) => ({
        id: `Crate_${crate.x}_${crate.y}`,
        pos: { x: crate.x, y: crate.y },
        contents: crate.contents,
        opened: false,
      })),
    );
    for (const crate of a.crates) {
      expect(Object.keys(crate).sort()).toEqual([
        "contents",
        "id",
        "opened",
        "pos",
      ]);
    }
  });

  it("WP-C: reference descriptor pins the four deterministic airdrop waves", () => {
    const descriptor = loadReferenceMap();

    expect(descriptor.airdrops).toEqual(EXPECTED_REFERENCE_AIRDROPS);
    for (const drop of descriptor.airdrops) {
      expect(Object.keys(drop).sort()).toEqual([
        "contents",
        "landsAtTurn",
        "x",
        "y",
      ]);
    }
  });

  it("WP-C: expandMap carries deterministic reference airdrops", () => {
    const descriptor = loadReferenceMap();
    const engineWorld = expandMap(descriptor, "seed1");

    expect(engineWorld.airdrops).toEqual(
      EXPECTED_REFERENCE_AIRDROPS.map((drop) => ({
        id: `Crate_${drop.x}_${drop.y}`,
        pos: { x: drop.x, y: drop.y },
        landsAtTurn: drop.landsAtTurn,
        contents: drop.contents,
        looted: false,
      })),
    );
  });

  it("WP-C: airdrop coordinates avoid walls and static crate coordinates", () => {
    const descriptor = loadReferenceMap();
    const world = expandMap(descriptor, "seed1");
    const staticCrateCoords = new Set(
      world.crates.map((crate) => `${crate.pos.x},${crate.pos.y}`),
    );

    for (const drop of world.airdrops) {
      const key = `${drop.pos.x},${drop.pos.y}`;
      expect(staticCrateCoords.has(key), `${drop.id} collides with a static crate`).toBe(
        false,
      );
      expect(
        isWall(drop.pos.x, drop.pos.y, world.walls),
        `${drop.id} lands inside a wall`,
      ).toBe(false);
    }
  });
});

describe("WP3 — assignPersonasToSpawns (seeded permutation)", () => {
  it("Test 7a: same seed → identical persona-to-spawn mapping", () => {
    const a = assignPersonasToSpawns("seed1", PERSONA_IDS);
    const b = assignPersonasToSpawns("seed1", PERSONA_IDS);
    expect(a).toEqual(b);
  });

  it("Test 7b: different seeds → at least one slot differs", () => {
    const a = assignPersonasToSpawns("seed1", PERSONA_IDS);
    const b = assignPersonasToSpawns("seed2", PERSONA_IDS);
    let differs = false;
    for (let i = 0; i < a.length; i++) {
      const ai = a[i];
      const bi = b[i];
      if (!ai || !bi) continue;
      if (ai.spawnIndex !== bi.spawnIndex) {
        differs = true;
        break;
      }
    }
    expect(
      differs,
      "two distinct seeds produced an identical permutation — seed plumbing broken",
    ).toBe(true);
  });

  it("Test 8: spawnIndex coverage — all 8 indices present exactly once", () => {
    const result = assignPersonasToSpawns("seed1", PERSONA_IDS);
    expect(result.length).toBe(8);
    const indices = result.map((r) => r.spawnIndex).sort((x, y) => x - y);
    expect(indices).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    // PersonaId coverage: each of the 8 ids appears exactly once.
    const personas = result.map((r) => r.personaId).sort();
    expect(personas).toEqual([...PERSONA_IDS].sort());
  });
});
