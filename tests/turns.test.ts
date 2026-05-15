import { getFunctionName } from "convex/server";
import { describe, expect, it } from "vitest";
import {
  auditDamageFeed,
  countInboundSpeech,
  extractLootOutcomes,
  projectSlimTurnRow,
  projectSlimTurnRows,
  summariseVisible,
} from "../convex/turnsDerived.js";
import { fetchSlimAcross } from "../harness/diagnostics/fanout.js";

const decision = {
  use: null,
  position: { kind: "move", direction: { kind: "N" }, dist: 1 },
  action: { kind: "none" },
  say: null,
  scratchpad: null,
};

function makeAgentRecord(overrides: {
  characterId: string;
  personaId: "duelist" | "camper" | "trader";
  visibleStateDigest?: string;
  narrativeLines?: string[];
  status?: {
    hp?: number;
    pos?: { x: number; y: number };
    equipped?: {
      weapon?: { category: "weapon"; name: "sword" | "axe" };
      armour?: { category: "armour"; name: "leather" };
      consumable?: { category: "consumable"; name: "heal" | "speed" };
    };
    insideEvac?: boolean;
  };
  scratchpadBefore?: string;
  scratchpadAfter?: string;
  retried?: boolean;
}) {
  const status = overrides.status ?? {};
  return {
    characterId: overrides.characterId,
    personaId: overrides.personaId,
    input: {
      systemPromptHash: "system-hash",
      personaPromptHash: "persona-hash",
      visibleStateDigest: overrides.visibleStateDigest ?? "{}",
      scratchpadBefore: overrides.scratchpadBefore ?? "before",
      status: {
        hp: status.hp ?? 40,
        pos: status.pos ?? { x: 0, y: 0 },
        equipped: status.equipped ?? {
          weapon: { category: "weapon", name: "sword" },
          armour: { category: "armour", name: "leather" },
        },
        insideEvac: status.insideEvac ?? false,
      },
      narrativeLines: overrides.narrativeLines ?? [],
      aliveCount: 3,
      useVariant: "consumable_or_null" as const,
    },
    decision,
    scratchpadAfter: overrides.scratchpadAfter ?? "after",
    llm: {
      responseId: "resp_1",
      callId: "call_1",
      rawArguments: "HEAVY raw args",
      usage: { output_tokens: 42 },
      latencyMs: 123,
      httpStatus: 200,
      fellBackToSafeDefault: false,
      failureReason: "schema_validation_failed",
      validatorFieldErrors: { action: "bad target" },
      httpBodyExcerpt: "HEAVY http body",
      reasoning: "HEAVY reasoning",
      ...(overrides.retried !== undefined ? { retried: overrides.retried } : {}),
    },
  };
}

describe("turns.byMatchSlim projection contract", () => {
  it("omits heavy text fields and includes derived diagnostic signals", () => {
    const row = {
      _id: "turn_1",
      matchId: "match_1",
      turn: 7,
      resolution: {
        consumed: [],
        speech: [
          {
            characterId: "char_trader",
            text: "Peace nearby.",
            heardBy: ["char_duelist", "char_camper"],
          },
          {
            characterId: "char_duelist",
            text: "Holding.",
            heardBy: ["char_trader"],
          },
        ],
        moves: [
          {
            characterId: "char_duelist",
            from: { x: 5, y: 5 },
            to: { x: 6, y: 5 },
            slide: {
              wallRectId: "Wall_6_4",
              axis: "E",
              intent: "NE",
            },
          },
        ] as const,
        actions: [
          {
            characterId: "char_camper",
            kind: "attack",
            target: "Duelist",
            result: "dmg 12",
            weapon: "axe",
          },
          {
            characterId: "char_duelist",
            kind: "attack",
            target: "Camper",
            result: "dmg 99",
            weapon: "sword",
          },
          {
            characterId: "char_duelist",
            kind: "loot",
            target: "Chest_53_54",
            result: "opened",
            lootedItem: "speed",
          },
          {
            characterId: "char_duelist",
            kind: "loot",
            target: "Corpse_Rat",
            result: "already_opened",
          },
        ],
        deaths: ["char_camper"],
        visibilityUpdates: [],
      },
      agentRecords: [
        makeAgentRecord({
          characterId: "char_duelist",
          personaId: "duelist",
          visibleStateDigest: `Vision:\n${JSON.stringify(
            {
              Wall_10_10_to_12_10: {
                dist: 1,
                bearing: "E",
                shape: "E-W line",
              },
              Cover_20_20_to_22_22: {
                dist: 0,
                bearing: "here",
                shape: "patch",
              },
              Evac_29_29_to_31_31: {
                dist: 22,
                bearing: "SE",
                shape: "patch",
              },
              Camper: { dist: 2, bearing: "E", hp: "mid", armed: true },
              Chest_53_54: { dist: 1, bearing: "N" },
              Corpse_Rat: { dist: 3, bearing: "W" },
            },
            null,
            2,
          )}`,
          status: {
            hp: 25,
            pos: { x: 7, y: 9 },
            equipped: {
              weapon: { category: "weapon", name: "sword" },
              armour: { category: "armour", name: "leather" },
            },
          },
          retried: true,
        }),
        makeAgentRecord({
          characterId: "char_camper",
          personaId: "camper",
          scratchpadBefore: "same",
          scratchpadAfter: "same",
        }),
      ],
    };

    const slim = projectSlimTurnRow(row);
    const record = slim.agentRecords[0]!;

    expect(slim.resolution.moves).toEqual([
      {
        characterId: "char_duelist",
        from: { x: 5, y: 5 },
        to: { x: 6, y: 5 },
        slide: {
          wallRectId: "Wall_6_4",
          axis: "E",
          intent: "NE",
        },
      },
    ]);

    expect(record.input).toEqual({
      systemPromptHash: "system-hash",
      personaPromptHash: "persona-hash",
      useVariant: "consumable_or_null",
    });
    expect(record.input).not.toHaveProperty("systemPromptText");
    expect(record.input).not.toHaveProperty("personaPromptText");
    expect(record.input).not.toHaveProperty("visibleStateDigest");
    expect(record.input).not.toHaveProperty("scratchpadBefore");
    expect(record.input).not.toHaveProperty("composedUserMessage");

    expect(record.llm).toMatchObject({
      responseId: "resp_1",
      callId: "call_1",
      usage: { output_tokens: 42 },
      latencyMs: 123,
      httpStatus: 200,
      fellBackToSafeDefault: false,
      failureReason: "schema_validation_failed",
      validatorFieldErrors: { action: "bad target" },
      retried: true,
    });
    expect(record.llm).not.toHaveProperty("rawArguments");
    expect(record.llm).not.toHaveProperty("httpBodyExcerpt");
    expect(record.llm).not.toHaveProperty("reasoning");

    expect(record.scratchpadChanged).toBe(true);
    expect(record.visibleSummary).toEqual({
      enemies: 1,
      chests: 1,
      corpses: 1,
      evacSeen: true,
    });
    expect(record.visibleRectKeys).toEqual([
      "Wall_10_10_to_12_10",
      "Cover_20_20_to_22_22",
      "Evac_29_29_to_31_31",
    ]);
    expect(record.insideBearingHere).toBe(true);
    expect(record.observerPos).toEqual({ x: 7, y: 9 });
    expect(Object.keys(record.visibleSummary).sort()).toEqual([
      "chests",
      "corpses",
      "enemies",
      "evacSeen",
    ]);
    expect(record.selfEquipment).toEqual({
      weapon: "sword",
      armour: "leather",
      consumable: null,
    });
    expect(record.damageFeedAudit).toEqual({
      incoming: 0,
      outgoing: 0,
      dealtKills: 0,
      expectedIncoming: 0,
      missingIncoming: 0,
      expectedOutgoing: 0,
      missingOutgoing: 0,
      expectedDealtKills: 0,
      missingDealtKills: 0,
    });
    expect(record.inboundSpeechCount).toBe(0);
    expect(record.lootOutcomeFeed).toEqual([]);
  });

  it("audits speech, loot, and damage delivery from the previous turn feed", () => {
    const turnOne = {
      _id: "turn_1",
      matchId: "match_1",
      turn: 1,
      resolution: {
        consumed: [],
        speech: [
          {
            characterId: "char_trader",
            text: "Peace nearby.",
            heardBy: ["char_duelist"],
          },
        ],
        moves: [],
        actions: [
          {
            characterId: "char_camper",
            kind: "attack",
            target: "Duelist",
            result: "dmg 12",
            weapon: "axe",
          },
          {
            characterId: "char_duelist",
            kind: "attack",
            target: "Camper",
            result: "dmg 99",
            weapon: "sword",
          },
          {
            characterId: "char_duelist",
            kind: "loot",
            target: "Chest_53_54",
            result: "opened",
            lootedItem: "speed",
          },
          {
            characterId: "char_camper",
            kind: "loot",
            target: "Corpse_Rat",
            result: "empty",
          },
        ],
        deaths: ["char_camper"],
        visibilityUpdates: [],
      },
      agentRecords: [
        makeAgentRecord({
          characterId: "char_duelist",
          personaId: "duelist",
        }),
        makeAgentRecord({
          characterId: "char_camper",
          personaId: "camper",
        }),
        makeAgentRecord({
          characterId: "char_trader",
          personaId: "trader",
        }),
      ],
    };
    const turnTwo = {
      ...turnOne,
      _id: "turn_2",
      turn: 2,
      resolution: {
        consumed: [],
        speech: [],
        moves: [],
        actions: [],
        deaths: [],
        visibilityUpdates: [],
      },
      agentRecords: [
        makeAgentRecord({
          characterId: "char_duelist",
          personaId: "duelist",
          status: {
            hp: 13,
            equipped: {
              weapon: { category: "weapon", name: "sword" },
              armour: { category: "armour", name: "leather" },
              consumable: { category: "consumable", name: "heal" },
            },
          },
          narrativeLines: [
            "You looted speed from Chest_53_54",
            "Camper attacked you with axe (dmg 12)",
            "Trader said \"Peace nearby.\"",
            "Duelist killed Camper with sword",
          ],
        }),
        makeAgentRecord({
          characterId: "char_trader",
          personaId: "trader",
          status: {
            hp: 40,
            equipped: {},
          },
        }),
      ],
    };

    const slim = projectSlimTurnRows([turnOne, turnTwo]);
    const turnOneDuelist = slim[0]!.agentRecords.find(
      (record) => record.characterId === "char_duelist",
    )!;
    const turnTwoDuelist = slim[1]!.agentRecords.find(
      (record) => record.characterId === "char_duelist",
    )!;
    const turnTwoTrader = slim[1]!.agentRecords.find(
      (record) => record.characterId === "char_trader",
    )!;

    expect(turnOneDuelist.inboundSpeechCount).toBe(0);
    expect(turnOneDuelist.damageFeedAudit.incoming).toBe(0);
    expect(turnOneDuelist.lootOutcomeFeed).toEqual([]);

    expect(turnTwoDuelist.inboundSpeechCount).toBe(1);
    expect(turnTwoDuelist.inboundSpeechExpected).toBe(1);
    expect(turnTwoDuelist.inboundSpeechMissing).toBe(0);
    expect(turnTwoDuelist.damageFeedAudit).toMatchObject({
      incoming: 1,
      expectedIncoming: 1,
      missingIncoming: 0,
      dealtKills: 1,
      expectedDealtKills: 1,
      missingDealtKills: 0,
    });
    expect(turnTwoDuelist.lootOutcomeFeed).toEqual([
      {
        result: "opened",
        item: "speed",
        target: "Chest_53_54",
        delivered: true,
      },
    ]);
    expect(turnTwoDuelist.lootOutcomeExpected).toBe(1);
    expect(turnTwoDuelist.lootOutcomeMissing).toBe(0);
    expect(turnTwoDuelist.selfHp).toEqual({ hp: 13, maxHp: 50 });
    expect(turnTwoDuelist.selfEquipment).toEqual({
      weapon: "sword",
      armour: "leather",
      consumable: "heal",
    });

    expect(turnTwoTrader.inboundSpeechCount).toBe(0);
    expect(turnTwoTrader.inboundSpeechExpected).toBe(0);
    expect(turnTwoTrader.damageFeedAudit.incoming).toBe(0);
    expect(turnTwoTrader.lootOutcomeFeed).toEqual([]);
  });

  it("does not count delivery evidence split across narrative line entries", () => {
    const turnOne = {
      _id: "turn_1",
      matchId: "match_1",
      turn: 1,
      resolution: {
        consumed: [],
        speech: [
          {
            characterId: "char_trader",
            text: "Peace nearby.",
            heardBy: ["char_duelist"],
          },
        ],
        moves: [],
        actions: [],
        deaths: [],
        visibilityUpdates: [],
      },
      agentRecords: [
        makeAgentRecord({
          characterId: "char_duelist",
          personaId: "duelist",
        }),
        makeAgentRecord({
          characterId: "char_trader",
          personaId: "trader",
        }),
      ],
    };
    const turnTwo = {
      ...turnOne,
      _id: "turn_2",
      turn: 2,
      resolution: {
        consumed: [],
        speech: [],
        moves: [],
        actions: [],
        deaths: [],
        visibilityUpdates: [],
      },
      agentRecords: [
        makeAgentRecord({
          characterId: "char_duelist",
          personaId: "duelist",
          narrativeLines: ["Trader said \"Peace", " nearby.\""],
        }),
      ],
    };

    const slim = projectSlimTurnRows([turnOne, turnTwo]);
    const turnTwoDuelist = slim[1]!.agentRecords.find(
      (record) => record.characterId === "char_duelist",
    )!;

    expect(turnTwoDuelist.inboundSpeechExpected).toBe(1);
    expect(turnTwoDuelist.inboundSpeechCount).toBe(0);
    expect(turnTwoDuelist.inboundSpeechMissing).toBe(1);
  });

  it("audits cross-turn body-collision charge feed without changing action counters", () => {
    const turnOne = {
      _id: "turn_1",
      matchId: "match_1",
      turn: 1,
      resolution: {
        consumed: [],
        speech: [],
        moves: [
          {
            characterId: "char_camper",
            from: { x: 10, y: 10 },
            to: { x: 10, y: 10 },
            bodyCollision: {
              kind: "character" as const,
              defenderId: "char_duelist",
            },
          },
          {
            characterId: "char_duelist",
            from: { x: 11, y: 10 },
            to: { x: 11, y: 10 },
            bodyCollision: {
              kind: "character" as const,
              defenderId: "char_trader",
            },
          },
        ],
        actions: [],
        deaths: [],
        visibilityUpdates: [],
      },
      agentRecords: [
        makeAgentRecord({
          characterId: "char_camper",
          personaId: "camper",
        }),
        makeAgentRecord({
          characterId: "char_duelist",
          personaId: "duelist",
        }),
        makeAgentRecord({
          characterId: "char_trader",
          personaId: "trader",
        }),
      ],
    };
    const turnTwo = {
      ...turnOne,
      _id: "turn_2",
      turn: 2,
      resolution: {
        consumed: [],
        speech: [],
        moves: [],
        actions: [],
        deaths: [],
        visibilityUpdates: [],
      },
      agentRecords: [
        makeAgentRecord({
          characterId: "char_camper",
          personaId: "camper",
          status: { hp: 39 },
        }),
        makeAgentRecord({
          characterId: "char_duelist",
          personaId: "duelist",
          status: { hp: 39 },
          narrativeLines: [
            "Camper charged into you (dmg 1)",
          ],
        }),
        makeAgentRecord({
          characterId: "char_trader",
          personaId: "trader",
          status: { hp: 39 },
        }),
      ],
    };

    const slim = projectSlimTurnRows([turnOne, turnTwo]);
    const turnTwoCamper = slim[1]!.agentRecords.find(
      (record) => record.characterId === "char_camper",
    )!;
    const turnTwoDuelist = slim[1]!.agentRecords.find(
      (record) => record.characterId === "char_duelist",
    )!;
    const turnTwoTrader = slim[1]!.agentRecords.find(
      (record) => record.characterId === "char_trader",
    )!;

    expect(turnTwoDuelist.damageFeedAudit).toMatchObject({
      incoming: 0,
      expectedIncoming: 0,
      missingIncoming: 0,
      bodyCollisionIncoming: 1,
      bodyCollisionExpectedIncoming: 1,
      bodyCollisionMissingIncoming: 0,
      chargeDamageFeedDelivered: 1,
      chargeDamageFeedExpected: 1,
      chargeDamageFeedMissing: 0,
    });
    expect(turnTwoCamper.damageFeedAudit).toMatchObject({
      outgoing: 0,
      expectedOutgoing: 0,
      missingOutgoing: 0,
      bodyCollisionOutgoing: 1,
      bodyCollisionExpectedOutgoing: 1,
      bodyCollisionMissingOutgoing: 0,
    });
    expect(turnTwoDuelist.damageFeedAudit).toMatchObject({
      bodyCollisionOutgoing: 0,
      bodyCollisionExpectedOutgoing: 1,
      bodyCollisionMissingOutgoing: 1,
    });
    expect(turnTwoTrader.damageFeedAudit).toMatchObject({
      bodyCollisionIncoming: 0,
      bodyCollisionExpectedIncoming: 1,
      bodyCollisionMissingIncoming: 1,
      chargeDamageFeedDelivered: 0,
      chargeDamageFeedExpected: 1,
      chargeDamageFeedMissing: 1,
    });
  });
});

describe("turns derived helper functions", () => {
  it("summariseVisible returns zero counts for no enemies and hidden evac", () => {
    expect(summariseVisible("{}")).toEqual({
      enemies: 0,
      chests: 0,
      corpses: 0,
      evacSeen: false,
    });
  });

  it("summariseVisible parses the iter-3 Vision block without leaking ids", () => {
    const summary = summariseVisible(`Vision:
{
  "Trader": { "dist": 4, "bearing": "N", "hp": "low", "armed": false },
  "Chest_1_2": { "dist": 3, "bearing": "E" },
  "Corpse_Rat": { "dist": 5, "bearing": "W" }
}`);

    expect(summary).toEqual({
      enemies: 1,
      chests: 1,
      corpses: 1,
      evacSeen: false,
    });
  });

  it("audits damage and kills using the turn roster display names", () => {
    expect(
      auditDamageFeed(
        {
          actions: [
            {
              characterId: "char_camper",
              kind: "attack",
              target: "Duelist",
              result: "dmg 7",
            },
            {
              characterId: "char_duelist",
              kind: "counter",
              target: "Camper",
              result: "dmg 20",
            },
          ],
          deaths: ["char_camper"],
        },
        "char_duelist",
        [
          { characterId: "char_duelist", personaId: "duelist" },
          { characterId: "char_camper", personaId: "camper" },
        ],
      ),
    ).toMatchObject({ incoming: 1, outgoing: 1, dealtKills: 1 });
  });

  it("counts inbound speech only when heard by self and speaker differs", () => {
    expect(
      countInboundSpeech(
        [
          { characterId: "speaker", text: "hello", heardBy: ["self"] },
          { characterId: "self", text: "own speech", heardBy: ["speaker"] },
          { characterId: "far", text: "too far", heardBy: ["other"] },
        ],
        "self",
      ),
    ).toBe(1);
  });

  it("extractLootOutcomes omits item for already_opened outcomes", () => {
    expect(
      extractLootOutcomes(
        [
          {
            characterId: "self",
            kind: "loot",
            target: "Chest_1_2",
            result: "already_opened",
            lootedItem: "should-not-leak",
          },
          {
            characterId: "self",
            kind: "loot",
            target: "Corpse_Rat",
            result: "looted",
            lootedItem: "axe",
          },
          {
            characterId: "other",
            kind: "loot",
            target: "Chest_1_2",
            result: "opened",
          },
        ],
        "self",
      ),
    ).toEqual([
      { result: "already_opened", target: "Chest_1_2" },
      { result: "looted", item: "axe", target: "Corpse_Rat" },
    ]);
  });
});

describe("diagnostics slim fan-out", () => {
  it("issues all byMatchSlim queries in parallel and preserves match order", async () => {
    const started: string[] = [];
    const resolvers = new Map<string, () => void>();
    const client = {
      query: async (ref: unknown, args: { matchId: string }) => {
        expect(getFunctionName(ref as never)).toBe("turns:byMatchSlim");
        started.push(args.matchId);
        await new Promise<void>((resolve) => {
          resolvers.set(args.matchId, resolve);
        });
        return [{ matchId: args.matchId, turn: started.length }];
      },
    };

    const promise = fetchSlimAcross(client, ["m1", "m2", "m3"]);

    await Promise.resolve();
    expect(started).toEqual(["m1", "m2", "m3"]);

    resolvers.get("m2")!();
    resolvers.get("m3")!();
    resolvers.get("m1")!();

    await expect(promise).resolves.toEqual([
      [{ matchId: "m1", turn: 3 }],
      [{ matchId: "m2", turn: 3 }],
      [{ matchId: "m3", turn: 3 }],
    ]);
  });
});
