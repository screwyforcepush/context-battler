import { describe, expect, it } from "vitest";
import {
  PERSONA_IDS,
  type ParsedDecision,
  type PersonaId,
} from "../../convex/engine/types.js";
import {
  computePhase12Metrics,
  type Phase12RunInput,
} from "../../convex/reports/phase12.js";
import { runPhase12ClosingCli } from "../../harness/closing/phase12.js";
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

const AIRDROPS = [
  { id: "Crate_50_50", landsAtTurn: 10 },
  { id: "Crate_25_75", landsAtTurn: 20 },
  { id: "Crate_75_25", landsAtTurn: 30 },
  { id: "Crate_48_48", landsAtTurn: 40 },
] as const;

type PerPersonaRunRow = NonNullable<
  Phase12RunInput["run"]
>["perPersona"][number];

function perPersonaKills(
  overrides: Partial<Record<PersonaId, number>> = {},
): PerPersonaRunRow[] {
  return PERSONA_IDS.map((personaId) => ({
    personaId,
    kills: overrides[personaId] ?? 1,
    extracted: personaId === "duelist" ? 1 : 0,
  }));
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
    airdropVision: overrides.airdropVision,
    airdropVisionSummary: overrides.airdropVisionSummary,
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
      environmentalDeaths: [],
      visibilityUpdates: [],
    },
    agentRecords: overrides.agentRecords ?? [],
  };
}

function airdropVisionRows(): SlimTurnRow[] {
  const rows: SlimTurnRow[] = [];
  for (const drop of AIRDROPS) {
    for (const countdown of [3, 2, 1, 0] as const) {
      rows.push(
        turn({
          turn: drop.landsAtTurn - countdown,
          agentRecords: [
            record({
              characterId: `spotter-${drop.id}-${countdown}`,
              airdropVision: {
                telegraphed: 1,
                landed: 0,
                telegraphedIds: [drop.id],
                landedIds: [],
                telegraphedEvents: [{ id: drop.id, countdown }],
              },
            }),
          ],
        }),
      );
    }
    rows.push(
      turn({
        turn: drop.landsAtTurn + 1,
        resolution:
          drop.id === "Crate_50_50"
            ? {
                consumed: [],
                speech: [],
                moves: [],
                actions: [
                  {
                    characterId: "c_duelist",
                    kind: "loot",
                    target: drop.id,
                    result: "opened",
                    lootedItem: "leather",
                  },
                ],
                deaths: [],
                environmentalDeaths: [],
                visibilityUpdates: [],
              }
            : undefined,
        agentRecords: [
          record({
            characterId: `landed-${drop.id}`,
            airdropVision: {
              telegraphed: 0,
              landed: 1,
              telegraphedIds: [],
              landedIds: [drop.id],
            },
          }),
        ],
      }),
    );
  }
  return rows;
}

function runInput(overrides: Partial<Phase12RunInput> = {}): Phase12RunInput {
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
        perPersona: perPersonaKills(),
      },
    turns:
      overrides.turns ??
      [
        ...airdropVisionRows(),
        turn({
          turn: 10,
          resolution: {
            consumed: [],
            speech: [],
            moves: [],
            actions: [],
            deaths: [],
            environmentalDeaths: ["char-rat"],
            visibilityUpdates: [],
          },
          agentRecords: [
            record({
              characterId: "char-rat",
              personaId: "rat",
            }),
          ],
        }),
      ],
  };
}

describe("computePhase12Metrics", () => {
  it("rolls preserved thresholds and phase-12 slice gates into the payload", () => {
    const out = computePhase12Metrics([runInput()]);

    expect(out.reportType).toBe("phase-12-closing-20");
    expect(out.extractionRate).toBe(1);
    expect(out.killRate).toBe(1);
    expect(out.equipRate).toBe(1);
    expect(out.speechRate).toBe(1);
    expect(out.personaSpread).toBe(100);
    expect(out.zeroCrashes).toBe(true);
    expect(out.environmentalDeaths).toBe(1);
    expect(out.telefragKillFeedLines).toEqual([
      "Rat got telefragged by crate spawn",
    ]);
    expect(out.airdropCountdowns).toHaveLength(4);
    expect(out.airdropCountdowns[0]).toMatchObject({
      id: "Crate_50_50",
      countdown3: 1,
      countdown2: 1,
      countdown1: 1,
      countdown0: 1,
    });
    expect(out.airdropLootedSpent).toBe(1);
    expect(out.perPersonaKillTotal).toBe(PERSONA_IDS.length);
    expect(out.perPersonaKills).toEqual(
      PERSONA_IDS.map((personaId) => ({ personaId, kills: 1 })),
    );
    expect(out.referenceCrateCount).toBe(12);
    expect(out.referenceAirdropCount).toBe(4);
    expect(out.deterministicCratesAcrossSeeds).toBe(true);
    expect(out.deterministicAirdropsAcrossSeeds).toBe(true);
    expect(out.meetsTelefragThreshold).toBe(true);
    expect(out.meetsAirdropCountdownThreshold).toBe(true);
    expect(out.meetsAirdropLifecycleThreshold).toBe(true);
    expect(out.meetsPerPersonaKillAttributionThreshold).toBe(true);
    expect(out.meetsDeterminismThreshold).toBe(true);
    expect(out.meetsAllThresholds).toBe(true);
  });

  it("fails the telefrag gate when there is no environmental death", () => {
    const out = computePhase12Metrics([
      runInput({
        turns: airdropVisionRows(),
      }),
    ]);

    expect(out.environmentalDeaths).toBe(0);
    expect(out.meetsTelefragThreshold).toBe(false);
    expect(out.meetsAllThresholds).toBe(false);
  });

  it("fails the per-persona kill attribution gate when one locked persona has zero kills", () => {
    const out = computePhase12Metrics([
      runInput({
        run: {
          extractions: 1,
          kills: 1,
          equips: 1,
          speechEvents: 1,
          perPersona: perPersonaKills({ sprinter: 0 }),
        },
      }),
    ]);

    expect(out.perPersonaKillTotal).toBe(PERSONA_IDS.length - 1);
    expect(out.perPersonaKills).toContainEqual({
      personaId: "sprinter",
      kills: 0,
    });
    expect(out.meetsPerPersonaKillAttributionThreshold).toBe(false);
    expect(out.meetsAllThresholds).toBe(false);
  });

  it("scopes spent-airdrop visibility checks per match", () => {
    const out = computePhase12Metrics([
      runInput({ matchId: "M1" }),
      runInput({
        matchId: "M2",
        turns: [
          turn({
            matchId: "M2",
            turn: 12,
            agentRecords: [
              record({
                characterId: "m2-spotter",
                airdropVision: {
                  telegraphed: 0,
                  landed: 1,
                  telegraphedIds: [],
                  landedIds: ["Crate_50_50"],
                },
              }),
            ],
          }),
        ],
      }),
    ]);

    expect(out.airdropSpentVisibilityViolations).toBe(0);
  });
});

describe("phase12 closing CLI", () => {
  it("persists a phase-12-closing-20 sibling-payload report", async () => {
    const input = runInput();
    const result = await runPhase12ClosingCli(["--matchIds", "M1"], {
      client: {
        query: async () => {
          throw new Error("unexpected query");
        },
        mutation: async () => {
          throw new Error("unexpected mutation");
        },
      },
      fetchSlimAcross: async () => [input.turns],
      readRunByMatch: async () => input.run,
      readMatchStatus: async () => ({
        status: "completed",
        turn: 50,
        completedAt: 123,
      }),
      persistReport: async (_client, args) => {
        expect(args.matchIds).toEqual(["M1"]);
        expect(args.payload.reportType).toBe("phase-12-closing-20");
        expect(args.payload.perPersonaKillTotal).toBe(PERSONA_IDS.length);
        return {
          _id: "report-12",
          existed: false,
          payload: args.payload,
        };
      },
      writeStdout: () => {},
    });

    expect(result.reportId).toBe("report-12");
    expect(result.payload?.reportType).toBe("phase-12-closing-20");
    expect(result.payload?.meetsAllThresholds).toBe(true);
  });
});
