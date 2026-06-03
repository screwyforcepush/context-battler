// Phase 02 / WP-A — Hash-route parser + React hook.
//
// Two-route SPA, no router library (per architecture-decisions.md §6 — a
// router for two routes is overhead). The hook is a thin wrapper around
// `parseHash`; the parser itself is exported separately so the unit tests
// in `__tests__/useHashRoute.test.ts` can pin the contract without
// mounting React.
//
// Contract:
//
//   #/                      → { kind: "picker" }
//   #/match/<id>            → { kind: "replay", matchId, turn: null }
//   #/match/<id>?turn=N     → { kind: "replay", matchId, turn: N >= 0 }
//   #/match/<id>?turn=N&character=<displayName>
//                           → { kind: "replay", matchId, turn, character }
//   #/diagnostics?last=N    → { kind: "diagnostics", last: clamp(N, 1, 20) }
//   anything malformed      → { kind: "picker" } (graceful fallback)
//
// The parser is defensive against:
//   - missing leading `#` (browser sometimes strips it on direct navigation)
//   - non-numeric `?turn=` values
//   - negative `?turn=` values (slider range is `0..match.turn`)
//   - empty matchId after `/match/`

import { useEffect, useState } from "react";

export type HashRoute =
  | { kind: "picker" }
  | { kind: "diagnostics"; last: number }
  | { kind: "cards" }
  | {
      kind: "replay";
      matchId: string;
      turn: number | null;
      character: string | null;
    };

const PICKER: HashRoute = { kind: "picker" };
const DEFAULT_DIAGNOSTICS_LAST = 20;
const MAX_DIAGNOSTICS_LAST = 20;

/**
 * Pure parser: hash string → typed route.
 *
 * Exported for direct unit testing. Production callers should use the
 * `useHashRoute()` hook instead, which wraps this with a `useState` +
 * `hashchange` listener.
 */
export function parseHash(rawHash: string): HashRoute {
  // Empty hash → picker. `window.location.hash` is `""` when there is no
  // fragment, so this is the common cold-load case.
  if (rawHash === "") return PICKER;

  // Anything that doesn't start with `#` is malformed input (a pathname
  // got passed in by a confused caller). Browser-supplied hashes always
  // start with `#`; reject the rest to keep the contract narrow.
  if (!rawHash.startsWith("#")) return PICKER;
  const hash = rawHash.slice(1);

  // `#/` and `#` collapse to picker.
  if (hash === "" || hash === "/") return PICKER;

  // Split path and query at the first `?`.
  const qIndex = hash.indexOf("?");
  const path = qIndex === -1 ? hash : hash.slice(0, qIndex);
  const queryString = qIndex === -1 ? "" : hash.slice(qIndex + 1);
  const params = new URLSearchParams(queryString);

  if (path === "/diagnostics") {
    return {
      kind: "diagnostics",
      last: parseDiagnosticsLast(params.get("last")),
    };
  }

  if (path === "/cards") {
    return { kind: "cards" };
  }

  // Only the `/match/<id>[?turn=N]` shape is recognised. Everything else
  // falls back to the picker — that's the v0 contract.
  if (!path.startsWith("/match/")) return PICKER;

  // path is `/match/<id>` — slice off the prefix and validate non-empty.
  const rawMatchId = path.slice("/match/".length);
  const matchId = safeDecodeURIComponent(rawMatchId);
  if (matchId.length === 0) return PICKER;
  // Reject ids that contain a path separator — that means the URL had
  // extra segments (e.g. `#/match/abc/def`), which is malformed.
  if (matchId.includes("/")) return PICKER;

  // Parse `?turn=N` if present.
  let turn: number | null = null;
  if (queryString.length > 0) {
    const raw = params.get("turn");
    if (raw !== null && raw.length > 0) {
      // Only accept non-negative integers. `Number.parseInt` is permissive
      // (`"5x"` parses as 5), so we double-check with a regex first.
      if (/^\d+$/.test(raw)) {
        const parsed = Number.parseInt(raw, 10);
        if (Number.isFinite(parsed) && parsed >= 0) {
          turn = parsed;
        }
      }
    }
  }

  const rawCharacter = params.get("character");
  const character =
    rawCharacter !== null && rawCharacter.trim().length > 0
      ? rawCharacter.trim()
      : null;

  return { kind: "replay", matchId, turn, character };
}

export function clampDiagnosticsLast(last: number): number {
  if (!Number.isFinite(last)) return DEFAULT_DIAGNOSTICS_LAST;
  return Math.max(1, Math.min(MAX_DIAGNOSTICS_LAST, Math.trunc(last)));
}

function parseDiagnosticsLast(raw: string | null): number {
  if (raw === null || raw.length === 0 || !/^\d+$/.test(raw)) {
    return DEFAULT_DIAGNOSTICS_LAST;
  }
  return clampDiagnosticsLast(Number.parseInt(raw, 10));
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * React hook — re-parses on every `hashchange` event.
 *
 * SSR is not a concern (this is a Vite SPA); the lazy `useState` initialiser
 * reads `window.location.hash` directly on first mount.
 */
export function useHashRoute(): HashRoute {
  const [route, setRoute] = useState<HashRoute>(() =>
    parseHash(typeof window === "undefined" ? "" : window.location.hash),
  );

  useEffect(() => {
    const onHashChange = () => {
      setRoute(parseHash(window.location.hash));
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return route;
}
