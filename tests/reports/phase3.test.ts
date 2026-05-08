// Phase-3 WP-E.3 — unit tests for the pure phase-3 metrics aggregator.
//
// `convex/reports/phase3.ts` exports `computePhase3Metrics(runs)`, the
// pure comparator math the closing-10 closure record reads off of. This
// test suite locks every metric formula in README §5 + work-packages.md
// WP-E.3 against synthetic 2-3 turn fixtures so the math is exercised
// independently of the real 10-run harness pass.
//
// Cucumber traceability (each metric maps to at least one test):
//   - schema validity rate (≤ 10%)
//   - wall-blocked move rate (≤ 2%)
//   - drained-corpse repeat rate (≤ 1%)
//   - corpse-loot success rate (≥ 50% of runs)
//   - overwatch stance differentiation (defensive + offensive both > 0)
//   - outcome attribution (≥ 50% best-effort heuristic)
//   - reasoning capture rate (≥ 80% of non-fallback records)
//   - carry-over phase-1 (extraction / kill / equip / speech / persona spread)
//
// Boundary contract: NO Convex imports. Tests run against the pure
// `computePhase3Metrics` function; the Convex action wrapper
// (`computePhase3Report`) is exercised end-to-end at WP-E.4 against the
// real closing-10 dataset.

import { describe, expect, it } from "vitest";
import {
  computePhase3Metrics,
  type Phase3RunInput,
  type Phase3TurnRow,
  type Phase3ActionTraceEntry,
  type Phase3MoveTraceEntry,
  type Phase3AgentRecord,
  type Phase3CharacterRow,
} from "../../convex/reports/phase3.js";
import { PERSONA_IDS } from "../../convex/engine/types.js";

// ─── Fixture builders ────────────────────────────────────────────────────

function makeAgentRecord(
  overrides: Partial<Phase3AgentRecord> & {
    characterId: string;
    personaId?: Phase3AgentRecord["personaId"];
  },
): Phase3AgentRecord {
  return {
    characterId: overrides.characterId,
    personaId: overrides.personaId ?? "rat",
    scratchpadAfter: overrides.scratchpadAfter ?? "",
    decision: overrides.decision ?? {
      move: { kind: "none" },
      action: { kind: "none" },
    },
    llm: overrides.llm ?? {
      fellBackToSafeDefault: false,
      reasoning: "thinking…",
    },
  };
}

function makeTurn(
  overrides: Partial<Phase3TurnRow> & { matchId: string; turn: number },
): Phase3TurnRow {
  return {
    matchId: overrides.matchId,
    turn: overrides.turn,
    agentRecords: overrides.agentRecords ?? [],
    resolution: overrides.resolution ?? {
      moves: [],
      actions: [],
      speech: [],
    },
  };
}

function makeChar(
  characterId: string,
  displayName: string,
  personaId: Phase3CharacterRow["personaId"] = "rat",
  extracted = false,
): Phase3CharacterRow {
  return { characterId, matchId: "M1", displayName, personaId, extracted };
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe("computePhase3Metrics — empty input", () => {
  it("returns zero-shaped payload with all meets* flags false", () => {
    const out = computePhase3Metrics([]);
    expect(out.runCount).toBe(0);
    expect(out.matchIds).toEqual([]);
    expect(out.totalAgentRecords).toBe(0);
    expect(out.fallbackCount).toBe(0);
    expect(out.fallbackRate).toBe(0);
    expect(out.meetsSafeDefaultThreshold).toBe(false);
    expect(out.meetsAllThresholds).toBe(false);
    expect(out.perPersona).toHaveLength(8);
    for (const id of PERSONA_IDS) {
      const slot = out.perPersona.find((p) => p.personaId === id);
      expect(slot).toBeDefined();
      expect(slot!.extractionsCount).toBe(0);
      expect(slot!.extractionRate).toBe(0);
    }
  });
});

describe("computePhase3Metrics — schema validity (fellBackToSafeDefault)", () => {
  it("counts ≤ 10% fallback as PASS; > 10% as FAIL", () => {
    // 1 run with 10 records, 1 fallback → 10% rate (boundary, PASS).
    const records = Array.from({ length: 9 }, (_, i) =>
      makeAgentRecord({ characterId: `c${i}` }),
    );
    records.push(
      makeAgentRecord({
        characterId: "c-fb",
        llm: { fellBackToSafeDefault: true, reasoning: null },
      }),
    );
    const turn0 = makeTurn({
      matchId: "M1",
      turn: 0,
      agentRecords: records,
    });
    const out = computePhase3Metrics([
      {
        matchId: "M1",
        turns: [turn0],
        characters: [makeChar("c0", "Player_1")],
      },
    ]);
    expect(out.totalAgentRecords).toBe(10);
    expect(out.fallbackCount).toBe(1);
    expect(out.fallbackRate).toBeCloseTo(0.1);
    expect(out.meetsSafeDefaultThreshold).toBe(true);

    // 1 run with 10 records, 2 fallbacks → 20% rate, FAIL.
    records[1] = makeAgentRecord({
      characterId: "c1",
      llm: { fellBackToSafeDefault: true, reasoning: null },
    });
    const turn0b = makeTurn({
      matchId: "M1",
      turn: 0,
      agentRecords: records,
    });
    const out2 = computePhase3Metrics([
      {
        matchId: "M1",
        turns: [turn0b],
        characters: [makeChar("c0", "Player_1")],
      },
    ]);
    expect(out2.fallbackRate).toBeCloseTo(0.2);
    expect(out2.meetsSafeDefaultThreshold).toBe(false);
  });
});

describe("computePhase3Metrics — wall-blocked move rate", () => {
  it("≤ 2% (1/50) is PASS; > 2% (2/50) is FAIL", () => {
    // 50 moves, 1 wall-blocked → 2% (boundary, PASS).
    const moves: Phase3MoveTraceEntry[] = Array.from({ length: 49 }, () => ({
      characterId: "c0",
    }));
    moves.push({ characterId: "c0", blockedBy: "wall" });
    const turn = makeTurn({
      matchId: "M1",
      turn: 0,
      agentRecords: [makeAgentRecord({ characterId: "c0" })],
      resolution: { moves, actions: [], speech: [] },
    });
    const out = computePhase3Metrics([
      {
        matchId: "M1",
        turns: [turn],
        characters: [makeChar("c0", "Player_1")],
      },
    ]);
    expect(out.totalMoveAttempts).toBe(50);
    expect(out.wallBlockedMoves).toBe(1);
    expect(out.wallBlockedMoveRate).toBeCloseTo(0.02);
    expect(out.meetsWallBlockedThreshold).toBe(true);

    // 50 moves, 2 wall-blocked → 4%, FAIL.
    moves.push({ characterId: "c0", blockedBy: "wall" });
    const turnB = makeTurn({
      matchId: "M1",
      turn: 0,
      agentRecords: [makeAgentRecord({ characterId: "c0" })],
      resolution: { moves, actions: [], speech: [] },
    });
    const out2 = computePhase3Metrics([
      {
        matchId: "M1",
        turns: [turnB],
        characters: [makeChar("c0", "Player_1")],
      },
    ]);
    expect(out2.wallBlockedMoves).toBe(2);
    expect(out2.meetsWallBlockedThreshold).toBe(false);
  });
});

describe("computePhase3Metrics — drained-corpse repeat rate", () => {
  it("counts (actor, corpse) repeats across consecutive turn pairs", () => {
    // Actor c0 emits empty-loot for Player_5 at turns 0, 1, 2 → 2 repeats
    // (0→1, 1→2). Total loot attempts = 3 (the three empty entries).
    // Rate = 2/3 ≈ 67% → FAIL (threshold ≤ 1%).
    const emptyLootEntry: Phase3ActionTraceEntry = {
      characterId: "c0",
      kind: "loot",
      target: "Player_5",
      result: "empty",
    };
    const t0 = makeTurn({
      matchId: "M1",
      turn: 0,
      agentRecords: [makeAgentRecord({ characterId: "c0" })],
      resolution: { moves: [], actions: [emptyLootEntry], speech: [] },
    });
    const t1 = makeTurn({
      matchId: "M1",
      turn: 1,
      agentRecords: [makeAgentRecord({ characterId: "c0" })],
      resolution: { moves: [], actions: [emptyLootEntry], speech: [] },
    });
    const t2 = makeTurn({
      matchId: "M1",
      turn: 2,
      agentRecords: [makeAgentRecord({ characterId: "c0" })],
      resolution: { moves: [], actions: [emptyLootEntry], speech: [] },
    });
    const out = computePhase3Metrics([
      {
        matchId: "M1",
        turns: [t0, t1, t2],
        characters: [makeChar("c0", "Player_1")],
      },
    ]);
    expect(out.totalLootAttempts).toBe(3);
    expect(out.drainedRepeats).toBe(2);
    expect(out.drainedRepeatRate).toBeCloseTo(2 / 3);
    expect(out.meetsDrainedRepeatThreshold).toBe(false);

    // Sanity: a single empty-loot at turn 0 with no follow-up emits 0 repeats.
    const out0 = computePhase3Metrics([
      {
        matchId: "M1",
        turns: [t0],
        characters: [makeChar("c0", "Player_1")],
      },
    ]);
    expect(out0.drainedRepeats).toBe(0);
    expect(out0.meetsDrainedRepeatThreshold).toBe(true);
  });
});

describe("computePhase3Metrics — corpse-loot success rate", () => {
  it("counts runs with ≥ 1 looted+Player_* entry; ≥ 50% of runs is PASS", () => {
    // 2 runs: run1 has a successful corpse loot, run2 doesn't → 50%, PASS.
    const successAction: Phase3ActionTraceEntry = {
      characterId: "c0",
      kind: "loot",
      target: "Player_5",
      result: "looted",
    };
    const run1 = makeTurn({
      matchId: "M1",
      turn: 0,
      agentRecords: [makeAgentRecord({ characterId: "c0" })],
      resolution: { moves: [], actions: [successAction], speech: [] },
    });
    const run2 = makeTurn({
      matchId: "M2",
      turn: 0,
      agentRecords: [makeAgentRecord({ characterId: "c1" })],
      resolution: { moves: [], actions: [], speech: [] },
    });
    const out = computePhase3Metrics([
      {
        matchId: "M1",
        turns: [run1],
        characters: [makeChar("c0", "Player_1")],
      },
      {
        matchId: "M2",
        turns: [run2],
        characters: [makeChar("c1", "Player_2")],
      },
    ]);
    expect(out.runsWithCorpseLoot).toBe(1);
    expect(out.corpseLootSuccessRate).toBeCloseTo(0.5);
    expect(out.meetsCorpseLootThreshold).toBe(true);

    // Chest-loot (target = chest_NNN) should NOT count as corpse loot.
    const chestAction: Phase3ActionTraceEntry = {
      characterId: "c0",
      kind: "loot",
      target: "chest_005",
      result: "opened",
    };
    const runChest = makeTurn({
      matchId: "M3",
      turn: 0,
      agentRecords: [makeAgentRecord({ characterId: "c0" })],
      resolution: { moves: [], actions: [chestAction], speech: [] },
    });
    const out2 = computePhase3Metrics([
      {
        matchId: "M3",
        turns: [runChest],
        characters: [makeChar("c0", "Player_1")],
      },
    ]);
    expect(out2.runsWithCorpseLoot).toBe(0);
    expect(out2.runsWithEquip).toBe(1); // chest open does count for equips
  });
});

describe("computePhase3Metrics — overwatch stance differentiation", () => {
  it("requires both defensive (fromOverwatch+stance=defensive) AND offensive (stance=offensive) > 0", () => {
    // Run with only defensive counter-fires → FAIL (offensive count = 0).
    const defensiveEntry: Phase3ActionTraceEntry = {
      characterId: "c0",
      kind: "overwatch",
      target: "Player_5",
      result: "dmg 15",
      fromOverwatch: true,
      stance: "defensive",
    };
    const turnDef = makeTurn({
      matchId: "M1",
      turn: 0,
      agentRecords: [makeAgentRecord({ characterId: "c0" })],
      resolution: { moves: [], actions: [defensiveEntry], speech: [] },
    });
    const out = computePhase3Metrics([
      {
        matchId: "M1",
        turns: [turnDef],
        characters: [makeChar("c0", "Player_1")],
      },
    ]);
    expect(out.defensiveCounterFires).toBe(1);
    expect(out.offensiveOverwatchFires).toBe(0);
    expect(out.meetsOverwatchDifferentiationThreshold).toBe(false);

    // Add an offensive entry → PASS.
    const offensiveEntry: Phase3ActionTraceEntry = {
      characterId: "c0",
      kind: "overwatch",
      target: "Player_5",
      result: "dmg 15",
      stance: "offensive",
    };
    const turnBoth = makeTurn({
      matchId: "M1",
      turn: 0,
      agentRecords: [makeAgentRecord({ characterId: "c0" })],
      resolution: {
        moves: [],
        actions: [defensiveEntry, offensiveEntry],
        speech: [],
      },
    });
    const out2 = computePhase3Metrics([
      {
        matchId: "M1",
        turns: [turnBoth],
        characters: [makeChar("c0", "Player_1")],
      },
    ]);
    expect(out2.defensiveCounterFires).toBe(1);
    expect(out2.offensiveOverwatchFires).toBe(1);
    expect(out2.meetsOverwatchDifferentiationThreshold).toBe(true);
  });
});

describe("computePhase3Metrics — outcome attribution heuristic", () => {
  it("counts a match when N+1 decision references attacker via attack target", () => {
    // Turn 0: attacker c-A hits defender c-B for dmg 20.
    // Turn 1: defender c-B's decision attacks attacker (Player_A).
    const characters = [
      makeChar("c-A", "Player_A"),
      makeChar("c-B", "Player_B"),
    ];
    const t0 = makeTurn({
      matchId: "M1",
      turn: 0,
      agentRecords: [
        makeAgentRecord({ characterId: "c-A" }),
        makeAgentRecord({ characterId: "c-B" }),
      ],
      resolution: {
        moves: [],
        actions: [
          {
            characterId: "c-A",
            kind: "attack",
            target: "Player_B",
            result: "dmg 20",
          },
        ],
        speech: [],
      },
    });
    const t1 = makeTurn({
      matchId: "M1",
      turn: 1,
      agentRecords: [
        makeAgentRecord({ characterId: "c-A" }),
        makeAgentRecord({
          characterId: "c-B",
          decision: {
            move: { kind: "none" },
            action: { kind: "attack", targetCharacterId: "Player_A" },
          },
        }),
      ],
      resolution: { moves: [], actions: [], speech: [] },
    });
    const out = computePhase3Metrics([
      { matchId: "M1", turns: [t0, t1], characters },
    ]);
    expect(out.outcomeAttributionPairs).toBe(1);
    expect(out.outcomeAttributionMatches).toBe(1);
    expect(out.outcomeAttributionRate).toBe(1);
    expect(out.meetsOutcomeAttributionThreshold).toBe(true);
  });

  it("counts a match via scratchpad substring reference", () => {
    const characters = [
      makeChar("c-A", "Player_A"),
      makeChar("c-B", "Player_B"),
    ];
    const t0 = makeTurn({
      matchId: "M1",
      turn: 0,
      agentRecords: [
        makeAgentRecord({ characterId: "c-A" }),
        makeAgentRecord({ characterId: "c-B" }),
      ],
      resolution: {
        moves: [],
        actions: [
          {
            characterId: "c-A",
            kind: "attack",
            target: "Player_B",
            result: "dmg 10",
          },
        ],
        speech: [],
      },
    });
    const t1 = makeTurn({
      matchId: "M1",
      turn: 1,
      agentRecords: [
        makeAgentRecord({ characterId: "c-A" }),
        makeAgentRecord({
          characterId: "c-B",
          // no action / move targeting attacker, but scratchpad mentions them
          scratchpadAfter: "Took 10 from Player_A — flee NW.",
        }),
      ],
      resolution: { moves: [], actions: [], speech: [] },
    });
    const out = computePhase3Metrics([
      { matchId: "M1", turns: [t0, t1], characters },
    ]);
    expect(out.outcomeAttributionMatches).toBe(1);
    expect(out.outcomeAttributionRate).toBe(1);
  });

  it("does NOT count a match when N+1 ignores attacker", () => {
    const characters = [
      makeChar("c-A", "Player_A"),
      makeChar("c-B", "Player_B"),
    ];
    const t0 = makeTurn({
      matchId: "M1",
      turn: 0,
      agentRecords: [
        makeAgentRecord({ characterId: "c-A" }),
        makeAgentRecord({ characterId: "c-B" }),
      ],
      resolution: {
        moves: [],
        actions: [
          {
            characterId: "c-A",
            kind: "attack",
            target: "Player_B",
            result: "dmg 8",
          },
        ],
        speech: [],
      },
    });
    const t1 = makeTurn({
      matchId: "M1",
      turn: 1,
      agentRecords: [
        makeAgentRecord({ characterId: "c-A" }),
        makeAgentRecord({
          characterId: "c-B",
          // no reference to Player_A anywhere
          scratchpadAfter: "Heading to evac.",
        }),
      ],
      resolution: { moves: [], actions: [], speech: [] },
    });
    const out = computePhase3Metrics([
      { matchId: "M1", turns: [t0, t1], characters },
    ]);
    expect(out.outcomeAttributionPairs).toBe(1);
    expect(out.outcomeAttributionMatches).toBe(0);
    expect(out.outcomeAttributionRate).toBe(0);
    expect(out.meetsOutcomeAttributionThreshold).toBe(false);
  });

  it("ignores out-of-range / non-damage results", () => {
    const characters = [
      makeChar("c-A", "Player_A"),
      makeChar("c-B", "Player_B"),
    ];
    const t0 = makeTurn({
      matchId: "M1",
      turn: 0,
      agentRecords: [
        makeAgentRecord({ characterId: "c-A" }),
        makeAgentRecord({ characterId: "c-B" }),
      ],
      resolution: {
        moves: [],
        actions: [
          {
            characterId: "c-A",
            kind: "attack",
            target: "Player_B",
            result: "out_of_range",
          },
        ],
        speech: [],
      },
    });
    const t1 = makeTurn({
      matchId: "M1",
      turn: 1,
      agentRecords: [
        makeAgentRecord({ characterId: "c-A" }),
        makeAgentRecord({ characterId: "c-B" }),
      ],
      resolution: { moves: [], actions: [], speech: [] },
    });
    const out = computePhase3Metrics([
      { matchId: "M1", turns: [t0, t1], characters },
    ]);
    expect(out.outcomeAttributionPairs).toBe(0);
    expect(out.meetsOutcomeAttributionThreshold).toBe(false);
  });
});

describe("computePhase3Metrics — reasoning capture rate", () => {
  it("≥ 80% of NON-FALLBACK records with reasoning text is PASS", () => {
    // 5 records: 1 fallback (excluded), 4 non-fallback. 3/4 = 75% → FAIL.
    const records: Phase3AgentRecord[] = [
      makeAgentRecord({
        characterId: "c-fb",
        llm: { fellBackToSafeDefault: true, reasoning: null },
      }),
      makeAgentRecord({
        characterId: "c0",
        llm: { fellBackToSafeDefault: false, reasoning: "thinking…" },
      }),
      makeAgentRecord({
        characterId: "c1",
        llm: { fellBackToSafeDefault: false, reasoning: "more thoughts" },
      }),
      makeAgentRecord({
        characterId: "c2",
        llm: { fellBackToSafeDefault: false, reasoning: "ok" },
      }),
      makeAgentRecord({
        characterId: "c3",
        llm: { fellBackToSafeDefault: false, reasoning: null },
      }),
    ];
    const turn = makeTurn({
      matchId: "M1",
      turn: 0,
      agentRecords: records,
    });
    const out = computePhase3Metrics([
      {
        matchId: "M1",
        turns: [turn],
        characters: [makeChar("c0", "Player_1")],
      },
    ]);
    expect(out.nonFallbackRecords).toBe(4);
    expect(out.reasoningCaptured).toBe(3);
    expect(out.reasoningCaptureRate).toBeCloseTo(0.75);
    expect(out.meetsReasoningCaptureThreshold).toBe(false);

    // Add a 5th non-fallback w/ reasoning → 4/5 = 80%, PASS.
    records.push(
      makeAgentRecord({
        characterId: "c4",
        llm: { fellBackToSafeDefault: false, reasoning: "yep" },
      }),
    );
    const turnB = makeTurn({
      matchId: "M1",
      turn: 0,
      agentRecords: records,
    });
    const out2 = computePhase3Metrics([
      {
        matchId: "M1",
        turns: [turnB],
        characters: [makeChar("c0", "Player_1")],
      },
    ]);
    expect(out2.nonFallbackRecords).toBe(5);
    expect(out2.reasoningCaptured).toBe(4);
    expect(out2.reasoningCaptureRate).toBeCloseTo(0.8);
    expect(out2.meetsReasoningCaptureThreshold).toBe(true);
  });
});

describe("computePhase3Metrics — carry-over phase-1 metrics", () => {
  it("counts runs with ≥ 1 extraction (per-persona too)", () => {
    // Run 1: rat extracts. Run 2: vulture extracts. Run 3: nobody.
    const out = computePhase3Metrics([
      {
        matchId: "M1",
        turns: [
          makeTurn({
            matchId: "M1",
            turn: 0,
            agentRecords: [makeAgentRecord({ characterId: "c0" })],
          }),
        ],
        characters: [makeChar("c0", "Player_1", "rat", true)],
      },
      {
        matchId: "M2",
        turns: [
          makeTurn({
            matchId: "M2",
            turn: 0,
            agentRecords: [makeAgentRecord({ characterId: "c1" })],
          }),
        ],
        characters: [makeChar("c1", "Player_1", "vulture", true)],
      },
      {
        matchId: "M3",
        turns: [
          makeTurn({
            matchId: "M3",
            turn: 0,
            agentRecords: [makeAgentRecord({ characterId: "c2" })],
          }),
        ],
        characters: [makeChar("c2", "Player_1", "rat", false)],
      },
    ]);
    expect(out.runsWithExtraction).toBe(2);
    expect(out.extractionRate).toBeCloseTo(2 / 3);
    expect(out.meetsExtractionThreshold).toBe(true);
    const ratStats = out.perPersona.find((p) => p.personaId === "rat")!;
    expect(ratStats.extractionsCount).toBe(1);
    const vultureStats = out.perPersona.find((p) => p.personaId === "vulture")!;
    expect(vultureStats.extractionsCount).toBe(1);
    const duelistStats = out.perPersona.find((p) => p.personaId === "duelist")!;
    expect(duelistStats.extractionsCount).toBe(0);
  });

  it("counts runs with ≥ 1 kill (any dmg-result attack/overwatch entry)", () => {
    const killTurn = makeTurn({
      matchId: "M1",
      turn: 0,
      agentRecords: [makeAgentRecord({ characterId: "c0" })],
      resolution: {
        moves: [],
        actions: [
          {
            characterId: "c0",
            kind: "attack",
            target: "Player_2",
            result: "dmg 25",
          },
        ],
        speech: [],
      },
    });
    const noKillTurn = makeTurn({
      matchId: "M2",
      turn: 0,
      agentRecords: [makeAgentRecord({ characterId: "c1" })],
      resolution: { moves: [], actions: [], speech: [] },
    });
    const out = computePhase3Metrics([
      {
        matchId: "M1",
        turns: [killTurn],
        characters: [makeChar("c0", "Player_1")],
      },
      {
        matchId: "M2",
        turns: [noKillTurn],
        characters: [makeChar("c1", "Player_1")],
      },
    ]);
    expect(out.runsWithKill).toBe(1);
    expect(out.killRate).toBe(0.5);
    expect(out.meetsKillThreshold).toBe(false); // threshold ≥ 80%
  });

  it("counts runs with ≥ 1 chest equip (kind=loot result=opened target=chest_*)", () => {
    const equipTurn = makeTurn({
      matchId: "M1",
      turn: 0,
      agentRecords: [makeAgentRecord({ characterId: "c0" })],
      resolution: {
        moves: [],
        actions: [
          {
            characterId: "c0",
            kind: "loot",
            target: "chest_005",
            result: "opened",
          },
        ],
        speech: [],
      },
    });
    const out = computePhase3Metrics([
      {
        matchId: "M1",
        turns: [equipTurn],
        characters: [makeChar("c0", "Player_1")],
      },
    ]);
    expect(out.runsWithEquip).toBe(1);
    expect(out.equipRate).toBe(1);
    expect(out.meetsEquipThreshold).toBe(true);
  });

  it("counts runs with ≥ 1 speech event", () => {
    const speechTurn = makeTurn({
      matchId: "M1",
      turn: 0,
      agentRecords: [makeAgentRecord({ characterId: "c0" })],
      resolution: {
        moves: [],
        actions: [],
        speech: [{ characterId: "c0", text: "hello" }],
      },
    });
    const noSpeechTurn = makeTurn({
      matchId: "M2",
      turn: 0,
      agentRecords: [makeAgentRecord({ characterId: "c1" })],
      resolution: { moves: [], actions: [], speech: [] },
    });
    const out = computePhase3Metrics([
      {
        matchId: "M1",
        turns: [speechTurn],
        characters: [makeChar("c0", "Player_1")],
      },
      {
        matchId: "M2",
        turns: [noSpeechTurn],
        characters: [makeChar("c1", "Player_1")],
      },
    ]);
    expect(out.runsWithSpeech).toBe(1);
    expect(out.speechRate).toBe(0.5);
    expect(out.meetsSpeechThreshold).toBe(true); // threshold ≥ 50% (boundary, PASS)
  });

  it("computes persona extraction-rate spread in percentage points", () => {
    // 4 runs: rat extracts in 1, vulture extracts in 4 → 25% vs 100%
    // → spread = 75pp.
    const runs: Phase3RunInput[] = [];
    for (let i = 0; i < 4; i++) {
      runs.push({
        matchId: `M${i}`,
        turns: [
          makeTurn({
            matchId: `M${i}`,
            turn: 0,
            agentRecords: [makeAgentRecord({ characterId: `c${i}` })],
          }),
        ],
        characters: [
          makeChar(`c${i}-rat`, "Player_1", "rat", i === 0),
          makeChar(`c${i}-vulture`, "Player_2", "vulture", true),
        ],
      });
    }
    const out = computePhase3Metrics(runs);
    expect(out.runCount).toBe(4);
    const ratRate = out.perPersona.find((p) => p.personaId === "rat")!.extractionRate;
    const vultureRate = out.perPersona.find((p) => p.personaId === "vulture")!.extractionRate;
    expect(ratRate).toBeCloseTo(0.25);
    expect(vultureRate).toBeCloseTo(1);
    // Spread = max - min across ALL 8 personas. Rat=25%, vulture=100%,
    // every other persona=0% (no character of that persona extracted in
    // any run). So min=0, max=100, spread=100pp. Even if every persona
    // had a character per run — the perPersona accumulator only credits
    // a persona if AT LEAST ONE of its characters extracted in that
    // run; absent personas stay at 0%. The per-run characters[] array
    // here only contains rat + vulture, so the other 6 are 0%.
    expect(out.personaExtractionSpread).toBeCloseTo(100);
    expect(out.meetsPersonaSpreadThreshold).toBe(true);
  });
});

describe("computePhase3Metrics — composite gate", () => {
  it("meetsAllThresholds is FALSE when any single phase-3 metric fails", () => {
    // Construct a 'mostly green' run but with one fatal: 1 wall-blocked
    // out of 1 move (100% rate) → meetsWallBlockedThreshold=false.
    const t = makeTurn({
      matchId: "M1",
      turn: 0,
      agentRecords: [makeAgentRecord({ characterId: "c0" })],
      resolution: {
        moves: [{ characterId: "c0", blockedBy: "wall" }],
        actions: [],
        speech: [],
      },
    });
    const out = computePhase3Metrics([
      {
        matchId: "M1",
        turns: [t],
        characters: [makeChar("c0", "Player_1", "rat", true)],
      },
    ]);
    expect(out.meetsWallBlockedThreshold).toBe(false);
    expect(out.meetsAllThresholds).toBe(false);
  });
});
