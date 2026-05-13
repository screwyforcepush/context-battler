import { getFunctionName } from "convex/server";
import { describe, expect, it } from "vitest";
import {
  auditDamageFeed,
  countInboundSpeech,
  extractSelfHp,
  extractLootOutcomes,
  extractSelfEquipment,
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
  composedUserMessage?: string;
  scratchpadBefore?: string;
  scratchpadAfter?: string;
  retried?: boolean;
}) {
  return {
    characterId: overrides.characterId,
    personaId: overrides.personaId,
    input: {
      systemPromptHash: "system-hash",
      systemPromptText: "HEAVY system prompt",
      personaPromptHash: "persona-hash",
      personaPromptText: "HEAVY persona prompt",
      visibleStateDigest: overrides.visibleStateDigest ?? "{}",
      scratchpadBefore: overrides.scratchpadBefore ?? "before",
      composedUserMessage:
        overrides.composedUserMessage ??
        [
          "# Duelist",
          "## Status",
          "weapon: sword [dmg 20]",
          "armour: leather [-3 dmg]",
          "",
          "Vision:",
          "{}",
        ].join("\n"),
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
    const visibleStateDigest = JSON.stringify({
      Camper: { dist: 2, bearing: "E", hp: "mid", armed: true },
      Chest_53_54: { dist: 1, bearing: "N" },
      Corpse_Rat: { dist: 3, bearing: "W" },
      Evac: { dist: 10, bearing: "S" },
    });
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
          visibleStateDigest,
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
    const baseStatus = [
      "# Duelist",
      "## Status",
      "❤️HP: 25/40 HP",
      "⚔️weapon: sword [dmg 20]",
      "🛡️armour: leather [-3 dmg]",
      "🧪consumable: heal [heal 50% max HP]",
      "",
      "# Current Game State",
      "Turn 1, 3/8 players alive",
      "",
      "Vision:",
      "{}",
    ].join("\n");
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
          composedUserMessage: baseStatus,
        }),
        makeAgentRecord({
          characterId: "char_camper",
          personaId: "camper",
          composedUserMessage: baseStatus.replace("# Duelist", "# Camper"),
        }),
        makeAgentRecord({
          characterId: "char_trader",
          personaId: "trader",
          composedUserMessage: baseStatus.replace("# Duelist", "# Trader"),
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
          composedUserMessage: [
            "# Duelist",
            "## Status",
            "❤️HP: 13/40 HP",
            "⚔️weapon: sword [dmg 20]",
            "🛡️armour: leather [-3 dmg]",
            "🧪consumable: heal [heal 50% max HP]",
            "",
            "# Current Game State",
            "Turn 2, 2/8 players alive",
            "You looted speed from Chest_53_54",
            "Camper attacked you with axe (dmg 12)",
            "Trader said \"Peace nearby.\"",
            "Duelist killed Camper with sword",
            "",
            "Vision:",
            "{}",
          ].join("\n"),
        }),
        makeAgentRecord({
          characterId: "char_trader",
          personaId: "trader",
          composedUserMessage: [
            "# Trader",
            "## Status",
            "❤️HP: 40/40 HP",
            "⚔️weapon: unarmed [dmg 5]",
            "🛡️armour: none",
            "🧪consumable: none",
            "",
            "# Current Game State",
            "Turn 2, 2/8 players alive",
            "",
            "Vision:",
            "{}",
          ].join("\n"),
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
    expect(turnTwoDuelist.selfHp).toEqual({ hp: 13, maxHp: 40 });
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

  it("extractSelfEquipment returns null slots for unarmed or unarmoured status", () => {
    expect(
      extractSelfEquipment(
        [
          "## Status",
          "weapon: unarmed [dmg 5]",
          "armour: none",
          "consumable: none",
        ].join("\n"),
      ),
    ).toEqual({ weapon: null, armour: null, consumable: null });
  });

  it("extracts self HP from the Status block", () => {
    expect(extractSelfHp(["## Status", "❤️HP: 50/75 HP"].join("\n"))).toEqual({
      hp: 50,
      maxHp: 75,
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
