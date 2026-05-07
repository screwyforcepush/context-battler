// WP7 — 8-phase composed resolver tests (TDD: RED phase first).
//
// Spec sections:
//   - concept-spec.md §7  (vision / hiding / reveal causes)
//   - concept-spec.md §9  (turn economy)
//   - concept-spec.md §10 (movement; entity-tracking; no mid-move retarget)
//   - concept-spec.md §11 (overwatch; reveal-on-fire)
//   - concept-spec.md §12 (combat; simultaneous resolution)
//   - concept-spec.md §13 (gear; chest open + equip; corpse formation/loot)
//   - concept-spec.md §14 (consumables; heal/speed)
//   - concept-spec.md §15 (evac; turn-30 reveal; turn-50 extraction)
//   - concept-spec.md §16 (speech; broadcast; reveal speaker)
//   - concept-spec.md §23 (resolution order — THE blueprint)
//   - concept-spec.md §24 (collisions; order-independence)
//   - architecture-decisions.md §6 (locked stat tiers)

import { describe, expect, it } from "vitest";
import { resolveTurn } from "../../convex/engine/resolution.js";
import type {
  CharacterState,
  ItemRef,
  MatchState,
  ParsedDecision,
  PersonaId,
  Tile,
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
  maxHp?: number;
  weapon?: ItemRef;
  armour?: ItemRef;
  consumable?: ItemRef;
  hidden?: boolean;
  alive?: boolean;
  scratchpad?: string;
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
    equipped: {
      weapon: opts.weapon,
      armour: opts.armour,
      consumable: opts.consumable,
    },
    scratchpad: opts.scratchpad ?? "",
    hidden: opts.hidden ?? false,
    alive: opts.alive ?? true,
    lastKnown: [],
  };
}

function makeState(opts: {
  characters: CharacterState[];
  world?: Partial<WorldState>;
  turn?: number;
}): MatchState {
  return {
    matchId: "m",
    turn: opts.turn ?? 1,
    world: makeWorld(opts.world),
    characters: opts.characters,
    rngSeed: "seed",
  };
}

function nullDecision(overrides: Partial<ParsedDecision> = {}): ParsedDecision {
  return {
    consume: "none",
    primary: "stationary_action",
    move: { kind: "none" },
    action: { kind: "none" },
    say: null,
    overwatch_priority: null,
    scratchpad_update: null,
    ...overrides,
  };
}

function findChar(state: MatchState, id: string): CharacterState {
  const c = state.characters.find((c) => c.characterId === id);
  if (!c) throw new Error(`character ${id} not found`);
  return c;
}

// ─── §9 turn economy ─────────────────────────────────────────────────────

describe("WP7 resolution — concept-spec §9 turn economy", () => {
  it("§9 — consume + move + say + scratchpad-update in one turn resolves cleanly", () => {
    // Speed consumable + move + say + scratchpad — all should fire.
    const a = makeCharacter({
      id: "A",
      pos: { x: 0, y: 0 },
      consumable: { category: "consumable", name: "speed" },
    });
    const b = makeCharacter({ id: "B", pos: { x: 30, y: 0 } });
    const state = makeState({ characters: [a, b] });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        {
          consume: "speed",
          primary: "move",
          move: { kind: "toward_entity", targetCharacterId: "B" },
          action: { kind: "none" },
          say: "incoming",
          overwatch_priority: null,
          scratchpad_update: "Plan: rush B",
        },
      ],
      ["B", nullDecision()],
    ]);
    const { state: next, trace } = resolveTurn(state, decisions);
    expect(trace.consumed).toContainEqual({ characterId: "A", item: "speed" });
    expect(trace.moves.find((m) => m.characterId === "A")).toBeTruthy();
    expect(trace.speech).toContainEqual({
      characterId: "A",
      text: "incoming",
      heardBy: [],
    }); // B at dist 30 is out of hearing range (≤20)
    // After: A consumable removed, A moved (speed bumps to 12), scratchpad updated.
    const aAfter = findChar(next, "A");
    expect(aAfter.equipped.consumable).toBeUndefined();
    expect(aAfter.scratchpad).toBe("Plan: rush B");
    expect(aAfter.pos.x).toBeGreaterThan(0);
  });

  it("§9 — primary 'move' resolves move first, THEN action (move-then-attack same turn)", () => {
    // Per concept-spec §9 line 447: "Move up to 8, then optionally take one
    // normal action if valid". WP10.5 fix: the resolver must NOT short-circuit
    // the action phase when primary === "move". Both sub-decisions resolve
    // (movement phase 4, then action phase 5 against post-move position).
    //
    // Setup: A at (0,0), B at (3,0). A's weapon is sword (range 2), B is at
    // Chebyshev 3 — out of attack range. A moves dx=2 → lands at (2,0); B is
    // now at distance 1 (in range). The post-move action then fires.
    const a = makeCharacter({
      id: "A",
      pos: { x: 0, y: 0 },
      weapon: { category: "weapon", name: "sword" }, // 15 dmg
    });
    const b = makeCharacter({ id: "B", pos: { x: 3, y: 0 }, hp: 100 });
    const state = makeState({ characters: [a, b] });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          primary: "move",
          move: { kind: "relative", dx: 2, dy: 0 },
          action: { kind: "attack", targetCharacterId: "B" },
        }),
      ],
      ["B", nullDecision()],
    ]);
    const { state: next, trace } = resolveTurn(state, decisions);
    // A moved to (2,0) — confirms move phase resolved.
    expect(findChar(next, "A").pos).toEqual({ x: 2, y: 0 });
    // sword(15) - cloth(0) = 15 damage → B at 100-15 = 85.
    expect(findChar(next, "B").hp).toBe(85);
    // Trace contains both the move and the attack action.
    expect(trace.moves.find((m) => m.characterId === "A")).toBeTruthy();
    expect(
      trace.actions.find(
        (act) =>
          act.characterId === "A" && act.kind === "attack" && act.target === "B",
      ),
    ).toBeTruthy();
  });

  it("§9 — primary 'move' resolves move first, THEN action (move-then-interact chest)", () => {
    // Sister scenario for chest interaction — the canonical "move to chest,
    // then open" pattern needed for ≥80% chest-equip done-bar (mental-model
    // §10). A at (0,0), chest at (3,0) holding axe. A moves dx=2 → (2,0); chest
    // is now at distance 1 ≤ INTERACT_RANGE (2). The post-move interact opens
    // the chest and equips the axe.
    const a = makeCharacter({
      id: "A",
      pos: { x: 0, y: 0 },
      weapon: { category: "weapon", name: "rusty_blade" },
    });
    const state = makeState({
      characters: [a],
      world: {
        chests: [
          {
            id: "chest_001",
            pos: { x: 3, y: 0 },
            contents: { category: "weapon", name: "axe" },
            opened: false,
            lootTable: "weapons-heavy",
          },
        ],
      },
    });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          primary: "move",
          move: { kind: "toward_object", targetObjectId: "chest_001" },
          action: { kind: "interact", targetObjectId: "chest_001" },
        }),
      ],
    ]);
    const { state: next, trace } = resolveTurn(state, decisions);
    // A moved closer to the chest (toward_object stops at Chebyshev 2 from
    // the chest's static target tile); confirm A is now within INTERACT_RANGE.
    const aAfter = findChar(next, "A");
    expect(Math.max(Math.abs(aAfter.pos.x - 3), Math.abs(aAfter.pos.y - 0))).toBeLessThanOrEqual(2);
    // Chest opened, axe equipped (replacing rusty_blade).
    expect(aAfter.equipped.weapon).toEqual({ category: "weapon", name: "axe" });
    const chest = next.world.chests.find((c) => c.id === "chest_001")!;
    expect(chest.opened).toBe(true);
    expect(chest.contents).toBeNull();
    // Trace contains both the move and the interact action.
    expect(trace.moves.find((m) => m.characterId === "A")).toBeTruthy();
    expect(
      trace.actions.find(
        (act) =>
          act.characterId === "A" &&
          act.kind === "interact" &&
          act.target === "chest_001",
      ),
    ).toBeTruthy();
  });

  it("§9 — primary 'move' with action that is invalid post-move (out of range) → action no-ops cleanly, move still applies", () => {
    // Defensive: even with the §9 short-circuit removed, the resolver's
    // in-range check (resolution.ts attack/interact/loot branches) gates
    // the action against POST-MOVE position. If the action target is still
    // out of range after the move resolves, the action is a no-op (trace
    // entry "out_of_range") — the move itself still applies.
    const a = makeCharacter({
      id: "A",
      pos: { x: 0, y: 0 },
      weapon: { category: "weapon", name: "sword" },
    });
    const b = makeCharacter({ id: "B", pos: { x: 20, y: 0 }, hp: 100 });
    const state = makeState({ characters: [a, b] });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          primary: "move",
          move: { kind: "relative", dx: 2, dy: 0 },
          // B is still at dist 18 after A moves to (2,0) — way out of range.
          action: { kind: "attack", targetCharacterId: "B" },
        }),
      ],
      ["B", nullDecision()],
    ]);
    const { state: next, trace } = resolveTurn(state, decisions);
    // A still moves.
    expect(findChar(next, "A").pos).toEqual({ x: 2, y: 0 });
    // B HP unchanged (action gated by post-move in-range check).
    expect(findChar(next, "B").hp).toBe(100);
    // Trace records the attempted action with out_of_range result.
    expect(
      trace.actions.find(
        (act) =>
          act.characterId === "A" &&
          act.kind === "attack" &&
          act.result === "out_of_range",
      ),
    ).toBeTruthy();
  });
});

// ─── §7 hide reveal ──────────────────────────────────────────────────────

describe("WP7 resolution — concept-spec §7 hide reveal causes", () => {
  it("§7 — consumable use (heal) reveals hidden agent in cover", () => {
    const a = makeCharacter({
      id: "A",
      pos: { x: 5, y: 5 },
      hp: 50,
      consumable: { category: "consumable", name: "heal" },
      hidden: true,
    });
    const state = makeState({
      characters: [a],
      world: { coverTiles: [{ x: 5, y: 5 }] },
    });
    const decisions = new Map<string, ParsedDecision>([
      ["A", nullDecision({ consume: "heal" })],
    ]);
    const { state: next, trace } = resolveTurn(state, decisions);
    expect(trace.visibilityUpdates.some(
      (u) => u.characterId === "A" && u.revealedBy === "consumable",
    )).toBe(true);
    expect(findChar(next, "A").hidden).toBe(false);
    // Heal applied: 50 → 50 + 0.20*100 = 70
    expect(findChar(next, "A").hp).toBe(70);
    // Consumable removed.
    expect(findChar(next, "A").equipped.consumable).toBeUndefined();
  });

  it("§7 — consumable use (speed) reveals hidden agent in cover", () => {
    const a = makeCharacter({
      id: "A",
      pos: { x: 5, y: 5 },
      consumable: { category: "consumable", name: "speed" },
      hidden: true,
    });
    const state = makeState({
      characters: [a],
      world: { coverTiles: [{ x: 5, y: 5 }] },
    });
    const decisions = new Map<string, ParsedDecision>([
      ["A", nullDecision({ consume: "speed" })],
    ]);
    const { trace } = resolveTurn(state, decisions);
    expect(trace.visibilityUpdates.some(
      (u) => u.characterId === "A" && u.revealedBy === "consumable",
    )).toBe(true);
  });

  it("§7 — speech reveals hidden speaker", () => {
    const a = makeCharacter({
      id: "A",
      pos: { x: 5, y: 5 },
      hidden: true,
    });
    const state = makeState({
      characters: [a],
      world: { coverTiles: [{ x: 5, y: 5 }] },
    });
    const decisions = new Map<string, ParsedDecision>([
      ["A", nullDecision({ say: "hi" })],
    ]);
    const { state: next, trace } = resolveTurn(state, decisions);
    expect(trace.visibilityUpdates.some(
      (u) => u.characterId === "A" && u.revealedBy === "speech",
    )).toBe(true);
    expect(findChar(next, "A").hidden).toBe(false);
  });

  it("§7 — leaving cover reveals", () => {
    // A starts in cover hidden, moves out of cover this turn → revealed.
    const a = makeCharacter({
      id: "A",
      pos: { x: 5, y: 5 },
      hidden: true,
    });
    const state = makeState({
      characters: [a],
      world: { coverTiles: [{ x: 5, y: 5 }] },
    });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          primary: "move",
          move: { kind: "relative", dx: 3, dy: 0 },
        }),
      ],
    ]);
    const { state: next, trace } = resolveTurn(state, decisions);
    expect(trace.visibilityUpdates.some(
      (u) => u.characterId === "A" && u.revealedBy === "leaving_cover",
    )).toBe(true);
    expect(findChar(next, "A").hidden).toBe(false);
  });

  it("§7 — enemy within 2 tiles reveals (proximity)", () => {
    // A in cover hidden; B walks within 2 tiles. End-of-turn proximity reveal.
    const a = makeCharacter({
      id: "A",
      pos: { x: 5, y: 5 },
      hidden: true,
    });
    const b = makeCharacter({ id: "B", pos: { x: 10, y: 5 } });
    const state = makeState({
      characters: [a, b],
      world: { coverTiles: [{ x: 5, y: 5 }] },
    });
    const decisions = new Map<string, ParsedDecision>([
      ["A", nullDecision()],
      [
        "B",
        nullDecision({
          primary: "move",
          // Move 5 west so B ends at (5,5)? But A is there. Move to (6,5) — distance 1.
          // We need B visible to A (no walls between) — same row works.
          // Actually toward_entity needs visibility. Use relative.
          move: { kind: "relative", dx: -4, dy: 0 },
        }),
      ],
    ]);
    const { state: next, trace } = resolveTurn(state, decisions);
    // B ends at (6,5), Chebyshev to A=1.
    expect(findChar(next, "B").pos.x).toBe(6);
    // A is now within 2 of B → proximity reveal.
    expect(trace.visibilityUpdates.some(
      (u) => u.characterId === "A" && u.revealedBy === "proximity",
    )).toBe(true);
    expect(findChar(next, "A").hidden).toBe(false);
  });

  it("§7 — agent in cover with no reveal cause stays hidden after end-of-turn recompute", () => {
    const a = makeCharacter({
      id: "A",
      pos: { x: 5, y: 5 },
      hidden: true,
    });
    const b = makeCharacter({ id: "B", pos: { x: 50, y: 50 } }); // far away
    const state = makeState({
      characters: [a, b],
      world: { coverTiles: [{ x: 5, y: 5 }] },
    });
    const decisions = new Map<string, ParsedDecision>([
      ["A", nullDecision()],
      ["B", nullDecision()],
    ]);
    const { state: next } = resolveTurn(state, decisions);
    expect(findChar(next, "A").hidden).toBe(true);
  });

  it("§7 — consumable removed from equipped after use", () => {
    const a = makeCharacter({
      id: "A",
      pos: { x: 0, y: 0 },
      hp: 50,
      consumable: { category: "consumable", name: "heal" },
    });
    const state = makeState({ characters: [a] });
    const decisions = new Map<string, ParsedDecision>([
      ["A", nullDecision({ consume: "heal" })],
    ]);
    const { state: next } = resolveTurn(state, decisions);
    expect(findChar(next, "A").equipped.consumable).toBeUndefined();
    expect(findChar(next, "A").hp).toBe(70);
  });
});

// ─── §11 overwatch ───────────────────────────────────────────────────────

describe("WP7 resolution — concept-spec §11 overwatch", () => {
  it("§11 — overwatch fires on visible in-range enemy", () => {
    const a = makeCharacter({
      id: "A",
      pos: { x: 0, y: 0 },
      weapon: { category: "weapon", name: "axe" },
    });
    const b = makeCharacter({
      id: "B",
      pos: { x: 1, y: 0 },
      hp: 100,
      armour: { category: "armour", name: "leather" },
    });
    const state = makeState({ characters: [a, b] });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          primary: "overwatch",
        }),
      ],
      ["B", nullDecision()],
    ]);
    const { state: next, trace } = resolveTurn(state, decisions);
    // axe (20) - leather (3) = 17 damage; B was 100 → 83.
    expect(findChar(next, "B").hp).toBe(83);
    expect(trace.actions.some(
      (a) => a.characterId === "A" && a.kind === "overwatch" && a.target === "B",
    )).toBe(true);
  });

  it("§11 — overwatch with no target → no fire; no reveal", () => {
    const a = makeCharacter({
      id: "A",
      pos: { x: 5, y: 5 },
      hidden: true,
    });
    const state = makeState({
      characters: [a],
      world: { coverTiles: [{ x: 5, y: 5 }] },
    });
    const decisions = new Map<string, ParsedDecision>([
      ["A", nullDecision({ primary: "overwatch" })],
    ]);
    const { state: next, trace } = resolveTurn(state, decisions);
    expect(findChar(next, "A").hidden).toBe(true); // still hidden
    // No reveal-by-attack in trace.
    expect(trace.visibilityUpdates.find(
      (u) => u.characterId === "A" && u.revealedBy === "attack",
    )).toBeUndefined();
  });

  it("§11 — overwatch fires → reveals overwatcher (reveal-on-fire)", () => {
    const a = makeCharacter({
      id: "A",
      pos: { x: 5, y: 5 },
      weapon: { category: "weapon", name: "axe" },
      hidden: true,
    });
    const b = makeCharacter({ id: "B", pos: { x: 6, y: 5 } });
    const state = makeState({
      characters: [a, b],
      world: { coverTiles: [{ x: 5, y: 5 }] },
    });
    const decisions = new Map<string, ParsedDecision>([
      ["A", nullDecision({ primary: "overwatch" })],
      ["B", nullDecision()],
    ]);
    const { state: next, trace } = resolveTurn(state, decisions);
    expect(trace.visibilityUpdates.some(
      (u) => u.characterId === "A" && u.revealedBy === "attack",
    )).toBe(true);
    expect(findChar(next, "A").hidden).toBe(false);
  });

  it("speech-revealed → overwatch target (phase-3 reveal seen by phase-5 overwatch)", () => {
    // A in cover with overwatch; B in cover says "hi" → revealed in phase 3,
    // becomes valid overwatch target for A in phase 5.
    const a = makeCharacter({
      id: "A",
      pos: { x: 5, y: 5 },
      weapon: { category: "weapon", name: "sword" },
      hidden: true,
    });
    const b = makeCharacter({
      id: "B",
      pos: { x: 6, y: 5 },
      hp: 50,
      hidden: true,
    });
    const state = makeState({
      characters: [a, b],
      world: {
        coverTiles: [
          { x: 5, y: 5 },
          { x: 6, y: 5 },
        ],
      },
    });
    const decisions = new Map<string, ParsedDecision>([
      ["A", nullDecision({ primary: "overwatch" })],
      ["B", nullDecision({ say: "hi" })],
    ]);
    const { state: next } = resolveTurn(state, decisions);
    // sword (15) - 0 = 15 damage. B was 50 → 35.
    expect(findChar(next, "B").hp).toBe(35);
  });
});

// ─── §13 gear / chest / corpse ───────────────────────────────────────────

describe("WP7 resolution — concept-spec §13 gear / loot", () => {
  it("§13 — chest equip replaces slot, discards previous, marks chest opened+contents=null", () => {
    const a = makeCharacter({
      id: "A",
      pos: { x: 0, y: 0 },
      weapon: { category: "weapon", name: "rusty_blade" },
    });
    const state = makeState({
      characters: [a],
      world: {
        chests: [
          {
            id: "chest_001",
            pos: { x: 1, y: 0 },
            contents: { category: "weapon", name: "axe" },
            opened: false,
            lootTable: "weapons-heavy",
          },
        ],
      },
    });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          action: { kind: "interact", targetObjectId: "chest_001" },
        }),
      ],
    ]);
    const { state: next } = resolveTurn(state, decisions);
    expect(findChar(next, "A").equipped.weapon).toEqual({
      category: "weapon",
      name: "axe",
    });
    const chest = next.world.chests.find((c) => c.id === "chest_001")!;
    expect(chest.opened).toBe(true);
    expect(chest.contents).toBeNull();
  });

  it("§13 — corpse loot replaces slot, discards previous, removes from corpse", () => {
    const a = makeCharacter({
      id: "A",
      pos: { x: 0, y: 0 },
      weapon: { category: "weapon", name: "rusty_blade" },
    });
    const state = makeState({
      characters: [a],
      world: {
        corpses: [
          {
            characterId: "deadGuy",
            pos: { x: 1, y: 0 },
            contents: {
              weapon: { category: "weapon", name: "greatsword" },
              armour: { category: "armour", name: "plate" },
            },
          },
        ],
      },
    });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          action: { kind: "loot", targetCorpseId: "deadGuy" },
        }),
      ],
    ]);
    const { state: next } = resolveTurn(state, decisions);
    // Loot picks ONE item; engine choice: pick weapon if present, else armour, else consumable.
    const aAfter = findChar(next, "A");
    expect(aAfter.equipped.weapon).toEqual({
      category: "weapon",
      name: "greatsword",
    });
    const corpse = next.world.corpses.find((c) => c.characterId === "deadGuy")!;
    // Looted item removed from corpse.
    expect(corpse.contents.weapon).toBeUndefined();
  });

  it("§13 — corpse formation on death: corpse contents = full equipped slots", () => {
    // A attacks B; B dies; corpse holds B's full equipped slots.
    const a = makeCharacter({
      id: "A",
      pos: { x: 0, y: 0 },
      weapon: { category: "weapon", name: "greatsword" },
    });
    const b = makeCharacter({
      id: "B",
      pos: { x: 1, y: 0 },
      hp: 10,
      weapon: { category: "weapon", name: "axe" },
      armour: { category: "armour", name: "chain" },
      consumable: { category: "consumable", name: "heal" },
    });
    const state = makeState({ characters: [a, b] });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          action: { kind: "attack", targetCharacterId: "B" },
        }),
      ],
      ["B", nullDecision()],
    ]);
    const { state: next } = resolveTurn(state, decisions);
    expect(findChar(next, "B").alive).toBe(false);
    const corpse = next.world.corpses.find((c) => c.characterId === "B")!;
    expect(corpse).toBeDefined();
    expect(corpse.contents.weapon).toEqual({ category: "weapon", name: "axe" });
    expect(corpse.contents.armour).toEqual({ category: "armour", name: "chain" });
    expect(corpse.contents.consumable).toEqual({
      category: "consumable",
      name: "heal",
    });
  });

  it("§13 — corpse lootable in range 2 from next turn (test on turn N+1 after death)", () => {
    // Pre-condition: corpse already exists (was killed last turn). A loots
    // it from range 2.
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const state = makeState({
      characters: [a],
      world: {
        corpses: [
          {
            characterId: "B",
            pos: { x: 2, y: 0 },
            contents: { weapon: { category: "weapon", name: "axe" } },
          },
        ],
      },
    });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          action: { kind: "loot", targetCorpseId: "B" },
        }),
      ],
    ]);
    const { state: next } = resolveTurn(state, decisions);
    expect(findChar(next, "A").equipped.weapon).toEqual({
      category: "weapon",
      name: "axe",
    });
  });

  it("§13 — death sets diedAtTurn to currentTurn", () => {
    const a = makeCharacter({
      id: "A",
      pos: { x: 0, y: 0 },
      weapon: { category: "weapon", name: "greatsword" },
    });
    const b = makeCharacter({ id: "B", pos: { x: 1, y: 0 }, hp: 5 });
    const state = makeState({ characters: [a, b], turn: 7 });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          action: { kind: "attack", targetCharacterId: "B" },
        }),
      ],
      ["B", nullDecision()],
    ]);
    const { state: next, trace } = resolveTurn(state, decisions);
    const bAfter = findChar(next, "B");
    expect(bAfter.alive).toBe(false);
    expect(bAfter.diedAtTurn).toBe(7);
    expect(trace.deaths).toContain("B");
  });
});

// ─── §15 evac ────────────────────────────────────────────────────────────

describe("WP7 resolution — concept-spec §15 evac", () => {
  it("§15 — turn-30 reveal flips evac.revealedAtTurn", () => {
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const state = makeState({
      characters: [a],
      world: { evac: { centre: { x: 50, y: 50 }, revealedAtTurn: null } },
      turn: 30,
    });
    const decisions = new Map<string, ParsedDecision>([
      ["A", nullDecision()],
    ]);
    const { state: next } = resolveTurn(state, decisions);
    // Phase 8 increments turn → turn becomes 31; evac was revealed at turn 30.
    expect(next.world.evac.revealedAtTurn).toBe(30);
  });

  it("§15 — turn-50 extraction marks living-in-zone as extracted", () => {
    const a = makeCharacter({ id: "A", pos: { x: 50, y: 50 } });
    const b = makeCharacter({ id: "B", pos: { x: 51, y: 50 } });
    const c = makeCharacter({ id: "C", pos: { x: 0, y: 0 } });
    const state = makeState({
      characters: [a, b, c],
      world: { evac: { centre: { x: 50, y: 50 }, revealedAtTurn: 30 } },
      turn: 50,
    });
    const decisions = new Map<string, ParsedDecision>([
      ["A", nullDecision()],
      ["B", nullDecision()],
      ["C", nullDecision()],
    ]);
    const { state: next } = resolveTurn(state, decisions);
    expect(findChar(next, "A").extractedAtTurn).toBe(50);
    expect(findChar(next, "B").extractedAtTurn).toBe(50);
    expect(findChar(next, "C").extractedAtTurn).toBeUndefined();
  });

  it("§15 — not-in-zone-at-end-turn-50 does NOT extract", () => {
    // Zone is 3×3 centred at (50,50): valid x,y ∈ [49..51].
    const a = makeCharacter({ id: "A", pos: { x: 47, y: 50 } });
    const state = makeState({
      characters: [a],
      world: { evac: { centre: { x: 50, y: 50 }, revealedAtTurn: 30 } },
      turn: 50,
    });
    const decisions = new Map<string, ParsedDecision>([
      ["A", nullDecision()],
    ]);
    const { state: next } = resolveTurn(state, decisions);
    expect(findChar(next, "A").extractedAtTurn).toBeUndefined();
  });
});

// ─── §16 speech ──────────────────────────────────────────────────────────

describe("WP7 resolution — concept-spec §16 speech", () => {
  it("§16 — speech timing: emitted in turn N's resolution.speech", () => {
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const b = makeCharacter({ id: "B", pos: { x: 5, y: 0 } });
    const state = makeState({ characters: [a, b] });
    const decisions = new Map<string, ParsedDecision>([
      ["A", nullDecision({ say: "Truce?" })],
      ["B", nullDecision()],
    ]);
    const { trace } = resolveTurn(state, decisions);
    expect(trace.speech).toEqual([
      { characterId: "A", text: "Truce?", heardBy: ["B"] },
    ]);
  });

  it("§16 — hearing range: listeners within Chebyshev ≤ 20 to start-of-turn position", () => {
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const close = makeCharacter({ id: "C", pos: { x: 15, y: 0 } });
    const far = makeCharacter({ id: "F", pos: { x: 25, y: 0 } });
    const state = makeState({ characters: [a, close, far] });
    const decisions = new Map<string, ParsedDecision>([
      ["A", nullDecision({ say: "Hi" })],
      ["C", nullDecision()],
      ["F", nullDecision()],
    ]);
    const { trace } = resolveTurn(state, decisions);
    const speech = trace.speech.find((s) => s.characterId === "A")!;
    expect(speech.heardBy).toContain("C");
    expect(speech.heardBy).not.toContain("F");
  });

  it("§16 — speech heardBy excludes the speaker themselves", () => {
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const b = makeCharacter({ id: "B", pos: { x: 5, y: 0 } });
    const state = makeState({ characters: [a, b] });
    const decisions = new Map<string, ParsedDecision>([
      ["A", nullDecision({ say: "echo" })],
      ["B", nullDecision()],
    ]);
    const { trace } = resolveTurn(state, decisions);
    expect(trace.speech[0]!.heardBy).not.toContain("A");
  });

  it("§16 — speech heardBy excludes dead characters", () => {
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const dead = makeCharacter({
      id: "D",
      pos: { x: 5, y: 0 },
      alive: false,
    });
    const state = makeState({ characters: [a, dead] });
    const decisions = new Map<string, ParsedDecision>([
      ["A", nullDecision({ say: "Hi" })],
    ]);
    const { trace } = resolveTurn(state, decisions);
    expect(trace.speech[0]!.heardBy).not.toContain("D");
  });
});

// ─── §24 collisions + order-independence ─────────────────────────────────

describe("WP7 resolution — concept-spec §24 simultaneous-tile collision + order-independence", () => {
  it("§24 — two agents into same tile both fail; both stay put", () => {
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 1 } });
    const b = makeCharacter({ id: "B", pos: { x: 2, y: 1 } });
    const state = makeState({ characters: [a, b] });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          primary: "move",
          move: { kind: "relative", dx: 1, dy: 0 },
        }),
      ],
      [
        "B",
        nullDecision({
          primary: "move",
          move: { kind: "relative", dx: -1, dy: 0 },
        }),
      ],
    ]);
    const { state: next } = resolveTurn(state, decisions);
    expect(findChar(next, "A").pos).toEqual({ x: 0, y: 1 });
    expect(findChar(next, "B").pos).toEqual({ x: 2, y: 1 });
  });

  it("§24 — order-independence of resolveTurn: shuffle decisions input → identical post-state", () => {
    // 5 permutations.
    const buildState = () => {
      const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
      const b = makeCharacter({ id: "B", pos: { x: 10, y: 0 } });
      const c = makeCharacter({ id: "C", pos: { x: 5, y: 10 } });
      return makeState({ characters: [a, b, c] });
    };
    const dA: ParsedDecision = nullDecision({
      primary: "move",
      move: { kind: "relative", dx: 5, dy: 5 },
      say: "A says",
    });
    const dB: ParsedDecision = nullDecision({
      primary: "move",
      move: { kind: "relative", dx: -3, dy: 0 },
    });
    const dC: ParsedDecision = nullDecision({
      primary: "move",
      move: { kind: "relative", dx: 0, dy: -8 },
    });

    const orderings: Array<Array<["A" | "B" | "C", ParsedDecision]>> = [
      [
        ["A", dA],
        ["B", dB],
        ["C", dC],
      ],
      [
        ["B", dB],
        ["C", dC],
        ["A", dA],
      ],
      [
        ["C", dC],
        ["A", dA],
        ["B", dB],
      ],
      [
        ["B", dB],
        ["A", dA],
        ["C", dC],
      ],
      [
        ["C", dC],
        ["B", dB],
        ["A", dA],
      ],
    ];
    const results = orderings.map((ord) => {
      const m = new Map<string, ParsedDecision>(ord);
      return resolveTurn(buildState(), m).state;
    });
    const positions = (s: MatchState) =>
      [...s.characters]
        .sort((x, y) => x.characterId.localeCompare(y.characterId))
        .map((c) => ({ id: c.characterId, pos: c.pos, hp: c.hp }));
    for (let i = 1; i < results.length; i++) {
      expect(positions(results[i]!)).toEqual(positions(results[0]!));
    }
  });
});

// ─── §12 simultaneous combat ─────────────────────────────────────────────

describe("WP7 resolution — concept-spec §12 simultaneous combat", () => {
  it("§12 — A and B simultaneously kill each other → both die in same turn", () => {
    const a = makeCharacter({
      id: "A",
      pos: { x: 0, y: 0 },
      hp: 10,
      weapon: { category: "weapon", name: "greatsword" }, // 25 dmg
    });
    const b = makeCharacter({
      id: "B",
      pos: { x: 1, y: 0 },
      hp: 10,
      weapon: { category: "weapon", name: "greatsword" }, // 25 dmg
    });
    const state = makeState({ characters: [a, b] });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          action: { kind: "attack", targetCharacterId: "B" },
        }),
      ],
      [
        "B",
        nullDecision({
          action: { kind: "attack", targetCharacterId: "A" },
        }),
      ],
    ]);
    const { state: next, trace } = resolveTurn(state, decisions);
    expect(findChar(next, "A").alive).toBe(false);
    expect(findChar(next, "B").alive).toBe(false);
    expect(trace.deaths.sort()).toEqual(["A", "B"]);
  });

  it("§12 — three attackers on one target → all damage applies", () => {
    const t = makeCharacter({
      id: "T",
      pos: { x: 5, y: 5 },
      hp: 100,
      armour: { category: "armour", name: "leather" }, // -3 reduction
    });
    const a = makeCharacter({
      id: "A",
      pos: { x: 4, y: 5 },
      weapon: { category: "weapon", name: "axe" }, // 20-3=17
    });
    const b = makeCharacter({
      id: "B",
      pos: { x: 6, y: 5 },
      weapon: { category: "weapon", name: "sword" }, // 15-3=12
    });
    const c = makeCharacter({
      id: "C",
      pos: { x: 5, y: 4 },
      weapon: { category: "weapon", name: "rusty_blade" }, // 10-3=7
    });
    const state = makeState({ characters: [t, a, b, c] });
    const decisions = new Map<string, ParsedDecision>([
      ["T", nullDecision()],
      [
        "A",
        nullDecision({
          action: { kind: "attack", targetCharacterId: "T" },
        }),
      ],
      [
        "B",
        nullDecision({
          action: { kind: "attack", targetCharacterId: "T" },
        }),
      ],
      [
        "C",
        nullDecision({
          action: { kind: "attack", targetCharacterId: "T" },
        }),
      ],
    ]);
    const { state: next } = resolveTurn(state, decisions);
    // 100 - 17 - 12 - 7 = 64
    expect(findChar(next, "T").hp).toBe(64);
  });
});

// ─── §10 no mid-movement retargeting ─────────────────────────────────────

describe("WP7 resolution — concept-spec §10 no mid-movement retarget", () => {
  it("§10 — agent does NOT retarget mid-movement (regression: combined movement+action)", () => {
    // A heads toward B; C enters near A's path. A continues toward B.
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const b = makeCharacter({ id: "B", pos: { x: 20, y: 0 } });
    const c = makeCharacter({ id: "C", pos: { x: 5, y: 5 } });
    const state = makeState({ characters: [a, b, c] });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          primary: "move",
          move: { kind: "toward_entity", targetCharacterId: "B" },
        }),
      ],
      ["B", nullDecision()],
      ["C", nullDecision()],
    ]);
    const { state: next } = resolveTurn(state, decisions);
    expect(findChar(next, "A").pos).toEqual({ x: 8, y: 0 });
  });
});

// ─── §23 phase ordering ──────────────────────────────────────────────────

describe("WP7 resolution — concept-spec §23 phase ordering", () => {
  it("§23 — phase ordering: speech (3) BEFORE movement (4) BEFORE actions (5) BEFORE deaths (6) BEFORE visibility (7)", () => {
    // Setup: A says "hi" while hidden in cover (phase 3 reveal). B has overwatch
    // (phase 5). B's overwatch fires on A (because A was revealed in phase 3).
    // A's HP=5, B's axe (20) - cloth (0) = 20 — A dies. Phase 6: A becomes corpse.
    // Phase 7: visibility recompute; A is dead.
    const a = makeCharacter({
      id: "A",
      pos: { x: 5, y: 5 },
      hp: 5,
      hidden: true,
      weapon: { category: "weapon", name: "rusty_blade" },
    });
    const b = makeCharacter({
      id: "B",
      pos: { x: 6, y: 5 },
      weapon: { category: "weapon", name: "axe" },
      hidden: true,
    });
    const state = makeState({
      characters: [a, b],
      world: {
        coverTiles: [
          { x: 5, y: 5 },
          { x: 6, y: 5 },
        ],
      },
    });
    const decisions = new Map<string, ParsedDecision>([
      ["A", nullDecision({ say: "hi" })],
      ["B", nullDecision({ primary: "overwatch" })],
    ]);
    const { state: next, trace } = resolveTurn(state, decisions);
    // Phase 3: A's speech recorded. Phase 5: B fires on A. Phase 6: A dies.
    expect(trace.speech.find((s) => s.characterId === "A")).toBeDefined();
    expect(trace.deaths).toContain("A");
    // A is now a corpse.
    expect(next.world.corpses.find((c) => c.characterId === "A")).toBeDefined();
  });

  it("§23 — attacks targeting characters who died this same phase-6 are NO-OPs (in v0 they all land simultaneously, but a dead-this-turn target stays dead)", () => {
    // A and B both attack each other; both die. Their attacks STILL land
    // (collected before death applied — concept-spec §12 simultaneous).
    const a = makeCharacter({
      id: "A",
      pos: { x: 0, y: 0 },
      hp: 5,
      weapon: { category: "weapon", name: "greatsword" },
    });
    const b = makeCharacter({
      id: "B",
      pos: { x: 1, y: 0 },
      hp: 5,
      weapon: { category: "weapon", name: "greatsword" },
    });
    const state = makeState({ characters: [a, b] });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          action: { kind: "attack", targetCharacterId: "B" },
        }),
      ],
      [
        "B",
        nullDecision({
          action: { kind: "attack", targetCharacterId: "A" },
        }),
      ],
    ]);
    const { state: next } = resolveTurn(state, decisions);
    // Both die — neither survived to "save" the other.
    expect(findChar(next, "A").alive).toBe(false);
    expect(findChar(next, "B").alive).toBe(false);
  });
});

// ─── End-to-end smoke ────────────────────────────────────────────────────

describe("WP7 resolution — end-to-end short scenario", () => {
  it("end-to-end: 3 turns, 3 characters, mixed actions, no invalid states", () => {
    const a = makeCharacter({
      id: "A",
      pos: { x: 0, y: 0 },
      weapon: { category: "weapon", name: "axe" },
      armour: { category: "armour", name: "leather" },
    });
    const b = makeCharacter({
      id: "B",
      pos: { x: 5, y: 5 },
      hp: 50,
      weapon: { category: "weapon", name: "sword" },
    });
    const c = makeCharacter({
      id: "C",
      pos: { x: 10, y: 10 },
      consumable: { category: "consumable", name: "heal" },
    });
    let state = makeState({ characters: [a, b, c] });

    // Turn 1: A moves toward B; B says "hi"; C heals.
    let decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          primary: "move",
          move: { kind: "toward_entity", targetCharacterId: "B" },
        }),
      ],
      ["B", nullDecision({ say: "hi" })],
      ["C", nullDecision({ consume: "heal" })],
    ]);
    state = resolveTurn(state, decisions).state;

    // Turn 2: A attacks B (must be in range now); B attacks A; C moves toward A.
    decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          action: { kind: "attack", targetCharacterId: "B" },
        }),
      ],
      [
        "B",
        nullDecision({
          action: { kind: "attack", targetCharacterId: "A" },
        }),
      ],
      [
        "C",
        nullDecision({
          primary: "move",
          move: { kind: "toward_entity", targetCharacterId: "A" },
        }),
      ],
    ]);
    state = resolveTurn(state, decisions).state;

    // Turn 3: noop.
    decisions = new Map<string, ParsedDecision>([
      ["A", nullDecision()],
      ["B", nullDecision()],
      ["C", nullDecision()],
    ]);
    state = resolveTurn(state, decisions).state;

    // Invariants: every alive character on a non-wall tile; HP ≤ maxHp.
    for (const ch of state.characters) {
      expect(ch.hp).toBeLessThanOrEqual(ch.maxHp);
      // Non-extracted living characters must be on a walkable tile (no walls in setup).
      if (ch.alive) {
        expect(ch.pos.x).toBeGreaterThanOrEqual(0);
        expect(ch.pos.y).toBeGreaterThanOrEqual(0);
        expect(ch.pos.x).toBeLessThan(state.world.size.w);
        expect(ch.pos.y).toBeLessThan(state.world.size.h);
      }
    }
    // Turn advanced 3 times.
    expect(state.turn).toBe(4);
  });
});
