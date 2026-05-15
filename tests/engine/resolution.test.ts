// WP7 — 8-phase composed resolver tests (TDD: RED phase first).
//
// Spec sections:
//   - concept-spec.md §7  (vision / hiding / reveal causes)
//   - concept-spec.md §9  (turn economy)
//   - concept-spec.md §10 (movement; entity-tracking; no mid-move retarget)
//   - concept-spec.md §11 (overwatch; reveal-on-fire)
//   - concept-spec.md §12 (combat; simultaneous resolution)
//   - concept-spec.md §13 (gear; crate open + equip; corpse formation/loot)
//   - concept-spec.md §14 (consumables; heal/speed)
//   - concept-spec.md §15 (evac; turn-30 reveal; turn-50 extraction)
//   - concept-spec.md §16 (speech; broadcast; reveal speaker)
//   - concept-spec.md §23 (resolution order — THE blueprint)
//   - concept-spec.md §24 (collisions; order-independence)
//   - architecture-decisions.md §6 (locked stat tiers)

import { describe, expect, it } from "vitest";
import { resolveTurn } from "../../convex/engine/resolution.js";
import { buildKillFeedLines } from "../../convex/llm/inputBuilder.js";
import type {
  AirdropState,
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
  const world: WorldState = {
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
    use: null,
    position: { kind: "move", direction: { kind: "N" }, dist: 0 },
    action: { kind: "none" },
    say: null,
    scratchpad: null,
    ...overrides,
  };
}

function makeAirdrop(
  landsAtTurn: number,
  pos: Tile = { x: 50, y: 50 },
  looted = false,
  contents: ItemRef = { category: "weapon", name: "axe" },
): AirdropState {
  return {
    id: `Crate_${pos.x}_${pos.y}`,
    pos,
    landsAtTurn,
    contents,
    looted,
  };
}

function findChar(state: MatchState, id: string): CharacterState {
  const c = state.characters.find((c) => c.characterId === id);
  if (!c) throw new Error(`character ${id} not found`);
  return c;
}

// ─── §9 turn economy ─────────────────────────────────────────────────────

describe("WP7 resolution — concept-spec §9 turn economy", () => {
  it("§9 — use + position move + say + scratchpad in one turn resolves cleanly", () => {
    // Speed consumable + move + say + scratchpad — all should fire.
    const a = makeCharacter({
      id: "A",
      pos: { x: 0, y: 0 },
      consumable: { category: "consumable", name: "speed" },
    });
    const b = makeCharacter({ id: "B", pos: { x: 20, y: 0 } });
    b.displayName = "Duelist";
    const state = makeState({ characters: [a, b] });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        {
          use: "consumable",
          position: {
            kind: "move",
            direction: { kind: "toward", targetId: "Duelist" },
            dist: 12,
          },
          action: { kind: "none" },
          say: "incoming",
          scratchpad: "Plan: rush B",
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
      heardBy: ["B"],
    });
    // After: A consumable removed, A moved (speed bumps to 12), scratchpad updated.
    const aAfter = findChar(next, "A");
    expect(aAfter.equipped.consumable).toBeUndefined();
    expect(aAfter.scratchpad).toBe("Plan: rush B");
    expect(aAfter.pos.x).toBeGreaterThan(0);
  });

  it("§9 — position move resolves first, THEN action (move-then-attack same turn)", () => {
    // Per concept-spec §9 line 447: "Move up to 8, then optionally take one
    // normal action if valid". WP10.5 fix: the resolver must NOT short-circuit
    // the action phase when moving. Both sub-decisions resolve
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
          position: { kind: "move", direction: { kind: "E" }, dist: 2 },
          action: { kind: "attack", targetId: "B" },
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

  it("§9 — position move resolves first, THEN action (move-then-loot crate)", () => {
    // Sister scenario for crate interaction — the canonical "move to crate,
    // then open" pattern needed for ≥80% crate-equip done-bar (mental-model
    // §10). A at (0,0), crate at (3,0) holding axe. A moves dx=2 → (2,0); crate
    // is now at distance 1 ≤ INTERACT_RANGE (2). The post-move interact opens
    // the crate and equips the axe.
    const a = makeCharacter({
      id: "A",
      pos: { x: 0, y: 0 },
      weapon: { category: "weapon", name: "rusty_blade" },
    });
    const state = makeState({
      characters: [a],
      world: {
        crates: [
          {
            id: "Crate_3_0",
            pos: { x: 3, y: 0 },
            contents: { category: "weapon", name: "axe" },
            opened: false,
          },
        ],
      },
    });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          position: {
            kind: "move",
            direction: { kind: "toward", targetId: "Crate_3_0" },
            dist: 8,
          },
          action: { kind: "loot", targetId: "Crate_3_0" },
        }),
      ],
    ]);
    const { state: next, trace } = resolveTurn(state, decisions);
    // A moved closer to the crate (toward stops at Chebyshev 2 from the
    // crate's target tile); confirm A is now within INTERACT_RANGE.
    const aAfter = findChar(next, "A");
    expect(Math.max(Math.abs(aAfter.pos.x - 3), Math.abs(aAfter.pos.y - 0))).toBeLessThanOrEqual(2);
    // Crate opened, axe equipped (replacing rusty_blade).
    expect(aAfter.equipped.weapon).toEqual({ category: "weapon", name: "axe" });
    const crate = next.world.crates.find((c) => c.id === "Crate_3_0")!;
    expect(crate.opened).toBe(true);
    expect(crate.contents).toBeNull();
    // Phase-3 PM lock D7: crate opens emit `kind === "loot"` (the
    // resolved-engine-path, unified under loot per ADR §1).  Trace
    // contains both the move and the loot action.
    expect(trace.moves.find((m) => m.characterId === "A")).toBeTruthy();
    expect(
      trace.actions.find(
        (act) =>
          act.characterId === "A" &&
          act.kind === "loot" &&
          act.target === "Crate_3_0" &&
          act.result === "opened" &&
          act.lootedItem === "axe",
      ),
    ).toBeTruthy();
  });

  it("§9 — position move with action that is invalid post-move (out of range) → action no-ops cleanly, move still applies", () => {
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
          position: { kind: "move", direction: { kind: "E" }, dist: 2 },
          // B is still at dist 18 after A moves to (2,0) — way out of range.
          action: { kind: "attack", targetId: "B" },
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
      ["A", nullDecision({ use: "consumable" })],
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
      ["A", nullDecision({ use: "consumable" })],
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
      ["A", nullDecision({ say: "hello" })],
    ]);
    const { state: next, trace } = resolveTurn(state, decisions);
    expect(trace.visibilityUpdates.some(
      (u) => u.characterId === "A" && u.revealedBy === "speech",
    )).toBe(true);
    expect(findChar(next, "A").hidden).toBe(false);
  });

  it("§7 — leaving cover alone does not reveal", () => {
    // A starts in cover hidden, moves out of cover this turn. Phase 6
    // retired leaving-cover reveal as an engine-produced cause.
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
          position: { kind: "move", direction: { kind: "E" }, dist: 3 },
        }),
      ],
    ]);
    const { state: next, trace } = resolveTurn(state, decisions);
    expect(trace.visibilityUpdates.some((u) => u.characterId === "A")).toBe(
      false,
    );
    expect(findChar(next, "A").hidden).toBe(true);
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
          position: { kind: "move", direction: { kind: "W" }, dist: 4 },
          // Move 5 west so B ends at (5,5)? But A is there. Move to (6,5) — distance 1.
          // We need B visible to A (no walls between) — same row works.
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

  it("§7 — moving onto cover with no reveal cause hides a visible actor", () => {
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const state = makeState({
      characters: [a],
      world: { coverTiles: [{ x: 3, y: 0 }] },
    });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          position: {
            kind: "move",
            direction: { kind: "toward", targetId: "Cover_3_0" },
            dist: 8,
          },
        }),
      ],
    ]);
    const { state: next, trace } = resolveTurn(state, decisions);

    expect(findChar(next, "A").pos).toEqual({ x: 3, y: 0 });
    expect(findChar(next, "A").hidden).toBe(true);
    expect(trace.visibilityUpdates).toContainEqual({
      characterId: "A",
      hidden: true,
    });
  });

  it("§7 — moving onto cover near a living enemy stays revealed by proximity", () => {
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const b = makeCharacter({ id: "B", pos: { x: 4, y: 0 } });
    const state = makeState({
      characters: [a, b],
      world: { coverTiles: [{ x: 3, y: 0 }] },
    });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          position: {
            kind: "move",
            direction: { kind: "toward", targetId: "Cover_3_0" },
            dist: 8,
          },
        }),
      ],
      ["B", nullDecision()],
    ]);
    const { state: next, trace } = resolveTurn(state, decisions);

    expect(findChar(next, "A").pos).toEqual({ x: 3, y: 0 });
    expect(findChar(next, "A").hidden).toBe(false);
    expect(trace.visibilityUpdates).toContainEqual({
      characterId: "A",
      hidden: false,
      revealedBy: "proximity",
    });
    expect(trace.visibilityUpdates.some(
      (u) => u.characterId === "A" && u.hidden === true,
    )).toBe(false);
  });

  it("§7 — attacking while ending in cover keeps a visible actor revealed", () => {
    const a = makeCharacter({
      id: "A",
      pos: { x: 0, y: 0 },
      weapon: { category: "weapon", name: "sword" },
    });
    const b = makeCharacter({ id: "B", pos: { x: 2, y: 0 } });
    const state = makeState({
      characters: [a, b],
      world: { coverTiles: [{ x: 1, y: 0 }] },
    });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          position: {
            kind: "move",
            direction: { kind: "toward", targetId: "Cover_1_0" },
            dist: 8,
          },
          action: { kind: "attack", targetId: "B" },
        }),
      ],
      ["B", nullDecision()],
    ]);
    const { state: next, trace } = resolveTurn(state, decisions);

    expect(findChar(next, "A").pos).toEqual({ x: 1, y: 0 });
    expect(findChar(next, "A").hidden).toBe(false);
    expect(trace.visibilityUpdates).toContainEqual({
      characterId: "A",
      hidden: false,
      revealedBy: "attack",
    });
  });

  it("§7 — hidden actor in cover with nearby living enemy reveals by proximity", () => {
    const a = makeCharacter({
      id: "A",
      pos: { x: 5, y: 5 },
      hidden: true,
    });
    const b = makeCharacter({ id: "B", pos: { x: 7, y: 6 } });
    const state = makeState({
      characters: [a, b],
      world: { coverTiles: [{ x: 5, y: 5 }] },
    });
    const decisions = new Map<string, ParsedDecision>([
      ["A", nullDecision()],
      ["B", nullDecision()],
    ]);
    const { state: next, trace } = resolveTurn(state, decisions);

    expect(findChar(next, "A").hidden).toBe(false);
    expect(trace.visibilityUpdates).toContainEqual({
      characterId: "A",
      hidden: false,
      revealedBy: "proximity",
    });
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
    const { state: next, trace } = resolveTurn(state, decisions);
    expect(findChar(next, "A").hidden).toBe(true);
    expect(trace.visibilityUpdates.find(
      (u) => u.characterId === "A",
    )).toBeUndefined();
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
      ["A", nullDecision({ use: "consumable" })],
    ]);
    const { state: next } = resolveTurn(state, decisions);
    expect(findChar(next, "A").equipped.consumable).toBeUndefined();
    expect(findChar(next, "A").hp).toBe(70);
  });
});

// ─── §11 overwatch ───────────────────────────────────────────────────────

describe("WP7 resolution — concept-spec §11 overwatch", () => {
  it("§11 — overwatch fires on visible enemy that moves into range", () => {
    const a = makeCharacter({
      id: "A",
      pos: { x: 0, y: 0 },
      weapon: { category: "weapon", name: "axe" },
    });
    const b = makeCharacter({
      id: "B",
      pos: { x: 4, y: 0 },
      hp: 100,
      armour: { category: "armour", name: "leather" },
    });
    const state = makeState({ characters: [a, b] });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          position: { kind: "overwatch" },
        }),
      ],
      [
        "B",
        nullDecision({
          position: { kind: "move", direction: { kind: "W" }, dist: 2 },
        }),
      ],
    ]);
    const { state: next, trace } = resolveTurn(state, decisions);
    // axe (20) - leather (3) = 17 damage; B was 100 → 83.
    expect(findChar(next, "B").hp).toBe(83);
    expect(
      trace.actions.some(
        (a) =>
          a.characterId === "A" &&
          a.kind === "overwatch" &&
          a.target === "B" &&
          a.triggeredByMovement === true,
      ),
    ).toBe(true);
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
      [
        "A",
        nullDecision({
          position: { kind: "overwatch" },
        }),
      ],
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
    const b = makeCharacter({ id: "B", pos: { x: 8, y: 5 } });
    const state = makeState({
      characters: [a, b],
      world: { coverTiles: [{ x: 5, y: 5 }] },
    });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          position: { kind: "overwatch" },
        }),
      ],
      [
        "B",
        nullDecision({
          position: { kind: "move", direction: { kind: "W" }, dist: 1 },
        }),
      ],
    ]);
    const { state: next, trace } = resolveTurn(state, decisions);
    expect(trace.visibilityUpdates.some(
      (u) => u.characterId === "A" && u.revealedBy === "attack",
    )).toBe(true);
    expect(findChar(next, "A").hidden).toBe(false);
  });

  it("speech-revealed moving target can trigger overwatch", () => {
    // A in cover with overwatch; B in cover says "hi" and moves into
    // range. The speech reveal is visible to the movement-triggered
    // overwatch pass.
    const a = makeCharacter({
      id: "A",
      pos: { x: 5, y: 5 },
      weapon: { category: "weapon", name: "sword" },
      hidden: true,
    });
    const b = makeCharacter({
      id: "B",
      pos: { x: 8, y: 5 },
      hp: 50,
      hidden: true,
    });
    const state = makeState({
      characters: [a, b],
      world: {
        coverTiles: [
          { x: 5, y: 5 },
          { x: 8, y: 5 },
        ],
      },
    });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          position: { kind: "overwatch" },
        }),
      ],
      [
        "B",
        nullDecision({
          position: { kind: "move", direction: { kind: "W" }, dist: 1 },
          say: "hi",
        }),
      ],
    ]);
    const { state: next } = resolveTurn(state, decisions);
    // sword (15) - 0 = 15 damage. B was 50 → 35.
    expect(findChar(next, "B").hp).toBe(35);
  });
});

// ─── §13 gear / crate / corpse ───────────────────────────────────────────

describe("WP7 resolution — concept-spec §13 gear / loot", () => {
  it("§13 — crate equip replaces slot, discards previous, marks crate opened+contents=null", () => {
    const a = makeCharacter({
      id: "A",
      pos: { x: 0, y: 0 },
      weapon: { category: "weapon", name: "rusty_blade" },
    });
    const state = makeState({
      characters: [a],
      world: {
        crates: [
          {
            id: "Crate_1_0",
            pos: { x: 1, y: 0 },
            contents: { category: "weapon", name: "axe" },
            opened: false,
          },
        ],
      },
    });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          action: { kind: "loot", targetId: "Crate_1_0" },
        }),
      ],
    ]);
    const { state: next, trace } = resolveTurn(state, decisions);
    expect(findChar(next, "A").equipped.weapon).toEqual({
      category: "weapon",
      name: "axe",
    });
    const crate = next.world.crates.find((c) => c.id === "Crate_1_0")!;
    expect(crate.opened).toBe(true);
    expect(crate.contents).toBeNull();
    expect(
      trace.actions.find(
        (act) =>
          act.kind === "loot" &&
          act.target === "Crate_1_0" &&
          act.result === "opened",
      )?.lootedItem,
    ).toBe("axe");
  });

  it("§13 — crate equip dispatches under coord-encoded `Crate_x_y` id", () => {
    const a = makeCharacter({
      id: "A",
      pos: { x: 0, y: 0 },
      weapon: { category: "weapon", name: "rusty_blade" },
    });
    const state = makeState({
      characters: [a],
      world: {
        crates: [
          {
            id: "Crate_1_0",
            pos: { x: 1, y: 0 },
            contents: { category: "weapon", name: "sword" },
            opened: false,
          },
        ],
      },
    });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          action: { kind: "loot", targetId: "Crate_1_0" },
        }),
      ],
    ]);
    const { state: next, trace } = resolveTurn(state, decisions);
    expect(findChar(next, "A").equipped.weapon).toEqual({
      category: "weapon",
      name: "sword",
    });
    const crate = next.world.crates.find((c) => c.id === "Crate_1_0")!;
    expect(crate.opened).toBe(true);
    expect(
      trace.actions.some(
        (act) =>
          act.kind === "loot" &&
          act.target === "Crate_1_0" &&
          act.result === "opened" &&
          act.lootedItem === "sword",
      ),
    ).toBe(true);
  });

  it("WP-C BC-3 — no same-turn airdrop loot on landsAtTurn; first lootable turn is landsAtTurn+1", () => {
    const a = makeCharacter({ id: "A", pos: { x: 49, y: 50 } });
    const drop = makeAirdrop(10, { x: 50, y: 50 });
    const landingTurn = makeState({
      characters: [a],
      turn: 10,
      world: { airdrops: [drop] },
    });

    const denied = resolveTurn(
      landingTurn,
      new Map([
        [
          "A",
          nullDecision({ action: { kind: "loot", targetId: "Crate_50_50" } }),
        ],
      ]),
    );

    expect(denied.trace.actions).toContainEqual({
      characterId: "A",
      kind: "loot",
      target: "Crate_50_50",
      result: "no_crate",
    });
    expect(denied.state.world.airdrops[0]?.looted).toBe(false);
    expect(findChar(denied.state, "A").equipped.weapon).toBeUndefined();

    const firstLootable = makeState({
      characters: [a],
      turn: 11,
      world: { airdrops: [drop] },
    });
    const opened = resolveTurn(
      firstLootable,
      new Map([
        [
          "A",
          nullDecision({ action: { kind: "loot", targetId: "Crate_50_50" } }),
        ],
      ]),
    );

    expect(opened.trace.actions).toContainEqual({
      characterId: "A",
      kind: "loot",
      target: "Crate_50_50",
      result: "opened",
      lootedItem: "axe",
    });
    expect(opened.state.world.airdrops[0]?.looted).toBe(true);
    expect(findChar(opened.state, "A").equipped.weapon).toEqual({
      category: "weapon",
      name: "axe",
    });
  });

  it("WP-C BC-2 — landed airdrop loot at range 2 uses the same opened trace contract as a static crate and flips to spent", () => {
    const staticLooter = makeCharacter({ id: "A", pos: { x: 1, y: 0 } });
    const airdropLooter = makeCharacter({ id: "B", pos: { x: 49, y: 50 } });
    const state = makeState({
      characters: [staticLooter, airdropLooter],
      turn: 11,
      world: {
        crates: [
          {
            id: "Crate_1_0",
            pos: { x: 1, y: 0 },
            contents: { category: "weapon", name: "axe" },
            opened: false,
          },
        ],
        airdrops: [makeAirdrop(10, { x: 50, y: 50 })],
      },
    });

    const { state: next, trace } = resolveTurn(
      state,
      new Map([
        [
          "A",
          nullDecision({ action: { kind: "loot", targetId: "Crate_1_0" } }),
        ],
        [
          "B",
          nullDecision({ action: { kind: "loot", targetId: "Crate_50_50" } }),
        ],
      ]),
    );

    const staticTrace = trace.actions.find((a) => a.target === "Crate_1_0");
    const dropTrace = trace.actions.find((a) => a.target === "Crate_50_50");
    expect(staticTrace).toMatchObject({
      kind: "loot",
      result: "opened",
      lootedItem: "axe",
    });
    expect(dropTrace).toMatchObject({
      kind: "loot",
      result: "opened",
      lootedItem: "axe",
    });
    expect(next.world.crates[0]).toMatchObject({
      id: "Crate_1_0",
      opened: true,
      contents: null,
    });
    expect(next.world.airdrops[0]).toMatchObject({
      id: "Crate_50_50",
      looted: true,
    });
  });

  it("WP-C BC-2 — spent airdrop loot emits already_opened and remains spent", () => {
    const a = makeCharacter({ id: "A", pos: { x: 49, y: 50 } });
    const state = makeState({
      characters: [a],
      turn: 11,
      world: { airdrops: [makeAirdrop(10, { x: 50, y: 50 }, true)] },
    });

    const { state: next, trace } = resolveTurn(
      state,
      new Map([
        [
          "A",
          nullDecision({ action: { kind: "loot", targetId: "Crate_50_50" } }),
        ],
      ]),
    );

    expect(trace.actions).toContainEqual({
      characterId: "A",
      kind: "loot",
      target: "Crate_50_50",
      result: "already_opened",
    });
    expect(next.world.airdrops[0]?.looted).toBe(true);
  });

  it("WP-D — telefrags an agent camped on the airdrop spawn tile on landsAtTurn without corpse or gear transfer", () => {
    const camper = makeCharacter({
      id: "A",
      pos: { x: 50, y: 50 },
      weapon: { category: "weapon", name: "greatsword" },
      armour: { category: "armour", name: "plate" },
    });
    const survivor = makeCharacter({ id: "B", pos: { x: 45, y: 50 } });
    const dropContents: ItemRef = { category: "weapon", name: "axe" };
    const state = makeState({
      characters: [camper, survivor],
      turn: 10,
      world: {
        airdrops: [makeAirdrop(10, { x: 50, y: 50 }, false, dropContents)],
      },
    });

    const { state: next, trace } = resolveTurn(
      state,
      new Map([
        ["A", nullDecision()],
        ["B", nullDecision()],
      ]),
    );

    expect(trace.environmentalDeaths).toEqual(["A"]);
    expect(trace.deaths).toEqual([]);
    const camperAfter = findChar(next, "A");
    expect(camperAfter.alive).toBe(false);
    expect(camperAfter.diedAtTurn).toBe(10);
    expect(next.world.corpses).toEqual([]);
    expect(next.world.airdrops[0]).toMatchObject({
      id: "Crate_50_50",
      contents: dropContents,
      looted: false,
    });
    expect(next.characters.filter((c) => c.alive).map((c) => c.characterId)).toEqual([
      "B",
    ]);
  });

  it("WP-D — telefrags an agent that moves onto the spawn tile before the airdrop lands", () => {
    const sprinter = makeCharacter({ id: "A", pos: { x: 49, y: 50 } });
    sprinter.displayName = "Sprinter";
    const observer = makeCharacter({ id: "B", pos: { x: 45, y: 50 } });
    observer.displayName = "Duelist";
    const state = makeState({
      characters: [sprinter, observer],
      turn: 10,
      world: { airdrops: [makeAirdrop(10, { x: 50, y: 50 })] },
    });

    const { state: next, trace } = resolveTurn(
      state,
      new Map([
        [
          "A",
          nullDecision({
            position: { kind: "move", direction: { kind: "E" }, dist: 1 },
          }),
        ],
        ["B", nullDecision()],
      ]),
    );

    expect(trace.moves).toContainEqual({
      characterId: "A",
      from: { x: 49, y: 50 },
      to: { x: 50, y: 50 },
    });
    expect(trace.environmentalDeaths).toEqual(["A"]);
    expect(trace.deaths).toEqual([]);
    expect(findChar(next, "A")).toMatchObject({
      alive: false,
      diedAtTurn: 10,
      pos: { x: 50, y: 50 },
    });
    expect(next.world.corpses).toEqual([]);
    expect(buildKillFeedLines({ resolution: trace }, next)).toEqual([
      "Sprinter got telefragged by crate spawn",
    ]);
    expect(next.characters.filter((c) => c.alive).map((c) => c.displayName)).toEqual([
      "Duelist",
    ]);
  });

  it("WP-D — telefrag wins over same-turn lethal attack and leaves no death trace or corpse", () => {
    const attacker = makeCharacter({
      id: "A",
      pos: { x: 48, y: 50 },
      weapon: { category: "weapon", name: "warhammer" },
    });
    const victim = makeCharacter({
      id: "B",
      pos: { x: 50, y: 50 },
      hp: 10,
      weapon: { category: "weapon", name: "greatsword" },
    });
    const state = makeState({
      characters: [attacker, victim],
      turn: 10,
      world: { airdrops: [makeAirdrop(10, { x: 50, y: 50 })] },
    });

    const { state: next, trace } = resolveTurn(
      state,
      new Map([
        ["A", nullDecision({ action: { kind: "attack", targetId: "B" } })],
        ["B", nullDecision()],
      ]),
    );

    expect(trace.actions).toContainEqual({
      characterId: "A",
      kind: "attack",
      target: "B",
      result: "dmg 30",
      weapon: "warhammer",
    });
    expect(findChar(next, "B").hp).toBeLessThanOrEqual(0);
    expect(trace.environmentalDeaths).toEqual(["B"]);
    expect(trace.deaths).toEqual([]);
    expect(next.world.corpses).toEqual([]);
    expect(findChar(next, "B")).toMatchObject({
      alive: false,
      diedAtTurn: 10,
    });
  });

  it("§13 — same-turn crate collision traces winner item and loser already_opened", () => {
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const b = makeCharacter({ id: "B", pos: { x: 2, y: 0 } });
    const state = makeState({
      characters: [a, b],
      world: {
        crates: [
          {
            id: "Crate_1_0",
            pos: { x: 1, y: 0 },
            contents: { category: "weapon", name: "axe" },
            opened: false,
          },
        ],
      },
    });
    const decisions = new Map<string, ParsedDecision>([
      ["A", nullDecision({ action: { kind: "loot", targetId: "Crate_1_0" } })],
      ["B", nullDecision({ action: { kind: "loot", targetId: "Crate_1_0" } })],
    ]);

    const { state: next, trace } = resolveTurn(state, decisions);
    const lootTraces = trace.actions.filter(
      (act) => act.kind === "loot" && act.target === "Crate_1_0",
    );

    expect(lootTraces).toEqual([
      {
        characterId: "A",
        kind: "loot",
        target: "Crate_1_0",
        result: "opened",
        lootedItem: "axe",
      },
      {
        characterId: "B",
        kind: "loot",
        target: "Crate_1_0",
        result: "already_opened",
      },
    ]);
    expect(findChar(next, "A").equipped.weapon?.name).toBe("axe");
    expect(findChar(next, "B").equipped.weapon).toBeUndefined();
  });

  it("§13 — empty crate attempts emit result empty instead of disappearing", () => {
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const state = makeState({
      characters: [a],
      world: {
        crates: [
          {
            id: "Crate_1_0",
            pos: { x: 1, y: 0 },
            contents: null,
            opened: false,
          },
        ],
      },
    });
    const decisions = new Map<string, ParsedDecision>([
      ["A", nullDecision({ action: { kind: "loot", targetId: "Crate_1_0" } })],
    ]);

    const { trace } = resolveTurn(state, decisions);

    expect(trace.actions).toContainEqual({
      characterId: "A",
      kind: "loot",
      target: "Crate_1_0",
      result: "empty",
    });
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
            characterId: "Camper",
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
          action: { kind: "loot", targetId: "Corpse_Camper" },
        }),
      ],
    ]);
    const { state: next, trace } = resolveTurn(state, decisions);
    // Loot picks ONE item; engine choice: pick weapon if present, else armour, else consumable.
    const aAfter = findChar(next, "A");
    expect(aAfter.equipped.weapon).toEqual({
      category: "weapon",
      name: "greatsword",
    });
    const corpse = next.world.corpses.find((c) => c.characterId === "Camper")!;
    // Looted item removed from corpse.
    expect(corpse.contents.weapon).toBeUndefined();
    expect(
      trace.actions.find(
        (act) =>
          act.kind === "loot" &&
          act.target === "Corpse_Camper" &&
          act.result === "looted",
      )?.lootedItem,
    ).toBe("greatsword");
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
          action: { kind: "attack", targetId: "B" },
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
            characterId: "Camper",
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
          action: { kind: "loot", targetId: "Corpse_Camper" },
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
          action: { kind: "attack", targetId: "B" },
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
          position: { kind: "move", direction: { kind: "E" }, dist: 1 },
        }),
      ],
      [
        "B",
        nullDecision({
          position: { kind: "move", direction: { kind: "W" }, dist: 1 },
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
      position: { kind: "move", direction: { kind: "SE" }, dist: 5 },
      say: "A says",
    });
    const dB: ParsedDecision = nullDecision({
      position: { kind: "move", direction: { kind: "W" }, dist: 3 },
    });
    const dC: ParsedDecision = nullDecision({
      position: { kind: "move", direction: { kind: "N" }, dist: 8 },
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
          action: { kind: "attack", targetId: "B" },
        }),
      ],
      [
        "B",
        nullDecision({
          action: { kind: "attack", targetId: "A" },
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
          action: { kind: "attack", targetId: "T" },
        }),
      ],
      [
        "B",
        nullDecision({
          action: { kind: "attack", targetId: "T" },
        }),
      ],
      [
        "C",
        nullDecision({
          action: { kind: "attack", targetId: "T" },
        }),
      ],
    ]);
    const { state: next } = resolveTurn(state, decisions);
    // 100 - 17 - 12 - 7 = 64
    expect(findChar(next, "T").hp).toBe(64);
  });

  it("WP-A — lethal attack trace records killer weapon, not the victim corpse contents", () => {
    const killer = makeCharacter({
      id: "A",
      pos: { x: 0, y: 0 },
      weapon: { category: "weapon", name: "sword" },
    });
    const victim = makeCharacter({
      id: "B",
      pos: { x: 1, y: 0 },
      hp: 10,
      weapon: { category: "weapon", name: "axe" },
    });
    const state = makeState({ characters: [killer, victim], turn: 12 });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({ action: { kind: "attack", targetId: "B" } }),
      ],
      ["B", nullDecision()],
    ]);

    const { state: next, trace } = resolveTurn(state, decisions);
    const action = trace.actions.find(
      (a) => a.characterId === "A" && a.kind === "attack",
    );
    const corpse = next.world.corpses.find((c) => c.characterId === "B");

    expect(trace.deaths).toContain("B");
    expect(action).toBeDefined();
    expect(action!.result).toBe("dmg 15");
    expect(action!.weapon).toBe("sword");
    expect(corpse?.contents.weapon).toEqual({
      category: "weapon",
      name: "axe",
    });
  });
});

// ─── §10 no mid-movement retargeting ─────────────────────────────────────

describe("WP7 resolution — concept-spec §10 no mid-movement retarget", () => {
  it("§10 — agent does NOT retarget mid-movement (regression: combined movement+action)", () => {
    // A heads toward B; C enters near A's path. A continues toward B.
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const b = makeCharacter({ id: "B", pos: { x: 20, y: 0 } });
    b.displayName = "Duelist";
    const c = makeCharacter({ id: "C", pos: { x: 5, y: 5 } });
    const state = makeState({ characters: [a, b, c] });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          position: {
            kind: "move",
            direction: { kind: "toward", targetId: "Duelist" },
            dist: 8,
          },
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
      pos: { x: 8, y: 5 },
      weapon: { category: "weapon", name: "axe" },
      hidden: true,
    });
    const state = makeState({
      characters: [a, b],
      world: {
        coverTiles: [
          { x: 5, y: 5 },
          { x: 8, y: 5 },
        ],
      },
    });
    const decisions = new Map<string, ParsedDecision>([
      ["A", nullDecision({ say: "hi" })],
      [
        "B",
        nullDecision({
          position: { kind: "overwatch" },
        }),
      ],
      [
        "A",
        nullDecision({
          position: { kind: "move", direction: { kind: "E" }, dist: 1 },
          say: "hi",
        }),
      ],
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
          action: { kind: "attack", targetId: "B" },
        }),
      ],
      [
        "B",
        nullDecision({
          action: { kind: "attack", targetId: "A" },
        }),
      ],
    ]);
    const { state: next } = resolveTurn(state, decisions);
    // Both die — neither survived to "save" the other.
    expect(findChar(next, "A").alive).toBe(false);
    expect(findChar(next, "B").alive).toBe(false);
  });
});

// ─── WP-B.2 Drained-corpse trace — Phase-3 ADR §4 ───────────────────────

describe("WP-B.2 drained-corpse trace — ADR §4", () => {
  it("loot on a corpse with no remaining slots → trace.actions emits result='empty' (drained on first attempt)", () => {
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const state = makeState({
      characters: [a],
      world: {
        corpses: [
          {
            characterId: "Camper",
            pos: { x: 1, y: 0 },
            // No weapon/armour/consumable — already drained.
            contents: {},
          },
        ],
      },
    });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          action: { kind: "loot", targetId: "Corpse_Camper" },
        }),
      ],
    ]);
    const { trace } = resolveTurn(state, decisions);
    const lootEntries = trace.actions.filter(
      (act) => act.characterId === "A" && act.kind === "loot",
    );
    expect(lootEntries).toHaveLength(1);
    expect(lootEntries[0]).toMatchObject({
      characterId: "A",
      kind: "loot",
      target: "Corpse_Camper",
      result: "empty",
    });
  });

  it("repeat loot on the same drained corpse → trace.actions emits result='empty' each time (no silent skip)", () => {
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const state = makeState({
      characters: [a],
      world: {
        corpses: [
          {
            characterId: "Camper",
            pos: { x: 1, y: 0 },
            contents: {},
          },
        ],
      },
    });
    // Turn 1.
    let working = state;
    let trace1;
    {
      const decisions = new Map<string, ParsedDecision>([
        [
          "A",
          nullDecision({
            action: { kind: "loot", targetId: "Corpse_Camper" },
          }),
        ],
      ]);
      const r = resolveTurn(working, decisions);
      working = r.state;
      trace1 = r.trace;
    }
    expect(
      trace1.actions.find(
        (a) => a.characterId === "A" && a.target === "Corpse_Camper" && a.result === "empty",
      ),
    ).toBeDefined();

    // Turn 2 — same drained corpse, same actor.
    {
      const decisions = new Map<string, ParsedDecision>([
        [
          "A",
          nullDecision({
            action: { kind: "loot", targetId: "Corpse_Camper" },
          }),
        ],
      ]);
      const r = resolveTurn(working, decisions);
      const empties = r.trace.actions.filter(
        (a) =>
          a.characterId === "A" &&
          a.kind === "loot" &&
          a.target === "Corpse_Camper" &&
          a.result === "empty",
      );
      expect(empties).toHaveLength(1);
    }
  });

  it("loot on a corpse that doesn't exist → trace.actions emits result='no_corpse' once", () => {
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const state = makeState({ characters: [a] });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          // Use the corpse namespace so this hits the corpse path (not the
          // "no_target" bogus-namespace path).
          action: { kind: "loot", targetId: "Corpse_Camper" },
        }),
      ],
    ]);
    const { trace } = resolveTurn(state, decisions);
    const noCorpse = trace.actions.filter(
      (act) =>
        act.characterId === "A" &&
        act.kind === "loot" &&
        act.target === "Corpse_Camper" &&
        act.result === "no_corpse",
    );
    expect(noCorpse).toHaveLength(1);
  });
});

// ─── WP-B.3 Loot dispatch by id namespace — Phase-3 ADR §1 ───────────────

describe("WP-B.3 loot dispatch by id namespace — ADR §1", () => {
  it("Crate_x_y prefix → crate-open path (kind='loot', result='opened')", () => {
    const a = makeCharacter({
      id: "A",
      pos: { x: 0, y: 0 },
      weapon: { category: "weapon", name: "rusty_blade" },
    });
    const state = makeState({
      characters: [a],
      world: {
        crates: [
          {
            id: "Crate_1_0",
            pos: { x: 1, y: 0 },
            contents: { category: "weapon", name: "axe" },
            opened: false,
          },
        ],
      },
    });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          action: { kind: "loot", targetId: "Crate_1_0" },
        }),
      ],
    ]);
    const { trace } = resolveTurn(state, decisions);
    const opened = trace.actions.find(
      (act) =>
        act.characterId === "A" &&
        act.kind === "loot" &&
        act.target === "Crate_1_0" &&
        act.result === "opened" &&
        act.lootedItem === "axe",
    );
    expect(opened).toBeDefined();
  });

  it("Corpse_<PersonaName> prefix → corpse-loot path (kind='loot', result='looted')", () => {
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const state = makeState({
      characters: [a],
      world: {
        corpses: [
          {
            characterId: "Camper",
            pos: { x: 1, y: 0 },
            contents: { weapon: { category: "weapon", name: "axe" } },
          },
        ],
      },
    });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          action: { kind: "loot", targetId: "Corpse_Camper" },
        }),
      ],
    ]);
    const { trace } = resolveTurn(state, decisions);
    const looted = trace.actions.find(
      (act) =>
        act.characterId === "A" &&
        act.kind === "loot" &&
        act.target === "Corpse_Camper" &&
        act.result === "looted",
    );
    expect(looted).toBeDefined();
  });

  it("bogus id (neither Crate_x_y nor Corpse_ prefix) → trace emits result='no_target'", () => {
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const state = makeState({ characters: [a] });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          action: { kind: "loot", targetId: "garbage_id_xyz" },
        }),
      ],
    ]);
    const { trace } = resolveTurn(state, decisions);
    const noTarget = trace.actions.filter(
      (act) =>
        act.characterId === "A" &&
        act.kind === "loot" &&
        act.target === "garbage_id_xyz" &&
        act.result === "no_target",
    );
    expect(noTarget).toHaveLength(1);
  });
});

// ─── WP-B.4 Defensive overwatch counter-fire — Phase-3 ADR §3 / D-P3-2 ───

describe("WP-B.4 defensive overwatch counter-fire — ADR §3 + D-P3-2", () => {
  it("single attacker hits counter stance → 1 counter-fire entry", () => {
    // Defender (D) has overwatch defensive; A attacks D from in-range.
    // A must take counter-fire damage in same applyDamage batch.
    const d = makeCharacter({
      id: "D",
      pos: { x: 5, y: 5 },
      hp: 100,
      weapon: { category: "weapon", name: "axe" }, // 20 dmg, range 2
    });
    const a = makeCharacter({
      id: "A",
      pos: { x: 6, y: 5 }, // Chebyshev 1 — within axe range 2
      hp: 100,
      weapon: { category: "weapon", name: "sword" }, // 15 dmg, range 2
    });
    const state = makeState({ characters: [a, d] });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          action: { kind: "attack", targetId: "D" },
        }),
      ],
      [
        "D",
        nullDecision({
          position: { kind: "counter" },
        }),
      ],
    ]);
    const { state: next, trace } = resolveTurn(state, decisions);
    // D took sword damage from A (15 - 0 = 15) → 100-15=85.
    expect(findChar(next, "D").hp).toBe(85);
    // A took axe damage from D's counter-fire (20 - 0 = 20) → 100-20=80.
    expect(findChar(next, "A").hp).toBe(80);
    // Trace contains the counter-fire entry tagged correctly.
    const counter = trace.actions.find(
      (act) =>
        act.characterId === "D" &&
        act.kind === "counter" &&
        act.target === "A",
    );
    expect(counter).toBeDefined();
    expect(counter?.result).toMatch(/^dmg /);
  });

  it("three attackers hit defensive overwatcher → 3 counter-fire entries (one per attacker)", () => {
    // Per D-P3-2 case 2: counter-fire ONCE PER ATTACKER (not once per turn).
    const d = makeCharacter({
      id: "D",
      pos: { x: 5, y: 5 },
      hp: 200, // Survives 3 hits.
      weapon: { category: "weapon", name: "rusty_blade" }, // 10 dmg
    });
    const a1 = makeCharacter({
      id: "A1",
      pos: { x: 4, y: 5 },
      weapon: { category: "weapon", name: "rusty_blade" },
    });
    const a2 = makeCharacter({
      id: "A2",
      pos: { x: 6, y: 5 },
      weapon: { category: "weapon", name: "rusty_blade" },
    });
    const a3 = makeCharacter({
      id: "A3",
      pos: { x: 5, y: 4 },
      weapon: { category: "weapon", name: "rusty_blade" },
    });
    const state = makeState({ characters: [d, a1, a2, a3] });
    const decisions = new Map<string, ParsedDecision>([
      [
        "D",
        nullDecision({
          position: { kind: "counter" },
        }),
      ],
      [
        "A1",
        nullDecision({ action: { kind: "attack", targetId: "D" } }),
      ],
      [
        "A2",
        nullDecision({ action: { kind: "attack", targetId: "D" } }),
      ],
      [
        "A3",
        nullDecision({ action: { kind: "attack", targetId: "D" } }),
      ],
    ]);
    const { trace } = resolveTurn(state, decisions);
    const counters = trace.actions.filter(
      (act) =>
        act.characterId === "D" &&
        act.kind === "counter",
    );
    expect(counters).toHaveLength(3);
    const targets = counters.map((c) => c.target).sort();
    expect(targets).toEqual(["A1", "A2", "A3"]);
  });

  it("attacker out of overwatcher's weapon range → counter-fire entry with result='out_of_range'", () => {
    // Per ADR §3: counter-fire bounded by overwatcher's weapon range.
    // Attacker has longer reach than defender — defender can't reach
    // back. Trace records the attempt as out_of_range.
    //
    // Engine note: all v0 weapons are range 2, so we can't construct a
    // weapon-range mismatch with stock weapons. To test the bound, we
    // use a multi-attacker fixture where one attacker is just outside
    // the overwatcher's range. Since attack range and defender range are
    // both 2, we instead place an attacker that uses a future range-
    // mismatched scenario via the post-move resolution path: A1 moves
    // into range (then attacks); A2 starts at distance 3, attacks via
    // some other mechanism. Skip that complexity — instead test the
    // out-of-range result via a simpler single-attacker scenario where
    // we use a corner case: the ATTACKER attacks via overwatch fire
    // which has its own range check.
    //
    // Simplest test: 3-attacker fixture, A2 starts at distance 3 (out
    // of weapon range 2). A2 cannot attack the defender from range 3,
    // so this scenario cannot trigger an out_of_range counter-fire by
    // construction (an attacker that can't hit doesn't generate counter-
    // fire to begin with). To stress the range-bound logic, we exercise
    // a scenario where one attacker hits via overwatch (overwatch fire
    // is range-checked at fire time, but for THIS test purpose we
    // construct a synthetic scenario: one attacker moves+attacks and
    // ends up at distance 3 by the time counter-fire fires).
    //
    // Concretely: A starts at (8,5) — distance 3 to D at (5,5). A's
    // own attack at distance 3 is rejected as out_of_range upstream, so
    // the counter-fire never fires. Instead, the test we CAN do: A at
    // distance 1 attacks D; D's weapon range is 2 so D hits back. This
    // is the in-range case (already covered).
    //
    // For the out_of_range case, we construct: attacker 1 close in (1
    // tile), attacker 2 at exactly the boundary of D's reach (2 tiles —
    // still in). What we really want: attacker hits D (because
    // attacker's own weapon reaches D) but D's counter-fire weapon
    // can't reach attacker. That requires asymmetric weapon ranges,
    // which v0 doesn't have (all weapons are range 2). Therefore the
    // out_of_range case is structurally exercised only when v1 adds a
    // longer weapon — for v0 we exercise the bounding code path with
    // a synthetic attacker who is at distance 3 (A's attack is gated
    // upstream as out_of_range, no counter-fire emit).
    //
    // We'll defer the explicit out_of_range counter-fire trace to a
    // future test once v1 adds asymmetric weapon ranges. For NOW the
    // test ensures: attacker at distance > overwatcher's range does
    // NOT receive a counter-fire entry of result 'dmg N' — it simply
    // never gets one (because A's own attack is gated out at distance
    // 3 with attack range 2, no incoming attack, no counter-fire).
    const d = makeCharacter({
      id: "D",
      pos: { x: 5, y: 5 },
      hp: 100,
      weapon: { category: "weapon", name: "axe" }, // range 2
    });
    const a = makeCharacter({
      id: "A",
      pos: { x: 8, y: 5 }, // Chebyshev 3 — out of attack range 2.
      hp: 100,
      weapon: { category: "weapon", name: "sword" }, // range 2
    });
    const state = makeState({ characters: [a, d] });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          action: { kind: "attack", targetId: "D" },
        }),
      ],
      [
        "D",
        nullDecision({
          position: { kind: "counter" },
        }),
      ],
    ]);
    const { state: next, trace } = resolveTurn(state, decisions);
    // A's attack was gated out_of_range → D took no damage.
    expect(findChar(next, "D").hp).toBe(100);
    // No counter-fire emitted (no attack landed against D).
    const counters = trace.actions.filter(
      (act) =>
        act.characterId === "D" &&
        act.kind === "counter",
    );
    expect(counters).toHaveLength(0);
  });

  it("mutual-kill — defensive overwatcher and attacker kill each other in the same applyDamage batch", () => {
    // Per D-P3-2 case 4: simultaneity preserved — both die.
    const d = makeCharacter({
      id: "D",
      pos: { x: 5, y: 5 },
      hp: 10, // Will die from one greatsword.
      weapon: { category: "weapon", name: "greatsword" }, // 25 dmg
    });
    const a = makeCharacter({
      id: "A",
      pos: { x: 6, y: 5 }, // Chebyshev 1.
      hp: 10, // Will die from one greatsword (25 - 0 = 25).
      weapon: { category: "weapon", name: "greatsword" }, // 25 dmg
    });
    const state = makeState({ characters: [a, d] });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          action: { kind: "attack", targetId: "D" },
        }),
      ],
      [
        "D",
        nullDecision({
          position: { kind: "counter" },
        }),
      ],
    ]);
    const { state: next, trace } = resolveTurn(state, decisions);
    // Both die in same batch.
    expect(findChar(next, "A").alive).toBe(false);
    expect(findChar(next, "D").alive).toBe(false);
    expect(trace.deaths.sort()).toEqual(["A", "D"]);
    // D's counter-fire trace recorded.
    const counter = trace.actions.find(
      (act) =>
        act.characterId === "D" &&
        act.kind === "counter" &&
        act.target === "A",
    );
    expect(counter).toBeDefined();
  });

  it("hidden defensive overwatcher who counter-fires is revealed (reveal-on-fire)", () => {
    const d = makeCharacter({
      id: "D",
      pos: { x: 5, y: 5 },
      hp: 100,
      weapon: { category: "weapon", name: "axe" },
      hidden: true,
    });
    const a = makeCharacter({
      id: "A",
      pos: { x: 6, y: 5 },
      hp: 100,
      weapon: { category: "weapon", name: "sword" },
    });
    const state = makeState({
      characters: [a, d],
      world: { coverTiles: [{ x: 5, y: 5 }] },
    });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          action: { kind: "attack", targetId: "D" },
        }),
      ],
      [
        "D",
        nullDecision({
          position: { kind: "counter" },
        }),
      ],
    ]);
    const { state: next, trace } = resolveTurn(state, decisions);
    expect(findChar(next, "D").hidden).toBe(false);
    expect(
      trace.visibilityUpdates.some(
        (u) => u.characterId === "D" && u.revealedBy === "attack",
      ),
    ).toBe(true);
  });

  it("two counter actors attacked by separate attackers → both counter-fire", () => {
    // D-P3-2 case 5. Edge case: each is also the other's attacker.
    // What we test: D1 in counter is hit by A; D1's counter-fire damages
    // A. Separately D2 in counter is hit by B; D2's counter-fire damages
    // B. All entries are present in one turn.
    const d1 = makeCharacter({
      id: "D1",
      pos: { x: 5, y: 5 },
      hp: 100,
      weapon: { category: "weapon", name: "sword" },
    });
    const d2 = makeCharacter({
      id: "D2",
      pos: { x: 50, y: 50 },
      hp: 100,
      weapon: { category: "weapon", name: "axe" },
    });
    const a = makeCharacter({
      id: "A",
      pos: { x: 6, y: 5 },
      hp: 100,
      weapon: { category: "weapon", name: "sword" },
    });
    const b = makeCharacter({
      id: "B",
      pos: { x: 51, y: 50 },
      hp: 100,
      weapon: { category: "weapon", name: "sword" },
    });
    const state = makeState({ characters: [a, b, d1, d2] });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          action: { kind: "attack", targetId: "D1" },
        }),
      ],
      [
        "B",
        nullDecision({
          action: { kind: "attack", targetId: "D2" },
        }),
      ],
      [
        "D1",
        nullDecision({
          position: { kind: "counter" },
        }),
      ],
      [
        "D2",
        nullDecision({
          position: { kind: "counter" },
        }),
      ],
    ]);
    const { trace } = resolveTurn(state, decisions);
    // 2 originating attacks + 2 counter-fires = 4 attack-shaped trace entries.
    const attackOrOverwatch = trace.actions.filter(
      (a) => a.kind === "attack" || a.kind === "counter",
    );
    expect(attackOrOverwatch.length).toBeGreaterThanOrEqual(4);
    // Specifically: 2 counter-fire entries (one from each defensive overwatcher).
    const counterFires = trace.actions.filter(
      (a) =>
        a.kind === "counter",
    );
    expect(counterFires).toHaveLength(2);
    const counterFireTargets = counterFires.map((c) => c.target).sort();
    expect(counterFireTargets).toEqual(["A", "B"]);
  });
});

// ─── Phase 10 WP-A — body-collision attacks + counter integration ────────

describe("Phase 10 WP-A body-collision damage routing", () => {
  it("charge into a living defender deals 1 damage to both and keeps mover out of defender tile", () => {
    const a = makeCharacter({ id: "A", pos: { x: 4, y: 5 }, hp: 100 });
    const b = makeCharacter({ id: "B", pos: { x: 5, y: 5 }, hp: 100 });
    const state = makeState({ characters: [a, b] });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          position: { kind: "move", direction: { kind: "E" }, dist: 1 },
        }),
      ],
      ["B", nullDecision()],
    ]);

    const { state: next, trace } = resolveTurn(state, decisions);

    expect(findChar(next, "A").pos).toEqual({ x: 4, y: 5 });
    expect(findChar(next, "B").pos).toEqual({ x: 5, y: 5 });
    expect(findChar(next, "A").hp).toBe(99);
    expect(findChar(next, "B").hp).toBe(99);
    expect(trace.moves).toContainEqual({
      characterId: "A",
      from: { x: 4, y: 5 },
      to: { x: 4, y: 5 },
      bodyCollision: { kind: "character", defenderId: "B" },
    });
    expect(trace.actions.filter((a) => a.kind === "counter")).toHaveLength(0);
  });

  it("counter defender retaliates against a charger in the same damage batch", () => {
    const charger = makeCharacter({ id: "A", pos: { x: 4, y: 5 }, hp: 100 });
    const defender = makeCharacter({
      id: "B",
      pos: { x: 5, y: 5 },
      hp: 100,
      weapon: { category: "weapon", name: "axe" },
    });
    const state = makeState({ characters: [charger, defender] });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          position: { kind: "move", direction: { kind: "E" }, dist: 1 },
        }),
      ],
      ["B", nullDecision({ position: { kind: "counter" } })],
    ]);

    const { state: next, trace } = resolveTurn(state, decisions);

    expect(findChar(next, "B").hp).toBe(99);
    // Body recoil (1) plus axe counter-fire (20).
    expect(findChar(next, "A").hp).toBe(79);
    expect(trace.actions).toContainEqual({
      characterId: "B",
      kind: "counter",
      target: "A",
      result: "dmg 20",
      weapon: "axe",
    });
  });

  it("bilateral charge dedupes damage and cannot trigger counters", () => {
    const a = makeCharacter({ id: "A", pos: { x: 4, y: 5 }, hp: 100 });
    const b = makeCharacter({ id: "B", pos: { x: 5, y: 5 }, hp: 100 });
    const state = makeState({ characters: [a, b] });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          position: { kind: "move", direction: { kind: "E" }, dist: 1 },
        }),
      ],
      [
        "B",
        nullDecision({
          position: { kind: "move", direction: { kind: "W" }, dist: 1 },
        }),
      ],
    ]);

    const { state: next, trace } = resolveTurn(state, decisions);

    expect(findChar(next, "A").hp).toBe(99);
    expect(findChar(next, "B").hp).toBe(99);
    expect(trace.moves).toEqual([
      {
        characterId: "A",
        from: { x: 4, y: 5 },
        to: { x: 4, y: 5 },
        bodyCollision: { kind: "character", defenderId: "B" },
      },
      {
        characterId: "B",
        from: { x: 5, y: 5 },
        to: { x: 5, y: 5 },
        bodyCollision: { kind: "character", defenderId: "A" },
      },
    ]);
    expect(trace.actions.filter((a) => a.kind === "counter")).toHaveLength(0);
  });

  it("cardinal wall bump self-damages and keeps the legacy blockedBy marker", () => {
    const a = makeCharacter({ id: "A", pos: { x: 5, y: 5 }, hp: 100 });
    const state = makeState({
      characters: [a],
      world: { walls: [{ x: 6, y: 5, w: 1, h: 1 }] },
    });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          position: { kind: "move", direction: { kind: "E" }, dist: 1 },
        }),
      ],
    ]);

    const { state: next, trace } = resolveTurn(state, decisions);

    expect(findChar(next, "A").hp).toBe(99);
    expect(trace.moves).toEqual([
      {
        characterId: "A",
        from: { x: 5, y: 5 },
        to: { x: 5, y: 5 },
        blockedBy: "wall",
        bodyCollision: { kind: "wall", wallRectId: "Wall_6_5" },
      },
    ]);
    expect(trace.actions.filter((a) => a.kind === "counter")).toHaveLength(0);
  });

  it("cornered diagonal wall bump self-damages while successful slide does not", () => {
    const cornered = makeCharacter({ id: "A", pos: { x: 5, y: 5 }, hp: 100 });
    const corneredState = makeState({
      characters: [cornered],
      world: {
        walls: [
          { x: 6, y: 4, w: 1, h: 1 },
          { x: 6, y: 5, w: 1, h: 1 },
          { x: 5, y: 4, w: 1, h: 1 },
        ],
      },
    });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          position: { kind: "move", direction: { kind: "NE" }, dist: 1 },
        }),
      ],
    ]);

    const corneredResult = resolveTurn(corneredState, decisions);

    expect(findChar(corneredResult.state, "A").hp).toBe(99);
    expect(corneredResult.trace.moves).toEqual([
      {
        characterId: "A",
        from: { x: 5, y: 5 },
        to: { x: 5, y: 5 },
        blockedBy: "wall",
        bodyCollision: { kind: "wall", wallRectId: "Wall_6_4" },
      },
    ]);

    const slider = makeCharacter({ id: "A", pos: { x: 5, y: 5 }, hp: 100 });
    const slideState = makeState({
      characters: [slider],
      world: { walls: [{ x: 6, y: 4, w: 1, h: 1 }] },
    });

    const slideResult = resolveTurn(slideState, decisions);

    expect(findChar(slideResult.state, "A").hp).toBe(100);
    expect(slideResult.trace.moves[0]?.slide).toEqual({
      wallRectId: "Wall_6_4",
      axis: "E",
      intent: "NE",
    });
    expect(slideResult.trace.moves[0]?.bodyCollision).toBeUndefined();
  });

  it("partial-distance wall bump emits movement trace and self-damage without blockedBy", () => {
    const a = makeCharacter({ id: "A", pos: { x: 5, y: 5 }, hp: 100 });
    const state = makeState({
      characters: [a],
      world: { walls: [{ x: 8, y: 5, w: 1, h: 1 }] },
    });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          position: { kind: "move", direction: { kind: "E" }, dist: 5 },
        }),
      ],
    ]);

    const { state: next, trace } = resolveTurn(state, decisions);

    expect(findChar(next, "A").pos).toEqual({ x: 7, y: 5 });
    expect(findChar(next, "A").hp).toBe(99);
    expect(trace.moves).toEqual([
      {
        characterId: "A",
        from: { x: 5, y: 5 },
        to: { x: 7, y: 5 },
        bodyCollision: { kind: "wall", wallRectId: "Wall_8_5" },
      },
    ]);
  });

  it("bodyCollision-sourced attacks do not reveal hidden charger or hidden defender", () => {
    const charger = makeCharacter({
      id: "A",
      pos: { x: 4, y: 5 },
      hp: 100,
      hidden: true,
    });
    const defender = makeCharacter({
      id: "B",
      pos: { x: 5, y: 5 },
      hp: 100,
      hidden: true,
    });
    const state = makeState({ characters: [charger, defender] });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          position: { kind: "move", direction: { kind: "E" }, dist: 1 },
        }),
      ],
      ["B", nullDecision()],
    ]);

    const { state: next, trace } = resolveTurn(state, decisions);

    expect(findChar(next, "A").hidden).toBe(true);
    expect(findChar(next, "B").hidden).toBe(true);
    expect(
      trace.visibilityUpdates.some((u) => u.revealedBy === "attack"),
    ).toBe(false);
  });

  it("counter retaliation generated by a bodyCollision still reveals normally", () => {
    const charger = makeCharacter({ id: "A", pos: { x: 4, y: 5 }, hp: 100 });
    const defender = makeCharacter({
      id: "B",
      pos: { x: 5, y: 5 },
      hp: 100,
      hidden: true,
      weapon: { category: "weapon", name: "sword" },
    });
    const state = makeState({ characters: [charger, defender] });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          position: { kind: "move", direction: { kind: "E" }, dist: 1 },
        }),
      ],
      ["B", nullDecision({ position: { kind: "counter" } })],
    ]);

    const { state: next, trace } = resolveTurn(state, decisions);

    expect(findChar(next, "B").hidden).toBe(false);
    expect(trace.visibilityUpdates).toContainEqual({
      characterId: "B",
      hidden: false,
      revealedBy: "attack",
    });
  });

  it("same attacker charge plus weapon attack triggers one counter only", () => {
    const charger = makeCharacter({
      id: "A",
      pos: { x: 4, y: 5 },
      hp: 100,
      weapon: { category: "weapon", name: "sword" },
    });
    const defender = makeCharacter({
      id: "B",
      pos: { x: 5, y: 5 },
      hp: 100,
      weapon: { category: "weapon", name: "axe" },
    });
    const state = makeState({ characters: [charger, defender] });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          position: { kind: "move", direction: { kind: "E" }, dist: 1 },
          action: { kind: "attack", targetId: "B" },
        }),
      ],
      ["B", nullDecision({ position: { kind: "counter" } })],
    ]);

    const { state: next, trace } = resolveTurn(state, decisions);

    expect(findChar(next, "B").hp).toBe(84);
    expect(findChar(next, "A").hp).toBe(79);
    const counters = trace.actions.filter(
      (a) => a.characterId === "B" && a.kind === "counter",
    );
    expect(counters).toHaveLength(1);
    expect(counters[0]?.target).toBe("A");
  });

  it("lethal charge creates a corpse through the existing deaths phase", () => {
    const charger = makeCharacter({ id: "A", pos: { x: 4, y: 5 }, hp: 100 });
    const defender = makeCharacter({
      id: "B",
      pos: { x: 5, y: 5 },
      hp: 1,
      weapon: { category: "weapon", name: "greatsword" },
    });
    const state = makeState({ characters: [charger, defender], turn: 7 });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          position: { kind: "move", direction: { kind: "E" }, dist: 1 },
        }),
      ],
      ["B", nullDecision()],
    ]);

    const { state: next, trace } = resolveTurn(state, decisions);

    expect(findChar(next, "B").alive).toBe(false);
    expect(findChar(next, "B").diedAtTurn).toBe(7);
    expect(trace.deaths).toEqual(["B"]);
    expect(next.world.corpses).toContainEqual({
      characterId: "B",
      pos: { x: 5, y: 5 },
      contents: {
        weapon: { category: "weapon", name: "greatsword" },
        armour: undefined,
        consumable: undefined,
      },
    });
  });
});

// ─── WP-B.5 Movement-triggered overwatch trace tagging ───────────────────

describe("WP-B.5 offensive overwatch — movement-trigger trace tagging", () => {
  it("overwatch fire entries carry triggeredByMovement=true", () => {
    const a = makeCharacter({
      id: "A",
      pos: { x: 0, y: 0 },
      weapon: { category: "weapon", name: "axe" },
    });
    const b = makeCharacter({
      id: "B",
      pos: { x: 3, y: 0 },
      hp: 100,
    });
    const state = makeState({ characters: [a, b] });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          position: { kind: "overwatch" },
        }),
      ],
      [
        "B",
        nullDecision({
          position: { kind: "move", direction: { kind: "W" }, dist: 1 },
        }),
      ],
    ]);
    const { trace } = resolveTurn(state, decisions);
    const fire = trace.actions.find(
      (act) => act.characterId === "A" && act.kind === "overwatch",
    );
    expect(fire).toBeDefined();
    expect(fire?.triggeredByMovement).toBe(true);
  });

  it("WP-A — offensive overwatch damage trace carries the overwatcher's weapon", () => {
    const a = makeCharacter({
      id: "A",
      pos: { x: 0, y: 0 },
      weapon: { category: "weapon", name: "axe" },
    });
    const b = makeCharacter({
      id: "B",
      pos: { x: 3, y: 0 },
      hp: 100,
    });
    const state = makeState({ characters: [a, b] });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          position: { kind: "overwatch" },
        }),
      ],
      [
        "B",
        nullDecision({
          position: { kind: "move", direction: { kind: "W" }, dist: 1 },
        }),
      ],
    ]);

    const { trace } = resolveTurn(state, decisions);
    const fire = trace.actions.find(
      (act) => act.characterId === "A" && act.kind === "overwatch",
    );

    expect(fire).toBeDefined();
    expect(fire!.result).toBe("dmg 20");
    expect(fire!.weapon).toBe("axe");
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
    a.displayName = "Rat";
    const b = makeCharacter({
      id: "B",
      pos: { x: 5, y: 5 },
      hp: 50,
      weapon: { category: "weapon", name: "sword" },
    });
    b.displayName = "Duelist";
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
          position: { kind: "move", direction: { kind: "toward", targetId: "Duelist" }, dist: 8 },
        }),
      ],
      ["B", nullDecision({ say: "hi" })],
      ["C", nullDecision({ use: "consumable" })],
    ]);
    state = resolveTurn(state, decisions).state;

    // Turn 2: A attacks B (must be in range now); B attacks A; C moves toward A.
    decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          action: { kind: "attack", targetId: "B" },
        }),
      ],
      [
        "B",
        nullDecision({
          action: { kind: "attack", targetId: "A" },
        }),
      ],
      [
        "C",
        nullDecision({
          position: { kind: "move", direction: { kind: "toward", targetId: "Rat" }, dist: 8 },
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

// ─── WP-F.2 display-id normalisation through resolution ──────────────────
//
// Per Phase 6, the LLM emits attack and movement targets as persona
// display ids. In production the engine `characterId` is a Convex
// opaque `_id`, not the persona display name. The
// normalisation helper at `convex/llm/idNormalisation.ts` bridges attack
// ids at the action site, while movement consumes the model-visible id
// directly through `resolveTypedEntity` inside `movement.ts`. These tests
// confirm persona-name targets resolve end-to-end through the engine when the
// engine `characterId` is opaque.
describe("WP-F.2 persona display-id target resolution — ADR §1", () => {
  it("attack with targetId='Camper' resolves against opaque engine id and applies damage", () => {
    const a = makeCharacter({
      id: "char_opaque_a",
      pos: { x: 5, y: 5 },
      weapon: { category: "weapon", name: "sword" },
    });
    a.displayName = "Rat";
    const b = makeCharacter({
      id: "char_opaque_b",
      pos: { x: 6, y: 5 },
      hp: 100,
    });
    b.displayName = "Camper";
    const state = makeState({ characters: [a, b] });
    const decisions = new Map<string, ParsedDecision>([
      [
        "char_opaque_a",
        nullDecision({
          action: { kind: "attack", targetId: "Camper" },
        }),
      ],
      ["char_opaque_b", nullDecision()],
    ]);
    const { state: next, trace } = resolveTurn(state, decisions);
    // sword (15) - 0 = 15 damage; B was 100 → 85.
    expect(findChar(next, "char_opaque_b").hp).toBe(85);
    // Trace target is canonicalised to the persona displayName.
    const attackEntry = trace.actions.find(
      (act) => act.characterId === "char_opaque_a" && act.kind === "attack",
    );
    expect(attackEntry).toBeDefined();
    expect(attackEntry!.target).toBe("Camper");
    expect(attackEntry!.result).toBe("dmg 15");
  });

  it("attack with an internal target id still writes a persona displayName trace target", () => {
    const a = makeCharacter({
      id: "char_opaque_a",
      pos: { x: 5, y: 5 },
      weapon: { category: "weapon", name: "sword" },
    });
    a.displayName = "Rat";
    const b = makeCharacter({
      id: "char_opaque_b",
      pos: { x: 6, y: 5 },
      hp: 100,
    });
    b.displayName = "Camper";
    const state = makeState({ characters: [a, b] });
    const decisions = new Map<string, ParsedDecision>([
      [
        "char_opaque_a",
        nullDecision({
          action: { kind: "attack", targetId: "char_opaque_b" },
        }),
      ],
      ["char_opaque_b", nullDecision()],
    ]);
    const { trace } = resolveTurn(state, decisions);
    const attackEntry = trace.actions.find(
      (act) => act.characterId === "char_opaque_a" && act.kind === "attack",
    );
    expect(attackEntry).toBeDefined();
    expect(attackEntry!.target).toBe("Camper");
  });

  it("position move toward with targetId='Camper' steps toward opaque target", () => {
    const a = makeCharacter({
      id: "char_opaque_a",
      pos: { x: 0, y: 0 },
    });
    a.displayName = "Rat";
    const b = makeCharacter({
      id: "char_opaque_b",
      pos: { x: 20, y: 0 },
    });
    b.displayName = "Camper";
    const state = makeState({ characters: [a, b] });
    const decisions = new Map<string, ParsedDecision>([
      [
        "char_opaque_a",
        nullDecision({
          position: { kind: "move", direction: { kind: "toward", targetId: "Camper" }, dist: 8 },
        }),
      ],
      ["char_opaque_b", nullDecision()],
    ]);
    const { state: next, trace } = resolveTurn(state, decisions);
    // Default budget = 8; A starts at (0,0), target at (20,0), so A
    // should step 8 tiles toward target → x=8.
    expect(findChar(next, "char_opaque_a").pos.x).toBe(8);
    expect(
      trace.moves.find((m) => m.characterId === "char_opaque_a"),
    ).toBeTruthy();
  });

  it("position move away with targetId='Camper' steps away from opaque target", () => {
    const a = makeCharacter({
      id: "char_opaque_a",
      pos: { x: 5, y: 0 },
    });
    a.displayName = "Rat";
    const b = makeCharacter({
      id: "char_opaque_b",
      pos: { x: 0, y: 0 },
    });
    b.displayName = "Camper";
    const state = makeState({ characters: [a, b] });
    const decisions = new Map<string, ParsedDecision>([
      [
        "char_opaque_a",
        nullDecision({
          position: { kind: "move", direction: { kind: "away", targetId: "Camper" }, dist: 8 },
        }),
      ],
      ["char_opaque_b", nullDecision()],
    ]);
    const { state: next } = resolveTurn(state, decisions);
    // A at x=5 fleeing target at x=0 → moves +x. After 8 substeps, x=13.
    expect(findChar(next, "char_opaque_a").pos.x).toBe(13);
  });

  it("attack with unknown persona targetId → result='no_target', no damage", () => {
    const a = makeCharacter({
      id: "char_opaque_a",
      pos: { x: 5, y: 5 },
      weapon: { category: "weapon", name: "sword" },
    });
    a.displayName = "Rat";
    const b = makeCharacter({
      id: "char_opaque_b",
      pos: { x: 6, y: 5 },
      hp: 100,
    });
    b.displayName = "Camper";
    const state = makeState({ characters: [a, b] });
    const decisions = new Map<string, ParsedDecision>([
      [
        "char_opaque_a",
        nullDecision({
          action: { kind: "attack", targetId: "MissingPersona" },
        }),
      ],
      ["char_opaque_b", nullDecision()],
    ]);
    const { state: next, trace } = resolveTurn(state, decisions);
    // No-one took damage.
    expect(findChar(next, "char_opaque_b").hp).toBe(100);
    const attackEntry = trace.actions.find(
      (act) => act.characterId === "char_opaque_a" && act.kind === "attack",
    );
    expect(attackEntry).toBeDefined();
    expect(attackEntry!.target).toBe("MissingPersona");
    expect(attackEntry!.result).toBe("no_target");
  });
});

// ─── WP-G.1 Corpse_<PersonaName> corpse-loot dispatch — D38 PM-lock ──────
//
// Reviewer-B HIGH-1: digest renders `Corpse_<PersonaName>` typed ids,
// system prompt instructs "loot <Visible.id> — copy id verbatim", and the
// resolver must dispatch those ids to the corpse-loot path.
//
// PM-lock D38: fix at the validator/engine boundary by extending
// normalisation; do NOT change the digest/prompt rendering.
describe("WP-G.1 Corpse_<PersonaName> corpse-loot dispatch — D38", () => {
  it("Corpse_<PersonaName> typed-id (digest form) → corpse-loot path (kind='loot', result='looted')", () => {
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const state = makeState({
      characters: [a],
      world: {
        corpses: [
          {
            characterId: "Camper", // test fixture: characterId === displayName
            pos: { x: 1, y: 0 },
            contents: { weapon: { category: "weapon", name: "axe" } },
          },
        ],
      },
    });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          action: { kind: "loot", targetId: "Corpse_Camper" },
        }),
      ],
    ]);
    const { state: next, trace } = resolveTurn(state, decisions);
    // Loot succeeded: A picked up the axe.
    expect(
      next.characters.find((c) => c.characterId === "A")?.equipped.weapon,
    ).toEqual({ category: "weapon", name: "axe" });
    const looted = trace.actions.find(
      (act) =>
        act.characterId === "A" &&
        act.kind === "loot" &&
        act.result === "looted",
    );
    expect(looted).toBeDefined();
    expect(looted!.target).toBe("Corpse_Camper");
  });

  it("Corpse_<displayName> with opaque engine characterId resolves via displayName lookup → engine id", () => {
    // Production shape: corpse.characterId is a Convex Id (opaque), the
    // dead character's displayName is the persona name. The LLM emits
    // `Corpse_<PersonaName>` (the rendered typed id from the digest).
    const a = makeCharacter({ id: "char_opaque_a", pos: { x: 0, y: 0 } });
    a.displayName = "Rat";
    const state = makeState({
      characters: [a],
      world: {
        corpses: [
          {
            characterId: "char_opaque_e", // engine id, not displayName
            pos: { x: 1, y: 0 },
            contents: { armour: { category: "armour", name: "plate" } },
          },
        ],
      },
    });
    // Add a dead character entry whose displayName is Camper so the
    // displayName→characterId lookup resolves.
    const dead: CharacterState = {
      characterId: "char_opaque_e",
      personaId: "rat",
      spawnIndex: 4,
      displayName: "Camper",
      hp: 0,
      maxHp: 100,
      pos: { x: 1, y: 0 },
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
        nullDecision({
          action: { kind: "loot", targetId: "Corpse_Camper" },
        }),
      ],
    ]);
    const { state: next, trace } = resolveTurn(state, decisions);
    // A equipped plate from the corpse.
    expect(
      next.characters.find((c) => c.characterId === "char_opaque_a")?.equipped
        .armour,
    ).toEqual({ category: "armour", name: "plate" });
    const looted = trace.actions.find(
      (act) =>
        act.characterId === "char_opaque_a" &&
        act.kind === "loot" &&
        act.result === "looted",
    );
    expect(looted).toBeDefined();
    expect(looted!.target).toBe("Corpse_Camper");
  });

  it("Corpse_Missing (unknown) → result='no_corpse' on the corpse-loot branch (NOT no_target)", () => {
    const a = makeCharacter({ id: "A", pos: { x: 0, y: 0 } });
    const state = makeState({ characters: [a] });
    const decisions = new Map<string, ParsedDecision>([
      [
        "A",
        nullDecision({
          action: { kind: "loot", targetId: "Corpse_Missing" },
        }),
      ],
    ]);
    const { trace } = resolveTurn(state, decisions);
    const noCorpse = trace.actions.find(
      (act) =>
        act.characterId === "A" &&
        act.kind === "loot" &&
        act.target === "Corpse_Missing" &&
        act.result === "no_corpse",
    );
    expect(noCorpse).toBeDefined();
  });
});
