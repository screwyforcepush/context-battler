// WP7 — Movement substep loop tests (TDD: RED phase first).
//
// Spec sections:
//   - concept-spec.md §10 (movement options; entity-tracking; mid-movement
//     no-retarget; toward-evac after reveal)
//   - concept-spec.md §24 (collision: same-tile both fail; movement bounded
//     by terrain; cover walkable)
//   - concept-spec.md §4 (movement budget = 8 default; speed consumable = 12)

import { describe, expect, it } from "vitest";
import {
  desiredNextTile,
  simulateMovement,
  type Mover,
  type MoveTraceEntry,
} from "../../convex/engine/movement.js";
import type {
  CharacterState,
  ItemRef,
  MatchState,
  ParsedDecision,
  PersonaId,
  Tile,
  Wall,
  WorldState,
} from "../../convex/engine/types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeWorld(overrides: Partial<WorldState> = {}): WorldState {
  const world: WorldState = {
    size: { w: 100, h: 100 },
    walls: [],
    coverClusters: [],
    coverTiles: [],
    chests: [],
    corpses: [],
    evac: { centre: { x: 50, y: 50 }, revealedAtTurn: null },
    ...overrides,
  };
  if (world.coverClusters.length === 0 && world.coverTiles.length > 0) {
    world.coverClusters = world.coverTiles.map((tile) => ({
      x: tile.x,
      y: tile.y,
      w: 1,
      h: 1,
    }));
  }
  return world;
}

function makeCharacter(opts: {
  id: string;
  pos: Tile;
  displayName?: string;
  hp?: number;
  alive?: boolean;
  consumable?: ItemRef;
  personaId?: PersonaId;
}): CharacterState {
  return {
    characterId: opts.id,
    personaId: opts.personaId ?? "rat",
    spawnIndex: 0,
    displayName: opts.displayName ?? opts.id,
    hp: opts.hp ?? 100,
    maxHp: 100,
    pos: opts.pos,
    equipped: { consumable: opts.consumable },
    scratchpad: "",
    hidden: false,
    alive: opts.alive ?? true,
    lastKnown: [],
  };
}

function makeState(opts: {
  characters: CharacterState[];
  world?: Partial<WorldState>;
}): MatchState {
  return {
    matchId: "m",
    turn: 1,
    world: makeWorld(opts.world),
    characters: opts.characters,
    rngSeed: "seed",
  };
}

type MovePosition = Extract<ParsedDecision["position"], { kind: "move" }>;

function moveDecision(
  direction: MovePosition["direction"],
  dist = 8,
): ParsedDecision {
  return {
    use: null,
    position: { kind: "move", direction, dist },
    action: { kind: "none" },
    say: null,
    scratchpad: null,
  };
}

function noMoveDecision(): ParsedDecision {
  return {
    use: null,
    position: { kind: "move", direction: { kind: "N" }, dist: 0 },
    action: { kind: "none" },
    say: null,
    scratchpad: null,
  };
}

function findChar(state: MatchState, id: string): CharacterState {
  const c = state.characters.find((c) => c.characterId === id);
  if (!c) throw new Error(`character ${id} missing`);
  return c;
}

function chebyshevDistance(a: Tile, b: Tile): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function tileIsInWall(tile: Tile, wall: Wall): boolean {
  return (
    tile.x >= wall.x &&
    tile.x < wall.x + wall.w &&
    tile.y >= wall.y &&
    tile.y < wall.y + wall.h
  );
}

function onlyMove(moves: MoveTraceEntry[]): MoveTraceEntry {
  expect(moves).toHaveLength(1);
  return moves[0]!;
}

// ─── §10 target movement tracks current position ─────────────────────────

describe("WP7 movement — concept-spec §10", () => {
  it("§10 — toward Duelist tracks target's CURRENT position substep-by-substep", () => {
    // A at (0,0), B at (10,0). Both decide:
    //   A: toward Duelist
    //   B: compass east by 5 tiles (A must keep tracking)
    // Expected: A moves 8 east; B moves 5 east. After substep loop, A
    // should be at (8,0), B at (15,0). Chebyshev between A and B is 7.
    const a = makeCharacter({
      id: "A",
      displayName: "Rat",
      pos: { x: 0, y: 0 },
    });
    const b = makeCharacter({
      id: "opaque_b",
      displayName: "Duelist",
      pos: { x: 10, y: 0 },
    });
    const state = makeState({ characters: [a, b] });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "toward", targetId: "Duelist" })],
      ["opaque_b", moveDecision({ kind: "E" }, 5)],
    ]);
    const { state: next } = simulateMovement(state, decisions);
    expect(findChar(next, "A").pos).toEqual({ x: 8, y: 0 });
    expect(findChar(next, "opaque_b").pos).toEqual({ x: 15, y: 0 });
  });

  it("§10 — cached persona target keeps tracking after current LOS would drop", () => {
    const a = makeCharacter({
      id: "A",
      displayName: "Rat",
      pos: { x: 0, y: 0 },
    });
    const b = makeCharacter({
      id: "opaque_b",
      displayName: "Duelist",
      pos: { x: 30, y: 0 },
    });
    const state = makeState({ characters: [a, b] });
    const mover: Mover = {
      characterId: "A",
      budget: 8,
      decision: moveDecision({ kind: "toward", targetId: "Duelist" }),
      resolvedTarget: {
        kind: "character",
        tile: { x: 20, y: 0 },
        stopAtRange: 2,
        engineRef: { characterId: "opaque_b" },
      },
    };

    expect(desiredNextTile(state, mover)).toEqual({ x: 1, y: 0 });
  });

  it("§10 — toward Opportunist stops at Chebyshev 2 (interaction range)", () => {
    // A at (0,0), B at (5,0), B does not move.
    // A moves toward B; should stop within Chebyshev 2 → at (3,0).
    const a = makeCharacter({
      id: "A",
      displayName: "Rat",
      pos: { x: 0, y: 0 },
    });
    const b = makeCharacter({
      id: "opaque_b",
      displayName: "Opportunist",
      pos: { x: 5, y: 0 },
    });
    const state = makeState({ characters: [a, b] });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "toward", targetId: "Opportunist" })],
      ["opaque_b", noMoveDecision()],
    ]);
    const { state: next } = simulateMovement(state, decisions);
    const aFinal = findChar(next, "A");
    // A should stop at distance ≤ 2 from B's actual final position.
    expect(
      Math.max(Math.abs(aFinal.pos.x - 5), Math.abs(aFinal.pos.y - 0)),
    ).toBe(2);
  });

  it("§10 — speed consumable bumps movement budget to 12 this turn", () => {
    // Caller signals via `speedActiveIds` — the resolver applies consumables
    // in phase 2 then passes the set to phase 4.
    const a = makeCharacter({
      id: "A",
      displayName: "Rat",
      pos: { x: 0, y: 0 },
    });
    const b = makeCharacter({
      id: "opaque_b",
      displayName: "Duelist",
      pos: { x: 20, y: 0 },
    });
    const state = makeState({ characters: [a, b] });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "toward", targetId: "Duelist" })],
      ["opaque_b", noMoveDecision()],
    ]);
    const { state: next } = simulateMovement(state, decisions, {
      speedActiveIds: new Set(["A"]),
    });
    expect(findChar(next, "A").pos).toEqual({ x: 12, y: 0 });
  });

  it("§10 — agent does NOT retarget on new enemy mid-movement", () => {
    // A moving toward original target B. C enters near A's path. A must
    // continue toward B, not retarget to C.
    const a = makeCharacter({
      id: "A",
      displayName: "Rat",
      pos: { x: 0, y: 0 },
    });
    const b = makeCharacter({
      id: "opaque_b",
      displayName: "Duelist",
      pos: { x: 20, y: 0 },
    });
    const c = makeCharacter({
      id: "C",
      displayName: "Trader",
      pos: { x: 5, y: 5 },
    });
    const state = makeState({ characters: [a, b, c] });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "toward", targetId: "Duelist" })],
      ["opaque_b", noMoveDecision()],
      ["C", noMoveDecision()],
    ]);
    const { state: next } = simulateMovement(state, decisions);
    // A should head toward (20,0), not divert to C (5,5).
    // After 8 substeps: x=8, y=0 (or close; diagonals not preferred when
    // target is on same y).
    const aFinal = findChar(next, "A");
    expect(aFinal.pos.x).toBe(8);
    expect(aFinal.pos.y).toBe(0);
  });

  it("§10 — toward Evac uses evac.centre", () => {
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const state = makeState({
      characters: [a],
      world: { evac: { centre: { x: 50, y: 50 }, revealedAtTurn: 30 } },
    });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "toward", targetId: "Evac_49_49_to_51_51" })],
    ]);
    const { state: next } = simulateMovement(state, decisions);
    expect(findChar(next, "A").pos).toEqual({ x: 8, y: 8 });
  });

  it("§10 — compass move clamped to budget; budget=8 default", () => {
    // Requested east distance 20 is clamped to budget=8. Result: (8,0).
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const state = makeState({ characters: [a] });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "E" }, 20)],
    ]);
    const { state: next } = simulateMovement(state, decisions);
    expect(findChar(next, "A").pos).toEqual({ x: 8, y: 0 });
  });

  it("§10 — compass diagonal move within budget reaches exact target", () => {
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const state = makeState({ characters: [a] });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "SE" }, 5)],
    ]);
    const { state: next } = simulateMovement(state, decisions);
    expect(findChar(next, "A").pos).toEqual({ x: 5, y: 5 });
  });

  it("§10 — toward Chest_x_y uses static chest position and stops at Chebyshev 2", () => {
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const state = makeState({
      characters: [a],
      world: {
        chests: [
          {
            id: "Chest_5_0",
            pos: { x: 5, y: 0 },
            contents: { category: "weapon", name: "sword" },
            opened: false,
            lootTable: "starter",
          },
        ],
      },
    });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "toward", targetId: "Chest_5_0" })],
    ]);
    const { state: next } = simulateMovement(state, decisions);
    // Stops at Chebyshev 2 from chest at (5,0): A ends at (3,0).
    expect(findChar(next, "A").pos).toEqual({ x: 3, y: 0 });
  });

  it("§10 — away Duelist moves to increase Chebyshev distance", () => {
    const a = makeCharacter({
      id: "A",
      displayName: "Rat",
      pos: { x: 5, y: 5 },
    });
    const b = makeCharacter({
      id: "opaque_b",
      displayName: "Duelist",
      pos: { x: 5, y: 6 },
    });
    const state = makeState({ characters: [a, b] });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "away", targetId: "Duelist" })],
      ["opaque_b", noMoveDecision()],
    ]);
    const { state: next } = simulateMovement(state, decisions);
    const aFinal = findChar(next, "A");
    // A should move away from B (north). Distance must increase.
    expect(chebyshevDistance(aFinal.pos, { x: 5, y: 6 })).toBeGreaterThan(1);
  });
});

// ─── Phase 05 WP-C — typed target movement stopAtRange ───────────────────

describe("Phase 05 WP-C movement resolver — typed target ids", () => {
  it("toward Corpse_Camper halts at corpse loot range 2", () => {
    const actor = makeCharacter({
      id: "A",
      displayName: "Rat",
      pos: { x: 50, y: 50 },
    });
    const dead = makeCharacter({
      id: "dead_5",
      displayName: "Camper",
      pos: { x: 58, y: 51 },
      alive: false,
    });
    const corpseTile = { x: 58, y: 50 };
    const state = makeState({
      characters: [actor, dead],
      world: {
        corpses: [
          {
            characterId: "dead_5",
            pos: corpseTile,
            contents: { weapon: { category: "weapon", name: "axe" } },
          },
        ],
      },
    });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "toward", targetId: "Corpse_Camper" })],
      ["dead_5", noMoveDecision()],
    ]);

    const { state: next } = simulateMovement(state, decisions);
    const final = findChar(next, "A").pos;

    expect(final).toEqual({ x: 56, y: 50 });
    expect(chebyshevDistance(final, corpseTile)).toBe(2);
  });

  it("toward Cover_X_Y walks onto the visible cover tile when budget covers the path", () => {
    const actor = makeCharacter({
      id: "A",
      displayName: "Rat",
      pos: { x: 50, y: 50 },
    });
    const cover = { x: 54, y: 42 };
    const state = makeState({
      characters: [actor],
      world: {
        coverClusters: [{ x: 54, y: 42, w: 1, h: 1 }],
        coverTiles: [cover],
      },
    });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "toward", targetId: "Cover_54_42" })],
    ]);

    const { state: next } = simulateMovement(state, decisions);

    expect(state.world.coverTiles).toContainEqual(cover);
    expect(findChar(next, "A").pos).toEqual(cover);
  });

  it("toward Wall_X_Y stops on a walkable Chebyshev-1 tile when reachable", () => {
    const actor = makeCharacter({
      id: "A",
      displayName: "Rat",
      pos: { x: 50, y: 50 },
    });
    const wall: Wall = { x: 54, y: 50, w: 1, h: 1 };
    const wallTile = { x: 54, y: 50 };
    const state = makeState({
      characters: [actor],
      world: { walls: [wall] },
    });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "toward", targetId: "Wall_54_50" })],
    ]);

    const { state: next } = simulateMovement(state, decisions);
    const final = findChar(next, "A").pos;

    expect(final).toEqual({ x: 53, y: 50 });
    expect(chebyshevDistance(final, wallTile)).toBe(1);
    expect(tileIsInWall(final, wall)).toBe(false);
  });

  it("toward Wall_X_Y at a blocked map edge halts gracefully without entering a wall", () => {
    const actor = makeCharacter({
      id: "A",
      displayName: "Rat",
      pos: { x: 2, y: 2 },
    });
    const walls: Wall[] = [
      { x: 0, y: 0, w: 1, h: 1 },
      { x: 1, y: 0, w: 1, h: 1 },
      { x: 0, y: 1, w: 1, h: 1 },
      { x: 1, y: 1, w: 1, h: 1 },
    ];
    const state = makeState({
      characters: [actor],
      world: { size: { w: 5, h: 5 }, walls },
    });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "toward", targetId: "Wall_0_0" })],
    ]);

    const { state: next } = simulateMovement(state, decisions);
    const final = findChar(next, "A").pos;

    expect(final).toEqual({ x: 2, y: 2 });
    expect(chebyshevDistance(final, { x: 0, y: 0 })).toBeGreaterThan(1);
    expect(walls.some((wall) => tileIsInWall(final, wall))).toBe(false);
  });

  it("toward Evac walks into the revealed evac rect when within budget", () => {
    const actor = makeCharacter({
      id: "A",
      displayName: "Rat",
      pos: { x: 50, y: 50 },
    });
    const state = makeState({
      characters: [actor],
      world: { evac: { centre: { x: 54, y: 54 }, revealedAtTurn: 30 } },
    });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "toward", targetId: "Evac_53_53_to_55_55" })],
    ]);

    const { state: next } = simulateMovement(state, decisions);

    expect(findChar(next, "A").pos).toEqual({ x: 53, y: 53 });
  });

  it("away Opportunist preserves the deterministic +x tie-break when actor is on the target tile", () => {
    const actor = makeCharacter({
      id: "A",
      displayName: "Rat",
      pos: { x: 50, y: 50 },
    });
    const target = makeCharacter({
      id: "opaque_target",
      displayName: "Opportunist",
      pos: { x: 50, y: 50 },
    });
    const state = makeState({ characters: [actor, target] });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "away", targetId: "Opportunist" })],
      ["opaque_target", noMoveDecision()],
    ]);

    const { state: next } = simulateMovement(state, decisions);

    expect(findChar(next, "A").pos).toEqual({ x: 58, y: 50 });
  });

  it("away Chest_x_y moves opposite from a chest at loot range 1", () => {
    const actor = makeCharacter({
      id: "A",
      displayName: "Rat",
      pos: { x: 50, y: 50 },
    });
    const chestTile = { x: 49, y: 50 };
    const state = makeState({
      characters: [actor],
      world: {
        chests: [
          {
            id: "Chest_49_50",
            pos: chestTile,
            contents: { category: "weapon", name: "sword" },
            opened: false,
            lootTable: "starter",
          },
        ],
      },
    });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "away", targetId: "Chest_49_50" })],
    ]);

    const { state: next } = simulateMovement(state, decisions);
    const final = findChar(next, "A").pos;

    expect(chebyshevDistance(actor.pos, chestTile)).toBe(1);
    expect(final).toEqual({ x: 58, y: 50 });
    expect(chebyshevDistance(final, chestTile)).toBeGreaterThan(2);
  });

  it("away Corpse_Camper moves opposite from a corpse at loot range 1", () => {
    const actor = makeCharacter({
      id: "A",
      displayName: "Rat",
      pos: { x: 50, y: 50 },
    });
    const dead = makeCharacter({
      id: "dead_5",
      displayName: "Camper",
      pos: { x: 49, y: 50 },
      alive: false,
    });
    const corpseTile = { x: 49, y: 50 };
    const state = makeState({
      characters: [actor, dead],
      world: {
        corpses: [
          {
            characterId: "dead_5",
            pos: corpseTile,
            contents: { weapon: { category: "weapon", name: "axe" } },
          },
        ],
      },
    });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "away", targetId: "Corpse_Camper" })],
      ["dead_5", noMoveDecision()],
    ]);

    const { state: next } = simulateMovement(state, decisions);
    const final = findChar(next, "A").pos;

    expect(chebyshevDistance(actor.pos, corpseTile)).toBe(1);
    expect(final).toEqual({ x: 58, y: 50 });
    expect(chebyshevDistance(final, corpseTile)).toBeGreaterThan(2);
  });

  it("away Cover_X_Y moves opposite from a cover tile", () => {
    const actor = makeCharacter({
      id: "A",
      displayName: "Rat",
      pos: { x: 50, y: 50 },
    });
    const state = makeState({
      characters: [actor],
      world: {
        coverClusters: [{ x: 50, y: 50, w: 1, h: 1 }],
        coverTiles: [{ x: 50, y: 50 }],
      },
    });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "away", targetId: "Cover_50_50" })],
    ]);

    const { state: next } = simulateMovement(state, decisions);

    expect(findChar(next, "A").pos).toEqual({ x: 58, y: 50 });
  });

  it("away Wall_X_Y moves opposite from a wall tile", () => {
    const actor = makeCharacter({
      id: "A",
      displayName: "Rat",
      pos: { x: 50, y: 50 },
    });
    const state = makeState({
      characters: [actor],
      world: { walls: [{ x: 48, y: 50, w: 1, h: 1 }] },
    });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "away", targetId: "Wall_48_50" })],
    ]);

    const { state: next } = simulateMovement(state, decisions);

    expect(findChar(next, "A").pos).toEqual({ x: 58, y: 50 });
  });

  it("away Evac moves opposite from the revealed evac centre", () => {
    const actor = makeCharacter({
      id: "A",
      displayName: "Rat",
      pos: { x: 50, y: 50 },
    });
    const state = makeState({
      characters: [actor],
      world: { evac: { centre: { x: 48, y: 50 }, revealedAtTurn: 30 } },
    });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "away", targetId: "Evac_47_49_to_49_51" })],
    ]);

    const { state: next } = simulateMovement(state, decisions);

    expect(findChar(next, "A").pos).toEqual({ x: 58, y: 50 });
  });
});

// ─── §24 collisions ──────────────────────────────────────────────────────

describe("WP7 movement — concept-spec §24 collisions", () => {
  it("§24 — two agents into same tile both fail; both stay put for that substep", () => {
    // A at (0,1), B at (2,1). Both move toward (1,1): A east,
    // B west. They both try to enter (1,1) on substep 1 → both
    // fail that substep. With movement budget remaining, they may move
    // again — but (1,1) is still contested if both retry. So both end up
    // unable to step.
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 1 } });
    const b = makeCharacter({ id: "B", pos: { x: 2, y: 1 } });
    const state = makeState({ characters: [a, b] });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "E" }, 1)],
      ["B", moveDecision({ kind: "W" }, 1)],
    ]);
    const { state: next } = simulateMovement(state, decisions);
    expect(findChar(next, "A").pos).toEqual({ x: 0, y: 1 });
    expect(findChar(next, "B").pos).toEqual({ x: 2, y: 1 });
  });

  it("§24 — order-independence: shuffle decision-Map order, post-state byte-identical", () => {
    // Three permutations of insertion order should yield identical positions.
    const buildState = () => {
      const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
      const b = makeCharacter({ id: "B", pos: { x: 10, y: 0 } });
      const c = makeCharacter({ id: "C", pos: { x: 5, y: 10 } });
      return makeState({ characters: [a, b, c] });
    };
    const dA = moveDecision({ kind: "SE" }, 5);
    const dB = moveDecision({ kind: "W" }, 3);
    const dC = moveDecision({ kind: "N" }, 8);

    const order1 = new Map<string, ParsedDecision>([
      ["A", dA],
      ["B", dB],
      ["C", dC],
    ]);
    const order2 = new Map<string, ParsedDecision>([
      ["B", dB],
      ["C", dC],
      ["A", dA],
    ]);
    const order3 = new Map<string, ParsedDecision>([
      ["C", dC],
      ["A", dA],
      ["B", dB],
    ]);
    const order4 = new Map<string, ParsedDecision>([
      ["B", dB],
      ["A", dA],
      ["C", dC],
    ]);
    const order5 = new Map<string, ParsedDecision>([
      ["C", dC],
      ["B", dB],
      ["A", dA],
    ]);

    const r1 = simulateMovement(buildState(), order1).state;
    const r2 = simulateMovement(buildState(), order2).state;
    const r3 = simulateMovement(buildState(), order3).state;
    const r4 = simulateMovement(buildState(), order4).state;
    const r5 = simulateMovement(buildState(), order5).state;
    const positions = (s: MatchState) =>
      [...s.characters]
        .sort((x, y) => x.characterId.localeCompare(y.characterId))
        .map((c) => ({ id: c.characterId, pos: c.pos }));
    expect(positions(r1)).toEqual(positions(r2));
    expect(positions(r2)).toEqual(positions(r3));
    expect(positions(r3)).toEqual(positions(r4));
    expect(positions(r4)).toEqual(positions(r5));
  });

  it("§24 — wall blocks movement", () => {
    // Wall rectangle at (3,0,1,1) — A starts at (0,0) and moves east 5;
    // should stop at (2,0).
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const wall: Wall = { x: 3, y: 0, w: 1, h: 1 };
    const state = makeState({ characters: [a], world: { walls: [wall] } });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "E" }, 5)],
    ]);
    const { state: next } = simulateMovement(state, decisions);
    expect(findChar(next, "A").pos).toEqual({ x: 2, y: 0 });
  });

  it("§24 — other living character blocks movement", () => {
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const b = makeCharacter({ id: "B", pos: { x: 3, y: 0 } });
    const state = makeState({ characters: [a, b] });
    // A wants to move 5 east; B sits at (3,0) blocking. A stops at (2,0).
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "E" }, 5)],
      ["B", noMoveDecision()],
    ]);
    const { state: next } = simulateMovement(state, decisions);
    expect(findChar(next, "A").pos).toEqual({ x: 2, y: 0 });
    expect(findChar(next, "B").pos).toEqual({ x: 3, y: 0 });
  });

  it("§24 — path-blocked compass move stops when the next step is blocked", () => {
    // A at (0,0), wants to move east, wall at (4,0,1,1).
    // A should advance to (3,0) and stop (cannot go around in straight-line v0).
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const wall: Wall = { x: 4, y: 0, w: 1, h: 1 };
    const state = makeState({
      characters: [a],
      world: {
        walls: [wall],
      },
    });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "E" }, 8)],
    ]);
    const { state: next } = simulateMovement(state, decisions);
    const aFinal = findChar(next, "A");
    expect(aFinal.pos).toEqual({ x: 3, y: 0 });
    expect(tileIsInWall(aFinal.pos, wall)).toBe(false);
  });

  it("§24 — cover is walkable", () => {
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const state = makeState({
      characters: [a],
      world: { coverTiles: [{ x: 1, y: 0 }, { x: 2, y: 0 }] },
    });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "E" }, 2)],
    ]);
    const { state: next } = simulateMovement(state, decisions);
    expect(findChar(next, "A").pos).toEqual({ x: 2, y: 0 });
  });

  it("§24 — counter position yields zero movement budget", () => {
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const state = makeState({ characters: [a] });
    const stationary: ParsedDecision = {
      use: null,
      position: { kind: "counter" },
      action: { kind: "none" },
      say: null,
      scratchpad: null,
    };
    const decisions = new Map<string, ParsedDecision>([["A", stationary]]);
    const { state: next } = simulateMovement(state, decisions);
    expect(findChar(next, "A").pos).toEqual({ x: 0, y: 0 });
  });

  it("§24 — overwatch position yields zero movement budget", () => {
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const state = makeState({ characters: [a] });
    const ow: ParsedDecision = {
      use: null,
      position: { kind: "overwatch" },
      action: { kind: "none" },
      say: null,
      scratchpad: null,
    };
    const decisions = new Map<string, ParsedDecision>([["A", ow]]);
    const { state: next } = simulateMovement(state, decisions);
    expect(findChar(next, "A").pos).toEqual({ x: 0, y: 0 });
  });

  it("§24 — dead character does not move even with a move decision", () => {
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 }, alive: false });
    const state = makeState({ characters: [a] });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "E" }, 5)],
    ]);
    const { state: next } = simulateMovement(state, decisions);
    expect(findChar(next, "A").pos).toEqual({ x: 0, y: 0 });
  });

  it("§24 — moves trace lists from→to for every actually-moved character", () => {
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const b = makeCharacter({ id: "B", pos: { x: 5, y: 5 } });
    const state = makeState({ characters: [a, b] });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "E" }, 3)],
      ["B", noMoveDecision()],
    ]);
    const { moves } = simulateMovement(state, decisions);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toEqual({
      characterId: "A",
      from: { x: 0, y: 0 },
      to: { x: 3, y: 0 },
    });
  });
});

// ─── WP-B.7 Wall-blocked move emission — Phase-3 ADR §9 ──────────────────
//
// `MoveTraceEntry.blockedBy: "wall"` is emitted when:
//   - `start === end` (mover did not move at all this turn) AND
//   - the agent's intended next-step direction was a wall tile.
// Other start===end cases (no-move decision, character-blocked, off-grid)
// emit nothing — existing absence is the correct behaviour.

describe("WP-B.7 wall-blocked move emit — ADR §9", () => {
  it("wall directly east blocks A's eastward compass move → emits {from===to, blockedBy:'wall'}", () => {
    const a = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    // Wall immediately east at (6,5).
    const wall: Wall = { x: 6, y: 5, w: 1, h: 1 };
    const state = makeState({ characters: [a], world: { walls: [wall] } });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "E" }, 1)],
    ]);
    const { moves } = simulateMovement(state, decisions);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toEqual({
      characterId: "A",
      from: { x: 5, y: 5 },
      to: { x: 5, y: 5 },
      blockedBy: "wall",
    });
  });

  it("wall in each of the 4 cardinal directions emits blockedBy='wall'", () => {
    // North.
    {
      const a = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
      const wall: Wall = { x: 5, y: 4, w: 1, h: 1 };
      const state = makeState({ characters: [a], world: { walls: [wall] } });
      const decisions = new Map<string, ParsedDecision>([
        ["A", moveDecision({ kind: "N" }, 1)],
      ]);
      const { moves } = simulateMovement(state, decisions);
      expect(moves).toHaveLength(1);
      expect(moves[0]?.blockedBy).toBe("wall");
    }
    // South.
    {
      const a = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
      const wall: Wall = { x: 5, y: 6, w: 1, h: 1 };
      const state = makeState({ characters: [a], world: { walls: [wall] } });
      const decisions = new Map<string, ParsedDecision>([
        ["A", moveDecision({ kind: "S" }, 1)],
      ]);
      const { moves } = simulateMovement(state, decisions);
      expect(moves).toHaveLength(1);
      expect(moves[0]?.blockedBy).toBe("wall");
    }
    // West.
    {
      const a = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
      const wall: Wall = { x: 4, y: 5, w: 1, h: 1 };
      const state = makeState({ characters: [a], world: { walls: [wall] } });
      const decisions = new Map<string, ParsedDecision>([
        ["A", moveDecision({ kind: "W" }, 1)],
      ]);
      const { moves } = simulateMovement(state, decisions);
      expect(moves).toHaveLength(1);
      expect(moves[0]?.blockedBy).toBe("wall");
    }
    // East already covered above.
  });

  it("wall at NE diagonal with both fallback axes clear slides on X-axis", () => {
    const a = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    // Wall directly NE at (6,4).
    const wall: Wall = { x: 6, y: 4, w: 1, h: 1 };
    const state = makeState({ characters: [a], world: { walls: [wall] } });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "NE" }, 1)],
    ]);
    const { moves } = simulateMovement(state, decisions);
    expect(onlyMove(moves)).toEqual({
      characterId: "A",
      from: { x: 5, y: 5 },
      to: { x: 6, y: 5 },
      slide: { wallRectId: "Wall_6_4", axis: "E", intent: "NE" },
    });
  });

  it("stationary decision emits NOTHING (no blockedBy entry)", () => {
    const a = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const state = makeState({ characters: [a] });
    const decisions = new Map<string, ParsedDecision>([
      ["A", noMoveDecision()],
    ]);
    const { moves } = simulateMovement(state, decisions);
    expect(moves).toHaveLength(0);
  });

  it("character-blocked (no wall) → emits NOTHING (no blockedBy entry)", () => {
    const a = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const b = makeCharacter({ id: "B", pos: { x: 6, y: 5 } });
    const state = makeState({ characters: [a, b] });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "E" }, 1)],
      ["B", noMoveDecision()],
    ]);
    const { moves } = simulateMovement(state, decisions);
    // A could not enter (6,5) because B occupies it. Per ADR §9, NO entry
    // is pushed for character-blocked moves (existing absence is correct).
    expect(moves.find((m) => m.characterId === "A")).toBeUndefined();
  });

  it("off-grid block (boundary) → emits NOTHING (no blockedBy entry)", () => {
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const state = makeState({ characters: [a] });
    const decisions = new Map<string, ParsedDecision>([
      // dx=-1 → would step to (-1, 0), off-grid.
      ["A", moveDecision({ kind: "W" }, 1)],
    ]);
    const { moves } = simulateMovement(state, decisions);
    expect(moves.find((m) => m.characterId === "A")).toBeUndefined();
  });

  it("partial-progress move (one step succeeds, then blocked by wall) → emits the actual movement WITHOUT blockedBy", () => {
    // A moves dx=5, but a wall at (8,5) — dx=3 succeeds, then blocked by
    // wall on substep 4. Final pos: (8,5)? No — A starts at (5,5), wants
    // dx=5 → wants (10,5). Wall at (8,5) blocks substep 4. A ends at
    // (7,5) — moved 2 tiles, then blocked. Trace shows from===to NOT
    // satisfied (start≠end), so no blockedBy field, just normal move.
    const a = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const wall: Wall = { x: 8, y: 5, w: 1, h: 1 };
    const state = makeState({ characters: [a], world: { walls: [wall] } });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "E" }, 5)],
    ]);
    const { moves } = simulateMovement(state, decisions);
    const move = moves.find((m) => m.characterId === "A");
    expect(move).toBeDefined();
    expect(move?.from).toEqual({ x: 5, y: 5 });
    expect(move?.to).toEqual({ x: 7, y: 5 });
    expect(move?.blockedBy).toBeUndefined();
  });
});

// ─── Phase 9 WP-B — diagonal wall-slide substrate ────────────────────────

describe("Phase 9 WP-B wall-slide movement substrate", () => {
  it("diagonal compass wall-hit slides on X-axis when only X fallback is clear", () => {
    const a = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const diagonalWall: Wall = { x: 6, y: 4, w: 1, h: 1 };
    const yFallbackWall: Wall = { x: 5, y: 4, w: 1, h: 1 };
    const state = makeState({
      characters: [a],
      world: { walls: [diagonalWall, yFallbackWall] },
    });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "NE" }, 1)],
    ]);

    const { state: next, moves } = simulateMovement(state, decisions);

    expect(findChar(next, "A").pos).toEqual({ x: 6, y: 5 });
    expect(onlyMove(moves)).toEqual({
      characterId: "A",
      from: { x: 5, y: 5 },
      to: { x: 6, y: 5 },
      slide: { wallRectId: "Wall_6_4", axis: "E", intent: "NE" },
    });
  });

  it("diagonal compass wall-hit slides on Y-axis when only Y fallback is clear", () => {
    const a = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const blocker = makeCharacter({ id: "B", pos: { x: 6, y: 5 } });
    const diagonalWall: Wall = { x: 6, y: 4, w: 1, h: 1 };
    const state = makeState({
      characters: [a, blocker],
      world: { walls: [diagonalWall] },
    });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "NE" }, 1)],
      ["B", noMoveDecision()],
    ]);

    const { state: next, moves } = simulateMovement(state, decisions);

    expect(findChar(next, "A").pos).toEqual({ x: 5, y: 4 });
    expect(onlyMove(moves)).toEqual({
      characterId: "A",
      from: { x: 5, y: 5 },
      to: { x: 5, y: 4 },
      slide: { wallRectId: "Wall_6_4", axis: "N", intent: "NE" },
    });
  });

  it("toward-target diagonal wall-hit slides and carries the verbatim target intent", () => {
    const a = makeCharacter({ id: "A", displayName: "Rat", pos: { x: 5, y: 5 } });
    const target = makeCharacter({
      id: "opaque_duelist",
      displayName: "Duelist",
      pos: { x: 10, y: 3 },
    });
    const diagonalWall: Wall = { x: 6, y: 4, w: 1, h: 1 };
    const yFallbackWall: Wall = { x: 5, y: 4, w: 1, h: 1 };
    const state = makeState({
      characters: [a, target],
      world: { walls: [diagonalWall, yFallbackWall] },
    });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "toward", targetId: "Duelist" }, 1)],
      ["opaque_duelist", noMoveDecision()],
    ]);

    const { moves } = simulateMovement(state, decisions);

    expect(onlyMove(moves).slide).toEqual({
      wallRectId: "Wall_6_4",
      axis: "E",
      intent: "toward Duelist",
    });
  });

  it("away-target diagonal wall-hit slides and carries the verbatim target intent", () => {
    const a = makeCharacter({ id: "A", displayName: "Rat", pos: { x: 5, y: 5 } });
    const target = makeCharacter({
      id: "opaque_camper",
      displayName: "Camper",
      pos: { x: 0, y: 10 },
    });
    const blocker = makeCharacter({ id: "B", pos: { x: 6, y: 5 } });
    const diagonalWall: Wall = { x: 6, y: 4, w: 1, h: 1 };
    const state = makeState({
      characters: [a, target, blocker],
      world: { walls: [diagonalWall] },
    });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "away", targetId: "Camper" }, 1)],
      ["opaque_camper", noMoveDecision()],
      ["B", noMoveDecision()],
    ]);

    const { moves } = simulateMovement(state, decisions);

    expect(onlyMove(moves).slide).toEqual({
      wallRectId: "Wall_6_4",
      axis: "N",
      intent: "away Camper",
    });
  });

  it("cardinal direct wall-hit dead-stops with existing blockedBy='wall' trace", () => {
    const a = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const wall: Wall = { x: 6, y: 5, w: 1, h: 1 };
    const state = makeState({ characters: [a], world: { walls: [wall] } });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "E" }, 1)],
    ]);

    const { state: next, moves } = simulateMovement(state, decisions);

    expect(findChar(next, "A").pos).toEqual({ x: 5, y: 5 });
    expect(onlyMove(moves)).toEqual({
      characterId: "A",
      from: { x: 5, y: 5 },
      to: { x: 5, y: 5 },
      blockedBy: "wall",
    });
  });

  it("both cardinal fallbacks blocked dead-stops with existing blockedBy='wall' trace", () => {
    const a = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const blocker = makeCharacter({ id: "B", pos: { x: 6, y: 5 } });
    const walls: Wall[] = [
      { x: 6, y: 4, w: 1, h: 1 },
      { x: 5, y: 4, w: 1, h: 1 },
    ];
    const state = makeState({ characters: [a, blocker], world: { walls } });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "NE" }, 1)],
      ["B", noMoveDecision()],
    ]);

    const { state: next, moves } = simulateMovement(state, decisions);

    expect(findChar(next, "A").pos).toEqual({ x: 5, y: 5 });
    expect(onlyMove(moves)).toEqual({
      characterId: "A",
      from: { x: 5, y: 5 },
      to: { x: 5, y: 5 },
      blockedBy: "wall",
    });
  });

  it("both cardinal fallbacks clear uses the X-axis tie-break", () => {
    const a = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const wall: Wall = { x: 6, y: 4, w: 1, h: 1 };
    const state = makeState({ characters: [a], world: { walls: [wall] } });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "NE" }, 1)],
    ]);

    const { state: next, moves } = simulateMovement(state, decisions);

    expect(findChar(next, "A").pos).toEqual({ x: 6, y: 5 });
    expect(onlyMove(moves).slide).toEqual({
      wallRectId: "Wall_6_4",
      axis: "E",
      intent: "NE",
    });
  });

  it("multi-substep slide records the first slide and then continues movement", () => {
    const a = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const wall: Wall = { x: 6, y: 4, w: 1, h: 1 };
    const state = makeState({ characters: [a], world: { walls: [wall] } });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "NE" }, 4)],
    ]);

    const { state: next, moves } = simulateMovement(state, decisions);

    expect(findChar(next, "A").pos).toEqual({ x: 9, y: 2 });
    expect(onlyMove(moves)).toEqual({
      characterId: "A",
      from: { x: 5, y: 5 },
      to: { x: 9, y: 2 },
      slide: { wallRectId: "Wall_6_4", axis: "E", intent: "NE" },
    });
  });

  it("toward rect target recomputes the nearest tile from resolvedTarget.rect", () => {
    const wallRect: Wall = { x: 10, y: 10, w: 5, h: 1 };
    const actor = makeCharacter({ id: "A", pos: { x: 9, y: 10 } });
    const state = makeState({ characters: [actor], world: { walls: [wallRect] } });
    const mover: Mover = {
      characterId: "A",
      budget: 8,
      decision: moveDecision({
        kind: "toward",
        targetId: "Wall_10_10_to_14_10",
      }),
      resolvedTarget: {
        kind: "wall",
        tile: { x: 14, y: 10 },
        stopAtRange: 1,
        rect: wallRect,
      },
    };

    expect(desiredNextTile(state, mover)).toBeNull();

    const fartherState = makeState({
      characters: [makeCharacter({ id: "A", pos: { x: 8, y: 10 } })],
      world: { walls: [wallRect] },
    });
    expect(desiredNextTile(fartherState, mover)).toEqual({ x: 9, y: 10 });
  });

  it("away rect target moves away from the dynamically nearest rect tile", () => {
    const wallRect: Wall = { x: 10, y: 10, w: 5, h: 1 };
    const actor = makeCharacter({ id: "A", pos: { x: 9, y: 9 } });
    const state = makeState({ characters: [actor], world: { walls: [wallRect] } });
    const mover: Mover = {
      characterId: "A",
      budget: 8,
      decision: moveDecision({
        kind: "away",
        targetId: "Wall_10_10_to_14_10",
      }),
      resolvedTarget: {
        kind: "wall",
        // Deliberately stale/wrong: the rect nearest tile is (10,10).
        tile: { x: 6, y: 10 },
        stopAtRange: 1,
        rect: wallRect,
      },
    };

    expect(desiredNextTile(state, mover)).toEqual({ x: 8, y: 8 });
  });
});

// ─── WP-G.1 Corpse_<PersonaName> typed-id routing — D38 PM-lock ──────────
//
// Reviewer-B HIGH-1: digest renders `Corpse_<PersonaName>` typed-id. The movement
// resolver must route that id to the corpse tile through the shared typed-id
// helper, not through category-specific move arms.
// PM-lock D38: fix at engine boundary; do NOT change digest rendering.

describe("WP-G.1 Corpse_<PersonaName> typed-id movement routing — D38", () => {
  it("toward 'Corpse_Camper' routes toward corpse tile (test-fixture: characterId === displayName)", () => {
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const dead = makeCharacter({
      id: "Camper",
      displayName: "Camper",
      pos: { x: 5, y: 0 },
      alive: false,
    });
    const state = makeState({
      characters: [a, dead],
      world: {
        corpses: [
          {
            characterId: "Camper",
            pos: { x: 5, y: 0 },
            contents: { weapon: { category: "weapon", name: "axe" } },
          },
        ],
      },
    });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        moveDecision({
          kind: "toward",
          targetId: "Corpse_Camper",
        }),
      ],
      ["Camper", noMoveDecision()],
    ]);
    const { state: next } = simulateMovement(state, decisions);
    // Corpse stopAtRange is 2: A ends at (3,0).
    expect(findChar(next, "A").pos).toEqual({ x: 3, y: 0 });
  });

  it("toward 'Corpse_Camper' resolves via displayName lookup when corpse.characterId is opaque (production shape)", () => {
    const a = makeCharacter({
      id: "char_opaque_a",
      displayName: "Rat",
      pos: { x: 0, y: 0 },
    });
    // Production shape: corpse.characterId is the engine `_id`, not displayName.
    const state = makeState({
      characters: [a],
      world: {
        corpses: [
          {
            characterId: "char_opaque_e",
            pos: { x: 5, y: 0 },
            contents: { weapon: { category: "weapon", name: "axe" } },
          },
        ],
      },
    });
    // Push a dead character so the displayName→characterId lookup resolves.
    const dead: CharacterState = {
      characterId: "char_opaque_e",
      personaId: "rat",
      spawnIndex: 4,
      displayName: "Camper",
      hp: 0,
      maxHp: 100,
      pos: { x: 5, y: 0 },
      equipped: {},
      scratchpad: "",
      hidden: false,
      alive: false,
      lastKnown: [],
    };
    state.characters.push(dead);
    const decisions = new Map<string, ParsedDecision>([
      [
        "char_opaque_a",
        moveDecision({
          kind: "toward",
          targetId: "Corpse_Camper",
        }),
      ],
      ["char_opaque_e", noMoveDecision()],
    ]);
    const { state: next } = simulateMovement(state, decisions);
    expect(findChar(next, "char_opaque_a").pos).toEqual({ x: 3, y: 0 });
  });
});
