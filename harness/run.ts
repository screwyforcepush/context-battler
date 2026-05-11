// WP11 Stage-1 — Harness CLI driver.
//
// Per ADR §3 the harness is a thin orchestrator: it triggers `matches.start`,
// polls `matches.status` until terminal, and prints machine-readable JSONL so
// reviewing agents can grep. Stage-1 scope is `--runs 1 --concurrency 1`
// (single-match smoke). Stage-2/3 layer fan-out and `reports.aggregate` on top
// — explicitly out of scope here per the WP11 staging note.
//
// Invariants this file holds:
//   - Polling cadence is 2 s (per ADR §8 / WP11 risks: "1-second polling is
//     fine; if it gets noisy, switch to reactive subscription. Don't optimise
//     prematurely." 2 s is a safer default for CLI calls.)
//   - Per-match wall-clock cap is 10 minutes (Stage-1 spec, WP11 risks). On
//     cap exceeded the run is recorded as `timeout` and counted toward the
//     `failed` bucket. The action is NOT cancelled — the engine keeps running
//     in Convex; we just stop tracking.
//   - `--reasoning` is validated against the literal union {low, medium, high}.
//     `none` is REJECTED with a non-zero exit per de-risking.md "Reasoning
//     policy" (binding for the entire phase). The validated value is
//     plumbed into `matches.start({ reasoningEffort })` (WP10.5 A5), which
//     persists it on the matches row; `runMatch.advanceTurn` reads it back
//     and forwards it to every per-turn `callDecisionTool` invocation.
//   - Concurrency knob: at C=1 we run sequentially; at C>1 we use a tiny
//     inline Promise-pool (no external dep). Stage-2 will extend this to a
//     real semaphore-bounded fan-out if needed.
//
// Output contract (machine-readable JSONL — WP11 spec):
//   {"event":"run_start","matchId":"...","run":1,"runs":N}
//   {"event":"poll","matchId":"...","status":"running","turn":7}      (per tick)
//   {"event":"run_end","matchId":"...","status":"completed","turn":50}
//   {"event":"run_end","matchId":"...","status":"failed","turn":N,"reason":"..."}
//   {"event":"run_end","matchId":"...","status":"timeout"}
//   {"event":"summary","completed":X,"failed":Y,"total":N,"durationMs":...}
//   {"event":"harness_error","reason":"runs_row_missing","count":N,"matchIds":[..]}
//
// Exit code semantics (post fix #3):
//   - 0 if every run reached "completed" AND every completed match got a
//     `runs` aggregate row within the poll window.
//   - 1 if ANY run failed/timed out, OR if any completed match ended without
//     an aggregate row (silent partial summaries are unsafe for Gate-3).
//
// Testability seam:
//   The orchestrator body is exported as `runHarness(args, deps)` — a pure-
//   ish function returning `{ exitCode, ... }`. The CLI entry point `main()`
//   wires real deps (Convex client, real stdout/stderr) and forwards the
//   exit code to `process.exitCode`. Tests inject a fake `client`,
//   `emitEvent`, `writeStderr`, and `sleep` to drive scenarios in-process
//   without spawning a child.

import "dotenv/config";
import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import {
  makeFunctionReference,
  type FunctionReference,
  type FunctionReturnType,
  type OptionalRestArgs,
} from "convex/server";
import { makeConvexClient } from "./client.js";

// ─────────────────────────────────────────────────────────────────────────────
// Function references.
//
// We construct typed FunctionReferences via `makeFunctionReference` instead of
// importing `api.matches.start` directly. Rationale:
//   - DerekChroma's WP10 lands matches.start / matches.status alongside this
//     work. The Convex codegen (`npx convex dev --once`) refreshes
//     `convex/_generated/api.d.ts` only after their files exist on disk.
//   - Without a refresh, `api.matches.start` is a typecheck error here.
//   - `makeFunctionReference<"mutation", Args, Ret>(name)` is the documented
//     escape hatch for custom clients (per `convex/server` API.d.ts) and
//     produces an identically-shaped reference at runtime.
//   - Once the codegen catches up, switching to `api.matches.start` is a
//     purely cosmetic edit; runtime behaviour is unchanged.
//
// Contract source: DerekChroma's WP10 message, mirrored in the task brief.
// ─────────────────────────────────────────────────────────────────────────────

type MatchId = string; // Convex Ids serialise as opaque strings over HTTP.

type MatchStatus = "pending" | "running" | "completed" | "failed";

type StatusResponse = {
  status: MatchStatus;
  turn: number;
  completedAt: number | null;
  failure?: { turn: number; reason: string };
} | null;

const matchesStart = makeFunctionReference<
  "mutation",
  { rngSeed?: string; reasoningEffort?: ReasoningEffort },
  MatchId
>("matches:start");

const matchesStatus = makeFunctionReference<
  "query",
  { id: MatchId },
  StatusResponse
>("matches:status");

// WP12 — `runs.byMatch` returns the per-match aggregated stats row written
// by the scheduled `runs.aggregate` mutation. The harness post-run hook
// polls this until the row materialises (the scheduler fires shortly after
// `match.status` flips to "completed").
type RunSummary = {
  _id: string;
  matchId: MatchId;
  kills: number;
  extractions: number;
  equips: number;
  speechEvents: number;
  perPersona: Array<{
    personaId: string;
    survivedTurns: number;
    kills: number;
    extracted: number;
    equips: number;
    speechEvents: number;
  }>;
};

type RunSummaryRow = RunSummary | null;

const runsByMatch = makeFunctionReference<
  "query",
  { matchId: MatchId },
  RunSummaryRow
>("runs:byMatch");

// WP14 / D45 — `reports.create` persistence wiring. After the multi-run
// summary is emitted the harness fires a single mutation to persist the
// closing-report payload to Convex. The mutation is idempotent on
// (matchIdsHash, reportType) so re-runs over the same set are no-op
// inserts (the existing row's id is returned).
//
// Return shape mirrors `runReportCreate` in convex/reports.ts: we only
// read `_id` and `payload.{ runCount, meets* }` for telemetry — the full
// payload is fetched downstream via `reports.byId` if needed.
type ReportCreatePayload = {
  runCount: number;
  meetsExtractionThreshold?: boolean;
  meetsKillThreshold?: boolean;
  meetsEquipThreshold?: boolean;
  meetsSpeechThreshold?: boolean;
  meetsPersonaSpreadThreshold?: boolean;
  meetsAllThresholds: boolean;
};

type ReportCreateResult = {
  _id: string;
  payload: ReportCreatePayload;
  missingRunsForMatchIds: MatchId[];
};

const reportsCreate = makeFunctionReference<
  "mutation",
  { matchIds: MatchId[]; reportType: string },
  ReportCreateResult
>("reports:create");

// ─────────────────────────────────────────────────────────────────────────────
// Argument parsing.
//
// `node:util.parseArgs` with `as const` + explicit type literals so the
// inferred `values` shape is `string | undefined` per option (no implicit any).
// Values are post-validated here.
// ─────────────────────────────────────────────────────────────────────────────

const REASONING_LEVELS = ["low", "medium", "high"] as const;
type ReasoningEffort = (typeof REASONING_LEVELS)[number];

export type CliArgs = {
  runs: number;
  concurrency: number;
  reasoning: ReasoningEffort;
  seedPrefix?: string;
};

function parseCliArgs(argv: readonly string[]): CliArgs {
  const { values } = parseArgs({
    args: argv.slice(),
    options: {
      runs: { type: "string", default: "1" },
      concurrency: { type: "string", default: "1" },
      reasoning: { type: "string", default: "low" },
      "seed-prefix": { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });

  const runs = parsePositiveInt(values.runs, "--runs");
  const concurrency = parsePositiveInt(values.concurrency, "--concurrency");

  const reasoningRaw = values.reasoning ?? "low";
  if (!isReasoningEffort(reasoningRaw)) {
    // Reject with a diagnostic; phase-1 binding per de-risking.md.
    process.stderr.write(
      JSON.stringify({
        event: "fatal",
        reason: "invalid_reasoning",
        got: reasoningRaw,
        allowed: REASONING_LEVELS,
        note:
          "`none` is explicitly disallowed (de-risking.md \"Reasoning policy\").",
      }) + "\n",
    );
    process.exit(2);
  }

  return {
    runs,
    concurrency,
    reasoning: reasoningRaw,
    ...(values["seed-prefix"] !== undefined
      ? { seedPrefix: values["seed-prefix"] }
      : {}),
  };
}

function parsePositiveInt(raw: string | undefined, label: string): number {
  if (raw === undefined) {
    process.stderr.write(`${label} is required.\n`);
    process.exit(2);
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0 || String(n) !== raw.trim()) {
    process.stderr.write(`${label} must be a positive integer (got: ${raw}).\n`);
    process.exit(2);
  }
  return n;
}

function isReasoningEffort(value: string): value is ReasoningEffort {
  return (REASONING_LEVELS as readonly string[]).includes(value);
}

// ─────────────────────────────────────────────────────────────────────────────
// JSONL output contract.
//
// Centralised so future events stay shape-compatible. stdout is the contract
// per WP11 ("machine-readable JSONL preferred so reviewing agents can grep").
// ─────────────────────────────────────────────────────────────────────────────

type PerPersonaSummary = {
  personaId: string;
  survivedTurns: number;
  kills: number;
  extracted: number;
  equips: number;
  speechEvents: number;
};

export type HarnessEvent =
  | { event: "run_start"; matchId: MatchId; run: number; runs: number }
  | { event: "poll"; matchId: MatchId; status: MatchStatus; turn: number }
  | {
      event: "run_end";
      matchId: MatchId;
      status: "completed" | "failed" | "timeout";
      turn?: number;
      reason?: string;
    }
  // WP12 per-match aggregate event — emitted after `runs.aggregate` writes
  // the row. Failed/timeout matches won't have one.
  | {
      event: "run_aggregate";
      matchId: MatchId;
      kills: number;
      extractions: number;
      equips: number;
      speechEvents: number;
      perPersona: PerPersonaSummary[];
    }
  | {
      event: "summary";
      completed: number;
      failed: number;
      total: number;
      durationMs: number;
    }
  // WP12 Stage-2 multi-run aggregate — emitted after every match has had
  // its `runs.aggregate` row written. Sums the per-match counts and
  // produces a per-persona breakdown summed across runs.
  | {
      event: "multi_run_summary";
      matchIds: MatchId[];
      runIds: string[];
      runs: number;
      kills: number;
      extractions: number;
      equips: number;
      speechEvents: number;
      perPersona: PerPersonaSummary[];
    }
  // Fix #3 — aggregate signal that one or more completed matches ended
  // without their `runs.aggregate` row materialising. This event is the
  // authoritative downstream-queryable counterpart to the per-match
  // `fatal` stderr emission (which is preserved for human debugging).
  | {
      event: "harness_error";
      reason: "runs_row_missing";
      count: number;
      matchIds: MatchId[];
    }
  // WP14 / D45 — emitted after `reports.create` persists the closing-
  // report payload to Convex. Carries the report row's `_id` (so a
  // reviewing agent can `npx convex run reports:byId --id=<id>` from
  // the log line) plus the §10 done-bar threshold flags for at-a-glance
  // pass/fail. Only emitted when the harness had at least one completed
  // match — a fully-failed dispatch is a diagnostic event, not a report.
  | {
      event: "report_created";
      reportId: string;
      reportType: string;
      runCount: number;
      meetsAllThresholds: boolean;
      meetsExtractionThreshold?: boolean;
      meetsKillThreshold?: boolean;
      meetsEquipThreshold?: boolean;
      meetsSpeechThreshold?: boolean;
      meetsPersonaSpreadThreshold?: boolean;
      missingRunsForMatchIds: MatchId[];
    };

// ─────────────────────────────────────────────────────────────────────────────
// Polling loop for a single match.
//
// Returns the terminal outcome. `timeout` is treated as a failure by the
// caller for exit-code purposes but is surfaced distinctly in JSONL so a
// reviewing agent can tell "engine hung" from "engine raised".
// ─────────────────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 2_000;
const MATCH_WALL_CLOCK_CAP_MS = 10 * 60 * 1_000; // 10 min per match (Stage-1).

type RunOutcome =
  | { kind: "completed"; matchId: MatchId; turn: number }
  | { kind: "failed"; matchId: MatchId; turn: number; reason: string }
  | { kind: "timeout"; matchId: MatchId };

async function pollUntilTerminal(
  client: HarnessClient,
  matchId: MatchId,
  emitEvent: (ev: HarnessEvent) => void,
  sleepImpl: (ms: number) => Promise<void>,
): Promise<RunOutcome> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < MATCH_WALL_CLOCK_CAP_MS) {
    const status: StatusResponse = await client.query(matchesStatus, {
      id: matchId,
    });
    if (status === null) {
      // Match document went missing — treat as failure. Should never happen
      // unless DerekChroma's `matches.status` semantics change.
      return {
        kind: "failed",
        matchId,
        turn: 0,
        reason: "matches.status returned null",
      };
    }
    emitEvent({
      event: "poll",
      matchId,
      status: status.status,
      turn: status.turn,
    });
    if (status.status === "completed") {
      return { kind: "completed", matchId, turn: status.turn };
    }
    if (status.status === "failed") {
      return {
        kind: "failed",
        matchId,
        turn: status.failure?.turn ?? status.turn,
        reason: status.failure?.reason ?? "unknown",
      };
    }
    await sleepImpl(POLL_INTERVAL_MS);
  }
  return { kind: "timeout", matchId };
}

// ─────────────────────────────────────────────────────────────────────────────
// Run a single match: start → poll → emit → return outcome.
// ─────────────────────────────────────────────────────────────────────────────

async function runOne(
  client: HarnessClient,
  runIndex: number,
  totalRuns: number,
  reasoningEffort: ReasoningEffort,
  seedPrefix: string | undefined,
  emitEvent: (ev: HarnessEvent) => void,
  sleepImpl: (ms: number) => Promise<void>,
): Promise<RunOutcome> {
  // WP10.5 A5 — `--reasoning` is plumbed end-to-end: harness validates the
  // literal, forwards it to `matches.start`, which persists it on the
  // matches row; `runMatch.advanceTurn` reads it back per turn and threads
  // it into `callDecisionTool`'s request body (`reasoning.effort`).
  const matchId: MatchId = await client.mutation(matchesStart, {
    reasoningEffort,
    ...(seedPrefix !== undefined
      ? { rngSeed: `${seedPrefix}-${String(runIndex + 1).padStart(2, "0")}` }
      : {}),
  });
  emitEvent({
    event: "run_start",
    matchId,
    run: runIndex + 1,
    runs: totalRuns,
  });
  const outcome = await pollUntilTerminal(client, matchId, emitEvent, sleepImpl);
  emitEvent({
    event: "run_end",
    matchId: outcome.matchId,
    status: outcome.kind,
    ...(outcome.kind === "completed" ? { turn: outcome.turn } : {}),
    ...(outcome.kind === "failed"
      ? { turn: outcome.turn, reason: outcome.reason }
      : {}),
  });
  return outcome;
}

// ─────────────────────────────────────────────────────────────────────────────
// Promise-pool for `--concurrency C`.
//
// Stage-1 supports C=1 (sequential) and a rudimentary worker pool for C>1.
// Workers pull indices off a shared cursor; each worker runs sequentially.
// This avoids `p-limit` per the no-external-deps constraint and is enough
// for stage-1 (and the obvious stage-2 starting point).
// ─────────────────────────────────────────────────────────────────────────────

async function runAll(
  client: HarnessClient,
  totalRuns: number,
  concurrency: number,
  reasoningEffort: ReasoningEffort,
  seedPrefix: string | undefined,
  emitEvent: (ev: HarnessEvent) => void,
  sleepImpl: (ms: number) => Promise<void>,
): Promise<RunOutcome[]> {
  const outcomes: RunOutcome[] = new Array(totalRuns);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const i = cursor;
      cursor += 1;
      if (i >= totalRuns) return;
      outcomes[i] = await runOne(
        client,
        i,
        totalRuns,
        reasoningEffort,
        seedPrefix,
        emitEvent,
        sleepImpl,
      );
    }
  };
  const workerCount = Math.min(concurrency, totalRuns);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return outcomes;
}

// ─────────────────────────────────────────────────────────────────────────────
// WP12 — post-run aggregate hook.
//
// After a match transitions to `completed`, `runMatch.advanceTurn` schedules
// `runs.aggregate(matchId)` via `scheduler.runAfter(0, ...)`. The aggregate
// row materialises shortly after the harness sees the terminal status. We
// poll `runs.byMatch` for up to 30 s with a 1-second cadence — fast enough
// for stage-2 (10 matches × 8 agents × 50 turns) but bounded so a missing
// row surfaces as a diagnostic rather than a hang.
//
// Failed/timeout matches return `null` and are excluded from the multi-run
// summary (per WP12 acceptance: "Failed matches do NOT get a `runs` row").
// ─────────────────────────────────────────────────────────────────────────────

const RUN_ROW_POLL_INTERVAL_MS = 1_000;
const RUN_ROW_POLL_TIMEOUT_MS = 30_000;

async function waitForRunRow(
  client: HarnessClient,
  matchId: MatchId,
  sleepImpl: (ms: number) => Promise<void>,
  intervalMs: number,
  timeoutMs: number,
): Promise<RunSummaryRow> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const row = await client.query(runsByMatch, { matchId });
    if (row !== null) return row;
    await sleepImpl(intervalMs);
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Dependency-injection seam.
//
// `runHarness` is the orchestrator body without process I/O concerns. The
// CLI entry point (`main()`) wires real deps; tests inject fakes. Each
// dep is small and orthogonal:
//
//   - `client`     — Convex (or fake) client with `query` + `mutation`.
//   - `emitEvent`  — JSONL stdout writer (test capture or real writer).
//   - `writeStderr`— stderr writer (the per-match `fatal` line).
//   - `sleep`      — `setTimeout`-based sleep (collapsed to 0ms in tests).
//
// Returning `{ exitCode }` rather than calling `process.exit` is what makes
// the orchestrator unit-testable in-process: the caller is responsible for
// translating the result to a process exit. This also means a future
// embedder (e.g. a long-running watcher) can call `runHarness` repeatedly
// without crashing the host.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Minimal client surface the harness uses. Reduced from `ConvexHttpClient`
 * to its two methods (`query`, `mutation`) so tests can implement it
 * directly without instantiating a real HTTP client.
 *
 * The `query`/`mutation` overloads mirror `ConvexHttpClient`'s typed
 * versions when called with a `FunctionReference` (precise return type),
 * and fall back to `unknown` when called with a raw string name (rare —
 * only used by tests that exercise the dispatch path). This means the
 * harness body keeps full type safety even though tests can swap in a
 * minimal fake.
 */
export interface HarnessClient {
  query<Q extends FunctionReference<"query">>(
    ref: Q,
    args: FunctionReturnType<Q> extends never ? never : OptionalRestArgs<Q>[0],
  ): Promise<FunctionReturnType<Q>>;
  query(ref: string, args?: Record<string, unknown>): Promise<unknown>;
  mutation<M extends FunctionReference<"mutation">>(
    ref: M,
    args: FunctionReturnType<M> extends never ? never : OptionalRestArgs<M>[0],
  ): Promise<FunctionReturnType<M>>;
  mutation(ref: string, args?: Record<string, unknown>): Promise<unknown>;
}

export type HarnessDeps = {
  client: HarnessClient;
  emitEvent: (ev: HarnessEvent) => void;
  writeStderr: (line: string) => void;
  sleep: (ms: number) => Promise<void>;
  /**
   * Optional override of the `runs.aggregate` row poll budget. Production
   * keeps the WP12 default (30 s wall-clock cap with 1 s cadence). Tests
   * shrink both to keep the suite fast — and to deterministically drive
   * the "row never materialises" branch without burning wall-clock.
   */
  runRowPoll?: {
    intervalMs: number;
    timeoutMs: number;
  };
};

export type HarnessResult = {
  exitCode: 0 | 1;
  completed: number;
  failed: number;
  missingRunsRowCount: number;
  missingRunsMatchIds: MatchId[];
};

/**
 * Run the harness end-to-end against an injected client and emit/sleep
 * surface. Returns a structured result with the intended process exit code
 * — the caller is responsible for translating to `process.exitCode`.
 *
 * Exit code rules (post fix #3):
 *   - 1 if `failed > 0` (any match failed/timed out — stage-1 fail-loud
 *     threshold per WP11).
 *   - 1 if `missingRunsRowCount > 0` (a completed match never got a `runs`
 *     aggregate row within the poll window — silent partial summaries
 *     would produce an invalid Gate-3 report).
 *   - 0 otherwise.
 */
export async function runHarness(
  args: CliArgs,
  deps: HarnessDeps,
): Promise<HarnessResult> {
  const { client, emitEvent, writeStderr, sleep: sleepImpl } = deps;
  const runRowPollIntervalMs =
    deps.runRowPoll?.intervalMs ?? RUN_ROW_POLL_INTERVAL_MS;
  const runRowPollTimeoutMs =
    deps.runRowPoll?.timeoutMs ?? RUN_ROW_POLL_TIMEOUT_MS;

  const startedAt = Date.now();
  const outcomes = await runAll(
    client,
    args.runs,
    args.concurrency,
    args.reasoning,
    args.seedPrefix,
    emitEvent,
    sleepImpl,
  );
  const durationMs = Date.now() - startedAt;

  let completed = 0;
  let failed = 0;
  for (const o of outcomes) {
    if (o.kind === "completed") completed += 1;
    else failed += 1;
  }
  emitEvent({
    event: "summary",
    completed,
    failed,
    total: args.runs,
    durationMs,
  });

  // ── WP12 post-run aggregate hook ───────────────────────────────────────
  //
  // For every completed match, poll `runs.byMatch` until the WP12-owned
  // row is written by the scheduled `runs.aggregate` mutation. Then sum
  // across runs and emit the multi-run summary as JSON to stdout. The
  // harness emits this regardless of `--runs` count so single-match
  // smokes also produce a stable summary line.
  const completedMatchIds: MatchId[] = outcomes
    .filter((o): o is RunOutcome & { kind: "completed" } => o.kind === "completed")
    .map((o) => o.matchId);

  const rows = await Promise.all(
    completedMatchIds.map((id) =>
      waitForRunRow(
        client,
        id,
        sleepImpl,
        runRowPollIntervalMs,
        runRowPollTimeoutMs,
      ),
    ),
  );

  // Emit per-match aggregate events for each completed run; track ids
  // missing the `runs.aggregate` row for the post-loop `harness_error`
  // event (fix #3 — strict accounting for Gate-3).
  const collectedRows: RunSummary[] = [];
  const missingRunsMatchIds: MatchId[] = [];
  for (let i = 0; i < completedMatchIds.length; i++) {
    const matchId = completedMatchIds[i] as MatchId;
    const row = rows[i] ?? null;
    if (row) {
      collectedRows.push(row);
      emitEvent({
        event: "run_aggregate",
        matchId,
        kills: row.kills,
        extractions: row.extractions,
        equips: row.equips,
        speechEvents: row.speechEvents,
        perPersona: row.perPersona,
      });
    } else {
      // Defensive: the scheduler hasn't fired the aggregator within the
      // poll window. Surface as JSONL fatal-line on stderr so a reviewing
      // human can see why the multi-run summary excludes this match. The
      // authoritative aggregate signal is the `harness_error` event
      // emitted below.
      missingRunsMatchIds.push(matchId);
      writeStderr(
        JSON.stringify({
          event: "fatal",
          reason: "run_row_missing",
          matchId,
          note:
            "runs.aggregate row did not materialise within poll window",
        }) + "\n",
      );
    }
  }

  // Aggregate the per-match rows into a multi-run summary. Per-persona
  // sums collapse to a single PerPersonaSummary per persona by keeping
  // a running total across rows. survivedTurns is summed (not averaged)
  // so the consumer can compute mean = sum / runCount externally —
  // mean across N runs may not be the right summary metric if a persona
  // is absent from some runs (it isn't in phase-1, but the choice should
  // be the consumer's, not ours).
  const personaTotals = new Map<string, PerPersonaSummary>();
  let totalKills = 0;
  let totalExtractions = 0;
  let totalEquips = 0;
  let totalSpeech = 0;
  for (const row of collectedRows) {
    totalKills += row.kills;
    totalExtractions += row.extractions;
    totalEquips += row.equips;
    totalSpeech += row.speechEvents;
    for (const p of row.perPersona) {
      const existing = personaTotals.get(p.personaId);
      if (existing) {
        existing.survivedTurns += p.survivedTurns;
        existing.kills += p.kills;
        existing.extracted += p.extracted;
        existing.equips += p.equips;
        existing.speechEvents += p.speechEvents;
      } else {
        personaTotals.set(p.personaId, { ...p });
      }
    }
  }

  emitEvent({
    event: "multi_run_summary",
    matchIds: completedMatchIds,
    runIds: collectedRows.map((r) => r._id),
    runs: collectedRows.length,
    kills: totalKills,
    extractions: totalExtractions,
    equips: totalEquips,
    speechEvents: totalSpeech,
    perPersona: [...personaTotals.values()],
  });

  // ── WP14 / D45 — persist the closing-report payload to Convex ─────────
  //
  // The §10 done-bar Cucumber Scenario 3 thresholds are checked off the
  // persisted `reports` row, not the in-memory multi_run_summary. We pass
  // ALL completed matchIds (NOT only those with `runs` rows) so the
  // mutation's `missingRunsForMatchIds` field captures the diagnostic
  // gap explicitly — re-running the harness over the same matchIds is
  // idempotent (sort-then-comma SHA-256 of matchIds + reportType is the
  // deduplication key per `convex/reports.ts:hashMatchIds`).
  //
  // ReportType convention: `closing-${runs}` so a 10-run probe writes a
  // distinct row from a 50-run dispatch even when matchIds happen to
  // overlap. Stage-3 dispatch produces `closing-50`.
  //
  // Skipped on the all-failed path (completedMatchIds empty): a fully-
  // failed dispatch is a diagnostic event, not a closing report — no
  // row is written. The exit code already carries the failure signal.
  if (completedMatchIds.length > 0) {
    const reportType = `closing-${args.runs}`;
    const reportResult: ReportCreateResult = await client.mutation(
      reportsCreate,
      { matchIds: completedMatchIds, reportType },
    );
    emitEvent({
      event: "report_created",
      reportId: reportResult._id,
      reportType,
      runCount: reportResult.payload.runCount,
      meetsAllThresholds: reportResult.payload.meetsAllThresholds,
      meetsExtractionThreshold: reportResult.payload.meetsExtractionThreshold,
      meetsKillThreshold: reportResult.payload.meetsKillThreshold,
      meetsEquipThreshold: reportResult.payload.meetsEquipThreshold,
      meetsSpeechThreshold: reportResult.payload.meetsSpeechThreshold,
      meetsPersonaSpreadThreshold:
        reportResult.payload.meetsPersonaSpreadThreshold,
      missingRunsForMatchIds: reportResult.missingRunsForMatchIds,
    });
  }

  // Fix #3 — emit the authoritative aggregate signal AFTER the multi-run
  // summary so downstream consumers can correlate the missing-rows count
  // with the partial summary they just received. Only fire when there is
  // something to report (no event on the happy path).
  if (missingRunsMatchIds.length > 0) {
    emitEvent({
      event: "harness_error",
      reason: "runs_row_missing",
      count: missingRunsMatchIds.length,
      matchIds: missingRunsMatchIds,
    });
  }

  // Exit-code rules (fix #3): failed > 0 OR missing > 0 → 1, else 0.
  const exitCode: 0 | 1 =
    failed > 0 || missingRunsMatchIds.length > 0 ? 1 : 0;
  return {
    exitCode,
    completed,
    failed,
    missingRunsRowCount: missingRunsMatchIds.length,
    missingRunsMatchIds,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI entry point.
//
// Wires real deps (Convex client, real stdout/stderr writers, real sleep)
// and translates `runHarness`'s structured result into `process.exitCode`.
// We deliberately set `process.exitCode` instead of calling
// `process.exit(...)` so any pending Promise / writable buffer gets to
// flush naturally before the script returns (per the task brief).
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  // Reasoning is validated above and now plumbed end-to-end (WP10.5 A5):
  // harness → matches.start → matches row → runMatch.advanceTurn →
  // callDecisionTool. The telemetry line below is the same shape as Stage-1.
  process.stderr.write(
    JSON.stringify({
      event: "config",
      runs: args.runs,
      concurrency: args.concurrency,
      reasoning: args.reasoning,
      ...(args.seedPrefix !== undefined ? { seedPrefix: args.seedPrefix } : {}),
    }) + "\n",
  );

  const client = makeConvexClient();
  const result = await runHarness(args, {
    client: client as unknown as HarnessClient,
    emitEvent: (ev) => process.stdout.write(JSON.stringify(ev) + "\n"),
    writeStderr: (line) => process.stderr.write(line),
    sleep: (ms) => sleep(ms),
  });

  process.exitCode = result.exitCode;
}

// Only run when this module is invoked as a script (i.e. `tsx harness/run.ts`).
// When imported by the test suite, `main()` must NOT execute on import — the
// tests own the harness lifecycle via `runHarness(...)` directly.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;

if (invokedDirectly) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      JSON.stringify({ event: "fatal", reason: "unhandled_error", message }) +
        "\n",
    );
    process.exitCode = 1;
  });
}
