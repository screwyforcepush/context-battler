// WP5 — pure-function unit tests for decision validation.
//
// Tests are written FIRST per AOP. Spec sections: ADR §4 (ParsedDecision
// shape), concept-spec §10 (movement bounds), §12 (attack range), §13
// (interact/loot range 2), §15 (evac reveal at turn 30).
//
// The validator's job: take a parsed decision (already shape-validated by
// Zod in WP6) and assert it makes sense against the current MatchState.
// On any failure, return `{ ok: false, reason, safeDefault: SAFE_DEFAULT_DECISION }`.

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
    consume: "none",
    primary: "stationary_action",
    move: { kind: "none" },
    action: { kind: "none" },
    say: null,
    overwatch_priority: null,
    scratchpad_update: null,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("WP5 — validateDecision (ADR §4)", () => {
  it("ADR §4 — out-of-range relative move (dx=13) → safe-default with reason", () => {
    const me = makeCharacter({ id: "A", pos: { x: 50, y: 50 } });
    const state = makeState({ characters: [me] });
    const decision: ParsedDecision = {
      ...defaultDecision(),
      move: { kind: "relative", dx: 13, dy: 0 },
    };
    const result = validateDecision(state, "A", decision);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/relative/i);
      expect(result.safeDefault).toEqual(SAFE_DEFAULT_DECISION);
    }
  });

  it("§12 — attack on dead target → safe-default", () => {
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
      action: { kind: "attack", targetCharacterId: "B" },
    };
    const result = validateDecision(state, "A", decision);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/dead|alive|living|not visible/i);
      expect(result.safeDefault).toEqual(SAFE_DEFAULT_DECISION);
    }
  });

  it("§13 — interact (open chest) out of range 2 → safe-default", () => {
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const chest = makeChest("chest_001", { x: 50, y: 50 });
    const state = makeState({
      characters: [me],
      world: { chests: [chest] },
    });
    const decision: ParsedDecision = {
      ...defaultDecision(),
      action: { kind: "interact", targetObjectId: "chest_001" },
    };
    const result = validateDecision(state, "A", decision);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/range|chest/i);
      expect(result.safeDefault).toEqual(SAFE_DEFAULT_DECISION);
    }
  });

  it("ADR §4 — toward_entity with missing targetCharacterId → safe-default with reason mapping", () => {
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const state = makeState({ characters: [me] });
    // Synthetic malformed: targetCharacterId set to empty string (Zod
    // would normally catch this upstream — this is the engine's defence
    // in depth per WP5 brief).
    const decision: ParsedDecision = {
      ...defaultDecision(),
      move: { kind: "toward_entity", targetCharacterId: "" },
    };
    const result = validateDecision(state, "A", decision);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/toward_entity/i);
      expect(result.safeDefault).toEqual(SAFE_DEFAULT_DECISION);
    }
  });

  it("§15 — toward_evac before evac is revealed → safe-default", () => {
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const state = makeState({ characters: [me] });
    expect(state.world.evac.revealedAtTurn).toBe(null);
    const decision: ParsedDecision = {
      ...defaultDecision(),
      move: { kind: "toward_evac" },
    };
    const result = validateDecision(state, "A", decision);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/evac/i);
      expect(result.safeDefault).toEqual(SAFE_DEFAULT_DECISION);
    }
  });

  it("ADR §6 — consume = 'heal' without heal in equipped → safe-default", () => {
    // Actor has no consumable.
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const state = makeState({ characters: [me] });
    const decision: ParsedDecision = {
      ...defaultDecision(),
      consume: "heal",
    };
    const result = validateDecision(state, "A", decision);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/heal|consumable/i);
    }

    // Actor has speed but tries to consume heal.
    const meSpeed = makeCharacter({
      id: "A",
      pos: { x: 5, y: 5 },
      consumable: "speed",
    });
    const stateSpeed = makeState({ characters: [meSpeed] });
    const result2 = validateDecision(stateSpeed, "A", decision);
    expect(result2.ok).toBe(false);
  });

  it("ADR §4 — valid decision passes through unchanged", () => {
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const state = makeState({ characters: [me] });
    const decision: ParsedDecision = {
      ...defaultDecision(),
      move: { kind: "relative", dx: 3, dy: -2 },
    };
    const result = validateDecision(state, "A", decision);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision).toEqual(decision);
    }
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
      action: { kind: "attack", targetCharacterId: "B" },
    };
    const result = validateDecision(state, "A", decision);
    expect(result.ok).toBe(true);
  });

  it("§13 — interact on chest in range → valid", () => {
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const chest = makeChest("chest_001", { x: 6, y: 6 });
    const state = makeState({
      characters: [me],
      world: { chests: [chest] },
    });
    const decision: ParsedDecision = {
      ...defaultDecision(),
      action: { kind: "interact", targetObjectId: "chest_001" },
    };
    const result = validateDecision(state, "A", decision);
    expect(result.ok).toBe(true);
  });

  it("§13 — loot corpse out of range → safe-default", () => {
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const corpse = makeCorpse("X", { x: 50, y: 50 });
    const state = makeState({
      characters: [me],
      world: { corpses: [corpse] },
    });
    const decision: ParsedDecision = {
      ...defaultDecision(),
      action: { kind: "loot", targetCorpseId: "X" },
    };
    const result = validateDecision(state, "A", decision);
    expect(result.ok).toBe(false);
  });

  it("§13 — loot corpse in range → valid", () => {
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const corpse = makeCorpse("X", { x: 6, y: 6 });
    const state = makeState({
      characters: [me],
      world: { corpses: [corpse] },
    });
    const decision: ParsedDecision = {
      ...defaultDecision(),
      action: { kind: "loot", targetCorpseId: "X" },
    };
    const result = validateDecision(state, "A", decision);
    expect(result.ok).toBe(true);
  });

  it("§15 — toward_evac after evac revealed → valid", () => {
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const state = makeState({
      characters: [me],
      world: {
        evac: { centre: { x: 50, y: 50 }, revealedAtTurn: 30 },
      },
      turn: 31,
    });
    const decision: ParsedDecision = {
      ...defaultDecision(),
      move: { kind: "toward_evac" },
    };
    const result = validateDecision(state, "A", decision);
    expect(result.ok).toBe(true);
  });

  it("ADR §4 — toward_object with unknown id → safe-default", () => {
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const state = makeState({ characters: [me] });
    const decision: ParsedDecision = {
      ...defaultDecision(),
      move: { kind: "toward_object", targetObjectId: "chest_999" },
    };
    const result = validateDecision(state, "A", decision);
    expect(result.ok).toBe(false);
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
      action: { kind: "attack", targetCharacterId: "B" },
    };
    const result = validateDecision(state, "A", decision);
    expect(result.ok).toBe(false);
  });

  it("ADR §6 — consume = 'heal' WITH heal in equipped → valid", () => {
    const me = makeCharacter({
      id: "A",
      pos: { x: 5, y: 5 },
      consumable: "heal",
    });
    const state = makeState({ characters: [me] });
    const decision: ParsedDecision = {
      ...defaultDecision(),
      consume: "heal",
    };
    const result = validateDecision(state, "A", decision);
    expect(result.ok).toBe(true);
  });

  // ─── WP10.5 Phase A3 follow-up: post-move action gating ────────────────
  // concept-spec §9 line 447: "Move up to 8, then optionally take one normal
  // action if valid." When the actor moves AND acts in the same turn, the
  // action's range must be evaluated against the POST-move position, which
  // is the resolver's job (resolution.ts post-A3 no-ops cleanly with
  // result:"out_of_range" when needed). The validator must NOT pre-reject
  // a move+action pair on pre-move position alone.

  it("§9 line 447 — move:toward_object + action:interact same chest at distance 8 → valid (resolver gates post-move)", () => {
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    // Chest at (13, 5) — Chebyshev 8 from actor (out of INTERACT_RANGE=2,
    // but reachable in one move turn at speed 8).
    const chest = makeChest("chest_001", { x: 13, y: 5 });
    const state = makeState({
      characters: [me],
      world: { chests: [chest] },
    });
    const decision: ParsedDecision = {
      ...defaultDecision(),
      primary: "move",
      move: { kind: "toward_object", targetObjectId: "chest_001" },
      action: { kind: "interact", targetObjectId: "chest_001" },
    };
    const result = validateDecision(state, "A", decision);
    expect(result.ok).toBe(true);
  });

  it("§9 line 447 — move:toward_entity + action:attack same target at distance 6 with sword (range 2) → valid", () => {
    const me = makeCharacter({
      id: "A",
      pos: { x: 5, y: 5 },
      weapon: "sword",
    });
    // Target at (11, 5) — Chebyshev 6 from actor (out of weapon range 2,
    // but reachable in one move at speed 8).
    const target = makeCharacter({ id: "B", pos: { x: 11, y: 5 } });
    const state = makeState({ characters: [me, target] });
    const decision: ParsedDecision = {
      ...defaultDecision(),
      primary: "move",
      move: { kind: "toward_entity", targetCharacterId: "B" },
      action: { kind: "attack", targetCharacterId: "B" },
    };
    const result = validateDecision(state, "A", decision);
    expect(result.ok).toBe(true);
  });

  it("regression — move:none + action:attack at distance 5 with sword (range 2) → STILL safe-default", () => {
    const me = makeCharacter({
      id: "A",
      pos: { x: 5, y: 5 },
      weapon: "sword",
    });
    const target = makeCharacter({ id: "B", pos: { x: 10, y: 5 } });
    const state = makeState({ characters: [me, target] });
    const decision: ParsedDecision = {
      ...defaultDecision(),
      // move.kind === "none" — pre-move range gating MUST still apply.
      action: { kind: "attack", targetCharacterId: "B" },
    };
    const result = validateDecision(state, "A", decision);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/range/i);
    }
  });

  it("regression — move:none + action:interact chest at distance 5 → STILL safe-default", () => {
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const chest = makeChest("chest_001", { x: 10, y: 5 });
    const state = makeState({
      characters: [me],
      world: { chests: [chest] },
    });
    const decision: ParsedDecision = {
      ...defaultDecision(),
      // move.kind === "none" — pre-move range gating MUST still apply.
      action: { kind: "interact", targetObjectId: "chest_001" },
    };
    const result = validateDecision(state, "A", decision);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/range/i);
    }
  });

  it("§9 line 447 — move:toward_object chestA + action:interact chestB-far-away → valid (resolver no-ops post-move)", () => {
    // Validator must not reject this; the resolver's post-move chebyshev
    // check at resolution.ts:446 will record result:"out_of_range" cleanly.
    // Validation's job is to ensure the action *target* is well-formed
    // (exists, not opened, visible if applicable) — NOT to second-guess
    // the actor's tactical choice when they're moving.
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const chestA = makeChest("chest_a", { x: 13, y: 5 });
    const chestB = makeChest("chest_b", { x: 90, y: 90 });
    const state = makeState({
      characters: [me],
      world: { chests: [chestA, chestB] },
    });
    const decision: ParsedDecision = {
      ...defaultDecision(),
      primary: "move",
      move: { kind: "toward_object", targetObjectId: "chest_a" },
      action: { kind: "interact", targetObjectId: "chest_b" },
    };
    const result = validateDecision(state, "A", decision);
    expect(result.ok).toBe(true);
  });
});
