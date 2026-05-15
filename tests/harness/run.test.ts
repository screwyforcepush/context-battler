// Surgical correctness fix #3 — harness reliability.
//
// Tests written FIRST per AOP. Three scenarios pinning the contract:
//
//   1. Missing-runs-row scenario — a completed match never gets a `runs` row
//      written within the poll window. The harness MUST:
//        - exit nonzero
//        - emit a JSONL `harness_error` event on stdout (queryable downstream)
//        - keep emitting the per-match `fatal` stderr line (existing behaviour
//          preserved for human debugging)
//
//   2. Failed-match scenario — a match ends in `failed`. Today the harness
//      exits 0 even when this happens (the post-WP10.5 intent is "any failure
//      => exit 1"). The harness MUST exit nonzero.
//
//   3. Happy-path scenario — every match completes and aggregates cleanly.
//      Exit code 0 and NO `harness_error` event emitted.
//
// Why a programmatic-import-with-DI approach instead of spawning a child
// process: vitest workers are isolated per test file, and we can capture
// stdout/stderr by overriding the `emit*` hook injected through deps. This
// keeps the test fast, avoids the tsx subprocess startup cost, and lets us
// inspect the structured event stream directly. The exit-code semantics are
// captured via `runHarness` returning `{ exitCode }` (the entry-point
// `main()` is the only thing that touches `process.exitCode` in real use;
// `runHarness` is the pure coordinator).

import { describe, expect, it } from "vitest";
import { getFunctionName } from "convex/server";
import {
  runHarness,
  type HarnessClient,
  type HarnessDeps,
  type HarnessEvent,
} from "../../harness/run.js";

// ─── Test helpers ──────────────────────────────────────────────────────────

type EmittedFatal = {
  event: "fatal";
  reason: string;
  matchId?: string;
  note?: string;
  message?: string;
};

type Captured = {
  stdoutEvents: HarnessEvent[];
  stderrLines: EmittedFatal[];
};

function makeCapture(): { captured: Captured; deps: Partial<HarnessDeps> } {
  const captured: Captured = { stdoutEvents: [], stderrLines: [] };
  return {
    captured,
    deps: {
      emitEvent: (ev) => {
        captured.stdoutEvents.push(ev);
      },
      writeStderr: (line) => {
        captured.stderrLines.push(JSON.parse(line) as EmittedFatal);
      },
      // Tests must not actually sleep — collapse all sleeps to 0ms so the
      // `waitForRunRow` poll loop and the `pollUntilTerminal` loop drain
      // immediately. The fake client controls the response sequence.
      sleep: async () => {},
      // Shrink the runs-row poll budget so the "row never materialises"
      // branch resolves in milliseconds (production keeps WP12 defaults
      // of 30 s timeout / 1 s cadence). With 0-ms sleeps and a 50-ms
      // wall-clock cap, the loop fires a handful of times then bails.
      runRowPoll: { intervalMs: 1, timeoutMs: 50 },
    },
  };
}

/**
 * A fake client that implements the `HarnessClient` interface. Each call to
 * `mutation("matches:start", ...)` allocates a fresh matchId (`match_<n>`)
 * so tests can correlate per-match status / runs responses with deterministic
 * ids. Status / runs responses are pulled from per-matchId queues.
 */
function refName(ref: unknown): string {
  // FunctionReference from `makeFunctionReference` stores the name on a
  // hidden symbol; `getFunctionName` is the documented accessor. String
  // refs (used in some legacy paths) are returned as-is.
  if (typeof ref === "string") return ref;
  try {
    return getFunctionName(ref as never);
  } catch {
    return "";
  }
}

/**
 * Captured `reports:create` mutation call shape — exposed so tests can pin
 * exactly what the harness sent (matchIds + reportType + return shape).
 * `reportsCreate` (below) defaults to a synthetic happy-path response if
 * no override is supplied, mirroring the real mutation's
 * `{ _id, payload, missingRunsForMatchIds }` return type from
 * `convex/reports.ts:runReportCreate`.
 */
type ReportsCreateCall = {
  matchIds: string[];
  reportType: string;
};

type MatchesStartCall = {
  rngSeed?: string;
  reasoningEffort?: string;
};

function makeFakeClient(args: {
  status?: Record<string, ReadonlyArray<unknown>>;
  runs?: Record<string, ReadonlyArray<unknown>>;
  /**
   * Optional override for `reports:create` mutation behaviour. When omitted
   * the fake returns a happy-path-shaped response (id, empty payload-shape
   * sentinel, no missing matches). Tests that need to assert the harness
   * captured the response correctly can supply a custom one.
   */
  reportsCreate?: (call: ReportsCreateCall) => unknown;
  /** Captured reports:create call list — useful for assertions. */
  reportsCreateCalls?: ReportsCreateCall[];
  /** Captured matches:start call list — useful for seed plumbing assertions. */
  matchesStartCalls?: MatchesStartCall[];
}): HarnessClient {
  const startedMatchIds: string[] = [];
  const statusCursors = new Map<string, number>();
  const runsCursors = new Map<string, number>();
  const reportsCreateCalls = args.reportsCreateCalls ?? [];
  const matchesStartCalls = args.matchesStartCalls ?? [];
  // Implementation type — looser than the public `HarnessClient` interface
  // so the test fake can dispatch on a single function regardless of which
  // overload the harness body picks at the call site. Cast to
  // `HarnessClient` at the return statement.
  type AnyClient = {
    mutation: (ref: unknown, args?: unknown) => Promise<unknown>;
    query: (ref: unknown, args?: unknown) => Promise<unknown>;
  };
  const impl: AnyClient = {
    mutation: async (ref, mutationArgs) => {
      const name = refName(ref);
      if (name === "matches:start") {
        matchesStartCalls.push(mutationArgs as MatchesStartCall);
        const id = `match_${startedMatchIds.length + 1}`;
        startedMatchIds.push(id);
        return id;
      }
      if (name === "reports:create") {
        const call = mutationArgs as ReportsCreateCall;
        reportsCreateCalls.push(call);
        if (args.reportsCreate) return args.reportsCreate(call);
        // Default happy-path response shape — matches `runReportCreate`'s
        // return type from convex/reports.ts (the harness only reads `_id`
        // and `payload.meetsAllThresholds` for telemetry).
        return {
          _id: `report_${reportsCreateCalls.length}`,
          payload: {
            runCount: call.matchIds.length,
            meetsAllThresholds: false,
          },
          missingRunsForMatchIds: [] as string[],
        };
      }
      throw new Error(`unexpected mutation ref: ${name}`);
    },
    query: async (ref, params) => {
      const name = refName(ref);
      const p = params as
        | { matchId?: string; id?: string }
        | undefined;
      const matchId = p?.matchId ?? p?.id;
      if (matchId === undefined) return null;
      if (name === "matches:status") {
        const queue = args.status?.[matchId] ?? [];
        const i = statusCursors.get(matchId) ?? 0;
        statusCursors.set(
          matchId,
          Math.min(i + 1, Math.max(0, queue.length - 1)),
        );
        return queue[Math.min(i, queue.length - 1)] ?? null;
      }
      if (name === "runs:byMatch") {
        const queue = args.runs?.[matchId] ?? [];
        const i = runsCursors.get(matchId) ?? 0;
        runsCursors.set(
          matchId,
          Math.min(i + 1, Math.max(0, queue.length - 1)),
        );
        return queue[Math.min(i, queue.length - 1)] ?? null;
      }
      return null;
    },
  };
  return impl as unknown as HarnessClient;
}

const COMPLETED_STATUS = (turn = 50) => ({
  status: "completed" as const,
  turn,
  completedAt: 1000,
});

const FAILED_STATUS = (turn = 7) => ({
  status: "failed" as const,
  turn,
  completedAt: 1000,
  failure: { turn, reason: "synthetic_failure" },
});

const RUN_ROW = (matchId: string) => ({
  _id: `runs_${matchId}`,
  matchId,
  kills: 0,
  extractions: 0,
  equips: 0,
  speechEvents: 0,
  perPersona: [],
});

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("harness reliability — fix #3 (missing runs row + failed-match exit code)", () => {
  it("missing-runs-row: completed match without aggregate row → exit 1, harness_error event on stdout, fatal stderr preserved", async () => {
    const { captured, deps } = makeCapture();
    const client = makeFakeClient({
      status: { match_1: [COMPLETED_STATUS()] },
      // No runs row materialises within the poll window.
      runs: { match_1: [null] },
    });

    const result = await runHarness(
      { runs: 1, concurrency: 1, reasoning: "low" },
      { ...deps, client } as HarnessDeps,
    );

    // 1. Exit code is nonzero.
    expect(result.exitCode).toBe(1);

    // 2. JSONL `harness_error` event on stdout.
    const harnessError = captured.stdoutEvents.find(
      (e) => e.event === "harness_error",
    );
    expect(harnessError).toBeDefined();
    expect(harnessError).toMatchObject({
      event: "harness_error",
      reason: "runs_row_missing",
      count: 1,
      matchIds: ["match_1"],
    });

    // 3. Per-match `fatal` stderr emission still happened (preserve existing behaviour).
    const stderrFatal = captured.stderrLines.find(
      (l) => l.event === "fatal" && l.reason === "run_row_missing",
    );
    expect(stderrFatal).toBeDefined();
    expect(stderrFatal?.matchId).toBe("match_1");
  });

  it("failed-match: a match ends with status=failed → exit 1 (today exits 0)", async () => {
    const { captured, deps } = makeCapture();
    const client = makeFakeClient({
      status: { match_1: [FAILED_STATUS()] },
      runs: { match_1: [] }, // failed matches don't get a runs row by contract
    });

    const result = await runHarness(
      { runs: 1, concurrency: 1, reasoning: "low" },
      { ...deps, client } as HarnessDeps,
    );

    expect(result.exitCode).toBe(1);

    // No `harness_error` event for this scenario — failed matches are an
    // expected (if undesirable) outcome and the exit code carries the signal.
    // The summary event still fires with failed=1.
    const summary = captured.stdoutEvents.find((e) => e.event === "summary");
    expect(summary).toMatchObject({ completed: 0, failed: 1, total: 1 });
  });

  it("happy path: all matches complete and aggregate cleanly → exit 0, no harness_error event", async () => {
    const { captured, deps } = makeCapture();
    const client = makeFakeClient({
      status: {
        match_1: [COMPLETED_STATUS()],
        match_2: [COMPLETED_STATUS()],
      },
      runs: {
        match_1: [RUN_ROW("match_1")],
        match_2: [RUN_ROW("match_2")],
      },
    });

    const result = await runHarness(
      { runs: 2, concurrency: 2, reasoning: "low" },
      { ...deps, client } as HarnessDeps,
    );

    expect(result.exitCode).toBe(0);

    const harnessError = captured.stdoutEvents.find(
      (e) => e.event === "harness_error",
    );
    expect(harnessError).toBeUndefined();

    // Multi-run summary aggregates across both matches.
    const multiRun = captured.stdoutEvents.find(
      (e) => e.event === "multi_run_summary",
    );
    expect(multiRun).toMatchObject({
      runs: 2,
      matchIds: ["match_1", "match_2"],
    });
  });

  it("mixed: 1 completed-with-row + 1 completed-without-row → exit 1, harness_error event lists only the missing match", async () => {
    const { captured, deps } = makeCapture();
    const client = makeFakeClient({
      status: {
        match_1: [COMPLETED_STATUS()],
        match_2: [COMPLETED_STATUS()],
      },
      runs: {
        match_1: [RUN_ROW("match_1")],
        match_2: [null], // missing
      },
    });

    const result = await runHarness(
      { runs: 2, concurrency: 1, reasoning: "low" },
      { ...deps, client } as HarnessDeps,
    );

    expect(result.exitCode).toBe(1);

    const harnessError = captured.stdoutEvents.find(
      (e) => e.event === "harness_error",
    );
    expect(harnessError).toMatchObject({
      event: "harness_error",
      reason: "runs_row_missing",
      count: 1,
      matchIds: ["match_2"],
    });
  });
});

// ─── Stage-3 wiring — reports.create persistence (D45) ─────────────────────
//
// Per `docs/project/phases/01-engine-and-harness/gate-2-5-review.md` and
// the WP14 brief, the harness must persist the closing report payload via
// `convex/reports.ts:create` after the multi-run summary is computed, so
// the Cucumber Scenario 3 threshold checks read off a Convex row rather
// than re-aggregating client-side. Three scenarios pin the contract:
//
//   1. Happy-path — N completed matches with `runs` rows → harness fires
//      ONE `reports:create` mutation with the completed matchIds + the
//      `closing-${runs}` reportType, and emits a `report_created` JSONL
//      event carrying the returned `_id` so a reviewing agent can grep
//      the log and run `npx convex run reports:byId --id=<id>`.
//
//   2. No-completed-matches — every match failed, runs aggregate skipped,
//      multi_run_summary has runCount=0. The harness MUST NOT fire
//      `reports:create` (the empty-set hash is reserved for explicit
//      callers; a 50-failed-run dispatch is a diagnostic event, not a
//      report). No `report_created` event emitted.
//
//   3. reportType literal — the reportType string is `closing-${args.runs}`,
//      so a 10-run probe gets `closing-10` and a 50-run dispatch gets
//      `closing-50`. This makes the (matchIdsHash, reportType) idempotency
//      tuple distinguish probes from closing dispatches even when they
//      happen to share matchIds.

describe("harness Stage-3 wiring — reports.create persistence (D45)", () => {
  it("happy path: N completed matches with runs rows → 1 reports:create call + report_created JSONL event", async () => {
    const reportsCreateCalls: ReportsCreateCall[] = [];
    const { captured, deps } = makeCapture();
    const client = makeFakeClient({
      status: {
        match_1: [COMPLETED_STATUS()],
        match_2: [COMPLETED_STATUS()],
        match_3: [COMPLETED_STATUS()],
      },
      runs: {
        match_1: [RUN_ROW("match_1")],
        match_2: [RUN_ROW("match_2")],
        match_3: [RUN_ROW("match_3")],
      },
      reportsCreateCalls,
      reportsCreate: (_call) => ({
        _id: "report_synthetic_1",
        payload: {
          runCount: 3,
          meetsAllThresholds: false,
          meetsExtractionThreshold: false,
          meetsKillThreshold: false,
          meetsEquipThreshold: false,
          meetsSpeechThreshold: false,
          meetsPersonaSpreadThreshold: false,
        },
        missingRunsForMatchIds: [] as string[],
      }),
    });

    const result = await runHarness(
      { runs: 3, concurrency: 3, reasoning: "low" },
      { ...deps, client } as HarnessDeps,
    );

    expect(result.exitCode).toBe(0);

    // 1. Exactly ONE reports:create call.
    expect(reportsCreateCalls).toHaveLength(1);
    expect(reportsCreateCalls[0]).toMatchObject({
      matchIds: ["match_1", "match_2", "match_3"],
      reportType: "closing-3",
    });

    // 2. report_created JSONL event emitted with the returned id +
    //    threshold flags so a reviewing agent can grep.
    const reportCreated = captured.stdoutEvents.find(
      (e) => e.event === "report_created",
    );
    expect(reportCreated).toBeDefined();
    expect(reportCreated).toMatchObject({
      event: "report_created",
      reportId: "report_synthetic_1",
      reportType: "closing-3",
      runCount: 3,
      meetsAllThresholds: false,
    });
  });

  it("no completed matches → NO reports:create call, NO report_created event", async () => {
    const reportsCreateCalls: ReportsCreateCall[] = [];
    const { captured, deps } = makeCapture();
    const client = makeFakeClient({
      status: { match_1: [FAILED_STATUS()] },
      runs: { match_1: [] },
      reportsCreateCalls,
    });

    const result = await runHarness(
      { runs: 1, concurrency: 1, reasoning: "low" },
      { ...deps, client } as HarnessDeps,
    );

    expect(result.exitCode).toBe(1); // failed match → exit 1
    expect(reportsCreateCalls).toHaveLength(0);
    const reportCreated = captured.stdoutEvents.find(
      (e) => e.event === "report_created",
    );
    expect(reportCreated).toBeUndefined();
  });

  it("reportType literal is `closing-${runs}` (matches Stage-3 dispatch convention)", async () => {
    const reportsCreateCalls: ReportsCreateCall[] = [];
    const { deps } = makeCapture();
    const client = makeFakeClient({
      status: {
        match_1: [COMPLETED_STATUS()],
        match_2: [COMPLETED_STATUS()],
      },
      runs: {
        match_1: [RUN_ROW("match_1")],
        match_2: [RUN_ROW("match_2")],
      },
      reportsCreateCalls,
    });

    await runHarness(
      { runs: 2, concurrency: 1, reasoning: "low" },
      { ...deps, client } as HarnessDeps,
    );

    expect(reportsCreateCalls[0]?.reportType).toBe("closing-2");
  });

  it("seed-prefix: forwards deterministic per-run rngSeed values to matches:start", async () => {
    const matchesStartCalls: MatchesStartCall[] = [];
    const { deps } = makeCapture();
    const client = makeFakeClient({
      status: {
        match_1: [COMPLETED_STATUS()],
        match_2: [COMPLETED_STATUS()],
        match_3: [COMPLETED_STATUS()],
      },
      runs: {
        match_1: [RUN_ROW("match_1")],
        match_2: [RUN_ROW("match_2")],
        match_3: [RUN_ROW("match_3")],
      },
      matchesStartCalls,
    });

    await runHarness(
      {
        runs: 3,
        concurrency: 2,
        reasoning: "low",
        seedPrefix: "phase4-d1",
      },
      { ...deps, client } as HarnessDeps,
    );

    expect(matchesStartCalls).toEqual([
      { reasoningEffort: "low", rngSeed: "phase4-d1-01" },
      { reasoningEffort: "low", rngSeed: "phase4-d1-02" },
      { reasoningEffort: "low", rngSeed: "phase4-d1-03" },
    ]);
  });

  it("missing-runs-row partial: 2 completed-with-row + 1 completed-without-row → reports:create called with 2 matchIds (the present-rows set)", async () => {
    // Per WP14 contract: `reports.create` tolerates missing `runs` rows
    // and lists them in `missingRunsForMatchIds`. The harness should pass
    // ALL completed matchIds (let the mutation decide what's missing) so
    // the report row's `missingRunsForMatchIds` field is populated with
    // the right diagnostic info.
    const reportsCreateCalls: ReportsCreateCall[] = [];
    const { deps } = makeCapture();
    const client = makeFakeClient({
      status: {
        match_1: [COMPLETED_STATUS()],
        match_2: [COMPLETED_STATUS()],
        match_3: [COMPLETED_STATUS()],
      },
      runs: {
        match_1: [RUN_ROW("match_1")],
        match_2: [null], // missing
        match_3: [RUN_ROW("match_3")],
      },
      reportsCreateCalls,
    });

    const result = await runHarness(
      { runs: 3, concurrency: 1, reasoning: "low" },
      { ...deps, client } as HarnessDeps,
    );

    expect(result.exitCode).toBe(1); // missing row → exit 1
    // The harness should have STILL fired reports:create with all 3
    // completed matchIds — the mutation will mark match_2 as missing.
    expect(reportsCreateCalls).toHaveLength(1);
    expect(reportsCreateCalls[0]?.matchIds.sort()).toEqual([
      "match_1",
      "match_2",
      "match_3",
    ]);
  });
});
