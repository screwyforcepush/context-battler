# Phase 05 — Implementation Review (WP-A through WP-D)

> Independent code+design review of the move-arm consolidation refactor
> against North Star + `docs/project/spec/mental-model.md` §14. Consolidates
> and confirms an earlier reviewer pass that returned CHANGES with the
> cover-as-hide affordance finding. This review adds depth: the hiding
> gap is broader than initially flagged.

**Verdict: CHANGES — fix the cover-as-hide affordance gap and the
source-comment legacy literal before authorising the Convex wipe + WP-E
smoke. Schema/validator/resolver collapse itself is excellent.**

Date: 2026-05-12. Reviewer: Review Architect (Opus 4.7). Code under
review: commit `84caa99`. AOP.VALIDATE green: lint, typecheck,
681 passed / 4 skipped, build:replay clean (re-run during this review).

---

## Review Summary

- **What is solid**:
  - **Five-surface schema parity is byte-locked.** JSON Schema
    (`decisionTool.ts:218-255`), Zod (`decisionTool.ts:309-330`),
    `types.ts:198-202`, `schema.ts:164-179`, and
    `_internal_runMatch.ts:73-88` all declare `{relative, toward,
    away, none}`. `tests/llm/schemaMirror.test.ts` JSON-stringifies
    the live exports and asserts byte-equality, plus a negative
    assertion against the four legacy literals. This is the drift-
    prone surface North Star explicitly flags; the refactor leaves
    it harder to drift than it found it.
  - **`resolveTypedEntity` is the sole namespace-dispatch authority
    (D8).** Outside `idNormalisation.ts` itself, grep finds zero
    `startsWith("Cover_") / startsWith("Wall_") / === "Evac"` in
    `convex/`. Both `validation.ts:164,171` and `movement.ts:264`
    consume the helper.
  - **Visibility-first rejection (D9) is honoured.** Both move arms
    emit the canonical `move target '<id>' is not visible to actor`
    reason. Parameterised tests (`tests/engine/validation.test.ts:243-
    321`) exercise dead Player_3, unrevealed Evac, malformed Cover,
    unknown ids — all return that exact reason via the helper's
    null-return path. Dead characters are filtered at
    `vision.ts:171`, producing the visibility reason (not "not
    living"). D9 contract holds.
  - **Per-type stopAtRange contract holds.** Table at
    `idNormalisation.ts:195-256` matches mental-model §14 verbatim
    (Char/Chest/Corpse=2, Cover=0, Wall=1, Evac=0); chebyshev gate
    at `movement.ts:138` consumes it.
  - **Wall halt at chebyshev 1 is correct.** Tests at
    `movement.test.ts:405` and `:429` cover both reachable and
    edge-blocked. Mover provably cannot enter a wall: chebyshev gate
    stops desire emission AND `isBlocked` rejects wall tiles.
  - **Cover is walkable** (`tileBlockedByWall` only inspects
    `walls[]`); `movement.test.ts:384` confirms the agent ends ON
    the cover tile when budget covers the distance.
  - **Renderer ships zero legacy-arm branches.** 4-case switch with
    `_exhaustive: never` guard at `decisionEnglish.ts:208-236`.
    Tests cover Player_4 / Cover_54_42 / Wall_64_30 / Evac for
    toward; Player_4 for away.
  - **AOP.VALIDATE green.** Re-ran `npm test`: 681 passed / 4
    skipped. Build:replay clean.

- **What is risky or unclear**:
  - HIGH-1 (cover-as-hide affordance): the engine never sets
    `hidden = true` ANYWHERE. Stepping onto a cover tile does not
    flip the actor to hidden. The cucumber for phase-5 cover-toward
    explicitly says "the agent is hidden by cover-as-hide
    affordance at that tile," and concept-spec §7 makes this an
    engine invariant.
  - LOW-1 (source legacy literal): `convex/llm/idNormalisation.ts:64`
    contains `toward_object` in a historical comment. Violates the
    explicit residual-grep criterion ("zero occurrences in src
    code").
  - LOW-2 (away tie-break comment vs behaviour): the
    `desiredNextTile` `away` tie-break comment says "If on top of
    target (dx=dy=0)" but the rule fires when *either* axis is
    zero. Behaviour preserved verbatim from phase-3
    `away_from_entity` (git diff confirms), but comment is
    misleading.
  - LOW-3 (doc drift): `concept-spec.md` §21 still lists the legacy
    6-arm `Move target:` enum (`relative tile / toward visible
    entity / away from visible entity / toward object / toward evac
    / none`). §10 and §22 were updated correctly; §21 was missed.
  - LOW-4 (missing test): movement-resolver tests cover toward for
    all 6 entity kinds and away for character/cover/wall/evac, but
    NOT away for chest/corpse. Validator + helper tests pin the
    behaviour at those layers; resolver layer is not.
  - LOW-5 (out-of-scope, in closure.md): COVER_TILE_CAP=12 in
    `vision.ts` caps which cover tiles enter the visible set. D10;
    already flagged.

---

## Issues

| Severity | Area | Description | Evidence | Recommendation |
|----------|------|-------------|----------|----------------|
| HIGH | Engine / cover-as-hide affordance | The phase-5 cucumber for "Cover toward steps ONTO the cover tile" requires "the agent is hidden by cover-as-hide affordance at that tile." Concept-spec §7 says: "An agent in cover is hidden unless revealed by proximity, attacking, speaking, looting, using a consumable, leaving cover, or other reveal conditions." The engine does NOT implement this. Grep across `convex/` shows `hidden` is set to `false` in 8 places (match init + 7 reveal-cause paths in resolution.ts) and `true` in ZERO places. The proximity-reveal guard `if (ch.hidden && isInCover(...))` at `resolution.ts:971` is provably dead in production. Phase-5 makes the gap discoverable by enabling cover-toward as a first-class verb; the refactor doesn't *introduce* the bug, but its cucumber makes the fix in-scope. | `convex/engine/resolution.ts:960-988` (phase-7 visibility update only flips hidden→false on proximity, never false→true on enter-cover). `convex/matches.ts:264` (match-init sets `hidden: false`). Grep `hidden: true` returns zero hits in `convex/`. Existing tests' `hidden: true` assertions are all in fixture setup, not produced by the resolver. | Add a phase-7 visibility-update branch: for each living non-hidden character with no reveal-cause this turn whose post-move position is `isInCover`, set `hidden = true` and emit a `visibilityUpdates` entry. Pair with a `resolution.test.ts` case for `toward Cover_X_Y` from non-cover starting position → ends hidden. Confirms the cucumber and gives the substrate-smoke a meaningful signal beyond "the tile was reached". |
| LOW | Source hygiene / drift guard | The North Star residual-grep criterion ("zero occurrences in convex/* and apps/replay/src/* source code") is violated by one comment. Runtime/schema is clean. | `convex/llm/idNormalisation.ts:64` contains `toward_object` in a historical comment about the WP-G.1 corpse path. | Reword the comment, e.g. `rejecting every Corpse_Player_* corpse-loot/move-toward as ...`. Trivial. |
| LOW | Comment hygiene | `desiredNextTile` away tie-break comment claims `dx=dy=0` but rule fires on either-axis-zero. Behaviour is verbatim preserved from phase-3 `away_from_entity` (git diff confirms); not a regression. | `convex/engine/movement.ts:146-156` | Either tighten rule to fire only when both axes are zero, OR update comment to describe actual behaviour. Out of scope for this refactor; log as follow-up. |
| LOW | Docs / concept-spec | §21 "Agent output shape" still lists the legacy 6-arm `Move target:` enum. §10 and §22 are updated. Same doc, two declarations disagree. | `docs/project/spec/concept-spec.md:1214-1220` | Replace §21's `Move target:` list with the §10 4-arm grammar. Fold into the WP-F.1 docs pass before phase closure. |
| LOW | Test coverage | Movement resolver tests cover toward for all 6 entity kinds and away for character/cover/wall/evac, but not away for chest/corpse. Helper + validator tests cover those ids; resolver layer is not pinned. | `tests/engine/movement.test.ts:346-553` | Add focused tests for `away Chest_NNN` and `away Corpse_Player_N`. |

No medium issues.

---

## Spec / Guide Deviations

- **Concept-spec §7 deviation (HIGH-1)**: cover-as-hide affordance
  is unimplemented in the engine. Existed pre-phase-5 (the
  proximity-reveal guard has been dead code since phase 1); phase-5
  cucumber makes the fix in scope.
- **Concept-spec §21 deviation (LOW-3)**: §21's `Move target:`
  enum lags §10's 4-arm declaration.
- **North Star residual-grep deviation (LOW-1)**: one source
  comment retains `toward_object`.

Otherwise none observed:

- Mental-model §14 faithfully expressed in code; pillars 2 + 6
  honoured.
- North Star §A–§E acceptance criteria met (schema, validator,
  resolver, renderer, mirror parity). §F (wipe), §G (smoke), §H
  (full docs closure) remain the user gate.
- Architecture §1 boundary preserved: schema/validator/resolver in
  `convex/`, renderer in `apps/replay/`. No new cross-coupling.
- ADR §1: pure-function modules stay pure (`validation.ts`,
  `movement.ts`, `decisionTool.ts`, `idNormalisation.ts`).

---

## Decision Notes

- **PM/product decision not required for HIGH-1.** Concept-spec §7
  already locks the cover-as-hide rule; this is an
  implementation gap, not a design question.
- **Do not run the Convex wipe or WP-E smoke yet.** Fix HIGH-1 +
  LOW-1 first. The wipe is destructive — running smoke against a
  substrate where stepping onto cover never produces a hidden
  actor will yield noisy / misleading cluster data.
- **Sequencing for fix**: HIGH-1 lands as a phase-7 visibility-
  update addition (small diff in `resolution.ts`, plus one
  resolveTurn-level test). LOW-1 is a comment edit. LOW-3 can
  fold into the WP-F.1 docs pass. LOW-2/LOW-4/LOW-5 can be
  deferred to closure follow-ups.
- **Post-fix path stays as designed**: re-run `npm test`, wipe
  the Convex dev deployment, run WP-E smoke, populate
  `closure.md`. Substrate-retirement check still keys on the
  Cover/Wall-as-toward_object cluster disappearing.

---

## What I Did Not Review (out of scope)

- WP-E substrate-smoke results (pending user gate).
- POC Convex wipe (destructive user gate).
- Phase-4 D1 prompt-strategy questions (orthogonal per North
  Star).
- The 510 chest-re-loot and 96 `consume='speed'` clusters
  (explicitly out of scope per North Star "Hard out of scope").

---

*End of review. Verdict: CHANGES — fix HIGH-1 (cover-as-hide
affordance) and LOW-1 (source legacy literal) before wipe.*
