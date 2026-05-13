import type { Id } from "../../convex/_generated/dataModel.js";
import { api } from "../../convex/_generated/api.js";
import type { FunctionReturnType } from "convex/server";

type ByMatchSlimRef = typeof api.turns.byMatchSlim;
export type ByMatchSlimResult = FunctionReturnType<ByMatchSlimRef>;

export type SlimFanoutClient<Result = ByMatchSlimResult> = {
  query: (
    ref: ByMatchSlimRef,
    args: { matchId: Id<"matches"> },
  ) => Promise<Result>;
};

export async function fetchSlimAcross<Result = ByMatchSlimResult>(
  client: SlimFanoutClient<Result>,
  matchIds: readonly string[],
): Promise<Result[]> {
  return Promise.all(
    matchIds.map((matchId) =>
      client.query(api.turns.byMatchSlim, {
        matchId: matchId as Id<"matches">,
      }),
    ),
  );
}
