// Phase 6 closing-20 report writer.
//
// Computes the iter-2 mechanics gates directly from persisted turn traces and
// writes a reports row with reportType "phase-6-closing-20".

import { v } from "convex/values";
import { mutation, type MutationCtx } from "../_generated/server.js";
import type { Id } from "../_generated/dataModel.js";
import {
  PERSONA_IDS,
  type ParsedDecision,
  type PersonaId,
  type UseVariant,
} from "../engine/types.js";
import { hashMatchIds } from "../reports.js";

const EXTRACTION_THRESHOLD = 0.30;
const KILL_THRESHOLD = 0.80;
const EQUIP_THRESHOLD = 0.80;
const SPEECH_THRESHOLD = 0.50;
const PERSONA_SPREAD_THRESHOLD_PP = 15;
const ACTION_OVERWATCH_COMBO_THRESHOLD = 10;
const OVERWATCH_TRIGGER_THRESHOLD = 5;
const COUNTER_THRESHOLD = 5;
const PER_FIELD_REJECTION_THRESHOLD = 0.10;
const NO_OP_THRESHOLD = 0.05;

const COMPASS = new Set(["N", "NE", "E", "SE", "S", "SW", "W", "NW"]);
const DECISION_FIELDS = [
  "use",
  "position",
  "action",
  "say",
  "scratchpad",
] as const;
const PLAYER_N_PATTERN = /Player_\d+/g;
const DAMAGE_FEED_AUDIT_SCOPE_NOTE =
  "damageFeedAuditSamples are the deterministic first 20 eligible post-damage turns in match/turn/record iteration order; damage on the final turn and damage where the victim has no next-turn agent record (including victim dies) are intentionally outside the audit window.";

type ValidatorFieldName = (typeof DECISION_FIELDS)[number];
type ValidatorFieldErrors = Partial<Record<ValidatorFieldName, string>>;

type DamageAuditSample = {
  matchId: string;
  turn: number;
  observer: string;
  attacker: string;
  expectedLine: string;
  present: boolean;
};

export type Phase6Payload = {
  reportType: "phase-6-closing-20";
  runCount: number;
  matchIds: string[];
  failedMatches: number;
  runsWithExtraction: number;
  runsWithKill: number;
  runsWithEquip: number;
  runsWithSpeech: number;
  extractionRate: number;
  killRate: number;
  equipRate: number;
  speechRate: number;
  perPersona: Array<{
    personaId: PersonaId;
    extractionsCount: number;
    extractionRate: number;
  }>;
  personaExtractionSpread: number;
  totalAgentRecords: number;
  nullOnlyUseViolations: number;
  actionOverwatchCombos: number;
  overwatchTriggerFires: number;
  counterRetaliations: number;
  compassBearings: string[];
  targetRelativeKinds: string[];
  damageFeedEvents: number;
  damageFeedMissing: number;
  damageFeedAuditSamples: DamageAuditSample[];
  damageFeedAuditScopeNote: string;
  validatorRecords: number;
  validatorFieldErrors: number;
  perFieldRejectionRate: number;
  wholeTurnZeroedValidatorRecords: number;
  noOpCount: number;
  noOpRate: number;
  playerNLiteralCount: number;
  meetsExtractionThreshold: boolean;
  meetsKillThreshold: boolean;
  meetsEquipThreshold: boolean;
  meetsSpeechThreshold: boolean;
  meetsPersonaSpreadThreshold: boolean;
  meetsUseVariantThreshold: boolean;
  meetsActionOverwatchComboThreshold: boolean;
  meetsOverwatchTriggerThreshold: boolean;
  meetsCounterThreshold: boolean;
  meetsCompassThreshold: boolean;
  meetsTargetRelativeThreshold: boolean;
  meetsDamageFeedThreshold: boolean;
  meetsFieldScopedThreshold: boolean;
  meetsPerFieldRejectionThreshold: boolean;
  meetsNoOpThreshold: boolean;
  meetsPersonaIdThreshold: boolean;
  meetsZeroCrashThreshold: boolean;
  meetsAllThresholds: boolean;
};

export type Phase6ActionTraceEntry = {
  characterId: string;
  kind: "attack" | "loot" | "overwatch" | "counter" | string;
  target: string;
  result: string;
  triggeredByMovement?: boolean;
  weapon?: string;
};

export type Phase6AgentRecord = {
  characterId: string;
  personaId: PersonaId;
  input: {
    composedUserMessage?: string;
    personaPromptText?: string;
    useVariant?: UseVariant;
  };
  decision: ParsedDecision;
  scratchpadAfter?: string;
  llm: {
    rawArguments: string | null;
    validatorFieldErrors?: ValidatorFieldErrors;
  };
};

export type Phase6TurnRow = {
  matchId: string;
  turn: number;
  agentRecords: Phase6AgentRecord[];
  resolution: {
    actions: Phase6ActionTraceEntry[];
  };
};

export type Phase6CharacterRow = {
  characterId: string;
  displayName: string;
  personaId: PersonaId;
};

export type Phase6RunStatsRow = {
  extractions: number;
  kills: number;
  equips: number;
  speechEvents: number;
  perPersona: Array<{
    personaId: PersonaId;
    extracted: number;
  }>;
};

export type Phase6RunInput = {
  matchId: string;
  failed: boolean;
  run: Phase6RunStatsRow | null;
  turns: Phase6TurnRow[];
  characters: Phase6CharacterRow[];
};

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function isDamageResult(result: string): boolean {
  return /^dmg \d+$/.test(result);
}

function damageAmount(result: string): number | null {
  const match = /^dmg (\d+)$/.exec(result);
  return match ? Number(match[1]) : null;
}

function weaponName(weapon: string | undefined): string {
  return weapon && weapon.trim().length > 0 ? weapon : "bare hands";
}

function countPlayerNInText(text: string | null | undefined): number {
  return (text?.match(PLAYER_N_PATTERN) ?? []).length;
}

function countPlayerNInDecisionTargets(decision: ParsedDecision): number {
  let count = 0;
  if (decision.action.kind !== "none") {
    count += countPlayerNInText(decision.action.targetId);
  }
  if (
    decision.position.kind === "move" &&
    (decision.position.direction.kind === "toward" ||
      decision.position.direction.kind === "away")
  ) {
    count += countPlayerNInText(decision.position.direction.targetId);
  }
  return count;
}

function countPlayerNInRecordSurfaces(record: Phase6AgentRecord): number {
  return (
    countPlayerNInText(record.input.composedUserMessage) +
    countPlayerNInText(record.input.personaPromptText) +
    countPlayerNInText(record.llm.rawArguments) +
    countPlayerNInDecisionTargets(record.decision)
  );
}

function countPlayerNInReportPayloadSurfaces(payload: Phase6Payload): number {
  return payload.damageFeedAuditSamples.reduce(
    (count, sample) =>
      count +
      countPlayerNInText(sample.observer) +
      countPlayerNInText(sample.attacker) +
      countPlayerNInText(sample.expectedLine),
    0,
  );
}

function rawArgumentsEmittedConsumable(rawArguments: string | null): boolean {
  if (rawArguments === null) return false;
  try {
    const parsed = JSON.parse(rawArguments) as unknown;
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      "use" in parsed &&
      (parsed as { use?: unknown }).use === "consumable"
    );
  } catch {
    return false;
  }
}

function characterDisplayName(
  characters: Phase6CharacterRow[],
  characterId: string,
): string {
  return characters.find((c) => c.characterId === characterId)?.displayName ?? characterId;
}

function isSuccessfulActionOutcome(
  kind: "attack" | "loot",
  result: string,
): boolean {
  if (kind === "attack") return isDamageResult(result);
  return result === "looted" || result === "opened";
}

export function computePhase6Metrics(runs: Phase6RunInput[]): Phase6Payload {
  let failedMatches = 0;
  let runsWithExtraction = 0;
  let runsWithKill = 0;
  let runsWithEquip = 0;
  let runsWithSpeech = 0;
  let totalAgentRecords = 0;
  let nullOnlyUseViolations = 0;
  let actionOverwatchCombos = 0;
  let overwatchTriggerFires = 0;
  let counterRetaliations = 0;
  let damageFeedEvents = 0;
  let damageFeedMissing = 0;
  let validatorRecords = 0;
  let validatorFieldErrors = 0;
  let wholeTurnZeroedValidatorRecords = 0;
  let noOpCount = 0;
  let playerNLiteralCount = 0;
  const compassBearings = new Set<string>();
  const targetRelativeKinds = new Set<string>();
  const damageFeedAuditSamples: DamageAuditSample[] = [];
  const perPersonaExtractions = new Map<PersonaId, number>(
    PERSONA_IDS.map((p) => [p, 0]),
  );

  for (const runInput of runs) {
    if (runInput.failed) failedMatches += 1;

    const run = runInput.run;
    if (run) {
      if (run.extractions > 0) runsWithExtraction += 1;
      if (run.kills > 0) runsWithKill += 1;
      if (run.equips > 0) runsWithEquip += 1;
      if (run.speechEvents > 0) runsWithSpeech += 1;
      for (const persona of run.perPersona) {
        if (persona.extracted > 0) {
          perPersonaExtractions.set(
            persona.personaId,
            (perPersonaExtractions.get(persona.personaId) ?? 0) + 1,
          );
        }
      }
    }

    const characters = runInput.characters;
    const characterByName = new Map(
      characters.map((c) => [c.displayName, c.characterId]),
    );
    for (const character of characters) {
      playerNLiteralCount += countPlayerNInText(character.displayName);
    }

    const turns = [...runInput.turns].sort((a, b) => a.turn - b.turn);
    const turnByNumber = new Map(turns.map((t) => [t.turn, t]));

    for (const turn of turns) {
      for (const action of turn.resolution.actions) {
        playerNLiteralCount += countPlayerNInText(action.target);

        if (
          action.kind === "overwatch" &&
          action.triggeredByMovement === true &&
          isDamageResult(action.result)
        ) {
          overwatchTriggerFires += 1;
        }
        if (action.kind === "counter" && isDamageResult(action.result)) {
          counterRetaliations += 1;
        }
      }

      for (const record of turn.agentRecords) {
        totalAgentRecords += 1;
        playerNLiteralCount += countPlayerNInRecordSurfaces(record);

        if (
          record.input.useVariant === "null_only" &&
          rawArgumentsEmittedConsumable(record.llm.rawArguments)
        ) {
          nullOnlyUseViolations += 1;
        }

        const comboAction = record.decision.action;
        if (
          record.decision.position.kind === "overwatch" &&
          (comboAction.kind === "attack" || comboAction.kind === "loot")
        ) {
          const comboKind = comboAction.kind;
          const resolved = turn.resolution.actions.some(
            (a) =>
              a.characterId === record.characterId &&
              a.kind === comboKind &&
              isSuccessfulActionOutcome(comboKind, a.result),
          );
          if (resolved) actionOverwatchCombos += 1;
        }

        if (record.decision.position.kind === "move") {
          const direction = record.decision.position.direction;
          if (COMPASS.has(direction.kind)) {
            compassBearings.add(direction.kind);
          } else {
            targetRelativeKinds.add(direction.kind);
          }
        }

        const errors = record.llm.validatorFieldErrors;
        if (errors && Object.keys(errors).length > 0) {
          validatorRecords += 1;
          const keys = Object.keys(errors);
          validatorFieldErrors += keys.length;
          if (DECISION_FIELDS.every((field) => keys.includes(field))) {
            wholeTurnZeroedValidatorRecords += 1;
          }
        }

        const positionNoMove =
          record.decision.position.kind !== "move" ||
          record.decision.position.dist === 0;
        if (
          record.decision.use === null &&
          record.decision.say === null &&
          record.decision.action.kind === "none" &&
          positionNoMove
        ) {
          noOpCount += 1;
        }
      }

      const nextTurn = turnByNumber.get(turn.turn + 1);
      if (!nextTurn) continue;
      for (const action of turn.resolution.actions) {
        if (
          action.kind !== "attack" &&
          action.kind !== "overwatch" &&
          action.kind !== "counter"
        ) {
          continue;
        }
        const damage = damageAmount(action.result);
        if (damage === null) continue;
        const victimId = characterByName.get(action.target);
        if (!victimId) continue;
        const nextRecord = nextTurn.agentRecords.find(
          (r) => r.characterId === victimId,
        );
        if (!nextRecord) continue;
        const attacker = characterDisplayName(characters, action.characterId);
        const expectedLine = `${attacker} attacked you with ${weaponName(
          action.weapon,
        )} (dmg ${damage})`;
        const present =
          nextRecord.input.composedUserMessage?.includes(expectedLine) ?? false;
        damageFeedEvents += 1;
        if (!present) damageFeedMissing += 1;
        if (damageFeedAuditSamples.length < 20) {
          damageFeedAuditSamples.push({
            matchId: runInput.matchId,
            turn: turn.turn + 1,
            observer: action.target,
            attacker,
            expectedLine,
            present,
          });
        }
      }
    }
  }

  const runCount = runs.length;
  const matchIds = runs.map((r) => r.matchId);
  const extractionRate = rate(runsWithExtraction, runCount);
  const killRate = rate(runsWithKill, runCount);
  const equipRate = rate(runsWithEquip, runCount);
  const speechRate = rate(runsWithSpeech, runCount);
  const perPersona = PERSONA_IDS.map((personaId) => ({
    personaId,
    extractionsCount: perPersonaExtractions.get(personaId) ?? 0,
    extractionRate: rate(perPersonaExtractions.get(personaId) ?? 0, runCount),
  }));
  const personaRates = perPersona.map((p) => p.extractionRate);
  const personaExtractionSpread =
    personaRates.length === 0
      ? 0
      : (Math.max(...personaRates) - Math.min(...personaRates)) * 100;
  const perFieldRejectionRate = rate(
    validatorFieldErrors,
    totalAgentRecords * DECISION_FIELDS.length,
  );
  const noOpRate = rate(noOpCount, totalAgentRecords);

  const basePayload = buildPayload({
    runCount,
    matchIds,
    failedMatches,
    runsWithExtraction,
    runsWithKill,
    runsWithEquip,
    runsWithSpeech,
    extractionRate,
    killRate,
    equipRate,
    speechRate,
    perPersona,
    personaExtractionSpread,
    totalAgentRecords,
    nullOnlyUseViolations,
    actionOverwatchCombos,
    overwatchTriggerFires,
    counterRetaliations,
    compassBearings: [...compassBearings].sort(),
    targetRelativeKinds: [...targetRelativeKinds].sort(),
    damageFeedEvents,
    damageFeedMissing,
    damageFeedAuditSamples,
    validatorRecords,
    validatorFieldErrors,
    perFieldRejectionRate,
    wholeTurnZeroedValidatorRecords,
    noOpCount,
    noOpRate,
    playerNLiteralCount,
  });
  const reportPayloadPlayerNCount =
    countPlayerNInReportPayloadSurfaces(basePayload);
  if (reportPayloadPlayerNCount === 0) return basePayload;
  return buildPayload({
    ...basePayload,
    playerNLiteralCount:
      basePayload.playerNLiteralCount + reportPayloadPlayerNCount,
  });
}

async function persistPhase6Payload(
  ctx: MutationCtx,
  {
    matchIds,
    overwrite,
    payload,
  }: {
    matchIds: Array<Id<"matches">>;
    overwrite?: boolean;
    payload: Phase6Payload;
  },
): Promise<{
  _id: string;
  existed: boolean;
  payload: Phase6Payload;
}> {
  if (payload.reportType !== "phase-6-closing-20") {
    throw new Error(
      `Expected phase-6-closing-20 payload, got ${payload.reportType}`,
    );
  }
  if (payload.runCount !== matchIds.length) {
    throw new Error(
      `Phase 6 payload runCount ${payload.runCount} does not match ${matchIds.length} match ids`,
    );
  }

  const matchIdStrings = matchIds.map((m) => m as unknown as string);
  const matchIdsHash = await hashMatchIds(matchIdStrings);
  const reportType = "phase-6-closing-20";

  const existing = await ctx.db
    .query("reports")
    .withIndex("by_matchIdsHash_reportType", (q) =>
      q.eq("matchIdsHash", matchIdsHash).eq("reportType", reportType),
    )
    .unique();
  if (existing && overwrite !== true) {
    return {
      _id: existing._id as unknown as string,
      existed: true,
      payload: existing.phase6Payload as Phase6Payload,
    };
  }
  if (existing && overwrite === true) {
    await ctx.db.delete(existing._id);
  }

  const runIds: Array<Id<"runs">> = [];
  for (const matchId of matchIds) {
    const run = await ctx.db
      .query("runs")
      .withIndex("by_match", (q) => q.eq("matchId", matchId))
      .unique();
    if (run) {
      runIds.push(run._id);
    }
  }

  const insertedId = await ctx.db.insert("reports", {
    runIds,
    runCount: payload.runCount,
    generatedAt: Date.now(),
    metrics: {
      extractionRate: payload.extractionRate,
      runsWithKill: payload.runsWithKill,
      runsWithEquip: payload.runsWithEquip,
      runsWithSpeech: payload.runsWithSpeech,
      perPersonaExtractionRate: payload.perPersona.map((p) => ({
        personaId: p.personaId,
        rate: p.extractionRate,
      })),
      personaSpread: payload.personaExtractionSpread,
    },
    metBar: payload.meetsAllThresholds,
    matchIds,
    matchIdsHash,
    reportType,
    payload: {
      runCount: payload.runCount,
      kills: 0,
      extractions: payload.runsWithExtraction,
      equips: 0,
      speechEvents: 0,
      runsWithAtLeastOneKill: payload.runsWithKill,
      runsWithAtLeastOneExtraction: payload.runsWithExtraction,
      runsWithAtLeastOneEquip: payload.runsWithEquip,
      runsWithAtLeastOneSpeech: payload.runsWithSpeech,
      killRate: payload.killRate,
      extractionRate: payload.extractionRate,
      equipRate: payload.equipRate,
      speechRate: payload.speechRate,
      perPersona: payload.perPersona.map((p) => ({
        personaId: p.personaId,
        kills: 0,
        equips: 0,
        speechEvents: 0,
        extracted: p.extractionsCount,
        extractionsCount: p.extractionsCount,
        extractionRate: p.extractionRate,
      })),
      personaExtractionSpread: payload.personaExtractionSpread,
      meetsExtractionThreshold: payload.meetsExtractionThreshold,
      meetsKillThreshold: payload.meetsKillThreshold,
      meetsEquipThreshold: payload.meetsEquipThreshold,
      meetsSpeechThreshold: payload.meetsSpeechThreshold,
      meetsPersonaSpreadThreshold: payload.meetsPersonaSpreadThreshold,
      meetsAllThresholds: payload.meetsAllThresholds,
    },
    missingRunsForMatchIds: [],
    phase6Payload: payload,
  });

  return {
    _id: insertedId as unknown as string,
    existed: false,
    payload,
  };
}

export const persistComputedPhase6Report = mutation({
  args: {
    matchIds: v.array(v.id("matches")),
    overwrite: v.optional(v.boolean()),
    payload: v.any(),
  },
  handler: async (
    ctx,
    { matchIds, overwrite, payload },
  ): Promise<{
    _id: string;
    existed: boolean;
    payload: Phase6Payload;
  }> => {
    return persistPhase6Payload(ctx, {
      matchIds,
      overwrite,
      payload: payload as Phase6Payload,
    });
  },
});

function buildPayload(
  input: Omit<
    Phase6Payload,
    | "reportType"
    | "damageFeedAuditScopeNote"
    | "meetsExtractionThreshold"
    | "meetsKillThreshold"
    | "meetsEquipThreshold"
    | "meetsSpeechThreshold"
    | "meetsPersonaSpreadThreshold"
    | "meetsUseVariantThreshold"
    | "meetsActionOverwatchComboThreshold"
    | "meetsOverwatchTriggerThreshold"
    | "meetsCounterThreshold"
    | "meetsCompassThreshold"
    | "meetsTargetRelativeThreshold"
    | "meetsDamageFeedThreshold"
    | "meetsFieldScopedThreshold"
    | "meetsPerFieldRejectionThreshold"
    | "meetsNoOpThreshold"
    | "meetsPersonaIdThreshold"
    | "meetsZeroCrashThreshold"
    | "meetsAllThresholds"
  >,
): Phase6Payload {
  const meetsExtractionThreshold =
    input.extractionRate >= EXTRACTION_THRESHOLD;
  const meetsKillThreshold = input.killRate >= KILL_THRESHOLD;
  const meetsEquipThreshold = input.equipRate >= EQUIP_THRESHOLD;
  const meetsSpeechThreshold = input.speechRate >= SPEECH_THRESHOLD;
  const meetsPersonaSpreadThreshold =
    input.personaExtractionSpread >= PERSONA_SPREAD_THRESHOLD_PP;
  const meetsUseVariantThreshold = input.nullOnlyUseViolations === 0;
  const meetsActionOverwatchComboThreshold =
    input.actionOverwatchCombos >= ACTION_OVERWATCH_COMBO_THRESHOLD;
  const meetsOverwatchTriggerThreshold =
    input.overwatchTriggerFires >= OVERWATCH_TRIGGER_THRESHOLD;
  const meetsCounterThreshold = input.counterRetaliations >= COUNTER_THRESHOLD;
  const meetsCompassThreshold = COMPASS.size === input.compassBearings.length;
  const meetsTargetRelativeThreshold =
    input.targetRelativeKinds.includes("toward") &&
    input.targetRelativeKinds.includes("away");
  const meetsDamageFeedThreshold =
    input.damageFeedEvents > 0 && input.damageFeedMissing === 0;
  const meetsFieldScopedThreshold =
    input.wholeTurnZeroedValidatorRecords === 0;
  const meetsPerFieldRejectionThreshold =
    input.perFieldRejectionRate <= PER_FIELD_REJECTION_THRESHOLD;
  const meetsNoOpThreshold = input.noOpRate < NO_OP_THRESHOLD;
  const meetsPersonaIdThreshold = input.playerNLiteralCount === 0;
  const meetsZeroCrashThreshold = input.failedMatches === 0;

  const thresholdFlags = [
    meetsExtractionThreshold,
    meetsKillThreshold,
    meetsEquipThreshold,
    meetsSpeechThreshold,
    meetsPersonaSpreadThreshold,
    meetsUseVariantThreshold,
    meetsActionOverwatchComboThreshold,
    meetsOverwatchTriggerThreshold,
    meetsCounterThreshold,
    meetsCompassThreshold,
    meetsTargetRelativeThreshold,
    meetsDamageFeedThreshold,
    meetsFieldScopedThreshold,
    meetsPerFieldRejectionThreshold,
    meetsNoOpThreshold,
    meetsPersonaIdThreshold,
    meetsZeroCrashThreshold,
  ];

  return {
    reportType: "phase-6-closing-20",
    ...input,
    damageFeedAuditScopeNote: DAMAGE_FEED_AUDIT_SCOPE_NOTE,
    meetsExtractionThreshold,
    meetsKillThreshold,
    meetsEquipThreshold,
    meetsSpeechThreshold,
    meetsPersonaSpreadThreshold,
    meetsUseVariantThreshold,
    meetsActionOverwatchComboThreshold,
    meetsOverwatchTriggerThreshold,
    meetsCounterThreshold,
    meetsCompassThreshold,
    meetsTargetRelativeThreshold,
    meetsDamageFeedThreshold,
    meetsFieldScopedThreshold,
    meetsPerFieldRejectionThreshold,
    meetsNoOpThreshold,
    meetsPersonaIdThreshold,
    meetsZeroCrashThreshold,
    meetsAllThresholds: thresholdFlags.every(Boolean),
  };
}

export const computeAndPersistPhase6Report = mutation({
  args: {
    matchIds: v.array(v.id("matches")),
    overwrite: v.optional(v.boolean()),
  },
  handler: async (ctx, { matchIds, overwrite }): Promise<{
    _id: string;
    existed: boolean;
    payload: Phase6Payload;
  }> => {
    const matchIdStrings = matchIds.map((m) => m as unknown as string);
    const matchIdsHash = await hashMatchIds(matchIdStrings);
    const reportType = "phase-6-closing-20";

    const existing = await ctx.db
      .query("reports")
      .withIndex("by_matchIdsHash_reportType", (q) =>
        q.eq("matchIdsHash", matchIdsHash).eq("reportType", reportType),
      )
      .unique();
    if (existing && overwrite !== true) {
      return {
        _id: existing._id as unknown as string,
        existed: true,
        payload: existing.phase6Payload as Phase6Payload,
      };
    }
    if (existing && overwrite === true) {
      await ctx.db.delete(existing._id);
    }

    const runIds: Array<Id<"runs">> = [];
    const reportInputs: Phase6RunInput[] = [];

    for (const matchId of matchIds) {
      const match = await ctx.db.get(matchId);

      const run = await ctx.db
        .query("runs")
        .withIndex("by_match", (q) => q.eq("matchId", matchId))
        .unique();
      if (run) {
        runIds.push(run._id);
      }

      const characters = await ctx.db
        .query("characters")
        .withIndex("by_match", (q) => q.eq("matchId", matchId))
        .collect();
      const turns = await ctx.db
        .query("turns")
        .withIndex("by_match_turn", (q) => q.eq("matchId", matchId))
        .order("asc")
        .collect();
      reportInputs.push({
        matchId: matchId as unknown as string,
        failed: !match || match.status === "failed",
        run: run
          ? {
              extractions: run.extractions,
              kills: run.kills,
              equips: run.equips,
              speechEvents: run.speechEvents,
              perPersona: run.perPersona.map((p) => ({
                personaId: p.personaId,
                extracted: p.extracted,
              })),
            }
          : null,
        characters: characters.map((c) => ({
          characterId: c._id as unknown as string,
          displayName: c.displayName,
          personaId: c.personaId,
        })),
        turns: turns.map((turn) => ({
          matchId: turn.matchId as unknown as string,
          turn: turn.turn,
          agentRecords: turn.agentRecords.map((record) => ({
            characterId: record.characterId as unknown as string,
            personaId: record.personaId,
            input: {
              composedUserMessage: record.input.composedUserMessage,
              personaPromptText: record.input.personaPromptText,
              useVariant: record.input.useVariant,
            },
            decision: record.decision,
            scratchpadAfter: record.scratchpadAfter,
            llm: {
              rawArguments: record.llm.rawArguments,
              validatorFieldErrors: record.llm.validatorFieldErrors,
            },
          })),
          resolution: {
            actions: turn.resolution.actions.map((action) => ({
              characterId: action.characterId as unknown as string,
              kind: action.kind,
              target: action.target,
              result: action.result,
              triggeredByMovement: action.triggeredByMovement,
              weapon: action.weapon,
            })),
          },
        })),
      });
    }

    const payload = computePhase6Metrics(reportInputs);

    const insertedId = await ctx.db.insert("reports", {
      runIds,
      runCount: payload.runCount,
      generatedAt: Date.now(),
      metrics: {
        extractionRate: payload.extractionRate,
        runsWithKill: payload.runsWithKill,
        runsWithEquip: payload.runsWithEquip,
        runsWithSpeech: payload.runsWithSpeech,
        perPersonaExtractionRate: payload.perPersona.map((p) => ({
          personaId: p.personaId,
          rate: p.extractionRate,
        })),
        personaSpread: payload.personaExtractionSpread,
      },
      metBar: payload.meetsAllThresholds,
      matchIds,
      matchIdsHash,
      reportType,
      payload: {
        runCount: payload.runCount,
        kills: 0,
        extractions: payload.runsWithExtraction,
        equips: 0,
        speechEvents: 0,
        runsWithAtLeastOneKill: payload.runsWithKill,
        runsWithAtLeastOneExtraction: payload.runsWithExtraction,
        runsWithAtLeastOneEquip: payload.runsWithEquip,
        runsWithAtLeastOneSpeech: payload.runsWithSpeech,
        killRate: payload.killRate,
        extractionRate: payload.extractionRate,
        equipRate: payload.equipRate,
        speechRate: payload.speechRate,
        perPersona: payload.perPersona.map((p) => ({
          personaId: p.personaId,
          kills: 0,
          equips: 0,
          speechEvents: 0,
          extracted: p.extractionsCount,
          extractionsCount: p.extractionsCount,
          extractionRate: p.extractionRate,
        })),
        personaExtractionSpread: payload.personaExtractionSpread,
        meetsExtractionThreshold: payload.meetsExtractionThreshold,
        meetsKillThreshold: payload.meetsKillThreshold,
        meetsEquipThreshold: payload.meetsEquipThreshold,
        meetsSpeechThreshold: payload.meetsSpeechThreshold,
        meetsPersonaSpreadThreshold: payload.meetsPersonaSpreadThreshold,
        meetsAllThresholds: payload.meetsAllThresholds,
      },
      missingRunsForMatchIds: [],
      phase6Payload: payload,
    });

    return {
      _id: insertedId as unknown as string,
      existed: false,
      payload,
    };
  },
});
