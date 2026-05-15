// WP7 — Combat math + simultaneous-kill tests (TDD: RED phase first).
//
// Spec sections covered:
//   - concept-spec.md §12 (deterministic damage; min floor; simultaneous)
//   - concept-spec.md §14 (weapon stat tiers; range 2 for all v0 weapons)
//   - architecture-decisions.md §6 (locked stat tiers, MIN_DAMAGE_FLOOR=5)
//
// All tests reference the spec section in their name.

import { describe, expect, it } from "vitest";
import { resolveTurn } from "../../convex/engine/resolution.js";
import {
  applyDamage,
  damageFor,
  weaponRange,
} from "../../convex/engine/combat.js";
import {
  WEAPONS,
  ARMOUR,
} from "../../convex/engine/types.js";
import type {
  CharacterState,
  ItemRef,
  MatchState,
  ParsedDecision,
  PersonaId,
  Tile,
  WorldState,
} from "../../convex/engine/types.js";

// ─── Test helpers ─────────────────────────────────────────────────────────

function makeWorld(overrides: Partial<WorldState> = {}): WorldState {
  return {
    size: { w: 100, h: 100 },
    walls: [],
    coverClusters: [],
    coverTiles: [],
    crates: [],
    airdrops: [],
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

function nullDecision(overrides: Partial<ParsedDecision> = {}): ParsedDecision {
  return {
    use: null,
    position: { kind: "move", direction: { kind: "N" }, dist: 0 },
    action: { kind: "none" },
    say: null,
    scratchpad: null,
    ...overrides,
  };
}

// ─── damageFor — deterministic damage formula (§12 / ADR §6) ─────────────

describe("WP7 combat — damageFor (concept-spec §12, ADR §6)", () => {
  it("§12 — axe (20 dps) vs leather (10%) → round(20*0.9)=18", () => {
    expect(
      damageFor(
        { category: "weapon", name: "axe" },
        { category: "armour", name: "leather" },
      ),
    ).toBe(18);
  });

  it("§12 — sword (15 dps) vs plate (30%) → round(15*0.7)=round(10.5)=11", () => {
    expect(
      damageFor(
        { category: "weapon", name: "sword" },
        { category: "armour", name: "plate" },
      ),
    ).toBe(11);
  });

  it("§12 — rusty_blade (10 dps) vs plate (30%) → round(10*0.7)=7 (above floor)", () => {
    expect(
      damageFor(
        { category: "weapon", name: "rusty_blade" },
        { category: "armour", name: "plate" },
      ),
    ).toBe(7);
  });

  it("§12 — greatsword (25 dps) vs cloth (5%) → round(25*0.95)=round(23.75)=24", () => {
    expect(
      damageFor(
        { category: "weapon", name: "greatsword" },
        { category: "armour", name: "cloth" },
      ),
    ).toBe(24);
  });

  it("§12 — minimum damage floor is 5 even when percentage-reduced result would be below it", () => {
    // dagger (8) * 0.6 = 4.8 → round → 5 → floor binds → 5
    expect(
      damageFor(
        { category: "weapon", name: "dagger" },
        { category: "armour", name: "riot_plate" },
      ),
    ).toBeGreaterThanOrEqual(5);
  });

  it("§12 — unarmed attacker vs no-armour defender hits at floor (5)", () => {
    // Unarmed default damage chosen so floor binds — engine documents
    // unarmed = MIN_DAMAGE_FLOOR base. Defender with cloth (5%) still takes floor=5.
    // round(5 * 0.95) = round(4.75) = 5 → floor binds → 5.
    expect(damageFor(undefined, undefined)).toBe(5);
    expect(damageFor(undefined, { category: "armour", name: "cloth" })).toBe(5);
  });

  it("§12 — no-armour defender takes full weapon dps", () => {
    expect(damageFor({ category: "weapon", name: "sword" }, undefined)).toBe(15);
  });

  it("§12 — sword (15 dps) vs leather (10%) → round(15*0.9)=round(13.5)=14", () => {
    expect(
      damageFor(
        { category: "weapon", name: "sword" },
        { category: "armour", name: "leather" },
      ),
    ).toBe(14);
  });

  it("§12 — sword (15 dps) vs chain (20%) → round(15*0.8)=12", () => {
    expect(
      damageFor(
        { category: "weapon", name: "sword" },
        { category: "armour", name: "chain" },
      ),
    ).toBe(12);
  });

  it("§12 — axe (20 dps) vs plate (30%) → round(20*0.7)=14 (above floor)", () => {
    expect(
      damageFor(
        { category: "weapon", name: "axe" },
        { category: "armour", name: "plate" },
      ),
    ).toBe(14);
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
    expect(a).toBe(18);
  });

  it("WP-B — dagger deals 8 dps and warhammer deals 30 dps before armour", () => {
    expect(damageFor({ category: "weapon", name: "dagger" }, undefined)).toBe(
      8,
    );
    expect(
      damageFor({ category: "weapon", name: "warhammer" }, undefined),
    ).toBe(30);
  });

  it("WP-B — riot_plate (40%): warhammer (30 dps) → round(30*0.6)=18; sword (15 dps) → round(15*0.6)=9", () => {
    expect(
      damageFor(
        { category: "weapon", name: "warhammer" },
        { category: "armour", name: "riot_plate" },
      ),
    ).toBe(18);
    expect(
      damageFor(
        { category: "weapon", name: "sword" },
        { category: "armour", name: "riot_plate" },
      ),
    ).toBe(9);
  });

  it("§12 — non-weapon ItemRef in weapon slot is treated as unarmed", () => {
    // Defensive: if a corrupt ItemRef ever slipped through, the engine
    // must not crash. Unarmed default applies.
    expect(damageFor({ category: "consumable", name: "heal" }, undefined)).toBe(
      5,
    );
  });
});

// ─── damageFor — percentage-reduction formula (new contract) ─────────────

describe("WP7 combat — percentage armour reduction (new contract, concept-spec §12)", () => {
  it("§12 pct — cloth (5%) reduces damage: warhammer (30) vs cloth = round(30*0.95)=round(28.5)=29", () => {
    expect(
      damageFor(
        { category: "weapon", name: "warhammer" },
        { category: "armour", name: "cloth" },
      ),
    ).toBe(29);
  });

  it("§12 pct — leather (10%): sword (15) * 0.9 = 13.5 → round → 14", () => {
    expect(
      damageFor(
        { category: "weapon", name: "sword" },
        { category: "armour", name: "leather" },
      ),
    ).toBe(14);
  });

  it("§12 pct — chain (20%): axe (20) * 0.8 = 16", () => {
    expect(
      damageFor(
        { category: "weapon", name: "axe" },
        { category: "armour", name: "chain" },
      ),
    ).toBe(16);
  });

  it("§12 pct — plate (30%): greatsword (25) * 0.7 = 17.5 → round → 18", () => {
    expect(
      damageFor(
        { category: "weapon", name: "greatsword" },
        { category: "armour", name: "plate" },
      ),
    ).toBe(18);
  });

  it("§12 pct — riot_plate (40%): warhammer (30) * 0.6 = 18", () => {
    expect(
      damageFor(
        { category: "weapon", name: "warhammer" },
        { category: "armour", name: "riot_plate" },
      ),
    ).toBe(18);
  });

  it("§12 pct — no-invincibility: highest armour (riot_plate 40%) vs lowest dps (dagger 8) → ≥ MIN_DAMAGE_FLOOR and > 0", () => {
    // dagger (8) * 0.6 = 4.8 → round → 5 → clamp to floor(5) → 5
    const dmg = damageFor(
      { category: "weapon", name: "dagger" },
      { category: "armour", name: "riot_plate" },
    );
    expect(dmg).toBeGreaterThanOrEqual(5);
    expect(dmg).toBeGreaterThan(0);
  });

  it("§12 pct — no-invincibility: riot_plate never makes any weapon deal 0 damage", () => {
    const weapons = ["rusty_blade", "dagger", "sword", "axe", "greatsword", "warhammer"] as const;
    for (const w of weapons) {
      const dmg = damageFor(
        { category: "weapon", name: w },
        { category: "armour", name: "riot_plate" },
      );
      expect(dmg, `${w} vs riot_plate must deal > 0`).toBeGreaterThan(0);
      expect(dmg, `${w} vs riot_plate must be ≥ MIN_DAMAGE_FLOOR`).toBeGreaterThanOrEqual(5);
    }
  });

  it("§12 pct — unarmed (MIN_DAMAGE_FLOOR base) vs any armour always ≥ floor", () => {
    const armours = ["cloth", "leather", "chain", "plate", "riot_plate"] as const;
    for (const a of armours) {
      const dmg = damageFor(undefined, { category: "armour", name: a });
      expect(dmg, `unarmed vs ${a} must be ≥ 5`).toBeGreaterThanOrEqual(5);
    }
  });

  it("§12 pct — no armour takes full weapon dps: rusty_blade (10) vs no armour = 10", () => {
    expect(damageFor({ category: "weapon", name: "rusty_blade" }, undefined)).toBe(10);
  });

  it("§12 pct — dps field on WEAPONS (not damage): warhammer.dps = 30", () => {
    // The rename: WEAPONS[x].dps replaces WEAPONS[x].damage
    expect((WEAPONS.warhammer as { dps?: number }).dps).toBe(30);
    expect((WEAPONS.warhammer as { damage?: number }).damage).toBeUndefined();
  });

  it("§12 pct — WEAPONS entries have tempo attribute (render-only, no dps effect)", () => {
    for (const [name, entry] of Object.entries(WEAPONS)) {
      expect(
        (entry as { tempo?: string }).tempo,
        `${name} must have tempo attribute`,
      ).toMatch(/^(slow|med|fast)$/);
    }
  });

  it("§12 pct — ARMOUR uses reductionPct field (not reduction)", () => {
    expect((ARMOUR.riot_plate as { reductionPct?: number }).reductionPct).toBe(0.40);
    expect((ARMOUR.plate as { reductionPct?: number }).reductionPct).toBe(0.30);
    expect((ARMOUR.chain as { reductionPct?: number }).reductionPct).toBe(0.20);
    expect((ARMOUR.leather as { reductionPct?: number }).reductionPct).toBe(0.10);
    expect((ARMOUR.cloth as { reductionPct?: number }).reductionPct).toBe(0.05);
    // Old field must be gone
    expect((ARMOUR.plate as { reduction?: number }).reduction).toBeUndefined();
  });

  it("§12 pct — reductionPct is strictly < 1.0 for all armour tiers (no invincibility)", () => {
    for (const [name, entry] of Object.entries(ARMOUR)) {
      const pct = (entry as { reductionPct: number }).reductionPct;
      expect(pct, `${name}.reductionPct must be < 1.0`).toBeLessThan(1.0);
    }
  });
});

// ─── weaponRange (§14) ───────────────────────────────────────────────────

describe("WP7 combat — weaponRange (concept-spec §14)", () => {
  it("§14 — axe range is 2", () => {
    expect(weaponRange({ category: "weapon", name: "axe" })).toBe(2);
  });

  it("§14 — all v0 weapons have range 2", () => {
    expect(weaponRange({ category: "weapon", name: "rusty_blade" })).toBe(2);
    expect(weaponRange({ category: "weapon", name: "dagger" })).toBe(2);
    expect(weaponRange({ category: "weapon", name: "sword" })).toBe(2);
    expect(weaponRange({ category: "weapon", name: "axe" })).toBe(2);
    expect(weaponRange({ category: "weapon", name: "greatsword" })).toBe(2);
    expect(weaponRange({ category: "weapon", name: "warhammer" })).toBe(2);
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

// ─── WP-A strike-time weapon trace contract ─────────────────────────────────

describe("WP-A combat trace weapon emission", () => {
  it("normal damage trace carries the attacker's strike-time weapon name", () => {
    const attacker = makeCharacter({
      id: "A",
      pos: { x: 0, y: 0 },
      weapon: { category: "weapon", name: "sword" },
    });
    const defender = makeCharacter({ id: "B", pos: { x: 1, y: 0 }, hp: 50 });
    const state = makeState([attacker, defender]);
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({ action: { kind: "attack", targetId: "B" } }),
      ],
      ["B", nullDecision()],
    ]);

    const { trace } = resolveTurn(state, decisions);
    const attack = trace.actions.find(
      (a) => a.characterId === "A" && a.kind === "attack",
    );

    expect(attack).toBeDefined();
    expect(attack!.result).toBe("dmg 15");
    expect(attack!.weapon).toBe("sword");
  });

  it("unarmed damage trace omits weapon instead of persisting undefined", () => {
    const attacker = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const defender = makeCharacter({ id: "B", pos: { x: 1, y: 0 }, hp: 50 });
    const state = makeState([attacker, defender]);
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({ action: { kind: "attack", targetId: "B" } }),
      ],
      ["B", nullDecision()],
    ]);

    const { trace } = resolveTurn(state, decisions);
    const attack = trace.actions.find(
      (a) => a.characterId === "A" && a.kind === "attack",
    );

    expect(attack).toBeDefined();
    expect(attack!.result).toBe("dmg 5");
    expect("weapon" in attack!).toBe(false);
  });

  it("defensive overwatch counter-fire carries the overwatcher's strike-time weapon", () => {
    const attacker = makeCharacter({
      id: "A",
      pos: { x: 6, y: 5 },
      weapon: { category: "weapon", name: "sword" },
    });
    const defender = makeCharacter({
      id: "D",
      pos: { x: 5, y: 5 },
      weapon: { category: "weapon", name: "axe" },
    });
    const state = makeState([attacker, defender]);
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({ action: { kind: "attack", targetId: "D" } }),
      ],
      [
        "D",
        nullDecision({
          position: { kind: "counter" },
        }),
      ],
    ]);

    const { trace } = resolveTurn(state, decisions);
    const counterFire = trace.actions.find(
      (a) =>
        a.characterId === "D" &&
        a.kind === "counter",
    );

    expect(counterFire).toBeDefined();
    expect(counterFire!.result).toBe("dmg 20");
    expect(counterFire!.weapon).toBe("axe");
  });
});
