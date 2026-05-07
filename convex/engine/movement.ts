// WP7 — Movement substep loop (pure functions; no Convex imports).
//
// Spec sections:
//   - concept-spec.md §10 (movement options; entity-targeted tracks current
//     target position substep-by-substep; "stay" is no-action; no mid-move
//     retargeting on newly visible enemies)
//   - concept-spec.md §24 (collisions: same-tile both fail; walls block;
//     other living characters block; cover walkable)
//   - concept-spec.md §4 (movement budget: 8 default; speed = 12 this turn)
//
// Algorithm — substep loop with simultaneous resolution:
//
//   for substep in 1..maxBudget:
//     for each moving character (deterministic order: by characterId):
//       desired = desiredNextTile(state, characterId, decision)
//     conflicts = tiles where ≥ 2 characters want to enter
//     for each character:
//       if desired is null OR a conflict OR blocked → no move
//       else commit the move (state.pos updated)
//     terminate early when no character moved this substep.
//
// Order-independence comes from: (a) per-substep parallel desired-tile
// computation (each character reads STATE-AT-START-OF-SUBSTEP, not state
// mid-commit); (b) conflict detection across the full desired set BEFORE
// any commit; (c) deterministic tie-breaking via characterId sort when
// iterating. Shuffling the input Map order produces byte-identical output.
//
// Entity tracking: for `toward_entity` / `away_from_entity`, each substep
// recomputes direction from the TARGET'S CURRENT POSITION (which may be
// updated by the target's own substep this very turn). For `toward_object`
// / `toward_evac` / `relative`, the target tile is fixed at start-of-turn.

import { chebyshev } from "./distance.js";
import type {
  MatchState,
  ParsedDecision,
  Tile,
  Wall,
} from "./types.js";

const DEFAULT_BUDGET = 8;
const SPEED_BUDGET = 12;
const MAX_BUDGET = SPEED_BUDGET; // hard cap on substep count
const STOP_AT_RANGE = 2; // toward_entity/object stop at Chebyshev 2

// ─── Wall helpers ────────────────────────────────────────────────────────

function tileInWall(t: Tile, wall: Wall): boolean {
  return (
    t.x >= wall.x &&
    t.x < wall.x + wall.w &&
    t.y >= wall.y &&
    t.y < wall.y + wall.h
  );
}

function tileBlockedByWall(t: Tile, walls: readonly Wall[]): boolean {
  for (const w of walls) {
    if (tileInWall(t, w)) return true;
  }
  return false;
}

// ─── Per-character mover state ───────────────────────────────────────────

/**
 * Per-character bookkeeping the substep loop carries:
 *  - `budget` — tiles remaining (initial = 8 or 12; decremented per commit).
 *  - `relativeRemaining` — for `kind: 'relative'`, dx/dy left to consume
 *    after clamping to budget. Recomputed at start, decremented on commit.
 *  - `staticTarget` — fixed target tile for `relative` / `toward_object` /
 *    `toward_evac`. `null` for entity-targeted moves (recomputed each substep).
 */
type Mover = {
  characterId: string;
  budget: number;
  decision: ParsedDecision;
  staticTarget: Tile | null;
  // Remaining delta for `relative` movement.
  dxRemaining: number;
  dyRemaining: number;
  // Set when the target tile is itself the goal (vs "stop at range 2 of it").
  stopAtTarget: boolean;
};

// ─── desiredNextTile — single-substep desire computation ─────────────────

/**
 * Compute the tile this character WANTS to enter on the current substep.
 * Returns `null` when:
 *   - budget exhausted,
 *   - already at goal (relative remaining = 0; or within range 2 of entity/object goal),
 *   - target is unresolvable (e.g., entity dead/missing),
 *   - already in conflict-stuck state.
 *
 * Pure: same `state` + same `mover` → same desired tile.
 */
export function desiredNextTile(
  state: MatchState,
  mover: Mover,
): Tile | null {
  if (mover.budget <= 0) return null;

  const me = state.characters.find((c) => c.characterId === mover.characterId);
  if (!me || !me.alive) return null;

  const move = mover.decision.move;

  // Resolve target tile per move kind.
  let targetTile: Tile | null = null;
  let stopAtRange2 = false;

  switch (move.kind) {
    case "none":
      return null;
    case "relative": {
      // Remaining-delta drives the desire each substep.
      if (mover.dxRemaining === 0 && mover.dyRemaining === 0) return null;
      const dx = Math.sign(mover.dxRemaining);
      const dy = Math.sign(mover.dyRemaining);
      return { x: me.pos.x + dx, y: me.pos.y + dy };
    }
    case "toward_evac":
      targetTile = state.world.evac.centre;
      // Move all the way to the evac centre tile (no range-2 stop).
      stopAtRange2 = false;
      break;
    case "toward_object": {
      const chest = state.world.chests.find(
        (c) => c.id === move.targetObjectId,
      );
      if (chest) {
        targetTile = chest.pos;
        stopAtRange2 = true;
      } else {
        const corpse = state.world.corpses.find(
          (c) => c.characterId === move.targetObjectId,
        );
        if (corpse) {
          targetTile = corpse.pos;
          stopAtRange2 = true;
        }
      }
      if (!targetTile) return null;
      break;
    }
    case "toward_entity": {
      const tgt = state.characters.find(
        (c) => c.characterId === move.targetCharacterId,
      );
      if (!tgt || !tgt.alive) return null;
      targetTile = tgt.pos;
      stopAtRange2 = true;
      break;
    }
    case "away_from_entity": {
      const tgt = state.characters.find(
        (c) => c.characterId === move.targetCharacterId,
      );
      if (!tgt || !tgt.alive) return null;
      // Direction AWAY from target.
      const dx = me.pos.x - tgt.pos.x;
      const dy = me.pos.y - tgt.pos.y;
      // If on top of target (dx=dy=0), pick an arbitrary deterministic axis.
      const sx = dx === 0 ? 1 : Math.sign(dx);
      const sy = dy === 0 ? 0 : Math.sign(dy);
      return { x: me.pos.x + sx, y: me.pos.y + sy };
    }
    default: {
      const _exhaustive: never = move;
      void _exhaustive;
      return null;
    }
  }

  if (!targetTile) return null;

  // Check stop-condition for entity/object goals.
  if (stopAtRange2 && chebyshev(me.pos, targetTile) <= STOP_AT_RANGE) {
    return null;
  }
  // Already at target tile (toward_evac).
  if (me.pos.x === targetTile.x && me.pos.y === targetTile.y) return null;

  // Step one Chebyshev tile toward target.
  const sx = Math.sign(targetTile.x - me.pos.x);
  const sy = Math.sign(targetTile.y - me.pos.y);
  return { x: me.pos.x + sx, y: me.pos.y + sy };
}

// ─── Block check (walls + other living characters) ──────────────────────

function isBlocked(
  tile: Tile,
  state: MatchState,
  characterId: string,
  pendingPositions: Map<string, Tile>,
): boolean {
  if (tile.x < 0 || tile.y < 0) return true;
  if (tile.x >= state.world.size.w || tile.y >= state.world.size.h) return true;
  if (tileBlockedByWall(tile, state.world.walls)) return true;
  // Blocked by another LIVING character at their pending (start-of-substep)
  // position. We use `pendingPositions` rather than `state.characters[i].pos`
  // because mid-substep we may have already committed some moves; but our
  // simultaneous-resolution algorithm DOES NOT commit mid-substep — desires
  // are computed against state-at-start-of-substep, conflicts checked against
  // the same, and ALL commits applied at end of substep. So pendingPositions
  // here is just the start-of-substep snapshot.
  for (const [id, p] of pendingPositions.entries()) {
    if (id === characterId) continue;
    if (p.x === tile.x && p.y === tile.y) {
      const c = state.characters.find((c) => c.characterId === id);
      if (c && c.alive) return true;
    }
  }
  return false;
}

// ─── simulateMovement — public entry point ──────────────────────────────

export type MoveTraceEntry = {
  characterId: string;
  from: Tile;
  to: Tile;
};

export type SimulateOptions = {
  /** Set of characterIds whose movement budget is bumped to 12 this turn
   *  due to having consumed a speed potion in phase 2. Phase 4 is the only
   *  consumer. */
  speedActiveIds?: ReadonlySet<string>;
};

export function simulateMovement(
  state: MatchState,
  decisions: ReadonlyMap<string, ParsedDecision>,
  opts: SimulateOptions = {},
): { state: MatchState; moves: MoveTraceEntry[] } {
  const speedSet = opts.speedActiveIds ?? new Set<string>();

  // Build per-character mover state, capturing start-of-turn positions.
  // Iteration order is deterministic: sort by characterId.
  const moverIds = [...decisions.keys()].sort();
  const movers: Mover[] = [];
  const startPos = new Map<string, Tile>();

  for (const id of moverIds) {
    const decision = decisions.get(id)!;
    const ch = state.characters.find((c) => c.characterId === id);
    if (!ch || !ch.alive) continue;
    startPos.set(id, { x: ch.pos.x, y: ch.pos.y });

    // Movement budget rules (concept-spec §9 + §10):
    //  - Only `primary === "move"` consumes the budget.
    //  - speed-active → 12; default → 8.
    //  - non-move primary → 0 (the move sub-decision is ignored).
    let budget = 0;
    if (decision.primary === "move" && decision.move.kind !== "none") {
      budget = speedSet.has(id) ? SPEED_BUDGET : DEFAULT_BUDGET;
    }

    let dxRemaining = 0;
    let dyRemaining = 0;
    if (decision.move.kind === "relative") {
      // Clamp to budget (max abs each axis ≤ budget).
      const cx = Math.max(-budget, Math.min(budget, decision.move.dx));
      const cy = Math.max(-budget, Math.min(budget, decision.move.dy));
      dxRemaining = cx;
      dyRemaining = cy;
    }

    movers.push({
      characterId: id,
      budget,
      decision,
      staticTarget: null,
      dxRemaining,
      dyRemaining,
      stopAtTarget: false,
    });
  }

  // Working state: per-character current position. Mutated per substep
  // commit. State.characters is rebuilt at the end.
  const currentPos = new Map<string, Tile>();
  for (const ch of state.characters) {
    currentPos.set(ch.characterId, { x: ch.pos.x, y: ch.pos.y });
  }

  // Per substep:
  for (let step = 0; step < MAX_BUDGET; step++) {
    // Build a state snapshot for this substep — uses currentPos for ALL
    // characters (movers and non-movers). All desire computations and
    // collision checks run against this snapshot.
    const snapshot: MatchState = {
      ...state,
      characters: state.characters.map((c) => {
        const p = currentPos.get(c.characterId);
        return p ? { ...c, pos: p } : c;
      }),
    };

    // Compute desired tiles for every mover with budget remaining.
    type Desire = { mover: Mover; tile: Tile };
    const desires: Desire[] = [];
    for (const m of movers) {
      if (m.budget <= 0) continue;
      const tile = desiredNextTile(snapshot, m);
      if (!tile) continue;
      desires.push({ mover: m, tile });
    }

    if (desires.length === 0) break;

    // Conflict detection: count desired-tile collisions across movers.
    const tileCounts = new Map<string, number>();
    for (const d of desires) {
      const k = `${d.tile.x},${d.tile.y}`;
      tileCounts.set(k, (tileCounts.get(k) ?? 0) + 1);
    }

    // Commit each desire that:
    //   (a) has a unique desired tile (no other mover wants it), AND
    //   (b) is not blocked by walls / out-of-bounds / non-moving living characters.
    let anyCommitted = false;
    const newPositions = new Map<string, Tile>(currentPos);
    for (const d of desires) {
      const k = `${d.tile.x},${d.tile.y}`;
      if ((tileCounts.get(k) ?? 0) > 1) continue; // conflict — skip
      if (isBlocked(d.tile, snapshot, d.mover.characterId, currentPos)) {
        continue;
      }
      // Commit this mover's step.
      newPositions.set(d.mover.characterId, d.tile);
      d.mover.budget -= 1;

      // For relative moves, decrement remaining delta along the axis we
      // actually stepped (compare new vs old).
      if (d.mover.decision.move.kind === "relative") {
        const prev = currentPos.get(d.mover.characterId)!;
        const stepX = d.tile.x - prev.x;
        const stepY = d.tile.y - prev.y;
        if (stepX !== 0) {
          d.mover.dxRemaining -= stepX;
        }
        if (stepY !== 0) {
          d.mover.dyRemaining -= stepY;
        }
      }
      anyCommitted = true;
    }

    if (!anyCommitted) break;

    for (const [id, p] of newPositions.entries()) {
      currentPos.set(id, p);
    }
  }

  // Build the new state and the moves trace.
  const moves: MoveTraceEntry[] = [];
  const nextCharacters = state.characters.map((ch) => {
    const finalPos = currentPos.get(ch.characterId);
    if (!finalPos) return ch;
    if (finalPos.x === ch.pos.x && finalPos.y === ch.pos.y) return ch;
    return { ...ch, pos: finalPos };
  });
  for (const id of moverIds) {
    const start = startPos.get(id);
    const end = currentPos.get(id);
    if (!start || !end) continue;
    if (start.x !== end.x || start.y !== end.y) {
      moves.push({ characterId: id, from: start, to: end });
    }
  }

  return {
    state: { ...state, characters: nextCharacters },
    moves,
  };
}

// Re-export the Mover type for testing convenience (intentionally NOT a
// public API surface — but exporting helps if a future integration test
// wants to construct one directly).
export type { Mover };
