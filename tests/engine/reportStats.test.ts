// WP14 — pure multi-run aggregator tests (RED phase per AOP).
//
// Tests-first. The pure aggregator `aggregateReportStats` walks an array of
// `RunSummary` rows (the same shape `aggregateRunStats` produces in WP12)
// and produces the multi-run `ReportPayload` per mental-model.md §10
// done-bar. The Convex mutation `convex/reports.ts` is a thin wrapper that
// reads `runs` rows and calls this pure function.
//
// Boundary contract (ADR §1, WP14):
//   - Pure function over plain objects; no Convex API access.
//   - Empty input (runs=[]) → all zeros, no NaN, all `meets*` flags false.
//   - All `meets*` flags map to mental-model.md §10 thresholds verbatim:
//       extraction ≥ 30%, kill ≥ 80%, equip ≥ 80%, speech ≥ 50%,
//       persona-extraction-rate spread ≥ 15pp.
//
// Cross-references:
//   - mental-model.md §10 — Gate-3 done-bar (locked thresholds).
//   - convex/engine/runStats.ts — `RunSummary` shape this aggregator consumes.
//   - convex/engine/reportStats.ts — implementation under test.

import { describe, expect, it } from "vitest";
import {
  aggregateReportStats,
  type ReportRunInput,
} from "../../convex/engine/reportStats.js";
import type { PerPersonaStats } from "../../convex/engine/runStats.js";
import { PERSONA_IDS, type PersonaId } from "../../convex/engine/types.js";

// ─── Test fixtures ────────────────────────────────────────────────────────

/** Build an 8-entry per-persona stats array, zeros-by-default; overrides
 *  let a test stamp specific personas with non-zero values. */
function perPersona(
  overrides: Partial<Record<PersonaId, Partial<PerPersonaStats>>> = {},
): PerPersonaStats[] {
  return PERSONA_IDS.map((id) => {
    const base: PerPersonaStats = {
      personaId: id,
      survivedTurns: 0,
      kills: 0,
      extracted: 0,
      equips: 0,
      speechEvents: 0,
    };
    const o = overrides[id];
    return o ? { ...base, ...o } : base;
  });
}

/** Build a minimal `RunSummary`-shaped run input. */
function run(opts: Partial<ReportRunInput> = {}): ReportRunInput {
  return {
    kills: opts.kills ?? 0,
    extractions: opts.extractions ?? 0,
    equips: opts.equips ?? 0,
    speechEvents: opts.speechEvents ?? 0,
    perPersona: opts.perPersona ?? perPersona(),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("WP14 — aggregateReportStats: empty input", () => {
  it("empty input → all numerics are 0, no NaN, all meets* flags false", () => {
    const r = aggregateReportStats([]);

    expect(r.runCount).toBe(0);
    expect(r.kills).toBe(0);
    expect(r.extractions).toBe(0);
    expect(r.equips).toBe(0);
    expect(r.speechEvents).toBe(0);

    expect(r.runsWithAtLeastOneKill).toBe(0);
    expect(r.runsWithAtLeastOneExtraction).toBe(0);
    expect(r.runsWithAtLeastOneEquip).toBe(0);
    expect(r.runsWithAtLeastOneSpeech).toBe(0);

    expect(r.killRate).toBe(0);
    expect(r.extractionRate).toBe(0);
    expect(r.equipRate).toBe(0);
    expect(r.speechRate).toBe(0);

    // No NaN anywhere on the rates.
    expect(Number.isNaN(r.killRate)).toBe(false);
    expect(Number.isNaN(r.extractionRate)).toBe(false);
    expect(Number.isNaN(r.equipRate)).toBe(false);
    expect(Number.isNaN(r.speechRate)).toBe(false);

    expect(r.personaExtractionSpread).toBe(0);

    // perPersona always has 8 entries (Gate-3 stable shape).
    expect(r.perPersona).toHaveLength(8);
    for (const p of r.perPersona) {
      expect(p.kills).toBe(0);
      expect(p.equips).toBe(0);
      expect(p.speechEvents).toBe(0);
      expect(p.extracted).toBe(0);
      expect(p.extractionsCount).toBe(0);
      expect(p.extractionRate).toBe(0);
      expect(Number.isNaN(p.extractionRate)).toBe(false);
    }

    // All meets* flags false on empty input.
    expect(r.meetsExtractionThreshold).toBe(false);
    expect(r.meetsKillThreshold).toBe(false);
    expect(r.meetsEquipThreshold).toBe(false);
    expect(r.meetsSpeechThreshold).toBe(false);
    expect(r.meetsPersonaSpreadThreshold).toBe(false);
    expect(r.meetsAllThresholds).toBe(false);
  });
});

describe("WP14 — aggregateReportStats: single-run scenarios", () => {
  it("single run with 1 kill → killRate = 1.0, meetsKillThreshold = true", () => {
    const r = aggregateReportStats([run({ kills: 1 })]);
    expect(r.runCount).toBe(1);
    expect(r.kills).toBe(1);
    expect(r.runsWithAtLeastOneKill).toBe(1);
    expect(r.killRate).toBe(1.0);
    expect(r.meetsKillThreshold).toBe(true);
  });

  it("single run with 0 kills → killRate = 0, meetsKillThreshold = false", () => {
    const r = aggregateReportStats([run({ kills: 0 })]);
    expect(r.killRate).toBe(0);
    expect(r.meetsKillThreshold).toBe(false);
  });

  it("single run with 1 extraction → extractionRate = 1.0, meetsExtractionThreshold = true", () => {
    const r = aggregateReportStats([
      run({ extractions: 1, perPersona: perPersona({ rat: { extracted: 1 } }) }),
    ]);
    expect(r.extractionRate).toBe(1.0);
    expect(r.runsWithAtLeastOneExtraction).toBe(1);
    expect(r.meetsExtractionThreshold).toBe(true);
  });

  it("single run with 1 equip → equipRate = 1.0, meetsEquipThreshold = true", () => {
    const r = aggregateReportStats([run({ equips: 1 })]);
    expect(r.equipRate).toBe(1.0);
    expect(r.meetsEquipThreshold).toBe(true);
  });

  it("single run with 1 speech event → speechRate = 1.0, meetsSpeechThreshold = true", () => {
    const r = aggregateReportStats([run({ speechEvents: 1 })]);
    expect(r.speechRate).toBe(1.0);
    expect(r.meetsSpeechThreshold).toBe(true);
  });
});

describe("WP14 — aggregateReportStats: rate semantics (≥1 per run)", () => {
  it("Stage-2-shaped data: 10 runs, kills concentrated in 4 runs → killRate = 0.4, meetsKillThreshold = false", () => {
    // 4 of 10 runs have ≥1 kill; the other 6 have zero. killRate = 4/10 = 0.4.
    const runs: ReportRunInput[] = [
      run({ kills: 2 }), // 1
      run({ kills: 1 }), // 2
      run({ kills: 0 }),
      run({ kills: 3 }), // 3
      run({ kills: 0 }),
      run({ kills: 0 }),
      run({ kills: 1 }), // 4
      run({ kills: 0 }),
      run({ kills: 0 }),
      run({ kills: 0 }),
    ];
    const r = aggregateReportStats(runs);
    expect(r.runCount).toBe(10);
    expect(r.kills).toBe(7); // sum
    expect(r.runsWithAtLeastOneKill).toBe(4);
    expect(r.killRate).toBeCloseTo(0.4, 10);
    expect(r.meetsKillThreshold).toBe(false); // 0.4 < 0.8
  });

  it("kills sum across runs (top-level kills) is independent from runs-with-kill count", () => {
    // 2 runs each with 5 kills → total kills = 10 but only 2 runs have kills.
    const r = aggregateReportStats([run({ kills: 5 }), run({ kills: 5 })]);
    expect(r.kills).toBe(10);
    expect(r.runsWithAtLeastOneKill).toBe(2);
    expect(r.killRate).toBe(1.0); // 2/2
  });

  it("equipRate, speechRate, extractionRate use the same ≥1-per-run semantic", () => {
    // 5 runs total. extractions: runs 0,1 each have 1 → 2/5 = 0.4.
    // equips: runs 0,1,2,3 → 4/5 = 0.8. speech: run 0 only → 1/5 = 0.2.
    const runs: ReportRunInput[] = [
      run({
        extractions: 1,
        equips: 2,
        speechEvents: 3,
        perPersona: perPersona({ rat: { extracted: 1 } }),
      }),
      run({
        extractions: 1,
        equips: 1,
        speechEvents: 0,
        perPersona: perPersona({ duelist: { extracted: 1 } }),
      }),
      run({ extractions: 0, equips: 1, speechEvents: 0 }),
      run({ extractions: 0, equips: 1, speechEvents: 0 }),
      run({ extractions: 0, equips: 0, speechEvents: 0 }),
    ];
    const r = aggregateReportStats(runs);
    expect(r.runCount).toBe(5);
    expect(r.extractionRate).toBeCloseTo(0.4, 10);
    expect(r.equipRate).toBeCloseTo(0.8, 10);
    expect(r.speechRate).toBeCloseTo(0.2, 10);
    expect(r.meetsExtractionThreshold).toBe(true); // 0.4 ≥ 0.3
    expect(r.meetsEquipThreshold).toBe(true); // 0.8 ≥ 0.8
    expect(r.meetsSpeechThreshold).toBe(false); // 0.2 < 0.5
  });
});

describe("WP14 — aggregateReportStats: §10 done-bar threshold boundaries (exact)", () => {
  it("extractionRate = 0.3 (boundary) → meetsExtractionThreshold = true", () => {
    // 3/10 runs extract.
    const runs: ReportRunInput[] = [];
    for (let i = 0; i < 10; i++) {
      const extracted = i < 3 ? 1 : 0;
      runs.push(
        run({
          extractions: extracted,
          perPersona: perPersona(extracted ? { rat: { extracted: 1 } } : {}),
        }),
      );
    }
    const r = aggregateReportStats(runs);
    expect(r.extractionRate).toBeCloseTo(0.3, 10);
    expect(r.meetsExtractionThreshold).toBe(true);
  });

  it("killRate = 0.8 (boundary) → meetsKillThreshold = true", () => {
    const runs: ReportRunInput[] = [];
    for (let i = 0; i < 10; i++) {
      runs.push(run({ kills: i < 8 ? 1 : 0 }));
    }
    const r = aggregateReportStats(runs);
    expect(r.killRate).toBeCloseTo(0.8, 10);
    expect(r.meetsKillThreshold).toBe(true);
  });

  it("equipRate = 0.8 (boundary) → meetsEquipThreshold = true; 0.79 → false", () => {
    // 8/10 → true.
    const runs8: ReportRunInput[] = [];
    for (let i = 0; i < 10; i++) {
      runs8.push(run({ equips: i < 8 ? 1 : 0 }));
    }
    expect(aggregateReportStats(runs8).meetsEquipThreshold).toBe(true);

    // 7/10 = 0.7 → false.
    const runs7: ReportRunInput[] = [];
    for (let i = 0; i < 10; i++) {
      runs7.push(run({ equips: i < 7 ? 1 : 0 }));
    }
    expect(aggregateReportStats(runs7).meetsEquipThreshold).toBe(false);
  });

  it("speechRate = 0.5 (boundary) → meetsSpeechThreshold = true", () => {
    const runs: ReportRunInput[] = [];
    for (let i = 0; i < 10; i++) {
      runs.push(run({ speechEvents: i < 5 ? 1 : 0 }));
    }
    const r = aggregateReportStats(runs);
    expect(r.speechRate).toBeCloseTo(0.5, 10);
    expect(r.meetsSpeechThreshold).toBe(true);
  });
});

describe("WP14 — aggregateReportStats: per-persona aggregation", () => {
  it("perPersona sums kills/equips/speechEvents/extracted across runs", () => {
    // 3 runs. rat: 1+2+0=3 kills, 0 equips, 0 speech. duelist: 0 kills, 1+0+1=2 equips.
    const runs: ReportRunInput[] = [
      run({
        kills: 1,
        equips: 1,
        perPersona: perPersona({
          rat: { kills: 1 },
          duelist: { equips: 1 },
        }),
      }),
      run({
        kills: 2,
        perPersona: perPersona({ rat: { kills: 2 } }),
      }),
      run({
        equips: 1,
        perPersona: perPersona({ duelist: { equips: 1 } }),
      }),
    ];
    const r = aggregateReportStats(runs);
    const pBy = Object.fromEntries(
      r.perPersona.map((p) => [p.personaId, p]),
    );
    expect(pBy.rat?.kills).toBe(3);
    expect(pBy.duelist?.equips).toBe(2);
    expect(pBy.trader?.kills).toBe(0);
  });

  it("perPersona.extractionsCount counts runs (not characters) where the persona extracted", () => {
    // 4 runs. rat extracts in 3 of them → extractionsCount = 3, extractionRate = 0.75.
    // duelist extracts in 0 → extractionsCount = 0, extractionRate = 0.
    const runs: ReportRunInput[] = [
      run({
        extractions: 1,
        perPersona: perPersona({ rat: { extracted: 1 } }),
      }),
      run({
        extractions: 1,
        perPersona: perPersona({ rat: { extracted: 1 } }),
      }),
      run({
        extractions: 1,
        perPersona: perPersona({ rat: { extracted: 1 } }),
      }),
      run({ extractions: 0 }),
    ];
    const r = aggregateReportStats(runs);
    const pBy = Object.fromEntries(
      r.perPersona.map((p) => [p.personaId, p]),
    );
    expect(pBy.rat?.extractionsCount).toBe(3);
    expect(pBy.rat?.extractionRate).toBeCloseTo(0.75, 10);
    expect(pBy.duelist?.extractionsCount).toBe(0);
    expect(pBy.duelist?.extractionRate).toBe(0);
  });

  it("perPersona has exactly 8 entries (one per locked PersonaId), even if some had no rows", () => {
    const r = aggregateReportStats([run({ kills: 1 })]);
    expect(r.perPersona).toHaveLength(8);
    const ids = r.perPersona.map((p) => p.personaId).sort();
    expect(ids).toEqual([...PERSONA_IDS].sort());
  });
});

describe("WP14 — aggregateReportStats: persona-extraction-rate spread (§10 ≥15pp)", () => {
  it("1 persona at 100% extraction, 1 at 0%, others mid → spread = 100pp", () => {
    // 4 runs.
    // rat extracts in all 4 → 1.0 (100%)
    // duelist extracts in 0 → 0.0 (0%)
    // trader extracts in 2 → 0.5 (50%)
    const runs: ReportRunInput[] = [
      run({
        extractions: 2,
        perPersona: perPersona({
          rat: { extracted: 1 },
          trader: { extracted: 1 },
        }),
      }),
      run({
        extractions: 2,
        perPersona: perPersona({
          rat: { extracted: 1 },
          trader: { extracted: 1 },
        }),
      }),
      run({
        extractions: 1,
        perPersona: perPersona({ rat: { extracted: 1 } }),
      }),
      run({
        extractions: 1,
        perPersona: perPersona({ rat: { extracted: 1 } }),
      }),
    ];
    const r = aggregateReportStats(runs);
    // spread is in percentage points (0..100), not a fraction.
    expect(r.personaExtractionSpread).toBeCloseTo(100, 10);
    expect(r.meetsPersonaSpreadThreshold).toBe(true); // 100 ≥ 15
  });

  it("all personas at identical extraction rate → spread = 0pp, meetsPersonaSpreadThreshold = false", () => {
    // 1 run, every persona extracts.
    const everyone: Partial<Record<PersonaId, Partial<PerPersonaStats>>> = {};
    for (const id of PERSONA_IDS) everyone[id] = { extracted: 1 };
    const r = aggregateReportStats([
      run({ extractions: 8, perPersona: perPersona(everyone) }),
    ]);
    expect(r.personaExtractionSpread).toBeCloseTo(0, 10);
    expect(r.meetsPersonaSpreadThreshold).toBe(false);
  });

  it("spread = 15pp boundary → meetsPersonaSpreadThreshold = true", () => {
    // 100 runs total. rat extracts in 25 runs (25%). duelist in 10 runs (10%).
    // others all 0. spread = 25 - 0 = 25pp (over 15pp).
    // Refine to exactly 15pp: rat 15, duelist 0 → 15pp.
    const runs: ReportRunInput[] = [];
    for (let i = 0; i < 100; i++) {
      const overrides: Partial<Record<PersonaId, Partial<PerPersonaStats>>> = {};
      let extractions = 0;
      if (i < 15) {
        overrides.rat = { extracted: 1 };
        extractions += 1;
      }
      runs.push(run({ extractions, perPersona: perPersona(overrides) }));
    }
    const r = aggregateReportStats(runs);
    expect(r.personaExtractionSpread).toBeCloseTo(15, 10);
    expect(r.meetsPersonaSpreadThreshold).toBe(true);
  });

  it("spread = 14pp → meetsPersonaSpreadThreshold = false", () => {
    const runs: ReportRunInput[] = [];
    for (let i = 0; i < 100; i++) {
      const overrides: Partial<Record<PersonaId, Partial<PerPersonaStats>>> = {};
      let extractions = 0;
      if (i < 14) {
        overrides.rat = { extracted: 1 };
        extractions += 1;
      }
      runs.push(run({ extractions, perPersona: perPersona(overrides) }));
    }
    const r = aggregateReportStats(runs);
    expect(r.personaExtractionSpread).toBeCloseTo(14, 10);
    expect(r.meetsPersonaSpreadThreshold).toBe(false);
  });
});

describe("WP14 — aggregateReportStats: meetsAllThresholds composition", () => {
  it("all 5 thresholds met simultaneously → meetsAllThresholds = true", () => {
    // Construct a scenario that clears all 5 thresholds:
    //   extractionRate ≥ 30%, killRate ≥ 80%, equipRate ≥ 80%,
    //   speechRate ≥ 50%, personaSpread ≥ 15pp.
    // 10 runs:
    //   - runs 0..4 (5 runs): rat extracts, all have kill+equip+speech.
    //   - runs 5..7 (3 runs): no extractions but kill+equip+speech.
    //   - runs 8..9 (2 runs): kill+equip only (no speech to keep speech below
    //     100% but ≥50% — actually we want speech ≥50% so 5 of 10 minimum).
    // extractionRate = 5/10 = 0.5 ≥ 0.3 ✓
    // killRate = 10/10 = 1.0 ≥ 0.8 ✓
    // equipRate = 10/10 = 1.0 ≥ 0.8 ✓
    // speechRate = 8/10 = 0.8 ≥ 0.5 ✓
    // perPersona.rat extractionRate = 5/10 = 0.5; duelist = 0 → spread = 50pp ≥ 15 ✓
    const runs: ReportRunInput[] = [];
    for (let i = 0; i < 10; i++) {
      const extracted = i < 5;
      const speech = i < 8 ? 1 : 0;
      runs.push(
        run({
          extractions: extracted ? 1 : 0,
          kills: 1,
          equips: 1,
          speechEvents: speech,
          perPersona: perPersona(
            extracted ? { rat: { extracted: 1 } } : {},
          ),
        }),
      );
    }
    const r = aggregateReportStats(runs);
    expect(r.meetsExtractionThreshold).toBe(true);
    expect(r.meetsKillThreshold).toBe(true);
    expect(r.meetsEquipThreshold).toBe(true);
    expect(r.meetsSpeechThreshold).toBe(true);
    expect(r.meetsPersonaSpreadThreshold).toBe(true);
    expect(r.meetsAllThresholds).toBe(true);
  });

  it("meetsAllThresholds = false if any single threshold fails", () => {
    // Same as above scenario but speechRate is 4/10 = 0.4 < 0.5 — only one
    // threshold below cutoff; meetsAllThresholds must be false.
    const runs: ReportRunInput[] = [];
    for (let i = 0; i < 10; i++) {
      const extracted = i < 5;
      const speech = i < 4 ? 1 : 0;
      runs.push(
        run({
          extractions: extracted ? 1 : 0,
          kills: 1,
          equips: 1,
          speechEvents: speech,
          perPersona: perPersona(
            extracted ? { rat: { extracted: 1 } } : {},
          ),
        }),
      );
    }
    const r = aggregateReportStats(runs);
    expect(r.meetsExtractionThreshold).toBe(true);
    expect(r.meetsKillThreshold).toBe(true);
    expect(r.meetsEquipThreshold).toBe(true);
    expect(r.meetsSpeechThreshold).toBe(false); // < 0.5
    expect(r.meetsAllThresholds).toBe(false);
  });
});

describe("WP14 — aggregateReportStats: top-level sums across runs", () => {
  it("kills/extractions/equips/speechEvents = simple sums of per-run counts", () => {
    const runs: ReportRunInput[] = [
      run({ kills: 1, extractions: 1, equips: 2, speechEvents: 3 }),
      run({ kills: 4, extractions: 0, equips: 1, speechEvents: 1 }),
      run({ kills: 2, extractions: 2, equips: 0, speechEvents: 5 }),
    ];
    const r = aggregateReportStats(runs);
    expect(r.kills).toBe(7);
    expect(r.extractions).toBe(3);
    expect(r.equips).toBe(3);
    expect(r.speechEvents).toBe(9);
  });
});
