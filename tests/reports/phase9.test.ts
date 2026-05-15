import { describe, expect, it } from "vitest";
import type { ParsedDecision, PersonaId, Wall } from "../../convex/engine/types.js";
import {
  computePhase9Metrics,
  type Phase9RunInput,
  type Phase9WorldStateEvidence,
} from "../../convex/reports/phase9.js";
import { runPhase9ClosingCli } from "../../harness/closing/phase9.js";
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
      chests: 0,
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

function world(
  overrides: Partial<Phase9WorldStateEvidence> = {},
): Phase9WorldStateEvidence {
  return {
    walls: overrides.walls ?? [],
    coverClusters: overrides.coverClusters ?? [],
    coverTiles: overrides.coverTiles ?? [],
    evac: overrides.evac ?? {
      centre: { x: 30, y: 30 },
      revealedAtTurn: 30,
    },
  };
}

function runInput(overrides: Partial<Phase9RunInput> = {}): Phase9RunInput {
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
    worldState: overrides.worldState ?? world(),
  };
}

function rowWithRecord(agent: SlimAgentRecord): SlimTurnRow {
  return turn({ turn: 1, agentRecords: [agent] });
}

function wallKey(rect: Wall): string {
  const x2 = rect.x + rect.w - 1;
  const y2 = rect.y + rect.h - 1;
  return rect.w === 1 && rect.h === 1
    ? `Wall_${rect.x}_${rect.y}`
    : `Wall_${rect.x}_${rect.y}_to_${x2}_${y2}`;
}

function slideRows(count: number): SlimTurnRow[] {
  return Array.from({ length: count }, (_, index) => {
    const personaId = PERSONAS[index % PERSONAS.length]!;
    const characterId = `char-${personaId}-${index}`;
    return turn({
      turn: index + 1,
      resolution: {
        consumed: [],
        speech: [],
        moves: [
          {
            characterId,
            from: { x: 5, y: 5 },
            to: { x: 6, y: 5 },
            slide: {
              wallRectId: "Wall_6_4",
              axis: "E",
              intent: index % 2 === 0 ? "NE" : "toward Duelist",
            },
          },
        ],
        actions: [],
        deaths: [],
        visibilityUpdates: [],
      },
      agentRecords: [
        record({
          characterId,
          personaId,
          decision: {
            ...NONE_DECISION,
            position: {
              kind: "move",
              direction: index % 2 === 0 ? { kind: "NE" } : { kind: "toward", targetId: "Duelist" },
              dist: 1,
            },
          },
        }),
      ],
    });
  });
}

function compassRows(): SlimTurnRow[] {
  const compass = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
  return [
    turn({
      turn: 101,
      agentRecords: [
        ...compass.map((direction) =>
          record({
            characterId: `compass-${direction}`,
            decision: {
              ...NONE_DECISION,
              position: {
                kind: "move",
                direction: { kind: direction },
                dist: 1,
              },
            },
          }),
        ),
        record({
          characterId: "toward",
          decision: {
            ...NONE_DECISION,
            position: {
              kind: "move",
              direction: { kind: "toward", targetId: "Wall_1_1" },
              dist: 1,
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
              dist: 1,
            },
          },
        }),
      ],
    }),
  ];
}

describe("computePhase9Metrics", () => {
  it("counts rendered rect keys and inside bearing:here evidence", () => {
    const out = computePhase9Metrics([
      runInput({
        turns: [
          rowWithRecord(
            record({
              characterId: "observer",
              visibleRectKeys: [
                "Wall_10_10_to_12_10",
                "Cover_20_20_to_22_22",
                "Evac_29_29_to_31_31",
              ],
              insideBearingHere: true,
            }),
          ),
        ],
      }),
    ]);

    expect(out.wallRectKeyCount).toBe(1);
    expect(out.coverRectKeyCount).toBe(1);
    expect(out.evacRectKeyCount).toBe(1);
    expect(out.insideBearingHereCount).toBe(1);
    expect(out.meetsWallRectKeyThreshold).toBe(true);
    expect(out.meetsCoverRectKeyThreshold).toBe(true);
    expect(out.meetsEvacRectKeyThreshold).toBe(true);
    expect(out.meetsInsideBearingHereThreshold).toBe(true);
  });

  it("flags single-tile terrain keys when the matching world rect is multi-tile", () => {
    const out = computePhase9Metrics([
      runInput({
        worldState: world({
          walls: [{ x: 10, y: 10, w: 3, h: 1 }],
          coverClusters: [{ x: 20, y: 20, w: 2, h: 2 }],
          coverTiles: [
            { x: 20, y: 20 },
            { x: 21, y: 20 },
            { x: 20, y: 21 },
            { x: 21, y: 21 },
          ],
        }),
        turns: [
          rowWithRecord(
            record({
              characterId: "observer",
              visibleRectKeys: ["Wall_10_10", "Cover_21_21"],
            }),
          ),
        ],
      }),
    ]);

    expect(out.singleTileKeyForMultiTileRectCount).toBe(2);
    expect(out.meetsSingleTileKeyDisciplineThreshold).toBe(false);
  });

  it("counts slide outcomes and attributes them by persona", () => {
    const out = computePhase9Metrics([
      runInput({
        turns: slideRows(3),
      }),
    ]);

    expect(out.slideOutcomeCount).toBe(3);
    expect(out.slideOutcomePerPersona).toEqual(
      expect.arrayContaining([
        { personaId: "rat", count: 1 },
        { personaId: "duelist", count: 1 },
        { personaId: "trader", count: 1 },
      ]),
    );
    expect(out.meetsSlideOutcomeThreshold).toBe(false);
  });

  it("detects a wall-in-range that is hidden by another wall", () => {
    const occluder = { x: 2, y: 0, w: 1, h: 1 };
    const hidden = { x: 4, y: 0, w: 1, h: 1 };
    const out = computePhase9Metrics([
      runInput({
        worldState: world({ walls: [occluder, hidden] }),
        turns: [
          rowWithRecord(
            record({
              characterId: "observer",
              observerPos: { x: 0, y: 0 },
              visibleRectKeys: [wallKey(occluder)],
            }),
          ),
        ],
      }),
    ]);

    expect(out.wallOnWallOcclusionCount).toBe(1);
    expect(out.meetsWallOnWallOcclusionThreshold).toBe(true);
  });

  it("counts revealed evac seen from outside Chebyshev 20", () => {
    const out = computePhase9Metrics([
      runInput({
        worldState: world({
          evac: { centre: { x: 30, y: 30 }, revealedAtTurn: 30 },
        }),
        turns: [
          rowWithRecord(
            record({
              characterId: "observer",
              observerPos: { x: 0, y: 0 },
              visibleRectKeys: ["Evac_29_29_to_31_31"],
            }),
          ),
        ],
      }),
    ]);

    expect(out.evacOutOfChebyshev20Count).toBe(1);
    expect(out.meetsEvacOutOfChebyshev20Threshold).toBe(true);
  });

  it("rolls all preserved and phase-9 thresholds into meetsAllThresholds", () => {
    const occluder = { x: 2, y: 0, w: 1, h: 1 };
    const hidden = { x: 4, y: 0, w: 1, h: 1 };
    const out = computePhase9Metrics([
      runInput({
        worldState: world({ walls: [occluder, hidden] }),
        turns: [
          ...slideRows(20),
          ...compassRows(),
          rowWithRecord(
            record({
              characterId: "observer",
              observerPos: { x: 0, y: 0 },
              visibleRectKeys: [
                wallKey(occluder),
                "Wall_10_10_to_12_10",
                "Cover_20_20_to_22_22",
                "Evac_29_29_to_31_31",
              ],
              insideBearingHere: true,
            }),
          ),
        ],
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
    expect(out.allEightCompassBearingsExercised).toBe(true);
    expect(out.targetRelativeTowardExercised).toBe(true);
    expect(out.targetRelativeAwayExercised).toBe(true);
    expect(out.meetsAllThresholds).toBe(true);
  });
});

describe("phase9 closing terrain read", () => {
  it("preserves merged static terrain from worldState.byMatchId", async () => {
    const wall = { x: 10, y: 10, w: 3, h: 1 };
    const cover = { x: 20, y: 20, w: 2, h: 2 };
    const result = await runPhase9ClosingCli(["--matchIds", "M1"], {
      client: {
        query: async () => {
          throw new Error("unexpected query");
        },
        mutation: async () => {
          throw new Error("unexpected mutation");
        },
      },
      fetchSlimAcross: async () => [
        [
          rowWithRecord(
            record({
              characterId: "observer",
              visibleRectKeys: [
                "Wall_10_10_to_12_10",
                "Cover_20_20_to_21_21",
              ],
            }),
          ),
        ],
      ],
      readRunByMatch: async () => ({
        matchId: "M1",
        kills: 1,
        extractions: 1,
        equips: 1,
        speechEvents: 1,
        perPersona: [{ personaId: "duelist", extracted: 1 }],
      }),
      readMatchStatus: async () => ({
        status: "completed",
        turn: 50,
        completedAt: 123,
      }),
      readWorldStateByMatch: async () => ({
        walls: [wall],
        coverClusters: [cover],
        coverTiles: [
          { x: 20, y: 20 },
          { x: 21, y: 20 },
          { x: 20, y: 21 },
          { x: 21, y: 21 },
        ],
        evac: { centre: { x: 30, y: 30 }, revealedAtTurn: 30 },
      }),
      persistReport: async (_client, args) => ({
        _id: "report-1",
        existed: false,
        payload: args.payload,
      }),
      writeStdout: () => {},
    });

    expect(result.payload?.wallRectKeyCount).toBe(1);
    expect(result.payload?.coverRectKeyCount).toBe(1);
  });

  it("fails loudly when the merged worldState is missing static terrain", async () => {
    await expect(
      runPhase9ClosingCli(["--matchIds", "M1"], {
        client: {
          query: async () => {
            throw new Error("unexpected query");
          },
          mutation: async () => {
            throw new Error("unexpected mutation");
          },
        },
        fetchSlimAcross: async () => [[]],
        readRunByMatch: async () => null,
        readMatchStatus: async () => ({
          status: "completed",
          turn: 50,
          completedAt: 123,
        }),
        readWorldStateByMatch: async () =>
          ({
            walls: [],
            coverClusters: [],
            evac: { centre: { x: 30, y: 30 }, revealedAtTurn: 30 },
          }) as never,
        persistReport: async (_client, args) => ({
          _id: "report-1",
          existed: false,
          payload: args.payload,
        }),
        writeStdout: () => {},
      }),
    ).rejects.toThrow("Missing static terrain in worldState row for match M1");
  });
});
