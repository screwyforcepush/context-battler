// WP5 — vision (line-of-sight + visible-entity computation).
//
// Pure-function module per ADR §1; no Convex imports. Concept-spec §7 locks:
//  - 20-tile vision cap (Chebyshev).
//  - Walls block line-of-sight (cover does NOT — cover affects hiding state,
//    not whether the looker can see through it).
//  - Hidden characters are excluded from the visible list.
//  - HP is bucketed (low/mid/high) per the thresholds documented below to
//    keep the digest terse and discourage models doing arithmetic on a
//    number the engine doesn't promise to keep stable.
//
// Algorithm: classic Bresenham line. For each tile *between* `from` and
// `to` (exclusive of endpoints), if the tile is inside any wall rectangle
// in `world.walls`, LOS is blocked. The Bresenham loop terminates early
// on the first wall-tile match.
//
// Visible-entity caps: cover tiles are capped at 12 closest to the observer
// to keep the digest small (WP8 also caps at 8 visible-entities total, so
// the engine's pre-cap here is a safety net, not the primary control).

import { chebyshev } from "./distance.js";
import type {
  CharacterState,
  MatchState,
  Tile,
  VisibleEntity,
  Wall,
  WorldState,
} from "./types.js";

/** Vision range in tiles, per concept-spec §4. */
const VISION_RANGE = 20;

/** Cover-tile cap for the visible list. WP8's digest caps total entities
 *  at 8; this is a pre-cap so the visible list doesn't blow up before WP8
 *  applies its own cap. Documented in the vision module head-note. */
const COVER_TILE_CAP = 12;

// ─── Wall-rectangle helpers ────────────────────────────────────────────────

function tileInWall(x: number, y: number, wall: Wall): boolean {
  return (
    x >= wall.x &&
    x < wall.x + wall.w &&
    y >= wall.y &&
    y < wall.y + wall.h
  );
}

function tileInAnyWall(x: number, y: number, walls: readonly Wall[]): boolean {
  for (const w of walls) {
    if (tileInWall(x, y, w)) return true;
  }
  return false;
}

// ─── Bresenham line tracer ─────────────────────────────────────────────────

/**
 * Yield every tile along the Bresenham line from `from` to `to`, INCLUDING
 * the endpoints. Caller filters endpoints out for LOS purposes. Standard
 * integer-only Bresenham (no floating-point error accumulation).
 */
function* bresenhamLine(from: Tile, to: Tile): Generator<Tile> {
  let x0 = from.x;
  let y0 = from.y;
  const x1 = to.x;
  const y1 = to.y;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  while (true) {
    yield { x: x0, y: y0 };
    if (x0 === x1 && y0 === y1) return;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
}

/**
 * True iff there is unobstructed line-of-sight from `from` to `to`.
 *
 * "Unobstructed" means: no tile *between* `from` and `to` (exclusive of
 * both endpoints) sits inside any wall rectangle in `world.walls`. Cover
 * tiles do not block LOS — they affect hiding only.
 *
 * Algorithm: Bresenham line from `from` to `to`, terminate early on the
 * first wall-tile match. Endpoints are never themselves blockers — the
 * caller decides what to do if the target is on a wall (which shouldn't
 * happen in v0 since walls block movement, so no character ever stands on
 * one).
 */
export function hasLineOfSight(
  world: WorldState,
  from: Tile,
  to: Tile,
): boolean {
  if (from.x === to.x && from.y === to.y) return true;
  let first = true;
  for (const tile of bresenhamLine(from, to)) {
    // Skip the start endpoint. We must also skip the final endpoint —
    // that's the target itself, never a "between" tile. Track via a
    // peek-ahead: emit each tile but only test the ones strictly between.
    if (first) {
      first = false;
      continue;
    }
    if (tile.x === to.x && tile.y === to.y) return true;
    if (tileInAnyWall(tile.x, tile.y, world.walls)) return false;
  }
  return true;
}

// ─── HP bucket ─────────────────────────────────────────────────────────────

/**
 * HP bucket per WP5 brief: `low` if `hp/maxHp <= 0.33`, `mid` if `<= 0.66`,
 * else `high`. Bucketing (rather than exact HP) keeps the digest terse and
 * lets the engine evolve HP scaling without invalidating prompts that
 * depend on ratios.
 */
function hpBucket(hp: number, maxHp: number): "low" | "mid" | "high" {
  if (maxHp <= 0) return "low";
  const ratio = hp / maxHp;
  if (ratio <= 0.33) return "low";
  if (ratio <= 0.66) return "mid";
  return "high";
}

// ─── computeVisibleEntities ───────────────────────────────────────────────

/**
 * Return the set of visible entities for `observerId` in `state`.
 *
 * Inclusions:
 *  - Other living, non-hidden characters within Chebyshev 20 with LOS.
 *  - Chests within Chebyshev 20 with LOS.
 *  - Corpses within Chebyshev 20 with LOS.
 *  - Cover tiles within Chebyshev 20 with LOS, capped at 12 closest.
 *
 * Walls are not emitted as visible entities — WP8's digest will mention
 * them only if a future iteration adds an explicit "wall blocks LOS east"
 * affordance. For now the wall data is consumed implicitly via the LOS
 * check.
 */
export function computeVisibleEntities(
  state: MatchState,
  observerId: string,
): { visible: VisibleEntity[] } {
  const observer = state.characters.find(
    (c) => c.characterId === observerId,
  );
  if (!observer) return { visible: [] };

  const visible: VisibleEntity[] = [];

  // Other characters.
  for (const other of state.characters) {
    if (other.characterId === observerId) continue;
    if (!other.alive) continue;
    if (other.hidden) continue;
    if (chebyshev(observer.pos, other.pos) > VISION_RANGE) continue;
    if (!hasLineOfSight(state.world, observer.pos, other.pos)) continue;
    const entry = makeCharacterVisible(other);
    visible.push(entry);
  }

  // Chests.
  for (const chest of state.world.chests) {
    if (chebyshev(observer.pos, chest.pos) > VISION_RANGE) continue;
    if (!hasLineOfSight(state.world, observer.pos, chest.pos)) continue;
    visible.push({
      kind: "chest",
      objectId: chest.id,
      pos: chest.pos,
      opened: chest.opened,
    });
  }

  // Corpses.
  for (const corpse of state.world.corpses) {
    if (chebyshev(observer.pos, corpse.pos) > VISION_RANGE) continue;
    if (!hasLineOfSight(state.world, observer.pos, corpse.pos)) continue;
    visible.push({
      kind: "corpse",
      objectId: corpse.characterId,
      pos: corpse.pos,
      contents: corpse.contents,
    });
  }

  // Cover tiles, capped at COVER_TILE_CAP closest.
  const candidateCovers = state.world.coverTiles
    .filter((t) => chebyshev(observer.pos, t) <= VISION_RANGE)
    .filter((t) => hasLineOfSight(state.world, observer.pos, t))
    .map((t) => ({ t, d: chebyshev(observer.pos, t) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, COVER_TILE_CAP);
  for (const { t } of candidateCovers) {
    visible.push({ kind: "cover", pos: t });
  }

  return { visible };
}

function makeCharacterVisible(other: CharacterState): VisibleEntity {
  const weaponItem = other.equipped.weapon;
  const base: VisibleEntity = {
    kind: "character",
    characterId: other.characterId,
    pos: other.pos,
    hpBucket: hpBucket(other.hp, other.maxHp),
  };
  if (weaponItem && weaponItem.category === "weapon") {
    return { ...base, kind: "character", weapon: weaponItem.name };
  }
  return base;
}
