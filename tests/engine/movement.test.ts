// WP7 — Movement substep loop tests (TDD: RED phase first).
//
// Spec sections:
//   - concept-spec.md §10 (movement options; entity-tracking; mid-movement
//     no-retarget; toward-evac after reveal)
//   - concept-spec.md §24 (collision: same-tile both fail; movement bounded
//     by terrain; cover walkable)
//   - concept-spec.md §4 (movement budget = 8 default; speed consumable = 12)

import { describe, expect, it } from "vitest";
import { simulateMovement } from "../../convex/engine/movement.js";
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
  hp?: number;
  alive?: boolean;
  consumable?: ItemRef;
  personaId?: PersonaId;
}): CharacterState {
  return {
    characterId: opts.id,
    personaId: opts.personaId ?? "rat",
    spawnIndex: 0,
    displayName: opts.id,
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

// ─── §10 entity-targeted movement tracks current position ────────────────

describe("WP7 movement — concept-spec §10", () => {
  it("§10 — toward_entity tracks target's CURRENT position substep-by-substep", () => {
    // A at (0,0), B at (10,0). Both decide:
    //   A: toward_entity B
    //   B: relative (5, 0)  (moves east; A must keep tracking)
    // Expected: A moves 8 east; B moves 5 east. After substep loop, A
    // should be at (8,0), B at (15,0). Chebyshev between A and B is 7.
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const b = makeCharacter({ id: "B", pos: { x: 10, y: 0 } });
    const state = makeState({ characters: [a, b] });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "toward_entity", targetCharacterId: "B" })],
      ["B", moveDecision({ kind: "relative", dx: 5, dy: 0 })],
    ]);
    const { state: next } = simulateMovement(state, decisions);
    expect(findChar(next, "A").pos).toEqual({ x: 8, y: 0 });
    expect(findChar(next, "B").pos).toEqual({ x: 15, y: 0 });
  });

  it("§10 — toward_entity stops at Chebyshev 2 (interaction range)", () => {
    // A at (0,0), B at (5,0), B does not move.
    // A moves toward B; should stop within Chebyshev 2 → at (3,0).
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const b = makeCharacter({ id: "B", pos: { x: 5, y: 0 } });
    const state = makeState({ characters: [a, b] });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "toward_entity", targetCharacterId: "B" })],
      ["B", noMoveDecision()],
    ]);
    const { state: next } = simulateMovement(state, decisions);
    const aFinal = findChar(next, "A");
    // A should stop at distance ≤ 2 from B's actual final position.
    expect(Math.max(Math.abs(aFinal.pos.x - 5), Math.abs(aFinal.pos.y - 0))).toBeLessThanOrEqual(2);
    expect(Math.max(Math.abs(aFinal.pos.x - 5), Math.abs(aFinal.pos.y - 0))).toBeGreaterThanOrEqual(2);
  });

  it("§10 — speed consumable bumps movement budget to 12 this turn", () => {
    // Caller signals via `speedActiveIds` — the resolver applies consumables
    // in phase 2 then passes the set to phase 4.
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const b = makeCharacter({ id: "B", pos: { x: 30, y: 0 } });
    const state = makeState({ characters: [a, b] });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "toward_entity", targetCharacterId: "B" })],
      ["B", noMoveDecision()],
    ]);
    const { state: next } = simulateMovement(state, decisions, {
      speedActiveIds: new Set(["A"]),
    });
    expect(findChar(next, "A").pos).toEqual({ x: 12, y: 0 });
  });

  it("§10 — agent does NOT retarget on new enemy mid-movement", () => {
    // A moving toward original target B. C enters near A's path. A must
    // continue toward B, not retarget to C.
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const b = makeCharacter({ id: "B", pos: { x: 20, y: 0 } });
    const c = makeCharacter({ id: "C", pos: { x: 5, y: 5 } });
    const state = makeState({ characters: [a, b, c] });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "toward_entity", targetCharacterId: "B" })],
      ["B", noMoveDecision()],
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

  it("§10 — toward_evac uses evac.centre", () => {
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const state = makeState({
      characters: [a],
      world: { evac: { centre: { x: 50, y: 50 }, revealedAtTurn: 30 } },
    });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "toward_evac" })],
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

  it("§10 — toward_object uses static chest position", () => {
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
      ["A", moveDecision({ kind: "toward_object", targetObjectId: "chest_001" })],
    ]);
    const { state: next } = simulateMovement(state, decisions);
    // Stops at Chebyshev 2 from chest at (5,0): A ends at (3,0).
    expect(findChar(next, "A").pos).toEqual({ x: 3, y: 0 });
  });

  it("§10 — away_from_entity moves to increase Chebyshev distance", () => {
    const a = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const b = makeCharacter({ id: "B", pos: { x: 5, y: 6 } });
    const state = makeState({ characters: [a, b] });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "away_from_entity", targetCharacterId: "B" })],
      ["B", noMoveDecision()],
    ]);
    const { state: next } = simulateMovement(state, decisions);
    const aFinal = findChar(next, "A");
    // A should move away from B (north). Distance must increase.
    expect(Math.max(Math.abs(aFinal.pos.x - 5), Math.abs(aFinal.pos.y - 6))).toBeGreaterThan(1);
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

  it("§24 — path-blocked-target: agent moves as far as it can, stops when no progress", () => {
    // A at (0,0), wants to reach chest at (10,0), wall at (4,0,1,1).
    // A should advance to (3,0) and stop (cannot go around in straight-line v0).
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const wall: Wall = { x: 4, y: 0, w: 1, h: 1 };
    const state = makeState({
      characters: [a],
      world: {
        walls: [wall],
        chests: [
          {
            id: "c1",
            pos: { x: 10, y: 0 },
            contents: null,
            opened: false,
            lootTable: "starter",
          },
        ],
      },
    });
    const decisions = new Map<string, ParsedDecision>([
      ["A", moveDecision({ kind: "toward_object", targetObjectId: "c1" })],
    ]);
    const { state: next } = simulateMovement(state, decisions);
    // The agent could try diagonals (e.g., (3,1), (4,1) bypassing the wall).
    // Implementation choice: greedy step toward target — if blocked, try
    // axis-aligned alternatives. For this test we accept either (3,0) or
    // a diagonal detour, but assert the agent did NOT pass through the wall.
    const aFinal = findChar(next, "A");
    // Final must not be in wall.
    expect(
      aFinal.pos.x === 4 && aFinal.pos.y === 0,
    ).toBe(false);
    // Final must be within budget=8 Chebyshev of start.
    expect(
      Math.max(Math.abs(aFinal.pos.x - 0), Math.abs(aFinal.pos.y - 0)),
    ).toBeLessThanOrEqual(8);
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
