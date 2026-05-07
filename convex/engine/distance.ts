// WP5 — Chebyshev distance.
//
// Pure-function module per ADR §1; no Convex imports. The engine's distance
// model is **Chebyshev (king-move)** per concept-spec §4 — a tile 7 east
// and 3 north is at distance 7. Used for movement, vision, attack range,
// interact range, and turns-to-evac estimates.

import type { Tile } from "./types.js";

/**
 * Chebyshev (king-move) distance between two tiles.
 *
 * `max(|a.x - b.x|, |a.y - b.y|)` — corresponds to the minimum number of
 * 8-directional king moves needed to traverse from `a` to `b` on an
 * unobstructed grid.
 *
 * Symmetric: `chebyshev(a, b) === chebyshev(b, a)` for any a, b.
 */
export function chebyshev(a: Tile, b: Tile): number {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return dx > dy ? dx : dy;
}
