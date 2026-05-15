import { v } from "convex/values";
import type { Id } from "../_generated/dataModel.js";
import { mutation, type MutationCtx } from "../_generated/server.js";
import { loadReferenceMap, expandMap } from "../engine/map.js";
import { PERSONA_IDS, titleCase, type PersonaId } from "../engine/types.js";
import { hashMatchIds } from "../reports.js";
import {
  computePhase7Metrics,
  type Phase7RunInput,
  type Phase7RunStatsRow,
} from "./phase7.js";
import { computeMechanicsDiagnostics } from "../../harness/diagnostics/mechanics.js";
import type { SlimTurnRow } from "../../harness/diagnostics/types.js";

const EXTRACTION_THRESHOLD = 0.30;
const KILL_THRESHOLD = 0.80;
const EQUIP_THRESHOLD = 0.80;
const SPEECH_THRESHOLD = 0.50;
const PERSONA_SPREAD_THRESHOLD_PP = 15;
const PER_FIELD_REJECTION_THRESHOLD = 0.10;

export type Phase12RunStatsRow = {
  extractions: number;
  kills: number;
  equips: number;
  speechEvents: number;
  perPersona: Array<{
    personaId: PersonaId;
    extracted: number;
    kills: number;
  }>;
};

export type Phase12RunInput = {
  matchId: string;
  failed: boolean;
  run: Phase12RunStatsRow | null;
  turns: SlimTurnRow[];
};

export type Phase12PersonaKillRow = {
  personaId: PersonaId;
  kills: number;
};

export type Phase12CountdownRow = {
  id: string;
  landsAtTurn: number;
  countdown3: number;
  countdown2: number;
  countdown1: number;
  countdown0: number;
};

export type Phase12Payload = {
  reportType: "phase-12-closing-20";
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

  environmentalDeaths: number;
  telefragDeathCount: number;
  telefragKillFeedLineCount: number;
  telefragKillFeedLines: string[];
  combatDeathCount: number;
  airdropTelegraphedSeen: number;
  airdropLandedSeen: number;
  airdropLootedSpent: number;
  airdropCountdowns: Phase12CountdownRow[];
  airdropFirstLootableViolations: number;
  airdropSpentVisibilityViolations: number;
  perPersonaKillTotal: number;
  perPersonaKills: Phase12PersonaKillRow[];
  deterministicCrateSignature: string;
  deterministicAirdropSignature: string;
  deterministicStaticMapSignature: string;
  deterministicCratesAcrossSeeds: boolean;
  deterministicAirdropsAcrossSeeds: boolean;
  referenceCrateCount: number;
  referenceAirdropCount: number;

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
  meetsTelefragThreshold: boolean;
  meetsAirdropCountdownThreshold: boolean;
  meetsAirdropLifecycleThreshold: boolean;
  meetsPerPersonaKillAttributionThreshold: boolean;
  meetsDeterminismThreshold: boolean;
  meetsAllThresholds: boolean;
};

export const phase12PersonaKillValidator = v.object({
  personaId: v.union(
    v.literal("rat"),
    v.literal("duelist"),
    v.literal("trader"),
    v.literal("opportunist"),
    v.literal("paranoid"),
    v.literal("camper"),
    v.literal("sprinter"),
    v.literal("vulture"),
  ),
  kills: v.number(),
});

export const phase12CountdownValidator = v.object({
  id: v.string(),
  landsAtTurn: v.number(),
  countdown3: v.number(),
  countdown2: v.number(),
  countdown1: v.number(),
  countdown0: v.number(),
});

export const phase12PayloadValidator = v.object({
  reportType: v.literal("phase-12-closing-20"),
  runCount: v.number(),
  matchIds: v.array(v.string()),
  failedMatches: v.number(),

  runsWithExtraction: v.number(),
  runsWithKill: v.number(),
  runsWithEquip: v.number(),
  runsWithSpeech: v.number(),
  extractionRate: v.number(),
  killRate: v.number(),
  equipRate: v.number(),
  speechRate: v.number(),
  personaSpread: v.number(),
  totalAgentRecords: v.number(),
  nullOnlyUseViolations: v.number(),
  zeroCrashes: v.boolean(),
  zeroIllegalConsumableUse: v.boolean(),
  zeroPlayerNLiterals: v.boolean(),
  zeroWholeTurnValidatorZeroes: v.boolean(),
  validatorRecords: v.number(),
  validatorFieldErrors: v.number(),
  perFieldRejectionRate: v.number(),
  wholeTurnZeroedValidatorRecords: v.number(),
  playerNLiteralCount: v.number(),

  environmentalDeaths: v.number(),
  telefragDeathCount: v.number(),
  telefragKillFeedLineCount: v.number(),
  telefragKillFeedLines: v.array(v.string()),
  combatDeathCount: v.number(),
  airdropTelegraphedSeen: v.number(),
  airdropLandedSeen: v.number(),
  airdropLootedSpent: v.number(),
  airdropCountdowns: v.array(phase12CountdownValidator),
  airdropFirstLootableViolations: v.number(),
  airdropSpentVisibilityViolations: v.number(),
  perPersonaKillTotal: v.number(),
  perPersonaKills: v.array(phase12PersonaKillValidator),
  deterministicCrateSignature: v.string(),
  deterministicAirdropSignature: v.string(),
  deterministicStaticMapSignature: v.string(),
  deterministicCratesAcrossSeeds: v.boolean(),
  deterministicAirdropsAcrossSeeds: v.boolean(),
  referenceCrateCount: v.number(),
  referenceAirdropCount: v.number(),

  meetsExtractionThreshold: v.boolean(),
  meetsKillThreshold: v.boolean(),
  meetsEquipThreshold: v.boolean(),
  meetsSpeechThreshold: v.boolean(),
  meetsPersonaSpreadThreshold: v.boolean(),
  meetsZeroCrashThreshold: v.boolean(),
  meetsZeroIllegalConsumableThreshold: v.boolean(),
  meetsZeroPlayerNLiteralThreshold: v.boolean(),
  meetsZeroWholeTurnValidatorThreshold: v.boolean(),
  meetsPerFieldRejectionThreshold: v.boolean(),
  meetsTelefragThreshold: v.boolean(),
  meetsAirdropCountdownThreshold: v.boolean(),
  meetsAirdropLifecycleThreshold: v.boolean(),
  meetsPerPersonaKillAttributionThreshold: v.boolean(),
  meetsDeterminismThreshold: v.boolean(),
  meetsAllThresholds: v.boolean(),
});

type ReferenceAirdrop = {
  id: string;
  landsAtTurn: number;
};

function stableJson(value: unknown): string {
  return JSON.stringify(sortForStableJson(value));
}

function sortForStableJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForStableJson);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => [key, sortForStableJson(nested)]),
  );
}

function referenceAirdrops(): ReferenceAirdrop[] {
  return loadReferenceMap().airdrops.map((drop) => ({
    id: `Crate_${drop.x}_${drop.y}`,
    landsAtTurn: drop.landsAtTurn,
  }));
}

function deterministicReferenceSignatures(): {
  crateSignature: string;
  airdropSignature: string;
  staticMapSignature: string;
  cratesAcrossSeeds: boolean;
  airdropsAcrossSeeds: boolean;
  referenceCrateCount: number;
  referenceAirdropCount: number;
} {
  const descriptor = loadReferenceMap();
  const first = expandMap(descriptor, "phase12-determinism-a");
  const second = expandMap(descriptor, "phase12-determinism-b");
  const crateProjection = first.crates.map((crate) => ({
    id: crate.id,
    pos: crate.pos,
    contents: crate.contents,
  }));
  const secondCrateProjection = second.crates.map((crate) => ({
    id: crate.id,
    pos: crate.pos,
    contents: crate.contents,
  }));
  const airdropProjection = first.airdrops.map((drop) => ({
    id: drop.id,
    pos: drop.pos,
    landsAtTurn: drop.landsAtTurn,
    contents: drop.contents,
  }));
  const secondAirdropProjection = second.airdrops.map((drop) => ({
    id: drop.id,
    pos: drop.pos,
    landsAtTurn: drop.landsAtTurn,
    contents: drop.contents,
  }));

  return {
    crateSignature: stableJson(crateProjection),
    airdropSignature: stableJson(airdropProjection),
    staticMapSignature: stableJson({
      size: descriptor.size,
      walls: descriptor.walls,
      coverClusters: descriptor.coverClusters,
      spawns: descriptor.spawns,
      evac: descriptor.evac,
    }),
    cratesAcrossSeeds:
      stableJson(crateProjection) === stableJson(secondCrateProjection),
    airdropsAcrossSeeds:
      stableJson(airdropProjection) === stableJson(secondAirdropProjection),
    referenceCrateCount: first.crates.length,
    referenceAirdropCount: first.airdrops.length,
  };
}

function phase7Run(row: Phase12RunStatsRow | null): Phase7RunStatsRow | null {
  if (row === null) return null;
  return {
    extractions: row.extractions,
    kills: row.kills,
    equips: row.equips,
    speechEvents: row.speechEvents,
    perPersona: row.perPersona.map((persona) => ({
      personaId: persona.personaId,
      extracted: persona.extracted,
    })),
  };
}

function buildPersonaKillRows(runs: readonly Phase12RunInput[]): {
  rows: Phase12PersonaKillRow[];
  total: number;
} {
  const byPersona = new Map<PersonaId, number>(
    PERSONA_IDS.map((personaId) => [personaId, 0]),
  );
  for (const run of runs) {
    for (const persona of run.run?.perPersona ?? []) {
      byPersona.set(
        persona.personaId,
        (byPersona.get(persona.personaId) ?? 0) + persona.kills,
      );
    }
  }
  const rows = PERSONA_IDS.map((personaId) => ({
    personaId,
    kills: byPersona.get(personaId) ?? 0,
  }));
  return {
    rows,
    total: rows.reduce((sum, row) => sum + row.kills, 0),
  };
}

function personaNameForDeath(turn: SlimTurnRow, characterId: string): string {
  const record = turn.agentRecords.find(
    (candidate) => candidate.characterId === characterId,
  );
  return record ? titleCase(record.personaId) : characterId;
}

function countAirdropLifecycle(rows: readonly SlimTurnRow[]): {
  countdowns: Phase12CountdownRow[];
  firstLootableViolations: number;
  spentVisibilityViolations: number;
  telefragLines: string[];
} {
  const refs = referenceAirdrops();
  const refById = new Map(refs.map((drop) => [drop.id, drop]));
  const countdownCounts = new Map<string, Map<number, number>>(
    refs.map((drop) => [drop.id, new Map<number, number>()]),
  );
  const lootedAtTurn = new Map<string, number>();
  let firstLootableViolations = 0;
  let spentVisibilityViolations = 0;
  const telefragLines: string[] = [];

  const sortedRows = [...rows].sort((a, b) =>
    a.matchId === b.matchId ? a.turn - b.turn : a.matchId.localeCompare(b.matchId),
  );

  for (const turn of sortedRows) {
    for (const victimId of turn.resolution.environmentalDeaths ?? []) {
      telefragLines.push(
        `${personaNameForDeath(turn, victimId)} got telefragged by crate spawn`,
      );
    }

    for (const record of turn.agentRecords) {
      for (const event of record.airdropVision?.telegraphedEvents ?? []) {
        if (!refById.has(event.id)) continue;
        const counts = countdownCounts.get(event.id);
        counts?.set(event.countdown, (counts.get(event.countdown) ?? 0) + 1);
      }
      for (const id of record.airdropVision?.landedIds ?? []) {
        const lootedTurn = lootedAtTurn.get(matchScopedAirdropKey(turn.matchId, id));
        if (lootedTurn !== undefined && turn.turn > lootedTurn) {
          spentVisibilityViolations += 1;
        }
      }
    }

    for (const action of turn.resolution.actions) {
      if (action.kind !== "loot" || action.result !== "opened") continue;
      const ref = refById.get(action.target);
      if (!ref) continue;
      if (turn.turn <= ref.landsAtTurn) {
        firstLootableViolations += 1;
      }
      const lootedKey = matchScopedAirdropKey(turn.matchId, action.target);
      if (!lootedAtTurn.has(lootedKey)) {
        lootedAtTurn.set(lootedKey, turn.turn);
      }
    }
  }

  return {
    countdowns: refs.map((drop) => {
      const counts = countdownCounts.get(drop.id) ?? new Map<number, number>();
      return {
        id: drop.id,
        landsAtTurn: drop.landsAtTurn,
        countdown3: counts.get(3) ?? 0,
        countdown2: counts.get(2) ?? 0,
        countdown1: counts.get(1) ?? 0,
        countdown0: counts.get(0) ?? 0,
      };
    }),
    firstLootableViolations,
    spentVisibilityViolations,
    telefragLines,
  };
}

function matchScopedAirdropKey(matchId: string, crateId: string): string {
  return `${matchId}:${crateId}`;
}

export function computePhase12Metrics(runs: Phase12RunInput[]): Phase12Payload {
  const carry = computePhase7Metrics(
    runs.map((run): Phase7RunInput => ({
      matchId: run.matchId,
      failed: run.failed,
      run: phase7Run(run.run),
      turns: run.turns,
    })),
  );
  const rows = runs.flatMap((run) => run.turns);
  const mechanics = computeMechanicsDiagnostics(rows);
  const personaKills = buildPersonaKillRows(runs);
  const lifecycle = countAirdropLifecycle(rows);
  const deterministic = deterministicReferenceSignatures();

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
  const meetsTelefragThreshold =
    mechanics.environmentalDeaths > 0 &&
    lifecycle.telefragLines.some((line) =>
      line.endsWith(" got telefragged by crate spawn"),
    );
  const meetsAirdropCountdownThreshold = lifecycle.countdowns.every(
    (row) =>
      row.countdown3 > 0 &&
      row.countdown2 > 0 &&
      row.countdown1 > 0 &&
      row.countdown0 > 0,
  );
  const meetsAirdropLifecycleThreshold =
    mechanics.airdrop.landedSeen > 0 &&
    mechanics.airdrop.lootedSpent > 0 &&
    lifecycle.firstLootableViolations === 0 &&
    lifecycle.spentVisibilityViolations === 0;
  const meetsPerPersonaKillAttributionThreshold = personaKills.rows.every(
    (row) => row.kills > 0,
  );
  const meetsDeterminismThreshold =
    deterministic.cratesAcrossSeeds && deterministic.airdropsAcrossSeeds;
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
    meetsTelefragThreshold,
    meetsAirdropCountdownThreshold,
    meetsAirdropLifecycleThreshold,
    meetsPerPersonaKillAttributionThreshold,
    meetsDeterminismThreshold,
  ];

  return {
    reportType: "phase-12-closing-20",
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

    environmentalDeaths: mechanics.environmentalDeaths,
    telefragDeathCount: mechanics.airdrop.telefrags,
    telefragKillFeedLineCount: lifecycle.telefragLines.length,
    telefragKillFeedLines: lifecycle.telefragLines,
    combatDeathCount: mechanics.deaths,
    airdropTelegraphedSeen: mechanics.airdrop.telegraphedSeen,
    airdropLandedSeen: mechanics.airdrop.landedSeen,
    airdropLootedSpent: mechanics.airdrop.lootedSpent,
    airdropCountdowns: lifecycle.countdowns,
    airdropFirstLootableViolations: lifecycle.firstLootableViolations,
    airdropSpentVisibilityViolations: lifecycle.spentVisibilityViolations,
    perPersonaKillTotal: personaKills.total,
    perPersonaKills: personaKills.rows,
    deterministicCrateSignature: deterministic.crateSignature,
    deterministicAirdropSignature: deterministic.airdropSignature,
    deterministicStaticMapSignature: deterministic.staticMapSignature,
    deterministicCratesAcrossSeeds: deterministic.cratesAcrossSeeds,
    deterministicAirdropsAcrossSeeds: deterministic.airdropsAcrossSeeds,
    referenceCrateCount: deterministic.referenceCrateCount,
    referenceAirdropCount: deterministic.referenceAirdropCount,

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
    meetsTelefragThreshold,
    meetsAirdropCountdownThreshold,
    meetsAirdropLifecycleThreshold,
    meetsPerPersonaKillAttributionThreshold,
    meetsDeterminismThreshold,
    meetsAllThresholds: thresholdFlags.every(Boolean),
  };
}

async function persistPhase12Payload(
  ctx: MutationCtx,
  {
    matchIds,
    overwrite,
    payload,
  }: {
    matchIds: Array<Id<"matches">>;
    overwrite?: boolean;
    payload: Phase12Payload;
  },
): Promise<{ _id: string; existed: boolean; payload: Phase12Payload }> {
  if (payload.reportType !== "phase-12-closing-20") {
    throw new Error(
      `Expected phase-12-closing-20 payload, got ${payload.reportType}`,
    );
  }
  if (payload.runCount !== matchIds.length) {
    throw new Error(
      `Phase 12 payload runCount ${payload.runCount} does not match ${matchIds.length} match ids`,
    );
  }
  const matchIdStrings = matchIds.map((matchId) => matchId as unknown as string);
  const matchIdsHash = await hashMatchIds(matchIdStrings);
  const reportType = "phase-12-closing-20";

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
      payload: existing.phase12Payload as Phase12Payload,
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
      kills: payload.combatDeathCount,
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
        kills:
          payload.perPersonaKills.find((row) => row.personaId === personaId)
            ?.kills ?? 0,
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
    phase12Payload: payload,
  });

  return {
    _id: insertedId as unknown as string,
    existed: false,
    payload,
  };
}

export const persistComputedPhase12Report = mutation({
  args: {
    matchIds: v.array(v.id("matches")),
    overwrite: v.optional(v.boolean()),
    payload: v.any(),
  },
  handler: async (
    ctx,
    { matchIds, overwrite, payload },
  ): Promise<{ _id: string; existed: boolean; payload: Phase12Payload }> =>
    persistPhase12Payload(ctx, {
      matchIds,
      overwrite,
      payload: payload as Phase12Payload,
    }),
});
