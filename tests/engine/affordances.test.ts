// WP5 — pure-function unit tests for local-affordance computation.
//
// Tests are written FIRST per AOP. Spec section: concept-spec.md §22
// (local affordances).
//
// WP10.5 — affordance strings emit the schema-aligned vocabulary used by the
// `decide_turn` tool (see `convex/llm/decisionTool.ts`). The affordance
// digest is what the model parrots, so the literal `move.kind` /
// `action.kind` values from the JSON Schema discriminator are surfaced
// directly:
//
//   movement: `toward_entity: P3`, `away_from_entity: P3`,
//             `toward_object: chest_001`, `toward_object: <corpseId>`,
//             `toward_evac`, `relative: dx,dy` (cover/freeform).
//   actions:  `attack: P3 (in range)`, `interact: chest_001`,
//             `loot: <corpseId>`, `overwatch`.

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
  it("§22 — 'interact: chest_NNN' only when in range 2", () => {
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const inRange = makeChest("chest_001", { x: 6, y: 6 });
    const outOfRange = makeChest("chest_002", { x: 10, y: 10 });
    const state = makeState({
      characters: [me],
      world: { chests: [inRange, outOfRange] },
    });
    const aff = localAffordances(state, "A");
    expect(aff.actions).toContain("interact: chest_001");
    expect(aff.actions).not.toContain("interact: chest_002");
  });

  it("§22 — 'loot: <corpseId>' only when in range 2", () => {
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const closeCorpse = makeCorpse("Player_3", { x: 6, y: 6 });
    const farCorpse = makeCorpse("Player_5", { x: 20, y: 20 });
    const state = makeState({
      characters: [me],
      world: { corpses: [closeCorpse, farCorpse] },
    });
    const aff = localAffordances(state, "A");
    expect(aff.actions).toContain("loot: Player_3");
    expect(aff.actions).not.toContain("loot: Player_5");
  });

  it("§22 — 'overwatch' always present when alive", () => {
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const state = makeState({ characters: [me] });
    const aff = localAffordances(state, "A");
    expect(aff.actions).toContain("overwatch");
  });

  it("§22 — 'attack: <id> (in range)' only when X visible AND Chebyshev ≤ weapon range (2)", () => {
    const me = makeCharacter({
      id: "A",
      pos: { x: 5, y: 5 },
      weapon: "sword",
    });
    const inRange = makeCharacter({ id: "B", pos: { x: 6, y: 7 } });
    const outOfRange = makeCharacter({ id: "C", pos: { x: 10, y: 10 } });
    const state = makeState({ characters: [me, inRange, outOfRange] });
    const aff = localAffordances(state, "A");
    expect(aff.actions).toContain("attack: B (in range)");
    expect(aff.actions).not.toContain("attack: C (in range)");
  });

  it("§22 — 'toward_evac' only when evac revealed", () => {
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const stateHidden = makeState({ characters: [me] });
    const affHidden = localAffordances(stateHidden, "A");
    expect(affHidden.movement).not.toContain("toward_evac");

    const stateRevealed = makeState({
      characters: [me],
      world: {
        evac: { centre: { x: 50, y: 50 }, revealedAtTurn: 30 },
      },
      turn: 31,
    });
    const affRevealed = localAffordances(stateRevealed, "A");
    expect(affRevealed.movement).toContain("toward_evac");
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
    expect(aff.movement).toContain("toward_entity: D");
    expect(aff.movement).toContain("away_from_entity: D");
    expect(aff.movement).not.toContain("toward_entity: B");
    expect(aff.movement).not.toContain("toward_entity: C");
  });

  it("§22 — 'relative: dx,dy' freeform option always present (movement always offered)", () => {
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const state = makeState({ characters: [me] });
    const aff = localAffordances(state, "A");
    // The freeform "relative: dx,dy" entry is always emitted; the dx,dy
    // values are placeholders since the model picks them.
    const hasRelative = aff.movement.some((m) => m.startsWith("relative: "));
    expect(hasRelative).toBe(true);
  });

  it("§22 — 'toward_object: chest_NNN' for visible chests; cover renders as 'relative: dx,dy'", () => {
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const chest = makeChest("chest_001", { x: 8, y: 8 });
    const cover: Tile = { x: 6, y: 8 };
    const state = makeState({
      characters: [me],
      world: { chests: [chest], coverTiles: [cover] },
    });
    const aff = localAffordances(state, "A");
    expect(aff.movement).toContain("toward_object: chest_001");
    // Cover tile is offered as a concrete relative move from the actor's
    // position (cover has no dedicated schema literal, so we use `relative:`
    // — the closest schema arm).
    expect(aff.movement).toContain("relative: 1,3");
  });

  it("§22 — 'toward_object: <corpseId>' for visible corpses", () => {
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const corpse = makeCorpse("Player_9", { x: 7, y: 5 });
    const state = makeState({
      characters: [me],
      world: { corpses: [corpse] },
    });
    const aff = localAffordances(state, "A");
    expect(aff.movement).toContain("toward_object: Player_9");
  });

  it("§22 — 'overwatch' literal stays as the bare 'overwatch' token (no schema prefix)", () => {
    // overwatch is a primary commitment, not an action.kind. The affordance
    // string must remain the bare token so callers/agents can pattern-match
    // on it without confusing it with action.kind literals.
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const state = makeState({ characters: [me] });
    const aff = localAffordances(state, "A");
    expect(aff.actions).toContain("overwatch");
  });

  it("§22 — dead actor returns empty affordances (defensive)", () => {
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 }, alive: false });
    const state = makeState({ characters: [me] });
    const aff = localAffordances(state, "A");
    // Dead actor has no actions; overwatch only when alive.
    expect(aff.actions).not.toContain("overwatch");
  });

  // WP10.5 Pass B.1 — opened chests must NOT appear in movement affordances.
  // Phase A finding: 62.2% of fallbacks were validator-rejections caused by
  // personas hammering already-opened chests. The action arm at
  // affordances.ts:145-147 already filters opened chests; the movement arm
  // must mirror that filter so personas don't keep walking toward consumed
  // chests turn after turn. (concept-spec §13 — chests are one-shot.)
  it("WP10.5 B.1 — opened chest does NOT emit a 'toward_object: <chestId>' movement affordance", () => {
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const openedChest: ChestState = {
      ...makeChest("chest_001", { x: 8, y: 8 }),
      opened: true,
    };
    const state = makeState({
      characters: [me],
      world: { chests: [openedChest] },
    });
    const aff = localAffordances(state, "A");
    expect(aff.movement).not.toContain("toward_object: chest_001");
    // Sanity: the action arm already filters opened chests; re-verify.
    expect(aff.actions).not.toContain("interact: chest_001");
  });

  it("WP10.5 B.1 — closed chest still emits 'toward_object: <chestId>' movement affordance", () => {
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const closedChest = makeChest("chest_002", { x: 8, y: 8 });
    const state = makeState({
      characters: [me],
      world: { chests: [closedChest] },
    });
    const aff = localAffordances(state, "A");
    expect(aff.movement).toContain("toward_object: chest_002");
  });

  it("WP10.5 B.1 — mixed opened+closed chests: only closed chest emits movement affordance", () => {
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const opened: ChestState = {
      ...makeChest("chest_001", { x: 7, y: 7 }),
      opened: true,
    };
    const closed = makeChest("chest_002", { x: 8, y: 8 });
    const state = makeState({
      characters: [me],
      world: { chests: [opened, closed] },
    });
    const aff = localAffordances(state, "A");
    expect(aff.movement).not.toContain("toward_object: chest_001");
    expect(aff.movement).toContain("toward_object: chest_002");
  });
});
