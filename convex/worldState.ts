import { v } from "convex/values";
import { query } from "./_generated/server.js";

export const byMatchId = query({
  args: { matchId: v.id("matches") },
  handler: async (ctx, { matchId }) => {
    const rows = await ctx.db
      .query("worldState")
      .filter((q) => q.eq(q.field("matchId"), matchId))
      .collect();
    return rows[0] ?? null;
  },
});
