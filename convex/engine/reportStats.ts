// WP14 — pure multi-run aggregator (engine layer; no Convex imports).
//
// Walks an array of `RunSummary` rows (the same shape `aggregateRunStats`
// produces in WP12) and produces the multi-run `ReportPayload` per
// mental-model.md §10 done-bar.
//
// Boundary contract (ADR §1, WP14):
//   - Pure function over plain objects; no Convex API access.
//   - WP14-owned: the Convex mutation `reports.create` is a thin wrapper
//     that reads the `runs` rows for a set of matchIds and calls this
//     pure function.
//   - Mirrors the runStats.ts shape exactly (same engine-layer purity).
//
// Counter / rate semantics (locked):
//
//   runCount: input.length. The Stage-3 expected count (50) is enforced by
//             the harness, not the aggregator.
//
//   kills / extractions / equips / speechEvents: simple sums of the
//             per-run RunSummary fields.
//
//   runsWithAtLeastOne*: count of runs whose corresponding field > 0. The
//             "≥ 1 per run" semantic is what mental-model.md §10 measures
//             ("≥ 80% of runs contain at least one kill"), distinct from
//             the totals above.
//
//   *Rate (killRate / extractionRate / equipRate / speechRate): the
//             ≥1-per-run rate as a float in [0, 1] = runsWithAtLeastOne* /
//             runCount. Empty input → 0 (NOT NaN); the explicit guard
//             below safely handles the degenerate case.
//
//   perPersona[8]: per-persona aggregation keyed by the 8 locked
//             PersonaIds. Sums `kills`, `equips`, `speechEvents`,
//             `extracted` across runs. Adds:
//               - `extractionsCount`: count of runs in which that persona's
//                 `extracted` field was > 0 (NOT the same as the sum of
//                 `extracted` — runs can have at most 1 character per
//                 persona by the locked roster, so for the v0 substrate
//                 they coincide; the per-run count semantic is the one
//                 mental-model.md §10 uses for spread).
//               - `extractionRate`: extractionsCount / runCount in [0, 1].
//
//   personaExtractionSpread: max - min of `perPersona[].extractionRate`
//             across all 8 personas, scaled to PERCENTAGE POINTS (0..100)
//             so the §10 threshold "≥ 15pp" reads directly. Empty input →
//             0 (max == min == 0).
//
// Threshold flags (mental-model.md §10 done-bar — verbatim cutoffs):
//   meetsExtractionThreshold:  extractionRate ≥ 0.30
//   meetsKillThreshold:        killRate       ≥ 0.80
//   meetsEquipThreshold:       equipRate      ≥ 0.80
//   meetsSpeechThreshold:      speechRate     ≥ 0.50
//   meetsPersonaSpreadThreshold: personaExtractionSpread ≥ 15 (pp)
//   meetsAllThresholds: AND of the five above.
//
// Note: 50/50 crash-free is the harness's responsibility, not this layer's.
// The aggregator does NOT echo expectedRunCount; the harness already knows
// how many runs it dispatched and refuses to call reports.create with the
// wrong set.
//
// Cross-references:
//   - mental-model.md §10 — done-bar thresholds (single source of truth).
//   - convex/engine/runStats.ts — `RunSummary` / `PerPersonaStats` (input).
//   - work-packages.md WP14 — acceptance criteria.

import {
  PERSONA_IDS,
  type PersonaId,
} from "./types.js";
import type { PerPersonaStats, RunSummary } from "./runStats.js";

// ─── Threshold constants (mental-model.md §10 done-bar) ──────────────────

/** ≥ 30% of runs end with at least one extraction. */
const EXTRACTION_THRESHOLD = 0.3;

/** ≥ 80% of runs contain at least one kill. */
const KILL_THRESHOLD = 0.8;

/** ≥ 80% of runs contain at least one crate equip. */
const EQUIP_THRESHOLD = 0.8;

/** ≥ 50% of runs contain at least one speech event. */
const SPEECH_THRESHOLD = 0.5;

/** Per-persona extraction-rate spread ≥ 15 percentage points. */
const PERSONA_SPREAD_THRESHOLD_PP = 15;

// ─── Types ────────────────────────────────────────────────────────────────

/**
 * Input shape for one run — matches `RunSummary` (the non-pk fields of a
 * `runs` row). Aliased here so callers don't have to import RunSummary
 * directly when they're already importing the report API.
 */
export type ReportRunInput = RunSummary;

/** Per-persona aggregation across runs (one entry per locked PersonaId). */
export type ReportPerPersonaStats = {
  personaId: PersonaId;
  /** Sum of per-run `kills` across all runs. */
  kills: number;
  /** Sum of per-run `equips` across all runs. */
  equips: number;
  /** Sum of per-run `speechEvents` across all runs. */
  speechEvents: number;
  /** Sum of per-run `extracted` (per-run character-count) across all runs. */
  extracted: number;
  /**
   * Number of RUNS in which this persona had `extracted > 0` (i.e. at least
   * one of its characters extracted in that run). The §10 spread metric
   * uses this — distinct from `extracted` (which could in theory exceed
   * runCount if a persona had multiple characters per run, though the v0
   * roster locks it at 1 char per persona).
   */
  extractionsCount: number;
  /** extractionsCount / runCount in [0, 1]. 0 when runCount = 0. */
  extractionRate: number;
};

/** The full multi-run report payload (mental-model.md §10 done-bar). */
export type ReportPayload = {
  // ── Run counts ───────────────────────────────────────────────────────
  runCount: number;

  // ── Top-level sums across runs ───────────────────────────────────────
  kills: number;
  extractions: number;
  equips: number;
  speechEvents: number;

  // ── Per-§10 "≥ 1 per run" counts and rates ───────────────────────────
  runsWithAtLeastOneKill: number;
  runsWithAtLeastOneExtraction: number;
  runsWithAtLeastOneEquip: number;
  runsWithAtLeastOneSpeech: number;

  killRate: number;
  extractionRate: number;
  equipRate: number;
  speechRate: number;

  // ── Per-persona breakdown ────────────────────────────────────────────
  perPersona: ReportPerPersonaStats[];

  /** max - min of perPersona[].extractionRate, in percentage points (0..100). */
  personaExtractionSpread: number;

  // ── Threshold flags (§10 done-bar) ───────────────────────────────────
  meetsExtractionThreshold: boolean;
  meetsKillThreshold: boolean;
  meetsEquipThreshold: boolean;
  meetsSpeechThreshold: boolean;
  meetsPersonaSpreadThreshold: boolean;
  meetsAllThresholds: boolean;
};

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Initialise an empty per-persona working accumulator (kills/equips/speech/
 * extracted/extractionsCount), seeded with all 8 locked PersonaIds. The
 * `extractionRate` field is computed at finalisation time.
 */
function emptyPerPersonaAcc(): Map<
  PersonaId,
  Omit<ReportPerPersonaStats, "extractionRate">
> {
  const map = new Map<
    PersonaId,
    Omit<ReportPerPersonaStats, "extractionRate">
  >();
  for (const id of PERSONA_IDS) {
    map.set(id, {
      personaId: id,
      kills: 0,
      equips: 0,
      speechEvents: 0,
      extracted: 0,
      extractionsCount: 0,
    });
  }
  return map;
}

/**
 * Safe division: returns 0 when `denom` is 0 (NOT NaN). This is the
 * empty-input guard that keeps every rate field downstream-safe.
 */
function safeRate(num: number, denom: number): number {
  if (denom === 0) return 0;
  return num / denom;
}

// ─── Public aggregator ────────────────────────────────────────────────────

/**
 * Walk N `RunSummary` rows and produce the multi-run `ReportPayload`.
 * Pure / no I/O — testable without Convex.
 *
 * Inputs:
 *   - `runs`: array of per-run summaries. Order does not matter; the
 *     aggregator never reads a row by index. May be empty (returns the
 *     zero-shaped payload with all `meets*` flags false).
 *
 * Returns: a `ReportPayload`. Always exactly 8 entries in `perPersona`,
 * one per locked PersonaId (zero-filled for personas absent in any run —
 * keeps the report shape stable for Stage-3 dispatch).
 */
export function aggregateReportStats(runs: ReportRunInput[]): ReportPayload {
  const runCount = runs.length;

  // Top-level sums + ≥1-per-run counters.
  let kills = 0;
  let extractions = 0;
  let equips = 0;
  let speechEvents = 0;

  let runsWithAtLeastOneKill = 0;
  let runsWithAtLeastOneExtraction = 0;
  let runsWithAtLeastOneEquip = 0;
  let runsWithAtLeastOneSpeech = 0;

  const perPersona = emptyPerPersonaAcc();

  for (const r of runs) {
    kills += r.kills;
    extractions += r.extractions;
    equips += r.equips;
    speechEvents += r.speechEvents;

    if (r.kills > 0) runsWithAtLeastOneKill += 1;
    if (r.extractions > 0) runsWithAtLeastOneExtraction += 1;
    if (r.equips > 0) runsWithAtLeastOneEquip += 1;
    if (r.speechEvents > 0) runsWithAtLeastOneSpeech += 1;

    // Per-persona accumulation. Defensive: only fold known PersonaIds — if
    // an upstream RunSummary contains a stray persona key (it shouldn't,
    // since runStats seeds all 8) we skip rather than crash.
    for (const pp of r.perPersona) {
      const acc = perPersona.get(pp.personaId);
      if (!acc) continue;
      acc.kills += pp.kills;
      acc.equips += pp.equips;
      acc.speechEvents += pp.speechEvents;
      acc.extracted += pp.extracted;
      if (pp.extracted > 0) acc.extractionsCount += 1;
    }
  }

  // Materialise per-persona stats with extractionRate finalised.
  const perPersonaArr: ReportPerPersonaStats[] = PERSONA_IDS.map((id) => {
    const acc = perPersona.get(id);
    // Defensive — emptyPerPersonaAcc seeded all 8 ids; this branch is
    // unreachable in practice but keeps the type strictly non-undefined.
    if (!acc) {
      return {
        personaId: id,
        kills: 0,
        equips: 0,
        speechEvents: 0,
        extracted: 0,
        extractionsCount: 0,
        extractionRate: 0,
      };
    }
    return {
      ...acc,
      extractionRate: safeRate(acc.extractionsCount, runCount),
    };
  });

  // Persona extraction-rate spread, in percentage points.
  let personaExtractionSpread = 0;
  if (perPersonaArr.length > 0) {
    let minRate = Infinity;
    let maxRate = -Infinity;
    for (const p of perPersonaArr) {
      if (p.extractionRate < minRate) minRate = p.extractionRate;
      if (p.extractionRate > maxRate) maxRate = p.extractionRate;
    }
    if (Number.isFinite(minRate) && Number.isFinite(maxRate)) {
      personaExtractionSpread = (maxRate - minRate) * 100;
    }
  }

  // Rates (safe — `safeRate` guards runCount === 0).
  const killRate = safeRate(runsWithAtLeastOneKill, runCount);
  const extractionRate = safeRate(runsWithAtLeastOneExtraction, runCount);
  const equipRate = safeRate(runsWithAtLeastOneEquip, runCount);
  const speechRate = safeRate(runsWithAtLeastOneSpeech, runCount);

  // Threshold flags. On empty input every rate is 0 and the spread is 0,
  // so every `meets*` flag below evaluates to false (the explicit
  // empty-runs short-circuit keeps that invariant readable). Each flag
  // maps verbatim to mental-model.md §10.
  const empty = runCount === 0;
  const meetsExtractionThreshold = !empty && extractionRate >= EXTRACTION_THRESHOLD;
  const meetsKillThreshold = !empty && killRate >= KILL_THRESHOLD;
  const meetsEquipThreshold = !empty && equipRate >= EQUIP_THRESHOLD;
  const meetsSpeechThreshold = !empty && speechRate >= SPEECH_THRESHOLD;
  const meetsPersonaSpreadThreshold =
    !empty && personaExtractionSpread >= PERSONA_SPREAD_THRESHOLD_PP;
  const meetsAllThresholds =
    meetsExtractionThreshold &&
    meetsKillThreshold &&
    meetsEquipThreshold &&
    meetsSpeechThreshold &&
    meetsPersonaSpreadThreshold;

  return {
    runCount,
    kills,
    extractions,
    equips,
    speechEvents,
    runsWithAtLeastOneKill,
    runsWithAtLeastOneExtraction,
    runsWithAtLeastOneEquip,
    runsWithAtLeastOneSpeech,
    killRate,
    extractionRate,
    equipRate,
    speechRate,
    perPersona: perPersonaArr,
    personaExtractionSpread,
    meetsExtractionThreshold,
    meetsKillThreshold,
    meetsEquipThreshold,
    meetsSpeechThreshold,
    meetsPersonaSpreadThreshold,
    meetsAllThresholds,
  };
}

// ─── Re-exports for convenience ──────────────────────────────────────────

export type { PerPersonaStats, RunSummary };
