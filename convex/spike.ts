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
import { action } from "./_generated/server.js";
import { v } from "convex/values";

export const checkEnv = action({
  args: {},
  returns: v.string(),
  handler: async () => {
    const key = process.env.AZURE_API_KEY;
    return key ? key.slice(0, 4) : "MISSING";
  },
});
