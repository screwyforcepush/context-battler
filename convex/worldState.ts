import { v } from "convex/values";
import { query } from "./_generated/server.js";
import type { Tile, Wall } from "./engine/types.js";

type DynamicWorldStateRow = {
  matchId: unknown;
  crates: unknown[];
  airdrops: unknown[];
  corpses: unknown[];
  evac: unknown;
};

type StaticWorldStateRow = {
  matchId: unknown;
  walls: Wall[];
  coverClusters: Wall[];
  coverTiles: Tile[];
};

export function mergeWorldStateRows<
  DynamicRow extends DynamicWorldStateRow,
  StaticRow extends StaticWorldStateRow,
>(
  dynamicRow: DynamicRow | null,
  staticRow: StaticRow | null,
  matchIdForError: string,
): (StaticRow & DynamicRow) | null {
  if (dynamicRow === null) return null;
  if (staticRow === null) {
    throw new Error(`Missing worldStatic row for match ${matchIdForError}`);
  }
  return {
    ...staticRow,
    ...dynamicRow,
    walls: staticRow.walls,
    coverClusters: staticRow.coverClusters,
    coverTiles: staticRow.coverTiles,
  };
}

export const byMatchId = query({
  args: { matchId: v.id("matches") },
  handler: async (ctx, { matchId }) => {
    const [dynamicRows, staticRow] = await Promise.all([
      ctx.db
        .query("worldState")
        .filter((q) => q.eq(q.field("matchId"), matchId))
        .collect(),
      ctx.db
        .query("worldStatic")
        .withIndex("by_match", (q) => q.eq("matchId", matchId))
        .unique(),
    ]);
    return mergeWorldStateRows(
      dynamicRows[0] ?? null,
      staticRow,
      String(matchId),
    );
  },
});
