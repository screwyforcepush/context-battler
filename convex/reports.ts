// WP14 — `reports` row writer + reader.
//
// Default Convex runtime (no `"use node"` — pure DB reads/writes; the
// aggregation logic lives in the engine layer at
// `convex/engine/reportStats.ts` and is unit-tested directly).
//
// Public surface:
//
//   - `reports.create({ matchIds, reportType })` — mutation: reads the
//     `runs` row for each matchId (via `runs.by_match`), calls the pure
//     aggregator on the collected rows, and writes a single `reports`
//     row. Idempotent on the `(matchIdsHash, reportType)` tuple — re-fires
//     with the same set + reportType return the existing row's `_id`
//     and DO NOT insert a duplicate. matchIds order does not matter
//     (sort-then-hash semantic). Returns `{ _id, payload, missingRunsForMatchIds }`.
//
//   - `reports.byId({ id })` — query: returns the row for an id (or null).
//
// Boundary contract (ADR §1):
//   - DB I/O lives here; aggregation logic lives in `engine/reportStats.ts`.
//   - The mutation orchestration is extracted into `runReportCreate`
//     (a pure function over a `ReportCreateDeps` interface) so the
//     orchestration can be unit-tested without Convex runtime, mirroring
//     the harness/run.ts DI pattern (tests/harness/run.test.ts) and the
//     runMatch.ts pure-helper pattern (tests/runMatch.test.ts).
//
// Idempotency hash:
//   - SHA-256 hex over the SORTED, comma-joined matchIds.
//   - Sort happens BEFORE join so two callers passing the same set in
//     different orders hit the same row.
//   - WebCrypto (`crypto.subtle.digest`) is available in both Convex
//     default-runtime workers and the Vitest test environment (Node ≥18
//     exposes `globalThis.crypto`); no fallback needed.
//   - Empty matchIds → hash of "" (a fixed empty-set sentinel; same set
//     always lands on the same row).
//
// Cross-references:
//   - ADR §6 — locks the `reports` table shape.
//   - work-packages.md WP14 — boundary contract + acceptance.
//   - convex/engine/reportStats.ts — pure aggregator with unit tests.
//   - convex/runs.ts — the WP12 wrapper this mirrors (same shape).

import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import {
  aggregateReportStats,
  type ReportPayload,
  type ReportRunInput,
} from "./engine/reportStats.js";
import type { PersonaId } from "./engine/types.js";

// ─── Idempotency hash ─────────────────────────────────────────────────────

/**
 * Compute the deterministic, ORDER-INDEPENDENT hash for a set of matchIds.
 *
 * Algorithm:
 *   1. Sort the matchIds (lexicographic; matchIds are strings at runtime).
 *   2. Join with comma — non-empty delimiter prevents the false-collision
 *      `["m1","m2"]` ↔ `["m12"]`.
 *   3. SHA-256 → hex.
 *
 * Empty input → SHA-256 of "" (a deterministic empty-set sentinel; two
 * empty calls always hit the same row). Hex output is fine here — the
 * field doesn't need cryptographic guarantees, just collision-resistance
 * over O(50) ids per the WP14 brief.
 */
export async function hashMatchIds(matchIds: string[]): Promise<string> {
  const sorted = [...matchIds].sort();
  const text = sorted.join(",");
  const buf = new TextEncoder().encode(text);
  const hashBuf = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── Pure orchestration (DI-able for tests) ──────────────────────────────

/**
 * One persisted `reports` row, narrowed to the fields `runReportCreate`
 * reads/writes. Mirrors the schema's `reports` table shape (the v2/WP14
 * additive fields specifically — `runReportCreate` only touches those).
 */
export type ReportCreateRow = {
  _id: string;
  matchIds: string[];
  matchIdsHash: string;
  reportType: string;
  payload: ReportPayload;
  missingRunsForMatchIds: string[];
  generatedAt: number;
};

/**
 * One `runs` row, narrowed to the fields `runReportCreate` consumes.
 * Mirrors the runs row shape from `convex/runs.ts:byMatch`.
 */
export type ReportCreateRunRow = {
  _id: string;
  matchId: string;
  kills: number;
  extractions: number;
  equips: number;
  speechEvents: number;
  perPersona: Array<{
    personaId: PersonaId;
    survivedTurns: number;
    kills: number;
    extracted: number;
    equips: number;
    speechEvents: number;
  }>;
};

/**
 * Dependency interface for `runReportCreate`. The Convex mutation wires
 * `ctx.db.query(...)` and `ctx.db.insert(...)` into these calls; the
 * Vitest tests use an in-memory fake.
 */
export type ReportCreateDeps = {
  /** Read the runs row for a matchId, or null if no row was written. */
  readRunByMatchId: (
    matchId: string,
  ) => Promise<ReportCreateRunRow | null>;
  /** Read the existing reports row by (matchIdsHash, reportType), or null. */
  findReportByHashAndType: (
    matchIdsHash: string,
    reportType: string,
  ) => Promise<ReportCreateRow | null>;
  /** Insert a fresh reports row; returns the new id. */
  insertReport: (row: Omit<ReportCreateRow, "_id">) => Promise<string>;
  /** Source of the `generatedAt` timestamp (DI-able for deterministic tests). */
  now: () => number;
};

/**
 * The shared orchestration body for `reports.create`. Exposed so it can
 * be unit-tested via an in-memory `ReportCreateDeps` fake without Convex.
 *
 * Behaviour (matches WP14 acceptance):
 *   1. Hash matchIds (sort-then-hash).
 *   2. Idempotency check: query the existing report by
 *      (matchIdsHash, reportType). If present → return it without
 *      reading runs or inserting.
 *   3. Read the runs row for each matchId. Track ids whose row was
 *      missing (returned `null`) — Stage-3 needs this signal.
 *   4. Call the pure aggregator over the present rows.
 *   5. Insert the new reports row with the persisted payload.
 *   6. Return `{ _id, payload, missingRunsForMatchIds }`.
 */
export async function runReportCreate(
  deps: ReportCreateDeps,
  args: { matchIds: string[]; reportType: string },
): Promise<{
  _id: string;
  payload: ReportPayload;
  missingRunsForMatchIds: string[];
}> {
  const matchIdsHash = await hashMatchIds(args.matchIds);

  // Idempotency: bail early if the row already exists for this
  // (matchIdsHash, reportType) tuple. We return the existing row's
  // payload as-stored (NOT recomputed from possibly-changed run rows) —
  // re-fires of `reports.create` are no-op inserts per the WP14 brief
  // ("re-run of reports.create over the same set must be a no-op insert").
  const existing = await deps.findReportByHashAndType(
    matchIdsHash,
    args.reportType,
  );
  if (existing) {
    return {
      _id: existing._id,
      payload: existing.payload,
      missingRunsForMatchIds: existing.missingRunsForMatchIds,
    };
  }

  // Read runs in caller-supplied order so `missingRunsForMatchIds`
  // preserves that order — Stage-3 / harness consumers can correlate
  // missing entries with their dispatch order trivially.
  const runRows: ReportCreateRunRow[] = [];
  const missingRunsForMatchIds: string[] = [];
  for (const matchId of args.matchIds) {
    const row = await deps.readRunByMatchId(matchId);
    if (row === null) {
      missingRunsForMatchIds.push(matchId);
    } else {
      runRows.push(row);
    }
  }

  // Aggregate. The aggregator only consumes `RunSummary` (kills, extractions,
  // equips, speechEvents, perPersona) — _id and matchId are dropped here.
  const aggregatorInput: ReportRunInput[] = runRows.map((r) => ({
    kills: r.kills,
    extractions: r.extractions,
    equips: r.equips,
    speechEvents: r.speechEvents,
    perPersona: r.perPersona,
  }));
  const payload = aggregateReportStats(aggregatorInput);

  // Insert the new row. matchIds preserves the caller's input order
  // (the SORT only feeds the hash, not the persisted array).
  const _id = await deps.insertReport({
    matchIds: args.matchIds,
    matchIdsHash,
    reportType: args.reportType,
    payload,
    missingRunsForMatchIds,
    generatedAt: deps.now(),
  });

  return {
    _id,
    payload,
    missingRunsForMatchIds,
  };
}

// ─── Convex mutation + query (thin DB wrappers) ───────────────────────────

/**
 * `reports.create({ matchIds, reportType })` — public mutation: read N
 * `runs` rows, aggregate, write a single `reports` row. Idempotent on
 * (matchIdsHash, reportType) — re-fires return the existing row.
 *
 * Returns:
 *   - `_id` of the (new or existing) `reports` row
 *   - `payload` — the §10 done-bar `ReportPayload`
 *   - `missingRunsForMatchIds` — input matchIds with no `runs` row
 *
 * Stage-3 dispatches this once, after the harness has confirmed every
 * match reached terminal status. The mutation tolerates missing runs
 * rows (failed matches don't get one per WP12 contract); the harness
 * consumes `missingRunsForMatchIds` to surface the gap.
 */
export const create = mutation({
  args: {
    matchIds: v.array(v.id("matches")),
    reportType: v.string(),
  },
  handler: async (ctx, { matchIds, reportType }) => {
    const deps: ReportCreateDeps = {
      readRunByMatchId: async (matchId) => {
        // matchIds at runtime are strings; cast back to Id<"matches"> for
        // the Convex query API.
        const row = await ctx.db
          .query("runs")
          .withIndex("by_match", (q) =>
            q.eq("matchId", matchId as never),
          )
          .unique();
        if (!row) return null;
        return {
          _id: row._id as unknown as string,
          matchId: row.matchId as unknown as string,
          kills: row.kills,
          extractions: row.extractions,
          equips: row.equips,
          speechEvents: row.speechEvents,
          perPersona: row.perPersona.map((pp) => ({
            personaId: pp.personaId as PersonaId,
            survivedTurns: pp.survivedTurns,
            kills: pp.kills,
            extracted: pp.extracted,
            equips: pp.equips,
            speechEvents: pp.speechEvents,
          })),
        };
      },
      findReportByHashAndType: async (matchIdsHash, rt) => {
        const row = await ctx.db
          .query("reports")
          .withIndex("by_matchIdsHash_reportType", (q) =>
            q.eq("matchIdsHash", matchIdsHash).eq("reportType", rt),
          )
          .unique();
        if (!row) return null;
        // The fetched row only carries our additive WP14 fields when this
        // mutation wrote it; if the row is missing them we treat it as
        // not-a-WP14-row and return null so we don't masquerade a v1 row.
        if (
          row.matchIds === undefined ||
          row.matchIdsHash === undefined ||
          row.reportType === undefined ||
          row.payload === undefined ||
          row.missingRunsForMatchIds === undefined
        ) {
          return null;
        }
        return {
          _id: row._id as unknown as string,
          matchIds: row.matchIds.map((m) => m as unknown as string),
          matchIdsHash: row.matchIdsHash,
          reportType: row.reportType,
          payload: row.payload,
          missingRunsForMatchIds: row.missingRunsForMatchIds.map(
            (m) => m as unknown as string,
          ),
          generatedAt: row.generatedAt,
        };
      },
      insertReport: async (row) => {
        const matchIdsTyped = row.matchIds.map(
          (m) => m as never,
        ) as never;
        const missingTyped = row.missingRunsForMatchIds.map(
          (m) => m as never,
        ) as never;
        // The schema's `reports` table preserves the v1 (WP2) fields as
        // required (they are NOT v.optional in the original v1 design).
        // We supply zero-value placeholders for those legacy fields here
        // so historical readers that consume the v1 shape don't break.
        // The v1 metrics derived from the new `payload` 1:1 — pre-WP14
        // semantics: extractionRate is "≥1 per run", same as payload.extractionRate.
        const insertedId = await ctx.db.insert("reports", {
          // v1 / WP2 legacy fields (zero-filled or echoed from payload)
          runIds: [],
          runCount: row.payload.runCount,
          generatedAt: row.generatedAt,
          metrics: {
            extractionRate: row.payload.extractionRate,
            runsWithKill: row.payload.runsWithAtLeastOneKill,
            runsWithEquip: row.payload.runsWithAtLeastOneEquip,
            runsWithSpeech: row.payload.runsWithAtLeastOneSpeech,
            perPersonaExtractionRate: row.payload.perPersona.map(
              (p) => ({
                personaId: p.personaId,
                rate: p.extractionRate,
              }),
            ),
            personaSpread: row.payload.personaExtractionSpread,
          },
          metBar: row.payload.meetsAllThresholds,
          // v2 / WP14 additive fields
          matchIds: matchIdsTyped,
          matchIdsHash: row.matchIdsHash,
          reportType: row.reportType,
          payload: row.payload,
          missingRunsForMatchIds: missingTyped,
        });
        return insertedId as unknown as string;
      },
      now: () => Date.now(),
    };

    // Cast matchIds to plain string[] for the pure orchestrator. Convex
    // Id<"matches"> is a string at runtime — this is safe.
    const matchIdsAsStrings = matchIds.map((m) => m as unknown as string);
    return await runReportCreate(deps, {
      matchIds: matchIdsAsStrings,
      reportType,
    });
  },
});

/**
 * `reports.byId({ id })` — fetch the report row by id, or null. Used by
 * post-run verification to confirm `meetsAllThresholds` on the stage-3
 * report row.
 */
export const byId = query({
  args: { id: v.id("reports") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

/**
 * `reports.byMatchIdsHash({ matchIdsHash, reportType })` — idempotency
 * lookup. Stage-3 verification fetches the persisted closing-report row
 * by recomputing the hash from the dispatched matchIds set + reportType
 * and looking it up here. Returns null if no row exists.
 *
 * The (matchIdsHash, reportType) tuple uniquely identifies a report row
 * via the `by_matchIdsHash_reportType` index — re-running `reports.create`
 * with the same key is a no-op insert.
 */
export const byMatchIdsHash = query({
  args: { matchIdsHash: v.string(), reportType: v.string() },
  handler: async (ctx, { matchIdsHash, reportType }) => {
    return await ctx.db
      .query("reports")
      .withIndex("by_matchIdsHash_reportType", (q) =>
        q.eq("matchIdsHash", matchIdsHash).eq("reportType", reportType),
      )
      .unique();
  },
});
