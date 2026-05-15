import { v } from "convex/values";
import type { Id } from "../_generated/dataModel.js";
import { mutation, type MutationCtx } from "../_generated/server.js";
import {
  PERSONA_IDS,
  type PersonaId,
  type Tile,
  type Wall,
} from "../engine/types.js";
import { hashMatchIds } from "../reports.js";
import {
  computePhase7Metrics,
  type Phase7RunInput,
  type Phase7RunStatsRow,
} from "./phase7.js";
import type { SlimTurnRow } from "../../harness/diagnostics/types.js";

const EXTRACTION_THRESHOLD = 0.30;
const KILL_THRESHOLD = 0.80;
const EQUIP_THRESHOLD = 0.80;
const SPEECH_THRESHOLD = 0.50;
const PERSONA_SPREAD_THRESHOLD_PP = 15;
const PER_FIELD_REJECTION_THRESHOLD = 0.10;
const SLIDE_OUTCOME_THRESHOLD = 20;
const VISION_RANGE = 20;
const COMPASS_BEARINGS = 8;

export type Phase9WorldStateEvidence = {
  walls: Wall[];
  coverClusters: Wall[];
  coverTiles: Tile[];
  evac: { centre: Tile; revealedAtTurn: number | null };
};

export type Phase9WorldState = Phase9WorldStateEvidence;

export type Phase9RunInput = {
  matchId: string;
  failed: boolean;
  run: Phase7RunStatsRow | null;
  turns: SlimTurnRow[];
  worldState: Phase9WorldStateEvidence;
};

export type Phase9Payload = {
  reportType: "phase-9-closing-20";
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
  compassBearings: string[];
  allEightCompassBearingsExercised: boolean;
  targetRelativeKinds: string[];
  targetRelativeTowardExercised: boolean;
  targetRelativeAwayExercised: boolean;
  validatorRecords: number;
  validatorFieldErrors: number;
  perFieldRejectionRate: number;
  wholeTurnZeroedValidatorRecords: number;
  playerNLiteralCount: number;

  wallRectKeyCount: number;
  coverRectKeyCount: number;
  evacRectKeyCount: number;
  singleTileKeyForMultiTileRectCount: number;
  slideOutcomeCount: number;
  slideOutcomePerPersona: Array<{ personaId: PersonaId; count: number }>;
  wallOnWallOcclusionCount: number;
  evacOutOfChebyshev20Count: number;
  insideBearingHereCount: number;

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
  meetsCompassBearingsThreshold: boolean;
  meetsTargetRelativeThreshold: boolean;
  meetsWallRectKeyThreshold: boolean;
  meetsCoverRectKeyThreshold: boolean;
  meetsEvacRectKeyThreshold: boolean;
  meetsSingleTileKeyDisciplineThreshold: boolean;
  meetsSlideOutcomeThreshold: boolean;
  meetsWallOnWallOcclusionThreshold: boolean;
  meetsEvacOutOfChebyshev20Threshold: boolean;
  meetsInsideBearingHereThreshold: boolean;
  meetsAllThresholds: boolean;
};

function chebyshev(a: Tile, b: Tile): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function nearestTileOfRect(observer: Tile, rect: Wall): Tile {
  return {
    x: clamp(observer.x, rect.x, rect.x + rect.w - 1),
    y: clamp(observer.y, rect.y, rect.y + rect.h - 1),
  };
}

function rectMinChebyshev(observer: Tile, rect: Wall): number {
  return chebyshev(observer, nearestTileOfRect(observer, rect));
}

function rectKey(prefix: "Wall" | "Cover" | "Evac", rect: Wall): string {
  const x2 = rect.x + rect.w - 1;
  const y2 = rect.y + rect.h - 1;
  if (rect.w === 1 && rect.h === 1) return `${prefix}_${rect.x}_${rect.y}`;
  return `${prefix}_${rect.x}_${rect.y}_to_${x2}_${y2}`;
}

function tileInWall(tile: Tile, wall: Wall): boolean {
  return (
    tile.x >= wall.x &&
    tile.x < wall.x + wall.w &&
    tile.y >= wall.y &&
    tile.y < wall.y + wall.h
  );
}

function tileInAnyWall(tile: Tile, walls: readonly Wall[]): boolean {
  return walls.some((wall) => tileInWall(tile, wall));
}

function* bresenhamLine(from: Tile, to: Tile): Generator<Tile> {
  let x0 = from.x;
  let y0 = from.y;
  const x1 = to.x;
  const y1 = to.y;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  while (true) {
    yield { x: x0, y: y0 };
    if (x0 === x1 && y0 === y1) return;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
}

function hasLineOfSight(walls: readonly Wall[], from: Tile, to: Tile): boolean {
  if (from.x === to.x && from.y === to.y) return true;
  let first = true;
  for (const tile of bresenhamLine(from, to)) {
    if (first) {
      first = false;
      continue;
    }
    if (tile.x === to.x && tile.y === to.y) return true;
    if (tileInAnyWall(tile, walls)) return false;
  }
  return true;
}

function rectHasAnyTileWithLos(
  walls: readonly Wall[],
  observer: Tile,
  rect: Wall,
): boolean {
  for (let dx = 0; dx < rect.w; dx += 1) {
    for (let dy = 0; dy < rect.h; dy += 1) {
      if (
        hasLineOfSight(walls, observer, { x: rect.x + dx, y: rect.y + dy })
      ) {
        return true;
      }
    }
  }
  return false;
}

function parseSingleRectKey(key: string): { prefix: "Wall" | "Cover"; tile: Tile } | null {
  const match = /^(Wall|Cover)_(-?\d+)_(-?\d+)$/.exec(key);
  if (!match) return null;
  return {
    prefix: match[1] as "Wall" | "Cover",
    tile: { x: Number(match[2]), y: Number(match[3]) },
  };
}

function multiTileRectContaining(
  tile: Tile,
  rects: readonly Wall[],
): boolean {
  return rects.some(
    (rect) => rect.w * rect.h > 1 && tileInWall(tile, rect),
  );
}

export function computePhase9Metrics(runs: Phase9RunInput[]): Phase9Payload {
  const carry = computePhase7Metrics(runs as Phase7RunInput[]);
  let wallRectKeyCount = 0;
  let coverRectKeyCount = 0;
  let evacRectKeyCount = 0;
  let singleTileKeyForMultiTileRectCount = 0;
  let slideOutcomeCount = 0;
  let wallOnWallOcclusionCount = 0;
  let evacOutOfChebyshev20Count = 0;
  let insideBearingHereCount = 0;
  const slideByPersona = new Map<PersonaId, number>(
    PERSONA_IDS.map((personaId) => [personaId, 0]),
  );

  for (const run of runs) {
    const world = run.worldState;
    const wallKeys = new Set(world.walls.map((rect) => rectKey("Wall", rect)));

    for (const turn of run.turns) {
      for (const move of turn.resolution.moves) {
        if (!move.slide) continue;
        slideOutcomeCount += 1;
        const record = turn.agentRecords.find(
          (agentRecord) => agentRecord.characterId === move.characterId,
        );
        if (record) {
          slideByPersona.set(
            record.personaId,
            (slideByPersona.get(record.personaId) ?? 0) + 1,
          );
        }
      }

      for (const record of turn.agentRecords) {
        const keys = record.visibleRectKeys ?? [];
        if (record.insideBearingHere === true) insideBearingHereCount += 1;
        for (const key of keys) {
          if (key.startsWith("Wall_")) wallRectKeyCount += 1;
          if (key.startsWith("Cover_")) coverRectKeyCount += 1;
          if (key.startsWith("Evac_")) evacRectKeyCount += 1;

          const single = parseSingleRectKey(key);
          if (single?.prefix === "Wall") {
            if (multiTileRectContaining(single.tile, world.walls)) {
              singleTileKeyForMultiTileRectCount += 1;
            }
          } else if (single?.prefix === "Cover") {
            if (
              multiTileRectContaining(
                single.tile,
                world.coverClusters ?? [],
              )
            ) {
              singleTileKeyForMultiTileRectCount += 1;
            }
          }
        }

        const observerPos = record.observerPos;
        if (!observerPos) continue;
        if (
          keys.some((key) => key.startsWith("Evac_")) &&
          chebyshev(observerPos, world.evac.centre) > VISION_RANGE
        ) {
          evacOutOfChebyshev20Count += 1;
        }

        const visibleKeys = new Set(keys);
        for (const wall of world.walls) {
          if (rectMinChebyshev(observerPos, wall) > VISION_RANGE) continue;
          const key = rectKey("Wall", wall);
          if (visibleKeys.has(key)) continue;
          if (!wallKeys.has(key)) continue;
          if (!rectHasAnyTileWithLos(world.walls, observerPos, wall)) {
            wallOnWallOcclusionCount += 1;
          }
        }
      }
    }
  }

  const slideOutcomePerPersona = PERSONA_IDS.map((personaId) => ({
    personaId,
    count: slideByPersona.get(personaId) ?? 0,
  }));

  const meetsExtractionThreshold = carry.extractionRate >= EXTRACTION_THRESHOLD;
  const meetsKillThreshold = carry.killRate >= KILL_THRESHOLD;
  const meetsEquipThreshold = carry.equipRate >= EQUIP_THRESHOLD;
  const meetsSpeechThreshold = carry.speechRate >= SPEECH_THRESHOLD;
  const meetsPersonaSpreadThreshold =
    carry.personaExtractionSpread >= PERSONA_SPREAD_THRESHOLD_PP;
  const zeroCrashes = carry.failedMatches === 0;
  const zeroIllegalConsumableUse = carry.nullOnlyUseViolations === 0;
  const zeroPlayerNLiterals = carry.playerNLiteralCount === 0;
  const zeroWholeTurnValidatorZeroes =
    carry.wholeTurnZeroedValidatorRecords === 0;
  const meetsZeroCrashThreshold = zeroCrashes;
  const meetsZeroIllegalConsumableThreshold = zeroIllegalConsumableUse;
  const meetsZeroPlayerNLiteralThreshold = zeroPlayerNLiterals;
  const meetsZeroWholeTurnValidatorThreshold = zeroWholeTurnValidatorZeroes;
  const meetsPerFieldRejectionThreshold =
    carry.perFieldRejectionRate <= PER_FIELD_REJECTION_THRESHOLD;
  const allEightCompassBearingsExercised =
    carry.compassBearings.length === COMPASS_BEARINGS;
  const targetRelativeTowardExercised =
    carry.targetRelativeKinds.includes("toward");
  const targetRelativeAwayExercised =
    carry.targetRelativeKinds.includes("away");
  const meetsCompassBearingsThreshold = allEightCompassBearingsExercised;
  const meetsTargetRelativeThreshold =
    targetRelativeTowardExercised && targetRelativeAwayExercised;
  const meetsWallRectKeyThreshold = wallRectKeyCount >= 1;
  const meetsCoverRectKeyThreshold = coverRectKeyCount >= 1;
  const meetsEvacRectKeyThreshold = evacRectKeyCount >= 1;
  const meetsSingleTileKeyDisciplineThreshold =
    singleTileKeyForMultiTileRectCount === 0;
  const meetsSlideOutcomeThreshold =
    slideOutcomeCount >= SLIDE_OUTCOME_THRESHOLD;
  const meetsWallOnWallOcclusionThreshold = wallOnWallOcclusionCount >= 1;
  const meetsEvacOutOfChebyshev20Threshold =
    evacOutOfChebyshev20Count >= 1;
  const meetsInsideBearingHereThreshold = insideBearingHereCount >= 1;
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
    meetsCompassBearingsThreshold,
    meetsTargetRelativeThreshold,
    meetsWallRectKeyThreshold,
    meetsCoverRectKeyThreshold,
    meetsEvacRectKeyThreshold,
    meetsSingleTileKeyDisciplineThreshold,
    meetsSlideOutcomeThreshold,
    meetsWallOnWallOcclusionThreshold,
    meetsEvacOutOfChebyshev20Threshold,
    meetsInsideBearingHereThreshold,
  ];

  return {
    reportType: "phase-9-closing-20",
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
    compassBearings: carry.compassBearings,
    allEightCompassBearingsExercised,
    targetRelativeKinds: carry.targetRelativeKinds,
    targetRelativeTowardExercised,
    targetRelativeAwayExercised,
    validatorRecords: carry.validatorRecords,
    validatorFieldErrors: carry.validatorFieldErrors,
    perFieldRejectionRate: carry.perFieldRejectionRate,
    wholeTurnZeroedValidatorRecords: carry.wholeTurnZeroedValidatorRecords,
    playerNLiteralCount: carry.playerNLiteralCount,
    wallRectKeyCount,
    coverRectKeyCount,
    evacRectKeyCount,
    singleTileKeyForMultiTileRectCount,
    slideOutcomeCount,
    slideOutcomePerPersona,
    wallOnWallOcclusionCount,
    evacOutOfChebyshev20Count,
    insideBearingHereCount,
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
    meetsCompassBearingsThreshold,
    meetsTargetRelativeThreshold,
    meetsWallRectKeyThreshold,
    meetsCoverRectKeyThreshold,
    meetsEvacRectKeyThreshold,
    meetsSingleTileKeyDisciplineThreshold,
    meetsSlideOutcomeThreshold,
    meetsWallOnWallOcclusionThreshold,
    meetsEvacOutOfChebyshev20Threshold,
    meetsInsideBearingHereThreshold,
    meetsAllThresholds: thresholdFlags.every(Boolean),
  };
}

async function persistPhase9Payload(
  ctx: MutationCtx,
  {
    matchIds,
    overwrite,
    payload,
  }: {
    matchIds: Array<Id<"matches">>;
    overwrite?: boolean;
    payload: Phase9Payload;
  },
): Promise<{ _id: string; existed: boolean; payload: Phase9Payload }> {
  if (payload.reportType !== "phase-9-closing-20") {
    throw new Error(`Expected phase-9-closing-20 payload, got ${payload.reportType}`);
  }
  if (payload.runCount !== matchIds.length) {
    throw new Error(
      `Phase 9 payload runCount ${payload.runCount} does not match ${matchIds.length} match ids`,
    );
  }
  const matchIdStrings = matchIds.map((matchId) => matchId as unknown as string);
  const matchIdsHash = await hashMatchIds(matchIdStrings);
  const reportType = "phase-9-closing-20";

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
      payload: existing.phase9Payload as Phase9Payload,
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
    phase9Payload: payload,
  });

  return {
    _id: insertedId as unknown as string,
    existed: false,
    payload,
  };
}

export const persistComputedPhase9Report = mutation({
  args: {
    matchIds: v.array(v.id("matches")),
    overwrite: v.optional(v.boolean()),
    payload: v.any(),
  },
  handler: async (
    ctx,
    { matchIds, overwrite, payload },
  ): Promise<{ _id: string; existed: boolean; payload: Phase9Payload }> =>
    persistPhase9Payload(ctx, {
      matchIds,
      overwrite,
      payload: payload as Phase9Payload,
    }),
});
