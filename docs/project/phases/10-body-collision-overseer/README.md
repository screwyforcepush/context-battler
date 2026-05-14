# Phase 10 — Body-collision Substrate + Overseer v0 Refinement

> **CHANGELOG**
> - **v2 (2026-05-14)** — Locks decisions D11–D24 from pre-implement review
>   cycle (reviews A/B/C). Notable threading:
>   - §3.1.1/§3.1.2: single `bumpByMover` map drives BOTH `blockedBy:"wall"`
>     and `bodyCollision.wall` emission; desire-recompute branch at
>     `movement.ts:506-538` retired (D11).
>   - §3.1.3: attacks[] push pinned to between `resolution.ts:320` and
>     `:348` (D24); body-collision AttackEvent variants carry internal
>     `source:"bodyCollision"` + `revealsAttacker:false` flag, reveal pass
>     at `resolution.ts:701` skips them (D12); counter pending dedupe by
>     `(overwatcherId, attackerId)` (D15).
>   - §3.1.5/§3.4: `convex/_internal_runMatch.ts:173 resolutionValidator`
>     added to persistence chain; schema-mirror parity test required (D13).
>   - §3.2: WP-B scope **expands** to include
>     `apps/replay/src/lib/decisionEnglish.ts` — bodyCollision fragments
>     render in TurnFeed + HoverCard outcome summaries (D14). WP-C is no
>     longer 100% independent of WP-B; see updated dependency map (§4).
>   - §3.2.1: slide + bodyCollision **NOT** mutually exclusive — multi-step
>     slide can continue then bump; render slide fragment first, then bump
>     (D16/D21).
>   - §3.2.3: `emittedVictims` ordering — iterate `actions[]` FIRST, THEN
>     `moves[].bodyCollision` (1-dmg charge never out-ranks weapon kill) (D17).
>   - §3.3.1: HoverCard alive-at-start-of-N gotcha documented (D20);
>     final-turn aftermath inaccessibility accepted as diagnostic-grade
>     tradeoff (D23).
>   - §3.3.2: `Replay.tsx mainStyle.maxWidth` raised to `1920px`; widening
>     math corrected; UAT assertion `feed > 700px @ 1920px` (D18).
>   - §3.3.3: Status parser regex MUST match `inputBuilder.ts:516-529
>     renderStatusBlock` verbatim (preserve bracketed stats); wireframe is
>     illustrative, source is contract (D19).
>   - §3.3: WP-C v0 satisfies "diagnostic loop in one viewport" via
>     Status-card-in-feed; Vision/reasoning remain in ExpandModal —
>     revisit only if user attestation rejects (D22).
>   - §9 clarifiers: off-grid, bare hands, status card position, default
>     expanded — all **resolved**; see §9 for resolution notes.
> - **v1 (2026-05-14)** — Initial plan dispatched.
>
> **Status:** dispatched (v2). Two intertwined threads land in one slice per
> [`mental-model.md` §18](../../spec/mental-model.md#18-next-slice-intent--jam-captured-2026-05-14-not-yet-dispatched):
> (a) substrate — body-collision damage (chars + walls) as a discoverable,
> undocumented mechanic, and (b) overseer v0 refinement — start-of-N
> replay-grid semantics + a widened TurnFeed that carries the agent's
> Status card alongside the decision feed.
>
> Canonical intent anchors:
> - [`mental-model.md` §18](../../spec/mental-model.md#18-next-slice-intent--jam-captured-2026-05-14-not-yet-dispatched) — the why for this slice
> - [`mental-model.md` §11](../../spec/mental-model.md#11-current-focus--phase-2-replay-overseer-v0) — overseer v0 posture (batch-fetch, step-don't-stream, ground-truth-always) that must be preserved
> - [`mental-model.md` §6 pillars 1, 4, 5, 6](../../spec/mental-model.md#6-design-pillars) — failures attributable to the prompt, scratchpad-as-explainability, text-is-terrain, build-the-substrate
> - [Phase 9 closure](../09-walls-vision-rect-grained/PHASE-9-CLOSURE.md) — wall-slide + rect-Vision substrate predecessor

---

## 1. Purpose

Post-phase-9 replay review surfaced two intertwined gaps:

1. **The substrate has no consequence for walking through other players
   or for partial-distance wall-bumps.** Agents bonk silently — no damage,
   no outcome-line signal. A class of cheap "obstacles exist"
   discovery never lands. The mechanic is intentionally undocumented to
   the agent (no schema field, no system-prompt teaching, no new
   `action.kind`) — discovery happens via outcome lines (pillar 5: text
   is terrain) and emergent prompt iteration (pillar 6: substrate
   produces strategy).

2. **The replay's grid renders end-of-N state while the diagnostic loop
   reads Status / Vision / reasoning at the state the agent SAW
   (start-of-N).** The temporal mismatch makes inference fight the UI.
   The TurnFeed column is also too narrow for the diagnostic loop the
   user actually runs on a widescreen monitor — Status card belongs
   alongside the decision feed.

> **North-star filter test:** does this make prompt-authored behaviour
> more interesting, legible, or exploitable? Yes —
> - Charge/wall-bump are emergent affordances that the prompt can learn
>   from outcome lines, no engine-enforced rule (pillars 1/5/6).
> - Counter-stance defenders organically retaliate against chargers via
>   the existing counter pipeline — depth without engine surface bloat.
> - Start-of-N grid + widened Status feed collapse the diagnostic loop
>   into one viewport, which is what makes prompt-debugging cheap.

## 2. Overview — what is being built

Two threads land together:

### 2.1 Body-collision substrate (engine + LLM projection)

**Char-on-char (charge):**
- A mover whose substep desired tile is occupied by a living enemy
  triggers a *collision event* between mover and defender.
- Each side takes 1 dmg. Mover stays at start-of-substep tile (no
  displacement; same blocking behaviour as today).
- Bilateral A↔B (both moving into each other's start tile) → ONE
  collision event, each takes 1 dmg.
- Charge damage routes through the existing `attacks[]` pipeline →
  counter-stance defenders retaliate via the existing counter pass with
  zero new branching.
- Mover's substep loop terminates after a charge fires (budget zeroed
  for that mover).

**Char-on-wall (wall-bump):**
- A cardinal-direct dead-stop into a wall costs the mover 1 dmg.
- A diagonal dead-stop where BOTH cardinal slides are blocked = bump
  (1 dmg). A successful diagonal slide is NOT a bump (no dmg).
- **Partial-distance wall-bump fix:** the existing trace silently drops
  the bump signal when the mover committed N-1 steps before bumping.
  This slice closes that gap — any wall-bonk emits a bump marker
  regardless of whether prior steps committed.
- Off-grid attempts are organically a wall-bump because the reference
  map already has a perimeter wall. No new boundary handling.

**Trace surface:**
- Body-collision markers attach to existing `moves[]` trace entries
  (NOT a new `actions[]` kind).
- The damage events route through `attacks[]` (engine-internal) so
  `applyDamage`, counter-fire snapshot, and the deaths phase consume
  them with zero new branching.
- LLM projection (`inputBuilder.ts`) renders new outcome-line variants
  and extends `renderDamageEventLines` to surface "X charged into you
  (dmg 1)" lines for defenders.

### 2.2 Overseer v0 refinement (replay-app UI)

**Start-of-N grid semantics:**
- The replay grid renders the state the agents SAW when deciding turn
  N — i.e., end-of-(N-1) entity positions. Today `reconstruct(bundle,
  currentTurn)` returns end-of-N.
- Fix at the call site: `reconstruct(bundle, currentTurn - 1)` for the
  grid. The TurnFeed continues to render decisions for `currentTurn`
  (end-of-N is the right home for the decision data — "what they did").
- `?turn=N` deep-link continues to mean "stepper position N"; the user
  sees the grid as start-of-N and the feed as turn-N decisions/outcomes
  — temporally consistent.

**Widened TurnFeed + Status card:**
- Drop the hard `flex: 0 0 60%` / `flex: 1 1 40%` split. Grid stays
  square (aspect-ratio: 1/1) but yields width once it hits its natural
  height-clamped size; feed gets all remaining widescreen width.
- Each agent's feed row gains a Status card mirroring the per-turn
  input's `## Status` block: position, HP, weapon-with-stats,
  armour-with-stats, consumable-with-stats, scratchpad-before,
  Inside/Outside Evac flag.
- Data source: extract from `agentRecord.input.composedUserMessage`
  (the canonical ground-truth surface — what the agent literally saw).
  No bundle-query extension needed.

## 3. Architecture Design

### 3.1 Engine substrate — collision detection

#### 3.1.1 `MoveTraceEntry` extension

`convex/engine/movement.ts` and `convex/engine/types.ts` extend the
trace entry shape:

```ts
export type MoveTraceEntry = {
  characterId: string;
  from: Tile;
  to: Tile;
  blockedBy?: "wall";                          // existing
  slide?: { wallRectId; axis; intent };        // existing (phase 9)
  bodyCollision?:                              // NEW
    | { kind: "character"; defenderId: string }
    | { kind: "wall"; wallRectId: string };
};
```

`blockedBy: "wall"` and `bodyCollision.kind === "wall"` are NOT
duplicates — the new field carries the wall-bump self-dmg
attribution, while `blockedBy` predates it and is consumed by
`convex/reports/phase3.ts` for the wall-blocked-move-rate metric.

**Why both fields rather than collapsing:** `blockedBy: "wall"` fires
ONLY when `start === end` (mover never moved). `bodyCollision` fires on
ANY wall-bump (full dead-stop OR partial-distance bump). The existing
phase-3 metric consumes `blockedBy` and we don't want to retire that
contract. Both fire together in the start===end case; only
`bodyCollision` fires in the partial-distance case.

**Single source of truth: `bumpByMover` (D11).** Both emissions are
driven from a NEW per-substep-loop map populated by the collision
detector (§3.1.2):

```ts
const bumpByMover  = new Map<string, { wallRectId: string }>();
const chargeByMover = new Map<string, { defenderId: string }>();
```

At trace-emission time (end of `simulateMovement`), the writer:
- emits `blockedBy: "wall"` IF `bumpByMover.has(id)` AND
  `start === end` (preserves phase-3 metric contract);
- emits `bodyCollision: {kind:"wall", wallRectId}` IF
  `bumpByMover.has(id)` (ALWAYS, regardless of partial movement);
- emits `bodyCollision: {kind:"character", defenderId}` IF
  `chargeByMover.has(id)`.

This **retires the desire-recompute branch at `movement.ts:506-538`
entirely** (D11, locking Review-A HIGH). No double-walking the world,
no risk of silent loss of `blockedBy:"wall"` from the existing
`if (mover.budget <= 0) continue;` gate at `movement.ts:509`.

#### 3.1.2 Collision detection in the substep loop

The current substep planner (lines 414-426 of `movement.ts`) handles
three desire outcomes: commit (clear), slide-on-wall (diagonal-wall
fallback), drop (everything else).

Extend with a fourth: **bump/charge marker emission**. After the
existing slide branch:

```
for desire d in this substep:
  if rawTileCount[d.tile] > 1: continue   // conflict
  if isBlocked(d.tile, ...):
    if tileBlockedByWall(d.tile):
      slide = tryResolveSlide(d, ...)
      if slide: plan d→slide
      else: bumpByMover.set(d.mover, { wallRectId })
            zeroBudget(d.mover)            // terminate mover
    else if tileOccupiedByLivingCharacter(d.tile, currentPos, characters):
      defenderId = characterAt(d.tile)
      chargeByMover.set(d.mover, { defenderId })
      zeroBudget(d.mover)                  // terminate mover
    // off-grid / conflict-stuck: no marker (existing behavior)
  else: plan d→tile
```

**Bilateral deduplication.** A and B both desire each other's tile.
Both detect "blocked by living character", both would emit a
collision marker. The engine emits ONE collision event between (A,B)
when surfacing into `attacks[]` (key by sorted-(A,B)). Both move trace
entries get the `bodyCollision.kind === "character"` marker pointing
at the *other* party — agent rendering symmetry is preserved.

**First-bump-only.** Like the existing `slideByMover` first-only
pattern (movement.ts:447-449), a mover gets at most one
`bodyCollision` marker per turn. `bumpByMover` / `chargeByMover` are
populated via `setIfAbsent` semantics; subsequent substeps cannot
overwrite (and zero-budget prevents re-entry regardless).

**`blockedBy:"wall"` is driven from `bumpByMover` (D11, single source
of truth).** The existing desire-recompute branch at
`movement.ts:506-538` — which today re-evaluates `isBlocked` for each
move-decision and emits `blockedBy:"wall"` when start===end — is
**retired entirely**. The new trace-emission writer emits both
`blockedBy:"wall"` and `bodyCollision.wall` off the same map. Why this
is required: after zero-budget on a wall-bump, a `move`-decision
mover with `start===end` looks identical to a `dist:0` mover; the
existing gate `if (mover.budget <= 0) continue;` would silently drop
`blockedBy:"wall"`, sending the phase-3 wall-blocked-move-rate metric
to 0. The retired branch removes that double-walk; `bumpByMover` is
the only source.

Pseudocode (trace-emission writer):

```ts
for (const m of moversInOrder) {
  const entry: MoveTraceEntry = { characterId: m.id, from: m.start, to: m.pos };
  if (slideByMover.has(m.id))  entry.slide = slideByMover.get(m.id);
  if (bumpByMover.has(m.id))   entry.bodyCollision = { kind: "wall",      wallRectId: bumpByMover.get(m.id)!.wallRectId };
  if (chargeByMover.has(m.id)) entry.bodyCollision = { kind: "character", defenderId: chargeByMover.get(m.id)!.defenderId };
  if (bumpByMover.has(m.id) && m.start === m.pos) entry.blockedBy = "wall";   // legacy phase-3 contract
  moves.push(entry);
}
```

Note: `bodyCollision` (charge) and `slide` can coexist — a multi-step
slide can land cleanly THEN have a subsequent substep blocked by a
character (see §3.2.1 precedence table; D16). `bodyCollision` (wall)
can also coexist with `slide` if a partial-distance mover slides for
some substeps then bumps on a later one (D21). The writer's order
above gives `bodyCollision` the last write when both are set —
correct for the start===end / dead-stop case where only the bump
should land; ordering for the slide-then-bump composite is handled by
making slide and bump independently writable (`slide` field stays
set; `bodyCollision` field also set).

**Wall self-dmg fires regardless of partial movement.** When
`bumpByMover.has(id)` is true, `bodyCollision.wall` fires. When
additionally `start === end`, `blockedBy:"wall"` ALSO fires (phase-3
metric contract). When `start !== end` (partial-distance bump), ONLY
`bodyCollision.wall` fires — phase-3 metric ignores partial-distance
bumps as today.

#### 3.1.3 Routing into `attacks[]` (resolution.ts)

**Insertion point (D24, locks Review-A MED).** Immediately AFTER
`const attacks: AttackEvent[] = [];` at `resolution.ts:320` and BEFORE
the overwatch loop at `resolution.ts:348`. Pinning this resolves the
ambiguity from v1 ("~line 304 / before Phase-5"): `attacks[]` is not
defined until 320, so any push before then is undefined-reference; the
counter snapshot at 622 still picks them up because they're in
`attacks[]` before `originalAttacks = attacks.slice()`.

Iterate `moveResult.moves[]`:

```ts
// resolution.ts ~line 321 (immediately after `const attacks: AttackEvent[] = [];`)
// Push body-collision damage events into attacks[] BEFORE overwatch + counter.
const collidedPairs = new Set<string>();     // dedupe "A,B" canonical key
for (const m of moveResult.moves) {
  if (!m.bodyCollision) continue;
  if (m.bodyCollision.kind === "character") {
    const other = m.bodyCollision.defenderId;
    const key = [m.characterId, other].sort().join("|");
    if (collidedPairs.has(key)) continue;     // bilateral dedupe
    collidedPairs.add(key);
    attacks.push({
      attackerId: m.characterId,
      defenderId: other,
      dmg: 1,
      source: "bodyCollision",          // NEW (internal; not LLM-facing)
      revealsAttacker: false,           // NEW
    });
    attacks.push({
      attackerId: other,
      defenderId: m.characterId,
      dmg: 1,
      source: "bodyCollision",
      revealsAttacker: false,
    });
  } else if (m.bodyCollision.kind === "wall") {
    attacks.push({
      attackerId: m.characterId,
      defenderId: m.characterId,        // self-damage on wall bump
      dmg: 1,
      source: "bodyCollision",
      revealsAttacker: false,
    });
  }
}
```

**`source` + `revealsAttacker` discriminators (D12, locks Review-B
HIGH #2).** The reveal pass at `resolution.ts:701` currently marks
every attacker in `attacks[]` as `revealedBy:"attack"`. Without the
new flags, a hidden charger would auto-reveal merely by trying to
walk into a defender, and a hidden defender would reveal merely by
being charged — both contradicting mental-model §775 (charger reveal
must stay proximity-based). Resolution: extend `AttackEvent` shape
with optional `source?: "bodyCollision"` (internal discriminator,
absent from any LLM-facing surface) and optional
`revealsAttacker?: boolean` (defaults to `true` for legacy attacks).
The reveal pass becomes:

```ts
// resolution.ts:701 (reveal pass)
for (const a of attacks) {
  if (a.revealsAttacker === false) continue;   // body-collision sources skip
  // ...existing reveal logic
}
```

Counter-generated retaliations (pushed by the counter pass, NOT by
this block) carry the default — they reveal normally. Invariant: a
counter-stance defender retaliating against a charger DOES reveal per
the existing rules; only the body-collision-source attacks skip.

**Counter pending dedupe (D15, locks Review-B HIGH #4).** Concept spec
§1332 says counter fires ONCE per attacker. Today the counter pass
pushes pending counters per-attack without dedupe (`resolution.ts:628`).
After this slice, a single attacker can produce both a charge entry
(`A→B`, source:"bodyCollision") AND a same-turn ranged attack
(`A→B`, source:"attack") against the same counter defender — that's
two `originalAttacks` rows naming `A` as attacker. The counter pass
MUST dedupe pending counters by `(overwatcherId, attackerId)` tuple
so B's counter fires once at A, not twice. Concrete change:

```ts
// resolution.ts ~line 628 (counter pass; pending-counter push)
const pendingCounterKeys = new Set<string>();  // "overwatcherId|attackerId"
for (const a of originalAttacks) {
  if (!counterActors.has(a.defenderId)) continue;
  const key = `${a.defenderId}|${a.attackerId}`;
  if (pendingCounterKeys.has(key)) continue;
  pendingCounterKeys.add(key);
  // ...existing pending-counter push
}
```

Note: counter retaliations against bodyCollision-sourced attacks fire
normally (the source flag suppresses reveal, not retaliation) — a
counter-stance defender retaliates against a charger using their
equipped weapon, same pipeline as a counter-on-ranged-attack.

**Why before the counter snapshot.** The counter pass (resolution.ts
lines 622-640) takes `originalAttacks = attacks.slice()` to enqueue
counter-fires. Charge events must be in `attacks[]` BEFORE this
snapshot for a counter-stance defender to retaliate. Pinning the
push at line 321 (immediately after `const attacks: AttackEvent[] = [];`)
guarantees this.

**Why both directions for character collision.** The `A→B` entry is
the canonical "A charged B" event (counter pass watches this for
trigger). The `B→A` entry routes the symmetric 1-dmg-on-mover-A
through the existing `applyDamage` batch. Both are batched in the
same `applyDamage` pass at line 685, preserving simultaneity.

**Counter false-trigger prevention.** The `B→A` body-recoil entry has
`defenderId === A` (the mover). For counter to fire on A, A would
need to be in counter-stance — but `position.kind === "counter"` and
`position.kind === "move"` are mutually exclusive (five-field tool
shape; mental-model §15). So `counterActors.has(A) === false`, no
false counter fire.

**Wall-bump self-dmg.** `attackerId === defenderId === mover`.
`counterActors.has(mover) === false` (mover is in `position.move`,
not counter). No counter fire. ✓

**Trace.actions[].** The new `attacks[]` entries do NOT mirror into
`trace.actions[]`. The agent-facing attribution lives on
`trace.moves[].bodyCollision`. Damage routing lives on `attacks[]`.
Cleanly separated.

#### 3.1.4 Schema delta

`convex/schema.ts` `moves[]` validator (lines 302-326) extends with:

```ts
bodyCollision: v.optional(
  v.union(
    v.object({
      kind: v.literal("character"),
      defenderId: v.id("characters"),
    }),
    v.object({
      kind: v.literal("wall"),
      wallRectId: v.string(),
    }),
  ),
),
```

Schema change is additive (optional field), but per POC posture
(`project_poc_schema_wipe_acceptable`) the Convex dev DB is wiped on
landing — no migration shims, no historical-row backfill.

#### 3.1.5 Persistence end-to-end touch points

Mirroring the phase-9 §3.1.7 enumeration for the `slide` field:

| File | Line / function | Change |
|---|---|---|
| `convex/engine/types.ts` | `MoveTraceEntry` (re-exported via movement.ts) | Add `bodyCollision?` per §3.1.1 |
| `convex/engine/movement.ts` | substep loop ~414-426; trace emit ~492-539; **retire desire-recompute branch ~506-538** | Detect + emit per §3.1.2; `bumpByMover` becomes single source for both `blockedBy` and `bodyCollision.wall` |
| `convex/engine/resolution.ts` | **insertion at line 321** (immediately after `const attacks: AttackEvent[] = [];` at 320, before overwatch loop at 348) | Push into `attacks[]` per §3.1.3 |
| `convex/engine/resolution.ts` | reveal pass at line 701 | Skip attacks where `revealsAttacker === false` (D12) |
| `convex/engine/resolution.ts` | counter pending push ~line 628 | Dedupe by `(overwatcherId, attackerId)` tuple (D15) |
| `convex/engine/resolution.ts` | `AttackEvent` type / `ResolutionTrace.moves[]` type ~96-112 | Add `source?: "bodyCollision"`, `revealsAttacker?: boolean` on `AttackEvent`; mirror `bodyCollision?` on moves trace |
| `convex/schema.ts` | `moves[]` validator lines 302-326 | Add `bodyCollision: v.optional(...)` per §3.1.4 |
| `convex/_internal_runMatch.ts` | `resolutionValidator` at line 173; consumed at `persistTurn` mutation `args.resolution` at line 406 | **MUST mirror `convex/schema.ts:moves[]` validator additions (D13).** This is the write-time gate — `persistTurn` validates the runtime `resolution` against the LOCAL `resolutionValidator`, not the table schema. Missing this delta = write rejection. |
| `convex/runMatch.ts` | `adaptResolutionForSchema` ~493-502 | Conditional-spread `bodyCollision` into persisted row (mirror `slide` pattern) |
| `convex/runMatch.ts` | `adaptPriorTurnRowForBuilder` ~584-590 | Conditional-spread `bodyCollision` into `PrevTurnRow` |
| `convex/runMatch.ts` | `PersistedPriorTurnRow.resolution.moves[]` type ~540-545 | Add `bodyCollision?` |
| `convex/llm/inputBuilder.ts` | `PrevTurnRow.resolution.moves[]` type ~37-47 | Add `bodyCollision?` |
| `convex/turnsDerived.ts` | `ResolutionMoveLike` type ~82-92 | Add `bodyCollision?` |
| `convex/turnsDerived.ts` | `projectSlimTurnRow` line 669 | `row.resolution` passes through; verify `bodyCollision` survives |
| `harness/diagnostics/types.ts` | `ResolutionMove` type ~111-116 | Mirror `bodyCollision?` for diagnostics CLI consumers |

**Schema-mirror parity test required (D13).** Mirror
`tests/llm/schemaMirror.test.ts:543` for `bodyCollision`: assert that
`convex/schema.ts:moves[].bodyCollision` and
`convex/_internal_runMatch.ts:resolutionValidator.moves[].bodyCollision`
have IDENTICAL shapes. The phase-9 `slide` field already has this
parity test; the new test is a one-line addition keyed on
`bodyCollision`. WP-A is NOT done until this test passes.

### 3.2 LLM projection — outcome lines + damage feed

#### 3.2.1 `renderMoveFragment` extension

`convex/llm/inputBuilder.ts:188-201` becomes the orchestrator for
move-related fragments. Current shape: returns one of {slide, blocked,
movement-distance, null}. New shape: concatenates fragments so a
partial-distance bump renders BOTH movement and bump.

Fragments in render order:
1. **Movement distance** — existing `moved {dist} {dir}` when
   `from !== to`.
2. **Body-collision (character)** — `charged into {defender}
   (dmg 1, took 1)`. Defender projected via
   `renderCharacterTypedId(state, defenderId)` (returns the persona
   display name).
3. **Wall-bump** — `tried to move and hit {wallRectId} (took 1)`.
4. **Slide** — existing `hugged {wallRectId} {axis} ...` (preserved
   verbatim; slide is mutually exclusive with bump).
5. **Cardinal dead-stop** — existing `tried to move and hit wall`
   (kept for backward compatibility with the phase-3
   wall-blocked-move metric reader).

**Mutual exclusion / precedence (D16, D21 — locks Review-B MED / A LOW):**

slide and bodyCollision are **NOT globally mutually exclusive**. The
existing multi-step movement supports slide-then-continue (see
`tests/engine/movement.test.ts:1146`), so a later substep can produce
a bump or charge after one or more slide substeps. Rendering: slide
fragment first, then bump/charge fragment.

**Rationale (D21):** slide already implies movement happened (the
agent landed at `to`); bump/charge is a discrete event after the
partial-distance commit, so we render both fragments. The same logic
explains why a partial-distance wall bump renders BOTH movement and
bump — bump is the discrete dead-stop event, movement is the prior
committed progress.

| # | Mover situation | Movement | bodyCollision | slide | blockedBy | Outcome line |
|---|---|---|---|---|---|---|
| 1 | Clean N-tile move | ✓ N>0 | — | — | — | `moved N {dir}` |
| 2 | Full diagonal slide (no bump) | ✓ ≥1 | — | ✓ | — | `hugged Wall_* {axis} ...` (slide line replaces the bare movement) |
| 3 | Cardinal dead-stop into wall (start===end) | — | wall | — | "wall" | `tried to move and hit Wall_* (took 1)` |
| 4 | Diagonal dead-stop both fallbacks blocked | — | wall | — | "wall" | `tried to move and hit Wall_* (took 1)` |
| 5 | Partial-distance bump (start!==end) | ✓ N>0 | wall | — | — | `moved N {dir}, tried to move and hit Wall_* (took 1)` |
| 6 | Charge stationary (no slide possible — char-blocked) | — | character | — | — | `charged into {defender} (dmg 1, took 1)` |
| 7 | Partial-distance charge | ✓ N>0 | character | — | — | `moved N {dir}, charged into {defender} (dmg 1, took 1)` |
| 8 | **Slide-then-charge composite (D16)** | ✓ ≥1 | character | ✓ | — | `hugged Wall_* {axis} ...; charged into {defender} (dmg 1, took 1)` |
| 9 | **Slide-then-bump composite (D16+D21)** | ✓ ≥1 | wall | ✓ | — | `hugged Wall_* {axis} ...; tried to move and hit Wall_* (took 1)` |

Render order: **movement → slide → bodyCollision** (fragments joined
with `, ` for movement-then-collision and `; ` between slide and
collision to keep the slide phrasing self-contained). Regression test
required (WP-B): slide-then-bump composite renders BOTH fragments.

The `tried to move and hit wall` legacy phrasing (no rect id) at
inputBuilder.ts:196 is replaced by the rect-id form
`tried to move and hit {wallRectId} (took 1)` — single source of
truth for the wall-bump line, consistent with the rect-keyed Vision.

#### 3.2.2 `renderDamageEventLines` extension

`convex/llm/inputBuilder.ts:279-303` currently iterates
`prev.resolution.actions[]` for damage attribution to the observer.
Extend to ALSO iterate `prev.resolution.moves[]` for character
collisions where the observer === `bodyCollision.defenderId`:

```ts
for (const move of prev.resolution.moves) {
  if (!move.bodyCollision || move.bodyCollision.kind !== "character") continue;
  if (move.bodyCollision.defenderId !== observer.characterId) continue;
  const charger = renderCharacterTypedId(state, move.characterId);
  lines.push(`${charger} charged into you (dmg 1)`);
}
```

This produces the defender's damage-feed line. Order: damage events
emit in iteration order; chargeLines append to the existing
attack/overwatch/counter lines.

**Self-feed suppression.** When the observer IS the mover (own
`bodyCollision.kind === "character"`), the damage-feed line is NOT
emitted for the observer — their `renderMoveFragment` already carries
"took 1". This prevents double-attribution.

#### 3.2.3 Cross-turn damage feed audit

`convex/turnsDerived.ts:buildDeliverySignals` (lines 515-631)
currently audits `previousRow.resolution.actions[]` for damage-action
deliveries (the phase-7 attempt-2 fix). Extend to also audit
`previousRow.resolution.moves[]` for character collisions:

For each `move` with `bodyCollision.kind === "character"`:
- Compute expected damage-feed line for the defender:
  `<chargerDisplay> charged into you (dmg 1)`.
- Look up `defenderRecord` in `currentRecords` by
  `bodyCollision.defenderId`.
- Increment `defenderSignals.damageFeedAudit.expectedIncoming`.
- If `composedUserMessage.includes(expected) === true` → `incoming +=
  1`; else `missingIncoming += 1`.
- Increment `chargerSignals.damageFeedAudit.expectedOutgoing` and
  conditionally `outgoing` / `missingOutgoing`.

Death credit: if `defenderId ∈ deaths` (charge lethal), increment the
charger's `expectedDealtKills` and check the kill feed line. The
existing kill-feed renderer (`buildKillFeedLines`,
inputBuilder.ts:316-345) currently iterates `actions[]` for damage
actions — it must be extended to also iterate `moves[].bodyCollision`
for lethal charges, otherwise charge-kills go unattributed in the kill
feed. **Decision: do extend kill-feed for lethal charges.** Phrasing:
`<charger> killed <victim> with bare hands` (no weapon involved — body
collision; phase-7 already maps absent weapons to "bare hands" in the
kill feed at lines 339-341).

**`emittedVictims` iteration order (D17, locks Review-A MED).**
Iterate `actions[]` FIRST, THEN `moves[].bodyCollision` as a fallback
for victims not yet credited. Rationale: a victim who takes both a
lethal ranged hit and a same-turn 1-dmg charge should be credited
under the weapon-kill verb, not "bare hands". The 1-dmg charge never
out-ranks the canonical weapon-kill attribution. Concrete pattern:

```ts
const emittedVictims = new Set<string>();
// 1. actions[] first — canonical weapon-kill attribution.
for (const action of prev.resolution.actions) {
  if (!isLethalDamageAction(action)) continue;
  emittedVictims.add(action.targetId);
  lines.push(renderWeaponKillLine(action));
}
// 2. moves[].bodyCollision second — fallback for charge-only lethal kills.
for (const move of prev.resolution.moves) {
  if (!move.bodyCollision || move.bodyCollision.kind !== "character") continue;
  const victimId = move.bodyCollision.defenderId;
  if (!prev.resolution.deaths.includes(victimId)) continue;
  if (emittedVictims.has(victimId)) continue;          // weapon-kill wins
  emittedVictims.add(victimId);
  lines.push(`${chargerDisplay} killed ${victimDisplay} with bare hands`);
}
```

### 3.3 Overseer UI — start-of-N + Status card + widening

**PM decision on the "one viewport diagnostic loop" criterion (D22,
locks Review-B MED).** The North Star calls for Status + Vision +
reasoning + map visible in one widescreen viewport. WP-C v0 lands
Status-card-in-feed alongside the grid; Vision and reasoning remain in
`apps/replay/src/components/ExpandModal.tsx` as a click-through
overlay. This is **accepted** for v0: the Status card is the
high-frequency diagnostic surface (read every row), while Vision and
reasoning are click-into when the reader wants to inspect a specific
agent at a specific turn. If user attestation at WP-D rejects this —
e.g., the modal overlay covers the grid and breaks the simultaneous
read — revisit by adding an inline Vision/reasoning surface (likely a
collapsible panel below the row or a side-by-side mini Vision summary)
in a follow-up tweak. Do NOT scope-creep into WP-C v0.

#### 3.3.1 `reconstruct` call-site flip

`apps/replay/src/routes/Replay.tsx:114-117`:

```ts
// Before
const snapshot = useMemo(() => {
  if (!bundle || hasVintageAgentRecords) return null;
  return reconstruct(bundle, currentTurn);
}, [bundle, currentTurn, hasVintageAgentRecords]);

// After — start-of-N semantics
const snapshot = useMemo(() => {
  if (!bundle || hasVintageAgentRecords) return null;
  // Grid shows state agents SAW at start of turn N = end-of-(N-1).
  // currentTurn === 0 → reconstruct(bundle, 0) returns the synthetic
  // spawn snapshot (existing turn-0 short-circuit at reconstruct.ts:117).
  const gridTurn = Math.max(0, currentTurn - 1);
  return reconstruct(bundle, gridTurn);
}, [bundle, currentTurn, hasVintageAgentRecords]);
```

**Reasoning anchor.** `reconstruct(bundle, N)` is end-of-N by
contract — it walks turns 1..N inclusive and applies each
resolution. Flipping at the call site keeps `reconstruct()` semantics
pure and lets the call site name the offset (`currentTurn - 1`)
explicitly. The TurnFeed continues to read `turnRowByTurn.get(currentTurn)`
— "decisions for turn N" stays end-of-N because that's what the
decisions are.

**Edge cases:**
- `currentTurn === 0`: clamped to `max(0, 0-1) === 0`. Grid renders
  synthetic spawn positions (turn 0). Feed shows the existing "Pre-game
  / no decisions yet" placeholder. Consistent.
- `currentTurn === totalTurns`: grid renders end-of-(totalTurns-1).
  Feed renders decisions for `totalTurns`. The post-match aftermath
  view is **intentionally not exposed (D23 accepted as diagnostic-grade
  tradeoff, locks Review-C LOW).** Rationale: diagnostic v0 reads agent
  inputs; no agent input exists for "after the final turn" — extending
  the stepper to `totalTurns + 1` would render a state with no
  matching `agentRecord`, breaking the per-turn input invariant the
  Status card depends on. The user can scrub the stepper to
  `currentTurn-1` if they want the prior-aftermath framing; if final-state
  visibility becomes a recurring user need, revisit in a later slice
  via a dedicated "match-over" surface (NOT a stepper extension).
- **HoverCard alive-at-start-of-N gotcha (D20, locks Review-A LOW).**
  At start-of-N grid, a character who dies/extracts ON turn N still
  renders alive (because end-of-(N-1) = start-of-N = pre-death). Hover
  reads `snapEntry.alive === true` while the feed simultaneously says
  "Duelist killed Camper". This is the *intended* start-of-N semantics
  — the agents saw the victim alive when they decided turn N — but
  it's a UX expectation worth flagging. WP-C UAT MUST explicitly
  verify this against the user's expectation: hover a turn-N death
  victim → AgentHover shows them alive and present. NOT a bug.
- HoverCard / metaStyle display label: `snapshot.turn ?? currentTurn`
  at Replay.tsx:301 — change to display `currentTurn` (the stepper
  position; semantically "Turn N decision"). Add a sub-label
  `(grid: start of turn N)` for transparency.
- URL `?turn=N` deep-link: unchanged semantics. `?turn=N` puts the
  stepper at N, the grid shows start-of-N, the feed shows turn N. The
  reader's mental model already treats `?turn=N` as "the turn I'm
  inspecting".

#### 3.3.2 TurnFeed widening

`apps/replay/src/routes/Replay.tsx`:

```ts
// Before — mainStyle at line 399-413
const mainStyle: React.CSSProperties = {
  // ...
  maxWidth: "1600px",   // ← caps total envelope, limits feed width
  // ...
};
// gridColStyle line 516-518
const gridColStyle: React.CSSProperties = { flex: "0 0 60%", ... };
// feedColStyle line 538-...
const feedColStyle: React.CSSProperties = { flex: "1 1 40%", ... };

// After — D18 (locks Review-A+B MED)
const mainStyle: React.CSSProperties = {
  // ...
  maxWidth: "1920px",   // ← raised to deliver the widescreen win
  // ...
};
const gridColStyle: React.CSSProperties = {
  flex: "0 1 auto",       // shrink-fit to natural square size
  ...
};
const feedColStyle: React.CSSProperties = {
  flex: "1 1 auto",       // takes all remaining width
  ...
};
```

**Why raise the envelope (D18).** Dropping the 60/40 column split
without also raising `mainStyle.maxWidth` would still cap the feed at
~700px on a 1920px viewport (1600 − padding − grid-square ≈ 700px).
The North Star explicitly invites widescreen use: "the user is on
widescreen; do not be afraid to use it". Raising the cap to `1920px`
(or removing it entirely) is consistent with that intent. Implementer
may also remove the cap; both are acceptable. The cap on `mainStyle`
governs the WHOLE route — including the header strip — so this is a
single-line bump.

The grid's existing `aspectRatio: "1 / 1"` + `height: 100%` +
`maxWidth: 100%` clamping (lines 531-536) keeps the grid square,
height-bounded by the viewport. With `flex: 0 1 auto` the column
naturally sizes to that square; the feed expands to fill the rest.

**Corrected widescreen math.** On a 1920×1080 widescreen, viewport
working-area is ~900-1000px tall after browser chrome. Grid square is
height-clamped to ~900px. Total envelope rises to 1920px (D18). Feed
budget: `1920 − padding(~48px both sides) − grid(~900px) ≈ 950-980px`.
On the prior 1600px cap, feed was ~700px (still wider than the prior
40% hard cap of ~640px, but cramped); after raising to 1920px the feed
delivers ~950-980px on a 1920px viewport. On a narrow viewport
(1024px), the grid square is height-clamped and the feed gets the
remainder. The hard 40% cap and the 1600px envelope cap are both gone.

**UAT assertion (D18).** WP-C UAT MUST verify on a 1920px viewport:
`feedColStyle.computedWidth > 700px`. Capture as a screenshot or
DevTools measurement during the WP-C browser walkthrough; record in
the §10 closure record under "Widened feed pleasing on widescreen".

#### 3.3.3 Status card per agent per turn

`apps/replay/src/components/TurnFeed.tsx` — the `FeedRow` component
gains a `<StatusCard>` rendered above the existing `oneLineStyle`
summary.

**Data source: parse `agentRecord.input.composedUserMessage`.**
The composed user message is the ground-truth surface — the literal
prompt body the LLM saw. Its `## Status` block is a stable
sub-document (mental-model §15 / iter-3) with the fields the
phase-7 diagnostic loop already extracts.

A new helper at `apps/replay/src/lib/statusCard.ts`:

```ts
export type StatusCardData = {
  position: { x: number; y: number } | null;
  insideEvac: boolean | null;
  hp: { hp: number; maxHp: number } | null;
  weapon: string | null;        // verbatim line, e.g. "sword [dmg 15]"
  armour: string | null;
  consumable: string | null;
  scratchpadBefore: string;
};

export function parseStatusCard(composedUserMessage: string, scratchpadBefore: string): StatusCardData;
```

**Parser-format contract (D19, locks Review-A+B MED).** The parser
regex MUST match `convex/llm/inputBuilder.ts:516-529 renderStatusBlock`
**verbatim** — the wireframe below is illustrative, the source is the
contract. Preserve bracketed stats (`[dmg]`, `[-N dmg]`, consumable
stats) — do NOT strip them via `slotValueFromLine`, which removes
brackets (`convex/turnsDerived.ts:248`). The user reads weapon damage
and armour mitigation off these brackets; stripping breaks the
diagnostic loop.

The canonical block format (copied verbatim from
`inputBuilder.ts:520-527` as a contract fixture — UPDATE this fixture
if `renderStatusBlock` ever changes):

```
## Status
📍(45,47) Inside Evac
❤️HP: 38/50 HP
⚔️weapon: sword [dmg 15]
🛡️armour: leather [-3 dmg]
🧪consumable: heal [heal 20% max HP]
🗒️scratchpad: two enemies near evac, holding for trader
```

Note the exact format: no space after `📍`, no space inside the `(x,y)`
parenthesis, no spaces around `,`; `❤️HP:` has a literal `HP:` label
AND a trailing `HP` unit; weapon/armour/consumable lines have a
literal `weapon:` / `armour:` / `consumable:` label after the emoji
and BEFORE the slot rendering. Parser regex must anchor on these
literal labels.

Reference patterns to mirror (DO NOT call directly — replay app is
decoupled from engine):
- `convex/turnsDerived.ts:extractObserverPos` (position regex)
- `convex/turnsDerived.ts:extractSelfHp` (HP regex)
- `slotValueFromLine` — patterns are useful but the stripping helper
  is NOT — copy the regex anchor, KEEP the brackets in the captured
  group.

Replay-app duplication is acceptable per architecture §1 (renderer
decoupled from engine; the parsing is local).

`scratchpadBefore` is read directly from `agentRecord.input.scratchpadBefore`
(the canonical pre-decision scratchpad surface; it's the same value
the engine wrote into the composed Status block).

**Rendering surface (per-row).** The wireframe below shows visual
layout; the *displayed text* mirrors `renderStatusBlock` verbatim per
the contract above (D19):

```
┌─────────────────────────────────────────────────────────────┐
│ ● Duelist  duelist                              [usage] ⚠ ☰ │
│ ┌──── Status (start of turn N) ────────────────────────┐    │
│ │ 📍(45,47) Inside Evac                                 │    │
│ │ ❤️HP: 38/50 HP                                         │    │
│ │ ⚔️weapon: sword [dmg 15]                               │    │
│ │ 🛡️armour: leather [-3 dmg]                            │    │
│ │ 🧪consumable: heal [heal 20% max HP]                   │    │
│ │ 🗒️scratchpad: two enemies near evac, holding for…     │    │
│ └───────────────────────────────────────────────────────┘    │
│ moved 3 NE, charged into Camper (dmg 1, took 1)              │
│ "let's wait one more turn"                                   │
│ scratchpad: "two enemies near evac…"                         │
└─────────────────────────────────────────────────────────────┘
```

Status card sits BETWEEN the row header and the decision one-line.
Visual cue: a thin separator and a muted "Status (start of turn N)"
caption. The existing scratchpad-after preview at the bottom is
retained (it's the after-state delta; complements the before-state
Status card scratchpad line).

**Fallback for missing input.** When `agentRecord.input.composedUserMessage`
is empty (older bundles, pre-iter-3 records), render
`(status unavailable — vintage record)`. The
`hasPreIter2AgentRecords` notice at Replay.tsx:273-282 already gates
the whole match from rendering for vintage data, so this fallback
covers only the partial-record edge.

### 3.4 Touch points (full impact surface)

| File | Change | WP |
|---|---|---|
| `convex/engine/movement.ts` | Substep loop populates `bumpByMover` / `chargeByMover`; trace emit drives both `blockedBy:"wall"` AND `bodyCollision.wall` from `bumpByMover` (D11); **desire-recompute branch at lines 506-538 retired entirely**; zero-budget on mover after marker; first-only pattern mirrors `slideByMover` | WP-A |
| `convex/engine/types.ts` (`MoveTraceEntry` re-export) | Extend with `bodyCollision?` discriminated union | WP-A |
| `convex/engine/resolution.ts` (line 321 — immediately after `const attacks: AttackEvent[] = [];` at 320, before overwatch at 348) | Push `bodyCollision` damage events into `attacks[]` per §3.1.3 (D24); bilateral dedupe by sorted-pair key; events carry internal `source:"bodyCollision"` + `revealsAttacker:false` (D12) | WP-A |
| `convex/engine/resolution.ts` (reveal pass line ~701) | Skip attacks where `revealsAttacker === false` (D12); counter-generated retaliations keep default reveal behaviour | WP-A |
| `convex/engine/resolution.ts` (counter pending push ~line 628) | Dedupe pending counters by `(overwatcherId, attackerId)` tuple to preserve concept-spec §1332 "counter fires once per attacker" (D15) | WP-A |
| `convex/engine/resolution.ts` (`AttackEvent` type, `ResolutionTrace.moves[]` type ~96-112) | Add `source?: "bodyCollision"` + `revealsAttacker?: boolean` on `AttackEvent`; mirror `bodyCollision?` shape on moves trace | WP-A |
| `convex/engine/combat.ts` | **No edit.** `applyDamage` already accepts attackerId/defenderId/dmg — charges and wall-bumps route through unchanged | — |
| `convex/schema.ts` (`moves[]` validator) | Add `bodyCollision: v.optional(v.union(...))` per §3.1.4 | WP-A |
| `convex/_internal_runMatch.ts` (`resolutionValidator` at line 173; `persistTurn` consumes at line 401/406) | **Mirror schema.ts addition (D13).** Write-time gate; missing this delta = `persistTurn` rejects every turn with a charge or bump | WP-A |
| `convex/runMatch.ts` (`adaptResolutionForSchema`) | Conditional-spread `bodyCollision` into persisted row (mirror `slide` pattern) | WP-A |
| `convex/runMatch.ts` (`adaptPriorTurnRowForBuilder`) | Conditional-spread `bodyCollision` into `PrevTurnRow` reconstruction | WP-A |
| `convex/runMatch.ts` (`PersistedPriorTurnRow.resolution.moves[]` type) | Add `bodyCollision?` | WP-A |
| `convex/llm/inputBuilder.ts` (`renderMoveFragment`) | Re-shape to concatenate movement + slide + bodyCollision fragments per §3.2.1; slide+bodyCollision NOT mutually exclusive (D16) | WP-B |
| `convex/llm/inputBuilder.ts` (`renderDamageEventLines`) | Append "X charged into you (dmg 1)" lines per §3.2.2 | WP-B |
| `convex/llm/inputBuilder.ts` (`buildKillFeedLines`) | Iterate `actions[]` FIRST, then `moves[].bodyCollision` as fallback for victims not yet credited (D17); lethal-only charges emit "bare hands" kill-feed line | WP-B |
| `convex/llm/inputBuilder.ts` (`PrevTurnRow` type) | Add `bodyCollision?` on `resolution.moves[]` shape | WP-B |
| `convex/turnsDerived.ts` (`ResolutionMoveLike`) | Add `bodyCollision?` | WP-B |
| `convex/turnsDerived.ts` (`buildDeliverySignals`) | Audit charge damage-feed and kill-feed deliveries per §3.2.3 | WP-B |
| `apps/replay/src/lib/decisionEnglish.ts` (D14) | Render `bodyCollision.character` ("charged into <defender>") and `bodyCollision.wall` ("bumped into <wallRectId>") fragments in current-turn TurnFeed AND HoverCard outcome summaries; coexists with slide where applicable (D16) | WP-B |
| `harness/diagnostics/types.ts` (`ResolutionMove`) | Mirror `bodyCollision?` for CLI / dashboard consumers | WP-A |
| `apps/replay/src/routes/Replay.tsx` (snapshot useMemo, lines 114-117) | Flip `reconstruct(bundle, currentTurn - 1)` per §3.3.1 | WP-C |
| `apps/replay/src/routes/Replay.tsx` (`mainStyle.maxWidth` at line 402) | Raise from `1600px` to `1920px` (or remove) so widening delivers on widescreen (D18) | WP-C |
| `apps/replay/src/routes/Replay.tsx` (`gridColStyle` / `feedColStyle`) | Drop hard 60/40 split per §3.3.2 | WP-C |
| `apps/replay/src/routes/Replay.tsx` (metaStyle display) | Update "Current turn" label to disambiguate "decision turn N (grid: start of N)" | WP-C |
| `apps/replay/src/components/TurnFeed.tsx` (`FeedRow`) | Render `<StatusCard>` per §3.3.3 | WP-C |
| `apps/replay/src/lib/statusCard.ts` (new) | Parser for `composedUserMessage` `## Status` block — regex MUST match `inputBuilder.ts:516-529 renderStatusBlock` verbatim, preserve bracketed stats (D19) | WP-C |
| `apps/replay/src/components/HoverCard.tsx` | **No edit.** HoverCard reads `snapshot.characters[].pos`; alive-at-start-of-N gotcha documented in §3.3.1 (D20) | — |
| `apps/replay/src/components/ExpandModal.tsx` | **No edit (D22).** Vision/reasoning remain in ExpandModal for WP-C v0; revisit only if user attestation rejects | — |
| `convex/llm/decisionTool.ts` | **No edit.** No new schema field; charge is discoverable | — |
| `convex/llm/systemPrompt.ts` | **No edit.** No new teaching — discovery via outcome lines (pillar 5) | — |
| `personas/*.md` | **No edit.** No behaviour tuning in scope | — |
| `convex/reports/phase10.ts` (new) | Closing-20 aggregator + `persistComputedPhase10Report` mutation per WP-D | WP-D |
| `convex/schema.ts` (reports table) | Add `phase10PayloadValidator` and `phase10Payload: v.optional(...)` sibling field | WP-D |
| `harness/closing/phase10.ts` (new) | CLI driver mirroring phase 9 sibling-payload pattern | WP-D |
| `convex/turnsDerived.ts` (slim projection) | Pass through `bodyCollision` (already implicit via `row.resolution`); add a slim-projection unit test if drift risk warrants | WP-A |
| `tests/engine/movement.test.ts` | Charge / wall-bump scenarios per §6.1 cucumber rows; slide-then-bump composite (D16+D21) | WP-A |
| `tests/engine/resolution.test.ts` | attacks[] routing; counter-on-charge integration; bilateral dedupe; lethal charge; reveal-suppression tests (hidden charger / hidden defender / counter retaliation reveals) (D12); counter-dedupe (charge + attack vs counter defender fires once) (D15) | WP-A |
| `tests/llm/schemaMirror.test.ts` | Add `bodyCollision` parity assertion between `schema.ts:moves[]` and `_internal_runMatch.ts:resolutionValidator.moves[]` (D13) | WP-A |
| `tests/llm/inputBuilder.test.ts` | Outcome-line variants; damage-feed lines; kill-feed lethal-charge; `emittedVictims` ordering (D17); slide-then-bump composite (D16) | WP-B |
| `tests/turnsDerived.test.ts` | Cross-turn damage-feed audit extension | WP-B |
| `apps/replay/src/lib/__tests__/decisionEnglish.test.ts` (new or extend) | bodyCollision.character + bodyCollision.wall rendering in `renderMoveOutcome` / action-outcome summary; slide-then-bump composite (D14, D16) | WP-B |
| `apps/replay/src/lib/__tests__/reconstruct.test.ts` | Verify start-of-N call-site assumption (no change to `reconstruct` itself; the test asserts `reconstruct(bundle, N)` is end-of-N as today) | WP-C |
| `apps/replay/src/components/__tests__/TurnFeed.test.tsx` (if exists; otherwise new) | Status card rendering + Status block parsing | WP-C |
| `tests/reports/phase10.test.ts` (new) | Fixture-driven phase-10 aggregator | WP-D |

### 3.5 Data flow

```
ParsedDecision (per character, per turn)
    └─→ simulateMovement (Phase 4)
            substep loop:
              desire blocked-by-living-character
                → emit bodyCollision: {kind:"character", defenderId}
                → zero mover's budget
              desire blocked-by-wall, no slide
                → emit bodyCollision: {kind:"wall", wallRectId}
                → zero mover's budget
            returns MoveTraceEntry[] with bodyCollision markers

resolveTurn (Phase 5 prelude):
    for m in moves where m.bodyCollision:
      character → push attacks[A→B] and attacks[B→A] (deduped per pair)
      wall      → push attacks[A→A] (self-dmg)

    [counter snapshot at attacks.slice()]
        counter-stance defenders fire on chargers (existing pipeline)

    applyDamage batch (all attacks: ranged + overwatch + counter + charge + bump)

    Phase 6 deaths → lethal charges produce corpses (existing pipeline)

ResolutionTrace.moves[].bodyCollision  →  persisted via runMatch adapters
                                       ↓
                                       PrevTurnRow (next-turn LLM input)
                                       ↓
                                       inputBuilder:
                                         renderMoveFragment (charger row)
                                           → "moved N {dir}, charged into <D> (dmg 1, took 1)"
                                         renderDamageEventLines (defender row)
                                           → "<C> charged into you (dmg 1)"
                                         buildKillFeedLines (everyone, if lethal)
                                           → "<C> killed <D> with bare hands"

apps/replay:
    reconstruct(bundle, currentTurn - 1)  →  start-of-N grid state
    TurnFeed.FeedRow:
      <StatusCard> ← parseStatusCard(agentRecord.input.composedUserMessage)
                     // verbatim regex against renderStatusBlock (D19)
      <DecisionOneLine> ← decisionEnglish(row, character, ...)
                     // bodyCollision.character → "charged into <D>"
                     // bodyCollision.wall      → "bumped into <wallRectId>"
                     // (D14 — landed by WP-B)
    HoverCard outcome summary: same decisionEnglish renderer →
                                bodyCollision fragments visible on hover
```

### 3.6 What is intentionally NOT changed

| Surface | Why preserved |
|---|---|
| `decisionTool.ts` | No tool-schema surface — charge is discoverable per pillar 5/6 |
| `systemPrompt.ts` | No teaching — agents learn via outcome lines and emergent prompt iteration |
| `personas/*.md` | No behaviour tuning in scope |
| `applyDamage` | Already attacker-agnostic (`_attackerId` unused); routes self-dmg cleanly |
| Counter pass (`resolution.ts` §counter-fire) | Charges enter `attacks[]` before the snapshot; ONE small addition — pending dedupe by `(overwatcherId, attackerId)` (D15) to preserve concept-spec §1332 "counter fires once per attacker" under same-turn charge+attack |
| `apps/replay/src/lib/reconstruct.ts` | Semantics unchanged (end-of-N walk). Flip lives at call site |
| `apps/replay/src/components/HoverCard.tsx` | Reads `snapshot.characters[].pos`; consistent with start-of-N |
| `apps/replay/src/components/Grid.tsx` | Reads canonical worldState rectangles; no per-tile dependence on resolution |
| URL `?turn=N` deep-link | Semantic match: stepper position N, grid start-of-N, feed turn-N decisions |
| `convex/engine/runStats.ts` per-persona kill attribution | **Known issue** (mental-model §16 addendum) — charges-as-kills inherit the structurally-zero bug. Top-level `kills` works (uses `deaths.length`). Carried as known issue, not fixed inline. |
| Wall-blocked-move-rate metric reader (`convex/reports/phase3.ts`) | Still reads `moves[].blockedBy === "wall"`; both `blockedBy` and the new `bodyCollision` fire together when `start===end` |
| Phase-9 wall-slide trace shape | Coexists with bodyCollision (slide-then-bump composite per §3.2.1 precedence rows 8-9; D16+D21). Slide-only is unchanged |

## 4. Dependency Map

```
              ┌──── WP-A (engine substrate) ─────┐
              │      types + movement + resolution│
              │      + schema + _internal_runMatch│
              │      + runMatch adapters          │
              │      + slim/diagnostics shape     │
              └──┬───────────────────────────────┘
                 │ (trace shape declared up-front;
                 │  WP-B + WP-C bodyCollision rendering depend)
                 │
                 ├──→ WP-B (LLM projection + decisionEnglish)
                 │      inputBuilder + buildKillFeed +
                 │      turnsDerived audit extension +
                 │      apps/replay/src/lib/decisionEnglish.ts (D14)
                 │
                 │              ┌─ WP-C bodyCollision rendering in
                 │              │  TurnFeed/HoverCard depends on WP-B
                 │              ▼
              ┌──── WP-C (overseer UI) ─────────────┐
              │      Replay route + TurnFeed layout │
              │      + statusCard parser            │
              │      + start-of-N flip              │
              │      + Status card scaffolding      │
              │   (start-of-N + Status + widening   │
              │    INDEPENDENT of A/B; bodyCollision │
              │    fragments depend on WP-B)        │
              └──────────────┬──────────────────────┘
                             │
                             ▼
                       WP-D (closing-20)
                         phase10 aggregator + harness
                         + schema phase10Payload
```

**Parallelisation (re-threaded post-D14):**
- **Round 1 (3 parallel):** WP-A (engine), WP-C **layout/Status-card
  scaffolding** (start-of-N flip, widening, Status card parser — none
  of which depend on bodyCollision rendering), WP-D draft (test
  fixtures + validator shape sketched against the WP-A trace shape
  declared up-front).
- **Round 2 (serial):** WP-B (LLM projection + `decisionEnglish.ts`) —
  consumes WP-A's `bodyCollision` trace field. WP-B now lands the
  charge/bump rendering in BOTH the per-turn LLM input
  (`inputBuilder.ts`) AND the replay TurnFeed/HoverCard summaries
  (`decisionEnglish.ts`).
- **Round 2.5 (parallel with Round 2 if WP-C scaffolding lands fast):**
  WP-C bodyCollision visibility validation — exercise WP-B's
  `decisionEnglish.ts` changes against the layout from Round 1.
- **Round 3 (serial):** WP-D finalisation — closing-20 needs all code
  WPs landed (engine for trace emission, LLM for outcome lines, UI for
  user attestation walk-through).

**Re-threaded dependency note (D14, locks Review-B HIGH #3).** The
v1 spec claimed WP-C was 100% independent of WP-A/B because the
TurnFeed renders composed outcome strings. That was wrong: TurnFeed
renders `decisionEnglish(row)` from `apps/replay/src/lib/decisionEnglish.ts`
(see `apps/replay/src/components/TurnFeed.tsx:21, 218`), NOT
`composedUserMessage` directly. Without WP-B's `decisionEnglish.ts`
extension, charges and bumps are invisible in the replay feed. WP-C
can still draft layout (start-of-N flip, widening, Status card
scaffolding) in Round 1 — that work is genuinely independent — but
bodyCollision fragments in the feed/HoverCard land in WP-B.

**Schema conflict point.** WP-A adds `bodyCollision` to BOTH
`convex/schema.ts:moves[]` validator AND
`convex/_internal_runMatch.ts:resolutionValidator.moves[]` (D13). WP-D
adds `phase10Payload` to the `reports` table. Disjoint sub-objects.
Merge order rule: WP-A lands first; WP-D rebases.

## 5. Work Package Breakdown

### WP-A — Engine substrate: body-collision detection + attacks[] routing + persistence

**Goal:** The engine detects character charges and wall-bumps in the
substep loop, attaches `bodyCollision` markers to `moves[]` trace
entries, and routes the damage through `attacks[]` so counter-fire
falls out for free. Schema, adapters, and slim projection carry the
field end-to-end.

**Scope:**

1. **Types (`convex/engine/types.ts` / `movement.ts`):**
   - Extend `MoveTraceEntry` with `bodyCollision?: {kind:"character",
     defenderId:string} | {kind:"wall", wallRectId:string}`.
   - Re-export through `ResolutionTrace.moves[]`.

2. **Substep loop (`convex/engine/movement.ts`):**
   - In the desire-planning block (~lines 414-426), when `isBlocked`
     returns true:
     - If `tileBlockedByWall(desiredTile)`: attempt `tryResolveSlide`;
       if no slide, record bump for this mover via a new
       `bumpByMover: Map<string, {wallRectId}>`.
     - Else if a living character occupies `desiredTile` (per
       `currentPos` / `state.characters` at start-of-substep): record
       charge for this mover via a new
       `chargeByMover: Map<string, {defenderId}>`.
     - Else (off-grid / conflict): no marker, existing behaviour.
   - After recording a marker for a mover, zero their budget so
     subsequent substeps skip them.
   - At trace-emission time (end of `simulateMovement`), merge
     `chargeByMover` / `bumpByMover` into the per-mover
     `MoveTraceEntry.bodyCollision`.
   - **Marker firing is first-only** (mirror `slideByMover` pattern):
     subsequent substeps cannot overwrite a recorded marker.
   - **Retire the desire-recompute branch at lines 506-538 (D11).**
     `blockedBy:"wall"` is now driven from `bumpByMover` at the same
     trace-emission writer: emit when `bumpByMover.has(id) && start===end`.
     This eliminates the silent-loss bug where the existing budget gate
     at line 509 would drop `blockedBy:"wall"` on a wall-bump (mover
     has zero budget because we zeroed it on the bump). See §3.1.2 for
     the writer pseudocode.

3. **Counter snapshot ordering (`convex/engine/resolution.ts`):**
   - **Pinned insertion point (D24):** immediately AFTER
     `const attacks: AttackEvent[] = [];` at `resolution.ts:320` and
     BEFORE the overwatch loop at `resolution.ts:348`. Iterate
     `moveResult.moves` and push body-collision damage into `attacks[]`:
     - character collision → `{attackerId:m.characterId,
       defenderId:m.bodyCollision.defenderId, dmg:1,
       source:"bodyCollision", revealsAttacker:false}` AND the
       symmetric body-recoil entry; dedupe bilateral pairs by
       sorted-`[A,B]` key so each pair fires once.
     - wall bump → `{attackerId:m.characterId,
       defenderId:m.characterId, dmg:1, source:"bodyCollision",
       revealsAttacker:false}`.
   - **`AttackEvent` shape extension (D12):** add optional
     `source?: "bodyCollision"` (internal discriminator) and optional
     `revealsAttacker?: boolean` (defaults to `true` when absent).
   - **Reveal pass change (D12):** `resolution.ts:701` reveal loop
     adds `if (a.revealsAttacker === false) continue;` so
     body-collision sourced attacks DO NOT auto-reveal the charger or
     defender. Counter-generated retaliations (pushed by the counter
     pass itself, NOT by this block) carry the default — they reveal
     normally per existing rules.
   - **Counter pending dedupe (D15):** at `resolution.ts:628`, the
     pending-counter push now uses a `Set<string>` keyed by
     `${overwatcherId}|${attackerId}` to ensure a single attacker
     producing both a charge AND an attack vs the same counter
     defender triggers ONE counter, not two. Preserves concept-spec
     §1332.
   - The counter snapshot at line 622 (`const originalAttacks =
     attacks.slice()`) now includes charge events → counter-stance
     defenders retaliate via the existing counter pipeline with zero
     new branching (other than the dedupe Set).
   - `trace.actions[]` does NOT mirror these — attribution lives on
     `trace.moves[].bodyCollision`.

4. **Schema + adapters (`convex/schema.ts` / `convex/_internal_runMatch.ts` / `convex/runMatch.ts`):**
   - `convex/schema.ts:moves[]` validator: add
     `bodyCollision: v.optional(v.union(...))`.
   - **`convex/_internal_runMatch.ts:resolutionValidator.moves[]`**
     (line 173 onward, consumed by `persistTurn` at line 401/406):
     mirror the same `bodyCollision` validator addition (D13). This is
     the WRITE-TIME gate — `persistTurn` validates the runtime
     `resolution` against the LOCAL validator, NOT the table schema.
     Missing this delta = `persistTurn` rejects every turn with a
     charge or bump.
   - `adaptResolutionForSchema.moves.map`: conditional-spread
     `bodyCollision` into persisted row.
   - `adaptPriorTurnRowForBuilder.moves.map`: conditional-spread
     `bodyCollision` into `PrevTurnRow`.
   - `PersistedPriorTurnRow.resolution.moves[]` type: add
     `bodyCollision?`.
   - **Schema-mirror parity test (D13):** mirror
     `tests/llm/schemaMirror.test.ts:543` for `bodyCollision` — assert
     IDENTICAL validator shape between `schema.ts:moves[]` and
     `_internal_runMatch.ts:resolutionValidator.moves[]`. WP-A is NOT
     done until this passes.

5. **Slim projection + diagnostics types
   (`convex/turnsDerived.ts` / `harness/diagnostics/types.ts`):**
   - `ResolutionMoveLike` / `ResolutionMove`: add `bodyCollision?`.
   - `projectSlimTurnRow` passes `row.resolution` through line 669
     unchanged — confirm `bodyCollision` survives via a regression
     test.

6. **Tests — cucumber → named-test mapping:**

   `tests/engine/movement.test.ts`:
   - **§6.1 Charge stationary defender** → `move into living-char tile,
     defender stationary → bodyCollision.kind="character",
     defenderId=B; mover stays at start; budget zeroed`.
   - **§6.1 Bilateral charge** → `A wants B's tile, B wants A's; both
     get bodyCollision.character markers; both stay; both budgets zeroed`.
   - **§6.1 Hidden charger reveal** → `charger's substep ends adjacent
     to defender; existing proximity-reveal pipeline picks up
     (phase-3); no new logic in this WP — assert via integration test
     at resolution layer`.
   - **§6.1 Cardinal-direct wall bump** → `move E into wall →
     bodyCollision.kind="wall"; blockedBy:"wall" also set
     (start===end legacy contract); budget zeroed`.
   - **§6.1 Diagonal both fallbacks blocked** → `NE move into wall,
     both cardinals blocked → bodyCollision.wall; no slide`.
   - **§6.1 Diagonal slide (no bump)** → `NE move into wall, one
     cardinal clear → slide emitted (existing); NO bodyCollision`.
   - **§6.1 Partial-distance wall bump** → `3-step E move, 2 steps
     commit, 3rd step is wall → mover ends at start+2,
     bodyCollision.wall set, blockedBy NOT set (start!==end)`.
   - **§6.1 Partial-distance charge** → `3-step E move, 2 steps
     commit, 3rd step is living enemy → mover ends at start+2,
     bodyCollision.character set; budget zeroed at substep 3`.

   `tests/engine/resolution.test.ts`:
   - **§6.2 attacks[] routing — asymmetric charge** → `A charges B
     (B stationary in move dist:0). attacks[] contains A→B (dmg 1)
     AND B→A (dmg 1). applyDamage applies both; A.hp -= 1, B.hp -= 1`.
   - **§6.2 attacks[] routing — bilateral dedupe** → `A↔B charge
     each other. attacks[] contains exactly one pair (A→B, B→A);
     each takes 1, not 2`.
   - **§6.2 Counter-on-charge** → `A charges B (B position:counter,
     in range). Counter snapshot picks up A→B entry → enqueues
     counter-fire B→A using B's equipped weapon. applyDamage batch
     resolves charge dmg + counter dmg simultaneously`.
   - **§6.2 Lethal charge produces corpse** → `A charges B at 1 HP.
     B dies in Phase-6 deaths. Corpse mirroring B's equipped slots
     appears in worldState.corpses`.
   - **§6.2 Bilateral cannot counter** → `A↔B charge, neither in
     counter stance → no counter-fires; only the two charge dmgs
     apply`.
   - **§6.2 Wall-bump self-dmg no counter** → `A bumps wall, A→A
     dmg in attacks[]. A is in move stance, not counter →
     counterActors.has(A)===false → no counter-fire`.
   - **D12 reveal-suppression — hidden charger** → `A is hidden
     (revealed=false). A charges B. After resolution, A.revealed
     stays false. The bodyCollision attack source is "bodyCollision",
     revealsAttacker:false. Reveal pass at line 701 skips it.`
   - **D12 reveal-suppression — hidden defender** → `B is hidden.
     A (visible) charges B. After resolution, B.revealed stays false.
     The B→A body-recoil entry skips reveal too.`
   - **D12 counter retaliation reveals normally** → `B (hidden,
     counter-stance) is charged by A. B's counter-fire generated by
     the counter pass uses the default (no source flag) → reveals B
     per existing rules.`
   - **D15 counter dedupe — same attacker, two attacks** → `A charges
     B AND launches a ranged attack at B in the same turn. B is in
     counter-stance and in range. Counter pass fires ONCE against A,
     not twice. originalAttacks contains two A→B entries but
     pendingCounterKeys dedupes.`

   `tests/llm/schemaMirror.test.ts` (D13):
   - **bodyCollision parity** → assert
     `schema.ts:moves[].bodyCollision` validator shape ===
     `_internal_runMatch.ts:resolutionValidator.moves[].bodyCollision`
     validator shape. Single-property check; mirrors the phase-9
     `slide` parity assertion at `schemaMirror.test.ts:543`.

   `tests/turnsDerived.slim.test.ts` (or new sibling):
   - **Slim projection preserves `bodyCollision`** → fixture move
     entry with bodyCollision → slim projection passes it through
     unchanged.

**Test design:**

| Layer | Coverage |
|---|---|
| Unit (engine.movement) | Substep marker emission, budget-zero, first-only |
| Unit (engine.resolution) | attacks[] routing, counter snapshot ordering, lethal-charge deaths, bilateral dedupe |
| Persistence smoke | Roundtrip `bodyCollision` through `adaptResolutionForSchema` → `adaptPriorTurnRowForBuilder` |
| Slim projection | `bodyCollision` survives `projectSlimTurnRow` |

**Success criteria:**

- All cucumber rows §6.1 / §6.2 pass.
- No regression in existing movement/resolution tests (slide,
  toward/away/relative/compass moves, counter-on-attack,
  overwatch-on-movement, deaths).
- Counter pipeline retains zero new branching — the only resolution.ts
  edit is the push-into-attacks[] block; the counter pass and
  applyDamage loop are unchanged.
- Lint / typecheck / test / build green for engine + runMatch layers.

### WP-B — LLM projection + replay-app outcome rendering

**Goal:** Per-turn LLM input renders the charge/bump outcome lines on
the mover's row, the damage-feed line on the defender's row, and the
kill-feed line on lethal charges. The cross-turn delivery audit
counts charge-feed deliveries. **Expanded scope (D14):** replay-app
`decisionEnglish.ts` renders bodyCollision fragments in TurnFeed and
HoverCard outcome summaries.

**Scope:**

1. **`convex/llm/inputBuilder.ts:renderMoveFragment` re-shape** per
   §3.2.1 — concatenate movement, slide, bodyCollision fragments
   (slide and bodyCollision are NOT mutually exclusive — D16). Render
   order: movement → slide → bodyCollision; slide-then-bump composite
   renders both fragments. Update the existing `tried to move and hit
   wall` phrasing to the rect-id variant `tried to move and hit
   {wallRectId} (took 1)`.

2. **`renderDamageEventLines` extension** per §3.2.2 — append
   `<charger> charged into you (dmg 1)` lines from
   `moves[].bodyCollision.kind === "character"` where the defender
   is the observer. Self-feed suppression for mover === observer.

3. **`buildKillFeedLines` extension (D17 ordering rule)** — iterate
   `actions[]` FIRST (preserving canonical weapon-kill attribution),
   THEN iterate `moves[].bodyCollision` for victims not yet credited.
   A victim who takes both a lethal weapon hit and a same-turn 1-dmg
   charge is credited under the weapon-kill verb, NOT "bare hands"
   (the 1-dmg charge never out-ranks the weapon kill). Phrasing for
   pure-charge kills: `<charger> killed <victim> with bare hands`
   (mirror the existing absent-weapon → "bare hands" pattern at lines
   339-341). The `emittedVictims` set prevents double-emission.

4. **`PrevTurnRow` type** — extend `resolution.moves[]` with
   `bodyCollision?` (parallel to the schema delta in WP-A).

5. **`convex/turnsDerived.ts:buildDeliverySignals`** audit
   extension per §3.2.3 — iterate `previousRow.resolution.moves[]`
   for character collisions; tally
   `damageFeedAudit.{incoming,outgoing,missingIncoming,missingOutgoing,
   dealtKills,expectedDealtKills,missingDealtKills}`.

6. **`ResolutionMoveLike` in turnsDerived.ts** already covered by
   WP-A's type extension; WP-B verifies through the audit unit test.

7. **`apps/replay/src/lib/decisionEnglish.ts` (D14 — NEW IN WP-B):**
   - **Why this lives in WP-B, not WP-C.** TurnFeed renders
     `decisionEnglish(row)` not `composedUserMessage` — without this
     update, charges and bumps are invisible in the replay feed (per
     Review-B HIGH #3).
   - Extend `renderMoveOutcome` (line 216) to surface
     `bodyCollision.character` as `charged into <defender>` and
     `bodyCollision.wall` as `bumped into <wallRectId>`. Use
     `resolveCharacterName` for defender display name.
   - Where slide is also set, render both fragments (slide first; see
     §3.2.1 row 8/9).
   - HoverCard outcome summaries consume the same renderer, so
     `decisionEnglish` is the single source for both surfaces.
   - **Tests:** new fixture-driven tests at
     `apps/replay/src/lib/__tests__/decisionEnglish.test.ts` covering
     pure charge, pure bump, slide-then-bump composite, slide-only
     (regression).

8. **Tests:**

   `tests/llm/inputBuilder.test.ts` — cucumber → named-test mapping:
   - **§6.3 charge outcome line** → `entry.bodyCollision.character →
     "charged into Duelist (dmg 1, took 1)"`.
   - **§6.3 partial-distance + charge** → `entry from!==to,
     bodyCollision.character → "moved N {dir}, charged into Duelist
     (dmg 1, took 1)"`.
   - **§6.3 wall bump outcome** → `entry.bodyCollision.wall →
     "tried to move and hit Wall_39_70 (took 1)"`.
   - **§6.3 partial-distance + wall bump** → `entry from!==to,
     bodyCollision.wall → "moved N {dir}, tried to move and hit
     Wall_* (took 1)"`.
   - **§6.3 slide-only (no bump)** → `entry.slide set, no
     bodyCollision → "hugged Wall_*..." (no "took 1")`.
   - **§6.3 slide-then-bump composite (D16+D21)** → `entry.slide AND
     entry.bodyCollision.wall both set → "hugged Wall_* ...; tried to
     move and hit Wall_* (took 1)"` (slide first, then bump fragment).
   - **§6.4 damage feed line** → `prev contains a move with
     bodyCollision.character pointing at observer → "Camper charged
     into you (dmg 1)" appears in renderDamageEventLines output`.
   - **§6.4 damage feed self-suppression** → `observer IS the
     charger → no "<self> charged into you" line for them`.
   - **§6.4 kill feed lethal charge** → `prev contains lethal
     charge (victim ∈ deaths) → buildKillFeedLines emits
     "<charger> killed <victim> with bare hands"`.
   - **§6.4 kill feed ordering (D17)** → `victim takes BOTH a lethal
     weapon hit AND a same-turn 1-dmg charge → "<weapon-killer>
     killed <victim> with <weapon>" emitted; "bare hands" line is
     SUPPRESSED for that victim`.

   `apps/replay/src/lib/__tests__/decisionEnglish.test.ts` (D14):
   - **pure charge in feed** → `move with bodyCollision.character →
     decisionEnglish surfaces "charged into <defender>"`.
   - **pure bump in feed** → `move with bodyCollision.wall →
     decisionEnglish surfaces "bumped into <wallRectId>"`.
   - **slide-only (regression)** → existing "hit wall" phrasing
     preserved.
   - **slide-then-bump composite** → both fragments visible.

   `tests/turnsDerived.test.ts` (or sibling slim test):
   - **§6.4 cross-turn audit — charge delivery present** → defender's
     current-turn `composedUserMessage` contains the expected
     "charged into you" line → `damageFeedAudit.incoming` increments.
   - **§6.4 cross-turn audit — charge delivery missing** → defender's
     message lacks the line → `missingIncoming` increments.
   - **§6.4 cross-turn audit — charger outgoing counters** → mirror
     for `outgoing` / `missingOutgoing`.

**Test design:**

| Layer | Coverage |
|---|---|
| Unit (inputBuilder) | All outcome / damage-feed / kill-feed variants |
| Unit (turnsDerived) | Cross-turn audit deltas |
| Integration | `tests/llm/integration.test.ts` natural coverage when a turn through `buildAgentInput` exercises bodyCollision via a fixture move trace |

**Success criteria:**

- All cucumber §6.3 / §6.4 scenarios pass.
- Damage-feed audit reports zero `missingIncoming` for charge events
  in the integration fixture (cross-turn delivery is the contract).
- All gates green (lint, typecheck, test, build).

### WP-C — Overseer UI: start-of-N + widened TurnFeed + Status card

**Goal:** The replay route renders start-of-N grid state; the
TurnFeed expands to fill widescreen width with a per-agent Status
card mirroring the per-turn `## Status` block.

**Scope:**

1. **`apps/replay/src/routes/Replay.tsx`:**
   - Flip the `snapshot` useMemo to `reconstruct(bundle, Math.max(0,
     currentTurn - 1))` per §3.3.1.
   - Update the metaStyle "Current turn" line to disambiguate:
     `Current turn: <strong>{currentTurn}</strong> (grid: start of
     turn {currentTurn})`.
   - Drop the hard 60/40 split in `gridColStyle` / `feedColStyle`
     per §3.3.2.
   - **Raise `mainStyle.maxWidth` from `1600px` to `1920px`** (or
     remove entirely) per D18. Without this, the feed budget on a
     1920px viewport is only ~700px (still wider than the prior 40%
     cap, but cramped). UAT verifies feed width > 700px.

2. **`apps/replay/src/lib/statusCard.ts` (new):**
   - `parseStatusCard(composedUserMessage, scratchpadBefore)` —
     extract position, HP, weapon, armour, consumable, insideEvac
     flag from the `## Status` block. Mirror regex patterns from
     `convex/turnsDerived.ts:extractObserverPos` /
     `extractSelfHp` / `slotValueFromLine`. Replay-app duplication is
     deliberate (renderer decoupled from engine; architecture §1).
   - Returns `StatusCardData` with all-optional fields gracefully
     defaulted to `null` on parse failure.

3. **`apps/replay/src/components/TurnFeed.tsx:FeedRow`:**
   - Add a `<StatusCard>` section between `<rowHeaderStyle>` and
     `<oneLineStyle>`.
   - Render position, HP, weapon, armour, consumable, scratchpad-before,
     insideEvac flag. Use the same emoji glyphs the engine uses
     (📍 ❤️ ⚔️ 🛡️ 🧪 🗒️) for visual mapping to the per-turn input
     surface.
   - Caption: `Status (start of turn N)` — explicit temporal label
     to reinforce the start-of-N semantics.
   - Fallback row: when `composedUserMessage` is empty or unparseable,
     render `(status unavailable — vintage record)`.

4. **Tests:**
   - `apps/replay/src/lib/__tests__/statusCard.test.ts` (new) —
     parse fixtures derived from `inputBuilder.renderStatusBlock`
     outputs; assert each field extracts correctly. Include an empty/
     malformed fixture for the fallback case.
   - `apps/replay/src/components/__tests__/TurnFeed.test.tsx` (extend
     if exists; else new) — assert FeedRow renders the StatusCard
     section with parsed fields.
   - `apps/replay/src/lib/__tests__/reconstruct.test.ts` — verify
     the call-site flip premise: `reconstruct(bundle, 0)` returns
     the synthetic spawn snapshot (existing), and the snapshot
     stepping through a fixture matches start-of-N expectations.

5. **UAT walkthrough (manual):**
   - Start the dev server (`npm run dev` in `apps/replay`).
   - Pick a completed match from the picker; deep-link to `?turn=10`.
   - Confirm: grid shows entity positions matching what the agents
     reasoned over (cross-reference against `composedUserMessage`
     Vision payload in the expand modal — positions in Vision should
     equal positions on the grid for any agent at turn 10).
   - **Confirm widening (D18):** at 1920px viewport,
     `feedColStyle.computedWidth > 700px` via DevTools or screenshot
     measurement.
   - Confirm: each agent's row shows the Status card with all 6
     fields populated; bracketed stats (`[dmg N]`, `[-N dmg]`,
     consumable stats) are visible verbatim (D19).
   - **Confirm hover gotcha (D20):** hover a character who dies on
     turn N — AgentHover shows them alive and present (this is
     intended start-of-N behaviour, NOT a bug). Cross-check the feed
     for the same turn — it shows "X killed Y" while hover says Y is
     alive. User acknowledges the temporal layering.
   - **Confirm aftermath inaccessibility (D23):** stepper at
     `totalTurns` shows decisions for the final turn and grid for
     end-of-(totalTurns-1). There is NO stepper position past
     `totalTurns`; user acknowledges this is the diagnostic-grade
     tradeoff.

**Test design:**

| Layer | Coverage |
|---|---|
| Unit (statusCard parser) | Field-by-field parse of fixture composedUserMessage |
| Unit (TurnFeed) | StatusCard renders; fallback for vintage record |
| Manual UAT | Browser walkthrough on a completed closing-20 match |

**Success criteria:**

- Stepper at turn N → grid shows end-of-(N-1) state. Verified
  manually by reading any agent's Vision payload at turn N and
  matching positions against the grid.
- TurnFeed column fills widescreen width; grid stays square.
- Per-agent Status card renders 6 fields + insideEvac flag.
- URL `?turn=N` deep-link round-trips correctly (parse → grid +
  feed render → URL persistence).
- All replay-app gates green (`npm run lint`, `npm run typecheck`,
  `npm test`, `npm run build`).

### WP-D — Closing-20 report + attestation

**Goal:** A persisted Convex closing-20 report with phase-10
thresholds met. User attests substrate feel by stepping through the
20 runs in the (now refined) replay UI.

#### WP-D §1 — Slim projection extension

Mirror phase-9's WP-E §1 pattern. The slim projection passes
`row.resolution` through, so `bodyCollision` is already accessible
via `slimTurnRow.resolution.moves[].bodyCollision`. No new
slim-fields needed for the closing-20 aggregator.

Wall-bump and charge counts are tallied directly off the slim
`resolution.moves[]` field. Damage-feed delivery audit is already
emitted on `slimAgentRecord.damageFeedAudit` (WP-B extends the audit
producer); the aggregator reads it as-is.

#### WP-D §2 — `phase10PayloadValidator` shape

New validator on `convex/schema.ts`, sibling to
`phase9PayloadValidator`:

```ts
const phase10PayloadValidator = v.object({
  // ── Carry-over phase-7 / phase-9 gates ────────────────────────
  reportType: v.literal("phase-10-closing-20"),
  runCount: v.number(),
  matchIds: v.array(v.id("matches")),
  failedMatches: v.number(),
  runsWithExtraction: v.number(),
  runsWithKill: v.number(),
  runsWithEquip: v.number(),
  runsWithSpeech: v.number(),
  extractionRate: v.number(),
  killRate: v.number(),
  equipRate: v.number(),
  speechRate: v.number(),
  personaSpread: v.number(),
  totalAgentRecords: v.number(),
  nullOnlyUseViolations: v.number(),
  zeroCrashes: v.boolean(),
  zeroIllegalConsumableUse: v.boolean(),
  zeroPlayerNLiterals: v.boolean(),
  zeroWholeTurnValidatorZeroes: v.boolean(),
  perFieldRejectionRate: v.number(),

  // ── Phase-10 slice-specific gates ─────────────────────────────
  chargeOutcomeCount: v.number(),
  chargeOutcomePerPersona: v.array(
    v.object({ personaId: personaIdValidator, count: v.number() }),
  ),
  bilateralChargeCount: v.number(),
  counterFireOnChargeCount: v.number(),
  wallBumpSelfDmgCount: v.number(),
  partialDistanceWallBumpCount: v.number(),
  partialDistanceChargeCount: v.number(),
  chargeDamageFeedDelivered: v.number(),
  chargeDamageFeedExpected: v.number(),
  chargeDamageFeedMissing: v.number(),
  lethalChargeCount: v.number(),

  // ── Gate flags ────────────────────────────────────────────────
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
  meetsChargeOutcomeThreshold: v.boolean(),       // ≥ 10
  meetsCounterFireOnChargeThreshold: v.boolean(), // ≥ 3
  meetsWallBumpSelfDmgThreshold: v.boolean(),     // ≥ 5
  meetsPartialDistanceWallBumpThreshold: v.boolean(), // ≥ 1
  meetsChargeFeedDeliveryThreshold: v.boolean(),  // missing === 0
  meetsAllThresholds: v.boolean(),
});
```

#### WP-D §3 — `convex/reports/phase10.ts`

Mirror `convex/reports/phase9.ts`:

- `computePhase10Metrics(runs: Phase10RunInput[]): Phase10Payload`
  — carry phase-7 metrics via `computePhase7Metrics(runs as
  Phase7RunInput[])`, then tally slice-specific counters from
  `slimAgentRecord.damageFeedAudit` and `resolution.moves[].bodyCollision`.
- `persistComputedPhase10Report` mutation (mirrors
  `persistComputedPhase9Report` at convex/reports/phase9.ts).
- `reportType: "phase-10-closing-20"`.

Counter-fire-on-charge tally rule: count
`resolution.actions[]` entries with `kind:"counter"` AND
`result:"dmg N"` AND whose `target` (display name) corresponds to a
character that produced a `bodyCollision.character` move trace
entry the same turn. Requires a per-turn join between `actions` and
`moves` (small — 8 movers × 8 chars per turn × 50 turns).

#### WP-D §4 — `harness/closing/phase10.ts`

Mirror `harness/closing/phase9.ts`:
- 20 matches, concurrency per existing harness pattern.
- Persist with `reportType: "phase-10-closing-20"`.
- Free reign on Azure `.env` endpoint per assignment authority.

#### WP-D §5 — Tests

- `tests/reports/phase10.test.ts` — fixture-driven aggregator
  contract (mirror `phase9.test.ts`):
  - Fixture with one bodyCollision.character move → `chargeOutcomeCount === 1`.
  - Fixture with bilateral pair (two movers each with bodyCollision
    pointing at the other) → `bilateralChargeCount === 1`,
    `chargeOutcomeCount === 2`.
  - Fixture with counter-fire `actions[]` entry whose target matches
    a bodyCollision charger → `counterFireOnChargeCount === 1`.
  - Fixture with bodyCollision.wall and `from===to` → wall-bump tally.
  - Fixture with bodyCollision.wall and `from!==to` → partial-distance
    wall-bump tally.
  - Gate rollup: all thresholds met → `meetsAllThresholds === true`.

#### WP-D §6 — User attestation

User steps through the 20 closing-run matches in the replay UI.
Confirm:
- At least one observable charge event with visible "charged into X"
  outcome line in the feed AND defender's "X charged into you" line
  on the next turn.
- At least one counter-fire on a charger (counter-stance defender
  retaliated).
- At least one wall-bump self-dmg outcome line.
- At least one partial-distance wall-bump (mover took N steps then
  hit wall mid-budget).
- Status card visible per agent per turn; start-of-N grid feels right.

**Test design:**

| Layer | Coverage |
|---|---|
| Unit (reports/phase10) | Fixture-driven aggregator + gate rollup |
| Integration | The 20-run closing pass itself |
| Manual attestation | User UI walkthrough |

**Success criteria:**

- Persisted report row with `reportType: "phase-10-closing-20"` and
  `metBar: true`.
- Phase-7 carryover thresholds preserved (extraction ≥ 30%,
  kill ≥ 80%, equip ≥ 80%, speech ≥ 50%, persona spread ≥ 15 pp,
  zero crashes, zero illegal `use:"consumable"`, zero `Player_N`
  literals, zero whole-turn validator zeroes, per-field rejection
  ≤ 10%).
- Phase-10 slice gates:
  - `chargeOutcomeCount ≥ 10`
  - `counterFireOnChargeCount ≥ 3`
  - `wallBumpSelfDmgCount ≥ 5`
  - `partialDistanceWallBumpCount ≥ 1`
  - `chargeDamageFeedMissing === 0` (delivery audit clean)
- User attestation captured in §10 closure record.

## 6. Acceptance criteria — cucumber

Source: assignment north star, reproduced for traceability.

### 6.1 Charge + wall-bump engine substrate

```
Scenario: A mover charges into a living enemy
  Given an agent's move resolution targets a tile occupied by a living enemy
  When the engine resolves the turn
  Then the mover takes 1 dmg
  And the defender takes 1 dmg
  And the mover stays at their start-of-substep tile (no displacement)
  And the mover's outcome line names the defender and reports both damage values
  And the defender's damage feed names the charger and reports the incoming damage

Scenario: A counter-stance defender is charged
  Given a defender's position.kind = "counter"
  And a charger's move resolution lands a body-collision on that defender
  When the engine resolves the turn
  Then the counter pass fires the defender's retaliation against the charger using the existing counter pipeline
  And the retaliation lands in the same simultaneous-damage batch

Scenario: Bilateral chargers cannot counter each other
  Given two agents whose moves target each other's tile
  When the engine resolves the turn
  Then both take 1 dmg from the other
  And neither agent's counter triggers (both committed to position.kind=move)

Scenario: A cardinal move dead-stops into a wall
  Given an agent's cardinal move targets a wall tile directly
  When the engine resolves the turn
  Then the mover takes 1 dmg
  And the mover's outcome line names the wall rect and reports self-damage

Scenario: A diagonal slide along a wall
  Given an agent's diagonal move's target tile is a wall
  And one cardinal-axis slide is available
  When the engine resolves the turn
  Then the mover slides cleanly (no body-collision)
  And no self-damage is dealt
  And the outcome line uses the existing "hugged Wall_*" phrasing

Scenario: Partial-distance wall-bump after committed steps
  Given an agent's multi-step move commits N-1 steps and then bumps a wall
  When the engine resolves the turn
  Then the mover takes 1 dmg for the wall-bump
  And the outcome line reports BOTH the partial movement AND the wall-bump
  And the silent-drop trace gap is closed

Scenario: Off-grid attempt is a wall-bump (organic via perimeter wall)
  Given the reference map has a perimeter wall enclosing the playable area
  When an agent attempts to move into a perimeter-wall tile
  Then the wall-bump path applies as for any interior wall
```

### 6.2 attacks[] routing and counter integration

```
Scenario: charges enter attacks[] before counter snapshot
  Given a move with bodyCollision.character set
  When resolution.ts collects attacks
  Then attacks[] contains charge entries BEFORE the counter pass takes its snapshot

Scenario: bilateral charge deduplicates
  Given two movers each with bodyCollision pointing at the other
  When resolution.ts routes into attacks[]
  Then exactly one (A→B, B→A) pair is enqueued
  And each character takes exactly 1 dmg (not 2)

Scenario: lethal charge produces a corpse
  Given a charge whose damage drops the defender to hp ≤ 0
  When resolution.ts runs Phase-6 deaths
  Then the defender flips alive=false with diedAtTurn=state.turn
  And a corpse mirroring their equipped slots appears in worldState.corpses

Scenario: wall self-dmg does not trigger counter
  Given a wall-bump self-damage entry in attacks[] (attackerId === defenderId === mover)
  And the mover is in position.kind = "move"
  When the counter pass iterates attacks[]
  Then no counter-fire is enqueued
```

### 6.3 LLM projection outcome lines

```
Scenario: Aggressor own outcome — charge
  Given a mover with bodyCollision.character set
  When inputBuilder renders the move fragment
  Then the line reads "charged into <displayName> (dmg 1, took 1)"

Scenario: Aggressor own outcome — partial-distance charge
  Given a mover with from !== to AND bodyCollision.character set
  When inputBuilder renders the move fragment
  Then the line reads "moved <N> <dir>, charged into <displayName> (dmg 1, took 1)"

Scenario: Aggressor own outcome — wall bump
  Given a mover with bodyCollision.wall set
  When inputBuilder renders the move fragment
  Then the line reads "tried to move and hit <wallRectId> (took 1)"

Scenario: Aggressor own outcome — partial-distance wall bump
  Given a mover with from !== to AND bodyCollision.wall set
  When inputBuilder renders the move fragment
  Then the line reads "moved <N> <dir>, tried to move and hit <wallRectId> (took 1)"

Scenario: Slide alone (no bodyCollision)
  Given a mover with slide set (successful diagonal slide) AND no bodyCollision
  When inputBuilder renders the move fragment
  Then the line uses the existing "hugged Wall_*" phrasing
  And no "took 1" suffix appears

Scenario: Slide-then-bump composite (D16+D21)
  Given a mover with BOTH slide set AND bodyCollision.wall set
    (multi-step slide that continued and bumped on a later substep)
  When inputBuilder renders the move fragment
  Then the line contains both fragments
    e.g. "hugged Wall_* {axis} ...; tried to move and hit Wall_* (took 1)"
  And the 1-dmg self-damage is dealt for the bump
```

### 6.4 Damage / kill feed

```
Scenario: Defender damage-feed line
  Given previous turn contains a move with bodyCollision.character pointing at observer
  When inputBuilder renders the damage-event lines for the observer
  Then a line "<charger displayName> charged into you (dmg 1)" appears

Scenario: Damage-feed self-suppression
  Given observer IS the charger
  Then no "<self> charged into you" line is emitted for them

Scenario: Lethal-charge kill feed
  Given a lethal charge (victim in deaths)
  When inputBuilder renders the kill feed
  Then a line "<charger> killed <victim> with bare hands" appears

Scenario: Cross-turn delivery audit — charge incoming
  Given a previous-turn charge of observer
  And current-turn composedUserMessage contains the expected damage-feed line
  When turnsDerived.buildDeliverySignals audits
  Then damageFeedAudit.incoming increments
  And damageFeedAudit.missingIncoming does not increment
```

### 6.5 Overseer UI

```
Scenario: Start-of-N grid semantics
  Given the stepper is at turn N
  When the replay grid renders
  Then entity positions match end-of-(N-1) state (= start-of-N agent perception)

Scenario: TurnFeed widens on widescreen
  Given a 1920×1080 viewport
  When the replay route renders
  Then the TurnFeed column visibly exceeds the prior 40% width cap
  And the grid stays square (aspect-ratio: 1/1)

Scenario: Status card per agent per turn
  Given an agent's record exists for the current turn
  When the FeedRow renders
  Then a Status section displays position, HP, weapon, armour, consumable, scratchpad-before, Inside/Outside Evac flag
  And the fields match the agent's per-turn ## Status block exactly

Scenario: ?turn=N deep-link semantics
  Given a URL ?turn=N is opened
  Then the stepper is at N
  And the grid shows start-of-N positions
  And the feed shows turn-N decisions and outcomes
```

## 7. Schema risks & migration

**Risk:** `moves[].bodyCollision` is a new optional field on the
`resolutionValidator`. Existing rows lack the field. Convex's strict
validator accepts the optional-ness, but the field is wired through
many adapters — drift risk.

**Mitigation:**
- POC posture per `project_poc_schema_wipe_acceptable` — wipe the
  Convex dev DB before WP-A schema change lands.
- Field is `v.optional` — historical rows pre-wipe (if any survive)
  return undefined, renderer treats absence as no-collision (matches
  existing semantics).
- Pre-merge checklist for WP-A: confirm dev deployment wiped; smoke
  one match end-to-end with charge + wall-bump fixture, verify
  persistence roundtrip.

**Forward-compatibility check:** `bodyCollision` is a leaf union on
the existing `moves[]` element; it does not change the shape of any
other trace field. Phase-9's `slide` addition rode the same pattern
and landed cleanly.

## 8. NOT in scope

| Surface | Why deferred |
|---|---|
| Persona behaviour-tuning to exploit charges | Substrate slice; behaviour tuning is a later loop |
| Consumer-renderer parity (third-person POV) | Overseer remains diagnostic-grade per mental-model §11 |
| New tool-schema fields for charge | Pillar 5/6 — discoverable via outcome lines, NOT teaching |
| New system-prompt teaching of charge/bump | Same as above |
| Displacement / push mechanics on charge | Out of scope; cucumber says mover stays at start-of-substep tile |
| Boundary-edge special handling | Perimeter wall handles organically |
| `convex/engine/runStats.ts` per-persona kill attribution fix | Known issue (mental-model §16 addendum); not blocking closing bar |
| Live spectate / streaming replay | Out per overseer-v0 posture (mental-model §11) |
| Post-match aftermath grid view | The start-of-N flip intentionally hides this; user can scrub if needed |
| Status card on dead/extracted agent rows | Vintage / dead rows render existing terminal marker; Status card only for live agentRecord rows |

## 9. Open clarifiers / live decisions

All v1 clarifiers are now **RESOLVED** per the v2 decision lock
(D6–D24). Retained here for traceability:

1. **Status card collapse on click?** — **Resolved: default
   EXPANDED.** Diagnostic posture trumps screen real-estate; the user
   reads it every row. If post-WP-C UAT says it bloats the feed, add
   a per-row collapse toggle as a follow-up tweak (NOT in WP-C v0
   scope).

2. **Off-grid attempt without perimeter wall** — **Resolved (D7):
   organic via perimeter wall.** Review-A independently verified all
   4 edges of the 100×100 `maps/reference.json` are fully enclosed
   (0 boundary tile gaps). The engine emits no marker for true
   off-grid attempts; under the reference map this branch is dead
   code. If a future map omits the perimeter wall, revisit then.

3. **Lethal-charge kill-feed weapon attribution** — **Resolved (D6):
   "bare hands".** Mirrors the phase-7 absent-weapon convention. If
   the user later wants a distinct "rammed"/"charged" verb (pillar 5
   discovery cue), upgrade in a follow-up tweak.

4. **Status card render position** — **Resolved (D14): above the
   decision one-line, inside the FeedRow.** Co-locates Status with
   the agent's decision/reasoning for the diagnostic loop. The
   "one-viewport diagnostic loop" criterion is satisfied via
   Status-card-in-feed for WP-C v0 (Vision + reasoning remain in
   ExpandModal per D22).

## 10. Closure record (to be filled at phase close)

```
Canonical report id:       _________________________________
reportType:                "phase-10-closing-20"
metBar:                    _________________________________
failedMatches:             _________________________________

Carry-over phase-7 gates:  _________________________________
Charge/bump slice gates:
  chargeOutcomeCount:                _____________
  bilateralChargeCount:              _____________
  counterFireOnChargeCount:          _____________
  wallBumpSelfDmgCount:              _____________
  partialDistanceWallBumpCount:      _____________
  chargeDamageFeedMissing:           _____________
  lethalChargeCount:                 _____________

User attestation (UI walkthrough):   _____________
Replay UI start-of-N feel:           _____________
Status card legibility:              _____________
Widened feed pleasing on widescreen: _____________

Source commits:                      _____________
```

## 11. Assignment-level success criteria

The slice closes when ALL of the following hold:

- All cucumber scenarios in §6 pass via the named tests in §5.
- Closing-20 phase-10 report persisted with `metBar: true`.
- User can step through any closing-20 match in the refined replay UI
  and observe charge events firing, counter retaliation against
  chargers, wall-bump self-dmg, partial-distance wall-bumps —
  with Status + Vision + reasoning + map visible in one widescreen
  viewport (mental-model §18 done-bar).
- No regression in phase-7 / phase-9 substrate (validated by the
  closing-20 gate rollup).
- Mental-model §18 marked closed; phase-9 cross-link updated.

## 12. Recommended job sequence

| Round | WP | Owner profile | Parallelism |
|---|---|---|---|
| 1 | WP-A (engine substrate) | Engineer, TDD-first | parallel |
| 1 | WP-C (overseer UI) | Engineer, browser-test-comfortable | parallel |
| 1 | WP-D drafting (phase10 fixture + validator sketch) | Engineer | parallel (skeleton only) |
| 2 | WP-B (LLM projection) | Engineer | serial (after WP-A trace shape lands) |
| 3 | WP-D finalisation | Engineer | serial (after WP-A + WP-B) |
| 4 | Closing-20 run + report persist + user attestation | PM + user | serial |
| 5 | Phase-10 closure docs + mental-model §18 update | PM | serial |

**UAT placement.** WP-C carries its own UAT (browser walkthrough on a
pre-phase-10 closed match — start-of-N flip, widening, Status card).
WP-D carries the final attestation UAT (browser walkthrough on the
phase-10 closing-20 set — substrate feel + UI feel together).

**Review-before-implement vs implement-then-review.** This slice is
substrate + UI in one assignment; the engine substrate has tight
contract boundaries (bodyCollision shape, attacks[] ordering) that
warrant a planning review BEFORE WP-A starts. The overseer UI is
diagnostic-grade and forgiving — implement-then-review is fine.
Suggested: a pre-WP-A planning review (45 min) on §3.1 + §3.2
contracts, then implement.
