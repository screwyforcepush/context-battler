# Phase 05 — Work Packages

> Seven work packages sequenced as **Schema → Helper-foundation →
> (Validator || Resolver || Renderer+glue) → Smoke → Docs**. Each WP
> has scope, acceptance, test strategy, and risks. Tests-first per
> `.agents/AGENTS.md` AOP for every pure-function module under
> refactor.

WP IDs continue the phase-2/3/4 letter convention (WP-A, WP-B, ...) for
visual consistency in code review. WP-D.5 (the typed-id helper) was
promoted to a mandatory foundation step in plan refinement and now
runs BEFORE WP-B/WP-C/rest-of-WP-D rather than alongside them.

---

## Foundation — sequencing

WP-A lands first (schema is the contract; everything keys off it).
**WP-D.5 (helper foundation) lands next** — both validator and
resolver consume the shared `resolveTypedEntity` helper, so it must
exist before they can be written tests-first against it. WP-B
(validator) and WP-C (resolver) run **in parallel** after WP-D.5 —
disjoint write sets (`validation.ts` vs `movement.ts`); both
import the helper. The remainder of WP-D (renderer + glue) runs in
parallel with WP-B/WP-C — also disjoint files
(`decisionEnglish.ts`, `inputBuilder.ts` priorMoveByActor typing,
`resolution.ts` glue, `reports/phase3.ts`). WP-E (smoke) is the
closing gate after the schema wipe. WP-F (docs) ships alongside
WP-E.

```text
        WP-A   Schema + types collapse
           │
        WP-D.5 Helper foundation (resolveTypedEntity)
           │
   ┌───────┼───────┐
   ▼       ▼       ▼
 WP-B    WP-C    WP-D (rest)
(valid) (mov)  (rndr+glue)
   │       │       │
   └───────┼───────┘
           ▼
       Schema wipe (POC posture)
           ▼
         WP-E  Substrate smoke verification ── WP-F  Docs + closure
```

---

## WP-A — Schema + types collapse (FOUNDATION-FIRST)

**Scope.**

Apply the ADR §1 4-arm shape to every place the move discriminator is
declared. Lockstep across four files:

- **WP-A.1** — `convex/llm/decisionTool.ts`:
  - `MoveArm` TypeScript type union: collapse to
    `MoveTowardArm | MoveAwayArm | MoveRelativeArm | MoveNoneArm`.
    Drop `MoveTowardEntityArm`, `MoveAwayFromEntityArm`,
    `MoveTowardObjectArm`, `MoveTowardEvacArm`.
  - `decisionTool.parameters.properties.move.oneOf`: collapse to 4
    arms; `toward` and `away` each declare `required: ["kind",
    "targetId"]` with `targetId: { type: "string" }`.
  - `decisionTool.parameters.properties.move.description`: rewrite
    to reflect the 4 arms, the per-entity-type stopAtRange table
    (terse — one line per type), and the "any visible entity id"
    contract. **Do NOT teach fallback behaviour** (memory
    `feedback_prompt_hygiene_no_fallback_leak`).
  - `MoveSchema` (Zod): collapse to a 4-arm
    `discriminatedUnion("kind", [...])`. New schemas accept exactly
    the new arms; OLD arm kinds (`toward_entity` / `away_from_entity`
    / `toward_object` / `toward_evac`) MUST be rejected as
    schema_validation failures (the discriminatedUnion naturally
    enforces this — no allowlist).
- **WP-A.2** — `convex/engine/types.ts`:
  - `MoveDecision` discriminator collapses to the 4 arms.
  - Inline doc-comment updated to describe the new arms (no
    references to phase-1's "split by category" framing).
- **WP-A.3** — `convex/schema.ts`:
  - `moveValidator` (line 164-184) collapses to the 4-arm
    `v.union(...)` shape. The arms parallel the Zod / JSON Schema
    declarations.
- **WP-A.4** — `convex/_internal_runMatch.ts`:
  - `moveValidator` mirror (line 73-93) collapses identically.
    Drift would reject every new-shape `recordTurn` mutation at
    runtime — lockstep is mandatory.
- **WP-A.5** — `convex/llm/decisionTool.ts` compile-time
  equivalence asserts (lines 426-435) continue to hold —
  `_typeEqAtoB` and `_typeEqBtoA` must still typecheck against the
  new `ParsedDecision` type.

**Acceptance.**

- `npm run typecheck` is green; all four files declare the 4-arm
  union and no other.
- The compile-time `ParsedDecision <-> _ZodInferredDecision`
  bidirectional assignment at `convex/llm/decisionTool.ts:430-431`
  still typechecks (drift would surface here).
- `tests/llm/decisionTool.test.ts` asserts:
  - **Positive**: each of the 4 arms parses correctly with
    canonical shapes (`toward {targetId:"Player_3"}`,
    `away {targetId:"Player_3"}`,
    `relative {dx:3, dy:-2}`, `none`).
  - **Positive**: `toward` accepts each id namespace verbatim:
    `Player_4`, `Chest_006`, `chest_006`, `Corpse_Player_5`,
    `Cover_54_42`, `Wall_64_30`, `Evac`. (Schema-level test — no
    semantic gating yet; the Zod schema accepts any string.)
  - **Negative**: each of the four removed legacy kinds
    (`toward_entity`, `away_from_entity`, `toward_object`,
    `toward_evac`) fails parseDecision with
    `error === "schema_validation"`.
  - **Negative**: `toward {kind:"toward"}` (missing `targetId`)
    fails schema_validation.
- `tests/llm/schemaMirror.test.ts` asserts:
  - The `moveValidator` arms in `convex/schema.ts` and the JSON
    Schema arms in `convex/llm/decisionTool.ts` declare the SAME
    arm kinds (set equality).
  - `convex/_internal_runMatch.ts:moveValidator` mirrors
    `convex/schema.ts:moveValidator` (structural equivalence).
    Use the existing schemaMirror approach (string-based
    introspection of `validator.json` or equivalent).

**Test strategy.**

Tests-first. The structural-equivalence and mirror tests are red
before the collapse and green after. Existing
`tests/llm/decisionTool.test.ts` cases referencing legacy arms are
**deleted** (not commented out — POC wipe philosophy: no zombie code).

**Risks.**

- *Schema mirror drift.* `_internal_runMatch.ts` is the most
  drift-prone file in the repo (phase-3 closure record cites three
  separate drift incidents). The schemaMirror test must catch any
  arm-set mismatch.
- *TypeScript compile-time-equivalence asserts go stale.* The
  `_typeEqAtoB` / `_typeEqBtoA` assignments at
  `decisionTool.ts:430-431` lock the Zod ↔ `ParsedDecision` shape.
  If either side updates without the other, TS fails fast. Trust the
  assert.

**Out of WP-A.** No validator/resolver/renderer changes; those land
in WP-B/-C/-D. Smoke is WP-E.

---

## WP-D.5 — Helper foundation: `resolveTypedEntity` (MANDATORY, after WP-A, before WP-B/WP-C)

**Scope.**

Hoist a single helper that owns the canonical visible-target-id
projection, namespace dispatch, target-tile lookup, and per-type
`stopAtRange` lookup. Both the validator (WP-B) and resolver (WP-C)
consume it; neither contains inline namespace-parsing logic. This
prevents the validator/resolver drift pattern phase-3 closure
records cite three separate times.

Location: `convex/llm/idNormalisation.ts` (engineer may rename to
`convex/llm/entityResolve.ts` if the consolidated surface
no-longer-fits the existing filename — document the call in
closure). Existing `normaliseCharacterTargetId` /
`normaliseCorpseTargetId` helpers stay; the new helper uses them
internally for the `Player_*` and `Corpse_*` arms (preserving the
LLM-displayName → engine `characterId` id-space bridge per
phase-3 ADR §1).

**Helper contract:**

```ts
export type ResolvedEntity = {
  kind: "character" | "chest" | "corpse" | "cover" | "wall" | "evac";
  tile: Tile;          // target tile in world coordinates
  stopAtRange: number; // per-entity-type, from the ADR §1 table
  // Engine-side reference for callers that need to do a downstream
  // state lookup (e.g. resolution.ts normalisation to engine
  // characterId). Optional; not all kinds need it.
  engineRef?: { characterId?: string; chestId?: string };
};

export function resolveTypedEntity(
  state: MatchState,
  observerId: string,
  targetId: string,
): ResolvedEntity | null;
```

Behaviour:

1. Build the canonical visible-target-id projection from
   `computeVisibleEntities(state, observerId)` plus the Evac
   reveal flag, per the construction algorithm in ADR §1
   "Visible-set authority". (Single source of truth — no other
   call site reconstructs this.)
2. If `targetId ∉ projection`, return `null`. (Callers map `null`
   to the visibility-first rejection reason per ADR §1
   "Rejection-reason precedence".)
3. Otherwise dispatch by namespace prefix (specificity-first
   ordering: `Corpse_` and `Chest_`/`chest_` before any character
   namespace; literal `Evac` exact-match before the prefix
   walk):
   - `Player_*` → look up the live character, return
     `{kind:"character", tile:c.pos, stopAtRange:2,
       engineRef:{characterId: c.characterId}}`.
   - `Chest_*` / `chest_*` → look up the chest, return
     `{kind:"chest", tile:chest.pos, stopAtRange:2,
       engineRef:{chestId: chest.id}}`.
   - `Corpse_*` → strip prefix, resolve inner displayName via
     `normaliseCharacterTargetId`, look up the corpse, return
     `{kind:"corpse", tile:corpse.pos, stopAtRange:2}`.
   - `Cover_X_Y` → parse `(x, y)` from the id, return
     `{kind:"cover", tile:{x,y}, stopAtRange:0}`.
   - `Wall_X_Y` → parse `(x, y)` from the id, return
     `{kind:"wall", tile:{x,y}, stopAtRange:1}`.
   - exact-match `Evac` → return `{kind:"evac",
     tile:state.world.evac.centre, stopAtRange:0}`.

Note: because step 1's projection gate already excluded
not-visible / dead / not-revealed cases, dispatch in step 3 can
assume the id resolves. Defensive `return null` from step 3 (e.g.
malformed `Cover_X_Y` that passed projection — shouldn't happen
since the projection emits well-formed ids) is acceptable but
not test-required.

**Acceptance.**

- `convex/llm/idNormalisation.ts` (or `entityResolve.ts`) exports
  `resolveTypedEntity` and `ResolvedEntity` with the contract
  above.
- `tests/llm/idNormalisation.test.ts` (extend the existing file or
  add a new sibling test if rename happens) asserts:
  - **Positive (one per kind)**: given a visible set containing
    each of `Player_4`, `Chest_006`, `Corpse_Player_5`,
    `Cover_54_42`, `Wall_64_30`, and `Evac` (after reveal), the
    helper returns the expected `{kind, tile, stopAtRange}`.
  - **Engine-id bridge**: `Player_N` resolves with
    `engineRef.characterId` set to the Convex `_id`-shaped value
    (mirror `normaliseCharacterTargetId` existing test).
  - **Negative (one per category of miss)**:
    - unknown id (`Random_42`) → `null`.
    - known-but-not-visible character (`Player_8` exists but
      out of vision) → `null`.
    - known-but-not-visible chest, corpse, cover, wall → `null`
      each.
    - `Evac` before reveal (`revealedAtTurn === null`) → `null`.
    - dead character (`Player_3` exists but `.alive === false`)
      → `null` (excluded by `computeVisibleEntities` already;
      this test locks the behaviour).
  - **Specificity ordering**: `Corpse_Player_5` resolves to the
    corpse, NOT to the live `Player_5` (if both happened to
    exist — corpses outlive characters).

**Test strategy.**

Tests-first. The helper is pure (state + observerId + targetId →
result); fixtures use `makeMatchState` / `makeCharacter` to
construct visible sets. No mocking of `computeVisibleEntities` —
the test constructs world state such that the desired entities
land in or out of vision range as needed.

**Risks.**

- *Projection drift from `computeVisibleEntities`.* If a future
  change to `computeVisibleEntities` emits new entity kinds, this
  helper must extend. Documented in closure under known
  follow-ups.
- *Engine `characterId` is a Convex opaque `_id` in production
  but a plain string in tests.* The helper inherits the
  `normaliseCharacterTargetId` behaviour (matches `characterId`
  first, then `displayName`) so both paths work. The
  `engineRef.characterId` returned is whatever
  `normaliseCharacterTargetId` returned.

**Out of WP-D.5.** No call-site rewrites yet — WP-B and WP-C
import and call this helper. The legacy
`normaliseCorpseTargetId` /`normaliseCharacterTargetId` helpers
remain for the WP-D `resolution.ts` glue, which still needs the
LLM-id → engine-id bridge separate from the visibility-projection
flow.

---

## WP-B — Validator collapse

**Scope (parallel with WP-C and rest-of-WP-D, after WP-A and
WP-D.5).**

Rewrite the `move` switch in `convex/engine/validation.ts:160-269`
to a single visible-entity-id dispatch path. The validator does
NOT contain inline namespace parsing, projection construction, or
per-namespace state lookups — those all live in
`resolveTypedEntity` (WP-D.5). The validator's responsibilities
collapse to:

- **`relative`** — bounded `±MAX_RELATIVE_DELTA` (=12); unchanged.
- **`none`** — no-op; unchanged.
- **`toward`** — single dispatch:
  ```ts
  const resolved = resolveTypedEntity(state, observerId, decision.move.targetId);
  if (resolved === null) {
    return reject(`move target '${decision.move.targetId}' is not visible to actor`);
  }
  // accepted; resolver consumes the same helper for tile/stopAtRange.
  ```
  No per-namespace branching inside the validator. The visibility
  projection (which excludes dead characters, unrevealed evac,
  unknown ids, malformed cover/wall ids, and ids past
  `COVER_TILE_CAP`) is the single gate.
- **`away`** — identical dispatch to `toward` (same call to
  `resolveTypedEntity`; same `null → not visible` rejection).
  Justification: pillar-2 consistency. The semantic ("walk away
  from") is generalised in WP-C.

**Rejection-reason precedence: visibility-first (per ADR §1).**

A single canonical rejection reason —
`move target '<id>' is not visible to actor` — covers every
not-in-projection case, regardless of *why* the id failed the
projection (unknown namespace, dead character, unrevealed evac,
out-of-vision, capped). Tests assert this exact reason; no
alternative reasons (`not a living character`, `not revealed`,
`unrecognised id namespace`) are emitted by the move validator.

Other validator surfaces (consume, action, primary, stance) are
**untouched**.

**Acceptance.**

- The `move` switch in `convex/engine/validation.ts` has exactly
  four cases (`toward` / `away` / `relative` / `none`).
- `toward` and `away` cases each contain a single
  `resolveTypedEntity` call and a single `null →
  not-visible-to-actor` rejection. No `if startsWith("Player_")`,
  no manual `state.world.evac.revealedAtTurn` check, no manual
  cover/wall membership lookup.
- `tests/engine/validation.test.ts` asserts:
  - **Positive (toward, one per kind)**: each of `Player_4`
    (live, in vision), `Chest_006`, `Corpse_Player_5`,
    `Cover_54_42`, `Wall_64_30`, `Evac` (after reveal) is
    accepted given the appropriate visible set.
  - **Positive (away, one per kind)**: same six cases accepted by
    `away`.
  - **Negative (toward) — known-but-not-visible, one per
    namespace**:
    - `Player_9` exists but out of vision range → rejected with
      `move target 'Player_9' is not visible to actor`.
    - `Chest_999` exists in `state.world.chests` but out of
      vision / LOS → rejected with the same reason form.
    - `Corpse_Player_6` exists in `state.world.corpses` but out
      of vision → same.
    - `Cover_77_77` is a real cover tile in
      `state.world.coverTiles` but out of vision → same.
    - `Wall_77_77` is inside a real wall rectangle in
      `state.world.walls` but out of vision → same.
    - `Evac` BEFORE reveal (`revealedAtTurn === null`) →
      rejected with same reason.
    - `Evac` AFTER reveal → ACCEPTED (positive case above).
  - **Negative (toward) — visibility-excluded-by-state**:
    - `Player_3` exists and is in range but `.alive === false`
      → rejected with the canonical visibility-first reason
      (NOT `not a living character`).
  - **Negative (toward) — unknown / malformed**:
    - `Player_99` (no such character anywhere) → rejected with
      same reason.
    - `Random_42` (unrecognised namespace) → rejected with
      same reason (NOT `unrecognised id namespace`).
    - `Cover_foo_bar` (malformed) → rejected with same reason.
  - **Negative (away)**: at least three parallel rejection cases
    (e.g. `Player_9` out-of-vision, dead `Player_3`, unrevealed
    `Evac`) — locks the parity that `away` uses the same
    visibility gate.
- All existing validator tests for the OTHER decision fields
  (consume, action, primary, stance) still pass.

**Test strategy.**

Tests-first. Write the validator test cases against the helper
contract (the helper exists from WP-D.5, so the validator tests
are effectively integration tests of validator-on-top-of-helper).
Legacy arm test cases are **deleted**. Use the existing
test-fixture helpers (`makeMatchState`, `makeCharacter`) to
construct visible sets — the test does NOT need to mock
`computeVisibleEntities`; the helper consumes it transparently.

**Risks.**

- *Specificity-first ordering already lives in the helper.* The
  validator does not duplicate the dispatch, so the validator
  cannot drift on ordering. Drift would only happen if the
  helper itself was wrong — covered by WP-D.5 tests.
- *COVER_TILE_CAP-related rejection surface.* Cover tiles past
  the cap are not in the projection; the validator rejects them
  as "not visible to actor". This may surprise readers expecting
  "real cover" to accept. Documented in `closure.md` under
  Known divergences (D10); not a fix this phase. One test
  asserts the expected behaviour: a `Cover_X_Y` past
  `COVER_TILE_CAP` rejects with the canonical reason.

---

## WP-C — Resolver collapse (per-entity-type stopAtRange)

**Scope (parallel with WP-B and rest-of-WP-D, after WP-A and
WP-D.5).**

Rewrite `desiredNextTile` in `convex/engine/movement.ts:99-221` to
a single `toward`/`away` resolver path that consumes the shared
`resolveTypedEntity` helper from WP-D.5 for both target-tile and
`stopAtRange` lookup. The resolver does NOT contain inline
namespace parsing, manual cover/wall id parsing, or a
per-arm-kind `stopAtRange` lookup table — those all live in the
helper.

Concrete changes:

- **C.1** — Remove the file-level `const STOP_AT_RANGE = 2`
  (line 45). No replacement constant lives in `movement.ts` —
  `stopAtRange` is read off the helper's `ResolvedEntity`
  return value per call. (Per-type lookup logic lives in the
  helper, not the resolver.)

- **C.2** — `desiredNextTile` cases collapse to 4. `toward` and
  `away` share a single block that:
  1. Calls `resolveTypedEntity(state, observerId, targetId)`.
     Returns `null` → engine-side defence-in-depth: substep
     loop terminates with the actor in place (this case should
     not occur in practice because the validator already gated
     on the same helper, but the resolver tolerates it).
  2. Reads `{ tile, stopAtRange }` off the resolved entity.
  3. For `toward`: standard pathing step; halt when within
     `stopAtRange` of `tile`.
  4. For `away`: opposite-direction step (existing
     `away_from_entity` semantics generalised). The deterministic
     axis-tie-break behaviour (`dx === 0 ? 1 : Math.sign(dx)`) at
     `movement.ts:198` is preserved verbatim. `stopAtRange` for
     `away` is interpreted as a floor in the opposite direction
     — verify the current `away_from_entity` semantic does not
     itself read `STOP_AT_RANGE`; if it does, the generalisation
     uses the helper's value identically.

- **C.3** — `simulateMovement` outer loop (line 279+) is mostly
  unchanged. The wall-blocked-move marker emit (line 417-486) is
  preserved as-is — it's keyed off final position equality, not
  the move arm kind. **Verify** by reading
  `priorMoveByActor` consumers in `inputBuilder.ts` to confirm the
  `kind === "relative"` branch is the only intent-vector path the
  marker phrasing depends on (it is — `inputBuilder.ts:261`).
  Other arms ALREADY fell through to the generic
  `tried to move → hit wall` phrasing; no change required.

- **C.4** — Per-type resolver corner cases:
  - **Cover** — `Cover_<x>_<y>` parsing returns `{x, y}`. The
    resolver routes to that tile; substep loop walks the actor
    onto it (cover is walkable per `movement.ts:8` invariant —
    cover tiles are not in `walls[]`). stopAtRange=0 means the
    actor steps ONTO the cover tile. The cover-as-hide affordance
    (`hiding.ts`) fires the next time the actor's hidden flag is
    evaluated (existing semantics — no change needed).
  - **Wall** — `Wall_<x>_<y>` parsing returns `{x, y}`.
    stopAtRange=1 means the actor halts at chebyshev 1 from the
    wall tile. The substep loop's existing wall-blocking logic
    (`isBlocked` at line 225-249, `tileBlockedByWall` at line 58)
    prevents the actor from entering the wall tile. If no
    walkable tile exists at chebyshev 1 (wall at map edge, actor
    blocked by other walls / characters), the substep loop
    terminates with the actor stuck — no special case needed.
  - **Evac** — Targets `state.world.evac.centre`; stopAtRange=0
    means the actor walks onto the evac centre tile (existing
    `toward_evac` semantics preserved).
  - **Character `away`** — generalised. The previous
    `away_from_entity` resolver computed the opposite-direction
    step from the target character's tile; the new resolver does
    the same for ANY entity tile. Test cases for
    `away Cover_X_Y`, `away Wall_X_Y`, `away Evac` lock the
    consistency.

**Acceptance.**

- The `desiredNextTile` switch has exactly four cases.
- `STOP_AT_RANGE = 2` (file-level constant) is gone. No
  replacement `stopAtRangeForId`-style function lives in
  `movement.ts`; `stopAtRange` is read off
  `ResolvedEntity.stopAtRange` returned by the helper.
- `movement.ts` does NOT call any of `targetId.startsWith("Cover_")`,
  `.startsWith("Wall_")`, `=== "Evac"`, or parse `Cover_<x>_<y>` /
  `Wall_<x>_<y>` substrings. All namespace dispatch lives in
  `resolveTypedEntity`.
- `tests/engine/movement.test.ts` asserts:
  - **Toward Player_N** — actor halts at chebyshev 2 (existing
    semantics, regression check).
  - **Toward Chest_NNN** — actor halts at chebyshev 2 (existing).
  - **Toward Corpse_Player_N** — actor halts at chebyshev 2
    (existing).
  - **Toward Cover_X_Y** — actor walks ONTO (X, Y); the path is
    walkable; cover tile membership is verified. *Includes a
    multi-step pathing-within-budget assertion.*
  - **Toward Wall_X_Y** — actor halts at chebyshev 1 from
    (X, Y); the wall tile is never entered; the final tile is a
    walkable tile.
  - **Toward Wall_X_Y at map edge** — actor's substep loop
    terminates without entering the wall; final pos may be
    chebyshev > 1 if no walkable tile is reachable at chebyshev 1.
  - **Toward Evac** — actor walks ONTO `evac.centre`; stopAtRange
    0 verified.
  - **Away (one case per type)** — actor moves opposite-direction
    step from each id namespace; axis-tie-break behaviour
    matches phase-3 `away_from_entity`.
  - **Relative survives unchanged** — existing phase-3 `relative`
    movement tests pass.
  - **Wall-blocked-move marker** — existing tests still pass
    (the marker is keyed off `from === to` + wall-blocked, not
    arm kind).
- `tests/engine/resolution.test.ts` — the
  toward_entity/away_from_entity normalisation block (line
  296-325) is renamed to toward/away character-id normalisation;
  the existing test exercising the normalisation still passes.

**Test strategy.**

Tests-first. Per-type toward and away cases drive the new dispatch
shape. The map-edge wall corner case and the cover-walkable
multi-step path are the de-risking tests for R2 and R3.

The existing `tests/engine/movement.test.ts` cases that exercise
`toward_entity` / `toward_object` / `toward_evac` are **rewritten**
to use the new `toward` arm with the appropriate id. They test the
same engine behaviour; the test names update.

**Risks.**

- *Cover-walkable assumption.* The movement.ts header comment
  (`concept-spec §24 ... cover walkable`) and the lack of cover
  tiles in walls makes this an invariant, but the test (C.4 cover
  case) is the explicit verification.
- *Wall at map edge.* The existing `isBlocked` correctly returns
  true for off-grid tiles, so an actor cannot leave the map to
  approach a wall from the other side. Test C.4 wall-at-edge case
  asserts the actor halts without entering the wall.
- *Away semantics on non-character entities.* Phase-3's
  `away_from_entity` had a tested deterministic axis-tie-break
  when `dx === dy === 0`. For non-character entities (e.g. cover
  tile at the actor's position — unusual but possible), the same
  tie-break applies. Test case `away Cover_X_Y` where actor is
  ON the cover tile asserts the deterministic step.

---

## WP-D — Renderer + downstream surfaces (parallel with WP-B, WP-C)

**Scope (after WP-A and WP-D.5; rest-of-WP-D parallel with
WP-B/WP-C).** The helper-foundation work originally scoped here as
"WP-D.5 optional consolidation" has been promoted to its own
foundation slot (see WP-D.5 above). The remainder of WP-D is the
renderer + downstream-surfaces glue.

Update all non-validator-non-resolver surfaces consuming the
`MoveDecision` discriminator:

- **D.1 — `apps/replay/src/lib/decisionEnglish.ts:208-253`.**
  `renderMoveIntent` switch collapses to 4 cases:
  - `none` → "Stayed put".
  - `relative` → existing compass + chebyshev rendering.
  - `toward` → "Moved toward <targetId>" (the id is rendered
    verbatim; for character ids the existing
    `resolveCharacterName` helper maps `Player_N` → displayName,
    but since the new schema uses typed display ids verbatim, the
    helper is only invoked when `targetId` looks like a Convex
    `Id<"characters">` — for new traces, the id is always the
    typed display form). Renderer should NOT special-case the
    namespace beyond character-name resolution; "Moved toward
    Cover_54_42" / "Moved toward Wall_64_30" / "Moved toward
    Evac" are the verbatim forms.
  - `away` → "Moved away from <targetId>" (same approach).
  Renderer ships **no legacy arm cases** (POC wipe; the user
  cannot read pre-refactor traces in the replay UI after WP-E
  wipes the deployment).

- **D.2 — `convex/engine/resolution.ts:296-325`.** The
  toward_entity/away_from_entity normalisation block becomes the
  new toward/away character-namespace normalisation. The block:
  1. Identifies decisions where `primary === "move"` AND
     `move.kind ∈ {"toward", "away"}` AND `move.targetId.startsWith
     ("Player_")`.
  2. Calls `normaliseCharacterTargetId(targetId, working.characters)`
     to bridge the LLM-contract id space (typed displayName) to
     the engine `characterId` space.
  3. Replaces `move.targetId` with the engine `characterId` on the
     copied decision before handing it to `simulateMovement`.
  Other id namespaces (Chest_/Corpse_/Cover_/Wall_/Evac) do NOT
  need normalisation — they round-trip through the engine without
  reaching the character-id space.

- **D.3 — `convex/llm/inputBuilder.ts:160-280`.** Two changes:
  - `PrevTurnRow.priorMoveByActor` typing: change to the new
    `MoveDecision` shape. Existing renderer code only inspects
    `intent.kind === "relative"` (line 261) — other arms
    fall through to the generic phrasing. No behavioural change;
    just typing.
  - Comment at line 244-248 ("Non-`relative` kinds (`toward_entity` /
    ...) carry no persisted (dx, dy)") updated to reference the
    new arm names (`toward` / `away` / `none`).

- **D.4 — `convex/reports/phase3.ts:140-180,320-335`.** Narrowed
  `Phase3AgentRecord.decision.move` discriminator updated to the
  new 4-arm union. `moveTargetEntityId` helper (line 325) updated:
  for the new schema, character targets appear as
  `kind === "toward" && targetId.startsWith("Player_")` or
  `kind === "away" && targetId.startsWith("Player_")`. The helper
  returns `targetId` for those cases; null otherwise.
  Note: existing phase-3 closing-10 reports become unreadable
  post-wipe; this is acceptable (out-of-scope follow-ups own
  re-running closing reports on the new substrate).

- **D.5 — Promoted to a foundation step.** See WP-D.5 above.
  WP-B and WP-C both depend on it. (This sub-bullet remains as
  a landmark so reviewers reading the WP-D list don't search in
  vain for the helper consolidation; the actual contract lives
  in the WP-D.5 section.)

- **D.6 — Test updates:**
  - `apps/replay/src/lib/__tests__/decisionEnglish.test.ts`:
    add per-arm render cases for the new grammar; delete legacy
    arm cases.
  - `tests/llm/inputBuilder.test.ts`: update fixtures consuming
    `priorMoveByActor` to use the new `MoveDecision` shape.
  - `tests/integration/persistAdaptParity.test.ts`: ensure the
    parity test still holds; update fixtures if it constructs a
    decision with legacy arms.

**Acceptance.**

- `apps/replay/src/lib/decisionEnglish.ts:renderMoveIntent` has
  exactly 4 cases.
- `convex/engine/resolution.ts` toward_entity/away_from_entity
  normalisation block renamed to toward/away character-namespace
  normalisation; existing tests pass.
- `convex/llm/inputBuilder.ts` typing aligns with the new
  `MoveDecision`; `npm run typecheck` is green.
- `convex/reports/phase3.ts` narrowed types align with the new
  shape; existing phase-3 aggregator tests pass against fixtures
  updated to the new arm names.
- `apps/replay/src/lib/__tests__/decisionEnglish.test.ts`:
  per-arm render assertions for `toward Player_4`, `toward
  Cover_54_42`, `toward Wall_64_30`, `toward Evac`, `away
  Player_4`, plus `relative` and `none` survival cases.

**Test strategy.**

Tests-first. The renderer test is the user-visible contract;
update it before the renderer body. inputBuilder and reports
tests follow.

**Risks.**

- *Legacy trace renderer fallback.* POC wipe removes the trace
  records; renderer can ship without legacy cases. If wipe is
  vetoed, scope a renderer-only legacy shim (see ADR §1
  alternatives) and DO NOT extend the validator/resolver to
  accept legacy arms. The validator and resolver are *contract*;
  the renderer is *display*.
- *Helper rename churn.* WP-D.5 may rename
  `convex/llm/idNormalisation.ts` → `entityResolve.ts` if the
  expanded surface no-longer-fits. Engineer's call; if rename
  happens, audit `convex/engine/validation.ts`,
  `convex/engine/movement.ts`, `convex/engine/resolution.ts`,
  and any test files for stale import paths before merge.

---

## WP-E — Substrate smoke verification (closing gate)

**Scope.**

Last WP. Pre-conditions: WP-A through WP-D landed; lint / typecheck
/ build / test all green.

**Procedure:**

1. **Schema wipe.** Confirm with user before executing (memory
   `project_poc_schema_wipe_acceptable` endorses but the
   per-execution confirmation stays in place — wipes are
   destructive). Wipe via the Convex CLI / dashboard against the
   dev deployment.
2. **`npx convex dev` push.** The new schema lands cleanly with
   no `validatorFailure` against the wiped deployment.
3. **Single end-to-end smoke match.** `npm run harness -- ...` for
   a single match against the wiped deployment with the default
   phase-4 foundation config (`reasoning.effort=low`,
   `max_output_tokens=1200`, slim system prompt + enriched tool
   descriptions as currently shipping). Confirm:
   - The match completes to turn 50 or earlier (last-survivor /
     extraction).
   - No runtime errors / crashes.
   - Replay UI step-through succeeds for at least 3 turns of the
     match.
4. **Smoke cohort.** 3–5 matches with
   `--seed-prefix move-arm-smoke`. Same config as step 3.
5. **Cluster inspection.** Per match,
   `tsx harness/cluster-failures.ts <matchId>` (or the equivalent
   per-cohort aggregator if one exists). Confirm the verdict in
   README §5:
   - 0 records with `validatorReason` matching
     `targetObjectId='Cover_*_*' is not a known chest or corpse`.
   - 0 records with `validatorReason` matching
     `targetObjectId='Wall_*_*' is not a known chest or corpse`.
   - 0 schema_validation failures naming the removed legacy arm
     kinds (`toward_entity`, `away_from_entity`, `toward_object`,
     `toward_evac`) — beyond an acceptable transient first-turn
     window (document the rate if nonzero).
   - The 510 chest-re-loot cluster from D1 still appears
     unchanged in shape (out-of-scope; smoke is checking for
     absence-of-regression).
   - The 96 `consume='speed'` cluster from D1 still appears
     unchanged in shape (same).
6. **Verdict.** If 5 holds: substrate clean; refactor lands. WP-F
   writes the closure record. If 5 fails: diagnose, regress to
   the appropriate WP, re-land, re-smoke. **Do NOT extend scope
   into other clusters** — out-of-scope is out-of-scope.

**Acceptance.**

- The cluster-failures output for each of the 3–5 smoke matches
  is archived under `docs/project/phases/05-move-arm-consolidation/`
  (e.g. `smoke-<matchId>.md`) per the de-risking convention.
- The closure record (WP-F) cites these match ids and the
  cluster verdicts.
- The smoke matches are queryable from the replay UI; the user
  can step through one and confirm the new grammar visually.

**Test strategy.**

Smoke verification is not unit testing; the unit / integration
tests in WP-A through WP-D are the change verification. Smoke is
the substrate verdict.

**Risks.**

- *Smoke cohort variance.* 3–5 matches is small; if the
  cluster-failures output shows borderline behaviour (e.g.
  one or two legacy-arm schema_validation records), the
  acceptable interpretation is: model adapts within a turn of
  first sight. Document the rate; do not gate the verdict on a
  zero-tolerance count.
- *Out-of-scope cluster regression.* If chest-re-loot or
  `consume='speed'` clusters REDUCE significantly between D1 and
  smoke, that is interesting but does not change this refactor's
  verdict — it's a phase-4 D1 signal, not this refactor's.
  Note it in the closure record as a coincident observation.

---

## WP-F — Documentation + closure record (parallel with WP-E)

**Scope.**

- **F.1 — `docs/project/spec/concept-spec.md`** — action grammar
  section: update to reflect the 4-arm shape. Reproduce or
  reference the stopAtRange table from mental-model §14.
- **F.2 — `docs/project/phases/05-move-arm-consolidation/closure.md`** —
  closure record. Cite the smoke match ids, the cluster-failures
  output, the schema_validation transient rate (if any), and the
  out-of-scope clusters that survived (chest-re-loot;
  consume='speed').
- **F.3 — `docs/project/spec/mental-model.md` §14** — verify the
  dispatched paragraph still reflects landed state. The dispatch
  prose already names the four arms and the stopAtRange table; no
  edit required unless implementation surfaced an intent shift
  (none expected).
- **F.4 — Memory updates.** Update
  `project_move_arm_consolidation.md` memory to "landed" status
  with the closure date and smoke match ids.

**Acceptance.**

- `concept-spec.md` action-grammar section names the 4 arms and
  references the stopAtRange table.
- Closure record exists; cites smoke match ids and verdicts.
- Memory file reflects landed status.

**Test strategy.** Documentation; no test surface.

**Risks.** None.

---

## Tracking table

| WP | After | Parallel with | Files touched | Test surface |
|---|---|---|---|---|
| WP-A | — | — | decisionTool.ts, types.ts, schema.ts, _internal_runMatch.ts | decisionTool.test.ts, schemaMirror.test.ts |
| WP-D.5 | WP-A | — (foundation) | idNormalisation.ts (or entityResolve.ts) | idNormalisation.test.ts |
| WP-B | WP-D.5 | WP-C, WP-D | validation.ts | validation.test.ts |
| WP-C | WP-D.5 | WP-B, WP-D | movement.ts (+ resolution.ts glue in WP-D) | movement.test.ts (+ resolution.test.ts) |
| WP-D | WP-D.5 | WP-B, WP-C | decisionEnglish.ts, inputBuilder.ts, resolution.ts, reports/phase3.ts | decisionEnglish.test.ts, inputBuilder.test.ts, integration/persistAdaptParity.test.ts |
| WP-E | A,D.5,B,C,D | WP-F | (smoke run; no source) | cluster-failures.ts output |
| WP-F | A,D.5,B,C,D | WP-E | concept-spec.md, closure.md, memory | — |

---

*Sequencing maximises parallelism without violating the
schema-first or helper-first invariants. The schema (WP-A) is the
contract; the helper (WP-D.5) is the validator/resolver single
source of truth. After both foundations land, three streams
(validator / resolver / renderer+glue) land in parallel against
disjoint write sets, then smoke + docs close the phase.*
