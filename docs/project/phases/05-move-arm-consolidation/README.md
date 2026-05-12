# Phase 05 — Move-Arm Consolidation Refactor (6 → 4)

> Substrate refactor: collapse the 6-arm move grammar into 4 arms (toward,
> away, relative, none) where toward/away accept ANY visible entity id and
> the engine looks up the per-entity-type stopAtRange. Pure substrate fix;
> no prompt-strategy decisions; orthogonal to the blocked phase-4 D1 user
> gate.

Phase status: **dispatched 2026-05-12**. Why-layer anchor:
`docs/project/spec/mental-model.md` §14 (substrate-refactor paragraph
landed at dispatch). Principle anchor: memory
`feedback_player_perspective_substrate.md` — asymmetric schema/engine
treatment of conceptually-uniform things is a substrate smell; fix the
substrate, don't paper over with prompt teaching.

---

## 1. Why this phase

D1 (`docs/project/phases/04-context-redesign/probes/D1-slim-prompt-regression.md`)
surfaced a 56+-record validator-zero cluster of shape:

```text
move.kind='toward_object' targetObjectId='Cover_54_42'
  is not a known chest or corpse
```

The user pushed back: *"seems ergonomic player perspective and fits
gameplay. Why can't the player move toward target? Are we staring down
the barrel of a refactor?"*

Yes. The phase-3 6-arm grammar (`relative` / `toward_entity` /
`away_from_entity` / `toward_object` / `toward_evac` / `none`) splits
navigation by **engine-internal entity category** (characters vs
lootables vs evac vs everything-else-becomes-arithmetic). The **player
perspective** makes no such distinction: every visible entity is "a
thing in the world I can navigate toward". The only real per-type
difference is *how close* you want to get — and that is a property of
the entity type, not a structural feature of the verb grammar.

Mental-model §14 dispatches the refactor and pillars 2 ("rules simple,
minds messy") and 6 ("build the substrate; let the strategy emerge")
endorse it. This phase is the implementation.

| Symptom (in D1 cohorts) | Root cause (substrate) |
|---|---|
| 56+ `move.kind='toward_object' targetObjectId='Cover_...'` validator zeros | Cover is in the digest but `toward_object` only accepts chest/corpse ids |
| Wall-hugging needs arithmetic via `relative` | No first-class verb for "move adjacent to wall" |
| Evac is grammatically asymmetric (no `targetId`) | `toward_evac` is a singleton arm by accident of phase-3 history |
| Slim prompt has to teach which entity goes with which arm | The category split exists in code, not in player intent |

This refactor expresses Pillar 6 directly: cover-camping, wall-hugging,
evac-rushing become **substrate affordances** rather than arithmetic
puzzles the prompt has to solve.

## 2. What "done" means (closing condition)

A 3–5 match substrate smoke cohort (NOT a closing-10) on the new
4-arm grammar with the default phase-4 foundation config, inspected
via `harness/cluster-failures.ts`, showing:

**Pass / fail gates (two, only):**

- **No validator-zero records** carrying `validatorReason` matching
  `targetObjectId='Cover_*_*' is not a known chest or corpse` or
  `targetObjectId='Wall_*_*' is not a known chest or corpse` —
  this cluster is **structurally retired** by the schema collapse.
- **All smoke matches complete** — no engine crashes, no runtime
  errors; each match reaches turn 50 or earlier
  (last-survivor / extraction).

**Recorded observationally (NOT pass / fail):**

- Legacy-arm schema_validation rate (failures naming removed
  `toward_entity` / `away_from_entity` / `toward_object` /
  `toward_evac` kinds) — bounded transient acceptable; rate
  captured in closure for visibility into model-adaptation speed.
- The 510 chest-re-loot rejections and 96 `consume='speed'`
  rejections from D1 — out of scope; phase-4 D1 territory.
  Smoke records whether they survive (no regression); these
  counts are observation only, not a verdict gate.

**Hard gates:**

- `npm run lint && npm run typecheck && npm run build && npm test`
  — all green at root and in `apps/replay/`.
- `npx convex dev` reaches a clean push against a wiped dev
  deployment. POC-mode schema wipe is the explicitly endorsed path
  (memory: `project_poc_schema_wipe_acceptable`).
- A single end-to-end match completes against the wiped deployment
  on the new grammar (smoke).
- The 3–5 match smoke cohort completes; `cluster-failures.ts` output
  confirms the substrate verdict above.

This phase **does not** measure against the phase-4 done bar
(`<5% no-op turns`) or the phase-3 closing thresholds. Phase-4 WP-D
will measure on the new grammar when the D1 user gate unblocks.

## 3. Scope (what's in)

**Cucumber surface** (mirrors the North Star, condensed):

```gherkin
Feature: Move-arm consolidation

  Scenario: Tool schema declares 4 move arms
    Given the per-turn tool definition
    When the schema is sent to Azure
    Then move.oneOf contains exactly toward, away, relative, none
    And toward and away each carry a single `targetId: string` parameter
    And no arm is named toward_entity, away_from_entity, toward_object, toward_evac

  Scenario: toward accepts any visible entity id
    Given a visible state containing Player_4, Chest_006, Corpse_Player_5,
          Cover_54_42, Wall_64_30, and Evac (after reveal)
    When an agent emits `{move:{kind:"toward", targetId: <any of those>}}`
    Then the validator accepts the decision
    And the resolver routes the agent toward the target's tile

  Scenario: stopAtRange matches the per-entity-type contract
    Given the resolver routes `toward <targetId>` to position P
    Then the agent halts at chebyshev distance R from P, where R is:
      | Character (living) | 2 |
      | Chest              | 2 |
      | Corpse             | 2 |
      | Cover              | 0 |
      | Wall               | 1 |
      | Evac               | 0 |

  Scenario: Cover toward steps ONTO the cover tile
    Given the agent at (50,50) emits `toward Cover_54_42`
    And there is a walkable path from (50,50) to (54,42)
    Then within movement budget the agent reaches (54,42)
    And the cover-as-hide affordance applies once standing on the tile

  Scenario: Wall toward stops at chebyshev 1
    Given the agent at (50,50) emits `toward Wall_64_30`
    Then the agent never enters the wall tile
    And the agent halts at a walkable tile at chebyshev distance 1 from (64,30)

  Scenario: Evac is folded into toward
    Given evac has been revealed at turn 30
    When an agent emits `toward Evac`
    Then the validator accepts and the resolver routes to evac.centre with stopAtRange 0
    And no separate `toward_evac` arm exists in the schema

  Scenario: Unknown / non-visible target rejected with the canonical visibility reason
    Given an agent emits `toward Player_9` where Player_9 is not visible
    Then the validator rejects with the single canonical reason
        "move target 'Player_9' is not visible to actor"
    And the same canonical reason is used for dead chars, unrevealed
        evac, malformed cover/wall ids, and unknown namespaces
        (visibility-first precedence; one rejection layer only)
    And the safe-default decision is substituted

  Scenario: Substrate smoke retires the cover-as-toward_object cluster
    Given a small smoke cohort (3-5 matches) on the post-refactor substrate
    When the validator-zero clusters are inspected via cluster-failures.ts
    Then no records appear with reason
        "targetObjectId='Cover_X_Y' is not a known chest or corpse"
    And the 510 chest-re-loot + 96 consume='speed' clusters remain unchanged
```

## 4. Hard out of scope

- **All phase-4 prompt-strategy questions.** D1 user gate stays parked
  on the phase-4 assignment. Whatever option the user picks downstream
  (soften WP-C tool descriptions, add semantic teaching to slim prompt,
  investigate +6.850pp residual, hybrid) is independent of this refactor.
- **Other validator-zero clusters from D1.** The 510 chest-re-loot and
  96 `consume='speed'` rejections are prompt-teachable / equipped-state
  semantics gaps; phase-4 D1 territory.
- **Action arm consolidation.** Attack and loot are semantically
  distinct (harm vs take); they stay separate. Out of scope.
- **Consume relocation.** Mentioned in jam as adjacent cleanup; OUT.
- **Closing-10 / closing-N pass.** This is substrate, not phase
  closure. Phase-4 will measure on the new grammar when it unblocks.
- **Renderer compatibility shim for legacy traces.** POC wipe is the
  recommended path; the renderer ships only the new-arm cases.
- **Reducing or expanding the cover-as-hide affordance.** The
  refactor preserves `hiding.ts` semantics exactly (Cover stopAtRange
  0 is load-bearing for "hides only while standing on it").

## 5. Acceptance criteria — substrate smoke

Substrate verdict (the closing-bar this phase is measured
against). **Two pass / fail checks**, plus observational records:

| Check | Type | Condition | Source of truth |
|---|---|---|---|
| Cover-as-toward_object cluster retired | **Pass / fail** | 0 records with reason matching `targetObjectId='Cover_*_*' is not a known chest or corpse` | `harness/cluster-failures.ts` per smoke match |
| Wall-as-toward_object cluster retired | **Pass / fail** | 0 records with reason matching `targetObjectId='Wall_*_*' is not a known chest or corpse` | as above |
| End-to-end smoke matches complete | **Pass / fail** | All smoke matches finish on the wiped deployment with no runtime errors | replay UI step-through + harness logs |
| Legacy arm kinds in schema_validation reasons | Observational | Rate of schema_validation failures naming `toward_entity` / `away_from_entity` / `toward_object` / `toward_evac` is RECORDED but does NOT gate the verdict (R1 transient — acceptable so long as bounded; if rate is non-trivial, phase-4 D1 follow-up territory) | as above |
| Chest-re-loot cluster | Observational | The 510-class cluster from D1 likely still appears (out-of-scope; recorded, not gated) | as above |
| `consume='speed'` cluster | Observational | The 96-class cluster from D1 likely still appears (out-of-scope; recorded, not gated) | as above |

**Sample size note.** 3–5 matches is intentionally small — this is a
substrate verification, not a metric pass. The cluster-failures
inspection is the test, not the headline rate. If the pass / fail
checks above hold (and the observational records are sensible), the
refactor lands.

## 6. Architecture at a glance

Pure substrate refactor: schema, validator, resolver, renderer.
Per-architecture §1: engine and renderer meet only at State. No new
cross-coupling, no new modules outside the existing slice boundaries.

| Slice | Files touched | Nature of change |
|---|---|---|
| LLM tool schema | `convex/llm/decisionTool.ts` | 6→4 `oneOf` arms + matching Zod; both reject removed legacy kinds |
| Engine types | `convex/engine/types.ts` | `MoveDecision` discriminator: 4 arms |
| Engine validator | `convex/engine/validation.ts` | single `toward`/`away` path; calls shared `resolveTypedEntity` helper; visibility-first rejection reason |
| Engine resolver | `convex/engine/movement.ts` | single `toward`/`away` resolver; consumes shared helper for tile + per-type `stopAtRange`; cover-walkable path; wall-never-entered path; evac fold |
| Typed-id helper | `convex/llm/idNormalisation.ts` (or `entityResolve.ts`) | **new** `resolveTypedEntity` — single source of truth for the canonical visible-target-id projection, namespace dispatch, tile lookup, and `stopAtRange` lookup; both validator and resolver consume it |
| Engine resolution glue | `convex/engine/resolution.ts` | the toward_entity/away_from_entity normalization block becomes the new toward/away character-id normalization |
| Schema validator | `convex/schema.ts` | `moveValidator` union: 4 arms |
| Schema mirror | `convex/_internal_runMatch.ts` | `moveValidator` mirror: 4 arms (lockstep) |
| Input builder | `convex/llm/inputBuilder.ts` | `priorMoveByActor` typing matches new `MoveDecision`; comment phrasing on the wall-blocked-move marker updated; no behavioural change |
| Id normalisation | `convex/llm/idNormalisation.ts` | hosts the new `resolveTypedEntity` foundation helper (WP-D.5); existing `normaliseCharacterTargetId` / `normaliseCorpseTargetId` retained for internal use |
| Renderer | `apps/replay/src/lib/decisionEnglish.ts` | render the 4 new arms in English |
| Report aggregator | `convex/reports/phase3.ts` | `Phase3AgentRecord.decision.move` discriminator narrowed types |
| Concept spec | `docs/project/spec/concept-spec.md` | action grammar section updated to 4 arms + stopAtRange table reference |
| Mental model | `docs/project/spec/mental-model.md` §14 | already landed at dispatch; not re-edited unless intent shifts |

**Slice boundary discipline.** Pure-function modules (`validation.ts`,
`movement.ts`, `decisionTool.ts`) stay pure. No new Convex API imports
into engine modules. The renderer never imports from `convex/engine/*`
runtime — it uses `Doc<"turns">` types from `_generated/dataModel`
exactly as the phase-2/3 renderer slice does.

## 7. Schema break handling

POC posture: schema wipe is endorsed
(`project_poc_schema_wipe_acceptable`). The plan recommends and
defaults to wiping the dev Convex deployment after WP-A lands and
before WP-E runs, so legacy phase-3 traces (which carry old-shape
`move` discriminators in `decisionValidator`) don't have to be
reconciled with the new validator at read-time.

**Alternative considered and rejected: renderer-only legacy shim.**
Keeping the renderer able to display old-shape `decision.move`
discriminators would let historical phase-3 / phase-4 D1 traces stay
inspectable in the replay UI. The cost: every entry in the renderer's
move switch carries a legacy branch the validator/resolver doesn't
support, and a reader can't tell which traces are "live" vs
"historical". The POC posture eliminates the ambiguity. If the user
vetoes wipe, the shim is scoped to the renderer ONLY — the
validator/resolver MUST NOT accept legacy arms.

## 8. Sequencing

WP-A lands first (schema is the contract; everything keys off it).
**WP-D.5 (helper foundation) lands next** — the shared
`resolveTypedEntity` helper is the single source of truth that
WP-B (validator) and WP-C (resolver) BOTH consume; it must exist
before they can be written tests-first against it. WP-B and WP-C
then run in parallel — disjoint write sets (`validation.ts` vs
`movement.ts`); both import the helper. The remainder of WP-D
(renderer + downstream surfaces) lands in parallel with WP-B/WP-C
— also disjoint files. WP-E (smoke verification) is the closing
gate. WP-F (docs) lands alongside WP-E.

```text
        WP-A   Schema + types
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
         WP-E (smoke) ── WP-F (docs)
```

See `work-packages.md` for the per-WP scope/acceptance/tests/risks
breakdown.

## 9. De-risking (one-line summary)

Detail in `de-risking.md`. Four risks tracked:

- **R1** — Model adapts to the new grammar without significant
  schema_validation regression. Surface shrinks (6→4 arms), so this
  should help, not hurt. Smoke is the verification.
- **R2** — Cover tile is always walkable. The single-line invariant
  in `movement.ts` (cover does not appear in walls) is asserted by
  the existing `hiding.ts` design but covered explicitly by a
  resolver unit test in WP-C.
- **R3** — Wall stop-at-chebyshev-1 corner cases (wall at map edge,
  no walkable tile at chebyshev 1). Resolver halts at the actor's
  current position; covered by a test in WP-C.
- **R4** — Legacy phase-3 traces and the renderer. POC wipe is the
  recommended path; the renderer ships only new-arm cases.

## 10. Files in scope (cross-reference)

Schema/types:
- `convex/llm/decisionTool.ts:90-365` — JSON Schema + Zod (WP-A)
- `convex/engine/types.ts:200-206` — MoveDecision discriminator (WP-A)
- `convex/schema.ts:164-184` — `moveValidator` (WP-A)
- `convex/_internal_runMatch.ts:73-93` — schema mirror (WP-A)

Validator/resolver:
- `convex/engine/validation.ts:160-269` — per-arm validator (WP-B)
- `convex/engine/movement.ts:99-221` — `desiredNextTile` switch (WP-C)
- `convex/engine/resolution.ts:296-325` — toward_entity/away_from_entity
  characterId normalisation block (WP-C/-D glue)

Renderer + downstream:
- `apps/replay/src/lib/decisionEnglish.ts:208-253` — `renderMoveIntent`
  switch (WP-D)
- `convex/llm/inputBuilder.ts:160-280` — `priorMoveByActor` typing
  + wall-blocked-move marker comment (WP-D)
- `convex/llm/idNormalisation.ts` — helpers consolidation (WP-D)
- `convex/reports/phase3.ts:140-180,320-335` — narrowed move
  discriminator + `moveTargetEntityId` helper (WP-D)

Tests:
- `tests/llm/decisionTool.test.ts` (WP-A)
- `tests/llm/schemaMirror.test.ts` (WP-A)
- `tests/engine/validation.test.ts` (WP-B)
- `tests/engine/movement.test.ts` (WP-C)
- `tests/engine/resolution.test.ts` (WP-C — glue test only if changed)
- `tests/llm/inputBuilder.test.ts` (WP-D)
- `tests/integration/persistAdaptParity.test.ts` (WP-A/-D)
- `apps/replay/src/lib/__tests__/decisionEnglish.test.ts` (WP-D)

Docs:
- `docs/project/spec/concept-spec.md` — action grammar (WP-F)
- `docs/project/spec/mental-model.md` §14 — intent anchor (already
  landed; not re-edited unless intent shifts)
- `docs/project/phases/05-move-arm-consolidation/closure.md` — closure
  record (WP-F)

---

*Phase folder convention follows phase-1..4. This is a substrate
refactor, not a feature phase — closure is a verdict on substrate
hygiene, not a metric pass.*
