// WP14 — Convex `reports.create` mutation tests (RED phase per AOP).
//
// Tests-first per `.agents/AGENTS.md` AOP. The mutation orchestrator is
// extracted as a pure helper `runReportCreate(deps, args)` (mirroring
// the `runHarness` / `buildAgentLlmRecord` DI pattern in tests/harness/run.test.ts
// and tests/runMatch.test.ts) so the orchestration logic is unit-testable
// without Convex runtime. The Convex mutation `reports.create` is then a
// thin wrapper that wires `ctx.db` reads/writes into the same helper.
//
// Three contract scenarios pinned here:
//
//   1. Happy path — 3 matches each have a `runs` row → mutation reads them,
//      aggregates, writes a `reports` row, returns the new id + payload.
//      `missingRunsForMatchIds` is empty.
//
//   2. Idempotency — calling reports.create twice with the same matchIds set
//      AND same reportType returns the same `_id` and does NOT insert a
//      second row. The hash is order-independent — calling with reordered
//      matchIds also hits the same row (verifies the sort-then-hash semantic).
//
//   3. Missing-runs tolerance — 2 of 3 matches have rows, 1 doesn't. The
//      aggregator runs over the 2 present rows; `missingRunsForMatchIds`
//      lists the 1 missing.
//
// Cross-references:
//   - convex/reports.ts — runReportCreate + the mutation wrapper.
//   - convex/engine/reportStats.ts — pure aggregator.
//   - work-packages.md WP14 acceptance.

import { describe, expect, it } from "vitest";
import {
  runReportCreate,
  hashMatchIds,
  type ReportCreateDeps,
  type ReportCreateRow,
} from "../convex/reports.js";
import type { RunSummary } from "../convex/engine/runStats.js";
import { PERSONA_IDS, type PersonaId } from "../convex/engine/types.js";

// ─── Test fixtures ────────────────────────────────────────────────────────

function emptyPerPersona() {
  return PERSONA_IDS.map((id) => ({
    personaId: id as PersonaId,
    survivedTurns: 50,
    kills: 0,
    extracted: 0,
    equips: 0,
    speechEvents: 0,
  }));
}

function buildRunRow(opts: {
  matchId: string;
  kills?: number;
  extractions?: number;
  equips?: number;
  speechEvents?: number;
}): { _id: string; matchId: string } & RunSummary {
  return {
    _id: `runs_${opts.matchId}`,
    matchId: opts.matchId,
    kills: opts.kills ?? 0,
    extractions: opts.extractions ?? 0,
    equips: opts.equips ?? 0,
    speechEvents: opts.speechEvents ?? 0,
    perPersona: emptyPerPersona(),
  };
}

/**
 * Build an in-memory `ReportCreateDeps` fake. The test populates a per-
 * matchId run-row map; the deps surface mirrors what the Convex mutation
 * does internally (read runs by matchId, query existing reports by hash,
 * insert new report row).
 */
function makeDeps(args: {
  runRows: Record<string, ({ _id: string; matchId: string } & RunSummary) | null>;
  initialReports?: ReportCreateRow[];
}): {
  deps: ReportCreateDeps;
  state: {
    reports: ReportCreateRow[];
    runReadCalls: string[];
    indexQueryCalls: Array<{ matchIdsHash: string; reportType: string }>;
  };
} {
  const reports: ReportCreateRow[] = args.initialReports
    ? [...args.initialReports]
    : [];
  const state = {
    reports,
    runReadCalls: [] as string[],
    indexQueryCalls: [] as Array<{ matchIdsHash: string; reportType: string }>,
  };

  let nextReportSeq = reports.length + 1;

  const deps: ReportCreateDeps = {
    readRunByMatchId: async (matchId: string) => {
      state.runReadCalls.push(matchId);
      return args.runRows[matchId] ?? null;
    },
    findReportByHashAndType: async (matchIdsHash, reportType) => {
      state.indexQueryCalls.push({ matchIdsHash, reportType });
      return reports.find(
        (r) =>
          r.matchIdsHash === matchIdsHash && r.reportType === reportType,
      ) ?? null;
    },
    insertReport: async (row) => {
      const _id = `report_${nextReportSeq++}`;
      const inserted: ReportCreateRow = { ...row, _id };
      reports.push(inserted);
      return _id;
    },
    now: () => 1_700_000_000_000,
  };

  return { deps, state };
}

// ─── hashMatchIds — deterministic + order-independent ────────────────────

describe("WP14 — hashMatchIds: deterministic + order-independent", () => {
  it("produces a hex string", async () => {
    const h = await hashMatchIds(["m1", "m2", "m3"]);
    expect(typeof h).toBe("string");
    expect(h).toMatch(/^[0-9a-f]+$/);
    expect(h.length).toBeGreaterThan(0);
  });

  it("identical input → identical hash", async () => {
    const a = await hashMatchIds(["m1", "m2", "m3"]);
    const b = await hashMatchIds(["m1", "m2", "m3"]);
    expect(a).toBe(b);
  });

  it("reordered input → identical hash (sort-then-hash semantic)", async () => {
    const a = await hashMatchIds(["m1", "m2", "m3"]);
    const b = await hashMatchIds(["m3", "m1", "m2"]);
    expect(a).toBe(b);
  });

  it("different input → different hash", async () => {
    const a = await hashMatchIds(["m1", "m2", "m3"]);
    const b = await hashMatchIds(["m1", "m2", "m4"]);
    expect(a).not.toBe(b);
  });

  it("empty input → fixed empty-set sentinel hash (deterministic)", async () => {
    const a = await hashMatchIds([]);
    const b = await hashMatchIds([]);
    expect(a).toBe(b);
    expect(typeof a).toBe("string");
  });

  it("subset is NOT confused with full set (commas matter, not just join)", async () => {
    // Joining "m1,m2" is NOT equivalent to "m12" — guard against an
    // accidental no-delimiter join.
    const a = await hashMatchIds(["m1", "m2"]);
    const b = await hashMatchIds(["m12"]);
    expect(a).not.toBe(b);
  });
});

// ─── runReportCreate — happy path ────────────────────────────────────────

describe("WP14 — runReportCreate: happy path", () => {
  it("3 matches with runs rows → reads all 3, aggregates, inserts 1 reports row, returns id + payload + empty missing list", async () => {
    const matchIds = ["m1", "m2", "m3"];
    const { deps, state } = makeDeps({
      runRows: {
        m1: buildRunRow({ matchId: "m1", kills: 2, extractions: 1 }),
        m2: buildRunRow({ matchId: "m2", kills: 1 }),
        m3: buildRunRow({ matchId: "m3", equips: 3, speechEvents: 5 }),
      },
    });

    const result = await runReportCreate(deps, {
      matchIds,
      reportType: "stage-3-3run-test",
    });

    // 1. New id returned, single reports row created.
    expect(result._id).toBeDefined();
    expect(state.reports).toHaveLength(1);
    expect(state.reports[0]?._id).toBe(result._id);

    // 2. All 3 matches were read.
    expect(state.runReadCalls.sort()).toEqual(["m1", "m2", "m3"]);

    // 3. Idempotency check fired before insert (1 query).
    expect(state.indexQueryCalls).toHaveLength(1);

    // 4. Payload aggregates the 3 run rows.
    expect(result.payload.runCount).toBe(3);
    expect(result.payload.kills).toBe(3); // 2+1+0
    expect(result.payload.extractions).toBe(1);
    expect(result.payload.equips).toBe(3);
    expect(result.payload.speechEvents).toBe(5);

    // 5. No missing runs.
    expect(result.missingRunsForMatchIds).toEqual([]);

    // 6. Persisted row carries matchIds, hash, reportType, payload.
    const persisted = state.reports[0]!;
    expect(persisted.matchIds.sort()).toEqual(["m1", "m2", "m3"]);
    expect(persisted.matchIdsHash).toBe(
      await hashMatchIds(matchIds),
    );
    expect(persisted.reportType).toBe("stage-3-3run-test");
    expect(persisted.payload.runCount).toBe(3);
    expect(persisted.missingRunsForMatchIds).toEqual([]);
    expect(persisted.generatedAt).toBe(1_700_000_000_000);
  });

  it("happy path payload threshold flags reflect the §10 done-bar inputs", async () => {
    // 10 runs all with kill=1, equip=1, speech=1, half extracted via rat
    // → killRate=1.0, equipRate=1.0, speechRate=1.0, extractionRate=0.5.
    // perPersona spread = 50pp (rat 50% / others 0%) ≥ 15.
    // → meetsAllThresholds = true.
    const matchIds: string[] = [];
    const runRows: Record<
      string,
      { _id: string; matchId: string } & RunSummary
    > = {};
    for (let i = 0; i < 10; i++) {
      const id = `m${i}`;
      matchIds.push(id);
      const extracted = i < 5 ? 1 : 0;
      runRows[id] = {
        ...buildRunRow({
          matchId: id,
          kills: 1,
          equips: 1,
          extractions: extracted,
          speechEvents: 1,
        }),
        perPersona: PERSONA_IDS.map((pid) => ({
          personaId: pid,
          survivedTurns: 50,
          kills: pid === "rat" ? 1 : 0,
          extracted: pid === "rat" ? extracted : 0,
          equips: pid === "rat" ? 1 : 0,
          speechEvents: pid === "rat" ? 1 : 0,
        })),
      };
    }
    const { deps } = makeDeps({ runRows });
    const result = await runReportCreate(deps, {
      matchIds,
      reportType: "stage-3-10run-thresholds",
    });
    expect(result.payload.meetsExtractionThreshold).toBe(true);
    expect(result.payload.meetsKillThreshold).toBe(true);
    expect(result.payload.meetsEquipThreshold).toBe(true);
    expect(result.payload.meetsSpeechThreshold).toBe(true);
    expect(result.payload.meetsPersonaSpreadThreshold).toBe(true);
    expect(result.payload.meetsAllThresholds).toBe(true);
  });
});

// ─── runReportCreate — idempotency ────────────────────────────────────────

describe("WP14 — runReportCreate: idempotency on (matchIdsHash, reportType)", () => {
  it("two calls with the same matchIds + reportType → same _id, single reports row", async () => {
    const matchIds = ["m1", "m2", "m3"];
    const { deps, state } = makeDeps({
      runRows: {
        m1: buildRunRow({ matchId: "m1", kills: 1 }),
        m2: buildRunRow({ matchId: "m2", kills: 1 }),
        m3: buildRunRow({ matchId: "m3", kills: 1 }),
      },
    });

    const a = await runReportCreate(deps, {
      matchIds,
      reportType: "stage-3-50run",
    });
    const b = await runReportCreate(deps, {
      matchIds,
      reportType: "stage-3-50run",
    });

    expect(a._id).toBe(b._id);
    expect(state.reports).toHaveLength(1); // no second row inserted
  });

  it("reordered matchIds → same _id (sort-then-hash semantic ensures order-independent idempotency)", async () => {
    const { deps, state } = makeDeps({
      runRows: {
        m1: buildRunRow({ matchId: "m1", kills: 1 }),
        m2: buildRunRow({ matchId: "m2", kills: 1 }),
        m3: buildRunRow({ matchId: "m3", kills: 1 }),
      },
    });

    const a = await runReportCreate(deps, {
      matchIds: ["m1", "m2", "m3"],
      reportType: "stage-3-50run",
    });
    const b = await runReportCreate(deps, {
      matchIds: ["m3", "m1", "m2"], // same set, different order
      reportType: "stage-3-50run",
    });

    expect(a._id).toBe(b._id);
    expect(state.reports).toHaveLength(1);
  });

  it("same matchIds + DIFFERENT reportType → DIFFERENT _id, both rows persisted", async () => {
    const matchIds = ["m1", "m2"];
    const { deps, state } = makeDeps({
      runRows: {
        m1: buildRunRow({ matchId: "m1", kills: 1 }),
        m2: buildRunRow({ matchId: "m2", kills: 1 }),
      },
    });

    const a = await runReportCreate(deps, {
      matchIds,
      reportType: "stage-3-50run",
    });
    const b = await runReportCreate(deps, {
      matchIds,
      reportType: "stage-2-10run",
    });

    expect(a._id).not.toBe(b._id);
    expect(state.reports).toHaveLength(2);
  });

  it("idempotent re-fire returns the original payload as-stored (NOT recomputed from possibly-changed run rows)", async () => {
    // First call captures payload at runCount=2. If the run rows shift
    // between calls, the second call must STILL return the originally-
    // stored payload (idempotency contract: same key → same row,
    // unchanged).
    const { deps } = makeDeps({
      runRows: {
        m1: buildRunRow({ matchId: "m1", kills: 1 }),
        m2: buildRunRow({ matchId: "m2", kills: 1 }),
      },
    });

    const a = await runReportCreate(deps, {
      matchIds: ["m1", "m2"],
      reportType: "stage-3-50run",
    });
    expect(a.payload.runCount).toBe(2);
    expect(a.payload.kills).toBe(2);

    // Re-fire — even if the world has "moved on", the same key gives back
    // the same row (we don't bother mutating runRows; the re-fire short-
    // circuits before reading runs anyway, by design).
    const b = await runReportCreate(deps, {
      matchIds: ["m1", "m2"],
      reportType: "stage-3-50run",
    });
    expect(b._id).toBe(a._id);
    expect(b.payload).toEqual(a.payload);
  });
});

// ─── runReportCreate — missing-runs tolerance ────────────────────────────

describe("WP14 — runReportCreate: missing-runs-row tolerance", () => {
  it("2 of 3 matchIds have runs rows, 1 missing → aggregator runs over 2, missingRunsForMatchIds lists the missing one", async () => {
    const { deps } = makeDeps({
      runRows: {
        m1: buildRunRow({ matchId: "m1", kills: 1 }),
        m2: null, // no runs row materialised (failed match per WP12 contract)
        m3: buildRunRow({ matchId: "m3", kills: 1 }),
      },
    });

    const result = await runReportCreate(deps, {
      matchIds: ["m1", "m2", "m3"],
      reportType: "stage-3-3run-with-failure",
    });

    expect(result.payload.runCount).toBe(2); // only 2 rows aggregated
    expect(result.payload.kills).toBe(2);
    expect(result.missingRunsForMatchIds).toEqual(["m2"]);
  });

  it("all 3 matchIds missing → runCount=0, all meets* false, missingRunsForMatchIds lists all 3", async () => {
    const { deps } = makeDeps({
      runRows: { m1: null, m2: null, m3: null },
    });

    const result = await runReportCreate(deps, {
      matchIds: ["m1", "m2", "m3"],
      reportType: "stage-3-3run-all-failed",
    });

    expect(result.payload.runCount).toBe(0);
    expect(result.payload.meetsAllThresholds).toBe(false);
    expect(result.missingRunsForMatchIds.sort()).toEqual([
      "m1",
      "m2",
      "m3",
    ]);
  });

  it("missingRunsForMatchIds preserves caller-supplied order (same as matchIds input order)", async () => {
    const { deps } = makeDeps({
      runRows: {
        m1: null,
        m2: buildRunRow({ matchId: "m2", kills: 1 }),
        m3: null,
        m4: null,
        m5: buildRunRow({ matchId: "m5", kills: 1 }),
      },
    });

    const result = await runReportCreate(deps, {
      matchIds: ["m1", "m2", "m3", "m4", "m5"],
      reportType: "stage-3-mixed",
    });

    // Missing list reflects input order, NOT sort order.
    expect(result.missingRunsForMatchIds).toEqual(["m1", "m3", "m4"]);
  });
});

// ─── runReportCreate — empty input edge ──────────────────────────────────

describe("WP14 — runReportCreate: empty matchIds set", () => {
  it("empty matchIds → runCount=0, empty missing, single reports row inserted (still idempotent on the empty hash)", async () => {
    const { deps, state } = makeDeps({ runRows: {} });

    const a = await runReportCreate(deps, {
      matchIds: [],
      reportType: "empty",
    });
    const b = await runReportCreate(deps, {
      matchIds: [],
      reportType: "empty",
    });

    expect(a._id).toBe(b._id);
    expect(state.reports).toHaveLength(1);
    expect(a.payload.runCount).toBe(0);
    expect(a.missingRunsForMatchIds).toEqual([]);
  });
});
