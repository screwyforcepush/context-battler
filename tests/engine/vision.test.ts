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

  it("§7 — chests, corpses, and cover tiles within range with LOS appear", () => {
    const observer = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
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
    const coverTile: Tile = { x: 8, y: 0 };
    const state = makeState({
      characters: [observer],
      world: {
        chests: [chest],
        corpses: [corpse],
        coverTiles: [coverTile],
      },
    });
    const { visible } = computeVisibleEntities(state, "A");
    const kinds = visible.map((v) => v.kind);
    expect(kinds).toContain("chest");
    expect(kinds).toContain("corpse");
    expect(kinds).toContain("cover");
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

// ─── WP-B.1 / Phase-3 ADR §5 — wall emission ─────────────────────────────
//
// Vision emits `{ kind: "wall", pos }` entries for every wall TILE within
// Chebyshev 20 of the observer, with NO LOS check on walls themselves
// (walls block LOS for OTHER entities; a wall tile is "visible" by being
// within range — see ADR §5). The engine emits without cap; downstream
// `inputBuilder.ts` (WP-C) caps at 12 per turn.

describe("WP-B.1 vision walls — Phase-3 ADR §5", () => {
  it("emits wall entries for every wall tile within Chebyshev 20", () => {
    const observer = makeCharacter({ id: "A", pos: { x: 10, y: 10 } });
    // 1×1 wall at (12, 10) — distance 2 from observer.
    const wall: Wall = { x: 12, y: 10, w: 1, h: 1 };
    const state = makeState({
      characters: [observer],
      world: { walls: [wall] },
    });
    const { visible } = computeVisibleEntities(state, "A");
    const walls = visible.filter((v) => v.kind === "wall");
    expect(walls).toHaveLength(1);
    expect(walls[0]).toEqual({ kind: "wall", pos: { x: 12, y: 10 } });
  });

  it("emits one entry per tile in a multi-tile wall rectangle", () => {
    const observer = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    // 3-wide × 2-tall wall starting at (5,5) — covers tiles
    // (5,5) (6,5) (7,5) (5,6) (6,6) (7,6) → 6 tiles.
    const wall: Wall = { x: 5, y: 5, w: 3, h: 2 };
    const state = makeState({
      characters: [observer],
      world: { walls: [wall] },
    });
    const { visible } = computeVisibleEntities(state, "A");
    const walls = visible.filter((v) => v.kind === "wall");
    expect(walls).toHaveLength(6);
    const positions = walls
      .map((w) => (w.kind === "wall" ? `${w.pos.x},${w.pos.y}` : ""))
      .sort();
    expect(positions).toEqual(
      ["5,5", "5,6", "6,5", "6,6", "7,5", "7,6"].sort(),
    );
  });

  it("excludes wall tiles outside Chebyshev 20", () => {
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
    const walls = visible.filter((v) => v.kind === "wall");
    expect(walls).toHaveLength(1);
    expect(walls[0]).toEqual({ kind: "wall", pos: { x: 20, y: 0 } });
  });

  it("emits walls regardless of LOS (a wall behind another wall is still visible)", () => {
    // Per ADR §5: LOS on walls is not checked — walls within vision range
    // are visible regardless of LOS (they ARE the LOS blockers).
    const observer = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    // Two walls in a line: (5,0) and (10,0). LOS to (10,0) goes through
    // (5,0) which is itself a wall. Both must still be emitted.
    const w1: Wall = { x: 5, y: 0, w: 1, h: 1 };
    const w2: Wall = { x: 10, y: 0, w: 1, h: 1 };
    const state = makeState({
      characters: [observer],
      world: { walls: [w1, w2] },
    });
    const { visible } = computeVisibleEntities(state, "A");
    const walls = visible.filter((v) => v.kind === "wall");
    const positions = walls
      .map((w) => (w.kind === "wall" ? `${w.pos.x},${w.pos.y}` : ""))
      .sort();
    expect(positions).toEqual(["10,0", "5,0"]);
  });

  it("12-wall safety ceiling — observer in wall-densest map corner emits all walls within Chebyshev 20 (no engine-side cap)", () => {
    // Reference-map wall-densest area is the centre arena around evac
    // (48,48). Observer at (48,48) sees the full ring of inner walls at
    // (44,40), (52,40), (40,44), (56,44), (40,52), (56,52), (44,56),
    // (52,56) PLUS the outer ring at (12,48), (84,48 - out of range),
    // (48,12), (48,84 - out of range). Within Chebyshev 20: many of the
    // inner+evac-perimeter walls. The engine MUST emit all of them — the
    // 12 cap is applied later at the inputBuilder layer (WP-C).
    const observer = makeCharacter({ id: "A", pos: { x: 48, y: 48 } });
    // Synthetic high-density wall fixture: 14 individual 1×1 wall tiles
    // ringed within Chebyshev 20 of (48,48). The engine must emit all 14;
    // a 12-cap at engine level would silently truncate (the bug we test).
    const wallTiles: Wall[] = [];
    for (let i = 0; i < 14; i++) {
      // Tiles at distance ~i from observer, all within Chebyshev 20.
      // i=0 collides with observer pos so start at i=1; ensure distinct tiles.
      wallTiles.push({ x: 48 + i + 1, y: 48, w: 1, h: 1 });
    }
    const state = makeState({
      characters: [observer],
      world: { walls: wallTiles },
    });
    const { visible } = computeVisibleEntities(state, "A");
    const walls = visible.filter((v) => v.kind === "wall");
    // All 14 walls within Chebyshev 20 must be emitted (engine has no
    // 12-cap; WP-C inputBuilder caps at 12 in the digest, not here).
    expect(walls).toHaveLength(14);
  });

  it("no walls in the world → no wall entries in visible", () => {
    const observer = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const state = makeState({ characters: [observer] });
    const { visible } = computeVisibleEntities(state, "A");
    const walls = visible.filter((v) => v.kind === "wall");
    expect(walls).toHaveLength(0);
  });
});
