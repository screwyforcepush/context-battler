// WP7 — Combat math + simultaneous-kill tests (TDD: RED phase first).
//
// Spec sections covered:
//   - concept-spec.md §12 (deterministic damage; min floor; simultaneous)
//   - concept-spec.md §14 (weapon stat tiers; range 2 for all v0 weapons)
//   - architecture-decisions.md §6 (locked stat tiers, MIN_DAMAGE_FLOOR=5)
//
// All tests reference the spec section in their name.

import { describe, expect, it } from "vitest";
import {
  applyDamage,
  damageFor,
  weaponRange,
} from "../../convex/engine/combat.js";
import type {
  CharacterState,
  ItemRef,
  MatchState,
  PersonaId,
  Tile,
  WorldState,
} from "../../convex/engine/types.js";

// ─── Test helpers ─────────────────────────────────────────────────────────

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
  alive?: boolean;
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
    scratchpad: "",
    hidden: false,
    alive: opts.alive ?? true,
    lastKnown: [],
  };
}

function makeState(characters: CharacterState[]): MatchState {
  return {
    matchId: "m",
    turn: 1,
    world: makeWorld(),
    characters,
    rngSeed: "seed",
  };
}

// ─── damageFor — deterministic damage formula (§12 / ADR §6) ─────────────

describe("WP7 combat — damageFor (concept-spec §12, ADR §6)", () => {
  it("§12 — axe (20) vs leather (3) deals 17", () => {
    expect(
      damageFor(
        { category: "weapon", name: "axe" },
        { category: "armour", name: "leather" },
      ),
    ).toBe(17);
  });

  it("§12 — sword (15) vs plate (10) → floor binds at 5", () => {
    expect(
      damageFor(
        { category: "weapon", name: "sword" },
        { category: "armour", name: "plate" },
      ),
    ).toBe(5);
  });

  it("§12 — rusty_blade (10) vs plate (10) → floor binds at 5", () => {
    expect(
      damageFor(
        { category: "weapon", name: "rusty_blade" },
        { category: "armour", name: "plate" },
      ),
    ).toBe(5);
  });

  it("§12 — greatsword (25) vs cloth (0) → 25", () => {
    expect(
      damageFor(
        { category: "weapon", name: "greatsword" },
        { category: "armour", name: "cloth" },
      ),
    ).toBe(25);
  });

  it("§12 — minimum damage floor is 5 even when negative gross", () => {
    // 10 - 10 = 0; floor binds → 5
    expect(
      damageFor(
        { category: "weapon", name: "rusty_blade" },
        { category: "armour", name: "plate" },
      ),
    ).toBeGreaterThanOrEqual(5);
  });

  it("§12 — unarmed attacker vs no-armour defender hits at floor (5)", () => {
    // Unarmed default damage chosen so floor binds — engine documents
    // unarmed = 5 base. Defender with cloth (0) still takes floor=5.
    expect(damageFor(undefined, undefined)).toBe(5);
    expect(damageFor(undefined, { category: "armour", name: "cloth" })).toBe(5);
  });

  it("§12 — no-armour defender takes full weapon damage", () => {
    expect(damageFor({ category: "weapon", name: "sword" }, undefined)).toBe(15);
  });

  it("§12 — sword (15) vs leather (3) → 12", () => {
    expect(
      damageFor(
        { category: "weapon", name: "sword" },
        { category: "armour", name: "leather" },
      ),
    ).toBe(12);
  });

  it("§12 — sword (15) vs chain (6) → 9", () => {
    expect(
      damageFor(
        { category: "weapon", name: "sword" },
        { category: "armour", name: "chain" },
      ),
    ).toBe(9);
  });

  it("§12 — axe (20) vs plate (10) → 10 (above floor)", () => {
    expect(
      damageFor(
        { category: "weapon", name: "axe" },
        { category: "armour", name: "plate" },
      ),
    ).toBe(10);
  });

  it("§12 — damageFor is pure: same input → same output (twice)", () => {
    const a = damageFor(
      { category: "weapon", name: "axe" },
      { category: "armour", name: "leather" },
    );
    const b = damageFor(
      { category: "weapon", name: "axe" },
      { category: "armour", name: "leather" },
    );
    expect(a).toBe(b);
    expect(a).toBe(17);
  });

  it("§12 — non-weapon ItemRef in weapon slot is treated as unarmed", () => {
    // Defensive: if a corrupt ItemRef ever slipped through, the engine
    // must not crash. Unarmed default applies.
    expect(damageFor({ category: "consumable", name: "heal" }, undefined)).toBe(
      5,
    );
  });
});

// ─── weaponRange (§14) ───────────────────────────────────────────────────

describe("WP7 combat — weaponRange (concept-spec §14)", () => {
  it("§14 — axe range is 2", () => {
    expect(weaponRange({ category: "weapon", name: "axe" })).toBe(2);
  });

  it("§14 — all v0 weapons have range 2", () => {
    expect(weaponRange({ category: "weapon", name: "rusty_blade" })).toBe(2);
    expect(weaponRange({ category: "weapon", name: "sword" })).toBe(2);
    expect(weaponRange({ category: "weapon", name: "axe" })).toBe(2);
    expect(weaponRange({ category: "weapon", name: "greatsword" })).toBe(2);
  });

  it("§14 — unarmed range defaults to 2 (matches v0 weapon range)", () => {
    expect(weaponRange(undefined)).toBe(2);
  });
});

// ─── applyDamage — pure HP reduction ─────────────────────────────────────

describe("WP7 combat — applyDamage purity + correctness", () => {
  it("§12 — applyDamage reduces defender HP by exactly dmg", () => {
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const b = makeCharacter({ id: "B", pos: { x: 1, y: 1 }, hp: 50 });
    const state = makeState([a, b]);
    const next = applyDamage(state, "A", "B", 17);
    const after = next.characters.find((c) => c.characterId === "B")!;
    expect(after.hp).toBe(33);
  });

  it("§12 — applyDamage does not mutate the input state", () => {
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const b = makeCharacter({ id: "B", pos: { x: 1, y: 1 }, hp: 50 });
    const state = makeState([a, b]);
    applyDamage(state, "A", "B", 17);
    const stillB = state.characters.find((c) => c.characterId === "B")!;
    expect(stillB.hp).toBe(50);
  });

  it("§12 — A and B simultaneously kill each other → both die (HP ≤ 0)", () => {
    // Simultaneity invariant: damage events COLLECTED then APPLIED in a
    // batch; mid-phase HP changes don't affect either side's lethality.
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 }, hp: 10 });
    const b = makeCharacter({ id: "B", pos: { x: 1, y: 1 }, hp: 10 });
    const state = makeState([a, b]);
    let next = applyDamage(state, "A", "B", 10);
    next = applyDamage(next, "B", "A", 10);
    const fa = next.characters.find((c) => c.characterId === "A")!;
    const fb = next.characters.find((c) => c.characterId === "B")!;
    expect(fa.hp).toBeLessThanOrEqual(0);
    expect(fb.hp).toBeLessThanOrEqual(0);
  });

  it("§12 — three attackers on one target → all damage applies cumulatively", () => {
    const t = makeCharacter({ id: "T", pos: { x: 0, y: 0 }, hp: 50 });
    const a = makeCharacter({ id: "A", pos: { x: 1, y: 0 } });
    const b = makeCharacter({ id: "B", pos: { x: 0, y: 1 } });
    const c = makeCharacter({ id: "C", pos: { x: 1, y: 1 } });
    let state = makeState([t, a, b, c]);
    state = applyDamage(state, "A", "T", 10);
    state = applyDamage(state, "B", "T", 15);
    state = applyDamage(state, "C", "T", 20);
    const final = state.characters.find((c) => c.characterId === "T")!;
    expect(final.hp).toBe(5);
  });

  it("§12 — applyDamage on missing defender is a safe no-op", () => {
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const state = makeState([a]);
    const next = applyDamage(state, "A", "ghost", 10);
    expect(next.characters).toEqual(state.characters);
  });

  it("§12 — applyDamage is pure: same input → same output", () => {
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const b = makeCharacter({ id: "B", pos: { x: 1, y: 1 }, hp: 50 });
    const state = makeState([a, b]);
    const r1 = applyDamage(state, "A", "B", 10);
    const r2 = applyDamage(state, "A", "B", 10);
    expect(r1.characters.find((c) => c.characterId === "B")!.hp).toBe(
      r2.characters.find((c) => c.characterId === "B")!.hp,
    );
  });
});
