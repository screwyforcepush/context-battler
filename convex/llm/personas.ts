// WP9 — persona prompt loader.
//
// Convex bundles only the `convex/` directory; the canonical persona files
// at `personas/<id>.md` are NOT shipped with the deployment. We therefore
// embed the trimmed bodies in `convex/_data/personas.ts` (the derived
// bundle) and return them here. The .md files remain the canonical
// authoring surface — the WP15 tuning loop edits the .md (then re-runs the
// regen step) or edits the inline file directly.
//
// Returns a typed `Record<PersonaId, string>` keyed by the locked
// kebab-case literal union from `convex/engine/types.ts` (ADR §6).
//
// Why a function (not a top-level cached constant):
//   - WP15's tuning loop edits persona BODIES across iterations. Convex
//     actions resolve fresh on every invocation, so a top-level singleton
//     would prevent hot-edits during tuning without a redeploy.
//   - Trace introspection (ADR §7) captures `personaPromptText` per turn
//     row anyway — the cost of cloning the 8-entry record at each match
//     start is negligible vs. the auditability win.
//
// Boundary (ADR §1): pure-function module; no Convex imports, no
// `convex/_generated/` access, no `fetch`. With fs gone the module no
// longer needs the node runtime — there is no `"use node";` directive,
// which means default-runtime Convex queries/mutations could import this
// in the future without bundler complaints.
//
// Cross-references:
//   - ADR §6 — locks `PersonaId` and `PERSONA_IDS`.
//   - ADR §7 — `agentRecords[].input.personaPromptText` is the live text
//     this loader returns; the trace persists it per-turn so post-edit
//     auditability holds.
//   - work-packages.md WP9 — locked filenames, ≤ 80-token budget per body
//     (asserted by `tests/llm/personas.test.ts`), trimmed strings.

import { PERSONAS_INLINE } from "../_data/personas.js";
import type { PersonaId } from "../engine/types.js";

/**
 * Return the 8 persona prompt strings keyed by `PersonaId`. Each value is
 * the corresponding markdown body trimmed of leading/trailing whitespace
 * (the inline-data module is the trimmed form by construction).
 *
 * Determinism: the inline record's iteration order matches `PERSONA_IDS`
 * (ADR §6); WP10 hashes the returned strings as `personaPromptHash` per
 * the trace contract (ADR §7), so the trim is load-bearing — a stray
 * trailing newline must not perturb the hash.
 *
 * We return a shallow clone so callers cannot mutate the shared inline
 * record (the mutation contract callers used to get from `readFileSync`
 * was a fresh string per call; preserve that semantic).
 */
export function loadPersonas(): Record<PersonaId, string> {
  // Inline-bundled per Convex deployment: personas/*.md is not part of
  // the convex/ bundle, so we embed the trimmed text in convex/_data/personas.ts.
  // The tests still assert on these strings; tuning loop edits the inline file
  // (or the .md source then runs the regenerator).
  return { ...PERSONAS_INLINE };
}
