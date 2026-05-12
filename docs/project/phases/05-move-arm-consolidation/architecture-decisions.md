# Phase 05 — Architecture Decisions

> One ADR. Stable for the duration of the phase. Supersedes the phase-1 ADR §4
> `MoveDecision` shape (which phase-3 left untouched) and replaces the
> `convex/engine/movement.ts` `STOP_AT_RANGE = 2` global constant with a
> per-entity-type table.

This phase introduces a single substrate contract change; everything
downstream is mechanical implementation of that contract.

---

## 1. Move-arm consolidation — 4-arm grammar with per-entity-type stopAtRange

**Decision.** Replace the phase-1/3 6-arm `MoveDecision` discriminator
with a **4-arm grammar**:

```text
move.oneOf:
  - { kind: "toward",   targetId: string }   // any visible entity id
  - { kind: "away",     targetId: string }   // any visible entity id
  - { kind: "relative", dx: int, dy: int }   // escape hatch, bounded
  - { kind: "none" }
```

The validator and resolver dispatch the `targetId` by **id-namespace
prefix** to look up:

1. the target's tile (for the resolver), and
2. the per-entity-type `stopAtRange` (engine-side data, NOT a schema
   discriminator).

```text
Id prefix       | Entity type        | stopAtRange | Why
─────────────── | ───────────────── | ──────────: | ────────────────
Player_N        | Character (live)  |     2       | weapon / attack range
Chest_NNN /     | Chest             |     2       | loot range
chest_NNN       |                   |             |
Corpse_Player_N | Corpse            |     2       | loot range
Cover_X_Y       | Cover             |     0       | step onto — cover only hides while standing
Wall_X_Y        | Wall              |     1       | adjacent — walls cannot be entered
Evac            | Evac singleton    |     0       | step into the 3×3 zone
```

`away` accepts ANY of those id namespaces (consistency over ergonomic
restriction — persona self-selects what makes sense). `relative`
survives unchanged. `none` survives unchanged.

**Rationale.**

- **Player-perspective substrate.** The 6-arm split categorised by
  engine-internal data-model (characters vs lootables vs evac vs
  everything-else). The player perspective makes no such distinction:
  every visible entity is "a thing in the world I can navigate
  toward". The category-split was a substrate smell. (Memory:
  `feedback_player_perspective_substrate.md`.)
- **stopAtRange is data, not grammar.** The only meaningful per-type
  difference is *how close* the agent halts. Moving that into an
  engine-side table by id namespace shrinks the LLM-facing schema
  (one fewer discriminator) and consolidates the resolver dispatch
  to a single point.
- **First-class wall-hugging + cover-camping.** Phase-3 forced the
  model to do arithmetic via `relative` to navigate toward walls and
  cover. Pillar 6 ("build the substrate; let the strategy emerge")
  endorses making these substrate affordances rather than puzzles.
- **Evac is just another visible entity.** Phase-3's
  `toward_evac` arm was a singleton (no `targetId`) — a special-case
  by accident of history. Once revealed, evac is a Visible bullet
  with id `Evac` and the validator gates on `revealedAtTurn !== null`
  via the visibility set itself.
- **D1 cluster retirement.** The 56+ `Cover_*_*` validator zeros from
  the D1 probe are structurally retired — the new grammar accepts
  cover ids as toward targets.

**Alternatives considered.**

1. **Keep 6 arms, accept Cover/Wall in `toward_object`.** Patches the
   immediate cluster but leaves the per-entity-category split in
   place; the model still has to learn "chest goes here, cover goes
   here, corpse goes here". Rejected: papers over the substrate smell.
2. **3 arms (toward + away both folded into a single `move_to` /
   `move_from` pair).** Considered, rejected — `relative` is genuinely
   a different beast (no target id; arithmetic escape hatch) and
   `none` is conceptually distinct from "navigate toward nothing".
   Four arms is the natural shape.
3. **Per-entity-type `stopAtRange` on the schema as a `stopAt`
   parameter the model emits.** Considered, rejected — that would
   put a tactical numeric on the LLM's plate, which mental-model
   §7's decision filter says no to ("does this deepen
   prompt-authored behaviour" — no, it just adds noise).
4. **Renderer compatibility shim for legacy traces.** Considered,
   rejected as the recommended path. POC wipe is endorsed; shim is
   only the user-vetoes-wipe fallback. See README §7.

**Consequences.**

- `convex/llm/decisionTool.ts`, `convex/engine/types.ts`,
  `convex/schema.ts`, `convex/_internal_runMatch.ts` all land the
  4-arm shape in WP-A. Mirror lockstep: WP-A acceptance asserts the
  Zod schema, the Convex `moveValidator`, and the
  `_internal_runMatch.ts` mirror are byte-for-byte equivalent in
  the arms they declare.
- `convex/engine/validation.ts` validation switch shrinks: one
  branch each for `toward` / `away` / `relative` / `none`. Both
  `toward` and `away` consume the shared `resolveTypedEntity`
  helper (WP-D.5 — see §"Visible-set authority" below) which
  performs visibility-projection lookup + namespace dispatch +
  per-type `stopAtRange` lookup in a single call. The validator
  itself contains no namespace-parsing or revealed-flag checks —
  those live inside the helper, behind the canonical
  visible-target-id projection.
- `convex/engine/movement.ts` `desiredNextTile` switch shrinks
  identically; the new `STOP_AT_RANGE` becomes a function of id
  prefix, expressed inline (a `switch` on the namespace prefix
  returns the table value).
- `convex/engine/movement.ts` — the existing constant
  `STOP_AT_RANGE = 2` is **removed** in favour of the per-type
  lookup. The resolver's `desiredNextTile` reads the per-type
  value at dispatch time.
- `convex/engine/resolution.ts:296-325` — the existing
  `toward_entity`/`away_from_entity` characterId normalisation
  block becomes the new `toward`/`away`-when-target-is-a-character
  normalisation block (single normalisation point per phase-3
  ADR §1 contract; behavior preserved).
- `convex/llm/idNormalisation.ts` — the existing
  `normaliseCorpseTargetId` and `normaliseCharacterTargetId`
  helpers stay (used internally by the new dispatch). A
  **mandatory** consolidation (WP-D.5, promoted to a
  foundation step that lands AFTER WP-A and BEFORE WP-B/WP-C —
  see §"Visible-set authority" below and `work-packages.md`)
  hoists a single `resolveTypedEntity(state, observer,
  targetId)` helper that owns the canonical visible-target-id
  projection, namespace dispatch, tile lookup, and
  `stopAtRange` lookup in one place. Both WP-B (validator) and
  WP-C (resolver) consume it; neither contains inline
  namespace-parsing logic. The file may be renamed
  `convex/llm/entityResolve.ts` if cleaner (engineer's call,
  documented in closure).
- `apps/replay/src/lib/decisionEnglish.ts` ships **only the new
  arms** in its `renderMoveIntent` switch. The phase-3 cases for
  `toward_entity` / `away_from_entity` / `toward_object` /
  `toward_evac` are removed. Justification: POC wipe means no
  legacy traces are read; renderer simplification reduces the
  cognitive load of the explainability surface.
- `convex/reports/phase3.ts` narrowed `Phase3AgentRecord` types
  (`decision.move` discriminator and `moveTargetEntityId` helper)
  consume the new 4-arm union. Existing 10-run reports already
  written under the old shape become unreadable post-wipe (this is
  fine — those reports were closing-data, not load-bearing for
  this refactor).
- `docs/project/spec/concept-spec.md` action grammar section
  updated in WP-F. The stopAtRange table reproduced from
  mental-model §14 with a cross-reference.

**Visible-set authority (single source of truth).**

The canonical "is this targetId a valid move target?" check runs
against a **typed-id projection of the engine's
`computeVisibleEntities(state, observer)` output**, NOT against
the LLM-facing digest, and NOT against `state.world.*` directly.
The projection is constructed once per call by the
`resolveTypedEntity` helper (WP-D.5) as follows:

```text
projection = ∅
for each VisibleEntity v in computeVisibleEntities(state, observer):
  kind=character → add `Player_N` (v.displayName)         [live only — vision.ts:171]
  kind=chest     → add chest.id (engine bound, e.g. Chest_006)
  kind=corpse    → add `Corpse_${displayName_of(v.objectId)}`
  kind=cover     → add `Cover_${v.pos.x}_${v.pos.y}`
  kind=wall      → add `Wall_${v.pos.x}_${v.pos.y}`
if state.world.evac.revealedAtTurn !== null:
  add the literal string `Evac`
```

Notes:

- Evac is **not** emitted by `computeVisibleEntities`; the projection
  step is where the revealed-flag gate lives. There is no separate
  `revealedAtTurn` check inside the Evac branch later — visibility
  projection is the only gate. (Resolves the contradiction in
  earlier drafts that prescribed both a projection gate AND a
  literal-Evac defence-in-depth assertion.)
- Dead characters are already excluded by
  `computeVisibleEntities` (vision.ts:171); they never land in the
  projection.
- Cover tiles past `COVER_TILE_CAP` (vision.ts:209) are NOT in the
  projection; a `toward Cover_X_Y` for an engine-visible-but-capped
  tile rejects with "not visible to actor". See "Known divergences"
  in `closure.md` (D10 follow-up).

**Rejection-reason precedence: visibility-first.**

If `targetId ∉ projection`, reject with a single canonical reason
that names the visibility miss — regardless of *why* it's not in
the projection. Examples:

| Input | Reason |
|---|---|
| `toward Player_9` (no such char in vision) | `move target 'Player_9' is not visible to actor` |
| `toward Player_3` (dead, excluded by vision.ts:171) | `move target 'Player_3' is not visible to actor` |
| `toward Evac` before reveal | `move target 'Evac' is not visible to actor` |
| `toward Cover_77_77` (not a cover tile) | `move target 'Cover_77_77' is not visible to actor` |
| `toward Wall_77_77` (not a wall) | `move target 'Wall_77_77' is not visible to actor` |
| `toward Random_42` (unknown namespace) | `move target 'Random_42' is not visible to actor` |

This is the **only** rejection layer for visibility/liveness/reveal
in the move validator. It matches the single-source-of-truth
framing and keeps validator logic uniform across namespaces.
Tests assert this exact reason; do not introduce
`not a living character`, `not revealed`, or
`unrecognised id namespace` as alternative reasons.

**Other failure modes the resolver handles (movement, not validation).**

- `toward <Chest_NNN>` already opened — the agent CAN still walk
  toward an opened chest (movement is not gated by chest state).
  The `action.kind === "loot"` validator continues to gate on
  `chest.opened` separately. Intentional — the model may move
  toward an opened chest to use it as a waypoint.
- `toward <Corpse_Player_N>` after corpse drained — same: movement
  is not gated by corpse state. The `action.kind === "loot"`
  validator continues to gate on emptiness separately.
- `toward <Cover_X_Y>` with no walkable path — the substep loop
  terminates with the actor partway along the path (existing
  movement semantics). No special case required.
- `toward <Wall_X_Y>` where no walkable tile exists at chebyshev 1
  from the wall (e.g. wall at map edge) — the substep loop
  terminates with the actor at chebyshev > 1. No reject, no special
  case; behaviour matches existing wall-blocked-move emit.

**Schema-validation transition window.**

The model has been trained on the phase-3 6-arm grammar in its
in-context tool schema for the duration of the phase-3 + phase-4
work. After the WP-A push, the in-context tool schema declares only
the 4 new arms. The model adapts at the schema-as-grammar layer
(this is what `feedback_prompt_is_one_context.md` captures — system
prompt + tool schema + digest are one rolled context, not disjoint
slots). The expectation is that schema_validation failures
mentioning the old arm names go to zero within the first turn or
two of the smoke cohort. WP-E confirms this empirically; if the
model emits stale arms beyond the first turn or two, document the
rate in the closure record.

---

*Single ADR. The 4-arm grammar + stopAtRange table is the entire
contract; everything downstream is mechanical.*
