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

function moveDecision(move: ParsedDecision["move"]): ParsedDecision {
  return {
    consume: "none",
    primary: "move",
    move,
    action: { kind: "none" },
    say: null,
    overwatch_stance: null,
    scratchpad_update: null,
  };
}

function noMoveDecision(): ParsedDecision {
  return {
    consume: "none",
    primary: "stationary_action",
    move: { kind: "none" },
    action: { kind: "none" },
    say: null,
    overwatch_stance: null,
    scratchpad_update: null,
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

// ─── §10 target movement tracks current position ─────────────────────────

describe("WP7 movement — concept-spec §10", () => {
  it("§10 — toward Player_N tracks target's CURRENT position substep-by-substep", () => {
    // A at (0,0), B at (10,0). Both decide:
    //   A: toward Player_2
    //   B: relative (5, 0)  (moves east; A must keep tracking)
    // Expected: A moves 8 east; B moves 5 east. After substep loop, A
    // should be at (8,0), B at (15,0). Chebyshev between A and B is 7.
    const a = makeCharacter({
      id: "A",
      displayName: "Player_1",
      pos: { x: 0, y: 0 },
    });
    const b = makeCharacter({
      id: "opaque_b",
      displayName: "Player_2",
      pos: { x: 10, y: 0 },
    });
    const state = makeState({ characters: [a, b] });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "toward", targetId: "Player_2" })],
      ["opaque_b", moveDecision({ kind: "relative", dx: 5, dy: 0 })],
    ]);
    const { state: next } = simulateMovement(state, decisions);
    expect(findChar(next, "A").pos).toEqual({ x: 8, y: 0 });
    expect(findChar(next, "opaque_b").pos).toEqual({ x: 15, y: 0 });
  });

  it("§10 — cached Player_N target keeps tracking after current LOS would drop", () => {
    const a = makeCharacter({
      id: "A",
      displayName: "Player_1",
      pos: { x: 0, y: 0 },
    });
    const b = makeCharacter({
      id: "opaque_b",
      displayName: "Player_2",
      pos: { x: 30, y: 0 },
    });
    const state = makeState({ characters: [a, b] });
    const mover: Mover = {
      characterId: "A",
      budget: 8,
      decision: moveDecision({ kind: "toward", targetId: "Player_2" }),
      resolvedTarget: {
        kind: "character",
        tile: { x: 20, y: 0 },
        stopAtRange: 2,
        engineRef: { characterId: "opaque_b" },
      },
      dxRemaining: 0,
      dyRemaining: 0,
    };

    expect(desiredNextTile(state, mover)).toEqual({ x: 1, y: 0 });
  });

  it("§10 — toward Player_N stops at Chebyshev 2 (interaction range)", () => {
    // A at (0,0), B at (5,0), B does not move.
    // A moves toward B; should stop within Chebyshev 2 → at (3,0).
    const a = makeCharacter({
      id: "A",
      displayName: "Player_1",
      pos: { x: 0, y: 0 },
    });
    const b = makeCharacter({
      id: "opaque_b",
      displayName: "Player_4",
      pos: { x: 5, y: 0 },
    });
    const state = makeState({ characters: [a, b] });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "toward", targetId: "Player_4" })],
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
      displayName: "Player_1",
      pos: { x: 0, y: 0 },
    });
    const b = makeCharacter({
      id: "opaque_b",
      displayName: "Player_2",
      pos: { x: 20, y: 0 },
    });
    const state = makeState({ characters: [a, b] });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "toward", targetId: "Player_2" })],
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
      displayName: "Player_1",
      pos: { x: 0, y: 0 },
    });
    const b = makeCharacter({
      id: "opaque_b",
      displayName: "Player_2",
      pos: { x: 20, y: 0 },
    });
    const c = makeCharacter({
      id: "C",
      displayName: "Player_3",
      pos: { x: 5, y: 5 },
    });
    const state = makeState({ characters: [a, b, c] });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "toward", targetId: "Player_2" })],
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
      ["A", moveDecision({ kind: "toward", targetId: "Evac" })],
    ]);
    const { state: next } = simulateMovement(state, decisions);
    expect(findChar(next, "A").pos).toEqual({ x: 8, y: 8 });
  });

  it("§10 — relative move clamped to budget; budget=8 default", () => {
    // dx=20, dy=0 — clamped to budget=8. Result: (8,0).
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const state = makeState({ characters: [a] });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "relative", dx: 20, dy: 0 })],
    ]);
    const { state: next } = simulateMovement(state, decisions);
    expect(findChar(next, "A").pos).toEqual({ x: 8, y: 0 });
  });

  it("§10 — relative diagonal move within budget reaches exact target", () => {
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const state = makeState({ characters: [a] });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "relative", dx: 3, dy: 5 })],
    ]);
    const { state: next } = simulateMovement(state, decisions);
    expect(findChar(next, "A").pos).toEqual({ x: 3, y: 5 });
  });

  it("§10 — toward Chest_NNN uses static chest position and stops at Chebyshev 2", () => {
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const state = makeState({
      characters: [a],
      world: {
        chests: [
          {
            id: "chest_001",
            pos: { x: 5, y: 0 },
            contents: { category: "weapon", name: "sword" },
            opened: false,
            lootTable: "starter",
          },
        ],
      },
    });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "toward", targetId: "Chest_001" })],
    ]);
    const { state: next } = simulateMovement(state, decisions);
    // Stops at Chebyshev 2 from chest at (5,0): A ends at (3,0).
    expect(findChar(next, "A").pos).toEqual({ x: 3, y: 0 });
  });

  it("§10 — away Player_N moves to increase Chebyshev distance", () => {
    const a = makeCharacter({
      id: "A",
      displayName: "Player_1",
      pos: { x: 5, y: 5 },
    });
    const b = makeCharacter({
      id: "opaque_b",
      displayName: "Player_2",
      pos: { x: 5, y: 6 },
    });
    const state = makeState({ characters: [a, b] });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "away", targetId: "Player_2" })],
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
  it("toward Corpse_Player_N halts at corpse loot range 2", () => {
    const actor = makeCharacter({
      id: "A",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
    });
    const dead = makeCharacter({
      id: "dead_5",
      displayName: "Player_5",
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
      ["A", moveDecision({ kind: "toward", targetId: "Corpse_Player_5" })],
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
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
    });
    const cover = { x: 54, y: 42 };
    const state = makeState({
      characters: [actor],
      world: { coverTiles: [cover] },
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
      displayName: "Player_1",
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
      displayName: "Player_1",
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

  it("toward Evac walks onto evac.centre when revealed and within budget", () => {
    const actor = makeCharacter({
      id: "A",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
    });
    const state = makeState({
      characters: [actor],
      world: { evac: { centre: { x: 54, y: 54 }, revealedAtTurn: 30 } },
    });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "toward", targetId: "Evac" })],
    ]);

    const { state: next } = simulateMovement(state, decisions);

    expect(findChar(next, "A").pos).toEqual({ x: 54, y: 54 });
  });

  it("away Player_N preserves the deterministic +x tie-break when actor is on the target tile", () => {
    const actor = makeCharacter({
      id: "A",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
    });
    const target = makeCharacter({
      id: "opaque_target",
      displayName: "Player_4",
      pos: { x: 50, y: 50 },
    });
    const state = makeState({ characters: [actor, target] });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "away", targetId: "Player_4" })],
      ["opaque_target", noMoveDecision()],
    ]);

    const { state: next } = simulateMovement(state, decisions);

    expect(findChar(next, "A").pos).toEqual({ x: 58, y: 50 });
  });

  it("away Cover_X_Y moves opposite from a cover tile", () => {
    const actor = makeCharacter({
      id: "A",
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
    });
    const state = makeState({
      characters: [actor],
      world: { coverTiles: [{ x: 50, y: 50 }] },
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
      displayName: "Player_1",
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
      displayName: "Player_1",
      pos: { x: 50, y: 50 },
    });
    const state = makeState({
      characters: [actor],
      world: { evac: { centre: { x: 48, y: 50 }, revealedAtTurn: 30 } },
    });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "away", targetId: "Evac" })],
    ]);

    const { state: next } = simulateMovement(state, decisions);

    expect(findChar(next, "A").pos).toEqual({ x: 58, y: 50 });
  });
});

// ─── §24 collisions ──────────────────────────────────────────────────────

describe("WP7 movement — concept-spec §24 collisions", () => {
  it("§24 — two agents into same tile both fail; both stay put for that substep", () => {
    // A at (0,1), B at (2,1). Both move toward (1,1): A relative (1,0),
    // B relative (-1,0). They both try to enter (1,1) on substep 1 → both
    // fail that substep. With movement budget remaining, they may move
    // again — but (1,1) is still contested if both retry. So both end up
    // unable to step.
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 1 } });
    const b = makeCharacter({ id: "B", pos: { x: 2, y: 1 } });
    const state = makeState({ characters: [a, b] });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "relative", dx: 1, dy: 0 })],
      ["B", moveDecision({ kind: "relative", dx: -1, dy: 0 })],
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
    const dA = moveDecision({ kind: "relative", dx: 5, dy: 5 });
    const dB = moveDecision({ kind: "relative", dx: -3, dy: 0 });
    const dC = moveDecision({ kind: "relative", dx: 0, dy: -8 });

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
      ["A", moveDecision({ kind: "relative", dx: 5, dy: 0 })],
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
      ["A", moveDecision({ kind: "relative", dx: 5, dy: 0 })],
      ["B", noMoveDecision()],
    ]);
    const { state: next } = simulateMovement(state, decisions);
    expect(findChar(next, "A").pos).toEqual({ x: 2, y: 0 });
    expect(findChar(next, "B").pos).toEqual({ x: 3, y: 0 });
  });

  it("§24 — path-blocked relative move stops when the next step is blocked", () => {
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
      ["A", moveDecision({ kind: "relative", dx: 8, dy: 0 })],
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
      ["A", moveDecision({ kind: "relative", dx: 2, dy: 0 })],
    ]);
    const { state: next } = simulateMovement(state, decisions);
    expect(findChar(next, "A").pos).toEqual({ x: 2, y: 0 });
  });

  it("§24 — primary !== 'move' yields zero movement budget", () => {
    // Even if move.kind != 'none', when primary === 'stationary_action'
    // the resolver passes a zero-budget movement.
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const state = makeState({ characters: [a] });
    const stationary: ParsedDecision = {
      consume: "none",
      primary: "stationary_action",
      move: { kind: "relative", dx: 5, dy: 0 },
      action: { kind: "none" },
      say: null,
      overwatch_stance: null,
      scratchpad_update: null,
    };
    const decisions = new Map<string, ParsedDecision>([["A", stationary]]);
    const { state: next } = simulateMovement(state, decisions);
    expect(findChar(next, "A").pos).toEqual({ x: 0, y: 0 });
  });

  it("§24 — overwatch primary yields zero movement budget", () => {
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const state = makeState({ characters: [a] });
    const ow: ParsedDecision = {
      consume: "none",
      primary: "overwatch",
      move: { kind: "relative", dx: 5, dy: 0 },
      action: { kind: "none" },
      say: null,
      overwatch_stance: null,
      scratchpad_update: null,
    };
    const decisions = new Map<string, ParsedDecision>([["A", ow]]);
    const { state: next } = simulateMovement(state, decisions);
    expect(findChar(next, "A").pos).toEqual({ x: 0, y: 0 });
  });

  it("§24 — dead character does not move even with a move decision", () => {
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 }, alive: false });
    const state = makeState({ characters: [a] });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "relative", dx: 5, dy: 0 })],
    ]);
    const { state: next } = simulateMovement(state, decisions);
    expect(findChar(next, "A").pos).toEqual({ x: 0, y: 0 });
  });

  it("§24 — moves trace lists from→to for every actually-moved character", () => {
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const b = makeCharacter({ id: "B", pos: { x: 5, y: 5 } });
    const state = makeState({ characters: [a, b] });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "relative", dx: 3, dy: 0 })],
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
  it("wall directly east blocks A's relative-east move → emits {from===to, blockedBy:'wall'}", () => {
    const a = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    // Wall immediately east at (6,5).
    const wall: Wall = { x: 6, y: 5, w: 1, h: 1 };
    const state = makeState({ characters: [a], world: { walls: [wall] } });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "relative", dx: 1, dy: 0 })],
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
        ["A", moveDecision({ kind: "relative", dx: 0, dy: -1 })],
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
        ["A", moveDecision({ kind: "relative", dx: 0, dy: 1 })],
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
        ["A", moveDecision({ kind: "relative", dx: -1, dy: 0 })],
      ]);
      const { moves } = simulateMovement(state, decisions);
      expect(moves).toHaveLength(1);
      expect(moves[0]?.blockedBy).toBe("wall");
    }
    // East already covered above.
  });

  it("wall at NE diagonal blocks dx=1,dy=-1 diagonal step → emits blockedBy='wall'", () => {
    const a = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    // Wall directly NE at (6,4).
    const wall: Wall = { x: 6, y: 4, w: 1, h: 1 };
    const state = makeState({ characters: [a], world: { walls: [wall] } });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "relative", dx: 1, dy: -1 })],
    ]);
    const { moves } = simulateMovement(state, decisions);
    expect(moves).toHaveLength(1);
    expect(moves[0]?.blockedBy).toBe("wall");
  });

  it("no-move decision (move.kind='none') emits NOTHING (no blockedBy entry)", () => {
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
      ["A", moveDecision({ kind: "relative", dx: 1, dy: 0 })],
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
      ["A", moveDecision({ kind: "relative", dx: -1, dy: 0 })],
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
      ["A", moveDecision({ kind: "relative", dx: 5, dy: 0 })],
    ]);
    const { moves } = simulateMovement(state, decisions);
    const move = moves.find((m) => m.characterId === "A");
    expect(move).toBeDefined();
    expect(move?.from).toEqual({ x: 5, y: 5 });
    expect(move?.to).toEqual({ x: 7, y: 5 });
    expect(move?.blockedBy).toBeUndefined();
  });
});

// ─── WP-G.1 Corpse_Player_N typed-id routing — D38 PM-lock ───────────────
//
// Reviewer-B HIGH-1: digest renders `Corpse_Player_N` typed-id. The movement
// resolver must route that id to the corpse tile through the shared typed-id
// helper, not through category-specific move arms.
// PM-lock D38: fix at engine boundary; do NOT change digest rendering.

describe("WP-G.1 Corpse_Player_N typed-id movement routing — D38", () => {
  it("toward 'Corpse_Player_N' routes toward corpse tile (test-fixture: characterId === Player_N)", () => {
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const dead = makeCharacter({
      id: "Player_5",
      displayName: "Player_5",
      pos: { x: 5, y: 0 },
      alive: false,
    });
    const state = makeState({
      characters: [a, dead],
      world: {
        corpses: [
          {
            characterId: "Player_5",
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
          targetId: "Corpse_Player_5",
        }),
      ],
      ["Player_5", noMoveDecision()],
    ]);
    const { state: next } = simulateMovement(state, decisions);
    // Corpse stopAtRange is 2: A ends at (3,0).
    expect(findChar(next, "A").pos).toEqual({ x: 3, y: 0 });
  });

  it("toward 'Corpse_Player_N' resolves via displayName lookup when corpse.characterId is opaque (production shape)", () => {
    const a = makeCharacter({
      id: "char_opaque_a",
      displayName: "Player_1",
      pos: { x: 0, y: 0 },
    });
    // Production shape: corpse.characterId is the engine `_id`, not Player_N.
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
      displayName: "Player_5",
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
          targetId: "Corpse_Player_5",
        }),
      ],
      ["char_opaque_e", noMoveDecision()],
    ]);
    const { state: next } = simulateMovement(state, decisions);
    expect(findChar(next, "char_opaque_a").pos).toEqual({ x: 3, y: 0 });
  });
});
