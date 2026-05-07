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
//
// Exit code: 0 if every run reaches "completed"; 1 if ANY run failed or
// hit the wall-clock cap. Stage-1 = "any failure → exit 1" per WP11.

import "dotenv/config";
import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { makeFunctionReference } from "convex/server";
import type { ConvexHttpClient } from "convex/browser";
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

// ─────────────────────────────────────────────────────────────────────────────
// Argument parsing.
//
// `node:util.parseArgs` with `as const` + explicit type literals so the
// inferred `values` shape is `string | undefined` per option (no implicit any).
// Values are post-validated here.
// ─────────────────────────────────────────────────────────────────────────────

const REASONING_LEVELS = ["low", "medium", "high"] as const;
type ReasoningEffort = (typeof REASONING_LEVELS)[number];

type CliArgs = {
  runs: number;
  concurrency: number;
  reasoning: ReasoningEffort;
};

function parseCliArgs(argv: readonly string[]): CliArgs {
  const { values } = parseArgs({
    args: argv.slice(),
    options: {
      runs: { type: "string", default: "1" },
      concurrency: { type: "string", default: "1" },
      reasoning: { type: "string", default: "low" },
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

  return { runs, concurrency, reasoning: reasoningRaw };
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
// JSONL output.
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

type Event =
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
    };

function emit(ev: Event): void {
  process.stdout.write(JSON.stringify(ev) + "\n");
}

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
  client: ConvexHttpClient,
  matchId: MatchId,
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
    emit({
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
    await sleep(POLL_INTERVAL_MS);
  }
  return { kind: "timeout", matchId };
}

// ─────────────────────────────────────────────────────────────────────────────
// Run a single match: start → poll → emit → return outcome.
// ─────────────────────────────────────────────────────────────────────────────

async function runOne(
  client: ConvexHttpClient,
  runIndex: number,
  totalRuns: number,
  reasoningEffort: ReasoningEffort,
): Promise<RunOutcome> {
  // WP10.5 A5 — `--reasoning` is plumbed end-to-end: harness validates the
  // literal, forwards it to `matches.start`, which persists it on the
  // matches row; `runMatch.advanceTurn` reads it back per turn and threads
  // it into `callDecisionTool`'s request body (`reasoning.effort`).
  const matchId: MatchId = await client.mutation(matchesStart, {
    reasoningEffort,
  });
  emit({
    event: "run_start",
    matchId,
    run: runIndex + 1,
    runs: totalRuns,
  });
  const outcome = await pollUntilTerminal(client, matchId);
  emit({
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
  client: ConvexHttpClient,
  totalRuns: number,
  concurrency: number,
  reasoningEffort: ReasoningEffort,
): Promise<RunOutcome[]> {
  const outcomes: RunOutcome[] = new Array(totalRuns);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const i = cursor;
      cursor += 1;
      if (i >= totalRuns) return;
      outcomes[i] = await runOne(client, i, totalRuns, reasoningEffort);
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
  client: ConvexHttpClient,
  matchId: MatchId,
): Promise<RunSummaryRow> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < RUN_ROW_POLL_TIMEOUT_MS) {
    const row = await client.query(runsByMatch, { matchId });
    if (row !== null) return row;
    await sleep(RUN_ROW_POLL_INTERVAL_MS);
  }
  return null;
}


// ─────────────────────────────────────────────────────────────────────────────
// Entry point.
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
    }) + "\n",
  );

  const client = makeConvexClient();
  const startedAt = Date.now();
  const outcomes = await runAll(
    client,
    args.runs,
    args.concurrency,
    args.reasoning,
  );
  const durationMs = Date.now() - startedAt;

  let completed = 0;
  let failed = 0;
  for (const o of outcomes) {
    if (o.kind === "completed") completed += 1;
    else failed += 1;
  }
  emit({
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
    completedMatchIds.map((id) => waitForRunRow(client, id)),
  );

  // Emit per-match aggregate events for each completed run.
  const collectedRows: RunSummary[] = [];
  for (let i = 0; i < completedMatchIds.length; i++) {
    const matchId = completedMatchIds[i] as MatchId;
    const row = rows[i] ?? null;
    if (row) {
      collectedRows.push(row);
      emit({
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
      // poll window. Surface as JSONL fatal-line so the reviewing agent
      // can see why the multi-run summary excludes this match.
      process.stderr.write(
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

  emit({
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

  // Stage-1 fail-loud threshold: any failure → exit 1.
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(
    JSON.stringify({ event: "fatal", reason: "unhandled_error", message }) +
      "\n",
  );
  process.exit(1);
});
