// WP1 Bootstrap Checklist B (de-risking.md) — proves the env-var write path:
// after `npx convex env set AZURE_API_KEY ...`, an action running in the
// deployment must be able to read the value at runtime.
//
// Returns the first 4 chars of `process.env.AZURE_API_KEY`, or "MISSING".
// Never returns the full key — keep secrets out of CLI output.
//
// Note (WP1 deviation): Convex CLI's `npx convex run` cannot directly invoke
// `internalAction`s. To satisfy the WP1 acceptance bullet
// (`npx convex run spike:checkEnv` returns the first 4 chars), we expose
// `checkEnv` as a public `action`. This action does no I/O, takes no args,
// and only reads its own env — it is safe to keep public for the spike but
// can be removed (or downgraded to `internalAction`) once WP2 ships.
import { action, mutation } from "./_generated/server.js";
import { v } from "convex/values";

export const checkEnv = action({
  args: {},
  returns: v.string(),
  handler: async () => {
    const key = process.env.AZURE_API_KEY;
    return key ? key.slice(0, 4) : "MISSING";
  },
});

// ─── Phase-3 WP-A.3 — POC dev-data wipe ─────────────────────────────────────
//
// One-shot wipe mutation used to clear historical rows that pre-date the
// phase-3 schema break. Schema validators in `convex/schema.ts` reject
// every legacy row (interact arms, overwatch_priority, no reasoning
// field), so `npx convex dev` push fails until this runs.
//
// POC posture per project memory `project_poc_schema_wipe_acceptable`:
// schema wipe is acceptable; no migration shims. After phase-3 closes,
// this mutation can stay (idempotent — no rows means no-op) or be
// removed at WP-E close.
//
// Invoke with: `npx convex run spike:wipeOneTable '{"table":"turns"}'` etc.
// (Wiping all tables in one call hits the 16 MB single-execution byte
// budget on the `turns` table alone after a phase-1 closing-50 run; we
// chunk per-table and let the caller loop the small ones at the end.)
type WipeTable =
  | "prompts"
  | "cards"
  | "cardAccruals"
  | "turns"
  | "characters"
  | "matches"
  | "worldStatic"
  | "worldState"
  | "runs"
  | "reports";

const WIPE_PAGE_SIZE = 64;

export const wipeOneTable = mutation({
  args: {
    table: v.union(
      v.literal("turns"),
      v.literal("characters"),
      v.literal("matches"),
      v.literal("prompts"),
      v.literal("cards"),
      v.literal("cardAccruals"),
      v.literal("worldStatic"),
      v.literal("worldState"),
      v.literal("runs"),
      v.literal("reports"),
    ),
  },
  returns: v.object({
    deleted: v.number(),
    moreToGo: v.boolean(),
  }),
  handler: async (ctx, { table }) => {
    // `take(N)` bounds the read budget so we never blow the 16 MB cap
    // on a single function execution (turns rows are large).
    const rows = await ctx.db
      .query(table as WipeTable)
      .take(WIPE_PAGE_SIZE);
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    return { deleted: rows.length, moreToGo: rows.length === WIPE_PAGE_SIZE };
  },
});

// ─── Phase-3 WP-A.3 — smoke roundtrip helpers ───────────────────────────────
//
// Minimal mutations to prove the new schema accepts a write and reads back
// cleanly post-wipe. Used after the schema push to satisfy WP-A.3
// acceptance ("one smoke `convex run` mutation creates a `matches` row
// with the new shape and reads it back").

export const smokeCreateMatch = mutation({
  args: {},
  returns: v.id("matches"),
  handler: async (ctx) => {
    const id = await ctx.db.insert("matches", {
      status: "pending",
      turn: 0,
      startedAt: Date.now(),
      completedAt: null,
      mapId: "reference",
      rngSeed: "smoke-seed",
      reasoningEffort: "low",
      outcome: { extracted: [], pointsByCharacter: [] },
    });
    return id;
  },
});
