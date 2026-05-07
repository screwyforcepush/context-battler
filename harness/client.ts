// WP11 — Convex client wrapper for the harness CLI.
//
// Per ADR §3 the CLI is a thin orchestrator + waiter. It connects to Convex
// over HTTP (NOT a WebSocket) because:
//   - HTTP is request/response, which matches the harness's polling model.
//   - It avoids the long-lived subscription bookkeeping ConvexClient implies.
//   - `ConvexHttpClient` is documented as the right choice for non-reactive
//     Node tools (see `node_modules/convex/dist/esm-types/browser/index.d.ts`).
//
// `CONVEX_URL` is read from the local `.env` file (see
// `docs/project/guides/convex-backend.md` §1). `CONVEX_DEPLOY_KEY` is *not*
// needed for invoking public functions — phase 1 has no auth gate, so the
// URL alone is sufficient. Re-loading is idempotent.
//
// Boundary contract: this module exposes ONLY a typed factory. It does not
// own any per-run state — every call site constructs / receives a single
// client instance and threads it through.

import "dotenv/config";
import { ConvexHttpClient } from "convex/browser";

/**
 * Build a ConvexHttpClient from the local `CONVEX_URL` env var.
 *
 * Throws (and exits the harness, by virtue of the unhandled rejection) if
 * `CONVEX_URL` is missing — fail-loud per ADR §8 ("explicitness over silent
 * default"). The URL shape is validated by ConvexHttpClient itself.
 */
export function makeConvexClient(): ConvexHttpClient {
  const url = process.env.CONVEX_URL;
  if (!url || url.length === 0) {
    throw new Error(
      "CONVEX_URL is not set. Add it to .env (see docs/project/guides/convex-backend.md §1).",
    );
  }
  return new ConvexHttpClient(url);
}
