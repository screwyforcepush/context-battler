import { describe, expect, it } from "vitest";
import {
  computePhase6Metrics,
  type Phase6AgentRecord,
  type Phase6CharacterRow,
  type Phase6RunInput,
  type Phase6TurnRow,
} from "../../convex/reports/phase6.js";
import type { ParsedDecision, PersonaId } from "../../convex/engine/types.js";

const NONE_DECISION: ParsedDecision = {
  use: null,
  position: { kind: "move", direction: { kind: "N" }, dist: 0 },
  action: { kind: "none" },
  say: null,
  scratchpad: null,
};

function makeRecord(
  overrides: Partial<Phase6AgentRecord> & { characterId: string },
): Phase6AgentRecord {
  return {
    characterId: overrides.characterId,
    personaId: overrides.personaId ?? "rat",
    input: overrides.input ?? {
      personaPromptText: "Rat prompt",
      composedUserMessage: "# Rat\n\n# Current Game State",
      useVariant: "consumable_or_null",
    },
    decision: overrides.decision ?? NONE_DECISION,
    scratchpadAfter: overrides.scratchpadAfter ?? "",
    llm: overrides.llm ?? {
      rawArguments: JSON.stringify(NONE_DECISION),
    },
  };
}

function makeTurn(
  overrides: Partial<Phase6TurnRow> & { turn: number },
): Phase6TurnRow {
  return {
    matchId: overrides.matchId ?? "M1",
    turn: overrides.turn,
    agentRecords: overrides.agentRecords ?? [],
    resolution: overrides.resolution ?? { actions: [] },
  };
}

function makeCharacter(
  characterId: string,
  displayName: string,
  personaId: PersonaId = "rat",
): Phase6CharacterRow {
  return { characterId, displayName, personaId };
}

function makeRunInput(overrides: Partial<Phase6RunInput>): Phase6RunInput {
  return {
    matchId: overrides.matchId ?? "M1",
    failed: overrides.failed ?? false,
    run: overrides.run ?? null,
    turns: overrides.turns ?? [],
    characters: overrides.characters ?? [],
  };
}

describe("computePhase6Metrics — field-scoped validator denominator", () => {
  it("divides one rejected field by one record × five decision fields", () => {
    const out = computePhase6Metrics([
      makeRunInput({
        turns: [
          makeTurn({
            turn: 1,
            agentRecords: [
              makeRecord({
                characterId: "c1",
                llm: {
                  rawArguments: JSON.stringify(NONE_DECISION),
                  validatorFieldErrors: { use: "invalid use" },
                },
              }),
            ],
          }),
        ],
      }),
    ]);

    expect(out.totalAgentRecords).toBe(1);
    expect(out.validatorFieldErrors).toBe(1);
    expect(out.perFieldRejectionRate).toBeCloseTo(1 / 5);
  });

  it("divides two rejected fields by two records × five decision fields", () => {
    const out = computePhase6Metrics([
      makeRunInput({
        turns: [
          makeTurn({
            turn: 1,
            agentRecords: [
              makeRecord({
                characterId: "c1",
                llm: {
                  rawArguments: JSON.stringify(NONE_DECISION),
                  validatorFieldErrors: { use: "invalid use" },
                },
              }),
              makeRecord({
                characterId: "c2",
                llm: {
                  rawArguments: JSON.stringify(NONE_DECISION),
                  validatorFieldErrors: { action: "dead target" },
                },
              }),
            ],
          }),
        ],
      }),
    ]);

    expect(out.totalAgentRecords).toBe(2);
    expect(out.validatorFieldErrors).toBe(2);
    expect(out.perFieldRejectionRate).toBeCloseTo(2 / 10);
  });
});

describe("computePhase6Metrics — action plus overwatch combo success", () => {
  it("counts attack damage, corpse looted, and chest opened as resolved combos", () => {
    const attackDecision: ParsedDecision = {
      ...NONE_DECISION,
      position: { kind: "overwatch" },
      action: { kind: "attack", targetId: "Camper" },
    };
    const corpseLootDecision: ParsedDecision = {
      ...NONE_DECISION,
      position: { kind: "overwatch" },
      action: { kind: "loot", targetId: "Corpse_Camper" },
    };
    const chestLootDecision: ParsedDecision = {
      ...NONE_DECISION,
      position: { kind: "overwatch" },
      action: { kind: "loot", targetId: "chest_1" },
    };

    const out = computePhase6Metrics([
      makeRunInput({
        turns: [
          makeTurn({
            turn: 1,
            agentRecords: [
              makeRecord({ characterId: "attacker", decision: attackDecision }),
              makeRecord({
                characterId: "corpse-looter",
                decision: corpseLootDecision,
              }),
              makeRecord({
                characterId: "chest-looter",
                decision: chestLootDecision,
              }),
            ],
            resolution: {
              actions: [
                {
                  characterId: "attacker",
                  kind: "attack",
                  target: "Camper",
                  result: "dmg 8",
                },
                {
                  characterId: "corpse-looter",
                  kind: "loot",
                  target: "Corpse_Camper",
                  result: "looted",
                },
                {
                  characterId: "chest-looter",
                  kind: "loot",
                  target: "chest_1",
                  result: "opened",
                },
              ],
            },
          }),
        ],
      }),
    ]);

    expect(out.actionOverwatchCombos).toBe(3);
  });
});

describe("computePhase6Metrics — raw null-only use violations", () => {
  it('counts raw use:"consumable" even when validated decision is use:null', () => {
    const out = computePhase6Metrics([
      makeRunInput({
        turns: [
          makeTurn({
            turn: 1,
            agentRecords: [
              makeRecord({
                characterId: "c1",
                input: {
                  personaPromptText: "Rat prompt",
                  composedUserMessage: "# Rat",
                  useVariant: "null_only",
                },
                decision: NONE_DECISION,
                llm: {
                  rawArguments: JSON.stringify({
                    ...NONE_DECISION,
                    use: "consumable",
                  }),
                },
              }),
            ],
          }),
        ],
      }),
    ]);

    expect(out.nullOnlyUseViolations).toBe(1);
    expect(out.meetsUseVariantThreshold).toBe(false);
  });
});

describe("computePhase6Metrics — scoped legacy-id scan", () => {
  it("counts only agent-facing surfaces, including report payload surfaces", () => {
    const legacyId = (n: number): string => `Player${"_"}${n}`;
    const leakingDecision: ParsedDecision = {
      ...NONE_DECISION,
      position: {
        kind: "move",
        direction: { kind: "toward", targetId: legacyId(5) },
        dist: 1,
      },
      action: { kind: "attack", targetId: legacyId(4) },
    };

    const out = computePhase6Metrics([
      makeRunInput({
        matchId: `${legacyId(88)}-is-an-arbitrary-match-id`,
        characters: [
          makeCharacter("attacker-id", legacyId(7)),
          makeCharacter("victim-id", "Victim"),
        ],
        turns: [
          makeTurn({
            matchId: `${legacyId(88)}-is-an-arbitrary-match-id`,
            turn: 1,
            agentRecords: [
              makeRecord({
                characterId: `${legacyId(99)}-is-an-arbitrary-record-id`,
                input: {
                  personaPromptText: `Prompt mentions ${legacyId(2)}`,
                  composedUserMessage: `Visible: ${legacyId(1)}`,
                  useVariant: "consumable_or_null",
                },
                decision: leakingDecision,
                llm: {
                  rawArguments: JSON.stringify({
                    action: { kind: "attack", targetId: legacyId(3) },
                  }),
                },
              }),
            ],
            resolution: {
              actions: [
                {
                  characterId: `${legacyId(100)}-is-an-arbitrary-action-id`,
                  kind: "loot",
                  target: legacyId(6),
                  result: "empty",
                },
                {
                  characterId: "attacker-id",
                  kind: "attack",
                  target: "Victim",
                  result: "dmg 4",
                  weapon: "hammer",
                },
              ],
            },
          }),
          makeTurn({
            matchId: `${legacyId(88)}-is-an-arbitrary-match-id`,
            turn: 2,
            agentRecords: [
              makeRecord({
                characterId: "victim-id",
                input: {
                  personaPromptText: "Victim prompt",
                  composedUserMessage:
                    `${legacyId(7)} attacked you with hammer (dmg 4)`,
                  useVariant: "consumable_or_null",
                },
              }),
            ],
          }),
        ],
      }),
    ]);

    expect(out.damageFeedAuditSamples).toHaveLength(1);
    expect(out.damageFeedAuditScopeNote).toContain("deterministic first 20");
    expect(out.damageFeedAuditScopeNote).toContain("victim dies");
    expect(out.playerNLiteralCount).toBe(10);
    expect(out.meetsPersonaIdThreshold).toBe(false);
  });
});
