# Phase 9 — Walls + Vision Rect-Grained Substrate

> **Status:** planning, spec **v2** (2026-05-14 refinement). Substrate
> slice dispatched per
> [`mental-model.md` §17](../../spec/mental-model.md#17-walls--vision-rect-grained-substrate-dispatched-2026-05-14)
> and refined pillar 8 in §6. Three independent threads (LOS uniform,
> wall-slide, rect-grained Vision) land in one assignment.
>
> Canonical intent anchors:
> - [`mental-model.md` §17](../../spec/mental-model.md#17-walls--vision-rect-grained-substrate-dispatched-2026-05-14) — the why
> - [`mental-model.md` §6 pillar 8](../../spec/mental-model.md#6-design-pillars) — Vision is the affordance channel (refined)
> - [Phase 8 closure](../08-vision-affordance-filter/README.md) — predecessor slice (spent-entity filter)
>
> **v2 changelog (post-review refinement):**
> - D9 locked: slide trace = `{wallRectId, axis: 'N'|'E'|'S'|'W', intent}` per substep; renderer reads `axis` directly (no delta derivation). §3.1.6, WP-B §1, WP-C §2 scrubbed.
> - D10 locked: `ResolvedEntity.rect?: Wall` added to WP-C type changes; WP-B reads `mover.resolvedTarget.rect` for dynamic nearest-tile resolution. §3.1.5, WP-C §3 updated.
> - D11 locked: phase-9 closing report uses `phase9Payload: v.optional(phase9PayloadValidator)` sibling on `reports` (mirrors phase3/6/7); new `persistComputedPhase9Report` mutation mirrors `persistComputedPhase7Report` at `convex/reports/phase7.ts:768`. WP-E §1-2 rewritten.
> - D12 locked: `MoveTraceEntry.slide` persistence end-to-end — new §3.1.7 enumerates `schema.ts moves[]` validator, `runMatch` adapters, `PrevTurnRow`, `turnsDerived.byMatchSlim`, `harness/diagnostics/types.ts` touch points. WP-B owns persistence.
> - D6 reinforced: engine writes `targetId` verbatim into `MoveTraceEntry.slide.intent`; renderer (WP-C) calls `renderCharacterTypedId` / rect-id formatter at fragment-render time. No display-name lookup in engine layer.
> - WP-E §1: closing-data-path decision = slim-projection extension with phase9 evidence fields (visible-entity keys, observer pos, slide markers); new `phase9PayloadValidator` shape enumerated.
> - Cucumber → named test mapping completed (no orphan scenarios); wall-on-wall LOS construction recipe added to WP-A §5.
> - LOW: WP-D adds `convex/_data/personas.ts` to verify list; WP-C extends `visibleTargetIds` to emit rect-key form; single-tile resolver test uses synthetic 1×1 fixture; geometry-guarantee note added to §3.1.4.
> - Footnote: assignment text says "12 cover clusters" but `maps/reference.json` carries 10 (spec body correctly says 10). Assignment-doc inaccuracy, not a spec gap.

---

## 1. Purpose

Post-iter-3 replay review surfaced three substrate gaps in how walls and
cover are handled:

1. **Walls bypass LOS.** Today the engine emits every wall tile within
   Chebyshev-20 unconditionally (vision.ts:214-228) on the rationale that
   "walls are the LOS blockers so they're always visible." The rule
   doesn't survive scrutiny — a wall behind another wall still isn't
   visible. Players see walls through walls.

2. **Agents dead-stop into single-tile walls.** When a `toward`/`away` or
   diagonal compass move lands on a wall, the substep loop drops the
   step entirely. Agents waste turns colliding with single-tile walls
   they could trivially have stepped around, and prompts have to do A*
   in token space to compensate.

3. **Vision dumps wall and cover tiles.** Even though the substrate
   stores walls as 28 rectangles and cover as ~10 cluster rectangles,
   Vision unrolls them into individual tiles, capped at 12 walls + 12
   cover entries per turn. Tokens burn on tile enumeration while
   wall-hug, cover-camp, and evac-rush remain arithmetic puzzles rather
   than first-class verbs.

This slice closes all three gaps in one coherent substrate change.
Pillar 6 ("build the substrate, don't paper over with prompt teaching")
is the load-bearing principle: the engine does the path-arithmetic and
emits the natural structure, so prompts can author tactical *intent*
rather than tile-level mechanics.

> **North-star filter test:** does this make prompt-authored behaviour
> more interesting, legible, or exploitable? Yes —
> - Wall-on-wall LOS makes occlusion legible (paranoid + camper can author
>   "if hidden behind a wall, hold position").
> - Wall-slide makes single-tile-wall navigation a non-event (failures
>   become attributable to intent, not collision micromechanics).
> - Rect-keyed Vision makes "toward this wall to break LOS" / "into this
>   cover patch" / "to the nearest tile of evac" first-class verbs.

## 2. Overview — what is being built

Backend-only substrate work. Three threads:

1. **Wall LOS uniform.** Delete the carve-out in `convex/engine/vision.ts`
   that skips LOS for walls. Walls now route through `hasLineOfSight`
   exactly like characters / chests / corpses / cover. The only
   non-LOS-gated entry is Evac post-reveal, which is intentionally
   match-meta (minimap-style), not spatial.

2. **Wall-slide.** When a `toward` / `away` move or a *diagonal* compass
   move (NE/SE/SW/NW) is blocked on the diagonal step by a wall, the
   engine slides along the unblocked cardinal axis instead of
   dead-stopping. Cardinal-direct hits (N/E/S/W into a wall) still stop
   — the agent said "go E" and the engine does not silently rewrite that
   to "go N". Outcome line:
   `hugged Wall_<rect-id> <dir>` (compass case),
   `hugged Wall_<rect-id> <dir> toward <target>` (toward variant),
   `hugged Wall_<rect-id> <dir> away from <target>` (away variant).
   The dead-stop case keeps existing `tried to move and hit wall`
   wording.

3. **Rect-grained Vision emission.** Walls / cover patches / evac surface
   as the rectangles the substrate already stores them as. Keys are
   coordinate-encoded:
   - `Wall_<x1>_<y1>_to_<x2>_<y2>` for multi-tile rects, `Wall_<x>_<y>`
     for 1×1.
   - `Cover_<x1>_<y1>_to_<x2>_<y2>` for clusters, `Cover_<x>_<y>` for
     1×1.
   - `Evac_<x1>_<y1>_to_<x2>_<y2>` for the 3×3 zone (rename from current
     bare `Evac` key).

   Each entry carries `dist`, `bearing`, and a `shape` discriminator
   ∈ {`single`, `E-W line`, `N-S line`, `patch`}. Both `dist` and
   `bearing` compute against the *nearest tile* of the rect (not the
   centroid). Inside-state (cover the observer stands on, evac they're
   inside) is encoded uniformly as `dist: 0, bearing: "here"` — one
   inside-convention regardless of terrain type. Evac stays
   range-uncapped once revealed.

Targeting an aggregated entity (`toward Wall_39_70_to_44_70`) resolves
to the nearest tile of the rect, combined with the existing
`stopAtRange` lookup (wall 1, cover 0, evac 0). Wall-hug becomes "get
adjacent to any part of this structure" rather than "step toward tile
(39,70)" — richer, not narrower.

Chests, corpses, and characters keep their existing per-entity point
keying — only rect-shaped terrain aggregates.

## 3. Architecture Design

### 3.1 Data-model decisions

#### 3.1.1 `coverClusters` on `WorldState` — added **alongside** `coverTiles`

The map descriptor already carries `coverClusters: Wall[]` (10 rects in
`maps/reference.json`). Today `expandMap` (`convex/engine/map.ts:118-153`)
unrolls them into a flat `coverTiles: Tile[]` on `WorldState`. The cluster
shape is then lost — Vision has to make it up tile-by-tile.

**Decision: keep both fields on `WorldState`.** `coverClusters` is added
as a new top-level field; `coverTiles` is preserved.

| Field | Type | Source-of-truth for |
|---|---|---|
| `coverClusters: Wall[]` | new | Vision rect-keyed emission; targeting resolution (nearest tile of cluster). |
| `coverTiles: Tile[]` | existing | Hiding (`isInCover` per `hiding.ts:42`). Per-tile membership check is the canonical "is this tile a cover tile?" semantics. |

Both fields are derived from the same `MapDescriptor.coverClusters` at
match start, so they cannot drift. Walls — already stored as `Wall[]`
rectangles — need no parallel structure; `vision.ts` and movement
collision iterate them directly today.

**Why not replace `coverTiles` outright?** `hiding.ts:42` iterates
`coverTiles` for an O(N) tile-equality check in resolution (concept-spec
§7 reveal-cause flow). Switching to `coverClusters[].some(tileInWall)`
is semantically equivalent and would work, but it conflates the
substrate change with a small behavioural surface (hiding) for no
substrate gain — the cluster grouping is irrelevant to hiding. The
additive-field choice keeps hiding bitwise-identical and isolates this
slice's risk to vision + movement.

**Why not derive clusters at Vision build time from `coverTiles`?**
Reconstructing rect groupings from a flat tile list is a connected-
components problem with non-trivial cost per turn, and the descriptor
already has the answer. Don't recompute what we already know.

#### 3.1.2 Vision key shape grammar

| Rect | Key | Shape value |
|---|---|---|
| 1×1 (`w=1, h=1`) | `Wall_<x>_<y>` / `Cover_<x>_<y>` | `"single"` |
| Horizontal line (`h=1, w≥2`) | `Wall_<x1>_<y1>_to_<x2>_<y2>` | `"E-W line"` |
| Vertical line (`w=1, h≥2`) | `Wall_<x1>_<y1>_to_<x2>_<y2>` | `"N-S line"` |
| Patch (`w≥2, h≥2`) | `Wall_<x1>_<y1>_to_<x2>_<y2>` | `"patch"` |

`(x1, y1)` is the rect's NW corner (`rect.x`, `rect.y`); `(x2, y2)` is
the inclusive SE corner (`rect.x + rect.w - 1`, `rect.y + rect.h - 1`).
Evac is always 3×3, so its key is always
`Evac_<cx-1>_<cy-1>_to_<cx+1>_<cy+1>` with `shape: "patch"`.

Worked examples against `maps/reference.json`:

- Wall rect `{x:18, y:18, w:6, h:1}` → key `Wall_18_18_to_23_18`,
  `shape: "E-W line"`.
- Wall rect `{x:24, y:18, w:1, h:6}` → key `Wall_24_18_to_24_23`,
  `shape: "N-S line"`.
- Cover cluster `{x:42, y:42, w:2, h:2}` → key `Cover_42_42_to_43_43`,
  `shape: "patch"`.
- Evac centre `(48,48)` → key `Evac_47_47_to_49_49`, `shape: "patch"`.

The reference map contains zero 1×1 wall or cover rects today — all 28
walls are E-W or N-S lines, all 10 cover clusters are 2×2 or 3×3
patches. The `single` shape is a future-proofing case (map iteration in
later phases may introduce 1×1 obstacles); the contract still covers it.

#### 3.1.3 Inside-state encoding (uniform "here" convention)

For observer `(ox, oy)` and rect `{x, y, w, h}`, the **nearest tile** is:

```
nx = clamp(ox, x, x + w - 1)
ny = clamp(oy, y, y + h - 1)
```

Then `dist = chebyshev((ox, oy), (nx, ny))` and
`bearing = compass((ox, oy), (nx, ny))`.

When the observer is *inside* the rect, `(nx, ny) === (ox, oy)`,
`dist === 0`, and bearing is the empty compass case. The serialiser
substitutes `bearing: "here"` for the empty compass case, producing the
uniform inside-convention:

```json
"Cover_42_42_to_43_43": { "dist": 0, "bearing": "here", "shape": "patch" }
"Evac_47_47_to_49_49":  { "dist": 0, "bearing": "here", "shape": "patch" }
```

Same one-rule mechanism handles future inside-types (buff tiles,
teleport pads) without per-type carve-outs. Pillar-aligned: the model
learns one inside-encoding rather than one per terrain.

The phase-7 `Inside Evac` / `Outside Evac` flag on the Status block
(see `inputBuilder.ts:441-443`) stays — Status is the agent's "your
stuff" channel, Vision is the world. They are not redundant: Status
tells the agent their own state, Vision tells them *which rect* they
are inside. (And opens the door for prompts like "if Inside Cover_*,
hold overwatch.")

#### 3.1.4 Wall-on-LOS-rect aggregation rule

A wall rect is visible iff **at least one** of its constituent tiles
has LOS to the observer (Bresenham-line clear of any other wall tile in
between). The whole rect emits as one key; the engine does **not**
fragment a partially occluded wall.

Same rule applies to cover clusters (at least one tile of the cluster
has LOS → whole cluster emits as one key).

Evac is the only non-LOS-gated entry: once revealed (`revealedAtTurn !==
null`), it emits regardless of Chebyshev distance or LOS — intentionally
match-meta, per north star.

**Geometry guarantee.** For an axis-aligned rect, the Chebyshev-nearest
tile to an external observer is always Bresenham-reachable without
crossing other tiles of the same rect — the near edge faces the
observer. So the "at least one tile has LOS" aggregation rule is
satisfiable iff no *other* wall occludes the nearest tile. Future
non-rectangular shapes would break this invariant; if a later slice
introduces L-shaped or polygonal walls, the aggregation rule must be
re-derived.

Performance bound: 28 walls × ~6 tiles each × Bresenham across ≤ 20
tiles ≈ a few thousand ops per observer per turn — negligible.

#### 3.1.5 Wall-slide algorithm

```
desiredNextTile(state, mover) yields tile T = (mx + sx, my + sy)
  where (sx, sy) is the step-delta for the mover's direction this substep.

If isBlocked(T, …) AND tileBlockedByWall(T, walls)   // wall, not character or edge
  AND sx !== 0 AND sy !== 0:                          // diagonal step
    let A = (mx + sx, my)         // X-axis cardinal fallback
    let B = (mx,      my + sy)    // Y-axis cardinal fallback
    let aClear = !isBlocked(A, …)
    let bClear = !isBlocked(B, …)
    if  aClear && !bClear → slide to A, emit slide trace.
    if !aClear &&  bClear → slide to B, emit slide trace.
    if  aClear &&  bClear → slide to A (X-axis preferred); tie-break documented.
    if !aClear && !bClear → fall through to existing dead-stop path.

If isBlocked(T, …) AND tileBlockedByWall(T, walls) AND (sx === 0 || sy === 0):
  // Cardinal-direct hit into wall. No slide. Existing dead-stop path.
```

**Tie-break rule (both fallbacks clear): prefer X-axis.** Deterministic,
matches the iteration order of the existing `desiredNextTile` (sx is
read before sy). Documented in the algorithm comment so future readers
don't experiment. Persona behaviour is unaffected on first order — the
slide is the engine doing path-arithmetic; persona authorship reads
*outcome lines* (e.g. `hugged Wall_18_18_to_23_18 E`) to attribute
behaviour.

**Slide is single-substep, not multi-substep.** A slide commits one
tile of budget; the next substep recomputes desire from the new
position against the original goal. If the agent has more budget and
the slid-to tile re-encounters the wall, slide fires again. This is
intentional: each slide is one tile around the wall edge.

**Slide does not bypass other blockers.** If the cardinal fallback tile
is occupied by another living character, blocked by another wall, or
off-grid, that fallback is "blocked" for tie-break purposes. The
fallthrough to dead-stop is preserved.

**Toward/away resolves against the *rect* target, not the rect's
single resolved tile.** For aggregated wall/cover/evac targets, mover
state carries `resolvedTarget.rect: Wall` (captured at turn start by
`resolveTypedEntity` — see WP-C §3 and D10). The substep loop's
`targetTileForMover` reads `mover.resolvedTarget.rect` and recomputes
`nearestTileOfRect(rect, mover.pos)` per substep (so as the mover
slides closer the "nearest" tile updates and toward continues to make
progress). This is the same dynamic-target pattern characters already
use for living targets — except characters expose `engineRef.characterId`
and the substep loops up the live `pos`; rect targets expose
`rect` and the substep loop recomputes nearest each tick.

**No re-parsing of `targetId` per substep, no `state.world` lookup
helper indirection.** The rect blob is stored on the
`ResolvedEntity` at turn start; the substep loop reads it from
`mover.resolvedTarget.rect` directly. This keeps the substep hot path
free of string parsing and world-table scans (D10 decision; see WP-C §3
for the type-change list).

#### 3.1.6 Outcome-line shape — slide trace (D6, D9 locked)

New `MoveTraceEntry` shape additions:

```ts
export type MoveTraceEntry = {
  characterId: string;
  from: Tile;
  to: Tile;
  blockedBy?: "wall";                        // existing — dead-stop case
  slide?: {                                  // NEW — slide-fired case (per substep)
    wallRectId: string;                      // engine-formatted rect id, e.g. "Wall_18_18_to_23_18"
    axis: "N" | "E" | "S" | "W";             // the cardinal the engine slid on this substep
    intent: string;                          // the agent's stated intent — VERBATIM:
                                             //   compass case: "NE" | "SE" | "SW" | "NW"
                                             //   toward case:  "toward <targetId>"   (targetId verbatim, e.g. "Duelist" or "Wall_18_18_to_23_18")
                                             //   away case:    "away <targetId>"
  };
};
```

**D6 — engine is display-name-agnostic.** The engine writes the
`targetId` string the agent emitted, verbatim. No
`renderCharacterTypedId` lookup at the engine layer; no persona
display-name resolution; no rect-id reformatting. The LLM-projection
renderer (`renderMoveFragment` in `inputBuilder.ts:138`) calls
`renderCharacterTypedId(state, targetId)` (or the rect-id pretty-printer)
at fragment-render time to project the verbatim id into the
human-readable outcome line. Engine never imports display-name
machinery.

**D9 — axis is written explicitly, not derived.** The engine writes
the cardinal letter (`'N'|'E'|'S'|'W'`) it slid on into `slide.axis`.
The renderer reads it directly. **Do not derive axis from
`entry.from`→`entry.to` delta.** Why: in a multi-substep move the
aggregate `from`/`to` is start-to-final, and the slide axis on substep
*k* is not recoverable from that aggregate (consider NE move that
slides E on substep 1 then continues NE on substep 2 — aggregate
delta is NE, slide axis on substep 1 was E; delta-derivation produces
the wrong letter).

**Trace shape under multi-substep moves.** `MoveTraceEntry` is one
*aggregate* entry per character per turn (existing pattern; see
`convex/engine/movement.ts:341`). The `slide` field carries the
**first slide that fired this turn** — that one substep is the
canonical "hugged" event the outcome line attributes. If multiple
slides fire in a single multi-substep move, only the first is
surfaced in the outcome line; the trace shape stays singular (one
`slide` per `MoveTraceEntry`). Multi-slide turns are rare enough not
to warrant a `slide[]` array; the closing-20 evidence counter
(`slideOutcomeCount` in WP-E) treats each `MoveTraceEntry.slide` as
one event for ergonomic counting.

`renderMoveFragment` in `inputBuilder.ts:138-146` reads `entry.slide` and
emits the new outcome-line variants. The dead-stop path keeps the
existing `tried to move and hit wall` wording verbatim.

**Outcome-line renderings (WP-C):**

| `slide.intent` shape       | Renderer output (post-projection)                                       |
|----------------------------|--------------------------------------------------------------------------|
| `"NE"` (compass)           | `hugged Wall_18_18_to_23_18 E`                                            |
| `"toward Duelist"`         | `hugged Wall_18_18_to_23_18 E toward Duelist` (Duelist is already a persona name) |
| `"toward <characterId>"`   | renderer projects via `renderCharacterTypedId` → `hugged ... E toward Duelist` |
| `"toward Wall_*_to_*"`     | renderer leaves the rect id intact → `hugged Wall_18_18_to_23_18 E toward Wall_30_60_to_34_60` |
| `"away <targetId>"`        | `hugged Wall_18_18_to_23_18 E away from <projected-name>` (renderer adds the "from") |

#### 3.1.7 Slide persistence — end-to-end touch points (D12 locked)

`MoveTraceEntry.slide` is engine-resident; without explicit persistence
scope it would be stripped at the Convex schema boundary
(`schema.ts:302-314` validator only allows `blockedBy` today). Without
persistence, **the next-turn user-role outcome line cannot render
`hugged Wall_*`** (the renderer reads from `PrevTurnRow`, not engine
trace), and **WP-E cannot count slide events** (the diagnostics slim
projection reads `resolution.moves[]`).

WP-B owns this thread (it's movement-trace-shape work).

**Per-file touch points:**

| File | Line | Change |
|---|---|---|
| `convex/schema.ts` | 302-314 (moves[] validator) | Add `slide: v.optional(v.object({ wallRectId: v.string(), axis: v.union(v.literal("N"), v.literal("E"), v.literal("S"), v.literal("W")), intent: v.string() }))` to the `moves[]` element validator. |
| `convex/runMatch.ts` | 481-489 (`adaptResolutionForSchema.moves.map`) | Conditional-spread `slide` into the persisted row, mirroring the existing `blockedBy` spread pattern. |
| `convex/runMatch.ts` | 591-596 (prior-turn `resolution.moves.map` adapter) | Conditional-spread `slide` when reconstructing `PrevTurnRow` from the persisted row. |
| `convex/engine/types.ts` | `MoveTraceEntry` type (search by name) | Add the `slide?` field declared in §3.1.6. |
| `convex/llm/inputBuilder.ts` | `PrevTurnRow` type — `resolution.moves[]` shape | Extend with `slide?: { wallRectId: string; axis: "N"|"E"|"S"|"W"; intent: string }` so `renderMoveFragment` can read it. |
| `convex/turnsDerived.ts` | 589 (`slimInput` — `projectSlimTurnRow.resolution`) | The slim projection passes `row.resolution` through unchanged (line 625); confirm `slide` survives. Add a unit test if drift risk warrants. |
| `harness/diagnostics/types.ts` | 111-116 (`ResolutionMove` type) | Extend with `slide?: { wallRectId: string; axis: "N"|"E"|"S"|"W"; intent: string }` so diagnostics CLI consumers can read it. |
| WP-E phase9 collector | new | Reads `resolution.moves[].slide` to count `slideOutcomeCount` and emit `hugged Wall_*` evidence. |

**Why the field is `v.optional`:** every non-slide move row omits the
field (no `slide` event fired). The optional validator avoids forcing
every historical move row to carry an empty object. Same pattern as
`blockedBy`.

**Forward-compatibility check:** `slide` is a leaf object on the
existing `moves[]` element; it does not change the shape of any other
trace field. Convex schema migration is additive — dev DB wipe is
already authorised for the `coverClusters` change; this rides along.

### 3.2 LOS uniform change

Today (`vision.ts:214-228`):
```ts
for (const w of state.world.walls) {
  for (let dx = 0; dx < w.w; dx++) {
    for (let dy = 0; dy < w.h; dy++) {
      const tile: Tile = { x: w.x + dx, y: w.y + dy };
      if (chebyshev(observer.pos, tile) > VISION_RANGE) continue;
      visible.push({ kind: "wall", pos: tile });   // ← NO LOS CHECK
    }
  }
}
```

After:
```ts
for (const rect of state.world.walls) {
  if (rectMinChebyshev(observer.pos, rect) > VISION_RANGE) continue;
  if (!rectHasAnyTileWithLos(state.world, observer.pos, rect)) continue;
  visible.push({ kind: "wall_rect", rect, shape: shapeOf(rect) });
}
```

Same pattern for `coverClusters`:
```ts
for (const cluster of state.world.coverClusters) {
  if (rectMinChebyshev(observer.pos, cluster) > VISION_RANGE) continue;
  if (!rectHasAnyTileWithLos(state.world, observer.pos, cluster)) continue;
  visible.push({ kind: "cover_rect", rect: cluster, shape: shapeOf(cluster) });
}
```

The old `kind: "wall"` and `kind: "cover"` (per-tile) variants on
`VisibleEntity` are **replaced** by `kind: "wall_rect"` and
`kind: "cover_rect"` (per-rect). This is a typed-union shape change;
the LLM projection layer adapts in WP-C.

`hasLineOfSight` itself is **unchanged**. The "no LOS through walls"
semantics are intrinsic to the Bresenham line-trace, and walls remain
the only LOS blocker (cover still walks through unhidden). The change
is the LOS *gate at the visibility callsite*.

### 3.3 Touch points (full impact surface)

| File | Change | WP |
|---|---|---|
| `convex/engine/types.ts` | Add `coverClusters: Wall[]` to `WorldState`. Replace `VisibleEntity` variants `{kind:"wall", pos}` and `{kind:"cover", pos}` with `{kind:"wall_rect", rect:Wall, shape:Shape}` and `{kind:"cover_rect", rect:Wall, shape:Shape}`. Add `Shape = "single" | "E-W line" | "N-S line" | "patch"`. | WP-A |
| `convex/engine/vision.ts` | Delete the wall LOS carve-out (lines 214-228). Rewrite wall emit to iterate `state.world.walls`, LOS-aggregate, emit per-rect. Rewrite cover emit to iterate `state.world.coverClusters`, LOS-aggregate, emit per-cluster (replacing the current per-tile cover loop at lines 203-212). | WP-A |
| `convex/engine/map.ts` | `expandMap` returns `coverClusters` alongside `coverTiles` (both derived from `descriptor.coverClusters`). | WP-A |
| `convex/matches.ts` | Mirror `expandMap` change in `expandMapInline`; insert `coverClusters` into the `worldState` row. | WP-A |
| `convex/runMatch.ts:224-248` | Read `coverClusters` into `WorldState` alongside `coverTiles`. | WP-A |
| `convex/schema.ts` | Add `coverClusters: v.array(wallValidator)` to the `worldState` table (alongside the existing `coverTiles` field). | WP-A |
| `convex/engine/hiding.ts` | **No edit.** Hiding stays on `coverTiles` per §3.1.1. | — |
| `convex/engine/movement.ts` | Extend the substep loop or `desiredNextTile` with the slide algorithm per §3.1.5. Compute the slide target's wall-rect-id for the trace marker. Extend `MoveTraceEntry` with `slide?: { wallRectId, axis, intent }` per §3.1.6 (D6/D9). Adapt `targetTileForMover` to read `mover.resolvedTarget.rect` and recompute nearest-tile-per-substep for rect targets (D10). Engine writes `intent` verbatim — no display-name lookup. | WP-B |
| `convex/schema.ts` (moves[] validator, lines 302-314) | Add `slide: v.optional(v.object({ wallRectId, axis (union N/E/S/W), intent }))` per §3.1.7 / D12. | WP-B |
| `convex/runMatch.ts` (adapters, lines 481-489 and 591-596) | Conditional-spread `slide` into persisted row AND into the `PrevTurnRow` reconstruction. §3.1.7 / D12. | WP-B |
| `convex/turnsDerived.ts:589` (`projectSlimTurnRow`) | Verify `slide` survives `byMatchSlim`. Add a slim-projection unit test if needed. WP-B owns. | WP-B |
| `harness/diagnostics/types.ts:111-116` (`ResolutionMove`) | Extend with `slide?` to match Convex shape. WP-B owns. | WP-B |
| `convex/llm/inputBuilder.ts` | `visibleEntryFor` produces rect-keyed entries with `shape` discriminator (lines 314-374 replaced). `buildVisibleObject` (lines 385-428) replaces the `walls` and `cover` collection paths; cap retained (≤ 12 wall entries / ≤ 12 cover entries by closest); the manual Evac append at lines 414-421 is **deleted** (the engine emits `evac_rect` directly, per Q5/D7). `renderMoveFragment` (lines 138-146) renders the new `hugged Wall_*` outcome-line variants — reads `slide.axis` directly (D9) and projects `slide.intent` via `renderCharacterTypedId` / rect-id pretty-printer at render time (D6). `PrevTurnRow.resolution.moves[]` shape extended with `slide?` (per §3.1.7). `compassDirection` extended (or a sibling `bearingOrHere`) to return `"here"` when `from === to`. | WP-C |
| `convex/llm/idNormalisation.ts` | `parsePositionId` extended to parse both `<Prefix>_<x>_<y>` and `<Prefix>_<x1>_<y1>_to_<x2>_<y2>`. `ResolvedEntity` gains `rect?: Wall` (D10) — populated for `wall` / `cover` / `evac` kinds. `resolveTypedEntity` for Wall / Cover / Evac returns `{ kind, tile: nearestTileOfRect(observerPos, rect), stopAtRange, rect }`. `visibleTargetIds` (lines 112-152) extended to emit the **rect-key form** the engine emits per visible rect entity (one canonical key per rect, replacing per-tile `Wall_<x>_<y>` / `Cover_<x>_<y>` emissions for rects with w·h > 1). The legacy bare `Evac` literal at line 150 is replaced with the rect-keyed Evac id. | WP-C |
| `convex/llm/decisionTool.ts` | **No edit** — `targetId` is open string, accepts the new rect-keyed ids verbatim. | — |
| `convex/llm/systemPrompt.ts` | **No edit** — system prompt does not reference id grammar; the keyed Visible payload self-describes. | — |
| `personas/*.md` (8 files) | Verify no dead refs (no coord literals, no `Wall_<x>_<y>` ids). Likely no-op based on initial scan. Mechanical scrub only — no behaviour tuning. | WP-D |
| `convex/reports/phase9.ts` (new file) | Closing-20 aggregator + `persistComputedPhase9Report` mutation mirroring `phase7.ts:707-788`. Slice-specific counters per `phase9PayloadValidator` (§WP-E §2). | WP-E |
| `convex/schema.ts` (reports table) | Add `phase9PayloadValidator` declaration (sibling to `phase7PayloadValidator`) AND `phase9Payload: v.optional(phase9PayloadValidator)` on the `reports` table (sibling to `phase7Payload` at `schema.ts:870`). **Do NOT extend the existing `reports.payload` field** — it is the exact `reportPayloadValidator` at `schema.ts:668`, not `v.any()` (D11). | WP-E |
| `convex/turnsDerived.ts` (`projectSlimTurnRow` and per-record projection) | Add phase-9 evidence fields to slim projection: `visibleRectKeys: string[]`, `insideBearingHere: boolean`, `observerPos: Tile` per agent-record; `worldState` join via new `worldState.byMatchId` query (per match, not per turn) — see WP-E §1. | WP-E |
| `harness/diagnostics/types.ts` (slim record types) | Mirror the slim-projection additions (`visibleRectKeys`, `insideBearingHere`, `observerPos`) so the CLI/dashboard consumers can read them. | WP-E |
| `tests/engine/vision.test.ts` | Replace per-tile wall/cover assertions with per-rect; add wall-on-wall occlusion case; add LOS-aggregation case (partially occluded multi-tile wall emits the whole rect). | WP-A |
| `tests/engine/movement.test.ts` | Add slide-case suite per §6.1 cucumber rows. | WP-B |
| `tests/llm/inputBuilder.test.ts` | Replace per-tile wall/cover Vision assertions with per-rect (key format, shape value, dist/bearing against nearest tile, `bearing: "here"` for inside). Add rect-keyed Evac case (inside + outside). Add slide-outcome-line assertions for `renderMoveFragment`. | WP-C |
| `tests/llm/idNormalisation.test.ts` | Add rect-id parse cases for Wall / Cover / Evac. Add nearest-tile resolution against observer fixture. | WP-C |
| `tests/engine/map.test.ts` | Assert `expandMap` returns `coverClusters` matching descriptor. | WP-A |
| `apps/replay/**` | **No edit.** Replay reads canonical `worldState` and reconstructs entity positions from `resolution.moves[]`. Walls/cover/evac render from raw rectangles (unchanged) — they don't touch the LLM Vision keys. | — |
| `harness/diagnostics/**` | **No edit.** Diagnostics CLI reads action traces and rejection reasons, not wall/cover/evac Vision keys directly. WP-E confirms by smoke-checking the diagnostics output. | — |

### 3.4 Data flow

```
MapDescriptor (maps/reference.json)
    └─→ coverClusters (10 rects)
            ├─→ WorldState.coverClusters     ← NEW
            └─→ WorldState.coverTiles        ← existing (unrolled, hiding only)

WorldState.walls (28 rects)
    ├─→ hasLineOfSight (LOS blocker — unchanged semantics)
    ├─→ movement.tileBlockedByWall  (slide algorithm consumes wall set)
    └─→ vision.ts emit:
            for each wall rect → LOS-aggregate → wall_rect VisibleEntity

WorldState.coverClusters
    └─→ vision.ts emit:
            for each cluster → LOS-aggregate → cover_rect VisibleEntity

WorldState.evac
    └─→ vision.ts emit (post-reveal, range-uncapped):
            → evac_rect VisibleEntity { rect: 3×3 zone }

VisibleEntity[]  (rect-grained for walls / cover / evac)
    │
    ├─→ inputBuilder.visibleEntryFor → rect-keyed JSON
    │        key: Wall_<x1>_<y1>_to_<x2>_<y2>
    │        value: { dist, bearing, shape }  // bearing="here" when inside
    │
    └─→ idNormalisation.resolveTypedEntity
             parses rect key → resolves nearest tile of rect from observer
             returns ResolvedEntity { kind, tile, stopAtRange, rect }    // D10: rect carried
                │
                └─→ movement substep loop
                       targetTileForMover() reads mover.resolvedTarget.rect
                                          recomputes nearestTileOfRect per substep
                       desiredNextTile() steps toward/away from nearest tile
                       slide algorithm fires when diagonal step is wall-blocked
                       MoveTraceEntry { slide: { wallRectId, axis, intent } }
                                                                  // D6+D9:
                                                                  //   axis = engine-written cardinal
                                                                  //   intent = verbatim "toward <targetId>" / "away <targetId>" / compass letters
                            │
                            └─→ inputBuilder.renderMoveFragment
                                   reads slide.axis directly (D9 — no delta derivation)
                                   projects slide.intent via renderCharacterTypedId (D6)
                                   →  "hugged Wall_18_18_to_23_18 E toward Duelist"
```

### 3.5 What is intentionally NOT changed

| Surface | Why preserved |
|---|---|
| `hasLineOfSight` (vision.ts:102-121) | Bresenham + wall-blocker semantics are correct; only the *callsite* gate changes (walls now gate on this too). |
| `hiding.ts` / `isInCover` | Per §3.1.1; uses `coverTiles` flat list; rect grouping is irrelevant to hiding. |
| `decisionTool.ts` | `targetId` is open string; new rect ids parse transparently. No schema-variant work. |
| `systemPrompt.ts` | No id grammar references; the keyed Visible payload self-describes. |
| `apps/replay/**` | Reads canonical `worldState`; renders walls/cover/evac as raw rectangles. Pillar 7 (state is the contract) holds — replay doesn't see the LLM Vision keys. |
| Diagnostics CLI shape | Existing per-field validator rejection, attack/loot funnels, kill feed, etc. continue. New phase-9 counters land in WP-E. |
| Cardinal-direct wall hits | Dead-stop preserved verbatim (existing wording `tried to move and hit wall`). The slide is *only* for diagonal blocks. |
| `coverTiles` field on WorldState | Per §3.1.1 — kept to isolate hiding-logic risk. |
| Chebyshev-20 vision cap | Walls and cover now LOS-gated *and* range-gated. Evac is the only range-uncapped entry once revealed. |

## 4. Dependency Map

```
              ┌──────────── WP-D (persona scrub) ────────────────┐
              │   (independent; verify-only, likely no-op)        │
              │                                                   │
WP-A (engine substrate) ┐                                          ▼
   types + vision        ├──→ WP-C (LLM projection) ──────→ WP-E (closing-20)
   coverClusters         │      inputBuilder + idNorm          report + attest
   schema/matches        │
WP-B (movement slide) ───┘
   movement + slide-trace
```

**Parallelisation opportunity:**
- Round 1 (3 in parallel): **WP-A**, **WP-B**, **WP-D**.
- Round 2 (serial): **WP-C** (consumes WP-A's `VisibleEntity` shape change and WP-B's `MoveTraceEntry.slide` field; declares `ResolvedEntity.rect?` per D10 which WP-B's test seam injects in fixture).
- Round 3 (serial): **WP-E** (closing-20 needs all code WPs landed; extends slim projection per D11/§WP-E §1).

Round-1 contention: WP-A and WP-B both touch nothing the other touches
(vision.ts + types.ts + matches.ts + map.ts + hiding tests vs
movement.ts + movement tests + slide-persistence touch points). WP-A
adds `coverClusters` to `convex/schema.ts`; WP-B adds the `slide`
field on `moves[]` in the same file — disjoint validator
sub-objects, but the file overlaps. **Merge order rule:** the engineer
landing WP-A pulls in WP-B's schema diff (or vice versa) before
committing; the two changes are syntactically independent.

WP-D touches `personas/*.md` and `convex/_data/personas.ts` only
(verification pass — no overlap with A or B).

WP-A introduces a typed-union shape change on `VisibleEntity` (the
old `{kind:"wall", pos}` and `{kind:"cover", pos}` variants are gone).
WP-C is the only consumer that will fail to typecheck during WP-A's
window — but WP-C only starts after WP-A merges, so the type break is
contained.

**WP-B's rect-target test seam (Review A HIGH-2 resolved):** the
rect-target dynamic-resolution path needs `ResolvedEntity.rect` to be
populated, which is WP-C's territory. WP-B includes a tiny
test-fixture helper that injects `rect: Wall` directly into the
mover's resolved-target state (no production code-path divergence) —
this keeps WP-B's rect-target movement test independent of WP-C
completion. The production wiring (`resolveTypedEntity` populating
`rect`) lands in WP-C; the end-to-end integration is naturally
exercised by `tests/llm/integration.test.ts` and the WP-E closing-20.

## 5. Work Package Breakdown

### WP-A — Engine substrate: types + coverClusters + LOS uniform + rect emit

**Goal:** The engine emits walls / cover patches / evac as rect-grained
`VisibleEntity` entries, with uniform LOS gating including wall-on-wall.
The `WorldState` carries `coverClusters` alongside `coverTiles`. All
unit tests at the engine layer pass.

**Scope:**

1. **Types (`convex/engine/types.ts`):**
   - Add `coverClusters: Wall[]` to `WorldState`.
   - Add `Shape` type alias: `"single" | "E-W line" | "N-S line" | "patch"`.
   - Replace `VisibleEntity` `wall` / `cover` variants with `wall_rect` /
     `cover_rect` carrying `{ rect: Wall, shape: Shape }`.
   - Add a new `evac_rect` variant: `{ kind: "evac_rect", rect: Wall, shape: Shape }`.

2. **Schema (`convex/schema.ts`):**
   - Add `coverClusters: v.array(wallValidator)` to the `worldState` table.
   - Dev DB wipe expected (existing rows lack the field). Documented in §7.

3. **Map expansion (`convex/engine/map.ts` + `convex/matches.ts`):**
   - `expandMap` / `expandMapInline` add `coverClusters: descriptor.coverClusters`
     to the returned `WorldState`.
   - `matches.start` inserts `coverClusters` in the `worldState` row.
   - `runMatch.buildMatchState` reads `coverClusters` from the row.

4. **Vision (`convex/engine/vision.ts`):**
   - Delete the wall LOS carve-out (lines 214-228).
   - Add helpers `rectMinChebyshev(observer, rect)`,
     `rectHasAnyTileWithLos(world, observer, rect)`, `shapeOf(rect)`.
   - Rewrite wall emission to iterate `state.world.walls`, range-gate,
     LOS-aggregate, emit per-rect `wall_rect`.
   - Rewrite cover emission to iterate `state.world.coverClusters`,
     range-gate, LOS-aggregate, emit per-rect `cover_rect`. Retain
     12-cover-rect cap (sorted by min-Chebyshev distance to observer).
   - Add evac emission: when `evac.revealedAtTurn !== null`, emit one
     `evac_rect` entry **unconditional on Chebyshev range and LOS**.

5. **Tests — cucumber → named test mapping:**
   - `tests/engine/map.test.ts`: assert `expandMap` returns
     `coverClusters` matching the descriptor's `coverClusters`.
   - `tests/engine/vision.test.ts`:
     - Replace per-tile wall/cover assertions with per-rect.
     - **§6.1 scenario 1 — wall-on-wall LOS occlusion** (Review A
       MED-5 construction recipe):
       - Fixture A (1×1 occluded by 1×1): observer at `(10,10)`; wall
         A at `{x:5, y:10, w:1, h:1}`; wall B at `{x:3, y:10, w:1, h:1}`.
         Bresenham `(10,10)→(3,10)` traverses `(5,10) ∈ A` →
         **assert wall B absent from Vision; assert wall A present
         (`Wall_5_10` rect-key form for 1×1)**.
       - Fixture B (multi-tile fully occluded): observer at `(10,10)`;
         wall A at `{x:5, y:8, w:1, h:5}` (vertical line covering y=8..12);
         wall B at `{x:3, y:8, w:1, h:5}` (vertical line covering y=8..12).
         Every tile of B requires a Bresenham trace through some tile
         of A (since A is a vertical wall on x=5 spanning B's y-range
         from observer at x=10). → **assert wall B absent from Vision
         entirely; assert wall A present as `Wall_5_8_to_5_12`.**
     - **§6.1 scenario 2 — non-wall entities remain LOS-gated**
       (regression preservation, Review A MED-4 / Review B MED):
       - Chest behind a wall → not in Vision.
       - Corpse behind a wall → not in Vision.
       - Cover cluster fully occluded by a wall → not in Vision (per
         §3.1.4 aggregation rule: if ZERO tiles of the cover cluster
         have LOS, the cluster does not emit).
       - Cover cluster *partially* occluded by a wall (≥ 1 tile has LOS)
         → entire cluster emits as one `cover_rect` key (LOS
         aggregation rule, §3.1.4).
     - **§6.1 scenario 3 — Evac is the only non-LOS-gated entry**:
       observer at Chebyshev > 20 from evac centre but
       `revealedAtTurn !== null` — assert `evac_rect` is in visible
       set. (Same fixture serves as the WP-E
       `evacOutOfChebyshev20Count` evidence at integration layer.)
     - **§6.3 LOS aggregation** (partially occluded multi-tile wall):
       assert the whole rect emits as one `wall_rect` entry.
     - **§6.3 multi-tile wall self-LOS** (Review C LOW + Review B MED):
       observer adjacent to a 5-tile vertical wall at `(5,8)..(5,12)`;
       Bresenham from observer to each tile of the wall does not
       traverse other tiles of the same wall (`hasLineOfSight` skips
       endpoints — confirm). → assert the wall emits as one
       `Wall_5_8_to_5_12` entry, not absent due to "self-occlusion".
     - **Inside-state propagation**: observer inside cover cluster →
       the `cover_rect` entry is still present; nearest-tile-vs-observer
       sanity (the `(nx, ny) === (ox, oy)` case — serialisation-layer
       `bearing: "here"` is asserted in WP-C).
     - **§6.3 chests/corpses/characters point-keying preserved**: a
       chest emits as `Chest_<x>_<y>`, a corpse as `Corpse_<name>`, a
       character as `<PersonaName>` — no rect aggregation, no `_to_`
       suffix.

**Test design (testing trophy):**

| Layer | Coverage |
|---|---|
| Unit (engine) | All scenarios above. Engine vision is pure-function; suite is fast. |
| Integration | Not required at this WP — integration happens at WP-C. |
| E2E | Smoke run deferred to WP-E. |

**Success criteria:**

- `WorldState.coverClusters` populated post-`expandMap`; dev DB wipe
  applied; new matches start cleanly.
- `vision.ts` emits rect-keyed `wall_rect` / `cover_rect` / `evac_rect`
  entries; no remaining `kind: "wall"` / `kind: "cover"` literals.
- Wall-on-wall occlusion test passes (a wall behind a wall is NOT
  visible).
- LOS-aggregation test passes (partially occluded multi-tile wall emits
  as one rect).
- Evac uncapped emit verified.
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` all
  green (WP-C will not yet typecheck — see Dependency Map; WP-A is
  considered green when its own tests pass and WP-C is the boundary).

> **Validation logistics:** since WP-A's type change breaks WP-C's
> compile, run WP-A's tests against a typecheck-suppressed local build
> (`npm run test -- tests/engine/`). Full `typecheck` + `build` gates
> after WP-C lands.

### WP-B — Movement substrate: wall-slide algorithm + trace marker

**Goal:** Diagonal `toward` / `away` / compass moves that hit a wall
slide on the unblocked cardinal axis. Cardinal-direct hits keep
dead-stopping. The trace carries enough information to render
`hugged Wall_*` outcome lines.

**Scope:**

1. **Algorithm (`convex/engine/movement.ts`):**
   - Extend `MoveTraceEntry` (engine type) with
     `slide?: { wallRectId: string; axis: "N"|"E"|"S"|"W"; intent: string }`
     per §3.1.6 / D6 / D9.
   - In the substep commit loop (around lines 320-330), when a desire
     fails the `isBlocked` check AND the failure cause is `tileBlockedByWall`
     AND the step delta has both `sx !== 0` and `sy !== 0`:
     - Probe `A = (mx + sx, my)` and `B = (mx, my + sy)`.
     - If exactly one is unblocked → slide to that tile; emit slide
       trace entry.
     - If both are unblocked → slide to A (X-axis preferred); emit
       trace.
     - If both blocked → fall through to existing dead-stop path
       (no slide trace).
   - Slide commits 1 tile of budget like a normal step.
   - Compute `wallRectId` by finding which wall rect contains the
     blocked diagonal tile T; encode via
     `formatWallRectId(rect: Wall): string` → `Wall_<x1>_<y1>_to_<x2>_<y2>`
     (or 1×1 form).
   - Compute `axis` from the cardinal the engine slid on:
     `A` chosen → axis `"E"` if `sx>0` else `"W"`; `B` chosen → axis
     `"S"` if `sy>0` else `"N"`. **The engine writes axis explicitly
     into `slide.axis` (D9)** — no renderer-side delta derivation.
   - Compute `intent` per D6 — engine writes the agent's stated intent
     **verbatim**, no display-name lookup:
     - Compass arm → the compass letters (`"NE"` | `"SE"` | `"SW"` | `"NW"`).
     - `toward { targetId }` → `"toward <targetId>"` — `targetId` is the
       exact string the agent emitted (a persona name like `"Duelist"`,
       a corpse id like `"Corpse_Duelist"`, a chest id like
       `"Chest_53_54"`, or a rect id like `"Wall_18_18_to_23_18"`).
     - `away { targetId }` → `"away <targetId>"` — same verbatim rule.
   - **No imports of `renderCharacterTypedId` / display-name machinery
     in `movement.ts`.** That's the WP-C renderer's job.

2. **Rect-target dynamic resolution (D10):**
   - The substep loop's `targetTileForMover` (lines 93-105) reads
     `mover.resolvedTarget.rect` (the `rect?: Wall` field added to
     `ResolvedEntity` — see WP-C §3) and recomputes
     `nearestTileOfRect(rect, mover.pos)` per substep, so as the mover
     slides closer the "nearest" tile updates. For character targets
     the existing live-`pos` lookup stays. **No re-parsing of `targetId`
     per substep, no `state.world` lookup helper indirection** — the
     rect blob is on the resolved entity.

3. **Slide persistence — schema + adapters + slim + diagnostics
   (D12; see §3.1.7 for the full enumeration).** WP-B owns these
   files; they all extend the `slide` field through:
   - `convex/schema.ts:302-314` `moves[]` validator → add
     `slide: v.optional(v.object({ wallRectId: v.string(), axis: v.union(N|E|S|W), intent: v.string() }))`.
   - `convex/runMatch.ts:481-489` `adaptResolutionForSchema.moves.map` →
     conditional-spread `slide` into the persisted row.
   - `convex/runMatch.ts:591-596` prior-turn `resolution.moves.map`
     adapter → conditional-spread `slide` into `PrevTurnRow`.
   - `convex/llm/inputBuilder.ts` `PrevTurnRow` type → extend
     `resolution.moves[]` shape with `slide?`. (Renderer logic itself
     belongs to WP-C.)
   - `convex/turnsDerived.ts:589` (`projectSlimTurnRow`) → confirm
     `slide` survives `byMatchSlim` (it should — `resolution` is passed
     through). Add a slim-projection regression test if drift risk
     warrants.
   - `harness/diagnostics/types.ts:111-116` (`ResolutionMove`) →
     extend with `slide?: { wallRectId, axis, intent }`.

4. **Dead-stop path preservation:**
   - The existing wall-blocked emit (lines 353-410) keeps firing for
     cardinal-direct hits and both-fallback-blocked cases. No regression
     in `blockedBy: "wall"` semantics.

5. **Tests (`tests/engine/movement.test.ts`):**
   - Diagonal compass move (NE) blocked by wall on diagonal tile, X-axis
     cardinal clear → slides E, trace
     `{slide: {wallRectId, axis: "E", intent: "NE"}}`.
   - Same with Y-axis cardinal clear → slides N, trace
     `{slide: {wallRectId, axis: "N", intent: "NE"}}`.
   - Toward-target diagonal blocked → slides on unblocked axis, trace
     `{slide: {..., axis, intent: "toward <verbatim targetId>"}}` —
     **assert `intent` carries the raw `targetId` the agent emitted**
     (e.g. `"toward Duelist"` if the agent emitted `"Duelist"`,
     `"toward Wall_18_18_to_23_18"` if it emitted that rect id).
   - Away-target diagonal blocked → analogous, `intent: "away <verbatim
     targetId>"`.
   - Cardinal-direct (E into a wall) → dead-stop, no slide, existing
     `blockedBy: "wall"` trace.
   - Both fallbacks blocked (wall + character) → dead-stop, no slide.
   - Both fallbacks clear → slides X-axis (tie-break verified).
   - Multi-substep slide: 4-tile diagonal move past a 1×1 wall →
     observes the mover slides one tile then continues toward target on
     subsequent substeps. Asserts the `slide` field is populated **only
     once per `MoveTraceEntry`** (the first substep slide); subsequent
     substeps do not overwrite.
   - **Rect-target dynamic-resolution test:** aggregated `Wall_*_to_*`
     target → mover paths toward nearest tile of rect; nearest tile
     updates per substep. **Fixture pre-populates
     `mover.resolvedTarget.rect`** (a tiny test seam — see "WP-B
     independence" below). Cucumber §6.4 toward and away both covered.
   - **Persistence smoke test:** roundtrip `MoveTraceEntry.slide`
     through `adaptResolutionForSchema` and back through the
     prior-turn adapter — assert the slide field survives end-to-end.

**WP-B independence (Review A HIGH-2 / Review B MED).** The slide
algorithm and persistence touch points are fully independent of WP-A
and WP-C. The **rect-target dynamic-resolution test** has one
dependency: `mover.resolvedTarget.rect` is populated by
`resolveTypedEntity` (idNormalisation.ts), which is WP-C's territory.

**Decision (locked):** WP-B includes a **tiny harness seam** in its
movement-test fixture that injects a `rect: Wall` directly into the
mover's resolved-target state, instead of waiting for WP-C's parser.
This keeps the rect-target movement test independent of WP-C
completion. The seam is a test-only construct (e.g. a builder helper
`makeMoverWithRectTarget(rect)`); production `movement.ts` reads
`mover.resolvedTarget.rect` the same way it would in production —
no code-path divergence.

WP-A defines `Wall.rect` shape and `WorldState.coverClusters`
unchanged; WP-B can read those types without depending on WP-A's
runtime emit changes.

**Test design:**

| Layer | Coverage |
|---|---|
| Unit | All slide scenarios above. Pure function; fast suite. |
| Integration | Resolution-level integration test (one match's worth of
  decisions exercising slide) — defer to WP-E smoke. |

**Success criteria:**

- All cucumber slide scenarios pass (§6.2 mapped to named tests above;
  §6.4 toward/away rect-target tests included).
- No regression in existing movement tests (toward/away/relative/none,
  compass moves, collision, conflict resolution).
- `MoveTraceEntry.slide` populated correctly with
  `{wallRectId, axis, intent}` — `intent` carries the **verbatim**
  `targetId` for toward/away (D6); engine writes axis explicitly (D9).
- Slide persists end-to-end through schema → `runMatch` adapters →
  `PrevTurnRow` → slim projection → diagnostics types (§3.1.7 / D12).
- Lint / typecheck / test / build green for engine-layer tests
  (movement, persistence smoke). Full build gates after WP-C.

### WP-C — LLM projection: rect-key serialisation + slide outcome line + id parsing

**Goal:** The LLM-facing Vision JSON is rect-keyed with `shape`
discriminator and "here" inside-state. Outcome lines render slide
events. `resolveTypedEntity` parses rect ids and resolves to nearest
tile of the rect against the observer.

**Scope:**

1. **`convex/llm/inputBuilder.ts`:**
   - Rewrite `visibleEntryFor` for `wall_rect` / `cover_rect` /
     `evac_rect` variants. Key construction:
     - 1×1 → `<Prefix>_<x>_<y>`.
     - else → `<Prefix>_<x1>_<y1>_to_<x2>_<y2>`.
   - `value` per rect entry: `{ dist, bearing, shape }`.
   - Compute `dist`/`bearing` against **nearest tile of rect** —
     helper: `nearestTileOfRect(observer, rect): Tile`.
   - Add `bearingOrHere(from, to): string` — returns `"here"` when
     `from.x === to.x && from.y === to.y`, else current compass output.
   - `buildVisibleObject` (lines 385-428): replace cover/wall iteration
     with rect-keyed; retain ≤12 wall and ≤12 cover entries (sorted by
     min-distance). Evac is now a rect-keyed entry emitted by the engine
     directly; remove the manual Evac append at lines 414-421 (engine
     handles it).
   - Drop the `observerInEvacZone` Vision-suppression (existing line 413-414) —
     evac entry now always emits when revealed, with `"here"` bearing
     for observers inside. The Status block's `Inside Evac` / `Outside Evac`
     flag (lines 441-443) is retained.

2. **`renderMoveFragment` (lines 138-146) — D6/D9 locked:**
   - When `entry.slide` is present, render exactly one of:
     - Compass case (`slide.intent ∈ {"NE","SE","SW","NW"}`):
       → `hugged <slide.wallRectId> <slide.axis>`
     - Toward case (`slide.intent` starts with `"toward "`):
       → `hugged <slide.wallRectId> <slide.axis> toward <projectedTarget>`
     - Away case (`slide.intent` starts with `"away "`):
       → `hugged <slide.wallRectId> <slide.axis> away from <projectedTarget>`
   - **Axis is read directly from `slide.axis` (D9). Do NOT derive from
     `entry.from`→`entry.to` delta.** The aggregate `MoveTraceEntry` is
     start-to-final and a multi-substep move's delta is not the
     slide-substep delta (e.g. NE move slides E then continues NE →
     aggregate delta NE, slide axis E, delta derivation produces "NE"
     which is wrong).
   - **`projectedTarget` projection (D6):** the engine wrote
     `slide.intent` carrying the verbatim agent-emitted `targetId`. The
     renderer strips the leading `"toward "` / `"away "` to extract
     `targetId`, then calls `renderCharacterTypedId(state, targetId)`
     for character / corpse ids (which returns the persona display
     name) or passes the rect id (`Wall_*_to_*`, `Cover_*_to_*`,
     `Evac_*_to_*`) through unchanged. Chest ids (`Chest_<x>_<y>`)
     pass through unchanged.
   - The existing `dist === 0` early-return (line 144) is bypassed when
     `entry.slide` is present (slide always has a non-zero step).

3. **`convex/llm/idNormalisation.ts` — D10 locked:**
   - Extend `parsePositionId` to accept both forms (single and rect).
     Return either a `Tile` or a `Rect` discriminated result.
   - **`ResolvedEntity` type gains `rect?: Wall` field** (D10):

     ```ts
     export type ResolvedEntity = {
       kind: "character" | "chest" | "corpse" | "cover" | "wall" | "evac";
       tile: Tile;
       stopAtRange: number;
       rect?: Wall;                  // NEW — populated for wall/cover/evac kinds
       engineRef?: { characterId?: string; chestId?: string };
     };
     ```

     The `rect` blob is the canonical rect the engine reasons about
     for dynamic nearest-tile resolution (WP-B reads
     `mover.resolvedTarget.rect` per substep — see WP-B §2).
   - `resolveTypedEntity`:
     - For `Wall_*` / `Cover_*` / `Evac_*`: parse to rect, look up the
       rect on `state.world.{walls, coverClusters, evac}` (existence
       check), then return
       `{kind, tile: nearestTileOfRect(observerPos, rect), stopAtRange, rect}`.
     - 1×1 form continues to work (rect with `w=1, h=1`). **The
       resolver MUST verify the parsed tile corresponds to an actual
       wall/cover rect with `w=h=1` in `state.world.{walls, coverClusters}`**
       — a stray `Wall_30_60` that doesn't match any real wall returns
       `null`. (The reference map has zero 1×1 rects today; the
       single-tile unit test pre-populates a synthetic 1×1 fixture —
       see WP-C §5.)
     - Evac: parse the rect form `Evac_<x1>_<y1>_to_<x2>_<y2>`; verify
       against `state.world.evac.centre` (`x1=cx-1`, `y1=cy-1`,
       `x2=cx+1`, `y2=cy+1`). Return
       `{kind: "evac", tile: nearestTileOfRect(observerPos, evacRect),
       stopAtRange: 0, rect: evacRect}`.
   - **`visibleTargetIds` (lines 112-152) — rect-key emission (Review A
     LOW-7):** emit the canonical rect-key form per visible rect
     entity (one key per rect, matching what the engine emits). For
     multi-tile walls/cover, emit `Wall_<x1>_<y1>_to_<x2>_<y2>` /
     `Cover_<x1>_<y1>_to_<x2>_<y2>`; for 1×1, emit the single-coord
     form. **Do not** emit per-tile keys for multi-tile rects — the
     LOS-visibility gate would otherwise reject legitimate rect-id
     targets. The bare `"Evac"` literal at line 150 is replaced with
     `Evac_<x1>_<y1>_to_<x2>_<y2>`.

4. **`compassDirection` (lines 65-74):** retain; add a sibling helper
   `bearingOrHere` that returns `"here"` for the same-tile case, used
   only by Vision-entry construction. Existing callers (outcome
   fragment) keep using `compassDirection` unchanged.

5. **Tests:**

   `tests/llm/inputBuilder.test.ts` — **cucumber → named test mapping:**
   - **§6.3 multi-tile wall** → `multi-tile wall rect emits as
     Wall_x1_y1_to_x2_y2 with shape "E-W line" / "N-S line" / "patch";
     dist/bearing computed against nearest tile`.
   - **§6.3 single-tile wall** → `1×1 wall rect emits as Wall_x_y key
     with shape "single"`.
   - **§6.3 cover patch** → `cover cluster emits as
     Cover_x1_y1_to_x2_y2 with shape "patch"`.
   - **§6.3 inside enterable terrain** → `observer on cover patch: entry
     has dist:0 bearing:"here"`; `observer inside evac: entry has dist:0
     bearing:"here"`.
   - **§6.3 evac stays visible** → `evac at Chebyshev > 20 from
     revealed-evac observer: Evac_*_to_* entry present in Vision`.
   - **§6.3 last scenario (point-keying preserved)** → `chest visible:
     Chest_x_y key present, no aggregation; corpse visible: Corpse_<name>
     key present; character visible: <PersonaName> key present`. Asserts
     no `_to_` suffix and no rect aggregation for non-terrain entities.
   - **§6.1 scenario 2 (non-wall entities LOS-gated)** → `chest behind
     wall: Chest_x_y absent from Vision`; `corpse behind wall: Corpse_*
     absent from Vision`; `cover patch fully occluded by wall: Cover_*
     absent from Vision` (regression preservation; integrate with
     WP-A engine assertions at integration-test layer).
   - **§6.2 outcome lines (slide rendering):**
     - Compass-only slide intent `"NE"` → `hugged Wall_*_*_to_*_* E`
       (axis from `slide.axis`, not delta).
     - Toward slide intent `"toward Duelist"` (character id) → renderer
       projects via `renderCharacterTypedId` → `hugged Wall_*_*_to_*_* E
       toward Duelist`.
     - Toward slide intent `"toward Wall_18_18_to_23_18"` (rect id) →
       renderer passes through → `hugged Wall_*_*_to_*_* E toward
       Wall_18_18_to_23_18`.
     - Away slide intent `"away Camper"` → `hugged Wall_*_*_to_*_* W
       away from Camper` (renderer adds "from").
     - **Multi-substep slide aggregate-delta divergence test:** trace
       has `from=(5,5) to=(7,4)` (NE move that slid E then continued
       NE) but `slide.axis="E"`. Renderer must emit "E" axis letter,
       **not** "NE" — proves D9 derive-from-delta would have failed.

   `tests/llm/idNormalisation.test.ts`:
   - Parse `Wall_18_18_to_23_18` → rect `{x:18, y:18, w:6, h:1}`.
   - Parse `Cover_42_42_to_43_43` → rect `{x:42, y:42, w:2, h:2}`.
   - Parse `Evac_47_47_to_49_49` → rect `{x:47, y:47, w:3, h:3}`.
   - **`Wall_30_60` (1×1 fallback) with synthetic 1×1 fixture** —
     fixture pre-populates `state.world.walls = [{x:30,y:30,w:1,h:1}]`
     (Review A LOW-8). The reference map has none; the resolver MUST
     return `null` for an id with no matching rect.
   - **`resolveTypedEntity` returns `rect` field for wall/cover/evac**
     (D10) — assert the returned `ResolvedEntity.rect` matches the
     parsed rect.
   - `resolveTypedEntity` returns nearest-tile for the observer (not
     centroid).
   - Hallucinated rect id (doesn't match any known wall/cover/evac) →
     returns `null`.
   - **`visibleTargetIds` rect-key emission** (LOW-7): a multi-tile
     visible wall produces exactly `Wall_<x1>_<y1>_to_<x2>_<y2>` in the
     set, not per-tile `Wall_<x>_<y>` for each constituent tile.
   - **`visibleTargetIds` Evac rect-key**: revealed evac produces
     `Evac_<x1>_<y1>_to_<x2>_<y2>`, not bare `"Evac"`.

**Test design:**

| Layer | Coverage |
|---|---|
| Unit (LLM projection) | Vision-entry shape + outcome-line rendering. |
| Unit (id parsing) | Rect parse + nearest-tile resolution. |
| Integration | `tests/llm/integration.test.ts` natural coverage: a turn
  through `buildAgentInput` exercises the full pipeline including
  rect-keying. Add one integration spec asserting the rendered
  Vision JSON contains rect keys end-to-end. |

**Success criteria:**

- Vision JSON contains rect-keyed entries for walls / cover / evac with
  `shape` discriminator.
- Inside-state observers get `dist: 0, bearing: "here"`.
- `renderMoveFragment` produces `hugged Wall_*` outcome lines for slide
  traces; axis read from `slide.axis` (D9), target projected from
  `slide.intent` via `renderCharacterTypedId` / rect-id pass-through
  (D6).
- `ResolvedEntity.rect` field populated for wall/cover/evac kinds
  (D10).
- `visibleTargetIds` emits canonical rect-key form (matching engine
  emit) per visible rect entity.
- `resolveTypedEntity` parses rect ids and resolves to nearest-tile;
  rejects unknown rect ids; single-tile resolver verifies the parsed
  tile corresponds to a real 1×1 wall/cover.
- All cucumber scenarios mapped to named tests above (no orphans).
- All four gates green: `npm run lint`, `npm run typecheck`,
  `npm test`, `npm run build` (full repo now compiles cleanly).

### WP-D — Persona prompt mechanical scrub

**Goal:** None of the 8 persona prompts reference dead field formats or
stale coord literals.

**Scope:**

1. Read each `personas/<id>.md` (8 files) **and**
   `convex/_data/personas.ts` (the runtime persona loader — Review B
   LOW). Both are scrub targets; if a future mechanical edit lands on
   the markdown source, the runtime constant must mirror it.
2. Search for references to:
   - `Wall_<x>_<y>` / `Cover_<x>_<y>` literals.
   - Tile coord literals (e.g. `(47, 47)`, `(48, 48)`).
   - Stale id grammar (`chest_NNN`, `Player_N`, etc. — likely already
     scrubbed in phase 6 / 7 but verify).
   - References to "wall tiles" that imply per-tile addressing.
3. Patch any dead refs **mechanically** — replace coord literals with
   `Wall_*` / `Cover_*` / `Evac_*` placeholders, or remove the line
   entirely if the reference is incidental. **Do not** rewrite persona
   behaviour or change phrasing beyond the dead-ref fix.
4. Generic prose like "occupy a cover tile" / "sneak between cover
   tiles" stays — the noun "cover tile" still parses post-rect-keying
   (the agent targets a cover *rect* and steps into it; "tile" remains
   accurate prose).

**Test design:**

| Layer | Coverage |
|---|---|
| Unit | `tests/llm/personas.test.ts` — assert each persona loads. No
  shape assertions on prose. |
| Manual | Quick visual diff of each persona md after scrub. |

**Success criteria:**

- All 8 personas load and parse.
- Zero coord literals or stale `Wall_<x>_<y>` references in persona md
  files.
- Persona behaviour-tuning explicitly out of scope — no semantic edits.
- Lint / test green.

> **Initial scan note (informational):** a `grep -i 'Wall_|Cover_|Evac_|tile|coord'` over
> `personas/*.md` finds only generic prose ("cover tile", "evac
> zone") — no coord literals, no stale ids. This WP is likely
> verify-only. Still scoped as a WP so the closure record can attest
> the personas were re-read against the new id grammar.

### WP-E — Closing-20 report + attestation

**Goal:** A persisted Convex closing-20 report with phase-9 thresholds
met. The user steps through the 20 runs in the existing replay UI to
confirm the new substrate feels right.

#### WP-E §1 — Closing data path (D11 locked)

**Decision: extend the slim projection with phase-9 evidence fields**
(option (a) from the review). Rationale: phase-7 already moved closing
reports onto the slim projection (`turnsDerived.byMatchSlim`) for the
16 MB read budget; introducing a dedicated full-turn query for phase 9
would re-import that read-budget risk. Slim-projection extension is
local, additive, and the data we need is small (per-turn observer pos,
rect-key set, slide-marker counts) — well under the 16 MB ceiling.

**Per-turn evidence the slim projection emits (additive — new optional
fields on `SlimAgentRecord` and `SlimTurnRow`):**

| Field | Source | Use |
|---|---|---|
| `slimAgentRecord.visibleRectKeys: string[]` | parse keys from `composedUserMessage` Vision block before heavy-text strip; collect any matching `/^(Wall|Cover|Evac)_/` | `wallRectKeyCount`, `coverRectKeyCount`, `evacRectKeyCount` |
| `slimAgentRecord.insideBearingHere: boolean` | parse Vision block for any entry with `"bearing":"here"` | `insideBearingHereCount` |
| `slimAgentRecord.observerPos: Tile` | extracted from Status block (`📍 (x,y)` line) | wall-on-wall occlusion detection + evac-Chebyshev-20 check |
| `slimTurnRow.resolution.moves[].slide` | passed through from full row | `slideOutcomeCount` |
| `slimTurnRow.worldState: { walls: Wall[], evac: { centre, revealedAtTurn } }` | new sibling query (one row per match, not per turn) — see below | `wallOnWallOcclusionCount` detection |

`worldState` is a per-match constant; fetch it once per match via a
new `worldState.byMatchId` query and join in the phase-9 aggregator.
No per-turn copy.

**Why parse Vision keys from `composedUserMessage` and not the
engine-level `VisibleEntity[]`?** The `composedUserMessage` is the
authoritative rendered surface; if rect keys appear there, they were
delivered to the LLM. Engine-level `VisibleEntity[]` could in
principle diverge from the rendered string (cap-truncation, ordering)
and is not persisted on the slim path. Parsing the rendered string is
the closing-bar contract — what the LLM actually saw.

#### WP-E §2 — `phase9PayloadValidator` shape (D11 locked)

New validator on `convex/schema.ts`, added as a sibling field on the
`reports` table (mirrors `phase3Payload` / `phase6Payload` /
`phase7Payload` pattern at `schema.ts:868-870`):

```ts
const phase9PayloadValidator = v.object({
  // ── Carry-over phase-7 gates (preserved where comparable) ────
  runCount: v.number(),
  extractionRate: v.number(),
  killRate: v.number(),
  equipRate: v.number(),
  speechRate: v.number(),
  personaSpread: v.number(),
  zeroCrashes: v.boolean(),
  zeroIllegalConsumableUse: v.boolean(),
  zeroPlayerNLiterals: v.boolean(),
  zeroWholeTurnValidatorZeroes: v.boolean(),
  perFieldRejectionRate: v.number(),
  allEightCompassBearingsExercised: v.boolean(),
  targetRelativeTowardExercised: v.boolean(),
  targetRelativeAwayExercised: v.boolean(),

  // ── Phase-9 slice-specific gates ─────────────────────────────
  wallRectKeyCount: v.number(),
  coverRectKeyCount: v.number(),
  evacRectKeyCount: v.number(),
  singleTileKeyForMultiTileRectCount: v.number(),
  slideOutcomeCount: v.number(),
  slideOutcomePerPersona: v.array(
    v.object({ personaId: personaIdValidator, count: v.number() }),
  ),
  wallOnWallOcclusionCount: v.number(),
  evacOutOfChebyshev20Count: v.number(),
  insideBearingHereCount: v.number(),

  // ── Gate flags ───────────────────────────────────────────────
  meetsExtractionThreshold: v.boolean(),
  meetsKillThreshold: v.boolean(),
  meetsEquipThreshold: v.boolean(),
  meetsSpeechThreshold: v.boolean(),
  meetsPersonaSpreadThreshold: v.boolean(),
  meetsZeroCrashThreshold: v.boolean(),
  meetsZeroIllegalConsumableThreshold: v.boolean(),
  meetsZeroPlayerNLiteralThreshold: v.boolean(),
  meetsZeroWholeTurnValidatorThreshold: v.boolean(),
  meetsPerFieldRejectionThreshold: v.boolean(),
  meetsCompassBearingsThreshold: v.boolean(),
  meetsTargetRelativeThreshold: v.boolean(),
  meetsWallRectKeyThreshold: v.boolean(),       // ≥ 1
  meetsCoverRectKeyThreshold: v.boolean(),      // ≥ 1
  meetsEvacRectKeyThreshold: v.boolean(),       // ≥ 1
  meetsSingleTileKeyDisciplineThreshold: v.boolean(), // count = 0 (no single-tile keys from multi-tile rects)
  meetsSlideOutcomeThreshold: v.boolean(),      // ≥ 20 (≥ 1 per persona on average across 20 runs)
  meetsWallOnWallOcclusionThreshold: v.boolean(), // ≥ 1 across the 20 runs
  meetsEvacOutOfChebyshev20Threshold: v.boolean(), // ≥ 1 (out-of-range observer sees Evac post-reveal)
  meetsInsideBearingHereThreshold: v.boolean(), // ≥ 1
  meetsAllThresholds: v.boolean(),
});
```

**Schema edits (`convex/schema.ts`):**

- Add `phase9PayloadValidator` declaration (sibling to
  `phase7PayloadValidator` block around lines 530-700).
- Add `phase9Payload: v.optional(phase9PayloadValidator)` field on
  the `reports` table definition (sibling to `phase7Payload` at line
  870).

**Note:** the existing `reports.payload` field stays
phase-1-shape-compatible (`reportPayloadValidator` at line 668) —
phase-9 carries the phase-1 view in the legacy `payload` field for
tooling compatibility (mirroring phase-7's
`persistPhase7Payload` at lines 707-756), while the slice-specific
metrics land in `phase9Payload`.

#### WP-E §3 — `persistComputedPhase9Report` mutation (D11 locked)

New mutation on `convex/reports/phase9.ts`, mirroring
`persistComputedPhase7Report` at `convex/reports/phase7.ts:768-788`:

```ts
export const persistComputedPhase9Report = mutation({
  args: {
    matchIds: v.array(v.id("matches")),
    overwrite: v.optional(v.boolean()),
    payload: v.any(),
  },
  handler: async (ctx, { matchIds, overwrite, payload }): Promise<{
    _id: string; existed: boolean; payload: Phase9Payload;
  }> => persistPhase9Payload(ctx, {
    matchIds, overwrite, payload: payload as Phase9Payload,
  }),
});
```

Internal `persistPhase9Payload` mirrors `persistPhase7Payload` —
computes `matchIdsHash`, looks up existing row by `(matchIdsHash,
reportType)`, inserts with `reportType: "phase-9-closing-20"`,
populates the carry-over `payload` field and the slice-specific
`phase9Payload` field.

#### WP-E §4 — Slim aggregator + harness invocation

1. **Slim aggregator (`convex/reports/phase9.ts`):**
   - Read all matches' slim turn rows via `turns.byMatchSlim` (already
     phase-7-proven path).
   - Read each match's `worldState` row via the new
     `worldState.byMatchId` query (one fetch per match).
   - Iterate slim turn rows and per-agent records to tally the
     counters defined in `phase9PayloadValidator`. Wall-on-wall
     occlusion detection: for each observer-turn, find walls within
     Chebyshev-20 of `observerPos` that are NOT in `visibleRectKeys`,
     then check via `hasLineOfSight` (re-imported from
     `convex/engine/vision.ts`) whether at least one is LOS-blocked
     by another wall.
   - Compute gate flags + `meetsAllThresholds` rollup.
   - Persist via `persistComputedPhase9Report`.

2. **Harness invocation:**
   - 20 matches, concurrency per the existing harness pattern
     (mirrors phase 7).
   - Persist with `reportType: "phase-9-closing-20"`.

3. **Tests:**
   - `tests/reports/phase9.test.ts` — fixture-driven aggregator
     contract (mirroring `phase7.test.ts`):
     - Fixture: one match with at least one rect-keyed wall in Vision
       → `wallRectKeyCount > 0`.
     - Fixture: one slide event → `slideOutcomeCount === 1`,
       `slideOutcomePerPersona[matching].count === 1`.
     - Fixture: one observer with Chebyshev-21 to evac centre and
       `Evac_*_to_*` in their `visibleRectKeys` →
       `evacOutOfChebyshev20Count === 1`,
       `meetsEvacOutOfChebyshev20Threshold === true`.
     - Fixture: wall A occludes wall B from observer pos → tally
       increments by 1.
     - Fixture: observer on cover patch with `"bearing":"here"` entry
       → `insideBearingHereCount === 1`.
     - Gate rollup: all phase-9 thresholds met → `meetsAllThresholds
       === true`.
   - `tests/turnsDerived.slim.test.ts` — assert slim projection
     surfaces `visibleRectKeys`, `insideBearingHere`, `observerPos`,
     `resolution.moves[].slide`.

4. **Attestation:**
   - Add a closing record to this README's §11 mirroring phase-7's
     closure section. Tally gate-by-gate evidence with the persisted
     `reportId`.
   - User walks through the 20 runs in the replay UI; brief
     thumbs-up/thumbs-down in §11.

**Test design:**

| Layer | Coverage |
|---|---|
| Unit | `tests/reports/phase9.test.ts` — fixture-driven aggregator
  contract (mirroring `phase7.test.ts`). |
| Integration | The closing-20 run itself is the integration test. |
| E2E | Replay-UI step-through is the human-verification leg. |

**Success criteria:**

- Persisted Convex report row with `reportType: "phase-9-closing-20"`
  and `metBar: true`.
- All preserved phase-7 gates pass.
- All phase-9 slice-specific gates pass.
- Zero crashes / failed matches in the canonical 20-set (Convex OCC
  transients replaced 1-for-1 per phase-6 / phase-7 precedent).
- User attestation captured in §11.

## 6. Acceptance criteria — cucumber

Source: the assignment north star. Reproduced here for traceability.

### 6.1 Uniform wall LOS

```
Scenario: Wall behind another wall is not visible
  Given walls A and B with B occluded by A from observer
  When the engine computes Vision for the observer
  Then wall B does NOT appear in Vision

Scenario: All entity types remain LOS-gated
  Given any character / chest / corpse / cover-rect is occluded by a wall
  When the engine computes Vision
  Then that entity does NOT appear in Vision

Scenario: Evac is the only non-LOS-gated entry
  Given evac has been revealed (turn ≥ 30)
  When the engine computes Vision for any agent
  Then Evac appears regardless of LOS or Chebyshev range
```

### 6.2 Wall-slide

```
Scenario: Diagonal compass move blocked → cardinal axis slide
  Given an agent commits a diagonal compass move (NE/SE/SW/NW)
  And the diagonal step tile is blocked by a wall
  And exactly one of the two cardinal axis tiles is unblocked
  When the engine resolves movement
  Then the agent moves along the unblocked cardinal axis
  And the outcome line reads "hugged Wall_<rect-id> <dir>"

Scenario: Toward / away move blocked diagonally → cardinal axis slide
  Given an agent commits "toward <target>" or "away <target>"
  And the diagonal step tile is blocked by a wall
  And exactly one of the two cardinal axis tiles is unblocked
  When the engine resolves movement
  Then the agent moves along the unblocked cardinal axis
  And the outcome line reads:
    "hugged Wall_<rect-id> <dir> toward <target>"   (toward variant)
  Or:
    "hugged Wall_<rect-id> <dir> away from <target>" (away variant)

Scenario: Cardinal compass move directly into a wall stops dead
  Given an agent commits a cardinal compass move (N/E/S/W)
  And the next tile is blocked by a wall
  When the engine resolves movement
  Then the agent stays in place
  And the outcome line keeps existing "tried to move and hit wall" wording

Scenario: Both cardinal axes blocked → no slide possible
  Given an agent commits a diagonal move
  And both cardinal fallback tiles are blocked
  When the engine resolves movement
  Then the agent stays in place
  And the outcome line keeps existing "tried to move and hit wall" wording

Scenario (tie-break): Both cardinal axes clear → slide on X-axis
  Given an agent commits a diagonal move
  And both cardinal fallback tiles are clear
  When the engine resolves movement
  Then the agent slides on the X-axis cardinal
  And the outcome line emits the X-axis direction letter
```

### 6.3 Rect-grained Vision emission

```
Scenario: Multi-tile wall surfaces as one keyed rect
  Given a wall rectangle spanning multiple tiles with LOS to observer
  When the engine computes Vision
  Then it surfaces as one Vision key Wall_<x1>_<y1>_to_<x2>_<y2>
  With shape ∈ {"E-W line", "N-S line", "patch"}
  And dist/bearing computed against the *nearest* tile of the rect

Scenario: Single-tile wall surfaces as single-coord key
  Given a wall rectangle that is exactly 1×1
  When the engine computes Vision
  Then it surfaces as Wall_<x>_<y> with shape "single"

Scenario: Cover patch surfaces as one keyed rect
  Given a cover cluster of multiple tiles
  When the engine computes Vision
  Then it surfaces as Cover_<x1>_<y1>_to_<x2>_<y2> with appropriate shape

Scenario: Inside enterable terrain uses uniform "here" bearing
  Given the agent is standing on a cover patch OR inside the evac zone
  When the engine computes Vision
  Then the entry has dist: 0 and bearing: "here"

Scenario: Evac stays visible regardless of distance once revealed
  Given evac has been revealed
  When the engine computes Vision for any agent
  Then Evac appears as a Vision key with shape (e.g. "patch")
  And dist/bearing reflect the nearest tile (or "here" if inside)

Scenario: Wall LOS rule for aggregation
  Given a wall rect where at least one tile has LOS to observer
  When the engine computes Vision
  Then the entire wall rect surfaces (as one key)

Scenario: Chests, corpses, characters keep point-keying
  Given a chest / corpse / character is visible
  When the engine computes Vision
  Then it keeps existing per-entity single-coord keying (no aggregation)
```

### 6.4 Targeting an aggregated rect

```
Scenario: toward <rect-id> paths to nearest tile of rect
  Given an agent commits "toward Wall_<x1>_<y1>_to_<x2>_<y2>"
  When the engine resolves movement
  Then movement paths toward the nearest tile of the rect
  And stopAtRange applies by entity type
    (wall: adjacent, cover: step onto, evac: step onto)

Scenario: away <rect-id> paths away from nearest tile of rect
  Given an agent commits "away Wall_<x1>_<y1>_to_<x2>_<y2>"
  When the engine resolves movement
  Then movement paths away from the nearest tile of the rect
```

## 7. Schema risks & migration

**Risk:** `worldState.coverClusters` is a new required field on the
`worldState` table. Existing rows lack the field → reads via the
strict Convex validator will fail.

**Mitigation:**
- POC posture per `project_poc_schema_wipe_acceptable` — wipe the
  Convex dev DB before WP-A lands the schema change.
- Add `coverClusters` as **required** (not optional) so callers can rely
  on its presence — the field is always derivable from the descriptor.
- WP-A's pre-merge checklist: confirm the dev deployment has been wiped
  and the harness can land a fresh match end-to-end.

**Secondary risk:** phase-9 closing-report payload persistence.
**Correction from v1 spec:** `reports.payload` is **not** `v.any()`
— it is the exact `reportPayloadValidator` at `convex/schema.ts:668`.
Extending it in-place would require migrating historical phase-1/3/6/7
rows. The phase-3/6/7 precedent (`schema.ts:868-870`) is to add a
**sibling typed field** on the `reports` table (`phase3Payload`,
`phase6Payload`, `phase7Payload`). WP-E adopts the same pattern:
`phase9Payload: v.optional(phase9PayloadValidator)`. Historical rows
validate without migration (the field is `undefined` on them); new
phase-9 rows carry the slice-specific metrics. See WP-E §2 / D11 and
Q7 / Q11.

**Tertiary risk:** existing persisted `turns` rows from pre-phase-9
matches will not have `agentRecords[].input.visibleStateDigest`
containing rect keys. The replay UI reads these rows for historical
matches — but historical-match rendering doesn't depend on rect
parsing (the LLM Vision text is rendered verbatim in the
"Full LLM Input" pane; no consumer parses wall/cover/evac keys for
display). **No mitigation needed.**

**`VisibleEntity` shape break:** the typed union changes
(`kind:"wall"`/`"cover"` → `kind:"wall_rect"`/`"cover_rect"` plus new
`"evac_rect"`). This is an in-memory engine type only; not persisted.
Compile-time break is contained to WP-C, which only starts after WP-A
merges.

## 8. Assignment-Level Success Criteria

Mirrors the assignment north-star "Done bar":

- [x] Phase-7 thresholds preserved where comparable:
  - [x] Extraction rate ≥ 30%
  - [x] Kill rate ≥ 80%
  - [x] Equip rate ≥ 80%
  - [x] Speech rate ≥ 50%
  - [x] Persona spread ≥ 15 pp
  - [x] Zero crashes / invalid states
  - [x] Zero illegal `use:"consumable"` emissions
  - [x] Zero `Player_N` literals
  - [x] Zero whole-turn validator zeroes
  - [x] Per-field rejection ≤ 10%
- [x] Slice-specific evidence over the 20-run closing report:
  - [x] Rect-keyed walls (`Wall_<x1>_<y1>_to_<x2>_<y2>`), cover patches
        (`Cover_<x1>_<y1>_to_<x2>_<y2>`), evac (`Evac_<x1>_<y1>_to_<x2>_<y2>`)
        present in Vision payloads across the 20 runs.
  - [x] Single-tile keys (`Wall_<x>_<y>`, `Cover_<x>_<y>`) ONLY when the
        underlying rect is 1×1 (reference map has zero 1×1 rects today
        → expected count is 0; gate flips if non-zero).
  - [x] `hugged Wall_*` outcome lines observed at least once per
        persona on average across the 20 runs.
  - [x] At least one observable case of wall-on-wall LOS occlusion
        across the 20 runs.
  - [x] Inside-state encoding: at least one Vision entry has
        `dist: 0, bearing: "here"`.
  - [x] Evac appears in Vision once revealed regardless of observer
        distance. **Specifically: `evacOutOfChebyshev20Count ≥ 1`** —
        at least one turn where the observer is Chebyshev > 20 from
        evac centre AND `Evac_*_to_*` is in their Vision (Review A
        LOW-acceptance). This proves the engine code path is honoured,
        not just that evac appears for someone.
  - [x] No regression in the diagnostics view's mechanics / critical
        families.
- [x] Implementation attestation captured in §12. User replay step-through
      remains the post-implementation UAT, per backend-only scope.

## 9. Ambiguities / Questions

Resolved in the spec; recorded for future readers.

**Q1 — `coverClusters` alongside or replacing `coverTiles`?**
**Resolved:** alongside (additive). Hiding-logic risk isolation; cluster
shape is irrelevant to hiding semantics. See §3.1.1.

**Q2 — Slide tie-break when both cardinal fallbacks are clear?**
**Resolved:** prefer X-axis. Deterministic, matches Bresenham
iteration order, no persona-authorship visibility impact. See §3.1.5.

**Q3 — Rect-target nearest-tile: static (resolved at turn start) or
dynamic (recomputed per substep)?**
**Resolved:** dynamic — recomputed per substep so as the mover slides
closer, "nearest" updates. Matches the dynamic-position pattern
characters already use. See §3.1.5.

**Q4 — Evac entry suppression when inside?**
**Resolved:** unsuppressed. Evac entry always emits once revealed; the
inside-state `dist: 0, bearing: "here"` is its own legibility signal.
The phase-7 `Inside Evac` / `Outside Evac` Status-block flag stays.
See §3.1.3.

**Q5 — Where to emit Evac as a `VisibleEntity` — engine or LLM
projection?**
**Resolved:** engine. Symmetry with walls and cover; the LLM projection
shouldn't synthesise entities the engine didn't emit. The phase-7
manual append in `inputBuilder.buildVisibleObject` (lines 414-421) is
deleted; the engine writes the `evac_rect` variant directly. See §3.3
touch-points.

**Q6 — How does the slide trace's target intent get formatted for
toward/away slides — does the engine know the persona display name of
the target?**
**Resolved (D6):** engine writes the agent's `targetId` **verbatim**
into `MoveTraceEntry.slide.intent` (e.g. `"toward Duelist"`, `"away
Wall_18_18_to_23_18"`). The LLM projection renders the human-readable
name via the existing `renderCharacterTypedId` helper at fragment-
render time (rect ids pass through unchanged). Engine layer never
imports display-name machinery. See §3.1.6 and WP-B §1.

**Q7 — Should the schema `payload` validator gain new optional fields
for phase-9 metrics, or stay flexible?**
**Resolved (D11):** phase-9 closing report uses a new
`phase9Payload: v.optional(phase9PayloadValidator)` **sibling field**
on the `reports` table (mirrors `phase3Payload` / `phase6Payload` /
`phase7Payload` at `schema.ts:868-870`). The existing
`reports.payload` field is **not** `v.any()` (the spec v1 claim was
wrong — it's the exact `reportPayloadValidator` at `schema.ts:668`),
so adding metric fields directly would require migrating historical
rows. The sibling-field pattern is the phase-3/6/7 precedent.
Phase-9 persistence uses a new `persistComputedPhase9Report` mutation
mirroring `persistComputedPhase7Report` at
`convex/reports/phase7.ts:768`. See WP-E §2-3.

**Q8 — Should single-tile rects emit `<Prefix>_<x>_<y>` or
`<Prefix>_<x>_<y>_to_<x>_<y>`?**
**Resolved (D5):** single-coord form (`<Prefix>_<x>_<y>`) — symmetric
with the legacy single-coord ids agents already know, and the `shape:
"single"` discriminator carries the rect-extent intent. The id parser
accepts both forms (forward-compatible). See §3.1.2.

**Q9 — Slide trace shape: does the engine write axis explicitly, or
does the renderer derive it from `from`→`to` delta?**
**Resolved (D9):** engine writes `slide.axis: 'N'|'E'|'S'|'W'`
explicitly per substep. Renderer reads it directly. **Delta
derivation is forbidden** — in a multi-substep move, the aggregate
`MoveTraceEntry`'s start-to-final delta is not the slide-substep
delta (counter-example: NE move that slides E on substep 1 then
continues NE on substep 2 — aggregate delta NE, slide axis E,
delta-derivation produces the wrong letter "NE"). See §3.1.6.

**Q10 — How does the substep loop access the rect for dynamic
nearest-tile resolution?**
**Resolved (D10):** `ResolvedEntity` gains `rect?: Wall` field,
populated by `resolveTypedEntity` (WP-C §3) for wall/cover/evac kinds.
WP-B reads `mover.resolvedTarget.rect` per substep and recomputes
`nearestTileOfRect(rect, mover.pos)`. **No re-parsing of `targetId`
per substep, no `state.world` lookup helper indirection** — keeps the
substep hot path string-free. See §3.1.5 and WP-C §3.

**Q11 — Phase-9 closing-report persistence: extend `reports.payload`
in place, or add a sibling `phase9Payload`?**
**Resolved (D11):** sibling field — see Q7 above.

**Q12 — `MoveTraceEntry.slide` persistence: is it implicit (gets
through somehow) or explicit (enumerate every touch point)?**
**Resolved (D12):** explicit. §3.1.7 enumerates every touch point —
`convex/schema.ts:302-314` `moves[]` validator, `convex/runMatch.ts:481`
and `:591` adapters, `PrevTurnRow` shape in `inputBuilder.ts`,
`turnsDerived.ts:589` slim projection, `harness/diagnostics/types.ts:111`
`ResolutionMove`. WP-B owns the entire vertical slice. Without this
enumeration, `slide` would be silently stripped at the Convex
boundary and the next-turn user-role outcome line could never render
`hugged Wall_*`. See §3.1.7.

## 10. Recommended Job Sequence

1. **Spec review** (this doc) — confirm data-model decisions §3.1 before
   dispatch. PM call.
2. **Parallel batch 1** (3 engineer agents, foreground):
   - WP-A (engine substrate + LOS + rect emit + tests).
   - WP-B (movement slide + tests).
   - WP-D (persona scrub — likely no-op verify).
3. **Round 2** (1 engineer agent, foreground): WP-C (LLM projection +
   id parsing + outcome lines + tests). Depends on A + B for type +
   trace shapes.
4. **Validation gate**: full repo lint / typecheck / test / build green.
   Triggers WP-E.
5. **WP-E** (operator-style agent, foreground): closing-20 harness
   pass, persist report, attest gates in §11.
6. **User UAT** (user, replay-UI step-through): walks through the
   closing-20 runs in the existing replay UI. Brief thumbs-up captured
   in §11.
7. **Completion review** (single-attempt unless WP-E surfaces
   contract drift like phase-7 attempt #1) — Reviews A/B/C, sign off,
   close the phase.

UAT placement is **after** WP-E (closing-20 produces the matches the
user steps through). No replay-app code changes; no apps/replay UAT.

## 11. References

- `docs/project/spec/mental-model.md` §17 — canonical intent.
- `docs/project/spec/mental-model.md` §6 pillar 8 — refined principle.
- `docs/project/phases/08-vision-affordance-filter/README.md` — predecessor
  slice (spent-entity filter) and the LLM-projection-vs-engine layering
  precedent.
- `convex/engine/vision.ts:214-228` — wall LOS carve-out (to delete).
- `convex/engine/vision.ts:203-212` — cover-tile flat emission (to
  rewrite as cluster emission).
- `convex/engine/movement.ts:119-171` — `desiredNextTile` (slide insert
  point).
- `convex/engine/movement.ts:353-410` — wall-blocked trace emit (to
  extend with slide variant).
- `convex/engine/types.ts:160-167` — `WorldState` shape (add
  `coverClusters`).
- `convex/engine/types.ts:326-337` — `VisibleEntity` union (replace wall/
  cover variants with rect-grained).
- `convex/llm/inputBuilder.ts:314-374` — `visibleEntryFor` (rect-key
  construction).
- `convex/llm/inputBuilder.ts:138-146` — `renderMoveFragment` (slide
  outcome line).
- `convex/llm/idNormalisation.ts:162-254` — id parsing + resolution
  (extend for rect ids).
- `convex/schema.ts:770-780` — `worldState` table (add
  `coverClusters`).
- `convex/reports/phase7.ts` — closing-20 aggregator template.
- `maps/reference.json` — 28 walls, 10 cover clusters, 3×3 evac at
  (47-49)².
- `personas/*.md` — 8 persona prompts (WP-D scrub target).

---

## 12. Closure record — 2026-05-14 implementation attestation

**Validation gates**

- `npm run lint` — PASS
- `npm run typecheck` — PASS
- `npm test` — PASS (`39 passed | 1 skipped`; `670 passed | 2 skipped`)
- `npm run build` — PASS

**Convex dev DB wipe**

Executed with the existing paginated `spike:wipeOneTable` helper before the
Phase 9 schema push:

- `turns`: 500 deleted
- `characters`: 80 deleted
- `worldState`: 10 deleted
- `runs`: 10 deleted
- `reports`: 2 deleted
- `matches`: 10 deleted

Then pushed the Phase 9 schema/functions with
`npx convex dev --once --typecheck=disable`.

**Closing-20 evidence**

- Harness command:
  `npm run harness -- --runs 20 --concurrency 10 --reasoning low --seed-prefix phase9-20260514`
- Harness log: `/tmp/phase9-closing-20.jsonl`
- Phase 9 report driver:
  `npx tsx harness/closing/phase9.ts --matchIds <closing-20 ids> --overwrite`
- Report id: `jd764w578jwvxm41xjv6d1z07n86qkfc`
- `reportType`: `phase-9-closing-20`
- `runCount`: 20
- `metBar`: true
- `missingRunsForMatchIds`: `[]`

**Preserved thresholds**

- extractionRate: 0.95
- killRate: 0.95
- equipRate: 1.00
- speechRate: 1.00
- personaSpread: 50 pp
- failedMatches: 0
- nullOnlyUseViolations: 0
- playerNLiteralCount: 0
- wholeTurnZeroedValidatorRecords: 0
- perFieldRejectionRate: 0.0011219368172423975

**Phase 9 slice counters**

- wallRectKeyCount: 50,830
- coverRectKeyCount: 21,882
- evacRectKeyCount: 2,311
- singleTileKeyForMultiTileRectCount: 0
- slideOutcomeCount: 120
- slideOutcomePerPersona: rat 2, duelist 16, trader 26, opportunist 27,
  paranoid 1, camper 4, sprinter 23, vulture 21
- wallOnWallOcclusionCount: 7,796
- evacOutOfChebyshev20Count: 450
- insideBearingHereCount: 3,214

**UAT handoff**

Backend implementation is closed. User replay step-through of the persisted
closing-20 remains the explicit post-WP-E UAT path; no replay UI changes were
made.
