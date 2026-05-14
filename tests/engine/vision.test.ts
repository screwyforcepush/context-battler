// WP5 — pure-function unit tests for vision (LOS + visible-entity computation).
//
// Tests are written FIRST per AOP. Spec sections: concept-spec.md §7 (vision,
// line of sight, hiding) and §4 (Chebyshev distance — vision uses 20-tile cap).
//
// All tests synthesise a `MatchState` inline; we never depend on the
// reference map for LOS-shape correctness.

import { describe, expect, it } from "vitest";
import {
  hasLineOfSight,
  computeVisibleEntities,
} from "../../convex/engine/vision.js";
import type {
  CharacterState,
  MatchState,
  PersonaId,
  Tile,
  VisibleEntity,
  Wall,
  WorldState,
} from "../../convex/engine/types.js";

// ─── Test fixture builders ──────────────────────────────────────────────────

function makeWorld(overrides: Partial<WorldState> = {}): WorldState {
  return {
    size: { w: 100, h: 100 },
    walls: [],
    coverClusters: [],
    coverTiles: [],
    chests: [],
    corpses: [],
    evac: { centre: { x: 50, y: 50 }, revealedAtTurn: null },
    ...overrides,
  };
}

function makeCharacter(opts: {
  id: string;
  pos: Tile;
  hp?: number;
  maxHp?: number;
  hidden?: boolean;
  alive?: boolean;
  weapon?: "rusty_blade" | "sword" | "axe" | "greatsword";
  personaId?: PersonaId;
}): CharacterState {
  return {
    characterId: opts.id,
    personaId: opts.personaId ?? "rat",
    spawnIndex: 0,
    displayName: opts.id,
    hp: opts.hp ?? 100,
    maxHp: opts.maxHp ?? 100,
    pos: opts.pos,
    equipped: opts.weapon
      ? { weapon: { category: "weapon", name: opts.weapon } }
      : {},
    scratchpad: "",
    hidden: opts.hidden ?? false,
    alive: opts.alive ?? true,
    lastKnown: [],
  };
}

function makeState(opts: {
  characters: CharacterState[];
  world?: Partial<WorldState>;
}): MatchState {
  return {
    matchId: "test-match",
    turn: 1,
    world: makeWorld(opts.world),
    characters: opts.characters,
    rngSeed: "test",
  };
}

function findVisible(
  visible: VisibleEntity[],
  predicate: (v: VisibleEntity) => boolean,
): VisibleEntity | undefined {
  return visible.find(predicate);
}

// ─── hasLineOfSight ────────────────────────────────────────────────────────

describe("WP5 — hasLineOfSight (concept-spec §7)", () => {
  it("§7 — clear LOS up to 20 tiles in a wall-free world", () => {
    const world = makeWorld();
    expect(hasLineOfSight(world, { x: 0, y: 0 }, { x: 20, y: 0 })).toBe(true);
    expect(hasLineOfSight(world, { x: 5, y: 5 }, { x: 25, y: 25 })).toBe(true);
  });

  it("§7 — wall blocks LOS (Bresenham line through wall returns blocked)", () => {
    // A 1-tile-wide wall at x=5, y=0..9 sits directly on the line from
    // (0,0) to (10,0). The Bresenham line goes through (5,0) which is
    // inside the wall → LOS blocked.
    const wall: Wall = { x: 5, y: 0, w: 1, h: 10 };
    const world = makeWorld({ walls: [wall] });
    expect(hasLineOfSight(world, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(false);
    // From the other side — symmetric.
    expect(hasLineOfSight(world, { x: 10, y: 0 }, { x: 0, y: 0 })).toBe(false);
  });

  it("§7 — wall to the side does not block LOS", () => {
    const wall: Wall = { x: 5, y: 50, w: 1, h: 10 };
    const world = makeWorld({ walls: [wall] });
    // Line (0,0)→(10,0) does not pass through y=50..59.
    expect(hasLineOfSight(world, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(true);
  });

  it("§7 — endpoints inside wall do not count as blockers (LOS depends on tiles between)", () => {
    // We only block if a tile *between* from and to is inside a wall. The
    // endpoints themselves are the observer and the target; if the target
    // is on a wall tile, the caller decides what to do with that.
    const wall: Wall = { x: 10, y: 0, w: 1, h: 1 };
    const world = makeWorld({ walls: [wall] });
    // Adjacent tile pair, target on wall: nothing between → LOS true.
    expect(hasLineOfSight(world, { x: 9, y: 0 }, { x: 10, y: 0 })).toBe(true);
  });
});

// ─── computeVisibleEntities ────────────────────────────────────────────────

describe("WP5 — computeVisibleEntities (concept-spec §7)", () => {
  it("§7 — vision distance cap at 20 tiles (target at 21 not visible)", () => {
    const observer = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const inRange = makeCharacter({ id: "B", pos: { x: 20, y: 0 } });
    const outOfRange = makeCharacter({ id: "C", pos: { x: 21, y: 0 } });
    const state = makeState({ characters: [observer, inRange, outOfRange] });
    const { visible } = computeVisibleEntities(state, "A");
    const ids = visible
      .filter((v) => v.kind === "character")
      .map((v) => v.kind === "character" && v.characterId);
    expect(ids).toContain("B");
    expect(ids).not.toContain("C");
  });

  it("§7 — wall blocks LOS to a character behind it", () => {
    const observer = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const target = makeCharacter({ id: "B", pos: { x: 10, y: 0 } });
    const wall: Wall = { x: 5, y: 0, w: 1, h: 1 };
    const state = makeState({
      characters: [observer, target],
      world: { walls: [wall] },
    });
    const { visible } = computeVisibleEntities(state, "A");
    const charsVisible = visible.filter((v) => v.kind === "character");
    expect(charsVisible.length).toBe(0);
  });

  it("§7 — hidden enemy is excluded from visible", () => {
    const observer = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const hidden = makeCharacter({
      id: "B",
      pos: { x: 5, y: 0 },
      hidden: true,
    });
    const visibleEnemy = makeCharacter({ id: "C", pos: { x: 7, y: 0 } });
    const state = makeState({ characters: [observer, hidden, visibleEnemy] });
    const { visible } = computeVisibleEntities(state, "A");
    const ids = visible
      .filter((v) => v.kind === "character")
      .map((v) => v.kind === "character" && v.characterId);
    expect(ids).not.toContain("B");
    expect(ids).toContain("C");
  });

  it("§7 — visible character includes equipped weapon name", () => {
    const observer = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const armed = makeCharacter({
      id: "B",
      pos: { x: 5, y: 0 },
      weapon: "axe",
    });
    const unarmed = makeCharacter({ id: "C", pos: { x: 7, y: 0 } });
    const state = makeState({ characters: [observer, armed, unarmed] });
    const { visible } = computeVisibleEntities(state, "A");
    const armedEntry = findVisible(
      visible,
      (v) => v.kind === "character" && v.characterId === "B",
    );
    expect(armedEntry?.kind).toBe("character");
    if (armedEntry?.kind === "character") {
      expect(armedEntry.weapon).toBe("axe");
    }
    const unarmedEntry = findVisible(
      visible,
      (v) => v.kind === "character" && v.characterId === "C",
    );
    if (unarmedEntry?.kind === "character") {
      expect(unarmedEntry.weapon).toBeUndefined();
    }
  });

  it("§7 — hpBucket is low/mid/high per the thresholds (≤0.33/≤0.66/else)", () => {
    const observer = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    // hp/max = 0.33 → "low" (boundary inclusive)
    const lowExact = makeCharacter({
      id: "L",
      pos: { x: 5, y: 0 },
      hp: 33,
      maxHp: 100,
    });
    // hp/max = 0.50 → "mid"
    const mid = makeCharacter({
      id: "M",
      pos: { x: 6, y: 0 },
      hp: 50,
      maxHp: 100,
    });
    // hp/max = 0.66 → "mid" (boundary inclusive)
    const midExact = makeCharacter({
      id: "M2",
      pos: { x: 7, y: 0 },
      hp: 66,
      maxHp: 100,
    });
    // hp/max = 1.0 → "high"
    const high = makeCharacter({
      id: "H",
      pos: { x: 8, y: 0 },
      hp: 100,
      maxHp: 100,
    });
    const state = makeState({
      characters: [observer, lowExact, mid, midExact, high],
    });
    const { visible } = computeVisibleEntities(state, "A");
    const buckets: Record<string, "low" | "mid" | "high"> = {};
    for (const v of visible) {
      if (v.kind === "character") buckets[v.characterId] = v.hpBucket;
    }
    expect(buckets["L"]).toBe("low");
    expect(buckets["M"]).toBe("mid");
    expect(buckets["M2"]).toBe("mid");
    expect(buckets["H"]).toBe("high");
  });

  it("Phase 9 WP-A — chests, corpses, characters stay point-keyed; cover emits as a rect", () => {
    const observer = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const target = makeCharacter({ id: "B", pos: { x: 2, y: 0 } });
    const chest = {
      id: "Chest_4_0",
      pos: { x: 4, y: 0 },
      contents: null,
      opened: false,
      lootTable: "starter",
    };
    const corpse = {
      characterId: "X",
      pos: { x: 6, y: 0 },
      contents: {},
    };
    const coverCluster: Wall = { x: 8, y: 0, w: 2, h: 2 };
    const state = makeState({
      characters: [observer, target],
      world: {
        chests: [chest],
        corpses: [corpse],
        coverClusters: [coverCluster],
        coverTiles: [
          { x: 8, y: 0 },
          { x: 8, y: 1 },
          { x: 9, y: 0 },
          { x: 9, y: 1 },
        ],
      },
    });
    const { visible } = computeVisibleEntities(state, "A");
    expect(visible).toContainEqual(
      expect.objectContaining({ kind: "character", characterId: "B" }),
    );
    expect(visible).toContainEqual(
      expect.objectContaining({ kind: "chest", objectId: "Chest_4_0" }),
    );
    expect(visible).toContainEqual(
      expect.objectContaining({ kind: "corpse", objectId: "X" }),
    );
    expect(visible).toContainEqual({
      kind: "cover_rect",
      rect: coverCluster,
      shape: "patch",
    });
    expect(visible.map((v) => v.kind)).not.toContain("cover");
  });

  it("Phase 9 WP-A — chest, corpse, character, and cover are still LOS-gated by walls", () => {
    const observer = makeCharacter({ id: "A", pos: { x: 10, y: 10 } });
    const occluded = makeCharacter({ id: "B", pos: { x: 3, y: 10 } });
    const blocker: Wall = { x: 5, y: 8, w: 1, h: 5 };
    const coverCluster: Wall = { x: 3, y: 8, w: 1, h: 5 };
    const state = makeState({
      characters: [observer, occluded],
      world: {
        walls: [blocker],
        chests: [
          {
            id: "Chest_3_10",
            pos: { x: 3, y: 10 },
            contents: null,
            opened: false,
            lootTable: "starter",
          },
        ],
        corpses: [{ characterId: "X", pos: { x: 3, y: 11 }, contents: {} }],
        coverClusters: [coverCluster],
        coverTiles: [
          { x: 3, y: 8 },
          { x: 3, y: 9 },
          { x: 3, y: 10 },
          { x: 3, y: 11 },
          { x: 3, y: 12 },
        ],
      },
    });

    const { visible } = computeVisibleEntities(state, "A");
    expect(
      visible.some((v) => v.kind === "character" && v.characterId === "B"),
    ).toBe(false);
    expect(visible.some((v) => v.kind === "chest")).toBe(false);
    expect(visible.some((v) => v.kind === "corpse")).toBe(false);
    expect(visible.some((v) => v.kind === "cover_rect")).toBe(false);
  });

  it("§7 — does not include the observer itself in visible characters", () => {
    const observer = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const state = makeState({ characters: [observer] });
    const { visible } = computeVisibleEntities(state, "A");
    const ids = visible
      .filter((v) => v.kind === "character")
      .map((v) => v.kind === "character" && v.characterId);
    expect(ids).not.toContain("A");
  });

  it("§7 — dead characters are excluded from visible", () => {
    const observer = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const dead = makeCharacter({
      id: "B",
      pos: { x: 5, y: 0 },
      alive: false,
    });
    const state = makeState({ characters: [observer, dead] });
    const { visible } = computeVisibleEntities(state, "A");
    const ids = visible
      .filter((v) => v.kind === "character")
      .map((v) => v.kind === "character" && v.characterId);
    expect(ids).not.toContain("B");
  });
});

// ─── Phase 9 WP-A — rect-grained walls / cover / evac ─────────────────────

describe("Phase 9 WP-A — rect-grained vision substrate", () => {
  it("emits one wall_rect for a single-tile wall within LOS", () => {
    const observer = makeCharacter({ id: "A", pos: { x: 10, y: 10 } });
    // 1×1 wall at (12, 10) — distance 2 from observer.
    const wall: Wall = { x: 12, y: 10, w: 1, h: 1 };
    const state = makeState({
      characters: [observer],
      world: { walls: [wall] },
    });
    const { visible } = computeVisibleEntities(state, "A");
    const walls = visible.filter((v) => v.kind === "wall_rect");
    expect(walls).toHaveLength(1);
    expect(walls[0]).toEqual({
      kind: "wall_rect",
      rect: wall,
      shape: "single",
    });
    expect(visible.map((v) => v.kind)).not.toContain("wall");
  });

  it("emits one rect entry, not one entry per tile, for a multi-tile wall", () => {
    const observer = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    // 3-wide × 2-tall wall starting at (5,5) — covers tiles
    // (5,5) (6,5) (7,5) (5,6) (6,6) (7,6) → 6 tiles.
    const wall: Wall = { x: 5, y: 5, w: 3, h: 2 };
    const state = makeState({
      characters: [observer],
      world: { walls: [wall] },
    });
    const { visible } = computeVisibleEntities(state, "A");
    const walls = visible.filter((v) => v.kind === "wall_rect");
    expect(walls).toEqual([{ kind: "wall_rect", rect: wall, shape: "patch" }]);
  });

  it("applies the Chebyshev 20 cap to wall rects by nearest tile", () => {
    const observer = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    // In-range wall at (20, 0) — Chebyshev 20.
    const inRange: Wall = { x: 20, y: 0, w: 1, h: 1 };
    // Out-of-range wall at (21, 0) — Chebyshev 21.
    const outOfRange: Wall = { x: 21, y: 0, w: 1, h: 1 };
    const state = makeState({
      characters: [observer],
      world: { walls: [inRange, outOfRange] },
    });
    const { visible } = computeVisibleEntities(state, "A");
    const walls = visible.filter((v) => v.kind === "wall_rect");
    expect(walls).toHaveLength(1);
    expect(walls[0]).toEqual({
      kind: "wall_rect",
      rect: inRange,
      shape: "single",
    });
  });

  it("does not emit a wall hidden behind another wall", () => {
    const observer = makeCharacter({ id: "A", pos: { x: 10, y: 10 } });
    const visibleWall: Wall = { x: 5, y: 10, w: 1, h: 1 };
    const occludedWall: Wall = { x: 3, y: 10, w: 1, h: 1 };
    const state = makeState({
      characters: [observer],
      world: { walls: [visibleWall, occludedWall] },
    });
    const { visible } = computeVisibleEntities(state, "A");
    expect(visible).toContainEqual({
      kind: "wall_rect",
      rect: visibleWall,
      shape: "single",
    });
    expect(visible).not.toContainEqual({
      kind: "wall_rect",
      rect: occludedWall,
      shape: "single",
    });
  });

  it("does not emit a fully occluded multi-tile wall rect", () => {
    const observer = makeCharacter({ id: "A", pos: { x: 10, y: 10 } });
    const visibleWall: Wall = { x: 5, y: 8, w: 1, h: 5 };
    const occludedWall: Wall = { x: 3, y: 8, w: 1, h: 5 };
    const state = makeState({
      characters: [observer],
      world: { walls: [visibleWall, occludedWall] },
    });

    const { visible } = computeVisibleEntities(state, "A");
    expect(visible).toContainEqual({
      kind: "wall_rect",
      rect: visibleWall,
      shape: "N-S line",
    });
    expect(visible).not.toContainEqual({
      kind: "wall_rect",
      rect: occludedWall,
      shape: "N-S line",
    });
  });

  it("emits the whole wall rect when at least one tile has LOS", () => {
    const observer = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const blocker: Wall = { x: 2, y: 0, w: 1, h: 1 };
    const partiallyVisibleWall: Wall = { x: 4, y: 0, w: 2, h: 3 };
    const state = makeState({
      characters: [observer],
      world: { walls: [blocker, partiallyVisibleWall] },
    });

    expect(hasLineOfSight(state.world, observer.pos, { x: 4, y: 0 })).toBe(
      false,
    );
    expect(hasLineOfSight(state.world, observer.pos, { x: 4, y: 2 })).toBe(
      true,
    );
    const { visible } = computeVisibleEntities(state, "A");
    expect(visible).toContainEqual({
      kind: "wall_rect",
      rect: blocker,
      shape: "single",
    });
    expect(visible).toContainEqual({
      kind: "wall_rect",
      rect: partiallyVisibleWall,
      shape: "patch",
    });
  });

  it("self-LOS regression: an adjacent multi-tile wall emits once as a whole rect", () => {
    const observer = makeCharacter({ id: "A", pos: { x: 4, y: 10 } });
    const wall: Wall = { x: 5, y: 8, w: 1, h: 5 };
    const state = makeState({
      characters: [observer],
      world: { walls: [wall] },
    });

    const { visible } = computeVisibleEntities(state, "A");
    expect(visible.filter((v) => v.kind === "wall_rect")).toEqual([
      { kind: "wall_rect", rect: wall, shape: "N-S line" },
    ]);
  });

  it("emits the whole cover rect when any cluster tile has LOS", () => {
    const observer = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const blocker: Wall = { x: 2, y: 0, w: 1, h: 1 };
    const coverCluster: Wall = { x: 4, y: 0, w: 2, h: 3 };
    const state = makeState({
      characters: [observer],
      world: {
        walls: [blocker],
        coverClusters: [coverCluster],
        coverTiles: [
          { x: 4, y: 0 },
          { x: 4, y: 1 },
          { x: 4, y: 2 },
          { x: 5, y: 0 },
          { x: 5, y: 1 },
          { x: 5, y: 2 },
        ],
      },
    });

    expect(hasLineOfSight(state.world, observer.pos, { x: 4, y: 0 })).toBe(
      false,
    );
    expect(hasLineOfSight(state.world, observer.pos, { x: 4, y: 2 })).toBe(
      true,
    );
    const { visible } = computeVisibleEntities(state, "A");
    expect(visible).toContainEqual({
      kind: "cover_rect",
      rect: coverCluster,
      shape: "patch",
    });
  });

  it("still emits the cover rect when the observer is inside the cover cluster", () => {
    const observer = makeCharacter({ id: "A", pos: { x: 4, y: 4 } });
    const coverCluster: Wall = { x: 3, y: 3, w: 3, h: 3 };
    const state = makeState({
      characters: [observer],
      world: {
        coverClusters: [coverCluster],
        coverTiles: [
          { x: 3, y: 3 },
          { x: 3, y: 4 },
          { x: 3, y: 5 },
          { x: 4, y: 3 },
          { x: 4, y: 4 },
          { x: 4, y: 5 },
          { x: 5, y: 3 },
          { x: 5, y: 4 },
          { x: 5, y: 5 },
        ],
      },
    });

    const { visible } = computeVisibleEntities(state, "A");
    expect(visible).toContainEqual({
      kind: "cover_rect",
      rect: coverCluster,
      shape: "patch",
    });
  });

  it("emits revealed evac_rect regardless of range and LOS", () => {
    const observer = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const blockingWall: Wall = { x: 1, y: 0, w: 1, h: 100 };
    const state = makeState({
      characters: [observer],
      world: {
        walls: [blockingWall],
        evac: { centre: { x: 80, y: 80 }, revealedAtTurn: 30 },
      },
    });

    const { visible } = computeVisibleEntities(state, "A");
    expect(visible).toContainEqual({
      kind: "evac_rect",
      rect: { x: 79, y: 79, w: 3, h: 3 },
      shape: "patch",
    });
  });

  it("does not emit evac_rect before reveal", () => {
    const observer = makeCharacter({ id: "A", pos: { x: 50, y: 50 } });
    const state = makeState({
      characters: [observer],
      world: { evac: { centre: { x: 50, y: 50 }, revealedAtTurn: null } },
    });

    const { visible } = computeVisibleEntities(state, "A");
    expect(visible.some((v) => v.kind === "evac_rect")).toBe(false);
  });

  it("no walls in the world → no wall_rect entries in visible", () => {
    const observer = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const state = makeState({ characters: [observer] });
    const { visible } = computeVisibleEntities(state, "A");
    const walls = visible.filter((v) => v.kind === "wall_rect");
    expect(walls).toHaveLength(0);
  });
});
