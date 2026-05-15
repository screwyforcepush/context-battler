import { describe, expect, it } from "vitest";
import type { ParsedDecision } from "../../convex/engine/types.js";
import {
  computeBehaviourDiagnostics,
  type BehaviourDiagnostics,
} from "../../harness/diagnostics/behaviour.js";
import { computeCriticalDiagnostics } from "../../harness/diagnostics/critical.js";
import { computeMechanicsDiagnostics } from "../../harness/diagnostics/mechanics.js";
import {
  buildDiagnosticsReport,
  renderDiagnosticsJson,
  renderDiagnosticsMarkdown,
  runDiagnosticsCli,
} from "../../harness/diagnostics.js";
import type {
  DiagnosticsClient,
  SlimAgentRecord,
  SlimTurnRow,
} from "../../harness/diagnostics/types.js";

const NONE_DECISION: ParsedDecision = {
  use: null,
  position: { kind: "move", direction: { kind: "N" }, dist: 0 },
  action: { kind: "none" },
  say: null,
  scratchpad: null,
};

function moveDecision(
  dist: number,
  action: ParsedDecision["action"] = { kind: "none" },
): ParsedDecision {
  return {
    ...NONE_DECISION,
    position: { kind: "move", direction: { kind: "E" }, dist },
    action,
  };
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
      weapon: null,
      armour: null,
    },
    selfHp: overrides.selfHp,
    damageFeedAudit: overrides.damageFeedAudit ?? {
      incoming: 0,
      outgoing: 0,
      dealtKills: 0,
    },
    inboundSpeechCount: overrides.inboundSpeechCount ?? 0,
    lootOutcomeFeed: overrides.lootOutcomeFeed ?? [],
    input: overrides.input ?? {
      systemPromptHash: "sys",
      personaPromptHash: "persona",
      useVariant: "consumable_or_null",
    },
    llm: overrides.llm ?? {
      responseId: null,
      callId: null,
      usage: null,
      latencyMs: 1,
      httpStatus: 200,
      fellBackToSafeDefault: false,
    },
  };
}

function turn(
  overrides: Partial<SlimTurnRow> & { matchId?: string; turn: number },
): SlimTurnRow {
  return {
    _id: `${overrides.matchId ?? "M1"}:${overrides.turn}`,
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

describe("diagnostics critical fails", () => {
  it("computes fallback taxonomy, retry recovery, token proximity, and field breakdowns", () => {
    const rows = [
      turn({
        turn: 1,
        agentRecords: [
          record({
            characterId: "c_duelist",
            personaId: "duelist",
            llm: {
              responseId: null,
              callId: "call_1",
              usage: { output_tokens: 1180 },
              latencyMs: 30,
              httpStatus: 500,
              fellBackToSafeDefault: true,
              failureReason: "http_non_200",
              retried: true,
            },
          }),
          record({
            characterId: "c_trader",
            personaId: "trader",
            llm: {
              responseId: "resp_2",
              callId: "call_2",
              usage: { output_tokens: 780 },
              latencyMs: 20,
              httpStatus: 200,
              fellBackToSafeDefault: false,
              retried: true,
            },
          }),
          record({
            characterId: "c_rat",
            personaId: "rat",
            llm: {
              responseId: "resp_3",
              callId: "call_3",
              usage: { output_tokens: 400 },
              latencyMs: 20,
              httpStatus: 200,
              fellBackToSafeDefault: true,
              validatorFieldErrors: {
                action: "target not alive",
                scratchpad: "too long",
              },
            },
          }),
        ],
      }),
    ];

    const out = computeCriticalDiagnostics(rows);

    expect(out.totalRecords).toBe(3);
    expect(out.fallback.count).toBe(2);
    expect(out.fallback.byReason).toEqual({
      field_rejection: 1,
      http_non_200: 1,
    });
    expect(out.retry).toEqual({
      attempts: 2,
      recovered: 1,
      failedAfterRetry: 1,
      recoveryRate: 0.5,
    });
    expect(out.outputTokenProximity.histogram).toEqual({
      lt50: 1,
      from50To80: 1,
      from80To95: 0,
      gte95: 1,
      missing: 0,
    });
    expect(out.validatorFieldRejections.byField).toEqual({
      action: 1,
      scratchpad: 1,
    });
    expect(out.personaFailureReasons.duelist).toEqual({ http_non_200: 1 });
    expect(out.personaFailureReasons.rat).toEqual({ field_rejection: 1 });
  });
});

describe("diagnostics mechanics", () => {
  it("summarises combat, reactive fires, loot, consume, speech, damage feed, and movement", () => {
    const rows = [
      turn({
        turn: 1,
        resolution: {
          consumed: [
            { characterId: "c_speed", item: { category: "consumable", name: "speed" } },
            { characterId: "c_healer", item: { category: "consumable", name: "heal" } },
          ],
          speech: [
            { characterId: "c_trader", text: "Peace?", heardBy: ["c_duelist", "c_rat"] },
          ],
          moves: [
            {
              characterId: "c_runner",
              from: { x: 0, y: 0 },
              to: { x: 2, y: 0 },
            },
            {
              characterId: "c_blocked",
              from: { x: 5, y: 5 },
              to: { x: 5, y: 5 },
              blockedBy: "wall",
            },
          ],
          actions: [
            {
              characterId: "c_duelist",
              kind: "attack",
              target: "Trader",
              result: "dmg 10",
            },
            {
              characterId: "c_rat",
              kind: "attack",
              target: "Trader",
              result: "missed",
            },
            {
              characterId: "c_camp",
              kind: "overwatch",
              target: "Sprinter",
              result: "dmg 5",
              triggeredByMovement: true,
            },
            {
              characterId: "c_guard",
              kind: "overwatch",
              target: "Rat",
              result: "dmg 5",
            },
            {
              characterId: "c_counter",
              kind: "counter",
              target: "Duelist",
              result: "dmg 7",
            },
            {
              characterId: "c_looter",
              kind: "loot",
              target: "Crate_10_20",
              result: "opened",
              lootedItem: "speed",
            },
          ],
          deaths: ["c_dead"],
          visibilityUpdates: [],
        },
        agentRecords: [
          record({
            characterId: "c_runner",
            decision: moveDecision(5),
          }),
          record({
            characterId: "c_speed",
            decision: {
              ...NONE_DECISION,
              use: "consumable",
              position: { kind: "overwatch" },
            },
          }),
          record({
            characterId: "c_healer",
            decision: {
              ...NONE_DECISION,
              use: "consumable",
            },
            selfEquipment: {
              weapon: null,
              armour: null,
              consumable: "heal",
            },
            selfHp: { hp: 30, maxHp: 30 },
          }),
          record({
            characterId: "c_counter_prime",
            decision: { ...NONE_DECISION, position: { kind: "counter" } },
          }),
          record({
            characterId: "c_looter",
            decision: moveDecision(1, {
              kind: "loot",
              targetId: "Crate_10_20",
            }),
            visibleSummary: {
              enemies: 0,
              crates: 1,
              corpses: 0,
              evacSeen: false,
            },
            lootOutcomeFeed: [
              { result: "opened", item: "speed", target: "Crate_10_20" },
            ],
          }),
          record({
            characterId: "c_vulture",
            decision: moveDecision(1, {
              kind: "loot",
              targetId: "Corpse_Duelist",
            }),
            visibleSummary: {
              enemies: 0,
              crates: 0,
              corpses: 1,
              evacSeen: false,
            },
            lootOutcomeFeed: [
              { result: "looted", item: "sword", target: "Corpse_Duelist" },
            ],
            damageFeedAudit: {
              incoming: 1,
              outgoing: 2,
              dealtKills: 1,
            },
          }),
        ],
      }),
    ];

    const out = computeMechanicsDiagnostics(rows);

    expect(out.attackOutcomes).toMatchObject({ landed: 1, missed: 1 });
    expect(out.overwatch).toEqual({ movementTriggered: 1, defensive: 1 });
    expect(out.counter).toEqual({ fired: 1, primedWithoutIncomingAttack: 1 });
    expect(out.loot.crate).toMatchObject({
      seen: 1,
      lootActions: 1,
      opened: 1,
      equipped: 1,
    });
    expect(out.loot.corpse).toMatchObject({
      seen: 1,
      lootActions: 1,
      looted: 1,
      drainedRepeat: 0,
    });
    expect(out.consume.wastedSpeedWithoutMovement).toBe(1);
    expect(out.consume.healAtFullHp).toBe(1);
    expect(out.speech).toMatchObject({
      events: 1,
      heardFanout: 2,
      inboundDelivered: 0,
    });
    expect(out.damageFeedAudit).toEqual({
      incoming: 1,
      outgoing: 2,
      dealtKills: 1,
    });
    expect(out.wallBlockedMoves).toBe(1);
    expect(out.movement.declaredVsActual.capped).toBe(1);
    expect(out.movement.declaredVsActual.examples[0]).toMatchObject({
      characterId: "c_runner",
      declared: 5,
      actual: 2,
    });
  });

  it("credits loot outcomes by outcome.target, independent of the current-turn decision", () => {
    const rows = [
      turn({
        turn: 5,
        agentRecords: [
          // Looted last turn, moving on this turn (decision is not a loot).
          // Previously this case was silently dropped because the counter
          // keyed off decision.action.targetId instead of outcome.target.
          record({
            characterId: "c_crate_walker",
            decision: moveDecision(2),
            lootOutcomeFeed: [
              { result: "opened", item: "sword", target: "Crate_30_40" },
            ],
          }),
          // Drained a corpse last turn, attacking this turn.
          record({
            characterId: "c_corpse_attacker",
            decision: moveDecision(0, { kind: "attack", targetId: "Rat" }),
            lootOutcomeFeed: [
              { result: "looted", item: "leather", target: "Corpse_Rat" },
            ],
          }),
          // Opened a dud crate last turn (no item), idle now.
          record({
            characterId: "c_dud_crate",
            decision: NONE_DECISION,
            lootOutcomeFeed: [
              { result: "opened", target: "Crate_70_70" },
            ],
          }),
          // Hit an already-drained corpse last turn, idle now.
          record({
            characterId: "c_drained_corpse",
            decision: NONE_DECISION,
            lootOutcomeFeed: [
              { result: "already_opened", target: "Corpse_Duelist" },
            ],
          }),
        ],
      }),
    ];

    const out = computeMechanicsDiagnostics(rows);

    expect(out.loot.crate).toMatchObject({
      opened: 2,
      equipped: 1,
    });
    expect(out.loot.corpse).toMatchObject({
      looted: 1,
      drainedRepeat: 1,
    });
  });
});

describe("diagnostics behaviour", () => {
  it("separates armed stance pauses from true stationary no-ops", () => {
    const rows = [
      turn({
        turn: 12,
        agentRecords: [
          record({
            characterId: "c_overwatch",
            personaId: "camper",
            decision: {
              ...NONE_DECISION,
              position: { kind: "overwatch" },
            },
            visibleSummary: {
              enemies: 1,
              crates: 0,
              corpses: 0,
              evacSeen: false,
            },
          }),
          record({
            characterId: "c_stationary",
            personaId: "rat",
            decision: moveDecision(0),
            visibleSummary: {
              enemies: 1,
              crates: 0,
              corpses: 0,
              evacSeen: false,
            },
          }),
          record({
            characterId: "c_actor",
            personaId: "duelist",
            scratchpadChanged: true,
            selfEquipment: {
              weapon: "sword",
              armour: "leather",
              consumable: "heal",
            },
            selfHp: { hp: 40, maxHp: 40 },
            decision: {
              ...moveDecision(3, {
                kind: "attack",
                targetId: "Trader",
              }),
              use: "consumable",
            },
          }),
        ],
      }),
    ];

    const out: BehaviourDiagnostics = computeBehaviourDiagnostics(rows);

    expect(out.noOpSplit.armedStancePauseCount).toBe(1);
    expect(out.noOpSplit.trueStationaryCount).toBe(1);
    expect(out.noOpSplit.armedStancePauseRate).toBeCloseTo(1 / 3);
    expect(out.noOpSplit.trueStationaryRate).toBeCloseTo(1 / 3);
    expect(out.sawEnemyAndNoOp).toMatchObject({
      armedStancePause: 1,
      trueStationary: 1,
    });
    expect(out.contextualCombos["move+attack"]?.count).toBe(1);
    expect(out.contextualCombos["consume:heal at full HP"]?.count).toBe(1);
    expect(out.crossCuts.persona.camper?.visibility.enemyVisible).toBe(1);
    expect(out.crossCuts.equipment["armed|leather|consumable:heal"] ?? 0).toBe(1);
  });
});

describe("diagnostics renderers and CLI orchestration", () => {
  it("emits well-formed JSON and markdown with drill-down links", () => {
    const rows = [
      turn({
        matchId: "M1",
        turn: 1,
        agentRecords: [
          record({
            characterId: "c_duelist",
            personaId: "duelist",
            decision: moveDecision(2, {
              kind: "attack",
              targetId: "Trader",
            }),
          }),
        ],
      }),
    ];
    const report = buildDiagnosticsReport([rows]);

    expect(JSON.parse(renderDiagnosticsJson(report))).toMatchObject({
      metadata: {
        matchCount: 1,
        turnCount: 1,
        recordCount: 1,
      },
    });

    const markdown = renderDiagnosticsMarkdown(report);
    expect(markdown).toContain("## Behaviour");
    expect(markdown).toContain("#/match/M1?turn=1&character=Duelist");
  });

  it("clamps --last to 20 and runs against mocked slim rows", async () => {
    const rows = [
      turn({
        matchId: "M1",
        turn: 1,
        agentRecords: [record({ characterId: "c_duelist" })],
      }),
    ];
    let requestedLast = 0;
    let fetchedMatchIds: string[] = [];
    let stdout = "";
    const client: DiagnosticsClient = {
      query: async () => {
        throw new Error("query should not be used when deps are injected");
      },
    };

    const result = await runDiagnosticsCli(
      ["--last", "200", "--format", "json"],
      {
        client,
        listMatches: async (_client, last) => {
          requestedLast = last;
          return [{ _id: "M1" }];
        },
        fetchSlimAcross: async (_client, matchIds) => {
          fetchedMatchIds = matchIds;
          return [rows];
        },
        writeStdout: (text) => {
          stdout += text;
        },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(requestedLast).toBe(20);
    expect(fetchedMatchIds).toEqual(["M1"]);
    expect(JSON.parse(stdout)).toMatchObject({
      metadata: {
        matchIds: ["M1"],
        matchCount: 1,
      },
    });
  });
});
