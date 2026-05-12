// WP12 — pure aggregation function tests (RED phase per AOP).
//
// Tests-first per `.agents/AGENTS.md` AOP. The pure aggregator
// `aggregateRunStats` walks the trace ledger + character rows for a
// completed match and produces the `runs` row payload (kills /
// extractions / equips / speechEvents / perPersona[8]).
//
// The aggregator is split out from the Convex mutation per WP12 test
// strategy: "Unit tests on the pure aggregation function (separate
// from the Convex mutation)." The mutation is then a thin wrapper that
// reads the rows and calls this pure function.
//
// Equip rule (locked, WP12): an "equip" is counted once per equipped-
// slot transition — chest-equip (trace action kind="interact"
// result="opened") OR corpse-loot-equip (trace kind="loot"
// result="looted"). Opening a chest without taking contents is not an
// equip event (the resolver only emits result="opened" when the equip
// side-effect succeeded — chests with null contents short-circuit
// before the trace push). Looting without equipping is similarly not
// counted.
//
// Per-persona kill attribution (locked here): every attacker that
// landed an attack (action.kind="attack" with result starting "dmg ")
// against a target whose characterId appears in the same turn's
// `trace.deaths` is credited with one kill. In multi-attacker
// scenarios all hitters share credit (concept-spec §12: "three
// attackers on one target → all damage applies"). Top-level `kills`
// is the count of deaths, which may be less than the sum of
// per-persona kills when multiple attackers share credit.

import { describe, expect, it } from "vitest";
import { aggregateRunStats, type AggregatorTurnRow, type AggregatorCharacterRow } from "../../convex/engine/runStats.js";
import { resolveTurn, type ResolutionTrace } from "../../convex/engine/resolution.js";
import type {
  CharacterState,
  ItemRef,
  MatchState,
  ParsedDecision,
  Tile,
  WorldState,
} from "../../convex/engine/types.js";
import { PERSONA_IDS, type PersonaId } from "../../convex/engine/types.js";

// ─── Test fixtures ────────────────────────────────────────────────────────

/** Build a minimal turn row with overridable fields. Each test fills only
 *  the fields it cares about; others default to empty.  */
function turn(opts: Partial<AggregatorTurnRow> & { turn: number }): AggregatorTurnRow {
  return {
    turn: opts.turn,
    agentRecords: opts.agentRecords ?? [],
    resolution: {
      consumed: opts.resolution?.consumed ?? [],
      speech: opts.resolution?.speech ?? [],
      moves: opts.resolution?.moves ?? [],
      actions: opts.resolution?.actions ?? [],
      deaths: opts.resolution?.deaths ?? [],
      visibilityUpdates: opts.resolution?.visibilityUpdates ?? [],
    },
  };
}

function character(opts: Partial<AggregatorCharacterRow> & {
  _id: string;
  personaId: PersonaId;
}): AggregatorCharacterRow {
  return {
    _id: opts._id,
    personaId: opts.personaId,
    alive: opts.alive ?? true,
    diedAtTurn: opts.diedAtTurn,
    extractedAtTurn: opts.extractedAtTurn,
  };
}

/** Build the canonical 8-persona character roster, all alive at end of run. */
function defaultRoster(): AggregatorCharacterRow[] {
  return PERSONA_IDS.map((p, i) => character({ _id: `c${i}`, personaId: p }));
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("WP12 — runs.aggregate top-level counts", () => {
  it("returns zeros for an empty match (no turns, no characters)", () => {
    const result = aggregateRunStats([], []);
    expect(result.kills).toBe(0);
    expect(result.extractions).toBe(0);
    expect(result.equips).toBe(0);
    expect(result.speechEvents).toBe(0);
    // perPersona is always 8 entries even if zeros — Gate-3 report needs
    // every key present.
    expect(result.perPersona).toHaveLength(PERSONA_IDS.length);
  });

  it("counts kills from trace.deaths summed across turns (WP12 acceptance: 2 kills, T5+T12)", () => {
    const roster = defaultRoster();
    const turns: AggregatorTurnRow[] = [
      turn({ turn: 5, resolution: { consumed: [], speech: [], moves: [], visibilityUpdates: [], deaths: ["c1"], actions: [{ characterId: "c0", kind: "attack", target: "c1", result: "dmg 100" }] } }),
      turn({ turn: 12, resolution: { consumed: [], speech: [], moves: [], visibilityUpdates: [], deaths: ["c2"], actions: [{ characterId: "c0", kind: "attack", target: "c2", result: "dmg 50" }] } }),
    ];
    const result = aggregateRunStats(turns, roster);
    expect(result.kills).toBe(2);
  });

  it("counts equips from chest-equip + corpse-loot-equip trace actions (WP12: 3 chest opens + 1 chest opens-without-equip → equips=3)", () => {
    // The resolver emits result="opened" ONLY when the equip side-effect
    // succeeded (chests with null contents short-circuit before the trace
    // push at convex/engine/resolution.ts:455-461). For aggregation we
    // therefore treat every (kind="interact", result="opened") as an equip.
    // The "+1 chest opens without equip" half of the WP12 acceptance is
    // exercised by the trace omitting that interact entirely (it surfaces
    // as result="already_opened" or doesn't reach the push).
    const roster = defaultRoster();
    const turns: AggregatorTurnRow[] = [
      turn({ turn: 1, resolution: { consumed: [], speech: [], moves: [], visibilityUpdates: [], deaths: [], actions: [
        { characterId: "c0", kind: "loot", target: "chest_001", result: "opened" },
        { characterId: "c1", kind: "loot", target: "chest_002", result: "opened" },
        { characterId: "c2", kind: "loot", target: "chest_003", result: "opened" },
        // already_opened is NOT counted as an equip
        { characterId: "c3", kind: "loot", target: "chest_001", result: "already_opened" },
      ] } }),
    ];
    const result = aggregateRunStats(turns, roster);
    expect(result.equips).toBe(3);
  });

  it("counts corpse loot as equips (kind=loot result=looted)", () => {
    const roster = defaultRoster();
    const turns: AggregatorTurnRow[] = [
      turn({ turn: 8, resolution: { consumed: [], speech: [], moves: [], visibilityUpdates: [], deaths: [], actions: [
        { characterId: "c4", kind: "loot", target: "Corpse_Duelist", result: "looted" },
        // out_of_range / no_corpse are NOT equips
        { characterId: "c5", kind: "loot", target: "c2", result: "out_of_range" },
      ] } }),
    ];
    const result = aggregateRunStats(turns, roster);
    expect(result.equips).toBe(1);
  });

  it("counts extractions from character.extractedAtTurn populated (final state)", () => {
    const roster: AggregatorCharacterRow[] = [
      character({ _id: "c0", personaId: "rat", alive: true, extractedAtTurn: 50 }),
      character({ _id: "c1", personaId: "duelist", alive: true, extractedAtTurn: 50 }),
      character({ _id: "c2", personaId: "trader", alive: true }), // no extraction
      character({ _id: "c3", personaId: "opportunist", alive: false, diedAtTurn: 30 }),
      character({ _id: "c4", personaId: "paranoid", alive: true }),
      character({ _id: "c5", personaId: "camper", alive: true }),
      character({ _id: "c6", personaId: "sprinter", alive: true, extractedAtTurn: 50 }),
      character({ _id: "c7", personaId: "vulture", alive: true }),
    ];
    const result = aggregateRunStats([], roster);
    expect(result.extractions).toBe(3);
  });

  it("counts speech events from trace.speech across all turns", () => {
    const roster = defaultRoster();
    const turns: AggregatorTurnRow[] = [
      turn({ turn: 1, resolution: { consumed: [], speech: [
        { characterId: "c0", text: "hello", heardBy: ["c1", "c2"] },
        { characterId: "c2", text: "noisy", heardBy: ["c0"] },
      ], moves: [], actions: [], deaths: [], visibilityUpdates: [] } }),
      turn({ turn: 2, resolution: { consumed: [], speech: [
        { characterId: "c1", text: "reply", heardBy: ["c0"] },
      ], moves: [], actions: [], deaths: [], visibilityUpdates: [] } }),
    ];
    const result = aggregateRunStats(turns, roster);
    expect(result.speechEvents).toBe(3);
  });
});

describe("WP12 — runs.aggregate per-persona breakdown (consistency invariant)", () => {
  it("perPersona has exactly 8 entries, one per locked PersonaId", () => {
    const result = aggregateRunStats([], defaultRoster());
    expect(result.perPersona).toHaveLength(8);
    const personaIds = result.perPersona.map((p) => p.personaId).sort();
    expect(personaIds).toEqual([...PERSONA_IDS].sort());
  });

  it("perPersona.kills sum >= top-level kills (multi-attacker credit)", () => {
    // Two attackers (rat + duelist) both hit one target who dies same turn.
    // Both share credit for the kill per concept-spec §12; perPersona sum
    // therefore equals 2 while top-level kills = 1.
    const roster = defaultRoster();
    const turns: AggregatorTurnRow[] = [
      turn({ turn: 5, resolution: {
        consumed: [], speech: [], moves: [], visibilityUpdates: [],
        deaths: ["c2"],
        actions: [
          { characterId: "c0", kind: "attack", target: "c2", result: "dmg 60" }, // rat
          { characterId: "c1", kind: "attack", target: "c2", result: "dmg 50" }, // duelist
        ],
      } }),
    ];
    const result = aggregateRunStats(turns, roster);
    expect(result.kills).toBe(1);
    const kBy = Object.fromEntries(result.perPersona.map((p) => [p.personaId, p.kills]));
    expect(kBy.rat).toBe(1);
    expect(kBy.duelist).toBe(1);
    expect(kBy.trader).toBe(0);
  });

  it("perPersona.equips sum equals top-level equips (each equip attributed once)", () => {
    const roster = defaultRoster();
    // c0=rat, c1=duelist, c4=paranoid (per default roster ordering)
    const turns: AggregatorTurnRow[] = [
      turn({ turn: 1, resolution: { consumed: [], speech: [], moves: [], visibilityUpdates: [], deaths: [], actions: [
        { characterId: "c0", kind: "loot", target: "chest_001", result: "opened" },
        { characterId: "c1", kind: "loot", target: "Corpse_Paranoid", result: "looted" },
      ] } }),
    ];
    const result = aggregateRunStats(turns, roster);
    expect(result.equips).toBe(2);
    const eBy = Object.fromEntries(result.perPersona.map((p) => [p.personaId, p.equips]));
    expect(eBy.rat).toBe(1);
    expect(eBy.duelist).toBe(1);
    const sum = result.perPersona.reduce((acc, p) => acc + p.equips, 0);
    expect(sum).toBe(result.equips);
  });

  it("does not count malformed chest looted rows as corpse equips", () => {
    const roster = defaultRoster();
    const turns: AggregatorTurnRow[] = [
      turn({ turn: 1, resolution: { consumed: [], speech: [], moves: [], visibilityUpdates: [], deaths: [], actions: [
        { characterId: "c0", kind: "loot", target: "chest_001", result: "opened" },
        { characterId: "c0", kind: "loot", target: "chest_001", result: "looted" },
        { characterId: "c1", kind: "loot", target: "Corpse_Camper", result: "looted" },
      ] } }),
    ];
    const result = aggregateRunStats(turns, roster);
    expect(result.equips).toBe(2);
    const eBy = Object.fromEntries(result.perPersona.map((p) => [p.personaId, p.equips]));
    expect(eBy.rat).toBe(1);
    expect(eBy.duelist).toBe(1);
  });

  it("perPersona.extracted sum equals top-level extractions", () => {
    const roster: AggregatorCharacterRow[] = [
      character({ _id: "c0", personaId: "rat", alive: true, extractedAtTurn: 50 }),
      character({ _id: "c1", personaId: "duelist", alive: true, extractedAtTurn: 50 }),
      character({ _id: "c2", personaId: "trader", alive: true }),
      character({ _id: "c3", personaId: "opportunist", alive: false, diedAtTurn: 30 }),
      character({ _id: "c4", personaId: "paranoid", alive: true }),
      character({ _id: "c5", personaId: "camper", alive: true }),
      character({ _id: "c6", personaId: "sprinter", alive: true, extractedAtTurn: 50 }),
      character({ _id: "c7", personaId: "vulture", alive: true }),
    ];
    const result = aggregateRunStats([], roster);
    const eBy = Object.fromEntries(result.perPersona.map((p) => [p.personaId, p.extracted]));
    expect(eBy.rat).toBe(1);
    expect(eBy.duelist).toBe(1);
    expect(eBy.sprinter).toBe(1);
    expect(eBy.opportunist).toBe(0);
    const sum = result.perPersona.reduce((acc, p) => acc + p.extracted, 0);
    expect(sum).toBe(result.extractions);
  });

  it("perPersona.speechEvents sum equals top-level speechEvents", () => {
    const roster = defaultRoster();
    const turns: AggregatorTurnRow[] = [
      turn({ turn: 1, resolution: { consumed: [], speech: [
        { characterId: "c0", text: "a", heardBy: [] },
        { characterId: "c0", text: "b", heardBy: [] },
        { characterId: "c2", text: "c", heardBy: [] },
      ], moves: [], actions: [], deaths: [], visibilityUpdates: [] } }),
    ];
    const result = aggregateRunStats(turns, roster);
    expect(result.speechEvents).toBe(3);
    const sBy = Object.fromEntries(result.perPersona.map((p) => [p.personaId, p.speechEvents]));
    expect(sBy.rat).toBe(2); // c0 = rat (default roster)
    expect(sBy.trader).toBe(1); // c2 = trader
    const sum = result.perPersona.reduce((acc, p) => acc + p.speechEvents, 0);
    expect(sum).toBe(result.speechEvents);
  });

  it("perPersona.survivedTurns reflects diedAtTurn / extractedAtTurn for each character (FINAL_TURN=50 if neither)", () => {
    const roster: AggregatorCharacterRow[] = [
      // rat — survived all 50
      character({ _id: "c0", personaId: "rat", alive: true }),
      // duelist — died at turn 12
      character({ _id: "c1", personaId: "duelist", alive: false, diedAtTurn: 12 }),
      // trader — extracted at turn 50
      character({ _id: "c2", personaId: "trader", alive: true, extractedAtTurn: 50 }),
      // opportunist — died at turn 30
      character({ _id: "c3", personaId: "opportunist", alive: false, diedAtTurn: 30 }),
      character({ _id: "c4", personaId: "paranoid", alive: true }),
      character({ _id: "c5", personaId: "camper", alive: true }),
      character({ _id: "c6", personaId: "sprinter", alive: true }),
      character({ _id: "c7", personaId: "vulture", alive: true }),
    ];
    const result = aggregateRunStats([], roster);
    const sBy = Object.fromEntries(result.perPersona.map((p) => [p.personaId, p.survivedTurns]));
    expect(sBy.rat).toBe(50);
    expect(sBy.duelist).toBe(12);
    expect(sBy.trader).toBe(50);
    expect(sBy.opportunist).toBe(30);
  });
});

describe("WP12 — runs.aggregate WP12 acceptance scenario", () => {
  it("synthetic match with 2 kills (T5+T12), 3 chest opens with equip, 1 chest open without equip, 1 extraction → kills=2, equips=3, extractions=1", () => {
    // Mirrors the WP12 acceptance bullet verbatim.
    const roster: AggregatorCharacterRow[] = [
      character({ _id: "c0", personaId: "rat", alive: true, extractedAtTurn: 50 }),
      character({ _id: "c1", personaId: "duelist", alive: false, diedAtTurn: 5 }),
      character({ _id: "c2", personaId: "trader", alive: false, diedAtTurn: 12 }),
      character({ _id: "c3", personaId: "opportunist", alive: true }),
      character({ _id: "c4", personaId: "paranoid", alive: true }),
      character({ _id: "c5", personaId: "camper", alive: true }),
      character({ _id: "c6", personaId: "sprinter", alive: true }),
      character({ _id: "c7", personaId: "vulture", alive: true }),
    ];
    const turns: AggregatorTurnRow[] = [
      turn({ turn: 1, resolution: { consumed: [], speech: [], moves: [], visibilityUpdates: [], deaths: [], actions: [
        { characterId: "c0", kind: "loot", target: "chest_001", result: "opened" },
        { characterId: "c3", kind: "loot", target: "chest_002", result: "opened" },
        { characterId: "c4", kind: "loot", target: "chest_003", result: "opened" },
        // 4th chest open with no equip — emitted as already_opened or out_of_range
        { characterId: "c5", kind: "loot", target: "chest_001", result: "already_opened" },
      ] } }),
      turn({ turn: 5, resolution: { consumed: [], speech: [], moves: [], visibilityUpdates: [], deaths: ["c1"], actions: [
        { characterId: "c0", kind: "attack", target: "c1", result: "dmg 100" },
      ] } }),
      turn({ turn: 12, resolution: { consumed: [], speech: [], moves: [], visibilityUpdates: [], deaths: ["c2"], actions: [
        { characterId: "c3", kind: "attack", target: "c2", result: "dmg 50" },
      ] } }),
    ];
    const result = aggregateRunStats(turns, roster);
    expect(result.kills).toBe(2);
    expect(result.equips).toBe(3);
    expect(result.extractions).toBe(1);
  });
});

// ─── Integration: resolveTurn → aggregator ground-truth contract ──────────
//
// Surgical-correctness fixes (Gate-2 review consensus, batch-1):
//   Fix #1 — equip trace-emission must be ground-truth: `result="opened"` /
//            `result="looted"` is emitted ONLY when the equip side-effect
//            actually ran. Two failure modes the previous emission shape
//            mishandled:
//              (a) Dud chest (chest.contents === null / opened === true) →
//                  no equip side-effect → no success trace.
//              (b) Same-turn collision (two actors target same un-opened
//                  chest) → only the first actor's equip runs → only that
//                  one gets a success trace.
//            Same shape applies to the corpse-loot path (empty / drained
//            corpse → no looted trace).
//
//   Fix #2 — `(kind="overwatch", result="dmg N")` whose target appears in
//            same-turn `trace.deaths` must credit the attacker's persona
//            with one kill (concept-spec §11/§12).
//
// These tests drive `resolveTurn` end-to-end, then feed its trace into the
// aggregator — that's the only level at which "what does the engine emit"
// can be asserted. Top-level kills/equips and per-persona attribution are
// both verified.

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
  personaId?: PersonaId;
  hp?: number;
  weapon?: ItemRef;
  armour?: ItemRef;
}): CharacterState {
  return {
    characterId: opts.id,
    personaId: opts.personaId ?? "rat",
    spawnIndex: 0,
    displayName: opts.id,
    hp: opts.hp ?? 100,
    maxHp: 100,
    pos: opts.pos,
    equipped: { weapon: opts.weapon, armour: opts.armour },
    scratchpad: "",
    hidden: false,
    alive: true,
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

/** Build a single turn-row from a resolveTurn trace. The aggregator only
 *  reads `agentRecords[].personaId` (for the personaIndex via characters)
 *  and `resolution.{actions,deaths,speech}` so we minimally fill those. */
function turnRowFromTrace(
  turn: number,
  trace: ResolutionTrace,
): AggregatorTurnRow {
  return {
    turn,
    agentRecords: [],
    resolution: {
      consumed: trace.consumed.map((c) => ({
        characterId: c.characterId,
        item: { category: "consumable" as const, name: c.item },
      })),
      speech: trace.speech,
      moves: trace.moves,
      actions: trace.actions,
      deaths: trace.deaths,
      visibilityUpdates: trace.visibilityUpdates,
    },
  };
}

function rosterFromState(state: MatchState): AggregatorCharacterRow[] {
  return state.characters.map((c) => ({
    _id: c.characterId,
    personaId: c.personaId,
    alive: c.alive,
    diedAtTurn: c.diedAtTurn,
    extractedAtTurn: c.extractedAtTurn,
  }));
}

describe("Fix #1 — equip ground-truth (chest)", () => {
  it("two actors target the same un-opened chest same turn → equips counter increments by exactly 1, not 2", () => {
    // Two actors A (rat) and B (duelist) both adjacent to chest_001 and both
    // commit `interact` against it the same turn. Phase 5 only equips ONE of
    // them (whichever runs first in sorted order). Aggregator must count the
    // equip exactly once — top-level + per-persona.
    const a = makeCharacter({
      id: "A",
      pos: { x: 0, y: 0 },
      personaId: "rat",
      weapon: { category: "weapon", name: "rusty_blade" },
    });
    const b = makeCharacter({
      id: "B",
      pos: { x: 2, y: 0 },
      personaId: "duelist",
      weapon: { category: "weapon", name: "rusty_blade" },
    });
    const state = makeState({
      characters: [a, b],
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
      ["A", nullDecision({ action: { kind: "loot", targetId: "chest_001" } })],
      ["B", nullDecision({ action: { kind: "loot", targetId: "chest_001" } })],
    ]);
    const { state: next, trace } = resolveTurn(state, decisions);

    // Sanity: chest is opened, exactly one of A/B has axe equipped.
    const chest = next.world.chests.find((c) => c.id === "chest_001")!;
    expect(chest.opened).toBe(true);
    const aWeap = next.characters.find((c) => c.characterId === "A")!.equipped.weapon;
    const bWeap = next.characters.find((c) => c.characterId === "B")!.equipped.weapon;
    const equippedAxe = [aWeap, bWeap].filter(
      (w) => w?.category === "weapon" && w?.name === "axe",
    );
    expect(equippedAxe).toHaveLength(1);

    // Aggregator must reflect ground truth: ONE equip, not two.
    const result = aggregateRunStats(
      [turnRowFromTrace(1, trace)],
      rosterFromState(next),
    );
    expect(result.equips).toBe(1);

    const eBy = Object.fromEntries(result.perPersona.map((p) => [p.personaId, p.equips]));
    expect((eBy.rat ?? 0) + (eBy.duelist ?? 0)).toBe(1);
    expect(eBy.trader).toBe(0);
  });

  it("dud chest (contents === null) → no equip; aggregator equips counter is 0", () => {
    // Action-build previously pushed `result="opened"` for the actor's claim
    // even when the chest had null contents (phase 5 short-circuits without
    // running the equip side-effect). Post-fix: the ground-truth contract
    // requires no `result="opened"` action when no equip ran.
    const a = makeCharacter({
      id: "A",
      pos: { x: 0, y: 0 },
      personaId: "rat",
    });
    const state = makeState({
      characters: [a],
      world: {
        chests: [
          {
            id: "chest_dud",
            pos: { x: 1, y: 0 },
            contents: null,
            opened: false,
            lootTable: "weapons-heavy",
          },
        ],
      },
    });
    const decisions = new Map<string, ParsedDecision>([
      ["A", nullDecision({ action: { kind: "loot", targetId: "chest_dud" } })],
    ]);
    const { trace, state: next } = resolveTurn(state, decisions);

    // No success trace was emitted (it may have a non-success result OR be
    // absent entirely — both are acceptable per the fix).
    // Phase-3 PM lock D7: chest opens emit `kind="loot"` / `result="opened"`
    // (the resolved-engine-path, unified under loot per ADR §1).
    const successOpens = trace.actions.filter(
      (act) =>
        act.kind === "loot" &&
        act.result === "opened" &&
        typeof act.target === "string" &&
        act.target.startsWith("chest_"),
    );
    expect(successOpens).toHaveLength(0);

    const result = aggregateRunStats(
      [turnRowFromTrace(1, trace)],
      rosterFromState(next),
    );
    expect(result.equips).toBe(0);
    const eBy = Object.fromEntries(result.perPersona.map((p) => [p.personaId, p.equips]));
    expect(eBy.rat).toBe(0);
  });
});

describe("Fix #1 — equip ground-truth (corpse-loot)", () => {
  it("two actors loot the same single-slot corpse same turn → equips counter increments by exactly 1, not 2", () => {
    // Corpse holds ONE item (weapon only). Two looters in range; only the
    // first actor's loot side-effect runs. Aggregator must count one equip.
    const a = makeCharacter({
      id: "A",
      pos: { x: 0, y: 0 },
      personaId: "rat",
    });
    const b = makeCharacter({
      id: "B",
      pos: { x: 2, y: 0 },
      personaId: "duelist",
    });
    const state = makeState({
      characters: [a, b],
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
      ["A", nullDecision({ action: { kind: "loot", targetId: "Corpse_Camper" } })],
      ["B", nullDecision({ action: { kind: "loot", targetId: "Corpse_Camper" } })],
    ]);
    const { state: next, trace } = resolveTurn(state, decisions);

    // Sanity: exactly one of A/B has the axe equipped.
    const aWeap = next.characters.find((c) => c.characterId === "A")!.equipped.weapon;
    const bWeap = next.characters.find((c) => c.characterId === "B")!.equipped.weapon;
    const got = [aWeap, bWeap].filter(
      (w) => w?.category === "weapon" && w?.name === "axe",
    );
    expect(got).toHaveLength(1);

    const result = aggregateRunStats(
      [turnRowFromTrace(1, trace)],
      rosterFromState(next),
    );
    expect(result.equips).toBe(1);
    const eBy = Object.fromEntries(result.perPersona.map((p) => [p.personaId, p.equips]));
    expect((eBy.rat ?? 0) + (eBy.duelist ?? 0)).toBe(1);
  });

  it("looting an empty corpse (no slots) → no equip; aggregator equips counter is 0", () => {
    const a = makeCharacter({
      id: "A",
      pos: { x: 0, y: 0 },
      personaId: "rat",
    });
    const state = makeState({
      characters: [a],
      world: {
        corpses: [
          {
            characterId: "Vulture",
            pos: { x: 1, y: 0 },
            contents: {},
          },
        ],
      },
    });
    const decisions = new Map<string, ParsedDecision>([
      ["A", nullDecision({ action: { kind: "loot", targetId: "Corpse_Vulture" } })],
    ]);
    const { trace, state: next } = resolveTurn(state, decisions);

    const successLoots = trace.actions.filter(
      (act) => act.kind === "loot" && act.result === "looted",
    );
    expect(successLoots).toHaveLength(0);

    const result = aggregateRunStats(
      [turnRowFromTrace(1, trace)],
      rosterFromState(next),
    );
    expect(result.equips).toBe(0);
  });
});

describe("Fix #2 — overwatch kill attribution (T42 scenario)", () => {
  it("overwatch lethal hit credits the attacker's persona with one kill (top-level + perPersona)", () => {
    // T42 scenario: trader fires overwatch, target dies same turn.
    // Pre-fix: per-persona kills under-counted because the aggregator filter
    // only credited `kind === "attack"`. Post-fix: `attack || overwatch`
    // both qualify.
    //
    // A is the trader on overwatch with greatsword. B is the rat
    // at low HP, walking into A's range. Phase 5 overwatch fires; B
    // dies; phase 6 records the death.
    const a = makeCharacter({
      id: "A",
      pos: { x: 0, y: 0 },
      personaId: "trader",
      weapon: { category: "weapon", name: "greatsword" },
    });
    const b = makeCharacter({
      id: "B",
      pos: { x: 3, y: 0 },
      personaId: "rat",
      hp: 5,
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
    const { state: next, trace } = resolveTurn(state, decisions);

    // Sanity: B died, trace records the overwatch hit and the death.
    expect(next.characters.find((c) => c.characterId === "B")!.alive).toBe(false);
    expect(trace.deaths).toContain("B");
    expect(
      trace.actions.some(
        (a) => a.kind === "overwatch" && a.target === "B" && a.result.startsWith("dmg "),
      ),
    ).toBe(true);

    const result = aggregateRunStats(
      [turnRowFromTrace(1, trace)],
      rosterFromState(next),
    );
    expect(result.kills).toBe(1);
    const kBy = Object.fromEntries(result.perPersona.map((p) => [p.personaId, p.kills]));
    expect(kBy.trader).toBe(1);
    expect(kBy.rat).toBe(0);
  });

  it("synthetic overwatch trace (no resolveTurn): aggregator credits overwatch lethal hits", () => {
    // Pure aggregator-level test guarding the kill-filter contract.
    const roster: AggregatorCharacterRow[] = [
      { _id: "c0", personaId: "rat", alive: true },
      { _id: "c1", personaId: "duelist", alive: false, diedAtTurn: 42 },
      { _id: "c2", personaId: "trader", alive: true },
      { _id: "c3", personaId: "opportunist", alive: true },
      { _id: "c4", personaId: "paranoid", alive: true },
      { _id: "c5", personaId: "camper", alive: true },
      { _id: "c6", personaId: "sprinter", alive: true },
      { _id: "c7", personaId: "vulture", alive: true },
    ];
    const turns: AggregatorTurnRow[] = [
      turn({
        turn: 42,
        resolution: {
          consumed: [],
          speech: [],
          moves: [],
          visibilityUpdates: [],
          deaths: ["c1"],
          actions: [
            // c2 = trader fires overwatch; lands lethal hit on c1 (duelist).
            { characterId: "c2", kind: "overwatch", target: "c1", result: "dmg 40" },
          ],
        },
      }),
    ];
    const result = aggregateRunStats(turns, roster);
    expect(result.kills).toBe(1);
    const kBy = Object.fromEntries(result.perPersona.map((p) => [p.personaId, p.kills]));
    expect(kBy.trader).toBe(1);
  });

  it("overwatch + concurrent attack on same dying target → both attackers credited (multi-attacker §12)", () => {
    // Two attackers contribute to one death same turn: one stationary attack
    // and one overwatch. Top-level kills=1; both personas credited.
    const roster: AggregatorCharacterRow[] = [
      { _id: "c0", personaId: "rat", alive: true },
      { _id: "c1", personaId: "duelist", alive: false, diedAtTurn: 7 },
      { _id: "c2", personaId: "trader", alive: true },
      { _id: "c3", personaId: "opportunist", alive: true },
      { _id: "c4", personaId: "paranoid", alive: true },
      { _id: "c5", personaId: "camper", alive: true },
      { _id: "c6", personaId: "sprinter", alive: true },
      { _id: "c7", personaId: "vulture", alive: true },
    ];
    const turns: AggregatorTurnRow[] = [
      turn({
        turn: 7,
        resolution: {
          consumed: [], speech: [], moves: [], visibilityUpdates: [],
          deaths: ["c1"],
          actions: [
            { characterId: "c0", kind: "attack", target: "c1", result: "dmg 30" },     // rat
            { characterId: "c2", kind: "overwatch", target: "c1", result: "dmg 40" }, // trader
          ],
        },
      }),
    ];
    const result = aggregateRunStats(turns, roster);
    expect(result.kills).toBe(1);
    const kBy = Object.fromEntries(result.perPersona.map((p) => [p.personaId, p.kills]));
    expect(kBy.rat).toBe(1);
    expect(kBy.trader).toBe(1);
  });
});
