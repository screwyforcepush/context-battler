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
        { characterId: "c0", kind: "interact", target: "chest_001", result: "opened" },
        { characterId: "c1", kind: "interact", target: "chest_002", result: "opened" },
        { characterId: "c2", kind: "interact", target: "chest_003", result: "opened" },
        // already_opened is NOT counted as an equip
        { characterId: "c3", kind: "interact", target: "chest_001", result: "already_opened" },
      ] } }),
    ];
    const result = aggregateRunStats(turns, roster);
    expect(result.equips).toBe(3);
  });

  it("counts corpse loot as equips (kind=loot result=looted)", () => {
    const roster = defaultRoster();
    const turns: AggregatorTurnRow[] = [
      turn({ turn: 8, resolution: { consumed: [], speech: [], moves: [], visibilityUpdates: [], deaths: [], actions: [
        { characterId: "c4", kind: "loot", target: "c1", result: "looted" },
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
        { characterId: "c0", kind: "interact", target: "chest_001", result: "opened" },
        { characterId: "c1", kind: "loot", target: "c4", result: "looted" },
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
        { characterId: "c0", kind: "interact", target: "chest_001", result: "opened" },
        { characterId: "c3", kind: "interact", target: "chest_002", result: "opened" },
        { characterId: "c4", kind: "interact", target: "chest_003", result: "opened" },
        // 4th chest open with no equip — emitted as already_opened or out_of_range
        { characterId: "c5", kind: "interact", target: "chest_001", result: "already_opened" },
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
