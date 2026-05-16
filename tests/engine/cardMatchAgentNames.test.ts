import { describe, expect, it } from "vitest";
import {
  CARD_MATCH_AGENT_COUNT,
  CARD_MATCH_AGENT_NAME_MAX_LENGTH,
  disambiguateCardMatchDisplayNames,
  normaliseCardMatchAgentName,
  validateCardMatchAgentNames,
  type CardMatchAgentNameValidationResult,
} from "../../convex/engine/cardMatchAgentNames.js";

type TestCard = { cardId: string; agentName: string };

const SAFE_NAMES = [
  "Rat",
  "Duelist",
  "Camper",
  "Vulture",
  "Trader",
  "Sprinter",
  "Paranoid",
  "Opportunist",
] as const;

function makeCards(overrides: Record<number, string> = {}): TestCard[] {
  return SAFE_NAMES.map((agentName, index) => ({
    cardId: `card_${index}`,
    agentName: overrides[index] ?? agentName,
  }));
}

function expectInvalid(result: CardMatchAgentNameValidationResult) {
  if (result.ok) {
    throw new Error("expected validation failure");
  }
  return result.errors;
}

describe("card match agentName validation", () => {
  it("accepts exactly 8 selected Card rows and returns display names in input order", () => {
    const cards = makeCards();

    const result = validateCardMatchAgentNames(cards);

    expect(result).toEqual({
      ok: true,
      entries: cards.map((card) => ({
        cardId: card.cardId,
        agentName: card.agentName,
        displayName: card.agentName,
        normalisedAgentName: normaliseCardMatchAgentName(card.agentName),
      })),
    });
  });

  it("rejects any selected row count other than exactly 8", () => {
    const tooFew = validateCardMatchAgentNames(makeCards().slice(0, 7));
    const tooMany = validateCardMatchAgentNames([
      ...makeCards(),
      { cardId: "card_8", agentName: "Ninth" },
    ]);

    expect(expectInvalid(tooFew)).toContainEqual({
      reason: "invalid_count",
      expected: CARD_MATCH_AGENT_COUNT,
      actual: 7,
    });
    expect(expectInvalid(tooMany)).toContainEqual({
      reason: "invalid_count",
      expected: CARD_MATCH_AGENT_COUNT,
      actual: 9,
    });
  });

  it("hard-rejects intra-8 agentName duplicates after normalisation", () => {
    const result = validateCardMatchAgentNames(makeCards({ 1: "rat" }));

    expect(expectInvalid(result)).toContainEqual({
      reason: "duplicate_agent_name",
      normalisedAgentName: "rat",
      indices: [0, 1],
      cardIds: ["card_0", "card_1"],
      agentNames: ["Rat", "rat"],
    });
  });

  it("normalises names for uniqueness using trimming, NFKC, and case folding", () => {
    expect(normaliseCardMatchAgentName(" \uFF32\uFF21\uFF34 ")).toBe("rat");
  });

  it("rejects unsafe empty, untrimmed, multiline, control, and over-length names", () => {
    const overLength = "A".repeat(CARD_MATCH_AGENT_NAME_MAX_LENGTH + 1);
    const cases: Array<[agentName: string, reason: string]> = [
      ["", "empty"],
      ["   ", "empty"],
      [" Rat", "untrimmed"],
      ["Rat ", "untrimmed"],
      ["Line\nBreak", "multiline"],
      ["Line\rBreak", "multiline"],
      ["Name\tWithTab", "control_character"],
      [overLength, "over_max_length"],
    ];

    for (const [agentName, reason] of cases) {
      const errors = expectInvalid(validateCardMatchAgentNames(makeCards({ 0: agentName })));
      expect(errors).toContainEqual(
        expect.objectContaining({
          reason,
          index: 0,
          cardId: "card_0",
          agentName,
        }),
      );
    }
  });

  it("rejects engine-reserved target namespaces and Player_N ids", () => {
    const cases: Array<[agentName: string, reason: string]> = [
      ["Crate_-1_20", "reserved_crate_id"],
      ["Crate_supply", "reserved_prefix"],
      ["Corpse_Rat", "reserved_prefix"],
      ["Cover_1_1", "reserved_prefix"],
      ["Wall_1_1", "reserved_prefix"],
      ["Evac_1_1", "reserved_prefix"],
      ["Player_7", "reserved_player_id"],
    ];

    for (const [agentName, reason] of cases) {
      const errors = expectInvalid(validateCardMatchAgentNames(makeCards({ 0: agentName })));
      expect(errors).toContainEqual(
        expect.objectContaining({
          reason,
          index: 0,
          cardId: "card_0",
          agentName,
        }),
      );
    }
  });

  it("allows reserved-name near misses that do not dispatch as engine target ids", () => {
    const result = validateCardMatchAgentNames([
      { cardId: "card_0", agentName: "Crate" },
      { cardId: "card_1", agentName: "Crateish_1_2" },
      { cardId: "card_2", agentName: "Corpse" },
      { cardId: "card_3", agentName: "Cover" },
      { cardId: "card_4", agentName: "Wallflower" },
      { cardId: "card_5", agentName: "Evacuee" },
      { cardId: "card_6", agentName: "Player_" },
      { cardId: "card_7", agentName: "Player_7a" },
    ]);

    expect(result.ok).toBe(true);
  });
});

describe("card match displayName disambiguation fallback", () => {
  it("adds deterministic suffixes while reserving existing suffixed names", () => {
    expect(
      disambiguateCardMatchDisplayNames([
        "Slayer",
        "Slayer",
        "Slayer (2)",
        "Slayer",
        "Runner",
        "Runner",
      ]),
    ).toEqual([
      "Slayer",
      "Slayer (3)",
      "Slayer (2)",
      "Slayer (4)",
      "Runner",
      "Runner (2)",
    ]);
  });
});
