// WP5 — pure-function unit tests for decision validation.
//
// Tests are written FIRST per AOP. Spec sections: ADR §4 (ParsedDecision
// shape), concept-spec §10 (movement bounds), §12 (attack range), §13
// (interact/loot range 2), §15 (evac reveal at turn 30).
//
// The validator's job: take a parsed decision (already shape-validated by
// Zod in WP6) and assert it makes sense against the current MatchState.
// On any failure, zero only the invalid field and return its message in
// `fieldErrors`.

import { describe, expect, it } from "vitest";
import { validateDecision } from "../../convex/engine/validation.js";
import {
  SAFE_DEFAULT_DECISION,
  type CharacterState,
  type ChestState,
  type CorpseState,
  type MatchState,
  type ParsedDecision,
  type PersonaId,
  type Tile,
  type WorldState,
} from "../../convex/engine/types.js";

// ─── Fixture builders ──────────────────────────────────────────────────────

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
  hp?: number;
  alive?: boolean;
  hidden?: boolean;
  weapon?: "rusty_blade" | "sword" | "axe" | "greatsword";
  consumable?: "heal" | "speed";
  personaId?: PersonaId;
}): CharacterState {
  const equipped: CharacterState["equipped"] = {};
  if (opts.weapon) equipped.weapon = { category: "weapon", name: opts.weapon };
  if (opts.consumable)
    equipped.consumable = { category: "consumable", name: opts.consumable };
  return {
    characterId: opts.id,
    personaId: opts.personaId ?? "rat",
    spawnIndex: 0,
    displayName: opts.id,
    hp: opts.hp ?? 100,
    maxHp: 100,
    pos: opts.pos,
    equipped,
    scratchpad: "",
    hidden: opts.hidden ?? false,
    alive: opts.alive ?? true,
    lastKnown: [],
  };
}

function makeChest(id: string, pos: Tile, opened = false): ChestState {
  return { id, pos, contents: null, opened, lootTable: "starter" };
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

function defaultDecision(): ParsedDecision {
  return {
    use: null,
    position: { kind: "move", direction: { kind: "N" }, dist: 0 },
    action: { kind: "none" },
    say: null,
    scratchpad: null,
  };
}

function moveTargetNotVisibleReason(targetId: string): string {
  return `position.direction target '${targetId}' is not visible to actor`;
}

function makeVisibleMoveTargetState(): MatchState {
  const actor = makeCharacter({ id: "Rat", pos: { x: 50, y: 50 } });
  const duelist = makeCharacter({ id: "Duelist", pos: { x: 54, y: 50 } });
  const deadCamper = makeCharacter({
    id: "Camper",
    pos: { x: 58, y: 51 },
    hp: 0,
    alive: false,
  });

  return makeState({
    characters: [actor, duelist, deadCamper],
    world: {
      chests: [makeChest("Chest_56_50", { x: 56, y: 50 })],
      corpses: [makeCorpse("Camper", { x: 58, y: 50 })],
      coverTiles: [{ x: 54, y: 42 }],
      walls: [{ x: 64, y: 30, w: 1, h: 1 }],
      evac: { centre: { x: 52, y: 52 }, revealedAtTurn: 30 },
    },
    turn: 31,
  });
}

function makeMoveRejectionState(): MatchState {
  const actor = makeCharacter({ id: "Rat", pos: { x: 50, y: 50 } });
  const outOfVisionDuelist = makeCharacter({
    id: "Duelist",
    pos: { x: 80, y: 50 },
  });
  const deadTrader = makeCharacter({
    id: "Trader",
    pos: { x: 54, y: 50 },
    hp: 0,
    alive: false,
  });
  const corpseOwner = makeCharacter({
    id: "Camper",
    pos: { x: 80, y: 51 },
    hp: 0,
    alive: false,
  });

  return makeState({
    characters: [actor, outOfVisionDuelist, deadTrader, corpseOwner],
    world: {
      chests: [makeChest("Chest_80_50", { x: 80, y: 50 })],
      corpses: [makeCorpse("Camper", { x: 80, y: 50 })],
      coverTiles: [{ x: 80, y: 50 }],
      walls: [{ x: 80, y: 51, w: 1, h: 1 }],
      evac: { centre: { x: 52, y: 52 }, revealedAtTurn: null },
    },
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("WP5 — validateDecision (ADR §4)", () => {
  it("ADR §4 — negative position distance → field default with reason", () => {
    const me = makeCharacter({ id: "A", pos: { x: 50, y: 50 } });
    const state = makeState({ characters: [me] });
    const decision: ParsedDecision = {
      ...defaultDecision(),
      position: { kind: "move", direction: { kind: "E" }, dist: -1 },
    };
    const result = validateDecision(state, "A", decision);
    expect(result.fieldErrors.position).toMatch(/non-negative integer/i);
    expect(result.decision.position).toEqual(SAFE_DEFAULT_DECISION.position);
    expect(result.decision.action).toEqual(decision.action);
  });

  it("§12 — attack on dead target → action field default", () => {
    const me = makeCharacter({
      id: "A",
      pos: { x: 5, y: 5 },
      weapon: "sword",
    });
    const dead = makeCharacter({
      id: "B",
      pos: { x: 6, y: 6 },
      alive: false,
    });
    const state = makeState({ characters: [me, dead] });
    const decision: ParsedDecision = {
      ...defaultDecision(),
      action: { kind: "attack", targetId: "B" },
    };
    const result = validateDecision(state, "A", decision);
    expect(result.fieldErrors.action).toMatch(/living|visible/i);
    expect(result.decision.action).toEqual({ kind: "none" });
    expect(result.decision.position).toEqual(decision.position);
  });

  it("§13 — loot chest out of range 2 → action field default", () => {
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const chest = makeChest("Chest_50_50", { x: 50, y: 50 });
    const state = makeState({
      characters: [me],
      world: { chests: [chest] },
    });
    const decision: ParsedDecision = {
      ...defaultDecision(),
      action: { kind: "loot", targetId: "Chest_50_50" },
    };
    const result = validateDecision(state, "A", decision);
    expect(result.fieldErrors.action).toMatch(/range|chest/i);
    expect(result.decision.action).toEqual({ kind: "none" });
  });

  describe("Phase 05 WP-B — move target visibility gate", () => {
    it.each([
      "Duelist",
      "Chest_56_50",
      "Corpse_Camper",
      "Cover_54_42",
      "Wall_64_30",
      "Evac_51_51_to_53_53",
    ])("move.toward targetId='%s' visible → valid", (targetId) => {
      const state = makeVisibleMoveTargetState();
      const decision: ParsedDecision = {
        ...defaultDecision(),
        position: { kind: "move", direction: { kind: "toward", targetId }, dist: 8 },
      };

      const result = validateDecision(state, "Rat", decision);

      expect(result.fieldErrors).toEqual({});
      expect(result.decision).toEqual(decision);
    });

    it.each([
      "Duelist",
      "Chest_56_50",
      "Corpse_Camper",
      "Cover_54_42",
      "Wall_64_30",
      "Evac_51_51_to_53_53",
    ])("move.away targetId='%s' visible → valid", (targetId) => {
      const state = makeVisibleMoveTargetState();
      const decision: ParsedDecision = {
        ...defaultDecision(),
        position: { kind: "move", direction: { kind: "away", targetId }, dist: 8 },
      };

      const result = validateDecision(state, "Rat", decision);

      expect(result.fieldErrors).toEqual({});
      expect(result.decision).toEqual(decision);
    });

    it.each([
      ["Duelist", "out-of-vision player"],
      ["Chest_80_50", "out-of-vision chest"],
      ["Corpse_Camper", "out-of-vision corpse"],
      ["Cover_80_50", "out-of-vision cover"],
      ["Wall_80_51", "out-of-vision wall"],
      ["Trader", "dead player"],
      ["Evac_51_51_to_53_53", "unrevealed evac"],
      ["UnknownPersona", "unknown player"],
      ["Random_42", "unknown namespace"],
      ["Cover_foo_bar", "malformed cover id"],
    ])(
      "move.toward targetId='%s' (%s) → canonical visibility reason",
      (targetId) => {
        const state = makeMoveRejectionState();
        const decision: ParsedDecision = {
          ...defaultDecision(),
          position: { kind: "move", direction: { kind: "toward", targetId }, dist: 8 },
        };

        const result = validateDecision(state, "Rat", decision);

        expect(result.fieldErrors.position).toBe(
          moveTargetNotVisibleReason(targetId),
        );
        expect(result.decision.position).toEqual(SAFE_DEFAULT_DECISION.position);
      },
    );

    it.each([
      "Duelist",
      "Chest_80_50",
      "Corpse_Camper",
      "Cover_80_50",
      "Wall_80_51",
      "Trader",
      "Evac_51_51_to_53_53",
      "UnknownPersona",
      "Random_42",
      "Cover_foo_bar",
    ])("move.away targetId='%s' → canonical visibility reason", (targetId) => {
      const state = makeMoveRejectionState();
      const decision: ParsedDecision = {
        ...defaultDecision(),
        position: { kind: "move", direction: { kind: "away", targetId }, dist: 8 },
      };

      const result = validateDecision(state, "Rat", decision);

      expect(result.fieldErrors.position).toBe(
        moveTargetNotVisibleReason(targetId),
      );
      expect(result.decision.position).toEqual(SAFE_DEFAULT_DECISION.position);
    });
  });

  it("ADR §6 — use='consumable' without equipped consumable → use field default", () => {
    // Actor has no consumable.
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const state = makeState({ characters: [me] });
    const decision: ParsedDecision = {
      ...defaultDecision(),
      use: "consumable",
    };
    const result = validateDecision(state, "A", decision);
    expect(result.fieldErrors.use).toMatch(/consumable/i);
    expect(result.decision.use).toBeNull();
    expect(result.decision.position).toEqual(decision.position);

    // Actor has speed; the model only names the equipped slot.
    const meSpeed = makeCharacter({
      id: "A",
      pos: { x: 5, y: 5 },
      consumable: "speed",
    });
    const stateSpeed = makeState({ characters: [meSpeed] });
    const result2 = validateDecision(stateSpeed, "A", decision);
    expect(result2.fieldErrors).toEqual({});
    expect(result2.decision).toEqual(decision);
  });

  it("ADR §4 — valid decision passes through unchanged", () => {
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const state = makeState({ characters: [me] });
    const decision: ParsedDecision = {
      ...defaultDecision(),
      position: { kind: "move", direction: { kind: "NW" }, dist: 3 },
    };
    const result = validateDecision(state, "A", decision);
    expect(result.fieldErrors).toEqual({});
    expect(result.decision).toEqual(decision);
  });

  it("§12 — attack on visible-in-range alive target → valid", () => {
    const me = makeCharacter({
      id: "A",
      pos: { x: 5, y: 5 },
      weapon: "sword",
    });
    const target = makeCharacter({ id: "B", pos: { x: 6, y: 6 } });
    const state = makeState({ characters: [me, target] });
    const decision: ParsedDecision = {
      ...defaultDecision(),
      action: { kind: "attack", targetId: "B" },
    };
    const result = validateDecision(state, "A", decision);
    expect(result.fieldErrors).toEqual({});
    expect(result.decision).toEqual(decision);
  });

  it("§13 — interact on chest in range → valid", () => {
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const chest = makeChest("Chest_6_6", { x: 6, y: 6 });
    const state = makeState({
      characters: [me],
      world: { chests: [chest] },
    });
    const decision: ParsedDecision = {
      ...defaultDecision(),
      action: { kind: "loot", targetId: "Chest_6_6" },
    };
    const result = validateDecision(state, "A", decision);
    expect(result.fieldErrors).toEqual({});
    expect(result.decision).toEqual(decision);
  });

  it("§13 — loot corpse out of range → safe-default", () => {
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const corpse = makeCorpse("Camper", { x: 50, y: 50 });
    const state = makeState({
      characters: [me],
      world: { corpses: [corpse] },
    });
    const decision: ParsedDecision = {
      ...defaultDecision(),
      action: { kind: "loot", targetId: "Corpse_Camper" },
    };
    const result = validateDecision(state, "A", decision);
    expect(result.fieldErrors.action).toBeDefined();
    expect(result.decision.action).toEqual({ kind: "none" });
  });

  it("§13 — loot corpse in range → valid", () => {
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const corpse = makeCorpse("Camper", { x: 6, y: 6 });
    const state = makeState({
      characters: [me],
      world: { corpses: [corpse] },
    });
    const decision: ParsedDecision = {
      ...defaultDecision(),
      action: { kind: "loot", targetId: "Corpse_Camper" },
    };
    const result = validateDecision(state, "A", decision);
    expect(result.fieldErrors).toEqual({});
    expect(result.decision).toEqual(decision);
  });

  it("§7 — attack on hidden target (not visible) → safe-default", () => {
    const me = makeCharacter({
      id: "A",
      pos: { x: 5, y: 5 },
      weapon: "sword",
    });
    const hidden = makeCharacter({
      id: "B",
      pos: { x: 6, y: 6 },
      hidden: true,
    });
    const state = makeState({ characters: [me, hidden] });
    const decision: ParsedDecision = {
      ...defaultDecision(),
      action: { kind: "attack", targetId: "B" },
    };
    const result = validateDecision(state, "A", decision);
    expect(result.fieldErrors.action).toBeDefined();
    expect(result.decision.action).toEqual({ kind: "none" });
  });

  it("ADR §6 — use='consumable' with equipped consumable → valid", () => {
    const me = makeCharacter({
      id: "A",
      pos: { x: 5, y: 5 },
      consumable: "heal",
    });
    const state = makeState({ characters: [me] });
    const decision: ParsedDecision = {
      ...defaultDecision(),
      use: "consumable",
    };
    const result = validateDecision(state, "A", decision);
    expect(result.fieldErrors).toEqual({});
    expect(result.decision).toEqual(decision);
  });

  // ─── WP10.5 Phase A3 follow-up: post-move action gating ────────────────
  // concept-spec §9 line 447: "Move up to 8, then optionally take one normal
  // action if valid." When the actor moves AND acts in the same turn, the
  // action's range must be evaluated against the POST-move position, which
  // is the resolver's job (resolution.ts post-A3 no-ops cleanly with
  // result:"out_of_range" when needed). The validator must NOT pre-reject
  // a move+action pair on pre-move position alone.

  it("§9 line 447 — position move toward + action loot same chest at distance 8 → valid (resolver gates post-move)", () => {
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    // Chest at (13, 5) — Chebyshev 8 from actor (out of INTERACT_RANGE=2,
    // but reachable in one move turn at speed 8).
    const chest = makeChest("Chest_13_5", { x: 13, y: 5 });
    const state = makeState({
      characters: [me],
      world: { chests: [chest] },
    });
    const decision: ParsedDecision = {
      ...defaultDecision(),
      position: {
        kind: "move",
        direction: { kind: "toward", targetId: "Chest_13_5" },
        dist: 8,
      },
      action: { kind: "loot", targetId: "Chest_13_5" },
    };
    const result = validateDecision(state, "A", decision);
    expect(result.fieldErrors).toEqual({});
    expect(result.decision).toEqual(decision);
  });

  it("§9 line 447 — position move toward + action attack same target at distance 6 with sword (range 2) → valid", () => {
    const me = makeCharacter({
      id: "A",
      pos: { x: 5, y: 5 },
      weapon: "sword",
    });
    // Target at (11, 5) — Chebyshev 6 from actor (out of weapon range 2,
    // but reachable in one move at speed 8).
    const target = makeCharacter({ id: "Duelist", pos: { x: 11, y: 5 } });
    const state = makeState({ characters: [me, target] });
    const decision: ParsedDecision = {
      ...defaultDecision(),
      position: {
        kind: "move",
        direction: { kind: "toward", targetId: "Duelist" },
        dist: 8,
      },
      action: { kind: "attack", targetId: "Duelist" },
    };
    const result = validateDecision(state, "A", decision);
    expect(result.fieldErrors).toEqual({});
    expect(result.decision).toEqual(decision);
  });

  it("regression — stationary position + action attack at distance 5 with sword (range 2) → action field default", () => {
    const me = makeCharacter({
      id: "A",
      pos: { x: 5, y: 5 },
      weapon: "sword",
    });
    const target = makeCharacter({ id: "B", pos: { x: 10, y: 5 } });
    const state = makeState({ characters: [me, target] });
    const decision: ParsedDecision = {
      ...defaultDecision(),
      action: { kind: "attack", targetId: "B" },
    };
    const result = validateDecision(state, "A", decision);
    expect(result.fieldErrors.action).toMatch(/range/i);
    expect(result.decision.action).toEqual({ kind: "none" });
  });

  it("regression — stationary position + loot chest at distance 5 → action field default", () => {
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const chest = makeChest("Chest_10_5", { x: 10, y: 5 });
    const state = makeState({
      characters: [me],
      world: { chests: [chest] },
    });
    const decision: ParsedDecision = {
      ...defaultDecision(),
      action: { kind: "loot", targetId: "Chest_10_5" },
    };
    const result = validateDecision(state, "A", decision);
    expect(result.fieldErrors.action).toMatch(/range/i);
    expect(result.decision.action).toEqual({ kind: "none" });
  });

  // ─── WP-B.8 position commitments + loot.targetId namespace ─────────────
  describe("WP-B.8 position commitments — ADR §3", () => {
    it("position overwatch → valid", () => {
      const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
      const state = makeState({ characters: [me] });
      const decision: ParsedDecision = {
        ...defaultDecision(),
        position: { kind: "overwatch" },
      };
      const result = validateDecision(state, "A", decision);
      expect(result.fieldErrors).toEqual({});
      expect(result.decision).toEqual(decision);
    });

    it("position counter → valid", () => {
      const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
      const state = makeState({ characters: [me] });
      const decision: ParsedDecision = {
        ...defaultDecision(),
        position: { kind: "counter" },
      };
      const result = validateDecision(state, "A", decision);
      expect(result.fieldErrors).toEqual({});
      expect(result.decision).toEqual(decision);
    });

    it("safe default position is valid", () => {
      const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
      const state = makeState({ characters: [me] });
      const result = validateDecision(state, "A", SAFE_DEFAULT_DECISION);
      expect(result.fieldErrors).toEqual({});
      expect(result.decision).toEqual(SAFE_DEFAULT_DECISION);
    });
  });

  describe("WP-B.8 loot.targetId namespace validity — ADR §1", () => {
    it("loot.targetId with bogus prefix (neither Chest_x_y nor persona name) → safe-default", () => {
      const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
      const state = makeState({ characters: [me] });
      const decision: ParsedDecision = {
        ...defaultDecision(),
        action: { kind: "loot", targetId: "garbage_id_xyz" },
      };
      const result = validateDecision(state, "A", decision);
      expect(result.fieldErrors.action).toMatch(/loot|target/i);
      expect(result.decision.action).toEqual({ kind: "none" });
    });

    it("loot.targetId Chest_6_5 (in range, exists, not opened) → valid", () => {
      const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
      const chest = makeChest("Chest_6_5", { x: 6, y: 5 });
      const state = makeState({
        characters: [me],
        world: { chests: [chest] },
      });
      const decision: ParsedDecision = {
        ...defaultDecision(),
        action: { kind: "loot", targetId: "Chest_6_5" },
      };
      const result = validateDecision(state, "A", decision);
      expect(result.fieldErrors).toEqual({});
      expect(result.decision).toEqual(decision);
    });

    it("loot.targetId Corpse_Camper (corpse exists in range) → valid", () => {
      const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
      const corpse = makeCorpse("Camper", { x: 6, y: 5 });
      const state = makeState({
        characters: [me],
        world: { corpses: [corpse] },
      });
      const decision: ParsedDecision = {
        ...defaultDecision(),
        action: { kind: "loot", targetId: "Corpse_Camper" },
      };
      const result = validateDecision(state, "A", decision);
      expect(result.fieldErrors).toEqual({});
      expect(result.decision).toEqual(decision);
    });

    it("loot.targetId legacy lowercase chest namespace → safe-default", () => {
      const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
      const chest = makeChest("Chest_6_5", { x: 6, y: 5 });
      const state = makeState({
        characters: [me],
        world: { chests: [chest] },
      });
      const decision: ParsedDecision = {
        ...defaultDecision(),
        action: { kind: "loot", targetId: "chest_legacy" },
      };
      const result = validateDecision(state, "A", decision);
      expect(result.fieldErrors.action).toMatch(/visible chest or corpse/i);
      expect(result.decision.action).toEqual({ kind: "none" });
    });

    it("move.toward Chest_13_5 (coord id from digest) → valid", () => {
      const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
      const chest = makeChest("Chest_13_5", { x: 13, y: 5 });
      const state = makeState({
        characters: [me],
        world: { chests: [chest] },
      });
      const decision: ParsedDecision = {
        ...defaultDecision(),
        position: {
          kind: "move",
          direction: { kind: "toward", targetId: "Chest_13_5" },
          dist: 8,
        },
      };
      const result = validateDecision(state, "A", decision);
      expect(result.fieldErrors).toEqual({});
      expect(result.decision).toEqual(decision);
    });
  });

  // ─── WP-F.2 display-id normalisation at the validator boundary ────────
  //
  // Per North Star §1 (locked design decision #1) and the system prompt,
  // the LLM emits attack targets as persona display names. Attack validation
  // must bridge that to the engine
  // `characterId`; move target validation now delegates the typed-id bridge
  // and visibility projection to resolveTypedEntity.
  describe("WP-F.2 persona display-id target normalisation — ADR §1", () => {
    it("attack target=displayName 'Duelist' (engine id is opaque) → valid", () => {
      const me: CharacterState = {
        characterId: "char_opaque_a",
        personaId: "rat",
        spawnIndex: 0,
        displayName: "Rat",
        hp: 100,
        maxHp: 100,
        pos: { x: 5, y: 5 },
        equipped: { weapon: { category: "weapon", name: "sword" } },
        scratchpad: "",
        hidden: false,
        alive: true,
        lastKnown: [],
      };
      const target: CharacterState = {
        characterId: "char_opaque_b",
        personaId: "duelist",
        spawnIndex: 2,
        displayName: "Duelist",
        hp: 100,
        maxHp: 100,
        pos: { x: 6, y: 6 },
        equipped: {},
        scratchpad: "",
        hidden: false,
        alive: true,
        lastKnown: [],
      };
      const state = makeState({ characters: [me, target] });
      const decision: ParsedDecision = {
        ...defaultDecision(),
        action: { kind: "attack", targetId: "Duelist" },
      };
      const result = validateDecision(state, "char_opaque_a", decision);
      expect(result.fieldErrors).toEqual({});
      expect(result.decision).toEqual(decision);
    });

    it("attack target=UnknownPersona (no such character) → action field default with 'not a living character' reason", () => {
      const me: CharacterState = {
        characterId: "char_opaque_a",
        personaId: "rat",
        spawnIndex: 0,
        displayName: "Rat",
        hp: 100,
        maxHp: 100,
        pos: { x: 5, y: 5 },
        equipped: { weapon: { category: "weapon", name: "sword" } },
        scratchpad: "",
        hidden: false,
        alive: true,
        lastKnown: [],
      };
      const state = makeState({ characters: [me] });
      const decision: ParsedDecision = {
        ...defaultDecision(),
        action: { kind: "attack", targetId: "UnknownPersona" },
      };
      const result = validateDecision(state, "char_opaque_a", decision);
      expect(result.fieldErrors.action).toMatch(/not a living character/);
      expect(result.fieldErrors.action).toContain("UnknownPersona");
      expect(result.decision.action).toEqual({ kind: "none" });
    });

    it("position move toward targetId='Duelist' → valid (engine id is opaque)", () => {
      const me: CharacterState = {
        characterId: "char_opaque_a",
        personaId: "rat",
        spawnIndex: 0,
        displayName: "Rat",
        hp: 100,
        maxHp: 100,
        pos: { x: 5, y: 5 },
        equipped: {},
        scratchpad: "",
        hidden: false,
        alive: true,
        lastKnown: [],
      };
      const target: CharacterState = {
        characterId: "char_opaque_b",
        personaId: "duelist",
        spawnIndex: 2,
        displayName: "Duelist",
        hp: 100,
        maxHp: 100,
        pos: { x: 8, y: 5 },
        equipped: {},
        scratchpad: "",
        hidden: false,
        alive: true,
        lastKnown: [],
      };
      const state = makeState({ characters: [me, target] });
      const decision: ParsedDecision = {
        ...defaultDecision(),
        position: {
          kind: "move",
          direction: { kind: "toward", targetId: "Duelist" },
          dist: 8,
        },
      };
      const result = validateDecision(state, "char_opaque_a", decision);
      expect(result.fieldErrors).toEqual({});
      expect(result.decision).toEqual(decision);
    });

    it("position move toward targetId='UnknownPersona' (unknown) → canonical visibility reason", () => {
      const me: CharacterState = {
        characterId: "char_opaque_a",
        personaId: "rat",
        spawnIndex: 0,
        displayName: "Rat",
        hp: 100,
        maxHp: 100,
        pos: { x: 5, y: 5 },
        equipped: {},
        scratchpad: "",
        hidden: false,
        alive: true,
        lastKnown: [],
      };
      const state = makeState({ characters: [me] });
      const decision: ParsedDecision = {
        ...defaultDecision(),
        position: {
          kind: "move",
          direction: { kind: "toward", targetId: "UnknownPersona" },
          dist: 8,
        },
      };
      const result = validateDecision(state, "char_opaque_a", decision);
      expect(result.fieldErrors.position).toBe(
        moveTargetNotVisibleReason("UnknownPersona"),
      );
      expect(result.decision.position).toEqual(SAFE_DEFAULT_DECISION.position);
    });

    it("position move away targetId='Duelist' → valid (engine id is opaque)", () => {
      const me: CharacterState = {
        characterId: "char_opaque_a",
        personaId: "rat",
        spawnIndex: 0,
        displayName: "Rat",
        hp: 100,
        maxHp: 100,
        pos: { x: 5, y: 5 },
        equipped: {},
        scratchpad: "",
        hidden: false,
        alive: true,
        lastKnown: [],
      };
      const target: CharacterState = {
        characterId: "char_opaque_b",
        personaId: "duelist",
        spawnIndex: 2,
        displayName: "Duelist",
        hp: 100,
        maxHp: 100,
        pos: { x: 8, y: 5 },
        equipped: {},
        scratchpad: "",
        hidden: false,
        alive: true,
        lastKnown: [],
      };
      const state = makeState({ characters: [me, target] });
      const decision: ParsedDecision = {
        ...defaultDecision(),
        position: {
          kind: "move",
          direction: { kind: "away", targetId: "Duelist" },
          dist: 8,
        },
      };
      const result = validateDecision(state, "char_opaque_a", decision);
      expect(result.fieldErrors).toEqual({});
      expect(result.decision).toEqual(decision);
    });
  });

  it("§9 line 447 — position move toward chestA + loot out-of-vision chestB → action field default", () => {
    // Validation may defer post-move range checks to the resolver, but the
    // action target still has to be visible because the model is instructed
    // to copy targetId values from Visible.
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const chestA = makeChest("Chest_13_5", { x: 13, y: 5 });
    const chestB = makeChest("Chest_90_90", { x: 90, y: 90 });
    const state = makeState({
      characters: [me],
      world: { chests: [chestA, chestB] },
    });
    const decision: ParsedDecision = {
      ...defaultDecision(),
      position: {
        kind: "move",
        direction: { kind: "toward", targetId: "Chest_13_5" },
        dist: 8,
      },
      action: { kind: "loot", targetId: "Chest_90_90" },
    };
    const result = validateDecision(state, "A", decision);
    expect(result.fieldErrors.action).toBe(
      "loot target 'Chest_90_90' is not a visible chest or corpse",
    );
    expect(result.decision.action).toEqual({ kind: "none" });
    expect(result.decision.position).toEqual(decision.position);
  });

  // ─── WP-G.1 Corpse_<Persona> typed-id normalisation at validator boundary ─
  //
  // Per North Star §1 + the system prompt's "loot <Visible.id> — copy id
  // verbatim" instruction, the agent emits corpse loot/toward targets
  // as the digest's typed id `Corpse_Camper` (rendered by
  // `convex/llm/inputBuilder.ts:516`). The validator/engine historically
  // only accepted untyped chest/persona namespaces, rejecting all
  // `Corpse_<Persona>` loot attempts as "invalid namespace prefix"
  // (reviewer-B completion-review-2 HIGH-1).
  //
  // PM-lock D38: fix at the validator/engine boundary by extending
  // normalisation; do NOT change the digest rendering. Mirrors WP-F.2's
  // approach for persona names and the WP-B.10 fix for typed chest ids.
  describe("WP-G.1 Corpse_<Persona> corpse-target normalisation — D38", () => {
    it("loot.targetId 'Corpse_Camper' (typed-id from digest) → valid (resolves to corpse via displayName lookup)", () => {
      const me: CharacterState = {
        characterId: "char_opaque_a",
        personaId: "rat",
        spawnIndex: 0,
        displayName: "Rat",
        hp: 100,
        maxHp: 100,
        pos: { x: 5, y: 5 },
        equipped: {},
        scratchpad: "",
        hidden: false,
        alive: true,
        lastKnown: [],
      };
      // Dead character whose engine characterId is opaque, displayName Camper.
      const dead: CharacterState = {
        characterId: "char_opaque_e",
        personaId: "camper",
        spawnIndex: 4,
        displayName: "Camper",
        hp: 0,
        maxHp: 100,
        pos: { x: 6, y: 5 },
        equipped: {},
        scratchpad: "",
        hidden: false,
        alive: false,
        lastKnown: [],
      };
      const corpse: CorpseState = {
        characterId: "char_opaque_e", // engine-side id, NOT the typed id
        pos: { x: 6, y: 5 },
        contents: { weapon: { category: "weapon", name: "axe" } },
      };
      const state = makeState({
        characters: [me, dead],
        world: { corpses: [corpse] },
      });
      const decision: ParsedDecision = {
        ...defaultDecision(),
        action: { kind: "loot", targetId: "Corpse_Camper" },
      };
      const result = validateDecision(state, "char_opaque_a", decision);
      expect(result.fieldErrors).toEqual({});
      expect(result.decision).toEqual(decision);
    });

    it("loot.targetId 'Corpse_UnknownPersona' (no such character) → action field default with corpse reason", () => {
      const me: CharacterState = {
        characterId: "char_opaque_a",
        personaId: "rat",
        spawnIndex: 0,
        displayName: "Rat",
        hp: 100,
        maxHp: 100,
        pos: { x: 5, y: 5 },
        equipped: {},
        scratchpad: "",
        hidden: false,
        alive: true,
        lastKnown: [],
      };
      const state = makeState({ characters: [me] });
      const decision: ParsedDecision = {
        ...defaultDecision(),
        action: { kind: "loot", targetId: "Corpse_UnknownPersona" },
      };
      const result = validateDecision(state, "char_opaque_a", decision);
      expect(result.fieldErrors.action).toMatch(/corpse|Corpse_UnknownPersona/i);
      expect(result.decision.action).toEqual({ kind: "none" });
    });

    it("loot.targetId 'Corpse_Camper' validator preserves verbatim targetId (resolver normalises + emits verbatim trace, mirrors WP-F.2 pattern)", () => {
      // PM-lock D38 + WP-F.2 pattern (resolution.ts:454): validator does
      // normalisation for ACCEPTANCE, but does NOT rewrite the decision.
      // The resolver re-normalises and preserves the verbatim emit on
      // `trace.actions[].target` so replay/diagnostics see what the
      // agent actually wrote. Asserting verbatim preservation here pins
      // the convention so a future "validator rewrites action.targetId"
      // refactor can't silently corrupt the trace.
      const me: CharacterState = {
        characterId: "char_opaque_a",
        personaId: "rat",
        spawnIndex: 0,
        displayName: "Rat",
        hp: 100,
        maxHp: 100,
        pos: { x: 5, y: 5 },
        equipped: {},
        scratchpad: "",
        hidden: false,
        alive: true,
        lastKnown: [],
      };
      const dead: CharacterState = {
        characterId: "char_opaque_e",
        personaId: "camper",
        spawnIndex: 4,
        displayName: "Camper",
        hp: 0,
        maxHp: 100,
        pos: { x: 6, y: 5 },
        equipped: {},
        scratchpad: "",
        hidden: false,
        alive: false,
        lastKnown: [],
      };
      const corpse: CorpseState = {
        characterId: "char_opaque_e",
        pos: { x: 6, y: 5 },
        contents: { weapon: { category: "weapon", name: "axe" } },
      };
      const state = makeState({
        characters: [me, dead],
        world: { corpses: [corpse] },
      });
      const decision: ParsedDecision = {
        ...defaultDecision(),
        action: { kind: "loot", targetId: "Corpse_Camper" },
      };
      const result = validateDecision(state, "char_opaque_a", decision);
      expect(result.fieldErrors).toEqual({});
      if (result.decision.action.kind === "loot") {
        expect(result.decision.action.targetId).toBe("Corpse_Camper");
      }
    });

    it("position move toward 'Corpse_Camper' (typed-id from digest) → valid (resolves to corpse tile)", () => {
      const me: CharacterState = {
        characterId: "char_opaque_a",
        personaId: "rat",
        spawnIndex: 0,
        displayName: "Rat",
        hp: 100,
        maxHp: 100,
        pos: { x: 5, y: 5 },
        equipped: {},
        scratchpad: "",
        hidden: false,
        alive: true,
        lastKnown: [],
      };
      const dead: CharacterState = {
        characterId: "char_opaque_e",
        personaId: "camper",
        spawnIndex: 4,
        displayName: "Camper",
        hp: 0,
        maxHp: 100,
        pos: { x: 13, y: 5 },
        equipped: {},
        scratchpad: "",
        hidden: false,
        alive: false,
        lastKnown: [],
      };
      const corpse: CorpseState = {
        characterId: "char_opaque_e",
        pos: { x: 13, y: 5 },
        contents: { weapon: { category: "weapon", name: "axe" } },
      };
      const state = makeState({
        characters: [me, dead],
        world: { corpses: [corpse] },
      });
      const decision: ParsedDecision = {
        ...defaultDecision(),
        position: {
          kind: "move",
          direction: { kind: "toward", targetId: "Corpse_Camper" },
          dist: 8,
        },
      };
      const result = validateDecision(state, "char_opaque_a", decision);
      expect(result.fieldErrors).toEqual({});
      expect(result.decision).toEqual(decision);
    });

    it("position move toward 'Corpse_UnknownPersona' (unknown) → canonical visibility reason", () => {
      const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
      const state = makeState({ characters: [me] });
      const decision: ParsedDecision = {
        ...defaultDecision(),
        position: {
          kind: "move",
          direction: { kind: "toward", targetId: "Corpse_UnknownPersona" },
          dist: 8,
        },
      };
      const result = validateDecision(state, "A", decision);
      expect(result.fieldErrors.position).toBe(
        moveTargetNotVisibleReason("Corpse_UnknownPersona"),
      );
      expect(result.decision.position).toEqual(SAFE_DEFAULT_DECISION.position);
    });

    it("test-fixture path: Corpse_<displayName> when displayName === characterId resolves directly", () => {
      // In test fixtures, characterId often equals displayName (e.g. "B").
      // The Corpse_<id> form must still resolve when there is no separate
      // displayName mapping (handles tests + edge cases where a corpse has
      // a persona name as characterId).
      const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
      const corpse: CorpseState = {
        characterId: "Camper",
        pos: { x: 6, y: 5 },
        contents: { weapon: { category: "weapon", name: "axe" } },
      };
      const state = makeState({
        characters: [me],
        world: { corpses: [corpse] },
      });
      const decision: ParsedDecision = {
        ...defaultDecision(),
        action: { kind: "loot", targetId: "Corpse_Camper" },
      };
      const result = validateDecision(state, "A", decision);
      expect(result.fieldErrors).toEqual({});
      expect(result.decision).toEqual(decision);
    });
  });
});
