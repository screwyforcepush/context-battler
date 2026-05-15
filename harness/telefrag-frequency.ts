import "dotenv/config";
import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { makeFunctionReference } from "convex/server";
import { makeConvexClient } from "./client.js";
import {
  TELEGRAPHED_CRATE_STOP_AT_RANGE_ENV,
  type TelegraphedCrateStopAtRange,
} from "../convex/llm/idNormalisation.js";

type MatchId = string;
type MatchStatus = "pending" | "running" | "completed" | "failed";
type ReasoningEffort = "low" | "medium" | "high";

type MatchStatusRow = {
  status: MatchStatus;
  turn: number;
  completedAt: number | null;
  failure?: { turn: number; reason: string } | null;
} | null;

export type TurnWithOptionalEnvironmentalDeaths = {
  resolution: {
    environmentalDeaths?: readonly string[];
  };
};

type CohortRunOutcome =
  | {
      kind: "completed";
      matchId: MatchId;
      turn: number;
      environmentalDeaths: number;
    }
  | { kind: "failed"; matchId: MatchId; turn: number; reason: string }
  | { kind: "timeout"; matchId: MatchId };

type TerminalRunOutcome =
  | { kind: "completed"; matchId: MatchId; turn: number }
  | { kind: "failed"; matchId: MatchId; turn: number; reason: string }
  | { kind: "timeout"; matchId: MatchId };

type CohortSummary = {
  telegraphedStopAtRange: TelegraphedCrateStopAtRange;
  completed: number;
  failed: number;
  environmentalDeaths: number;
  telefragDeaths: number;
  matchIds: MatchId[];
};

export type TelefragFrequencyArgs = {
  runsPerCohort: number;
  concurrency: number;
  reasoning: ReasoningEffort;
  seedPrefix?: string;
  cohorts: TelegraphedCrateStopAtRange[];
  help: boolean;
};

type TelefragClient = {
  query: (ref: unknown, args: unknown) => Promise<unknown>;
  mutation: (ref: unknown, args: unknown) => Promise<unknown>;
};

type TelefragFrequencyDeps = {
  client: TelefragClient;
  emitEvent: (event: TelefragFrequencyEvent) => void;
  writeStderr: (line: string) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
};

type TelefragFrequencyEvent =
  | {
      event: "telefrag_frequency_config";
      runsPerCohort: number;
      concurrency: number;
      reasoning: ReasoningEffort;
      seedPrefix: string;
      envVar: string;
      note: string;
    }
  | {
      event: "cohort_start";
      telegraphedStopAtRange: TelegraphedCrateStopAtRange;
      runs: number;
    }
  | {
      event: "run_start";
      telegraphedStopAtRange: TelegraphedCrateStopAtRange;
      run: number;
      runs: number;
      matchId: MatchId;
      rngSeed: string;
    }
  | {
      event: "poll";
      telegraphedStopAtRange: TelegraphedCrateStopAtRange;
      matchId: MatchId;
      status: MatchStatus;
      turn: number;
    }
  | {
      event: "run_end";
      telegraphedStopAtRange: TelegraphedCrateStopAtRange;
      matchId: MatchId;
      status: "completed" | "failed" | "timeout";
      turn?: number;
      reason?: string;
      environmentalDeaths?: number;
      telefragDeaths?: number;
    }
  | ({
      event: "cohort_summary";
    } & CohortSummary)
  | {
      event: "telefrag_frequency_summary";
      cohorts: CohortSummary[];
    };

const REASONING_LEVELS = ["low", "medium", "high"] as const;
const DEFAULT_COHORTS: TelegraphedCrateStopAtRange[] = [0, 2];
const POLL_INTERVAL_MS = 2_000;
const MATCH_WALL_CLOCK_CAP_MS = 10 * 60 * 1_000;

const matchesStart = makeFunctionReference<
  "mutation",
  { rngSeed?: string; reasoningEffort?: ReasoningEffort },
  MatchId
>("matches:start");

const matchesStatus = makeFunctionReference<
  "query",
  { id: MatchId },
  MatchStatusRow
>("matches:status");

const turnsByMatchSlim = makeFunctionReference<
  "query",
  { matchId: MatchId },
  TurnWithOptionalEnvironmentalDeaths[]
>("turns:byMatchSlim");

export function countEnvironmentalDeaths(
  turns: readonly TurnWithOptionalEnvironmentalDeaths[],
): number {
  let total = 0;
  for (const turn of turns) {
    total += turn.resolution.environmentalDeaths?.length ?? 0;
  }
  return total;
}

export function parseTelefragFrequencyArgs(
  argv: readonly string[],
): TelefragFrequencyArgs {
  const { values } = parseArgs({
    args: argv.slice(),
    options: {
      "runs-per-cohort": { type: "string", default: "10" },
      concurrency: { type: "string", default: "1" },
      reasoning: { type: "string", default: "low" },
      "seed-prefix": { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  return {
    runsPerCohort: parsePositiveInt(
      values["runs-per-cohort"],
      "--runs-per-cohort",
    ),
    concurrency: parsePositiveInt(values.concurrency, "--concurrency"),
    reasoning: parseReasoning(values.reasoning),
    ...(values["seed-prefix"] !== undefined
      ? { seedPrefix: values["seed-prefix"] }
      : {}),
    cohorts: [...DEFAULT_COHORTS],
    help: values.help ?? false,
  };
}

export async function runTelefragFrequencyExperiment(
  args: TelefragFrequencyArgs,
  deps: TelefragFrequencyDeps,
): Promise<{ exitCode: 0 | 1; cohorts: CohortSummary[] }> {
  const seedPrefix =
    args.seedPrefix ?? `telefrag-frequency-${String(deps.now())}`;

  deps.emitEvent({
    event: "telefrag_frequency_config",
    runsPerCohort: args.runsPerCohort,
    concurrency: args.concurrency,
    reasoning: args.reasoning,
    seedPrefix,
    envVar: TELEGRAPHED_CRATE_STOP_AT_RANGE_ENV,
    note:
      "The resolver reads this override from its process environment; for remote Convex runs it must be present in the server-side function environment.",
  });

  const cohorts: CohortSummary[] = [];
  for (const telegraphedStopAtRange of args.cohorts) {
    const summary = await withTelegraphedStopAtRange(
      telegraphedStopAtRange,
      () =>
        runCohort(
          {
            ...args,
            seedPrefix,
          },
          telegraphedStopAtRange,
          deps,
        ),
    );
    cohorts.push(summary);
  }

  deps.emitEvent({ event: "telefrag_frequency_summary", cohorts });
  return {
    exitCode: cohorts.some((cohort) => cohort.failed > 0) ? 1 : 0,
    cohorts,
  };
}

async function runCohort(
  args: TelefragFrequencyArgs & { seedPrefix: string },
  telegraphedStopAtRange: TelegraphedCrateStopAtRange,
  deps: TelefragFrequencyDeps,
): Promise<CohortSummary> {
  deps.emitEvent({
    event: "cohort_start",
    telegraphedStopAtRange,
    runs: args.runsPerCohort,
  });

  const outcomes = await runCohortMatches(
    args,
    telegraphedStopAtRange,
    deps,
  );
  const completed = outcomes.filter(
    (outcome): outcome is CohortRunOutcome & { kind: "completed" } =>
      outcome.kind === "completed",
  );
  const failed = outcomes.length - completed.length;
  const environmentalDeaths = completed.reduce(
    (sum, outcome) => sum + outcome.environmentalDeaths,
    0,
  );
  const summary: CohortSummary = {
    telegraphedStopAtRange,
    completed: completed.length,
    failed,
    environmentalDeaths,
    telefragDeaths: environmentalDeaths,
    matchIds: completed.map((outcome) => outcome.matchId),
  };
  deps.emitEvent({ event: "cohort_summary", ...summary });
  return summary;
}

async function runCohortMatches(
  args: TelefragFrequencyArgs & { seedPrefix: string },
  telegraphedStopAtRange: TelegraphedCrateStopAtRange,
  deps: TelefragFrequencyDeps,
): Promise<CohortRunOutcome[]> {
  const outcomes: CohortRunOutcome[] = new Array(args.runsPerCohort);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= args.runsPerCohort) return;
      outcomes[index] = await runOneMatch(
        args,
        index,
        telegraphedStopAtRange,
        deps,
      );
    }
  };

  const workerCount = Math.min(args.concurrency, args.runsPerCohort);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return outcomes;
}

async function runOneMatch(
  args: TelefragFrequencyArgs & { seedPrefix: string },
  runIndex: number,
  telegraphedStopAtRange: TelegraphedCrateStopAtRange,
  deps: TelefragFrequencyDeps,
): Promise<CohortRunOutcome> {
  const rngSeed = `${args.seedPrefix}-${String(runIndex + 1).padStart(2, "0")}`;
  const matchId = (await deps.client.mutation(matchesStart, {
    rngSeed,
    reasoningEffort: args.reasoning,
  })) as MatchId;

  deps.emitEvent({
    event: "run_start",
    telegraphedStopAtRange,
    run: runIndex + 1,
    runs: args.runsPerCohort,
    matchId,
    rngSeed,
  });

  const outcome = await pollUntilTerminal(
    matchId,
    telegraphedStopAtRange,
    deps,
  );
  if (outcome.kind !== "completed") {
    deps.emitEvent({
      event: "run_end",
      telegraphedStopAtRange,
      matchId: outcome.matchId,
      status: outcome.kind,
      ...(outcome.kind === "failed"
        ? { turn: outcome.turn, reason: outcome.reason }
        : {}),
    });
    return outcome;
  }

  const turns = (await deps.client.query(turnsByMatchSlim, {
    matchId,
  })) as TurnWithOptionalEnvironmentalDeaths[];
  const environmentalDeaths = countEnvironmentalDeaths(turns);
  const completedOutcome: CohortRunOutcome = {
    ...outcome,
    environmentalDeaths,
  };
  deps.emitEvent({
    event: "run_end",
    telegraphedStopAtRange,
    matchId,
    status: "completed",
    turn: outcome.turn,
    environmentalDeaths,
    telefragDeaths: environmentalDeaths,
  });
  return completedOutcome;
}

async function pollUntilTerminal(
  matchId: MatchId,
  telegraphedStopAtRange: TelegraphedCrateStopAtRange,
  deps: TelefragFrequencyDeps,
): Promise<TerminalRunOutcome> {
  const startedAt = deps.now();
  while (deps.now() - startedAt < MATCH_WALL_CLOCK_CAP_MS) {
    const status = (await deps.client.query(matchesStatus, { id: matchId })) as
      | MatchStatusRow
      | null;
    if (status === null) {
      return {
        kind: "failed",
        matchId,
        turn: 0,
        reason: "matches.status returned null",
      };
    }

    deps.emitEvent({
      event: "poll",
      telegraphedStopAtRange,
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
    await deps.sleep(POLL_INTERVAL_MS);
  }
  return { kind: "timeout", matchId };
}

async function withTelegraphedStopAtRange<T>(
  value: TelegraphedCrateStopAtRange,
  run: () => Promise<T>,
): Promise<T> {
  const previous = process.env[TELEGRAPHED_CRATE_STOP_AT_RANGE_ENV];
  process.env[TELEGRAPHED_CRATE_STOP_AT_RANGE_ENV] = String(value);
  try {
    return await run();
  } finally {
    if (previous === undefined) {
      delete process.env[TELEGRAPHED_CRATE_STOP_AT_RANGE_ENV];
    } else {
      process.env[TELEGRAPHED_CRATE_STOP_AT_RANGE_ENV] = previous;
    }
  }
}

function parsePositiveInt(raw: string | undefined, label: string): number {
  if (raw === undefined) throw new Error(`${label} is required`);
  const trimmed = raw.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) {
    throw new Error(`${label} must be a positive integer (got: ${raw})`);
  }
  return Number.parseInt(trimmed, 10);
}

function parseReasoning(raw: string | undefined): ReasoningEffort {
  const value = raw ?? "low";
  if ((REASONING_LEVELS as readonly string[]).includes(value)) {
    return value as ReasoningEffort;
  }
  throw new Error(
    `--reasoning must be one of ${REASONING_LEVELS.join(", ")} (got: ${value})`,
  );
}

function usage(): string {
  return [
    "usage: npx tsx harness/telefrag-frequency.ts [--runs-per-cohort N] [--concurrency C] [--reasoning low|medium|high] [--seed-prefix tag]",
    "",
    "Runs the phase-12 WP-E in-loop experiment: 10 matches with telegraphedStopAtRange=0 and 10 with =2 by default.",
    `The resolver override knob is ${TELEGRAPHED_CRATE_STOP_AT_RANGE_ENV}; remote Convex deployments read it from server-side env.`,
    "",
  ].join("\n");
}

async function main(): Promise<void> {
  const args = parseTelefragFrequencyArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }

  const client = makeConvexClient() as unknown as TelefragClient;
  const result = await runTelefragFrequencyExperiment(args, {
    client,
    emitEvent: (event) => process.stdout.write(`${JSON.stringify(event)}\n`),
    writeStderr: (line) => process.stderr.write(line),
    sleep: (ms) => sleep(ms),
    now: () => Date.now(),
  });
  process.exitCode = result.exitCode;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === `file://${process.argv[1]}`;

if (invokedDirectly) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `${JSON.stringify({ event: "fatal", reason: "unhandled_error", message })}\n`,
    );
    process.exitCode = 1;
  });
}
