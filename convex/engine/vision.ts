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
// Visible-entity caps: cover rects are capped at 12 closest to the observer
// to keep the digest small (WP8 also caps at 8 visible-entities total, so
// the engine's pre-cap here is a safety net, not the primary control).

import { chebyshev } from "./distance.js";
import { airdropCountdown, airdropProjectionState, worldAirdrops } from "./airdrops.js";
import type {
  CharacterState,
  MatchState,
  RectShape,
  Tile,
  VisibleEntity,
  Wall,
  WorldState,
} from "./types.js";

/** Vision range in tiles, per concept-spec §4. */
const VISION_RANGE = 20;

/** Cover-rect cap for the visible list. WP8's digest caps total entities
 *  at 8; this is a pre-cap so the visible list doesn't blow up before WP8
 *  applies its own cap. Documented in the vision module head-note. */
const COVER_RECT_CAP = 12;

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

function rectToTiles(rect: Wall): Tile[] {
  const tiles: Tile[] = [];
  for (let dx = 0; dx < rect.w; dx++) {
    for (let dy = 0; dy < rect.h; dy++) {
      tiles.push({ x: rect.x + dx, y: rect.y + dy });
    }
  }
  return tiles;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function nearestTileOfRect(observer: Tile, rect: Wall): Tile {
  return {
    x: clamp(observer.x, rect.x, rect.x + rect.w - 1),
    y: clamp(observer.y, rect.y, rect.y + rect.h - 1),
  };
}

export function rectMinChebyshev(observer: Tile, rect: Wall): number {
  return chebyshev(observer, nearestTileOfRect(observer, rect));
}

export function shapeOfRect(rect: Wall): RectShape {
  if (rect.w === 1 && rect.h === 1) return "single";
  if (rect.h === 1) return "E-W line";
  if (rect.w === 1) return "N-S line";
  return "patch";
}

function evacRect(world: WorldState): Wall {
  return {
    x: world.evac.centre.x - 1,
    y: world.evac.centre.y - 1,
    w: 3,
    h: 3,
  };
}

function rectHasAnyTileWithLos(
  world: WorldState,
  observer: Tile,
  rect: Wall,
): boolean {
  return rectToTiles(rect).some((tile) => hasLineOfSight(world, observer, tile));
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
 *  - Crates within Chebyshev 20 with LOS.
 *  - Corpses within Chebyshev 20 with LOS.
 *  - Cover rects within Chebyshev 20 with LOS, capped at 12 closest.
 *  - Wall rects within Chebyshev 20 with LOS. Walls do not bypass LOS:
 *    a wall behind another wall is not visible.
 *  - Revealed evac rect regardless of Chebyshev range or LOS.
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

  // Crates.
  for (const crate of state.world.crates) {
    if (chebyshev(observer.pos, crate.pos) > VISION_RANGE) continue;
    if (!hasLineOfSight(state.world, observer.pos, crate.pos)) continue;
    visible.push({
      kind: "crate",
      objectId: crate.id,
      pos: crate.pos,
      opened: crate.opened,
    });
  }

  // Airdrops. Telegraphs are intentional match-meta and bypass range/LOS;
  // landed drops become normal LOS-gated crate entries.
  for (const airdrop of worldAirdrops(state.world)) {
    const projection = airdropProjectionState(airdrop, state.turn);
    if (projection === "telegraphed") {
      const countdown = airdropCountdown(airdrop, state.turn);
      if (countdown === null) continue;
      visible.push({
        kind: "airdrop",
        objectId: airdrop.id,
        pos: airdrop.pos,
        countdown,
      });
      continue;
    }
    if (projection !== "landed") continue;
    if (chebyshev(observer.pos, airdrop.pos) > VISION_RANGE) continue;
    if (!hasLineOfSight(state.world, observer.pos, airdrop.pos)) continue;
    visible.push({
      kind: "crate",
      objectId: airdrop.id,
      pos: airdrop.pos,
      opened: false,
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

  // Cover rects, capped at COVER_RECT_CAP closest.
  const candidateCovers = state.world.coverClusters
    .filter((rect) => rectMinChebyshev(observer.pos, rect) <= VISION_RANGE)
    .filter((rect) => rectHasAnyTileWithLos(state.world, observer.pos, rect))
    .map((rect) => ({ rect, d: rectMinChebyshev(observer.pos, rect) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, COVER_RECT_CAP);
  for (const { rect } of candidateCovers) {
    visible.push({ kind: "cover_rect", rect, shape: shapeOfRect(rect) });
  }

  // Wall rects use the same LOS gate as every other spatial entity. A rect
  // emits as one entity when at least one of its tiles has LOS.
  for (const rect of state.world.walls) {
    if (rectMinChebyshev(observer.pos, rect) > VISION_RANGE) continue;
    if (!rectHasAnyTileWithLos(state.world, observer.pos, rect)) continue;
    visible.push({ kind: "wall_rect", rect, shape: shapeOfRect(rect) });
  }

  if (state.world.evac.revealedAtTurn !== null) {
    const rect = evacRect(state.world);
    visible.push({ kind: "evac_rect", rect, shape: shapeOfRect(rect) });
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
