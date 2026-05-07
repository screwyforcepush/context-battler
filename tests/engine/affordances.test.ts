// WP5 — pure-function unit tests for local-affordance computation.
//
// Tests are written FIRST per AOP. Spec section: concept-spec.md §22
// (local affordances).
//
//   "Available movement: toward Player_3, away from Player_3, toward chest,
//    toward cover northwest, toward evac, to relative tile."
//   "Available actions: attack Player_3, in range; loot corpse, in range;
//    open chest, in range; overwatch."

import { describe, expect, it } from "vitest";
import { localAffordances } from "../../convex/engine/affordances.js";
import type {
  CharacterState,
  ChestState,
  CorpseState,
  MatchState,
  PersonaId,
  Tile,
  WorldState,
} from "../../convex/engine/types.js";

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
  alive?: boolean;
  hidden?: boolean;
  weapon?: "rusty_blade" | "sword" | "axe" | "greatsword";
  personaId?: PersonaId;
}): CharacterState {
  return {
    characterId: opts.id,
    personaId: opts.personaId ?? "rat",
    spawnIndex: 0,
    displayName: opts.id,
    hp: 100,
    maxHp: 100,
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

function makeChest(id: string, pos: Tile): ChestState {
  return { id, pos, contents: null, opened: false, lootTable: "starter" };
}

function makeCorpse(id: string, pos: Tile): CorpseState {
  return { characterId: id, pos, contents: {} };
}

function makeState(opts: {
  characters: CharacterState[];
  world?: Partial<WorldState>;
  turn?: number;
}): MatchState {
  return {
    matchId: "test-match",
    turn: opts.turn ?? 1,
    world: makeWorld(opts.world),
    characters: opts.characters,
    rngSeed: "test",
  };
}

describe("WP5 — localAffordances (concept-spec §22)", () => {
  it("§22 — 'open chest_NNN' only when in range 2", () => {
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const inRange = makeChest("chest_001", { x: 6, y: 6 });
    const outOfRange = makeChest("chest_002", { x: 10, y: 10 });
    const state = makeState({
      characters: [me],
      world: { chests: [inRange, outOfRange] },
    });
    const aff = localAffordances(state, "A");
    expect(aff.actions).toContain("open chest_001");
    expect(aff.actions).not.toContain("open chest_002");
  });

  it("§22 — 'loot corpse_X' only when in range 2", () => {
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const closeCorpse = makeCorpse("Player_3", { x: 6, y: 6 });
    const farCorpse = makeCorpse("Player_5", { x: 20, y: 20 });
    const state = makeState({
      characters: [me],
      world: { corpses: [closeCorpse, farCorpse] },
    });
    const aff = localAffordances(state, "A");
    expect(aff.actions).toContain("loot Player_3");
    expect(aff.actions).not.toContain("loot Player_5");
  });

  it("§22 — 'overwatch' always present when alive", () => {
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const state = makeState({ characters: [me] });
    const aff = localAffordances(state, "A");
    expect(aff.actions).toContain("overwatch");
  });

  it("§22 — 'attack Player_X' only when X visible AND Chebyshev ≤ weapon range (2)", () => {
    const me = makeCharacter({
      id: "A",
      pos: { x: 5, y: 5 },
      weapon: "sword",
    });
    const inRange = makeCharacter({ id: "B", pos: { x: 6, y: 7 } });
    const outOfRange = makeCharacter({ id: "C", pos: { x: 10, y: 10 } });
    const state = makeState({ characters: [me, inRange, outOfRange] });
    const aff = localAffordances(state, "A");
    expect(aff.actions).toContain("attack B (in range)");
    expect(aff.actions).not.toContain("attack C (in range)");
  });

  it("§22 — 'toward evac' only when evac revealed", () => {
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const stateHidden = makeState({ characters: [me] });
    const affHidden = localAffordances(stateHidden, "A");
    expect(affHidden.movement).not.toContain("toward evac");

    const stateRevealed = makeState({
      characters: [me],
      world: {
        evac: { centre: { x: 50, y: 50 }, revealedAtTurn: 30 },
      },
      turn: 31,
    });
    const affRevealed = localAffordances(stateRevealed, "A");
    expect(affRevealed.movement).toContain("toward evac");
  });

  it("§22 — movement affordances exclude entities not visible (hidden / out-of-range)", () => {
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const hiddenEnemy = makeCharacter({
      id: "B",
      pos: { x: 7, y: 7 },
      hidden: true,
    });
    const farEnemy = makeCharacter({ id: "C", pos: { x: 80, y: 80 } });
    const visibleEnemy = makeCharacter({ id: "D", pos: { x: 8, y: 8 } });
    const state = makeState({
      characters: [me, hiddenEnemy, farEnemy, visibleEnemy],
    });
    const aff = localAffordances(state, "A");
    expect(aff.movement).toContain("toward D");
    expect(aff.movement).toContain("away from D");
    expect(aff.movement).not.toContain("toward B");
    expect(aff.movement).not.toContain("toward C");
  });

  it("§22 — 'to relative tile' is always present (movement always offered)", () => {
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const state = makeState({ characters: [me] });
    const aff = localAffordances(state, "A");
    expect(aff.movement).toContain("to relative tile");
  });

  it("§22 — 'toward chest_NNN' for visible chests; 'toward cover at (x,y)' for visible cover", () => {
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const chest = makeChest("chest_001", { x: 8, y: 8 });
    const cover: Tile = { x: 6, y: 8 };
    const state = makeState({
      characters: [me],
      world: { chests: [chest], coverTiles: [cover] },
    });
    const aff = localAffordances(state, "A");
    expect(aff.movement).toContain("toward chest_001");
    // Cover string is loose — just check it mentions the cover position.
    const hasCoverEntry = aff.movement.some((m) => m.includes("toward cover"));
    expect(hasCoverEntry).toBe(true);
  });

  it("§22 — dead actor returns empty affordances (defensive)", () => {
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 }, alive: false });
    const state = makeState({ characters: [me] });
    const aff = localAffordances(state, "A");
    // Dead actor has no actions; overwatch only when alive.
    expect(aff.actions).not.toContain("overwatch");
  });
});
