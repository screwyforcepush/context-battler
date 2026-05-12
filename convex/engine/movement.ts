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
// Target tracking: `toward` / `away` resolve the typed target id once from
// the start-of-turn visible set, then each substep recomputes the target tile
// only for living-character targets. Static entities keep their resolved
// start-of-turn tile. For `relative`, the remaining delta is carried by the
// mover state.

import { chebyshev } from "./distance.js";
import {
  resolveTypedEntity,
  type ResolvedEntity,
} from "../llm/idNormalisation.js";
import type {
  MatchState,
  ParsedDecision,
  Tile,
  Wall,
} from "./types.js";

const DEFAULT_BUDGET = 8;
const SPEED_BUDGET = 12;
const MAX_BUDGET = SPEED_BUDGET; // hard cap on substep count

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
 */
type Mover = {
  characterId: string;
  budget: number;
  decision: ParsedDecision;
  resolvedTarget: ResolvedEntity | null;
  // Remaining delta for `relative` movement.
  dxRemaining: number;
  dyRemaining: number;
};

function targetTileForMover(state: MatchState, mover: Mover): Tile | null {
  const target = mover.resolvedTarget;
  if (!target) return null;
  const characterId = target.engineRef?.characterId;
  if (target.kind === "character" && characterId) {
    const character = state.characters.find(
      (c) => c.characterId === characterId,
    );
    if (!character || !character.alive) return null;
    return character.pos;
  }
  return target.tile;
}

// ─── desiredNextTile — single-substep desire computation ─────────────────

/**
 * Compute the tile this character WANTS to enter on the current substep.
 * Returns `null` when:
 *   - budget exhausted,
 *   - already at goal,
 *   - target is unresolvable,
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

    case "toward": {
      const targetTile = targetTileForMover(state, mover);
      if (!targetTile || !mover.resolvedTarget) return null;
      if (chebyshev(me.pos, targetTile) <= mover.resolvedTarget.stopAtRange) {
        return null;
      }
      const sx = Math.sign(targetTile.x - me.pos.x);
      const sy = Math.sign(targetTile.y - me.pos.y);
      return { x: me.pos.x + sx, y: me.pos.y + sy };
    }

    case "away": {
      const targetTile = targetTileForMover(state, mover);
      if (!targetTile) return null;
      // Direction AWAY from target.
      const dx = me.pos.x - targetTile.x;
      const dy = me.pos.y - targetTile.y;
      // If on top of target (dx=dy=0), pick an arbitrary deterministic axis.
      const sx = dx === 0 ? 1 : Math.sign(dx);
      const sy = dy === 0 ? 0 : Math.sign(dy);
      return { x: me.pos.x + sx, y: me.pos.y + sy };
    }
  }

  const _exhaustive: never = move;
  void _exhaustive;
  return null;
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
  /**
   * Phase-3 ADR §9 — wall-blocked move marker. Present iff the entry has
   * `from === to` AND the agent attempted a move whose next-step tile
   * was blocked by a wall. WP-B.7 relaxes the push-gate in
   * `simulateMovement` to emit such entries; the report writer in
   * `convex/reports/phase3.ts` reads `moves[].blockedBy === "wall"`
   * directly for the wall-blocked-move-rate metric (single source of
   * truth — no aggregator-side derivation).
   *
   * No-move decisions and character-blocks emit nothing (existing
   * absence is correct).
   */
  blockedBy?: "wall";
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
      resolvedTarget:
        decision.move.kind === "toward" || decision.move.kind === "away"
          ? resolveTypedEntity(state, id, decision.move.targetId)
          : null,
      dxRemaining,
      dyRemaining,
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
  //
  // Phase-3 ADR §9 — wall-blocked move emit. When `start === end`
  // (mover did not move) AND the agent's INTENDED next-step direction
  // was a wall tile, push `{characterId, from===to, blockedBy: "wall"}`.
  // Other start===end causes (no-move decision, character-blocked,
  // off-grid) emit nothing — existing absence is correct (per ADR §9).
  //
  // The "intended next-step direction" is computed via `desiredNextTile`
  // against the start-of-turn snapshot. We only emit `blockedBy: "wall"`
  // when the desired tile is INSIDE a wall rectangle; if the desired
  // tile is null, off-grid, or blocked by a character, emit nothing.
  const moves: MoveTraceEntry[] = [];
  const nextCharacters = state.characters.map((ch) => {
    const finalPos = currentPos.get(ch.characterId);
    if (!finalPos) return ch;
    if (finalPos.x === ch.pos.x && finalPos.y === ch.pos.y) return ch;
    return { ...ch, pos: finalPos };
  });
  // Build a fresh start-of-turn snapshot to recompute the would-be
  // desired tile for stuck movers (independent of the substep loop).
  const startSnapshot: MatchState = {
    ...state,
    characters: state.characters.map((c) => {
      const p = startPos.get(c.characterId);
      return p ? { ...c, pos: p } : c;
    }),
  };
  for (const id of moverIds) {
    const start = startPos.get(id);
    const end = currentPos.get(id);
    if (!start || !end) continue;
    if (start.x !== end.x || start.y !== end.y) {
      moves.push({ characterId: id, from: start, to: end });
      continue;
    }
    // start === end. Determine if a wall blocked the intended step.
    const mover = movers.find((m) => m.characterId === id);
    if (!mover) continue;
    if (mover.budget <= 0) continue; // primary !== "move" / move.kind === "none"
    // Reset budget on the snapshot mover so desiredNextTile yields the
    // start-of-turn step intent (the substep loop has decremented the
    // real mover's budget; we want the original intent).
    const snapshotMover: Mover = {
      ...mover,
      budget: mover.decision.primary === "move" ? DEFAULT_BUDGET : 0,
      // For relative moves, restore start-of-turn deltas (clamped).
      dxRemaining:
        mover.decision.move.kind === "relative"
          ? Math.max(
              -DEFAULT_BUDGET,
              Math.min(DEFAULT_BUDGET, mover.decision.move.dx),
            )
          : 0,
      dyRemaining:
        mover.decision.move.kind === "relative"
          ? Math.max(
              -DEFAULT_BUDGET,
              Math.min(DEFAULT_BUDGET, mover.decision.move.dy),
            )
          : 0,
    };
    const desired = desiredNextTile(startSnapshot, snapshotMover);
    if (!desired) continue; // no-move intent → emit nothing
    if (
      desired.x < 0 ||
      desired.y < 0 ||
      desired.x >= state.world.size.w ||
      desired.y >= state.world.size.h
    ) {
      continue; // off-grid → emit nothing per ADR §9
    }
    if (tileBlockedByWall(desired, state.world.walls)) {
      moves.push({
        characterId: id,
        from: start,
        to: end,
        blockedBy: "wall",
      });
    }
    // else: blocked by character or conflict — emit nothing per ADR §9.
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
