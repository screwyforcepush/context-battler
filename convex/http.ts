import { httpRouter } from "convex/server";
import type { Id } from "./_generated/dataModel.js";
import type { ActionCtx } from "./_generated/server.js";
import { httpAction } from "./_generated/server.js";
import { api } from "./_generated/api.js";
import { getMapDescriptor } from "./engine/map.js";
import {
  buildMatchSnapshot,
  summariseJoinedMatch,
} from "./replay/snapshot.js";
import type { ReplayBundle } from "./replay/reconstruct.js";
import type { MatchWithCharacters } from "./replay/snapshotTypes.js";

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

type ReplayHttpCtx = Pick<ActionCtx, "runQuery">;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

export async function handleListMatches(ctx: ReplayHttpCtx): Promise<Response> {
  const rows = (await ctx.runQuery(api.replay.listMatchesWithCharacters, {
    paginationOpts: { numItems: 100, cursor: null },
  })) as MatchWithCharacters[];
  return json(rows.map(summariseJoinedMatch));
}

export async function handleExportMatch(
  ctx: ReplayHttpCtx,
  req: Request,
): Promise<Response> {
  const matchId = new URL(req.url).searchParams.get("matchId");
  if (!matchId) return json({ error: "missing_match_id" }, 400);

  let bundle;
  try {
    bundle = (await ctx.runQuery(api.replay.getReplayBundle, {
      matchId: matchId as Id<"matches">,
    })) as ReplayBundle | null;
  } catch {
    return json({ error: "bad_match_id" }, 400);
  }

  if (!bundle) return json({ error: "not_found" }, 404);
  if (bundle.match.status !== "completed") {
    return json(
      { error: "match_not_completed", status: bundle.match.status },
      409,
    );
  }

  const mapDescriptor = getMapDescriptor(bundle.match.mapId);
  return json(buildMatchSnapshot(bundle, mapDescriptor));
}

const http = httpRouter();

http.route({
  path: "/replay/listMatches",
  method: "GET",
  handler: httpAction(async (ctx) => handleListMatches(ctx)),
});

http.route({
  path: "/replay/exportMatch",
  method: "GET",
  handler: httpAction(async (ctx, req) => handleExportMatch(ctx, req)),
});

http.route({
  path: "/replay/listMatches",
  method: "OPTIONS",
  handler: httpAction(async () => preflight()),
});

http.route({
  path: "/replay/exportMatch",
  method: "OPTIONS",
  handler: httpAction(async () => preflight()),
});

export { http as httpRouter };
export default http;
