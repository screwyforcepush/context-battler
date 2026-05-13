// WP3 — pure-function unit tests for the reference map descriptor + expander.
//
// Tests are written FIRST per AOP (Red → Green → Refactor). They exercise:
//   1. Shape: 100x100 WorldState with 8 spawns, walkable spawns.
//   2. Reachability: chests + evac centre reachable from spawns via Chebyshev BFS.
//   3. Determinism + seed sensitivity for chest content rolls.
//   4. Persona-to-spawn permutation determinism, seed sensitivity, full coverage.
//
// All tests are pure-function (no Convex imports) per ADR §1.

import { describe, expect, it } from "vitest";
import {
  expandMap,
  loadReferenceMap,
  assignPersonasToSpawns,
} from "../../convex/engine/map.js";
import {
  PERSONA_IDS,
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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("WP3 — expandMap returns a valid 100x100 WorldState", () => {
  it("Test 1: WorldState has size.w === 100 && size.h === 100", () => {
    const descriptor = loadReferenceMap();
    const world = expandMap(descriptor, "seed1");
    expect(world.size.w).toBe(100);
    expect(world.size.h).toBe(100);
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

  it("Test 3: all chests reachable from at least one spawn via Chebyshev BFS", () => {
    const descriptor = loadReferenceMap();
    const world = expandMap(descriptor, "seed1");
    const walkable = buildWalkable(world);
    for (const chest of world.chests) {
      const reachableFromAny = descriptor.spawns.some((spawn) =>
        reachable(spawn, chest.pos, walkable, world.size),
      );
      expect(
        reachableFromAny,
        `chest ${chest.id} at (${chest.pos.x},${chest.pos.y}) is unreachable from every spawn`,
      ).toBe(true);
    }
  });

  it("Test 3c: chest ids are coord-encoded from their expanded position", () => {
    const descriptor = loadReferenceMap();
    const world = expandMap(descriptor, "seed1");

    for (const chest of world.chests) {
      expect(chest.id).toBe(`Chest_${chest.pos.x}_${chest.pos.y}`);
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

describe("WP3 — chest content determinism + seed sensitivity", () => {
  it("Test 5: same rngSeed produces identical WorldState on repeat call", () => {
    const descriptor = loadReferenceMap();
    const a = expandMap(descriptor, "seed1");
    const b = expandMap(descriptor, "seed1");
    expect(a).toEqual(b);
  });

  it("Test 6: different rngSeed produces at least one different chest content", () => {
    const descriptor = loadReferenceMap();
    const a = expandMap(descriptor, "seed1");
    const b = expandMap(descriptor, "seed2");
    expect(a.chests.length).toBe(b.chests.length);
    expect(a.chests.length).toBeGreaterThan(0);
    let differs = false;
    for (let i = 0; i < a.chests.length; i++) {
      const ca = a.chests[i];
      const cb = b.chests[i];
      if (!ca || !cb) continue;
      if (JSON.stringify(ca.contents) !== JSON.stringify(cb.contents)) {
        differs = true;
        break;
      }
    }
    expect(
      differs,
      "different seeds produced byte-identical chest contents — seed plumbing is broken",
    ).toBe(true);
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
