import { v } from "convex/values";
import type { Id } from "../_generated/dataModel.js";
import { mutation, type MutationCtx } from "../_generated/server.js";
import { PERSONA_IDS, type PersonaId, type Tile } from "../engine/types.js";
import { hashMatchIds } from "../reports.js";
import {
  computePhase7Metrics,
  type Phase7RunInput,
  type Phase7RunStatsRow,
} from "./phase7.js";
import type {
  ResolutionAction,
  ResolutionMove,
  SlimAgentRecord,
  SlimTurnRow,
} from "../../harness/diagnostics/types.js";

const EXTRACTION_THRESHOLD = 0.30;
const KILL_THRESHOLD = 0.80;
const EQUIP_THRESHOLD = 0.80;
const SPEECH_THRESHOLD = 0.50;
const PERSONA_SPREAD_THRESHOLD_PP = 15;
const PER_FIELD_REJECTION_THRESHOLD = 0.10;
const CHARGE_EVENT_THRESHOLD = 10;
const CHARGE_COUNTER_FIRE_THRESHOLD = 3;
const WALL_BUMP_SELF_DAMAGE_THRESHOLD = 5;
const PARTIAL_DISTANCE_WALL_BUMP_THRESHOLD = 1;

export type Phase10RunInput = {
  matchId: string;
  failed: boolean;
  run: Phase7RunStatsRow | null;
  turns: SlimTurnRow[];
};

export type Phase10Payload = {
  reportType: "phase-10-closing-20";
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
  personaSpread: number;
  totalAgentRecords: number;
  nullOnlyUseViolations: number;
  zeroCrashes: boolean;
  zeroIllegalConsumableUse: boolean;
  zeroPlayerNLiterals: boolean;
  zeroWholeTurnValidatorZeroes: boolean;
  validatorRecords: number;
  validatorFieldErrors: number;
  perFieldRejectionRate: number;
  wholeTurnZeroedValidatorRecords: number;
  playerNLiteralCount: number;

  chargeEventCount: number;
  chargeEventPerPersona: Array<{ personaId: PersonaId; count: number }>;
  bilateralChargeCount: number;
  chargeCounterFireCount: number;
  wallBumpSelfDamageCount: number;
  partialDistanceWallBumpCount: number;
  partialDistanceChargeCount: number;
  chargeDamageFeedDelivered: number;
  chargeDamageFeedExpected: number;
  chargeDamageFeedMissing: number;
  lethalChargeCount: number;

  meetsExtractionThreshold: boolean;
  meetsKillThreshold: boolean;
  meetsEquipThreshold: boolean;
  meetsSpeechThreshold: boolean;
  meetsPersonaSpreadThreshold: boolean;
  meetsZeroCrashThreshold: boolean;
  meetsZeroIllegalConsumableThreshold: boolean;
  meetsZeroPlayerNLiteralThreshold: boolean;
  meetsZeroWholeTurnValidatorThreshold: boolean;
  meetsPerFieldRejectionThreshold: boolean;
  meetsChargeEventThreshold: boolean;
  meetsChargeCounterFireThreshold: boolean;
  meetsWallBumpSelfDamageThreshold: boolean;
  meetsPartialDistanceWallBumpThreshold: boolean;
  meetsChargeFeedDeliveryThreshold: boolean;
  meetsAllThresholds: boolean;
};

type ChargePair = {
  chargerId: string;
  defenderId: string;
};

function sameTile(a: Tile, b: Tile): boolean {
  return a.x === b.x && a.y === b.y;
}

function isDamageResult(result: string): boolean {
  return /^dmg \d+$/.test(result);
}

function canonicalPair(a: string, b: string): string {
  return [a, b].sort().join("|");
}

function personaDisplayName(personaId: PersonaId): string {
  return `${personaId.slice(0, 1).toUpperCase()}${personaId.slice(1)}`;
}

function normalizedTarget(value: string): string {
  return value.trim().toLowerCase();
}

function characterAliases(
  characterId: string,
  recordsById: ReadonlyMap<string, SlimAgentRecord>,
): Set<string> {
  const aliases = new Set<string>([normalizedTarget(characterId)]);
  const record = recordsById.get(characterId);
  if (record) {
    aliases.add(normalizedTarget(record.personaId));
    aliases.add(normalizedTarget(personaDisplayName(record.personaId)));
  }
  return aliases;
}

function targetMatchesCharacter(
  target: string,
  characterId: string,
  recordsById: ReadonlyMap<string, SlimAgentRecord>,
): boolean {
  return characterAliases(characterId, recordsById).has(
    normalizedTarget(target),
  );
}

function actionIsCounterFireOnCharge(
  action: ResolutionAction,
  chargePairs: readonly ChargePair[],
  recordsById: ReadonlyMap<string, SlimAgentRecord>,
): boolean {
  if (action.kind !== "counter" || !isDamageResult(action.result)) {
    return false;
  }
  return chargePairs.some(
    (pair) =>
      action.characterId === pair.defenderId &&
      targetMatchesCharacter(action.target, pair.chargerId, recordsById),
  );
}

function countBilateralCharges(chargePairs: readonly ChargePair[]): number {
  const directionsByPair = new Map<string, Set<string>>();
  for (const pair of chargePairs) {
    const key = canonicalPair(pair.chargerId, pair.defenderId);
    const directions = directionsByPair.get(key) ?? new Set<string>();
    directions.add(`${pair.chargerId}->${pair.defenderId}`);
    directionsByPair.set(key, directions);
  }
  return [...directionsByPair.values()].filter(
    (directions) => directions.size >= 2,
  ).length;
}

function recordByCharacterId(
  records: readonly SlimAgentRecord[],
): Map<string, SlimAgentRecord> {
  return new Map(records.map((record) => [record.characterId, record]));
}

function movePersonaId(
  move: ResolutionMove,
  recordsById: ReadonlyMap<string, SlimAgentRecord>,
): PersonaId | null {
  return recordsById.get(move.characterId)?.personaId ?? null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function auditNumber(
  source: Record<string, unknown>,
  keys: readonly string[],
): number | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return value;
    }
  }
  return null;
}

function chargeFeedCounts(record: SlimAgentRecord): {
  delivered: number;
  expected: number;
  missing: number;
} {
  const audit = asRecord(record.damageFeedAudit);
  if (audit === null) {
    return { delivered: 0, expected: 0, missing: 0 };
  }

  const explicitSource = [
    asRecord(audit.charge),
    asRecord(audit.bodyCollision),
    asRecord(audit.chargeDamageFeed),
    audit,
  ].find((source): source is Record<string, unknown> => {
    if (source === null) return false;
    return (
      auditNumber(source, [
        "chargeExpected",
        "expectedChargeIncoming",
        "chargeDamageFeedExpected",
        "bodyCollisionExpectedIncoming",
      ]) !== null ||
      auditNumber(source, [
        "chargeDelivered",
        "chargeIncoming",
        "chargeDamageFeedDelivered",
        "bodyCollisionIncoming",
      ]) !== null ||
      auditNumber(source, [
        "chargeMissing",
        "missingChargeIncoming",
        "chargeDamageFeedMissing",
        "bodyCollisionMissingIncoming",
      ]) !== null
    );
  });

  if (explicitSource === undefined) {
    return { delivered: 0, expected: 0, missing: 0 };
  }

  const expected = auditNumber(explicitSource, [
    "chargeExpected",
    "expectedChargeIncoming",
    "chargeDamageFeedExpected",
    "bodyCollisionExpectedIncoming",
  ]);
  const delivered = auditNumber(explicitSource, [
    "chargeDelivered",
    "chargeIncoming",
    "chargeDamageFeedDelivered",
    "bodyCollisionIncoming",
  ]);
  const explicitMissing = auditNumber(explicitSource, [
    "chargeMissing",
    "missingChargeIncoming",
    "chargeDamageFeedMissing",
    "bodyCollisionMissingIncoming",
  ]);
  const missing =
    explicitMissing ??
    (expected !== null && delivered !== null
      ? Math.max(0, expected - delivered)
      : 0);

  return {
    delivered: delivered ?? 0,
    expected: expected ?? (delivered ?? 0) + missing,
    missing,
  };
}

export function computePhase10Metrics(runs: Phase10RunInput[]): Phase10Payload {
  const carry = computePhase7Metrics(runs as Phase7RunInput[]);
  let chargeEventCount = 0;
  let bilateralChargeCount = 0;
  let chargeCounterFireCount = 0;
  let wallBumpSelfDamageCount = 0;
  let partialDistanceWallBumpCount = 0;
  let partialDistanceChargeCount = 0;
  let chargeDamageFeedDelivered = 0;
  let chargeDamageFeedExpected = 0;
  let chargeDamageFeedMissing = 0;
  let lethalChargeCount = 0;
  const chargeEventsByPersona = new Map<PersonaId, number>(
    PERSONA_IDS.map((personaId) => [personaId, 0]),
  );

  for (const run of runs) {
    for (const turn of run.turns) {
      const recordsById = recordByCharacterId(turn.agentRecords);
      const chargePairs: ChargePair[] = [];
      const deaths = new Set(turn.resolution.deaths);

      for (const move of turn.resolution.moves) {
        const bodyCollision = move.bodyCollision;
        if (bodyCollision?.kind === "character") {
          chargeEventCount += 1;
          chargePairs.push({
            chargerId: move.characterId,
            defenderId: bodyCollision.defenderId,
          });
          if (!sameTile(move.from, move.to)) {
            partialDistanceChargeCount += 1;
          }
          if (deaths.has(bodyCollision.defenderId)) {
            lethalChargeCount += 1;
          }
          const personaId = movePersonaId(move, recordsById);
          if (personaId !== null) {
            chargeEventsByPersona.set(
              personaId,
              (chargeEventsByPersona.get(personaId) ?? 0) + 1,
            );
          }
        } else if (bodyCollision?.kind === "wall") {
          wallBumpSelfDamageCount += 1;
          if (!sameTile(move.from, move.to)) {
            partialDistanceWallBumpCount += 1;
          }
        }
      }

      bilateralChargeCount += countBilateralCharges(chargePairs);
      for (const action of turn.resolution.actions) {
        if (actionIsCounterFireOnCharge(action, chargePairs, recordsById)) {
          chargeCounterFireCount += 1;
        }
      }

      for (const record of turn.agentRecords) {
        const feed = chargeFeedCounts(record);
        chargeDamageFeedDelivered += feed.delivered;
        chargeDamageFeedExpected += feed.expected;
        chargeDamageFeedMissing += feed.missing;
      }
    }
  }

  const chargeEventPerPersona = PERSONA_IDS.map((personaId) => ({
    personaId,
    count: chargeEventsByPersona.get(personaId) ?? 0,
  }));

  const zeroCrashes = carry.failedMatches === 0;
  const zeroIllegalConsumableUse = carry.nullOnlyUseViolations === 0;
  const zeroPlayerNLiterals = carry.playerNLiteralCount === 0;
  const zeroWholeTurnValidatorZeroes =
    carry.wholeTurnZeroedValidatorRecords === 0;
  const meetsExtractionThreshold =
    carry.extractionRate >= EXTRACTION_THRESHOLD;
  const meetsKillThreshold = carry.killRate >= KILL_THRESHOLD;
  const meetsEquipThreshold = carry.equipRate >= EQUIP_THRESHOLD;
  const meetsSpeechThreshold = carry.speechRate >= SPEECH_THRESHOLD;
  const meetsPersonaSpreadThreshold =
    carry.personaExtractionSpread >= PERSONA_SPREAD_THRESHOLD_PP;
  const meetsZeroCrashThreshold = zeroCrashes;
  const meetsZeroIllegalConsumableThreshold = zeroIllegalConsumableUse;
  const meetsZeroPlayerNLiteralThreshold = zeroPlayerNLiterals;
  const meetsZeroWholeTurnValidatorThreshold = zeroWholeTurnValidatorZeroes;
  const meetsPerFieldRejectionThreshold =
    carry.perFieldRejectionRate <= PER_FIELD_REJECTION_THRESHOLD;
  const meetsChargeEventThreshold =
    chargeEventCount >= CHARGE_EVENT_THRESHOLD;
  const meetsChargeCounterFireThreshold =
    chargeCounterFireCount >= CHARGE_COUNTER_FIRE_THRESHOLD;
  const meetsWallBumpSelfDamageThreshold =
    wallBumpSelfDamageCount >= WALL_BUMP_SELF_DAMAGE_THRESHOLD;
  const meetsPartialDistanceWallBumpThreshold =
    partialDistanceWallBumpCount >= PARTIAL_DISTANCE_WALL_BUMP_THRESHOLD;
  const meetsChargeFeedDeliveryThreshold = chargeDamageFeedMissing === 0;
  const thresholdFlags = [
    meetsExtractionThreshold,
    meetsKillThreshold,
    meetsEquipThreshold,
    meetsSpeechThreshold,
    meetsPersonaSpreadThreshold,
    meetsZeroCrashThreshold,
    meetsZeroIllegalConsumableThreshold,
    meetsZeroPlayerNLiteralThreshold,
    meetsZeroWholeTurnValidatorThreshold,
    meetsPerFieldRejectionThreshold,
    meetsChargeEventThreshold,
    meetsChargeCounterFireThreshold,
    meetsWallBumpSelfDamageThreshold,
    meetsPartialDistanceWallBumpThreshold,
    meetsChargeFeedDeliveryThreshold,
  ];

  return {
    reportType: "phase-10-closing-20",
    runCount: runs.length,
    matchIds: runs.map((run) => run.matchId),
    failedMatches: carry.failedMatches,
    runsWithExtraction: carry.runsWithExtraction,
    runsWithKill: carry.runsWithKill,
    runsWithEquip: carry.runsWithEquip,
    runsWithSpeech: carry.runsWithSpeech,
    extractionRate: carry.extractionRate,
    killRate: carry.killRate,
    equipRate: carry.equipRate,
    speechRate: carry.speechRate,
    personaSpread: carry.personaExtractionSpread,
    totalAgentRecords: carry.totalAgentRecords,
    nullOnlyUseViolations: carry.nullOnlyUseViolations,
    zeroCrashes,
    zeroIllegalConsumableUse,
    zeroPlayerNLiterals,
    zeroWholeTurnValidatorZeroes,
    validatorRecords: carry.validatorRecords,
    validatorFieldErrors: carry.validatorFieldErrors,
    perFieldRejectionRate: carry.perFieldRejectionRate,
    wholeTurnZeroedValidatorRecords: carry.wholeTurnZeroedValidatorRecords,
    playerNLiteralCount: carry.playerNLiteralCount,
    chargeEventCount,
    chargeEventPerPersona,
    bilateralChargeCount,
    chargeCounterFireCount,
    wallBumpSelfDamageCount,
    partialDistanceWallBumpCount,
    partialDistanceChargeCount,
    chargeDamageFeedDelivered,
    chargeDamageFeedExpected,
    chargeDamageFeedMissing,
    lethalChargeCount,
    meetsExtractionThreshold,
    meetsKillThreshold,
    meetsEquipThreshold,
    meetsSpeechThreshold,
    meetsPersonaSpreadThreshold,
    meetsZeroCrashThreshold,
    meetsZeroIllegalConsumableThreshold,
    meetsZeroPlayerNLiteralThreshold,
    meetsZeroWholeTurnValidatorThreshold,
    meetsPerFieldRejectionThreshold,
    meetsChargeEventThreshold,
    meetsChargeCounterFireThreshold,
    meetsWallBumpSelfDamageThreshold,
    meetsPartialDistanceWallBumpThreshold,
    meetsChargeFeedDeliveryThreshold,
    meetsAllThresholds: thresholdFlags.every(Boolean),
  };
}

async function persistPhase10Payload(
  ctx: MutationCtx,
  {
    matchIds,
    overwrite,
    payload,
  }: {
    matchIds: Array<Id<"matches">>;
    overwrite?: boolean;
    payload: Phase10Payload;
  },
): Promise<{ _id: string; existed: boolean; payload: Phase10Payload }> {
  if (payload.reportType !== "phase-10-closing-20") {
    throw new Error(
      `Expected phase-10-closing-20 payload, got ${payload.reportType}`,
    );
  }
  if (payload.runCount !== matchIds.length) {
    throw new Error(
      `Phase 10 payload runCount ${payload.runCount} does not match ${matchIds.length} match ids`,
    );
  }
  const matchIdStrings = matchIds.map((matchId) => matchId as unknown as string);
  const matchIdsHash = await hashMatchIds(matchIdStrings);
  const reportType = "phase-10-closing-20";

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
      payload: existing.phase10Payload as Phase10Payload,
    };
  }
  if (existing && overwrite === true) await ctx.db.delete(existing._id);

  const runIds: Array<Id<"runs">> = [];
  for (const matchId of matchIds) {
    const run = await ctx.db
      .query("runs")
      .withIndex("by_match", (q) => q.eq("matchId", matchId))
      .unique();
    if (run) runIds.push(run._id);
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
      perPersonaExtractionRate: [],
      personaSpread: payload.personaSpread,
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
      perPersona: PERSONA_IDS.map((personaId) => ({
        personaId,
        kills: 0,
        equips: 0,
        speechEvents: 0,
        extracted: 0,
        extractionsCount: 0,
        extractionRate: 0,
      })),
      personaExtractionSpread: payload.personaSpread,
      meetsExtractionThreshold: payload.meetsExtractionThreshold,
      meetsKillThreshold: payload.meetsKillThreshold,
      meetsEquipThreshold: payload.meetsEquipThreshold,
      meetsSpeechThreshold: payload.meetsSpeechThreshold,
      meetsPersonaSpreadThreshold: payload.meetsPersonaSpreadThreshold,
      meetsAllThresholds: payload.meetsAllThresholds,
    },
    missingRunsForMatchIds: [],
    phase10Payload: payload,
  });

  return {
    _id: insertedId as unknown as string,
    existed: false,
    payload,
  };
}

export const persistComputedPhase10Report = mutation({
  args: {
    matchIds: v.array(v.id("matches")),
    overwrite: v.optional(v.boolean()),
    payload: v.any(),
  },
  handler: async (
    ctx,
    { matchIds, overwrite, payload },
  ): Promise<{ _id: string; existed: boolean; payload: Phase10Payload }> =>
    persistPhase10Payload(ctx, {
      matchIds,
      overwrite,
      payload: payload as Phase10Payload,
    }),
});
