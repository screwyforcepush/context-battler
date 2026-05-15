import { describe, expect, it } from "vitest";
import type { ParsedDecision, PersonaId } from "../../convex/engine/types.js";
import {
  computePhase10Metrics,
  type Phase10RunInput,
} from "../../convex/reports/phase10.js";
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

const PERSONAS: PersonaId[] = [
  "rat",
  "duelist",
  "trader",
  "opportunist",
  "paranoid",
  "camper",
  "sprinter",
  "vulture",
];

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

function turn(overrides: Partial<SlimTurnRow> & { turn: number }): SlimTurnRow {
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

function runInput(overrides: Partial<Phase10RunInput> = {}): Phase10RunInput {
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

function chargeTurn(
  index: number,
  overrides: {
    chargerId?: string;
    defenderId?: string;
    chargerPersona?: PersonaId;
    defenderPersona?: PersonaId;
    from?: { x: number; y: number };
    to?: { x: number; y: number };
    actions?: SlimTurnRow["resolution"]["actions"];
    deaths?: string[];
  } = {},
): SlimTurnRow {
  const chargerId = overrides.chargerId ?? `charger-${index}`;
  const defenderId = overrides.defenderId ?? `defender-${index}`;
  return turn({
    turn: index,
    agentRecords: [
      record({
        characterId: chargerId,
        personaId: overrides.chargerPersona ?? PERSONAS[index % PERSONAS.length]!,
      }),
      record({
        characterId: defenderId,
        personaId: overrides.defenderPersona ?? "camper",
      }),
    ],
    resolution: {
      consumed: [],
      speech: [],
      moves: [
        {
          characterId: chargerId,
          from: overrides.from ?? { x: 5, y: 5 },
          to: overrides.to ?? { x: 5, y: 5 },
          bodyCollision: {
            kind: "character",
            defenderId,
          },
        },
      ],
      actions: overrides.actions ?? [],
      deaths: overrides.deaths ?? [],
      visibilityUpdates: [],
    },
  });
}

function passingEvidenceRows(): SlimTurnRow[] {
  return [
    ...Array.from({ length: 10 }, (_, index) => chargeTurn(index + 1)),
    ...Array.from({ length: 3 }, (_, index) =>
      chargeTurn(20 + index, {
        chargerId: `counter-target-${index}`,
        defenderId: `counter-defender-${index}`,
        actions: [
          {
            characterId: `counter-defender-${index}`,
            kind: "counter",
            target: `counter-target-${index}`,
            result: "dmg 3",
          },
        ],
      }),
    ),
    turn({
      turn: 40,
      resolution: {
        consumed: [],
        speech: [],
        moves: Array.from({ length: 5 }, (_, index) => ({
          characterId: `wall-bumper-${index}`,
          from: { x: 1 + index, y: 1 },
          to: index === 0 ? { x: 2 + index, y: 1 } : { x: 1 + index, y: 1 },
          bodyCollision: {
            kind: "wall",
            wallRectId: "Wall_5_1",
          },
        })),
        actions: [],
        deaths: [],
        visibilityUpdates: [],
      },
      agentRecords: Array.from({ length: 5 }, (_, index) =>
        record({
          characterId: `wall-bumper-${index}`,
          personaId: PERSONAS[index % PERSONAS.length]!,
        }),
      ),
    }),
  ];
}

describe("computePhase10Metrics", () => {
  it("counts character body-collision charge events", () => {
    const out = computePhase10Metrics([
      runInput({
        turns: [chargeTurn(1, { chargerPersona: "rat" })],
      }),
    ]);

    expect(out.chargeEventCount).toBe(1);
    expect(out.chargeEventPerPersona).toEqual(
      expect.arrayContaining([{ personaId: "rat", count: 1 }]),
    );
    expect(out.meetsChargeEventThreshold).toBe(false);
  });

  it("deduplicates bilateral charge pairs while preserving both charge events", () => {
    const out = computePhase10Metrics([
      runInput({
        turns: [
          turn({
            turn: 1,
            agentRecords: [
              record({ characterId: "A", personaId: "duelist" }),
              record({ characterId: "B", personaId: "trader" }),
            ],
            resolution: {
              consumed: [],
              speech: [],
              moves: [
                {
                  characterId: "A",
                  from: { x: 1, y: 1 },
                  to: { x: 1, y: 1 },
                  bodyCollision: { kind: "character", defenderId: "B" },
                },
                {
                  characterId: "B",
                  from: { x: 2, y: 1 },
                  to: { x: 2, y: 1 },
                  bodyCollision: { kind: "character", defenderId: "A" },
                },
              ],
              actions: [],
              deaths: [],
              visibilityUpdates: [],
            },
          }),
        ],
      }),
    ]);

    expect(out.chargeEventCount).toBe(2);
    expect(out.bilateralChargeCount).toBe(1);
  });

  it("counts counter actions fired by defenders against same-turn chargers", () => {
    const out = computePhase10Metrics([
      runInput({
        turns: [
          chargeTurn(1, {
            chargerId: "charger-1",
            defenderId: "defender-1",
            actions: [
              {
                characterId: "defender-1",
                kind: "counter",
                target: "charger-1",
                result: "dmg 3",
              },
            ],
          }),
          chargeTurn(2, {
            chargerId: "duelist-id",
            defenderId: "defender-2",
            chargerPersona: "duelist",
            actions: [
              {
                characterId: "defender-2",
                kind: "counter",
                target: "Duelist",
                result: "dmg 3",
              },
            ],
          }),
        ],
      }),
    ]);

    expect(out.chargeCounterFireCount).toBe(2);
    expect(out.meetsChargeCounterFireThreshold).toBe(false);
  });

  it("counts wall-bump self damage and partial-distance wall bumps", () => {
    const out = computePhase10Metrics([
      runInput({
        turns: [
          turn({
            turn: 1,
            resolution: {
              consumed: [],
              speech: [],
              moves: [
                {
                  characterId: "dead-stop",
                  from: { x: 10, y: 10 },
                  to: { x: 10, y: 10 },
                  bodyCollision: {
                    kind: "wall",
                    wallRectId: "Wall_11_10",
                  },
                },
                {
                  characterId: "partial",
                  from: { x: 1, y: 1 },
                  to: { x: 3, y: 1 },
                  bodyCollision: {
                    kind: "wall",
                    wallRectId: "Wall_4_1",
                  },
                },
              ],
              actions: [],
              deaths: [],
              visibilityUpdates: [],
            },
          }),
        ],
      }),
    ]);

    expect(out.wallBumpSelfDamageCount).toBe(2);
    expect(out.partialDistanceWallBumpCount).toBe(1);
    expect(out.meetsWallBumpSelfDamageThreshold).toBe(false);
    expect(out.meetsPartialDistanceWallBumpThreshold).toBe(true);
  });

  it("rolls preserved phase-7 gates and phase-10 evidence thresholds into meetsAllThresholds", () => {
    const out = computePhase10Metrics([
      runInput({
        turns: passingEvidenceRows(),
      }),
    ]);

    expect(out.extractionRate).toBe(1);
    expect(out.killRate).toBe(1);
    expect(out.equipRate).toBe(1);
    expect(out.speechRate).toBe(1);
    expect(out.personaSpread).toBe(100);
    expect(out.zeroCrashes).toBe(true);
    expect(out.zeroIllegalConsumableUse).toBe(true);
    expect(out.zeroPlayerNLiterals).toBe(true);
    expect(out.zeroWholeTurnValidatorZeroes).toBe(true);
    expect(out.perFieldRejectionRate).toBe(0);
    expect(out.chargeEventCount).toBeGreaterThanOrEqual(10);
    expect(out.chargeCounterFireCount).toBeGreaterThanOrEqual(3);
    expect(out.wallBumpSelfDamageCount).toBeGreaterThanOrEqual(5);
    expect(out.partialDistanceWallBumpCount).toBeGreaterThanOrEqual(1);
    expect(out.meetsAllThresholds).toBe(true);
  });
});
