import { describe, expect, it } from "vitest";
import type { ParsedDecision } from "../../convex/engine/types.js";
import {
  computePhase7Metrics,
  type Phase7RunInput,
} from "../../convex/reports/phase7.js";
import type {
  SlimAgentRecord,
  SlimTurnRow,
} from "../../harness/diagnostics/types.js";

const NONE_DECISION: ParsedDecision = {
  use: null,
  position: { kind: "move", direction: { kind: "N" }, dist: 1 },
  action: { kind: "none" },
  say: null,
  scratchpad: null,
};

function damageAudit(
  overrides: Partial<SlimAgentRecord["damageFeedAudit"]>,
): SlimAgentRecord["damageFeedAudit"] {
  return {
    incoming: 0,
    outgoing: 0,
    dealtKills: 0,
    ...overrides,
  } as SlimAgentRecord["damageFeedAudit"];
}

function record(
  overrides: Partial<SlimAgentRecord> & { characterId: string },
): SlimAgentRecord {
  return {
    characterId: overrides.characterId,
    personaId: overrides.personaId ?? "duelist",
    decision: overrides.decision ?? NONE_DECISION,
    scratchpadAfter: overrides.scratchpadAfter ?? "",
    scratchpadChanged: overrides.scratchpadChanged ?? false,
    visibleSummary: overrides.visibleSummary ?? {
      enemies: 0,
      crates: 0,
      corpses: 0,
      evacSeen: false,
    },
    visibleRectKeys: overrides.visibleRectKeys ?? [],
    insideBearingHere: overrides.insideBearingHere ?? false,
    observerPos: overrides.observerPos ?? { x: 0, y: 0 },
    selfEquipment: overrides.selfEquipment ?? {
      weapon: "sword",
      armour: null,
    },
    damageFeedAudit: overrides.damageFeedAudit ?? {
      incoming: 0,
      outgoing: 0,
      dealtKills: 0,
    },
    inboundSpeechCount: overrides.inboundSpeechCount ?? 0,
    lootOutcomeFeed: overrides.lootOutcomeFeed ?? [],
    input: overrides.input ?? {
      systemPromptHash: "system",
      personaPromptHash: "persona",
      useVariant: "consumable_or_null",
    },
    llm: overrides.llm ?? {
      responseId: "response",
      callId: "call",
      usage: { output_tokens: 320 },
      latencyMs: 20,
      httpStatus: 200,
      fellBackToSafeDefault: false,
    },
  };
}

function turn(
  overrides: Partial<SlimTurnRow> & { turn: number },
): SlimTurnRow {
  return {
    _id: `turn-${overrides.turn}`,
    matchId: overrides.matchId ?? "M1",
    turn: overrides.turn,
    resolution: overrides.resolution ?? {
      consumed: [],
      speech: [],
      moves: [],
      actions: [],
      deaths: [],
      visibilityUpdates: [],
    },
    agentRecords: overrides.agentRecords ?? [],
  };
}

function runInput(overrides: Partial<Phase7RunInput>): Phase7RunInput {
  return {
    matchId: overrides.matchId ?? "M1",
    failed: overrides.failed ?? false,
    run:
      overrides.run ??
      {
        extractions: 1,
        kills: 1,
        equips: 1,
        speechEvents: 1,
        perPersona: [
          { personaId: "duelist", extracted: 1 },
          { personaId: "rat", extracted: 0 },
        ],
      },
    turns: overrides.turns ?? [],
  };
}

function passingRows(): SlimTurnRow[] {
  const agentRecords: SlimAgentRecord[] = [];
  const actions: SlimTurnRow["resolution"]["actions"] = [];

  for (let i = 0; i < 10; i += 1) {
    agentRecords.push(
      record({
        characterId: `combo-${i}`,
        decision: {
          ...NONE_DECISION,
          position: { kind: "overwatch" },
          action: { kind: "attack", targetId: "Trader" },
        },
      }),
    );
    actions.push({
      characterId: `combo-${i}`,
      kind: "attack",
      target: "Trader",
      result: "dmg 5",
    });
  }

  for (let i = 0; i < 5; i += 1) {
    actions.push({
      characterId: `overwatch-${i}`,
      kind: "overwatch",
      target: "Sprinter",
      result: "dmg 4",
      triggeredByMovement: true,
    });
    actions.push({
      characterId: `counter-${i}`,
      kind: "counter",
      target: "Rat",
      result: "dmg 3",
    });
  }

  for (const direction of ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]) {
    agentRecords.push(
      record({
        characterId: `move-${direction}`,
        decision: {
          ...NONE_DECISION,
          position: { kind: "move", direction: { kind: direction }, dist: 1 },
        } as ParsedDecision,
      }),
    );
  }

  agentRecords.push(
    record({
      characterId: "toward",
      decision: {
        ...NONE_DECISION,
        position: {
          kind: "move",
          direction: { kind: "toward", targetId: "Evac" },
          dist: 2,
        },
      },
    }),
    record({
      characterId: "away",
      decision: {
        ...NONE_DECISION,
        position: {
          kind: "move",
          direction: { kind: "away", targetId: "Duelist" },
          dist: 2,
        },
      },
    }),
    record({
      characterId: "armed-pause",
      decision: {
        ...NONE_DECISION,
        position: { kind: "counter" },
        action: { kind: "none" },
      },
      inboundSpeechCount: 1,
      damageFeedAudit: damageAudit({
        incoming: 1,
        expectedIncoming: 1,
        missingIncoming: 0,
      }),
      llm: {
        responseId: "retry-ok",
        callId: "call-retry-ok",
        usage: { output_tokens: 400 },
        latencyMs: 30,
        httpStatus: 200,
        fellBackToSafeDefault: false,
        retried: true,
      },
    }),
    record({
      characterId: "true-stationary",
      decision: {
        ...NONE_DECISION,
        position: { kind: "move", direction: { kind: "N" }, dist: 0 },
        action: { kind: "none" },
      },
      llm: {
        responseId: null,
        callId: "call-retry-fail",
        usage: { output_tokens: 1180 },
        latencyMs: 30,
        httpStatus: 500,
        fellBackToSafeDefault: true,
        failureReason: "http_non_200",
        retried: true,
      },
    }),
    record({
      characterId: "named-loot",
      decision: {
        ...NONE_DECISION,
        action: { kind: "loot", targetId: "Chest_10_20" },
      },
      lootOutcomeFeed: [{ result: "opened", item: "speed" }],
    }),
    record({
      characterId: "empty-loot",
      decision: {
        ...NONE_DECISION,
        action: { kind: "loot", targetId: "Chest_11_20" },
      },
      lootOutcomeFeed: [{ result: "already_opened" }],
    }),
  );

  return [
    turn({
      turn: 12,
      agentRecords,
      resolution: {
        consumed: [],
        speech: [
          {
            characterId: "trader-id",
            text: "peace nearby",
            heardBy: ["armed-pause"],
          },
        ],
        moves: [],
        actions,
        deaths: [],
        visibilityUpdates: [],
      },
    }),
  ];
}

describe("computePhase7Metrics", () => {
  it("preserves comparable phase-6 gates while reporting the no-op split as data", () => {
    const out = computePhase7Metrics([
      runInput({ matchId: "M1", turns: passingRows() }),
      runInput({ matchId: "M2", turns: passingRows() }),
    ]);

    expect(out.reportType).toBe("phase-7-closing-20");
    expect(out.meetsAllThresholds).toBe(true);
    expect(out).not.toHaveProperty("meetsNoOpThreshold");
    expect(out.armedStancePauseCount).toBe(2);
    expect(out.trueStationaryCount).toBe(2);
    expect(out.armedStancePauseRate).toBeGreaterThan(0);
    expect(out.trueStationaryRate).toBeGreaterThan(0);
    expect(out.retryRecoveryRate).toBe(0.5);
    expect(Number.isNaN(out.retryRecoveryRate)).toBe(false);
    expect(out.damageFeedAuditScopeNote).toContain(
      "before heavy text is stripped",
    );
    expect(out.damageFeedAuditScopeNote).not.toContain("does not re-read");
  });

  it("computes the phase-7 substrate gates from slim rows", () => {
    const out = computePhase7Metrics([
      runInput({
        turns: [
          turn({
            turn: 1,
            agentRecords: [
              record({
                characterId: "silent",
                inboundSpeechCount: 0,
              }),
              record({
                characterId: "unnamed-loot",
                decision: {
                  ...NONE_DECISION,
                  // Intentional legacy chest literal negative fixture: keep this non-coordinate to exercise the detector.
                  action: { kind: "loot", targetId: "chest_007" },
                },
                lootOutcomeFeed: [{ result: "opened" }],
              }),
              record({
                characterId: "unmarked-empty",
                decision: {
                  ...NONE_DECISION,
                  action: { kind: "loot", targetId: "Corpse_Duelist" },
                },
                lootOutcomeFeed: [{ result: "out_of_range" }],
              }),
              record({
                characterId: "missing-loot-feed",
                decision: {
                  ...NONE_DECISION,
                  action: { kind: "loot", targetId: "Chest_53_54" },
                },
                lootOutcomeFeed: [
                  { result: "opened", item: "speed", delivered: false },
                  { result: "already_opened", delivered: false },
                ],
              }),
            ],
            resolution: {
              consumed: [],
              speech: [],
              moves: [],
              actions: [
                {
                  characterId: "unnamed-loot",
                  kind: "loot",
                  // Intentional legacy chest literal negative fixture: keep this non-coordinate to exercise the detector.
                  target: "chest_007",
                  result: "opened",
                },
              ],
              deaths: [],
              visibilityUpdates: [],
            },
          }),
        ],
      }),
    ]);

    expect(out.inboundSpeechDelivered).toBe(0);
    expect(out.meetsInboundSpeechThreshold).toBe(false);
    expect(out.lootSuccesses).toBe(2);
    expect(out.lootSuccessesNamed).toBe(0);
    expect(out.lootSuccessNamingRate).toBe(0);
    expect(out.meetsLootSuccessNamingThreshold).toBe(false);
    expect(out.lootFailureOutcomes).toBe(2);
    expect(out.lootFailuresMarkedEmpty).toBe(0);
    expect(out.lootEmptyMarkingRate).toBe(0);
    expect(out.meetsLootEmptyMarkingThreshold).toBe(false);
    expect(out.legacyChestLiteralCount).toBe(2);
    expect(out.meetsChestLiteralThreshold).toBe(false);
    expect(Number.isNaN(out.retryRecoveryRate)).toBe(false);
  });

  it("uses slim damage-feed delivery counters for the phase-7 threshold", () => {
    const delivered = computePhase7Metrics([
      runInput({
        turns: [
          turn({
            turn: 1,
            agentRecords: [
              record({
                characterId: "delivered-feed",
                damageFeedAudit: damageAudit({
                  incoming: 1,
                  expectedIncoming: 1,
                  missingIncoming: 0,
                }),
              }),
            ],
          }),
        ],
      }),
    ]);

    expect(delivered.damageFeedEvents).toBe(1);
    expect(delivered.damageFeedMissing).toBe(0);
    expect(delivered.meetsDamageFeedThreshold).toBe(true);

    const missing = computePhase7Metrics([
      runInput({
        turns: [
          turn({
            turn: 1,
            agentRecords: [
              record({
                characterId: "missing-feed",
                damageFeedAudit: damageAudit({
                  incoming: 0,
                  expectedIncoming: 1,
                  missingIncoming: 1,
                }),
              }),
            ],
          }),
        ],
      }),
    ]);

    expect(missing.damageFeedEvents).toBe(1);
    expect(missing.damageFeedMissing).toBe(1);
    expect(missing.meetsDamageFeedThreshold).toBe(false);
  });
});
