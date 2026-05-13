// Phase 7 closing-20 report writer.
//
// The heavy trace aggregation path is intentionally local: callers fan out
// `turns.byMatchSlim` per match, compute this small payload client-side, then
// call `persistComputedPhase7Report`. The mutation below does not read turns.

import { v } from "convex/values";
import type { Id } from "../_generated/dataModel.js";
import { mutation, type MutationCtx } from "../_generated/server.js";
import {
  PERSONA_IDS,
  type ParsedDecision,
  type PersonaId,
} from "../engine/types.js";
import { hashMatchIds } from "../reports.js";
import { computeBehaviourDiagnostics } from "../../harness/diagnostics/behaviour.js";
import { computeCriticalDiagnostics } from "../../harness/diagnostics/critical.js";
import { computeMechanicsDiagnostics } from "../../harness/diagnostics/mechanics.js";
import type {
  SlimAgentRecord,
  SlimTurnRow,
  ValidatorFieldName,
} from "../../harness/diagnostics/types.js";

const EXTRACTION_THRESHOLD = 0.30;
const KILL_THRESHOLD = 0.80;
const EQUIP_THRESHOLD = 0.80;
const SPEECH_THRESHOLD = 0.50;
const PERSONA_SPREAD_THRESHOLD_PP = 15;
const ACTION_OVERWATCH_COMBO_THRESHOLD = 10;
const OVERWATCH_TRIGGER_THRESHOLD = 5;
const COUNTER_THRESHOLD = 5;
const PER_FIELD_REJECTION_THRESHOLD = 0.10;

const COMPASS = new Set(["N", "NE", "E", "SE", "S", "SW", "W", "NW"]);
const DECISION_FIELDS: ValidatorFieldName[] = [
  "use",
  "position",
  "action",
  "say",
  "scratchpad",
];
const PLAYER_N_PATTERN = /Player_\d+/g;
const LEGACY_CHEST_PATTERN = /\bchest_\d+\b/g;
const DAMAGE_FEED_AUDIT_SCOPE_NOTE =
  "Phase 7 closing uses byMatchSlim damageFeedAudit delivery counters computed from next-turn composed user messages before heavy text is stripped; final-turn damage and victims without next-turn records are outside the audit window.";

export type Phase7PerPersonaStats = {
  personaId: PersonaId;
  extractionsCount: number;
  extractionRate: number;
};

export type Phase7Payload = {
  reportType: "phase-7-closing-20";
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
  perPersona: Phase7PerPersonaStats[];
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
  damageFeedAuditScopeNote: string;
  validatorRecords: number;
  validatorFieldErrors: number;
  perFieldRejectionRate: number;
  wholeTurnZeroedValidatorRecords: number;
  armedStancePauseCount: number;
  armedStancePauseRate: number;
  trueStationaryCount: number;
  trueStationaryRate: number;
  playerNLiteralCount: number;

  inboundSpeechDelivered: number;
  lootSuccesses: number;
  lootSuccessesNamed: number;
  lootSuccessNamingRate: number;
  lootFailureOutcomes: number;
  lootFailuresMarkedEmpty: number;
  lootEmptyMarkingRate: number;
  legacyChestLiteralCount: number;
  retryAttempts: number;
  retryRecovered: number;
  retryFailedAfterRetry: number;
  retryRecoveryRate: number;

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
  meetsPersonaIdThreshold: boolean;
  meetsZeroCrashThreshold: boolean;
  meetsInboundSpeechThreshold: boolean;
  meetsLootSuccessNamingThreshold: boolean;
  meetsLootEmptyMarkingThreshold: boolean;
  meetsChestLiteralThreshold: boolean;
  meetsAllThresholds: boolean;
};

export type Phase7RunStatsRow = {
  extractions: number;
  kills: number;
  equips: number;
  speechEvents: number;
  perPersona: Array<{
    personaId: PersonaId;
    extracted: number;
  }>;
};

export type Phase7RunInput = {
  matchId: string;
  failed: boolean;
  run: Phase7RunStatsRow | null;
  turns: SlimTurnRow[];
};

type Phase7BuildInput = Omit<
  Phase7Payload,
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
  | "meetsPersonaIdThreshold"
  | "meetsZeroCrashThreshold"
  | "meetsInboundSpeechThreshold"
  | "meetsLootSuccessNamingThreshold"
  | "meetsLootEmptyMarkingThreshold"
  | "meetsChestLiteralThreshold"
  | "meetsAllThresholds"
>;

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function allObservedRate(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

function isDamageResult(result: string): boolean {
  return /^dmg \d+$/.test(result);
}

function isSuccessfulActionOutcome(
  kind: "attack" | "loot",
  result: string,
): boolean {
  if (kind === "attack") return isDamageResult(result);
  return result === "looted" || result === "opened";
}

function countPattern(text: string | null | undefined, pattern: RegExp): number {
  return (text?.match(pattern) ?? []).length;
}

function decisionTargetStrings(decision: ParsedDecision): string[] {
  const targets: string[] = [];
  if (decision.action.kind !== "none") {
    targets.push(decision.action.targetId);
  }
  if (
    decision.position.kind === "move" &&
    (decision.position.direction.kind === "toward" ||
      decision.position.direction.kind === "away")
  ) {
    targets.push(decision.position.direction.targetId);
  }
  return targets;
}

function countPlayerNInRecord(record: SlimAgentRecord): number {
  return [
    ...decisionTargetStrings(record.decision),
    record.decision.say,
    record.decision.scratchpad,
    record.scratchpadAfter,
  ].reduce(
    (count, text) => count + countPattern(text, PLAYER_N_PATTERN),
    0,
  );
}

function countLegacyChestInRecord(record: SlimAgentRecord): number {
  return decisionTargetStrings(record.decision).reduce(
    (count, text) => count + countPattern(text, LEGACY_CHEST_PATTERN),
    0,
  );
}

function countWholeTurnZeroed(errors: Record<string, string>): boolean {
  return DECISION_FIELDS.every((field) => field in errors);
}

function isLootSuccess(result: string): boolean {
  return result === "opened" || result === "looted";
}

function isLootMarkedEmpty(result: string): boolean {
  return result === "empty" || result === "already_opened" || result === "no_corpse";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function auditNumber(
  source: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return value;
    }
  }
  return null;
}

function hasExplicitDamageDeliveryFields(source: Record<string, unknown>): boolean {
  return (
    auditNumber(source, [
      "expected",
      "deliveryExpected",
      "feedExpected",
      "incomingExpected",
      "expectedIncoming",
    ]) !== null ||
    auditNumber(source, [
      "delivered",
      "deliveryDelivered",
      "feedDelivered",
      "incomingDelivered",
      "incoming",
    ]) !== null ||
    auditNumber(source, [
      "missing",
      "deliveryMissing",
      "feedMissing",
      "incomingMissing",
      "missingIncoming",
    ]) !== null
  );
}

function damageFeedDeliveryCounts(record: SlimAgentRecord): {
  events: number;
  missing: number;
} {
  const audit = asRecord(record.damageFeedAudit) ?? {};
  const explicitSource = [
    asRecord(audit.delivery),
    asRecord(audit.feedDelivery),
    audit,
  ].find(
    (source): source is Record<string, unknown> =>
      source !== null && hasExplicitDamageDeliveryFields(source),
  );

  if (explicitSource !== undefined) {
    const expected = auditNumber(explicitSource, [
      "expected",
      "deliveryExpected",
      "feedExpected",
      "incomingExpected",
      "expectedIncoming",
    ]);
    const delivered = auditNumber(explicitSource, [
      "delivered",
      "deliveryDelivered",
      "feedDelivered",
      "incomingDelivered",
      "incoming",
    ]);
    const explicitMissing = auditNumber(explicitSource, [
      "missing",
      "deliveryMissing",
      "feedMissing",
      "incomingMissing",
      "missingIncoming",
    ]);
    const missing =
      explicitMissing ??
      (expected !== null && delivered !== null
        ? Math.max(0, expected - delivered)
        : 0);
    const events = expected ?? (delivered ?? 0) + missing;
    return { events, missing };
  }

  return {
    events: auditNumber(audit, ["incoming"]) ?? 0,
    missing: 0,
  };
}

export function computePhase7Metrics(runs: Phase7RunInput[]): Phase7Payload {
  let failedMatches = 0;
  let runsWithExtraction = 0;
  let runsWithKill = 0;
  let runsWithEquip = 0;
  let runsWithSpeech = 0;
  let nullOnlyUseViolations = 0;
  let actionOverwatchCombos = 0;
  let overwatchTriggerFires = 0;
  let counterRetaliations = 0;
  let damageFeedEvents = 0;
  let damageFeedMissing = 0;
  let validatorRecords = 0;
  let validatorFieldErrors = 0;
  let wholeTurnZeroedValidatorRecords = 0;
  let playerNLiteralCount = 0;
  let legacyChestLiteralCount = 0;
  let lootSuccesses = 0;
  let lootSuccessesNamed = 0;
  let lootFailureOutcomes = 0;
  let lootFailuresMarkedEmpty = 0;
  const compassBearings = new Set<string>();
  const targetRelativeKinds = new Set<string>();
  const perPersonaExtractions = new Map<PersonaId, number>(
    PERSONA_IDS.map((personaId) => [personaId, 0]),
  );
  const rows = runs.flatMap((run) => run.turns);
  const critical = computeCriticalDiagnostics(rows);
  const mechanics = computeMechanicsDiagnostics(rows);
  const behaviour = computeBehaviourDiagnostics(rows);

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
  }

  for (const turn of rows) {
    for (const action of turn.resolution.actions) {
      playerNLiteralCount += countPattern(action.target, PLAYER_N_PATTERN);
      legacyChestLiteralCount += countPattern(
        action.target,
        LEGACY_CHEST_PATTERN,
      );

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

    for (const speech of turn.resolution.speech) {
      playerNLiteralCount += countPattern(speech.text, PLAYER_N_PATTERN);
      legacyChestLiteralCount += countPattern(
        speech.text,
        LEGACY_CHEST_PATTERN,
      );
    }

    for (const record of turn.agentRecords) {
      playerNLiteralCount += countPlayerNInRecord(record);
      legacyChestLiteralCount += countLegacyChestInRecord(record);

      const useErrors = record.llm.validatorFieldErrors?.use;
      if (
        record.input.useVariant === "null_only" &&
        (record.decision.use === "consumable" || useErrors !== undefined)
      ) {
        nullOnlyUseViolations += 1;
      }

      const comboAction = record.decision.action;
      if (
        record.decision.position.kind === "overwatch" &&
        (comboAction.kind === "attack" || comboAction.kind === "loot")
      ) {
        const resolved = turn.resolution.actions.some(
          (action) =>
            action.characterId === record.characterId &&
            action.kind === comboAction.kind &&
            isSuccessfulActionOutcome(comboAction.kind, action.result),
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

      const damageFeed = damageFeedDeliveryCounts(record);
      damageFeedEvents += damageFeed.events;
      damageFeedMissing += damageFeed.missing;

      const errors = record.llm.validatorFieldErrors;
      if (errors !== undefined && Object.keys(errors).length > 0) {
        const keys = Object.keys(errors);
        validatorRecords += 1;
        validatorFieldErrors += keys.length;
        if (countWholeTurnZeroed(errors)) {
          wholeTurnZeroedValidatorRecords += 1;
        }
      }

      for (const outcome of record.lootOutcomeFeed) {
        if (isLootSuccess(outcome.result)) {
          lootSuccesses += 1;
          if (
            outcome.delivered !== false &&
            outcome.item !== undefined &&
            outcome.item.trim().length > 0
          ) {
            lootSuccessesNamed += 1;
          }
        } else {
          lootFailureOutcomes += 1;
          if (outcome.delivered !== false && isLootMarkedEmpty(outcome.result)) {
            lootFailuresMarkedEmpty += 1;
          }
        }
      }
    }
  }

  const runCount = runs.length;
  const matchIds = runs.map((run) => run.matchId);
  const extractionRate = rate(runsWithExtraction, runCount);
  const killRate = rate(runsWithKill, runCount);
  const equipRate = rate(runsWithEquip, runCount);
  const speechRate = rate(runsWithSpeech, runCount);
  const perPersona = PERSONA_IDS.map((personaId) => ({
    personaId,
    extractionsCount: perPersonaExtractions.get(personaId) ?? 0,
    extractionRate: rate(perPersonaExtractions.get(personaId) ?? 0, runCount),
  }));
  const personaRates = perPersona.map((persona) => persona.extractionRate);
  const personaExtractionSpread =
    personaRates.length === 0
      ? 0
      : (Math.max(...personaRates) - Math.min(...personaRates)) * 100;
  const totalAgentRecords = behaviour.totalRecords;
  const perFieldRejectionRate = rate(
    validatorFieldErrors,
    totalAgentRecords * DECISION_FIELDS.length,
  );
  const lootSuccessNamingRate = allObservedRate(
    lootSuccessesNamed,
    lootSuccesses,
  );
  const lootEmptyMarkingRate = allObservedRate(
    lootFailuresMarkedEmpty,
    lootFailureOutcomes,
  );

  return buildPayload({
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
    validatorRecords,
    validatorFieldErrors,
    perFieldRejectionRate,
    wholeTurnZeroedValidatorRecords,
    armedStancePauseCount: behaviour.noOpSplit.armedStancePauseCount,
    armedStancePauseRate: behaviour.noOpSplit.armedStancePauseRate,
    trueStationaryCount: behaviour.noOpSplit.trueStationaryCount,
    trueStationaryRate: behaviour.noOpSplit.trueStationaryRate,
    playerNLiteralCount,
    inboundSpeechDelivered: mechanics.speech.inboundDelivered,
    lootSuccesses,
    lootSuccessesNamed,
    lootSuccessNamingRate,
    lootFailureOutcomes,
    lootFailuresMarkedEmpty,
    lootEmptyMarkingRate,
    legacyChestLiteralCount,
    retryAttempts: critical.retry.attempts,
    retryRecovered: critical.retry.recovered,
    retryFailedAfterRetry: critical.retry.failedAfterRetry,
    retryRecoveryRate: critical.retry.recoveryRate,
  });
}

function buildPayload(input: Phase7BuildInput): Phase7Payload {
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
  const meetsPersonaIdThreshold = input.playerNLiteralCount === 0;
  const meetsZeroCrashThreshold = input.failedMatches === 0;
  const meetsInboundSpeechThreshold = input.inboundSpeechDelivered > 0;
  const meetsLootSuccessNamingThreshold =
    input.lootSuccesses === input.lootSuccessesNamed;
  const meetsLootEmptyMarkingThreshold =
    input.lootFailureOutcomes === input.lootFailuresMarkedEmpty;
  const meetsChestLiteralThreshold = input.legacyChestLiteralCount === 0;

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
    meetsPersonaIdThreshold,
    meetsZeroCrashThreshold,
    meetsInboundSpeechThreshold,
    meetsLootSuccessNamingThreshold,
    meetsLootEmptyMarkingThreshold,
    meetsChestLiteralThreshold,
  ];

  return {
    reportType: "phase-7-closing-20",
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
    meetsPersonaIdThreshold,
    meetsZeroCrashThreshold,
    meetsInboundSpeechThreshold,
    meetsLootSuccessNamingThreshold,
    meetsLootEmptyMarkingThreshold,
    meetsChestLiteralThreshold,
    meetsAllThresholds: thresholdFlags.every(Boolean),
  };
}

async function persistPhase7Payload(
  ctx: MutationCtx,
  {
    matchIds,
    overwrite,
    payload,
  }: {
    matchIds: Array<Id<"matches">>;
    overwrite?: boolean;
    payload: Phase7Payload;
  },
): Promise<{
  _id: string;
  existed: boolean;
  payload: Phase7Payload;
}> {
  if (payload.reportType !== "phase-7-closing-20") {
    throw new Error(
      `Expected phase-7-closing-20 payload, got ${payload.reportType}`,
    );
  }
  if (payload.runCount !== matchIds.length) {
    throw new Error(
      `Phase 7 payload runCount ${payload.runCount} does not match ${matchIds.length} match ids`,
    );
  }

  const matchIdStrings = matchIds.map((matchId) => matchId as unknown as string);
  const matchIdsHash = await hashMatchIds(matchIdStrings);
  const reportType = "phase-7-closing-20";

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
      payload: existing.phase7Payload as Phase7Payload,
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
      perPersonaExtractionRate: payload.perPersona.map((persona) => ({
        personaId: persona.personaId,
        rate: persona.extractionRate,
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
      perPersona: payload.perPersona.map((persona) => ({
        personaId: persona.personaId,
        kills: 0,
        equips: 0,
        speechEvents: 0,
        extracted: persona.extractionsCount,
        extractionsCount: persona.extractionsCount,
        extractionRate: persona.extractionRate,
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
    phase7Payload: payload,
  });

  return {
    _id: insertedId as unknown as string,
    existed: false,
    payload,
  };
}

export const persistComputedPhase7Report = mutation({
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
    payload: Phase7Payload;
  }> => {
    return persistPhase7Payload(ctx, {
      matchIds,
      overwrite,
      payload: payload as Phase7Payload,
    });
  },
});
