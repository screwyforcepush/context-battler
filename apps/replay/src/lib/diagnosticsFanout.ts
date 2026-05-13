import { api } from "../../../../convex/_generated/api";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";
import type {
  SlimMatchRows,
  SlimTurnRow,
} from "../../../../harness/diagnostics/types";
import { clampDiagnosticsLast } from "./useHashRoute";

export type CompletedMatch = Doc<"matches">;

type ListMatchesArgs = {
  paginationOpts: {
    numItems: number;
    cursor: string | null;
  };
};

type ByMatchSlimArgs = {
  matchId: Id<"matches">;
};

export type DiagnosticsQueryClient = {
  query(
    ref: typeof api.replay.listMatches,
    args: ListMatchesArgs,
  ): Promise<unknown>;
  query(
    ref: typeof api.turns.byMatchSlim,
    args: ByMatchSlimArgs,
  ): Promise<unknown>;
};

export type DiagnosticsDashboardData = {
  matches: CompletedMatch[];
  matchRows: SlimMatchRows[];
  rows: SlimTurnRow[];
};

export async function fetchDiagnosticsDashboardData(
  client: DiagnosticsQueryClient,
  last: number,
): Promise<DiagnosticsDashboardData> {
  const matches = await fetchLastCompletedMatches(client, last);
  const matchRows = await fetchSlimAcross(
    client,
    matches.map((match) => match._id),
  );
  return {
    matches,
    matchRows,
    rows: matchRows.flat(),
  };
}

export async function fetchLastCompletedMatches(
  client: DiagnosticsQueryClient,
  last: number,
): Promise<CompletedMatch[]> {
  const result = await client.query(api.replay.listMatches, {
    paginationOpts: {
      numItems: clampDiagnosticsLast(last),
      cursor: null,
    },
  });
  return normaliseListMatches(result);
}

export async function fetchSlimAcross(
  client: DiagnosticsQueryClient,
  matchIds: readonly string[],
): Promise<SlimMatchRows[]> {
  return Promise.all(
    matchIds.map(async (matchId) => {
      const result = await client.query(api.turns.byMatchSlim, {
        matchId: matchId as Id<"matches">,
      });
      if (!Array.isArray(result)) {
        throw new Error(`turns.byMatchSlim returned non-array for ${matchId}`);
      }
      return result as SlimMatchRows;
    }),
  );
}

function normaliseListMatches(result: unknown): CompletedMatch[] {
  if (Array.isArray(result)) return result as CompletedMatch[];
  if (
    typeof result === "object" &&
    result !== null &&
    "page" in result &&
    Array.isArray((result as { page: unknown }).page)
  ) {
    return (result as { page: CompletedMatch[] }).page;
  }
  throw new Error("replay.listMatches returned an unexpected shape");
}
