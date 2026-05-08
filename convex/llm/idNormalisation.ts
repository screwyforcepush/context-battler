// Phase-3 WP-F.2 — character target id normalisation at the validator
// boundary.
//
// Per North Star §1 (locked design decision #1) and the system prompt
// (`convex/llm/systemPrompt.ts:64-71`), the agent acts on `Visible.id` —
// typed display ids of the form `Player_N`. The validator + resolver,
// however, historically compared a decision target against
// `CharacterState.characterId`, which in production is a Convex opaque
// `_id` value (`convex/runMatch.ts:200` binds `characterId = c._id`).
// That mismatch rejected every Player_N attack / move-toward target out
// of the gate as "not a living character", driving the closing-10
// `fellBackToSafeDefault` rate well past the ≤10% threshold.
//
// This helper bridges the two id spaces at the validator boundary: a
// single normalisation point, then engine-id flows through. Mirrors the
// pattern of `normaliseChestTargetId` in `convex/engine/movement.ts` —
// returns the engine-side identifier (or null when the input does not
// resolve), so callers replace their direct `c.characterId === targetId`
// comparisons with "normalise → look up → compare".
//
// Strategy:
//   1. If `targetId` exactly matches a character's engine `characterId`,
//      return it unchanged (test-fixture path; production agents act on
//      the displayName so they do not hit this branch).
//   2. Otherwise, if `targetId` matches a character's `displayName`
//      (e.g. "Player_3"), return that character's engine `characterId`.
//   3. Otherwise return null. The caller treats null as "target not a
//      known character" and emits the existing failure / no_target
//      reason — closing-10 reports key off those reason strings, so
//      preserving the wording matters.

/**
 * Normalise a character target id emitted by the LLM into its engine
 * `characterId`. Returns null when the id does not match any character
 * in `characters` (live-or-dead — liveness is the caller's check).
 *
 * The check matches `characterId` first to keep test fixtures working
 * (test characters are typically created with `characterId === "A"` etc.
 * rather than a real Convex Id), then falls back to `displayName` so
 * production Player_N literals from the LLM resolve to the engine id.
 */
export function normaliseCharacterTargetId(
  targetId: string,
  characters: ReadonlyArray<{ characterId: string; displayName: string }>,
): string | null {
  if (!targetId) return null;
  const byId = characters.find((c) => c.characterId === targetId);
  if (byId) return byId.characterId;
  const byName = characters.find((c) => c.displayName === targetId);
  if (byName) return byName.characterId;
  return null;
}
