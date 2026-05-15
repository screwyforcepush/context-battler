import { fileURLToPath } from "node:url";
import { makeFunctionReference } from "convex/server";
import { makeConvexClient } from "../client.js";
import { fetchSlimAcross } from "../diagnostics/fanout.js";
import {
  MAX_MATCHES,
  type DiagnosticMatch,
  type SlimMatchRows,
} from "../diagnostics/types.js";
import type { PersonaId } from "../../convex/engine/types.js";
import {
  computePhase12Metrics,
  type Phase12Payload,
  type Phase12RunInput,
  type Phase12RunStatsRow,
} from "../../convex/reports/phase12.js";

type MatchId = string;

type ClosingClient = {
  query: (ref: unknown, args: unknown) => Promise<unknown>;
  mutation: (ref: unknown, args: unknown) => Promise<unknown>;
};

type MatchStatusRow = {
  status: "pending" | "running" | "completed" | "failed";
  turn: number;
  completedAt: number | null;
  failure?: { turn: number; reason: string } | null;
} | null;

type RunSummaryRow = {
  matchId?: MatchId;
  kills: number;
  extractions: number;
  equips: number;
  speechEvents: number;
  perPersona: Array<{
    personaId: PersonaId;
    survivedTurns?: number;
    kills: number;
    extracted: number;
    equips?: number;
    speechEvents?: number;
  }>;
} | null;

type PersistResult = {
  _id: string;
  existed: boolean;
  payload: Phase12Payload;
};

export type Phase12ClosingArgs = {
  last: number;
  matchIds: MatchId[];
  overwrite: boolean;
  help: boolean;
};

export type Phase12ClosingDeps = {
  client?: ClosingClient;
  makeClient?: () => ClosingClient;
  listMatches?: (client: ClosingClient, last: number) => Promise<MatchId[]>;
  fetchSlimAcross?: (
    client: ClosingClient,
    matchIds: MatchId[],
  ) => Promise<SlimMatchRows[]>;
  readRunByMatch?: (
    client: ClosingClient,
    matchId: MatchId,
  ) => Promise<RunSummaryRow>;
  readMatchStatus?: (
    client: ClosingClient,
    matchId: MatchId,
  ) => Promise<MatchStatusRow>;
  persistReport?: (
    client: ClosingClient,
    args: {
      matchIds: MatchId[];
      payload: Phase12Payload;
      overwrite: boolean;
    },
  ) => Promise<PersistResult>;
  writeStdout?: (text: string) => void;
};

export type Phase12ClosingResult = {
  exitCode: number;
  reportId?: string;
  existed?: boolean;
  payload?: Phase12Payload;
};

const replayListMatches = makeFunctionReference<
  "query",
  { paginationOpts: { numItems: number; cursor: string | null } },
  { page: DiagnosticMatch[] } | DiagnosticMatch[]
>("replay:listMatches");

const turnsByMatchSlim = makeFunctionReference<
  "query",
  { matchId: MatchId },
  SlimMatchRows
>("turns:byMatchSlim");

const runsByMatch = makeFunctionReference<
  "query",
  { matchId: MatchId },
  RunSummaryRow
>("runs:byMatch");

const matchesStatus = makeFunctionReference<
  "query",
  { id: MatchId },
  MatchStatusRow
>("matches:status");

const persistComputedPhase12Report = makeFunctionReference<
  "mutation",
  { matchIds: MatchId[]; payload: Phase12Payload; overwrite?: boolean },
  PersistResult
>("reports/phase12:persistComputedPhase12Report");

export function parsePhase12ClosingArgs(argv: readonly string[]): Phase12ClosingArgs {
  let last = MAX_MATCHES;
  let overwrite = false;
  let help = false;
  const matchIds: MatchId[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--overwrite") {
      overwrite = true;
    } else if (arg === "--last") {
      const next = argv[index + 1];
      if (next === undefined) throw new Error("--last requires a number");
      last = parseLast(next);
      index += 1;
    } else if (arg.startsWith("--last=")) {
      last = parseLast(arg.slice("--last=".length));
    } else if (arg === "--matchIds" || arg === "--match-ids") {
      const next = argv[index + 1];
      if (next === undefined) throw new Error(`${arg} requires a value`);
      matchIds.push(...parseMatchIds(next));
      index += 1;
    } else if (arg.startsWith("--matchIds=")) {
      matchIds.push(...parseMatchIds(arg.slice("--matchIds=".length)));
    } else if (arg.startsWith("--match-ids=")) {
      matchIds.push(...parseMatchIds(arg.slice("--match-ids=".length)));
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown argument: ${arg}`);
    } else {
      matchIds.push(arg);
    }
  }

  return {
    last: clampLast(last),
    matchIds: [...new Set(matchIds)],
    overwrite,
    help,
  };
}

export async function runPhase12ClosingCli(
  argv = process.argv.slice(2),
  deps: Phase12ClosingDeps = {},
): Promise<Phase12ClosingResult> {
  const args = parsePhase12ClosingArgs(argv);
  if (args.help) {
    const usage = [
      "usage: npx tsx harness/closing/phase12.ts [--last N | --matchIds a,b] [--overwrite]",
      "",
      "Explicit positional match ids are also accepted:",
      "  npx tsx harness/closing/phase12.ts <matchId1> <matchId2>",
      "",
    ].join("\n");
    (deps.writeStdout ?? process.stdout.write.bind(process.stdout))(usage);
    return { exitCode: 0 };
  }

  const client =
    deps.client ??
    deps.makeClient?.() ??
    (makeConvexClient() as unknown as ClosingClient);
  const matchIds =
    args.matchIds.length > 0
      ? args.matchIds
      : await (deps.listMatches ?? resolveLastCompletedMatchIds)(
          client,
          args.last,
        );
  if (matchIds.length === 0) {
    throw new Error("No match ids resolved for phase-12 closing report");
  }
  if (matchIds.length > MAX_MATCHES) {
    throw new Error(`Phase 12 closing accepts at most ${MAX_MATCHES} matches`);
  }

  const runs = await buildPhase12RunInputs(client, matchIds, deps);
  const payload = computePhase12Metrics(runs);
  const persisted = await (deps.persistReport ?? persistPhase12Report)(client, {
    matchIds,
    payload,
    overwrite: args.overwrite,
  });

  (deps.writeStdout ?? process.stdout.write.bind(process.stdout))(
    `${JSON.stringify(
      {
        reportId: persisted._id,
        existed: persisted.existed,
        matchIds,
        payload: persisted.payload,
      },
      null,
      2,
    )}\n`,
  );

  return {
    exitCode: 0,
    reportId: persisted._id,
    existed: persisted.existed,
    payload: persisted.payload,
  };
}

async function buildPhase12RunInputs(
  client: ClosingClient,
  matchIds: MatchId[],
  deps: Phase12ClosingDeps,
): Promise<Phase12RunInput[]> {
  const [slimRows, runRows, statuses] = await Promise.all([
    (deps.fetchSlimAcross ?? fetchPhase12SlimAcross)(client, matchIds),
    Promise.all(
      matchIds.map((matchId) =>
        (deps.readRunByMatch ?? readRunByMatch)(client, matchId),
      ),
    ),
    Promise.all(
      matchIds.map((matchId) =>
        (deps.readMatchStatus ?? readMatchStatus)(client, matchId),
      ),
    ),
  ]);

  return matchIds.map((matchId, index) => {
    const turns = slimRows[index];
    if (turns === undefined) {
      throw new Error(`Missing slim rows for match ${matchId}`);
    }
    const status = statuses[index];
    return {
      matchId,
      failed: status?.status === "failed",
      run: adaptRunSummary(runRows[index]),
      turns,
    };
  });
}

async function resolveLastCompletedMatchIds(
  client: ClosingClient,
  last: number,
): Promise<MatchId[]> {
  const result = await client.query(replayListMatches, {
    paginationOpts: { numItems: clampLast(last), cursor: null },
  });
  const page = Array.isArray(result)
    ? result
    : typeof result === "object" &&
        result !== null &&
        "page" in result &&
        Array.isArray((result as { page: unknown }).page)
      ? (result as { page: DiagnosticMatch[] }).page
      : null;
  if (page === null) {
    throw new Error("replay.listMatches returned an unexpected shape");
  }
  return page.map((match) => match._id);
}

async function fetchPhase12SlimAcross(
  client: ClosingClient,
  matchIds: MatchId[],
): Promise<SlimMatchRows[]> {
  try {
    return (await fetchSlimAcross(
      client as Parameters<typeof fetchSlimAcross>[0],
      matchIds,
    )) as SlimMatchRows[];
  } catch (error) {
    if (!isMissingGeneratedByMatchSlim(error)) throw error;
    return Promise.all(
      matchIds.map(async (matchId) => {
        const rows = await client.query(turnsByMatchSlim, { matchId });
        if (!Array.isArray(rows)) {
          throw new Error(`turns.byMatchSlim returned non-array for ${matchId}`);
        }
        return rows as SlimMatchRows;
      }),
    );
  }
}

function isMissingGeneratedByMatchSlim(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    error.message.includes("byMatchSlim")
  );
}

async function readRunByMatch(
  client: ClosingClient,
  matchId: MatchId,
): Promise<RunSummaryRow> {
  return (await client.query(runsByMatch, { matchId })) as RunSummaryRow;
}

async function readMatchStatus(
  client: ClosingClient,
  matchId: MatchId,
): Promise<MatchStatusRow> {
  return (await client.query(matchesStatus, { id: matchId })) as MatchStatusRow;
}

async function persistPhase12Report(
  client: ClosingClient,
  args: {
    matchIds: MatchId[];
    payload: Phase12Payload;
    overwrite: boolean;
  },
): Promise<PersistResult> {
  return (await client.mutation(persistComputedPhase12Report, {
    matchIds: args.matchIds,
    payload: args.payload,
    overwrite: args.overwrite,
  })) as PersistResult;
}

function adaptRunSummary(
  row: RunSummaryRow | undefined,
): Phase12RunStatsRow | null {
  if (row === undefined || row === null) return null;
  return {
    extractions: row.extractions,
    kills: row.kills,
    equips: row.equips,
    speechEvents: row.speechEvents,
    perPersona: row.perPersona.map((persona) => ({
      personaId: persona.personaId,
      kills: persona.kills,
      extracted: persona.extracted,
    })),
  };
}

function parseLast(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || String(parsed) !== raw.trim()) {
    throw new Error(`--last must be an integer, got ${raw}`);
  }
  return parsed;
}

function parseMatchIds(raw: string): MatchId[] {
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function clampLast(last: number): number {
  if (last < 1) return 1;
  if (last > MAX_MATCHES) return MAX_MATCHES;
  return last;
}

function isMain(): boolean {
  return process.argv[1] === fileURLToPath(import.meta.url);
}

if (isMain()) {
  try {
    const result = await runPhase12ClosingCli();
    process.exitCode = result.exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
