// WP5 — last-known position tracking.
//
// Pure-function module per ADR §1; no Convex imports. Concept-spec §7
// ("Last-known and heard states") describes this as paranoia-without-
// omniscience: an observer remembers where it last saw each enemy, even
// after the enemy leaves vision.
//
// ADR §6 locks the cap: 3 most-recent entries per observer, oldest-first
// eviction. The cap exists because phase 1 input budget is tight (WP8
// caps the digest at ~1 200 input tokens) and historical positions decay
// in tactical value fast.

import type { LastKnownEntry, VisibleEntity } from "./types.js";

/** Cap on the number of last-known entries per observer. ADR §6. */
const LAST_KNOWN_CAP = 3;

/**
 * Pure update: given the previous `lastKnown` list, the observer's current
 * visible entities, and the current turn number, return the next
 * `lastKnown` list.
 *
 * Algorithm:
 *  1. Start with `prev` as a working copy.
 *  2. For each visible *character* entity, upsert
 *     `{ characterId, pos, atTurn: currentTurn }` (replace any existing
 *     entry with the same characterId).
 *  3. If the resulting list exceeds the cap, sort ascending by `atTurn`
 *     and drop the head until size ≤ cap (oldest-first eviction).
 *  4. Return the new list.
 *
 * Pure: same `prev` + same `visible` + same `currentTurn` → same output.
 * Non-character visible entities (crates, corpses, cover, walls) are
 * ignored — `lastKnown` is the *enemy memory* layer, not generic terrain
 * memory.
 */
export function updateLastKnown(
  prev: readonly LastKnownEntry[],
  visible: readonly VisibleEntity[],
  currentTurn: number,
): LastKnownEntry[] {
  // Working copy — never mutate `prev` (callers pass arrays from Convex
  // documents, which are read-only by convention).
  const working: LastKnownEntry[] = prev.map((e) => ({
    characterId: e.characterId,
    pos: { x: e.pos.x, y: e.pos.y },
    atTurn: e.atTurn,
  }));

  for (const v of visible) {
    if (v.kind !== "character") continue;
    const idx = working.findIndex((e) => e.characterId === v.characterId);
    const entry: LastKnownEntry = {
      characterId: v.characterId,
      pos: { x: v.pos.x, y: v.pos.y },
      atTurn: currentTurn,
    };
    if (idx >= 0) working[idx] = entry;
    else working.push(entry);
  }

  if (working.length <= LAST_KNOWN_CAP) return working;

  // Oldest-first eviction: sort ascending by atTurn, slice to cap from
  // the tail (newest end). Stable sort preserves observation order on
  // ties (which can happen if multiple entries were upserted at the
  // same `currentTurn`).
  working.sort((a, b) => a.atTurn - b.atTurn);
  return working.slice(working.length - LAST_KNOWN_CAP);
}
