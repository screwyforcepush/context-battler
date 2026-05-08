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
    overwatch_stance: null,
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
      action: { kind: "loot", targetId: "chest_001" },
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
      action: { kind: "loot", targetId: "chest_001" },
    };
    const result = validateDecision(state, "A", decision);
    expect(result.ok).toBe(true);
  });

  it("§13 — loot corpse out of range → safe-default", () => {
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const corpse = makeCorpse("Player_5", { x: 50, y: 50 });
    const state = makeState({
      characters: [me],
      world: { corpses: [corpse] },
    });
    const decision: ParsedDecision = {
      ...defaultDecision(),
      action: { kind: "loot", targetId: "Player_5" },
    };
    const result = validateDecision(state, "A", decision);
    expect(result.ok).toBe(false);
  });

  it("§13 — loot corpse in range → valid", () => {
    const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
    const corpse = makeCorpse("Player_5", { x: 6, y: 6 });
    const state = makeState({
      characters: [me],
      world: { corpses: [corpse] },
    });
    const decision: ParsedDecision = {
      ...defaultDecision(),
      action: { kind: "loot", targetId: "Player_5" },
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
      action: { kind: "loot", targetId: "chest_001" },
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
      action: { kind: "loot", targetId: "chest_001" },
    };
    const result = validateDecision(state, "A", decision);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/range/i);
    }
  });

  // ─── WP-B.8 stance/primary consistency + loot.targetId namespace ──────
  describe("WP-B.8 stance/primary consistency — ADR §3", () => {
    it("primary='overwatch' with overwatch_stance=null → safe-default", () => {
      const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
      const state = makeState({ characters: [me] });
      const decision: ParsedDecision = {
        ...defaultDecision(),
        primary: "overwatch",
        overwatch_stance: null,
      };
      const result = validateDecision(state, "A", decision);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/stance|overwatch/i);
        expect(result.safeDefault).toEqual(SAFE_DEFAULT_DECISION);
      }
    });

    it("primary='stationary_action' with overwatch_stance='offensive' → safe-default", () => {
      const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
      const state = makeState({ characters: [me] });
      const decision: ParsedDecision = {
        ...defaultDecision(),
        primary: "stationary_action",
        overwatch_stance: "offensive",
      };
      const result = validateDecision(state, "A", decision);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/stance|overwatch/i);
      }
    });

    it("primary='move' with overwatch_stance='defensive' → safe-default", () => {
      const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
      const state = makeState({ characters: [me] });
      const decision: ParsedDecision = {
        ...defaultDecision(),
        primary: "move",
        move: { kind: "relative", dx: 1, dy: 0 },
        overwatch_stance: "defensive",
      };
      const result = validateDecision(state, "A", decision);
      expect(result.ok).toBe(false);
    });

    it("primary='overwatch' + stance='offensive' → valid", () => {
      const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
      const state = makeState({ characters: [me] });
      const decision: ParsedDecision = {
        ...defaultDecision(),
        primary: "overwatch",
        overwatch_stance: "offensive",
      };
      const result = validateDecision(state, "A", decision);
      expect(result.ok).toBe(true);
    });

    it("primary='overwatch' + stance='defensive' → valid", () => {
      const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
      const state = makeState({ characters: [me] });
      const decision: ParsedDecision = {
        ...defaultDecision(),
        primary: "overwatch",
        overwatch_stance: "defensive",
      };
      const result = validateDecision(state, "A", decision);
      expect(result.ok).toBe(true);
    });

    it("primary='stationary_action' with stance=null → valid (round-trip with safe-default)", () => {
      const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
      const state = makeState({ characters: [me] });
      const result = validateDecision(state, "A", SAFE_DEFAULT_DECISION);
      expect(result.ok).toBe(true);
    });
  });

  describe("WP-B.8 loot.targetId namespace validity — ADR §1", () => {
    it("loot.targetId with bogus prefix (neither chest_ nor Player_) → safe-default", () => {
      const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
      const state = makeState({ characters: [me] });
      const decision: ParsedDecision = {
        ...defaultDecision(),
        action: { kind: "loot", targetId: "garbage_id_xyz" },
      };
      const result = validateDecision(state, "A", decision);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/loot|target|namespace|prefix/i);
      }
    });

    it("loot.targetId chest_001 (in range, exists, not opened) → valid", () => {
      const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
      const chest = makeChest("chest_001", { x: 6, y: 5 });
      const state = makeState({
        characters: [me],
        world: { chests: [chest] },
      });
      const decision: ParsedDecision = {
        ...defaultDecision(),
        action: { kind: "loot", targetId: "chest_001" },
      };
      const result = validateDecision(state, "A", decision);
      expect(result.ok).toBe(true);
    });

    it("loot.targetId Player_5 (corpse exists in range) → valid", () => {
      const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
      const corpse = makeCorpse("Player_5", { x: 6, y: 5 });
      const state = makeState({
        characters: [me],
        world: { corpses: [corpse] },
      });
      const decision: ParsedDecision = {
        ...defaultDecision(),
        action: { kind: "loot", targetId: "Player_5" },
      };
      const result = validateDecision(state, "A", decision);
      expect(result.ok).toBe(true);
    });

    // Phase-3 fix — case-insensitive chest namespace dispatch. The digest
    // renders chests as `Chest_NNN` (typed-id convention per ADR §6 +
    // concept-spec §22) but the stored chest id is `chest_NNN`. The model
    // copies the rendered id verbatim. Without this normalisation the
    // validator rejects every loot/toward_object on chests, driving the
    // closing-10 fellBackToSafeDefault rate well past the ≤10% threshold.
    it("loot.targetId Chest_001 (capital prefix from digest) → valid (case-insensitive chest namespace)", () => {
      const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
      const chest = makeChest("chest_001", { x: 6, y: 5 });
      const state = makeState({
        characters: [me],
        world: { chests: [chest] },
      });
      const decision: ParsedDecision = {
        ...defaultDecision(),
        action: { kind: "loot", targetId: "Chest_001" },
      };
      const result = validateDecision(state, "A", decision);
      expect(result.ok).toBe(true);
    });

    it("move.toward_object Chest_001 (capital prefix from digest) → valid (case-insensitive chest namespace)", () => {
      const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
      const chest = makeChest("chest_001", { x: 13, y: 5 });
      const state = makeState({
        characters: [me],
        world: { chests: [chest] },
      });
      const decision: ParsedDecision = {
        ...defaultDecision(),
        primary: "move",
        move: { kind: "toward_object", targetObjectId: "Chest_001" },
      };
      const result = validateDecision(state, "A", decision);
      expect(result.ok).toBe(true);
    });
  });

  // ─── WP-F.2 display-id normalisation at the validator boundary ────────
  //
  // Per North Star §1 (locked design decision #1) and the system prompt,
  // the LLM emits attack / move-toward / move-away targets as typed
  // display ids (`Player_N`, the `displayName`). The validator must
  // bridge that to the engine `characterId` so production targets
  // resolve correctly — historically every `Player_N` target was
  // rejected as "not a living character", driving the safe-default
  // fallback rate well past the closing-10 ≤10% threshold.
  describe("WP-F.2 display-id (Player_N) target normalisation — ADR §1", () => {
    it("attack target=displayName 'Player_3' (engine id is opaque) → valid", () => {
      const me: CharacterState = {
        characterId: "char_opaque_a",
        personaId: "rat",
        spawnIndex: 0,
        displayName: "Player_1",
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
        personaId: "rat",
        spawnIndex: 2,
        displayName: "Player_3",
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
        action: { kind: "attack", targetCharacterId: "Player_3" },
      };
      const result = validateDecision(state, "char_opaque_a", decision);
      expect(result.ok).toBe(true);
    });

    it("attack target=Player_99 (no such character) → safe-default with 'not a living character' reason", () => {
      const me: CharacterState = {
        characterId: "char_opaque_a",
        personaId: "rat",
        spawnIndex: 0,
        displayName: "Player_1",
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
        action: { kind: "attack", targetCharacterId: "Player_99" },
      };
      const result = validateDecision(state, "char_opaque_a", decision);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        // Closing-10 reports key off the "not a living character" wording.
        expect(result.reason).toMatch(/not a living character/);
        expect(result.reason).toContain("Player_99");
        expect(result.safeDefault).toEqual(SAFE_DEFAULT_DECISION);
      }
    });

    it("move:toward_entity targetCharacterId='Player_3' → valid (engine id is opaque)", () => {
      const me: CharacterState = {
        characterId: "char_opaque_a",
        personaId: "rat",
        spawnIndex: 0,
        displayName: "Player_1",
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
        personaId: "rat",
        spawnIndex: 2,
        displayName: "Player_3",
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
        primary: "move",
        move: { kind: "toward_entity", targetCharacterId: "Player_3" },
      };
      const result = validateDecision(state, "char_opaque_a", decision);
      expect(result.ok).toBe(true);
    });

    it("move:toward_entity targetCharacterId='Player_99' (unknown) → safe-default", () => {
      const me: CharacterState = {
        characterId: "char_opaque_a",
        personaId: "rat",
        spawnIndex: 0,
        displayName: "Player_1",
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
        primary: "move",
        move: { kind: "toward_entity", targetCharacterId: "Player_99" },
      };
      const result = validateDecision(state, "char_opaque_a", decision);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/not a living character/);
        expect(result.reason).toContain("Player_99");
      }
    });

    it("move:away_from_entity targetCharacterId='Player_3' → valid (engine id is opaque)", () => {
      const me: CharacterState = {
        characterId: "char_opaque_a",
        personaId: "rat",
        spawnIndex: 0,
        displayName: "Player_1",
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
        personaId: "rat",
        spawnIndex: 2,
        displayName: "Player_3",
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
        primary: "move",
        move: { kind: "away_from_entity", targetCharacterId: "Player_3" },
      };
      const result = validateDecision(state, "char_opaque_a", decision);
      expect(result.ok).toBe(true);
    });
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
      action: { kind: "loot", targetId: "chest_b" },
    };
    const result = validateDecision(state, "A", decision);
    expect(result.ok).toBe(true);
  });

  // ─── WP-G.1 Corpse_Player_N typed-id normalisation at validator boundary ─
  //
  // Per North Star §1 + the system prompt's "loot <Visible.id> — copy id
  // verbatim" instruction, the agent emits corpse loot/toward_object targets
  // as the digest's typed id `Corpse_Player_N` (rendered by
  // `convex/llm/inputBuilder.ts:516`). The validator/engine historically
  // only accepted `chest_*`/`Player_*` namespaces, rejecting all
  // `Corpse_Player_*` loot attempts as "invalid namespace prefix"
  // (reviewer-B completion-review-2 HIGH-1).
  //
  // PM-lock D38: fix at the validator/engine boundary by extending
  // normalisation; do NOT change the digest rendering. Mirrors WP-F.2's
  // approach for `Player_N` and the WP-B.10 fix for `Chest_NNN`.
  describe("WP-G.1 Corpse_Player_N corpse-target normalisation — D38", () => {
    it("loot.targetId 'Corpse_Player_5' (typed-id from digest) → valid (resolves to corpse via displayName lookup)", () => {
      const me: CharacterState = {
        characterId: "char_opaque_a",
        personaId: "rat",
        spawnIndex: 0,
        displayName: "Player_1",
        hp: 100,
        maxHp: 100,
        pos: { x: 5, y: 5 },
        equipped: {},
        scratchpad: "",
        hidden: false,
        alive: true,
        lastKnown: [],
      };
      // Dead character whose engine characterId is opaque, displayName Player_5.
      const dead: CharacterState = {
        characterId: "char_opaque_e",
        personaId: "rat",
        spawnIndex: 4,
        displayName: "Player_5",
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
        action: { kind: "loot", targetId: "Corpse_Player_5" },
      };
      const result = validateDecision(state, "char_opaque_a", decision);
      expect(result.ok).toBe(true);
    });

    it("loot.targetId 'Corpse_Player_99' (no such character) → safe-default with corpse reason", () => {
      const me: CharacterState = {
        characterId: "char_opaque_a",
        personaId: "rat",
        spawnIndex: 0,
        displayName: "Player_1",
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
        action: { kind: "loot", targetId: "Corpse_Player_99" },
      };
      const result = validateDecision(state, "char_opaque_a", decision);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/corpse|Corpse_Player_99/i);
        expect(result.safeDefault).toEqual(SAFE_DEFAULT_DECISION);
      }
    });

    it("loot.targetId 'Corpse_Player_5' validator preserves verbatim targetId (resolver normalises + emits verbatim trace, mirrors WP-F.2 pattern)", () => {
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
        displayName: "Player_1",
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
        personaId: "rat",
        spawnIndex: 4,
        displayName: "Player_5",
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
        action: { kind: "loot", targetId: "Corpse_Player_5" },
      };
      const result = validateDecision(state, "char_opaque_a", decision);
      expect(result.ok).toBe(true);
      if (result.ok && result.decision.action.kind === "loot") {
        expect(result.decision.action.targetId).toBe("Corpse_Player_5");
      }
    });

    it("move:toward_object 'Corpse_Player_5' (typed-id from digest) → valid (resolves to corpse tile)", () => {
      const me: CharacterState = {
        characterId: "char_opaque_a",
        personaId: "rat",
        spawnIndex: 0,
        displayName: "Player_1",
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
        personaId: "rat",
        spawnIndex: 4,
        displayName: "Player_5",
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
        primary: "move",
        move: { kind: "toward_object", targetObjectId: "Corpse_Player_5" },
      };
      const result = validateDecision(state, "char_opaque_a", decision);
      expect(result.ok).toBe(true);
    });

    it("move:toward_object 'Corpse_Player_99' (unknown) → safe-default", () => {
      const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
      const state = makeState({ characters: [me] });
      const decision: ParsedDecision = {
        ...defaultDecision(),
        primary: "move",
        move: { kind: "toward_object", targetObjectId: "Corpse_Player_99" },
      };
      const result = validateDecision(state, "A", decision);
      expect(result.ok).toBe(false);
    });

    it("test-fixture path: Corpse_<displayName> when displayName === characterId resolves directly", () => {
      // In test fixtures, characterId often equals displayName (e.g. "B").
      // The Corpse_<id> form must still resolve when there is no separate
      // displayName mapping (handles tests + edge cases where a corpse has
      // a Player_N literal as characterId).
      const me = makeCharacter({ id: "A", pos: { x: 5, y: 5 } });
      const corpse: CorpseState = {
        characterId: "Player_5",
        pos: { x: 6, y: 5 },
        contents: { weapon: { category: "weapon", name: "axe" } },
      };
      const state = makeState({
        characters: [me],
        world: { corpses: [corpse] },
      });
      const decision: ParsedDecision = {
        ...defaultDecision(),
        action: { kind: "loot", targetId: "Corpse_Player_5" },
      };
      const result = validateDecision(state, "A", decision);
      expect(result.ok).toBe(true);
    });
  });
});
