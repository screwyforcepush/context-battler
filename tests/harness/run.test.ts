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
// `runHarness` is the pure orchestrator).

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

function makeFakeClient(args: {
  status?: Record<string, ReadonlyArray<unknown>>;
  runs?: Record<string, ReadonlyArray<unknown>>;
}): HarnessClient {
  const startedMatchIds: string[] = [];
  const statusCursors = new Map<string, number>();
  const runsCursors = new Map<string, number>();
  // Implementation type — looser than the public `HarnessClient` interface
  // so the test fake can dispatch on a single function regardless of which
  // overload the harness body picks at the call site. Cast to
  // `HarnessClient` at the return statement.
  type AnyClient = {
    mutation: (ref: unknown, args?: unknown) => Promise<unknown>;
    query: (ref: unknown, args?: unknown) => Promise<unknown>;
  };
  const impl: AnyClient = {
    mutation: async (ref) => {
      const name = refName(ref);
      if (name === "matches:start") {
        const id = `match_${startedMatchIds.length + 1}`;
        startedMatchIds.push(id);
        return id;
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
