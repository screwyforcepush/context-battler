// WP5 — hiding state transitions.
//
// Pure-function module per ADR §1; no Convex imports. Concept-spec §7 locks
// the reveal-causes for an agent in cover:
//
//   "An agent in cover is hidden unless revealed by proximity, attacking,
//    speaking, looting, using a consumable, leaving cover, or other reveal
//    conditions."
//
//   "Hidden in cover unless enemy is within 2 tiles or the hidden agent
//    performs a revealing action."
//
// This module exports three pure helpers consumed by the WP7 resolver:
//   - `isInCover(world, pos)` — does the tile match any cover tile?
//   - `enemyWithinTwo(state, characterId)` — Chebyshev-2 proximity check.
//   - `computeHidingTransitions(state, characterId, action)` — given a
//      reveal-causing action, return `{ hidden: false, revealedBy }`.
//
// The function is pure-mapping: it does not consult `state.characters[i].
// hidden` to decide; the caller (WP7's resolver) only invokes it when a
// reveal *might* fire. The function's job is to map (cause) → (revealedBy
// label) consistently. The "no reveal cause" path is the resolver's job —
// the agent simply stays hidden.

import { chebyshev } from "./distance.js";
import type { MatchState, Tile, WorldState } from "./types.js";

/** Reveal cause labels per concept-spec §7. Mirrors the
 *  `revealedBy` validator in `convex/schema.ts` (WP2). */
export type RevealCause =
  | "attack"
  | "loot"
  | "speech"
  | "consumable"
  | "leaving_cover"
  | "proximity";

export type HidingAction = { kind: RevealCause };

/** True iff `pos` is one of the world's cover tiles. */
export function isInCover(world: WorldState, pos: Tile): boolean {
  for (const tile of world.coverTiles) {
    if (tile.x === pos.x && tile.y === pos.y) return true;
  }
  return false;
}

/**
 * True iff any other living character is at Chebyshev distance ≤ 2 from
 * the named character's current position.
 *
 * Used by the resolver to detect the §7 proximity reveal trigger; also
 * exposed for unit-testability.
 */
export function enemyWithinTwo(
  state: MatchState,
  characterId: string,
): boolean {
  const me = state.characters.find((c) => c.characterId === characterId);
  if (!me) return false;
  for (const other of state.characters) {
    if (other.characterId === characterId) continue;
    if (!other.alive) continue;
    if (chebyshev(me.pos, other.pos) <= 2) return true;
  }
  return false;
}

/**
 * Compute the hiding transition for the named character given a reveal-
 * causing action. Returns `{ hidden: false, revealedBy: <cause> }` for any
 * recognised cause; the cause label feeds straight into the resolver
 * trace's `visibilityUpdates[].revealedBy` field per ADR §6.
 *
 * The resolver only calls this fn when the agent took an action from the
 * §7 reveal-cause list. "Stay still in cover, take no action" never
 * invokes this fn — the agent's hidden flag is left as-is by the caller.
 */
export function computeHidingTransitions(
  _state: MatchState,
  _characterId: string,
  action: HidingAction,
): { hidden: false; revealedBy: RevealCause } {
  return { hidden: false, revealedBy: action.kind };
}
